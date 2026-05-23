import React from 'react';

import { PythonBridge } from './python-bridge';
import { Scene } from './Scene';
import { SmelterApp } from './smelter';
import { startHttpServer } from './server';
import { UpdateScheduler } from './update-scheduler';

const HTTP_PORT = 8081;
const PY_WS_PORT = 8082;
const DEFAULT_CATEGORY = 'person';

async function main() {
  const smelter = new SmelterApp({
    whipToken: 'example-cam-token',
    whepToken: 'example-preview-token',
    outputResolution: { width: 1920, height: 1080 },
  });
  const info = await smelter.start(<Scene />);

  console.log('Smelter ready.');
  console.log(`  WHIP push URL : ${info.whipUrl}`);
  console.log(`  WHIP token    : ${info.whipToken}`);
  console.log(`  WHEP pull URL : ${info.whepUrl}`);

  const scheduler = new UpdateScheduler({ getStartTime: () => smelter.startedAt });

  const bridge = new PythonBridge({
    port: PY_WS_PORT,
    socketDir: info.socketDir,
    pythonScript: 'sidecar/sidecar.py',
    initialCategory: DEFAULT_CATEGORY,
    skipPython: process.env.SKIP_PYTHON === '1',
    onYolo: (e) => scheduler.yolo(e),
    onTranscript: (e) => scheduler.transcript(e),
    onDisconnect: () => scheduler.reset(),
  });
  bridge.start();

  await startHttpServer({
    port: HTTP_PORT,
    onCategory: (value) => bridge.setCategory(value),
  });
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
