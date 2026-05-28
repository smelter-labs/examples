import { detectionsStore, transcriptStore } from './state';
import type { YoloEvent, TranscriptEvent } from './python-bridge';

export type UpdateSchedulerOptions = {
  // Wall-clock time captured at smelter.start(), used as the pts=0 origin.
  // Returns null until smelter is up; in that case events are applied
  // immediately rather than dropped on the floor.
  getStartTime: () => number | null;
};

// Floor on how long a subtitle stays on screen — prevents set + clear in the
// same JS tick if `event.duration` is somehow zero / tiny.
const SUBTITLE_LINGER_MS = 500;

export class UpdateScheduler {
  private opts: UpdateSchedulerOptions;
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private lastYoloTs = -Infinity;
  private lastTranscriptTs = -Infinity;

  constructor(opts: UpdateSchedulerOptions) {
    this.opts = opts;
  }

  yolo(event: YoloEvent): void {
    this.scheduleAt(event.ts, () => {
      if (event.ts <= this.lastYoloTs) return;
      this.lastYoloTs = event.ts;
      detectionsStore.set(event.boxes);
    });
  }

  transcript(event: TranscriptEvent): void {
    this.scheduleAt(event.ts, () => {
      if (event.ts <= this.lastTranscriptTs) return;
      this.lastTranscriptTs = event.ts;
      transcriptStore.set(event.text);
      this.scheduleClear(event);
    });
  }

  private scheduleClear(event: TranscriptEvent): void {
    // `event.duration` is "how long to keep the caption on screen after it
    // appears". The sliding-window sidecar always emits events whose audio
    // pts is several seconds in the past, so an audio-pts-anchored clear
    // (start + ts + duration) would be in the past on arrival and trigger
    // the linger floor. Anchoring to now matches the user-perceived semantic.
    const targetWallMs = Date.now() + Math.max(event.duration, SUBTITLE_LINGER_MS);
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      // Only clear if no newer transcript has been applied in the meantime —
      // otherwise we'd wipe a still-current subtitle.
      if (this.lastTranscriptTs === event.ts) transcriptStore.set('');
    }, targetWallMs - Date.now());
    this.timers.add(timer);
  }

  reset(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    this.lastYoloTs = -Infinity;
    this.lastTranscriptTs = -Infinity;
    detectionsStore.set([]);
  }

  private scheduleAt(streamTsMs: number, run: () => void): void {
    const start = this.opts.getStartTime();
    if (start === null) {
      run();
      return;
    }
    const wait = start + streamTsMs - Date.now();
    if (wait <= 0) {
      run();
      return;
    }
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      run();
    }, wait);
    this.timers.add(timer);
  }
}
