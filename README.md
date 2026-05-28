# Smelter examples

A collection of self-contained example apps built with the [Smelter](https://smelter.dev)
TypeScript SDK. [Smelter](https://github.com/software-mansion/smelter) is a toolkit for
real-time, low-latency, programmable video and audio composition, where scenes are described
with React components.

Each example lives in its own directory and is independent — pick one, install its
dependencies, and run it. Examples are grouped by the Smelter runtime package they use:

- **[`@swmansion/smelter-node`](#swmansionsmelter-node)** — run Smelter from a Node.js process.
- **[`@swmansion/smelter-web-client`](#swmansionsmelter-web-client)** — drive a remote Smelter server from the browser.
- **[`@swmansion/smelter-web-wasm`](#swmansionsmelter-web-wasm)** — run Smelter entirely in the browser via WebAssembly.

## Prerequisites

- [Node.js](https://nodejs.org) 24+ and [pnpm](https://pnpm.io).
- `ffmpeg` and `ffplay` on your `PATH` — only needed by the Node.js examples that preview
  their output locally.

## Running an example

Every example follows the same flow:

```bash
cd <example-directory>
pnpm install
pnpm start   # or `pnpm dev` for the browser examples
```

The exact command per example is listed below.

## `@swmansion/smelter-node`

Drive a locally-spawned Smelter binary from a Node.js process — the package downloads and
manages the binary for you. Inputs and outputs are configured server-side.

| Example | Command | What it shows |
| --- | --- | --- |
| [`node-minimal`](./node-minimal) | `pnpm start` | Real-time processing: compose a scene, stream it over RTMP, and preview the output with `ffplay`. |
| [`node-offline`](./node-offline) | `pnpm start [files…]` | Offline processing: stitch one or more MP4 files into a single `output.mp4`. |
| [`node-yolo-whisper`](./node-yolo-whisper) | see its [README](./node-yolo-whisper) | A full app: React frontend, Node.js backend, and a Python sidecar running YOLO object detection and Whisper transcription over Smelter's side channel. |

## `@swmansion/smelter-web-client`

Control a separate, already-running Smelter server from the browser. React code runs in the
browser and sends scene-update requests to the server.

| Example | Command | What it shows |
| --- | --- | --- |
| [`web-client-vite`](./web-client-vite) | `pnpm dev` | A Vite + React UI that connects to a Smelter server and updates the composition live. |

> Requires a running Smelter server. See the [Smelter documentation](https://smelter.dev/docs)
> for how to start one.

## `@swmansion/smelter-web-wasm`

Run Smelter inside the browser via WebAssembly. These examples are fully self-contained and
need no server or extra infrastructure (Chromium-based browsers only).

| Example | Command | What it shows |
| --- | --- | --- |
| [`web-wasm-vite`](./web-wasm-vite) | `pnpm dev` | A Vite + React app that renders a composition to a `<canvas>`. |
| [`web-wasm-react-router`](./web-wasm-react-router) | `pnpm dev` | A React Router app with two pages: canvas rendering, and WebRTC (WHIP) output with a `<video>` preview. Both let you add camera and screen share to the scene. |
| [`web-wasm-nextjs`](./web-wasm-nextjs) | `pnpm dev` | A Next.js app (pinned to 14.2.24 for compatibility with the React version Smelter uses). |

## Learn more

- [Documentation](https://smelter.dev/docs)
- [Guides](https://www.smelter.dev/ts-sdk/guides/quick-start/)
- [Smelter on GitHub](https://github.com/software-mansion/smelter)
- [Discord](https://discord.gg/Cxj3rzTTag)

## Smelter is created by Software Mansion

<a href="https://swmansion.com"><img width="150" height="80" alt="Software Mansion" src="https://github.com/user-attachments/assets/cacd6185-78b0-4e76-8767-016d6389bb2b" /></a>

Since 2012, [Software Mansion](https://swmansion.com) is a software agency with experience in building web and mobile apps as well as complex multimedia solutions. We are Core React Native Contributors and experts in live streaming and broadcasting technologies. We can help you build your next dream product – [Hire us](https://swmansion.com/contact/projects?utm_source=smelter&utm_medium=readme).
