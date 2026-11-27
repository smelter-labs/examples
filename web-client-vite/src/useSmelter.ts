import Smelter from '@swmansion/smelter-web-client';
import { useEffect, useRef, useState } from 'react';

export function useSmelter(url: string): Smelter | undefined {
  const [smelter, setSmelter] = useState<Smelter>();
  // `smelter.init()` resets the Smelter server, and the server rejects a reset
  // with 409 while another one is still in progress. Each new client waits
  // until the previous one created by this hook is torn down, so resets never
  // overlap (e.g. when React StrictMode runs the effect twice in development).
  const previousTeardown = useRef<Promise<void>>(Promise.resolve());
  useEffect(() => {
    let cancel = false;
    let instance: Smelter | undefined;

    const waitForPrevious = previousTeardown.current;
    const promise = (async () => {
      await waitForPrevious;
      if (cancel) {
        return;
      }
      instance = new Smelter({ url });
      await instance.init();
      await instance.start();
      if (!cancel) {
        setSmelter(instance);
      }
    })();
    promise.catch((err) => {
      if (!cancel) {
        console.error('Failed to connect to Smelter.', err);
      }
    });

    return () => {
      cancel = true;
      previousTeardown.current = (async () => {
        await promise.catch(() => { });
        await instance?.terminate();
      })().catch(() => { });
    };
  }, [url]);
  return smelter;
}
