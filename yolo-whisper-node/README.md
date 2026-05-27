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

## Setup

```bash
cd yolo-whisper-node
pnpm install
pip install -r sidecar/requirements.txt
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

