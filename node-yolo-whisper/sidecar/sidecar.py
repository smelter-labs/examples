"""Python sidecar: consumes Smelter side-channel media, runs YOLO + Whisper,
pushes results to the Node app over a single WebSocket connection.

Connection direction: Node hosts the WS server, this process is the client.
That way Python can be restarted without Node having to rebind a port.
"""

from __future__ import annotations

import asyncio
import faulthandler
import json
import logging
import os
import sys
from collections import deque
from dataclasses import dataclass

import numpy as np

faulthandler.enable()

# Load Ultralytics and warm the model up once at startup so its one-time
# Conv+BN fuse and kernel JIT happen here rather than stalling the first real
# frame. torch is imported alongside (Ultralytics already pulls it in) so we
# can resolve the compute device *before* the warm-up and cache the fused
# weights for the device we'll actually run on.
#
# Note: both YOLO (Ultralytics) and Whisper (HF transformers, see below) run on
# the same torch backend. On an AMD GPU that's torch's ROCm build, which still
# exposes the `cuda` device string and `torch.cuda.*` API — hence DEVICE="cuda"
# selects the AMD card just as it would an NVIDIA one.
from ultralytics import YOLO  # noqa: E402
import torch  # noqa: E402


def _select_device() -> str:
    """Resolve the torch device to run on. Defaults to the GPU when one is
    present (ROCm GPUs report through the `cuda` API too); override with
    DEVICE=cpu, or DEVICE=cuda to force/assert GPU use."""
    requested = os.environ.get("DEVICE", "cuda" if torch.cuda.is_available() else "cpu")
    if requested.startswith("cuda") and not torch.cuda.is_available():
        print(
            "[python] DEVICE=cuda requested but no GPU is available to torch; "
            "falling back to CPU",
            file=sys.stderr,
            flush=True,
        )
        return "cpu"
    return requested


DEVICE = _select_device()


def _ensure_gpu_nms() -> None:
    """Ultralytics' detection post-processing calls ``torchvision.ops.nms``,
    but some torchvision builds ship without a GPU build of their custom ops
    (notably nixpkgs' torchvision, which currently has no ROCm support) — so
    nms only works on CPU tensors and raises on GPU ones. Probe for a working
    GPU kernel; if it's missing, wrap nms to run on CPU and map the kept
    indices back to the original device. nms handles a few hundred boxes, so
    the round-trip is negligible next to the GPU backbone. Self-disabling: if
    torchvision ever gains GPU ops, the probe succeeds and nothing is patched.
    """
    import torchvision

    if not torch.cuda.is_available():
        return
    probe_boxes = torch.tensor([[0.0, 0.0, 1.0, 1.0]], device="cuda")
    probe_scores = torch.tensor([1.0], device="cuda")
    try:
        torchvision.ops.nms(probe_boxes, probe_scores, 0.5)
        return
    except NotImplementedError:
        pass

    orig_nms = torchvision.ops.nms

    def nms_cpu_fallback(
        boxes: torch.Tensor, scores: torch.Tensor, iou_threshold: float
    ) -> torch.Tensor:
        if boxes.is_cuda:
            keep = orig_nms(boxes.cpu(), scores.cpu(), iou_threshold)
            return keep.to(boxes.device)
        return orig_nms(boxes, scores, iou_threshold)

    setattr(torchvision.ops, "nms", nms_cpu_fallback)
    print(
        "[python] torchvision GPU nms unavailable — using CPU-fallback shim",
        file=sys.stderr,
        flush=True,
    )


def _warmup(model: YOLO) -> None:
    model.to(DEVICE)
    dummy = np.zeros((180, 320, 3), dtype=np.uint8)
    model.predict(dummy, verbose=False, device=DEVICE)


print(f"[python] loading + warming up YOLO model on {DEVICE}…", file=sys.stderr, flush=True)
_ensure_gpu_nms()
YOLO_COCO = YOLO("yolov8n.pt")
_warmup(YOLO_COCO)
COCO_NAMES: dict[int, str] = YOLO_COCO.names  # type: ignore[assignment]
print("[python] YOLO ready", file=sys.stderr, flush=True)

# Remaining deps.
import websockets  # noqa: E402
from silero_vad import VADIterator, load_silero_vad  # noqa: E402
from smelter import list_channels  # noqa: E402
from smelter.aio import subscribe_audio_channel, subscribe_video_channel  # noqa: E402
from transformers import Pipeline, pipeline  # noqa: E402

logging.basicConfig(
    level=logging.INFO, format="[python] %(message)s", stream=sys.stderr
)
log = logging.getLogger("sidecar")

