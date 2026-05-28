import path from 'node:path';
import fs from 'node:fs';

import { OfflineSmelter } from '@swmansion/smelter-node';
import { View, Text, Rescaler, Mp4, SlideShow, Slide } from '@swmansion/smelter';

// MP4 files to stitch together, passed as CLI arguments:
//
//   pnpm start ./intro.mp4 ./talk.mp4 ./outro.mp4
//
// Arguments can be local file paths or URLs. When none are provided we fall
// back to a couple of sample clips hosted by Smelter so the example runs with
// zero setup.
const DEFAULT_SOURCES = [
  'https://smelter.dev/videos/template-scene-race.mp4',
  'https://smelter.dev/videos/template-scene-gameplay.mp4',
];

const OUTPUT_PATH = './output.mp4';

function toSource(arg: string): string {
  if (arg.startsWith('http://') || arg.startsWith('https://')) {
    return arg;
  }
  return path.resolve(arg);
}

// Last path segment of a local path or URL, e.g. "template-scene-race.mp4".
function labelFor(source: string): string {
  return path.basename(source);
}

function App({ sources }: { sources: string[] }) {
  return (
    <View style={{ backgroundColor: '#161127' }}>
      <SlideShow>
        {sources.map((source) => (
          // Each slide stays on screen until its Mp4 finishes playing, so the
          // clips are rendered back-to-back into a single continuous output.
          <Slide key={source}>
            <Rescaler>
              <Mp4 source={source} />
            </Rescaler>
            <View
              style={{
                bottom: 40,
                left: 40,
                width: 800,
                height: 60,
                padding: 20,
                backgroundColor: '#161127',
                borderRadius: 16,
              }}
            >
              <Text style={{ fontSize: 40, color: '#FFFFFF' }}>{labelFor(source)}</Text>
            </View>
          </Slide>
        ))}
      </SlideShow>
    </View>
  );
}

async function run() {
  const sources = process.argv.slice(2).map(toSource);
  const resolved = sources.length > 0 ? sources : DEFAULT_SOURCES;

  console.log(`Concatenating ${resolved.length} file(s):`);
  resolved.forEach((source, i) => console.log(`  ${i + 1}. ${source}`));

  if (fs.existsSync(OUTPUT_PATH)) {
    fs.unlinkSync(OUTPUT_PATH);
  }

  const smelter = new OfflineSmelter();
  await smelter.init();

  console.log('Rendering (this might take a while) ...');
  await smelter.render(<App sources={resolved} />, {
    type: 'mp4',
    serverPath: OUTPUT_PATH,
    video: {
      encoder: {
        // 'ultrafast' is good for development. For production renders pick a
        // slower (higher quality) preset, e.g. 'medium'.
        type: 'ffmpeg_h264',
        preset: 'ultrafast',
      },
      resolution: { width: 1920, height: 1080 },
    },
    audio: {
      channels: 'stereo',
      encoder: { type: 'aac' },
    },
  });

  console.log(`Done. Output written to ${path.resolve(OUTPUT_PATH)}`);
}

void run();
