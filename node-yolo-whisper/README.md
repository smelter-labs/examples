# YOLO + Whisper + Smelter (Node.js)

End-to-end example combining `@swmansion/smelter-node` with a Python sidecar
that runs object detection (YOLOv8) and speech-to-text (Whisper) on a webcam
stream pushed from the browser.

## What this example does

1. Browser captures webcam + mic with `getUserMedia` and pushes it to
   Smelter via WHIP.
2. Smelter runs in the Node.js process via `@swmansion/smelter-node` and
   publishes decoded frames + PCM audio batches to a Python sidecar over
   Unix sockets (Smelter's [side channel](https://docs.smelter.dev)
   feature).
3. The Python sidecar uses `smelter-sdk` to read the decoded media, runs
   YOLO on every Nth video frame (with ByteTrack for stable track ids),
   and runs Whisper on speech segments detected by Silero VAD. Results
   are pushed back to the Node app over a single WebSocket connection
   (Python is the WS client; Node hosts the server).
4. Node updates React state, which re-renders the Smelter scene with
   bounding boxes and transcript text baked into the WHEP output the
   browser is displaying.
5. The category dropdown in the browser POSTs to `/api/category`; Node
   forwards the value to Python over the same WS to change which COCO
   class YOLO is filtering for.

There is no WebSocket connection between the browser and Node.

## Prerequisites

A webcam, plus Node.js 20+, pnpm, Python 3.11+ as `python3`, and the shared
libraries the Smelter binary links against (`ffmpeg`, `libopus`, `openssl`).
Install the Python deps from `sidecar/requirements.txt`.

### GPU

Both models run on PyTorch, so they use the GPU automatically whenever torch
sees one, falling back to CPU otherwise. YOLO is Ultralytics-on-torch and
Whisper is HF `transformers` (not faster-whisper, whose CTranslate2 backend is
CUDA-only — `transformers` runs on whatever torch backend you have, including
ROCm). The device is selected by `torch.cuda.is_available()`; note that a ROCm
torch build reports AMD GPUs through that same `cuda` API.

What you need is simply a GPU-enabled PyTorch:

- **NVIDIA:** a CUDA-enabled torch build (the default `pip install torch` on
  Linux ships with CUDA).
- **AMD:** a ROCm torch build matching your card's arch (ROCm ≥ 6.4 for RDNA4 /
  `gfx1201`). With the Nix flake in this repo this is handled for you — the
  flake builds torch with `rocmSupport` targeting `gfx1201`; change the arch in
  `flake.nix` (`gpuTargets`) for a different AMD card.

Override device selection with environment variables on the sidecar process:

- `DEVICE=cpu` — force CPU even if a GPU is present (GPU is the default).
- `DEVICE=cuda` — force/assert GPU use (works for ROCm GPUs too).
- `WHISPER_MODEL=openai/whisper-small` — pick a different Whisper checkpoint
  (defaults to `openai/whisper-base`). float16 is used on GPU, float32 on CPU.

## Setup

```bash
cd node-yolo-whisper
pnpm install
pip install -r sidecar/requirements.txt
```

On Nix, instead of `pip install` use the dev shell from the repo root — it
provides Node, pnpm, and a Python environment with a GPU (ROCm) torch already
built for the sidecar:

```bash
nix develop   # from smelter/examples
```

The first YOLO / Whisper runs will download model weights (~50 MB + ~140 MB).

## Run

In two terminals:

```bash
# Terminal 1 — Node app: spawns Smelter binary + Python sidecar
pnpm server
```

```bash
# Terminal 2 — Vite dev server
pnpm dev
```

Then open the URL Vite prints (typically <http://localhost:5173>).
Click **Start webcam**, grant camera + microphone permission, and you should
see the composed view with green bounding boxes appear within a couple of
seconds.

Pick a different COCO class in the dropdown to switch what YOLO is detecting.

## Run Python sidecar manually (development)

If you want to iterate on `sidecar.py` under a debugger, start the Node app
with `SKIP_PYTHON=1` and copy the printed `SMELTER_SIDE_CHANNEL_SOCKET_DIR`
into the Python environment yourself:

```bash
SKIP_PYTHON=1 pnpm server
# in another terminal:
export SMELTER_SIDE_CHANNEL_SOCKET_DIR=/tmp/smelter-sidechan-XXXXXX
python3 sidecar/sidecar.py
```
