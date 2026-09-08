import {
  validGraphPositions,
  type GraphLayoutInput,
  type GraphPosition,
} from './graph-layout-types';

export function layoutGraph(
  input: GraphLayoutInput,
  signal: AbortSignal,
): Promise<GraphPosition[]> {
  if (signal.aborted)
    return Promise.reject(new DOMException('Layout cancelled', 'AbortError'));
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL('../workers/graph-layout.worker.ts', import.meta.url),
      { type: 'module', name: 'wiser-graph-layout' },
    );
    const clean = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      worker.terminate();
    };
    const fail = () => {
      clean();
      reject(new Error('Layout unavailable'));
    };
    const abort = () => {
      clean();
      reject(new DOMException('Layout cancelled', 'AbortError'));
    };
    const timer = setTimeout(fail, 10000);
    signal.addEventListener('abort', abort, { once: true });
    worker.onmessage = (event: MessageEvent<unknown>) => {
      if (!validGraphPositions(event.data, input)) {
        fail();
        return;
      }
      clean();
      resolve(event.data);
    };
    worker.onerror = fail;
    worker.onmessageerror = fail;
    try {
      worker.postMessage(input);
    } catch {
      fail();
    }
  });
}
