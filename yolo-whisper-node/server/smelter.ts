import type React from 'react';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Smelter from '@swmansion/smelter-node';

export type SmelterAppConfig = {
  whipToken: string;
  whepToken: string;
  // The side channel buffer is delayed by this many ms so the Python sidecar has
  // time to run YOLO / Whisper before the corresponding frame is rendered out.
  sideChannelDelayMs?: number;
  outputResolution?: { width: number; height: number };
};

export type SmelterAppInfo = {
  whipUrl: string;
  whipToken: string;
  whepUrl: string;
  socketDir: string;
  startedAt: number;
};

export class SmelterApp {
  private readonly socketDir: string;
  private readonly cfg: SmelterAppConfig;
  private _startedAt: number | null = null;
  // Exposed so the UpdateScheduler can convert audio/video pts (which is what
  // the sidecar emits) into the wall-clock time when smelter actually renders
  // that pts out to WHEP — that render moment is offset by this delay.
  readonly sideChannelDelayMs: number;

  constructor(cfg: SmelterAppConfig) {
    this.cfg = cfg;
    this.sideChannelDelayMs = cfg.sideChannelDelayMs ?? 12000;
    this.socketDir = mkdtempSync(join(tmpdir(), 'smelter-sidechan-'));
    process.env.SMELTER_SIDE_CHANNEL_SOCKET_DIR = this.socketDir;
    process.env.SMELTER_SIDE_CHANNEL_DELAY_MS = String(this.sideChannelDelayMs);
    // Best-effort cleanup of the unix-socket scratch dir on Ctrl-C.
    process.on('SIGINT', () => {
      try {
        rmSync(this.socketDir, { recursive: true, force: true });
      } catch {
        // ignore — process is exiting anyway
      }
    });
  }

  get startedAt(): number | null {
    return this._startedAt;
  }

  async start(scene: React.ReactElement): Promise<SmelterAppInfo> {
    const smelter = new Smelter();
    await smelter.init();

    await smelter.registerOutput('preview', scene, {
      type: 'whep_server',
      bearerToken: this.cfg.whepToken,
      video: {
        encoder: { type: 'ffmpeg_h264', preset: 'ultrafast' },
        resolution: this.cfg.outputResolution ?? { width: 1280, height: 720 },
      },
      audio: { encoder: { type: 'opus' } },
    });

    const cam = await smelter.registerInput('cam', {
      type: 'whip_server',
      bearerToken: this.cfg.whipToken,
      sideChannel: { video: true, audio: true },
    });

    await smelter.start();
    this._startedAt = Date.now();

    return {
      whipUrl: `http://127.0.0.1:9000${cam.endpointRoute}`,
      whipToken: cam.bearerToken ?? this.cfg.whipToken,
      whepUrl: `http://127.0.0.1:9000/whep/preview`,
      socketDir: this.socketDir,
      startedAt: this._startedAt,
    };
  }
}
