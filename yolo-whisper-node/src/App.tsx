import { useEffect, useRef, useState } from 'react';
import { connectToWhepServer } from './whep';
import { publishScreenToWhip, publishWebcamToWhip } from './whip';

const WHEP_URL = 'http://127.0.0.1:9000/whep/preview';
const WHIP_URL = 'http://127.0.0.1:9000/whip/cam';
const WHIP_TOKEN = 'example-cam-token';
const WHEP_TOKEN = 'example-preview-token';

// Curated for a developer sitting at their desk — easy to verify on yourself
// plus a few objects you're likely to have within arm's reach. All COCO classes.
const DETECTION_CATEGORIES = ['person', 'cell phone', 'laptop', 'cup', 'bottle', 'book'];

type PublishState = 'idle' | 'starting' | 'live' | 'error';
type Source = 'webcam' | 'screen';

export default function App() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [publishState, setPublishState] = useState<PublishState>('idle');
  const [publishError, setPublishError] = useState<string | null>(null);
  const [activeSource, setActiveSource] = useState<Source | null>(null);
  const [category, setCategory] = useState('person');
  const stopPublishRef = useRef<(() => void) | null>(null);
  // Some browsers GC an RTCPeerConnection that isn't held by a strong
  // reachable reference and tear down the underlying transport, killing the
  // stream silently. The ref keeps the PC alive for the component's lifetime.
  const whepPcRef = useRef<RTCPeerConnection | null>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const result = await connectToWhepServer(WHEP_URL, WHEP_TOKEN);
        if (cancelled) {
          result.close();
          return;
        }
        whepPcRef.current = result.pc;
        if (videoRef.current) {
          videoRef.current.srcObject = result.stream;
          await videoRef.current.play().catch(() => {});
        }
      } catch (err) {
        console.error('WHEP connect failed', err);
      }
    })();

    return () => {
      cancelled = true;
      whepPcRef.current?.close();
      whepPcRef.current = null;
    };
  }, []);

  const startPublish = async (source: Source) => {
    setPublishState('starting');
    setPublishError(null);
    setActiveSource(source);
    const publisher = source === 'webcam' ? publishWebcamToWhip : publishScreenToWhip;
    try {
      const stop = await publisher(WHIP_URL, WHIP_TOKEN);
      stopPublishRef.current = stop;
      setPublishState('live');
    } catch (err) {
      console.error(err);
      setPublishError(err instanceof Error ? err.message : String(err));
      setPublishState('error');
      setActiveSource(null);
    }
  };

  const stopPublish = () => {
    stopPublishRef.current?.();
    stopPublishRef.current = null;
    setPublishState('idle');
    setActiveSource(null);
  };

  const updateCategory = async (next: string) => {
    setCategory(next);
    try {
      await fetch('/api/category', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ value: next }),
      });
    } catch (err) {
      console.error('failed to update category', err);
    }
  };

  return (
    <div style={{ maxWidth: 1024, margin: '0 auto', padding: 24 }}>
      <h1 style={{ marginTop: 0 }}>Smelter + YOLO + Whisper</h1>

      <div style={{ position: 'relative', background: '#000', aspectRatio: '16 / 9' }}>
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          controls
          style={{ width: '100%', height: '100%', objectFit: 'contain' }}
        />
      </div>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 16 }}>
        {publishState !== 'live' ? (
          <>
            <button onClick={() => startPublish('webcam')} disabled={publishState === 'starting'}>
              {publishState === 'starting' && activeSource === 'webcam'
                ? 'Starting…'
                : 'Start webcam'}
            </button>
            <button onClick={() => startPublish('screen')} disabled={publishState === 'starting'}>
              {publishState === 'starting' && activeSource === 'screen'
                ? 'Starting…'
                : 'Start screenshare'}
            </button>
          </>
        ) : (
          <button onClick={stopPublish}>
            Stop {activeSource === 'screen' ? 'screenshare' : 'webcam'}
          </button>
        )}

        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          Detect:
          <select value={category} onChange={(e) => void updateCategory(e.target.value)}>
            {DETECTION_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
      </div>

      {publishError && <p style={{ color: '#ff8080' }}>Publish error: {publishError}</p>}

      <p style={{ opacity: 0.7, fontSize: 14, marginTop: 24 }}>
        Press <b>Start webcam</b> to publish your camera + mic, or <b>Start screenshare</b> to
        share a screen / window / tab. For screenshare, pick a tab and tick "Share tab audio" if
        you want Whisper to transcribe the tab's audio. The composed view above is the WHEP
        stream coming back, with YOLO boxes and Whisper transcript rendered server-side by
        Smelter. The dropdown switches which COCO class Python looks for.
      </p>
    </div>
  );
}