INPUT_ID_SUFFIX = "cam"
NODE_WS_URL = os.environ.get("NODE_WS_URL", "ws://127.0.0.1:8082")

# YOLO runs on every Nth video frame to keep CPU usage sane, and only
# surfaces detections at or above this confidence.
YOLO_FRAME_STRIDE = 3
YOLO_CONFIDENCE = 0.5

# Silero VAD config. Threshold is intentionally lower than silero's default
# 0.5 — at 0.5 short or quiet single-word utterances ("yes", "ok") often
# never cross the trigger and get dropped before whisper sees them. 0.3
# catches them at the cost of being a bit more permissive about background
# noise. `speech_pad_ms=0` so reported start/end timestamps mark the *exact*
# windows where speech begins/ends, with no silence padding shifting them.
VAD_THRESHOLD = 0.3
VAD_MIN_SILENCE_MS = 200
VAD_SAMPLE_RATE = 16000
VAD_WINDOW = 512
# Pre-roll: when speech starts, the audio sent to whisper is seeded with the
# last VAD_PREROLL_WINDOWS windows from a rolling deque. Gives whisper a
# tiny lead-in (~6 * 32 ms = 192 ms) so the first phoneme of a short word
# isn't clipped, without affecting the reported `ts` — that still comes
# from the detection window, not the pre-roll start.
VAD_PREROLL_WINDOWS = 6
# Hard cap on a single segment's duration. If the speaker never pauses long
# enough for VAD to emit 'end', we'd otherwise accumulate unbounded audio.
# When the cap is hit we force a flush as if 'end' had fired and start a
# new segment from the current window onward.
VAD_MAX_SEGMENT_MS = 8000
WHISPER_LANGUAGE: str | None = "en"
WHISPER_MODEL_ID = os.environ.get("WHISPER_MODEL", "openai/whisper-base")
# float16 on GPU (incl. ROCm), float32 on CPU. fp16 on CPU is slow/unsupported.
WHISPER_DTYPE = torch.float16 if DEVICE.startswith("cuda") else torch.float32
# Serialize transcription so overlapping utterances don't run concurrent
# forward passes on the same model/GPU — see `_transcribe_and_emit`.
_whisper_lock = asyncio.Lock()


@dataclass
class State:
    # YOLO COCO class name to track. The actual category is sent over WS by
    # Node right after connect, so this default only matters during the
    # brief gap before that message arrives.
    category: str = "person"


state = State()
events_q: asyncio.Queue[dict] = asyncio.Queue(maxsize=64)


async def main() -> None:
    log.info("loading Whisper (%s, %s) + Silero VAD models…", WHISPER_MODEL_ID, DEVICE)
    whisper_model, vad_model = await asyncio.to_thread(
        lambda: (
            pipeline(
                "automatic-speech-recognition",
                model=WHISPER_MODEL_ID,
                device=DEVICE,
                dtype=WHISPER_DTYPE,
            ),
            load_silero_vad(),
        )
    )

    log.info(
        "SMELTER_SIDE_CHANNEL_SOCKET_DIR=%s",
        os.environ.get("SMELTER_SIDE_CHANNEL_SOCKET_DIR", "<unset>"),
    )

    async with connect(NODE_WS_URL) as ws:
        log.info("connected to Node WS %s", NODE_WS_URL)
        video_id = await asyncio.to_thread(wait_for_channel, "video", INPUT_ID_SUFFIX)
        audio_id = await asyncio.to_thread(wait_for_channel, "audio", INPUT_ID_SUFFIX)
        log.info("subscribing: video=%r audio=%r", video_id, audio_id)
        await asyncio.gather(
            receive_control(ws),
            push_events(ws),
            run_yolo(video_id, COCO_NAMES),
            run_whisper(audio_id, vad_model, whisper_model),
        )


def wait_for_channel(kind: str, suffix: str) -> str:
    """Block until a side-channel socket whose input_id ends with `suffix`
    appears, then return the full input_id (e.g. ``"global:cam"``)."""
    import time

    while True:
        for c in list_channels():
            if c.kind.value == kind and (
                c.input_id == suffix or c.input_id.endswith(f":{suffix}")
            ):
                return c.input_id
        time.sleep(0.5)


def connect(url: str):
    """One-shot WS connect — raises on failure and exits the sidecar on a
    dropped connection. Restart the Node app to bring it back up."""
    return websockets.connect(url, ping_interval=20, max_size=None)


async def receive_control(ws) -> None:
    async for raw in ws:
        try:
            msg = json.loads(raw)
        except json.JSONDecodeError:
            log.warning("ignoring non-JSON ws message")
            continue
        if msg.get("type") == "setCategory":
            value = msg.get("value")
            if isinstance(value, str) and value:
                state.category = value
                log.info("category → %s", value)


