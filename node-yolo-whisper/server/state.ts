import type { Detection } from './python-bridge';
export type { Detection };

function createStore<T>(initial: T) {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set: (next: T) => {
      value = next;
      for (const l of listeners) l();
    },
    subscribe: (fn: () => void) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

export const detectionsStore = createStore<Detection[]>([]);
export const transcriptStore = createStore<string>('');
