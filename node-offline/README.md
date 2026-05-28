# `node-offline`

Minimal offline-processing example for `@swmansion/smelter-node`. It stitches
one or more MP4 files together, back-to-back, into a single `output.mp4`.

The whole app is a single file: [`src/index.tsx`](./src/index.tsx).

## Run

```bash
pnpm install
pnpm start
```

With no arguments it renders two sample clips hosted by Smelter, so it works
with zero setup. To concatenate your own files, pass them as arguments (local
paths or URLs):

```bash
pnpm start ./intro.mp4 ./talk.mp4 ./outro.mp4
```

The result is written to `./output.mp4`.

## How it works

Each input is wrapped in a `<Slide>` inside a `<SlideShow>`. A slide that
contains an `<Mp4>` stays on screen until that clip finishes, so the clips play
one after another and are rendered into one continuous file. `OfflineSmelter`
renders as fast as the machine allows rather than in real time.
