import { useEffect, useState } from 'react';
import Smelter from '@swmansion/smelter-node';
import { View, Text, Rescaler, Mp4 } from '@swmansion/smelter';

import { ffplayStartPlayerAsync } from './smelterFfplayHelper';

const RTMP_PORT = 8001;
const SAMPLE_VIDEO = 'https://smelter.dev/videos/template-scene-race.mp4';

function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <View
      style={{
        bottom: 40,
        right: 40,
        width: 320,
        height: 60,
        backgroundColor: '#161127',
        borderRadius: 16,
        padding: 20,
      }}
    >
      <Text
        style={{
          width: 320,
          align: 'center',
          fontSize: 48,
          color: '#F24664',
        }}
      >
        {now.toLocaleTimeString()}
      </Text>
    </View>
  );
}

function App() {
  return (
    <View style={{ backgroundColor: '#161127' }}>
      <Rescaler>
        <Mp4 source={SAMPLE_VIDEO} />
      </Rescaler>
      <View
        style={{
          top: 40,
          left: 40,
          width: 720,
          height: 70,
          backgroundColor: '#161127',
          padding: 20,
          borderRadius: 16,
        }}
      >
        <Text style={{ width: 720, align: 'center', fontSize: 60, color: '#FFFFFF' }}>
          Live via RTMP
        </Text>
      </View>
      <Clock />
    </View>
  );
}

async function run() {
  const smelter = new Smelter();
  await smelter.init();

  // Development-only preview. Starts an RTMP server and opens ffplay.
  // Remove this and point `url` at your real RTMP destination for production.
  await ffplayStartPlayerAsync(RTMP_PORT);

  await smelter.registerOutput('output_1', <App />, {
    type: 'rtmp_client',
    url: `rtmp://127.0.0.1:${RTMP_PORT}`,
    video: {
      encoder: { type: 'ffmpeg_h264', preset: 'veryfast' },
      resolution: { width: 1920, height: 1080 },
    },
  });

  await smelter.start();
}

void run();