async def push_events(ws) -> None:
    while True:
        event = await events_q.get()
        try:
            await ws.send(json.dumps(event))
        except websockets.ConnectionClosed:
            return


async def run_yolo(input_id: str, coco_names: dict[int, str]) -> None:
    log.info("run_yolo: subscribing to video channel %r", input_id)
    counter = 0
    async for frame in subscribe_video_channel(input_id):
        counter += 1
        if counter % YOLO_FRAME_STRIDE != 0:
            continue

        category = state.category
        rgb = np.ascontiguousarray(frame.rgba[:, :, :3])
        h, w = frame.height, frame.width
        ts_ms = frame.pts_nanos // 1_000_000

        # model.track keeps a ByteTrack-stable id across frames so the Scene
        # can use it as the smelter component id and interpolate box motion
        # instead of snapping. We filter the COCO model down to a single
        # class so only the currently-selected category is reported.
        target_id = name_to_class_id(coco_names, category)
        if target_id is None:
            await events_q.put({"type": "yolo", "boxes": [], "ts": ts_ms})
            continue
        try:
            results = await asyncio.to_thread(
                lambda: YOLO_COCO.track(
                    rgb,
                    classes=[target_id],
                    conf=YOLO_CONFIDENCE,
                    persist=True,
                    verbose=False,
                    device=DEVICE,
                )
            )
        except Exception as err:  # noqa: BLE001
            log.exception("YOLO predict failed: %s", err)
            continue
        boxes = boxes_from_results(results, w, h, coco_names)
        await events_q.put({"type": "yolo", "boxes": boxes, "ts": ts_ms})


def boxes_from_results(results, w: int, h: int, names: dict[int, str]) -> list[dict]:
    out = []
    for r in results:
        ids_tensor = getattr(r.boxes, "id", None)
        ids = (
            ids_tensor.cpu().numpy().astype(int).tolist()
            if ids_tensor is not None
            else None
        )
        for idx, det in enumerate(r.boxes):
            x1, y1, x2, y2 = det.xyxy[0].tolist()
            track_id = int(ids[idx]) if ids is not None and idx < len(ids) else None
            out.append(
                {
                    "label": names[int(det.cls.item())],
                    "confidence": float(det.conf.item()),
                    "x": x1 / w,
                    "y": y1 / h,
                    "w": (x2 - x1) / w,
                    "h": (y2 - y1) / h,
                    "trackId": track_id,
                }
            )
    return out


NANOS_PER_SAMPLE_16K = 1_000_000_000 // VAD_SAMPLE_RATE  # 62500 ns


async def stream_16k_windows(input_id: str):
    """Async iterator: yields ``(window, window_start_pts_ms)`` for every
    512-sample window of 16 kHz mono audio from the side channel.

    Handles batch arrival, resampling, and carrying residual samples
    (<512) across batches. The pts comes straight from the side channel
    (``batch.start_pts_nanos`` minus the residual span), so the mapping
    is drift-free against the source stream — VAD's own seconds-since-
    origin counter would desync if any sample were ever skipped.
    """
    residual = np.empty(0, dtype=np.float32)
    sample_rate: int | None = None

    async for batch in subscribe_audio_channel(input_id):
        if sample_rate is None:
            sample_rate = batch.sample_rate
            log.info("audio input sample_rate=%d", sample_rate)
        mono = batch.to_mono()
        if mono.size == 0:
            continue
        chunk = resample_to_16k(mono, sample_rate).astype(np.float32, copy=False)
        if chunk.size == 0:
            continue

        audio = np.concatenate([residual, chunk]) if residual.size else chunk
        # First sample of `audio` sits `residual.size` samples before the
        # current batch's pts.
        audio_start_pts_nanos = (
            batch.start_pts_nanos - residual.size * NANOS_PER_SAMPLE_16K
        )
        n_windows = audio.size // VAD_WINDOW

        for i in range(n_windows):
            # Copy because we rotate `audio` via `residual`; without copy
            # the slice would alias memory the next batch overwrites.
            window = audio[i * VAD_WINDOW : (i + 1) * VAD_WINDOW].copy()
            window_pts_ms = (
                audio_start_pts_nanos + i * VAD_WINDOW * NANOS_PER_SAMPLE_16K
            ) // 1_000_000
            yield window, window_pts_ms

        residual = audio[n_windows * VAD_WINDOW :].copy()


