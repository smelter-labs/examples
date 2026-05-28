import React, { useEffect, useState } from 'react';
import { InputStream, Rescaler, Text, View } from '@swmansion/smelter';

import { detectionsStore, transcriptStore, type Detection } from './state';

const OUTPUT_W = 1920;
const OUTPUT_H = 1080;

// Subtitle is rendered into an internal 4× canvas and then fit back into the
// visible box by a Rescaler. Lets us use large internal font/line-height values
// (which kerns and word-wraps more cleanly) and scales the result to the actual
// 1× pixels — same trick the Python example uses.
const SUBTITLE_MARGIN_X = 160;
const SUBTITLE_W = OUTPUT_W - 2 * SUBTITLE_MARGIN_X;
const SUBTITLE_H = 120;
const SUBTITLE_SCALE = 4;

export function Scene() {
  const detections = useStore(detectionsStore);
  const transcript = useStore(transcriptStore);

  return (
    <View style={{ width: OUTPUT_W, height: OUTPUT_H }}>
      <Rescaler>
        <InputStream inputId="cam" />
      </Rescaler>

      {detections.map((d, i) => (
        <DetectionBox key={d.trackId != null ? `det-${d.trackId}` : `anon-${i}`} detection={d} />
      ))}

      {transcript ? <Subtitle text={transcript} /> : null}
    </View>
  );
}

function Subtitle({ text }: { text: string }) {
  return (
    <View
      style={{
        backgroundColor: '#000000EE',
        borderRadius: 24,
        paddingHorizontal: 80,
        left: 40,
        bottom: 40,
        width: SUBTITLE_W,
        height: SUBTITLE_H,
        overflow: 'hidden',
      }}
    >
      <Rescaler>
        <View
          style={{
            width: SUBTITLE_W * SUBTITLE_SCALE,
            height: SUBTITLE_H * SUBTITLE_SCALE,
            direction: 'column',
          }}
        >
          <View />
          <Text
            style={{
              width: SUBTITLE_W * SUBTITLE_SCALE,
              fontSize: 40 * SUBTITLE_SCALE,
              lineHeight: 50 * SUBTITLE_SCALE,
              color: '#FFFFFFFF',
              align: 'center',
              wrap: 'word',
            }}
          >
            {text}
          </Text>
          <View />
        </View>
      </Rescaler>
    </View>
  );
}

function DetectionBox({ detection }: { detection: Detection }) {
  const left = Math.round(detection.x * OUTPUT_W);
  const top = Math.round(detection.y * OUTPUT_H);
  const width = Math.max(2, Math.round(detection.w * OUTPUT_W));
  const height = Math.max(2, Math.round(detection.h * OUTPUT_H));
  const idPart = detection.trackId != null ? `#${detection.trackId} ` : '';
  const label = `${idPart}${detection.label} ${detection.confidence.toFixed(2)}`;
  // Stable per-track id lets smelter interpolate the View's transform between
  // scene updates instead of snapping. Without a trackId there's nothing to
  // pair across frames, so leave id undefined.
  const id = detection.trackId != null ? `det-${detection.trackId}` : undefined;

  return (
    <View
      id={id}
      transition={{ durationMs: 100 }}
      style={{
        left,
        top,
        width,
        height,
        borderWidth: 4,
        borderColor: '#00FF88FF',
        borderRadius: 6,
      }}
    >
      <View
        style={{
          left: 0,
          top: 0,
          width: Math.min(width, 260),
          height: 36,
          backgroundColor: '#00FF88EE',
          paddingHorizontal: 8,
        }}
      >
        <Text style={{ fontSize: 24, color: '#000000FF' }}>{label}</Text>
      </View>
    </View>
  );
}

function useStore<T>(store: { get: () => T; subscribe: (fn: () => void) => () => void }): T {
  const [value, setValue] = useState(store.get());
  useEffect(() => store.subscribe(() => setValue(store.get())), [store]);
  return value;
}
