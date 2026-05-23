import { spawn } from 'node:child_process';

import { WebSocketServer, type WebSocket } from 'ws';
import { z } from 'zod';

const detectionSchema = z.object({
  label: z.string(),
  confidence: z.number(),
  // Normalized coordinates in [0, 1].
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
  // Optional stable tracker id — present when the Python sidecar runs
  // model.track() instead of model.predict(). Used by Scene.tsx to give
  // each box a stable smelter component id so transforms interpolate.
  trackId: z.number().int().nullable().optional(),
});

const yoloEventSchema = z.object({
  type: z.literal('yolo'),
  boxes: z.array(detectionSchema),
  ts: z.number(), // stream pts in ms
});

const transcriptEventSchema = z.object({
  type: z.literal('transcript'),
  text: z.string(),
  ts: z.number(), // stream pts in ms — start of the transcribed audio window
  duration: z.number(), // ms — length of the audio window the text covers
});

const pythonEventSchema = z.discriminatedUnion('type', [yoloEventSchema, transcriptEventSchema]);

export type Detection = z.infer<typeof detectionSchema>;
export type YoloEvent = z.infer<typeof yoloEventSchema>;
export type TranscriptEvent = z.infer<typeof transcriptEventSchema>;

export type PythonBridgeOptions = {
  port: number;
  socketDir: string;
  pythonScript: string;
  initialCategory: string;
  skipPython?: boolean;
  onYolo: (event: YoloEvent) => void;
  onTranscript: (event: TranscriptEvent) => void;
  onDisconnect?: () => void;
};

export class PythonBridge {
  private opts: PythonBridgeOptions;
  private currentCategory: string;
  private ws: WebSocket | null = null;

  constructor(opts: PythonBridgeOptions) {
    this.opts = opts;
    this.currentCategory = opts.initialCategory;
  }

  start(): void {
    this.startWsServer();
    this.spawnSidecar();
  }

  setCategory(value: string): void {
    this.currentCategory = value;
    this.send({ type: 'setCategory', value });
  }

  private send(msg: object): void {
    if (this.ws && this.ws.readyState === this.ws.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private startWsServer(): void {
    const wss = new WebSocketServer({ port: this.opts.port, host: '127.0.0.1' });
    wss.on('connection', (ws) => {
      if (this.ws && this.ws.readyState === this.ws.OPEN) {
        console.warn('[ws] rejecting second python connection');
        ws.close(1013, 'already connected');
        return;
      }
      this.ws = ws;
      console.log('[ws] python connected');
      ws.send(JSON.stringify({ type: 'setCategory', value: this.currentCategory }));

      ws.on('message', (raw) => this.handleMessage(raw.toString()));
      ws.on('close', () => {
        console.log('[ws] python disconnected');
        if (this.ws === ws) this.ws = null;
        this.opts.onDisconnect?.();
      });
      ws.on('error', (err) => console.error('[ws] error', err));
    });
    console.log(`Python WS listening on :${this.opts.port}`);
  }

  private handleMessage(raw: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      console.warn('[ws] non-JSON message dropped');
      return;
    }
    const result = pythonEventSchema.safeParse(parsed);
    if (!result.success) {
      console.warn('[ws] invalid python message dropped:', result.error.issues);
      return;
    }
    const event = result.data;
    if (event.type === 'yolo') this.opts.onYolo(event);
    else this.opts.onTranscript(event);
  }

  private spawnSidecar(): void {
    if (this.opts.skipPython) {
      console.log(
        'SKIP_PYTHON=1 set — start sidecar manually with the same SMELTER_SIDE_CHANNEL_SOCKET_DIR',
      );
      console.log(`  export SMELTER_SIDE_CHANNEL_SOCKET_DIR=${this.opts.socketDir}`);
      console.log(`  python3 ${this.opts.pythonScript}`);
      return;
    }
    const py = spawn('python3', ['-u', this.opts.pythonScript], {
      stdio: 'inherit',
      env: {
        ...process.env,
        SMELTER_SIDE_CHANNEL_SOCKET_DIR: this.opts.socketDir,
        NODE_WS_URL: `ws://127.0.0.1:${this.opts.port}`,
      },
    });
    py.on('exit', (code) => console.log(`[python] exited with code ${code}`));
    process.on('SIGINT', () => {
      py.kill('SIGINT');
      process.exit(0);
    });
  }
}