async def _transcribe_and_emit(
    model: Pipeline, audio: np.ndarray, ts_ms: int, duration_ms: int
) -> None:
    """Background task: run whisper on `audio` and emit the transcript.
    Kicked off with `asyncio.create_task` from the VAD loop so transcribe
    latency doesn't stall audio ingestion — the side-channel queue would
    otherwise back up during transcription and risk losing the next word.

    The actual forward pass runs in a worker thread (so the event loop keeps
    draining audio) but is guarded by `_whisper_lock` so two overlapping
    utterances don't hit the model/GPU concurrently."""

    def _run() -> str:
        result = model(
            {"raw": audio, "sampling_rate": VAD_SAMPLE_RATE},
            generate_kwargs={"language": WHISPER_LANGUAGE, "task": "transcribe"},
        )
        return result["text"].strip()

    try:
        async with _whisper_lock:
            text = await asyncio.to_thread(_run)
    except Exception as err:  # noqa: BLE001 — never let one failure halt captions
        log.warning("whisper failed: %s", err)
        return
    if not text:
        return
    log.info("whisper @ %d ms (%d ms): %s", ts_ms, duration_ms, text)
    await events_q.put(
        {
            "type": "transcript",
            "text": text,
            "ts": ts_ms,
            "duration": duration_ms,
        }
    )


async def run_whisper(input_id: str, vad_model, whisper_model: Pipeline) -> None:
    """VAD-gated utterance transcription.

    For each 16 kHz window of incoming side-channel audio, run Silero
    VAD. On 'start' begin a new utterance buffer (seeded with a pre-roll
    deque so whisper sees ~200 ms of lead-in for short words); on 'end'
    transcribe the buffer and emit. Timestamps are pulled from the
    window stream (see ``stream_16k_windows``) and so are anchored to
    the side-channel pts.
    """
    log.info("run_whisper: subscribing to audio channel %r", input_id)

    vad_iter = VADIterator(
        vad_model,
        threshold=VAD_THRESHOLD,
        sampling_rate=VAD_SAMPLE_RATE,
        min_silence_duration_ms=VAD_MIN_SILENCE_MS,
        speech_pad_ms=0,
    )

    pre_buffer: deque[np.ndarray] = deque(maxlen=VAD_PREROLL_WINDOWS)
    speech_windows: list[np.ndarray] = []
    # `speech_start_pts_ms is not None` doubles as the "in speech" flag.
    speech_start_pts_ms: int | None = None

    async for window, window_pts_ms in stream_16k_windows(input_id):
        pre_buffer.append(window)

        match vad_iter(torch.from_numpy(window), return_seconds=True):
            case {"start": _}:
                speech_start_pts_ms = window_pts_ms
                speech_windows = list(pre_buffer)

            case {"end": _} if speech_start_pts_ms is not None:
                duration_ms = window_pts_ms - speech_start_pts_ms
                ts_ms = speech_start_pts_ms
                audio = np.concatenate(speech_windows)
                speech_start_pts_ms = None
                speech_windows = []
                # Background task so the VAD loop keeps draining audio in
                # real time while whisper runs.
                asyncio.create_task(
                    _transcribe_and_emit(whisper_model, audio, ts_ms, duration_ms)
                )

            case _ if speech_start_pts_ms is not None:
                speech_windows.append(window)

        # Force-flush a segment that ran past VAD_MAX_SEGMENT_MS — VAD never
        # saw enough silence to call 'end' but we don't want unbounded audio.
        if (
            speech_start_pts_ms is not None
            and window_pts_ms - speech_start_pts_ms >= VAD_MAX_SEGMENT_MS
        ):
            duration_ms = window_pts_ms - speech_start_pts_ms
            ts_ms = speech_start_pts_ms
            audio = np.concatenate(speech_windows)
            # Restart immediately so the next windows still get collected.
            # Seed with pre_buffer so whisper has continuity into the next
            # chunk.
            speech_start_pts_ms = window_pts_ms
            speech_windows = list(pre_buffer)
            asyncio.create_task(
                _transcribe_and_emit(whisper_model, audio, ts_ms, duration_ms)
            )


def resample_to_16k(audio: np.ndarray, sample_rate: int) -> np.ndarray:
    if sample_rate == 16000:
        return audio
    ratio = 16000 / sample_rate
    target_len = int(round(audio.shape[0] * ratio))
    if target_len <= 0:
        return audio
    x_old = np.linspace(0.0, 1.0, audio.shape[0], endpoint=False)
    x_new = np.linspace(0.0, 1.0, target_len, endpoint=False)
    return np.interp(x_new, x_old, audio).astype(np.float32, copy=False)


def name_to_class_id(coco_names: dict[int, str], wanted: str) -> int | None:
    wanted_lc = wanted.lower()
    for cls_id, name in coco_names.items():
        if name.lower() == wanted_lc:
            return cls_id
    return None


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
