# `node-minimal`

Minimal real-time example for `@swmansion/smelter-node`. Smelter composes a
scene (a sample video with a title and a live clock) and streams it over RTMP. A
small development helper previews that stream locally with `ffplay`.

The whole app is in [`src/index.tsx`](./src/index.tsx).

## Requirements

- `ffmpeg` and `ffplay` on your `PATH` (used only for the local preview).

## Run

```bash
pnpm install
pnpm start
```

An `ffplay` window opens showing the live output. Press `Ctrl+C` to stop.

## How it works

The app starts a live `Smelter` instance and registers an `rtmp_client` output
pointing at `rtmp://127.0.0.1:8001`. The `ffplayStartPlayerAsync` helper in
[`src/smelterFfplayHelper.ts`](./src/smelterFfplayHelper.ts) spins up a local
RTMP server with `ffmpeg` and pipes it into `ffplay`.

The `LocallySpawnedInstanceManager` is configured with `workingdir: '.smelter'`
so the Smelter server keeps its working files (downloaded assets, temp data)
inside the project rather than the system temp dir.

For production, remove the helper and point the output `url` at your real RTMP
destination (e.g. YouTube or Twitch).
