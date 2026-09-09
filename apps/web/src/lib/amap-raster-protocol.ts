import { addProtocol, removeProtocol } from 'maplibre-gl';
let serial = 0;
export function registerAmapRaster(template: string) {
  if (
    !/^\/api\/data-foundation\/geo\/tiles\/raster\/versions\/[a-f0-9-]{36}\/WebMercatorQuad\/\{z\}\/\{x\}\/\{y\}\.png(?:\?[^#]*)?$/.test(
      template,
    )
  )
    throw new TypeError('Invalid governed raster template');
  const scheme = `wiser-amap-raster-${++serial}`;
  const worker = new Worker(
    new URL('./amap-raster.worker.ts', import.meta.url),
    { type: 'module' },
  );
  const pending = new Map<
    number,
    {
      resolve: (value: { data: ArrayBuffer }) => void;
      reject: (error: Error) => void;
      clean: () => void;
    }
  >();
  let id = 0;
  let disposed = false;
  worker.onmessage = (
    event: MessageEvent<{ id: number; data?: ArrayBuffer; failed?: boolean }>,
  ) => {
    const task = pending.get(event.data.id);
    if (!task) return;
    pending.delete(event.data.id);
    task.clean();
    if (event.data.data) task.resolve({ data: event.data.data });
    else task.reject(new Error('Raster tile unavailable'));
  };
  const failAll = () => {
    for (const task of pending.values()) {
      task.clean();
      task.reject(new Error('Raster worker stopped'));
    }
    pending.clear();
  };
  worker.onerror = failAll;
  addProtocol(
    scheme,
    (request, controller) =>
      new Promise<{ data: ArrayBuffer }>((resolve, reject) => {
        if (disposed || controller.signal.aborted) {
          reject(new DOMException('Aborted', 'AbortError'));
          return;
        }
        const match = new RegExp(`^${scheme}://(\\d+)/(\\d+)/(\\d+)$`).exec(
          request.url,
        );
        if (!match) {
          reject(new Error('Invalid raster tile'));
          return;
        }
        const taskId = ++id;
        const abort = () => {
          pending.delete(taskId);
          worker.postMessage({ id: taskId, cancel: true });
          reject(new DOMException('Aborted', 'AbortError'));
        };
        controller.signal.addEventListener('abort', abort, { once: true });
        pending.set(taskId, {
          resolve,
          reject,
          clean: () => controller.signal.removeEventListener('abort', abort),
        });
        const url = new URL(
          template
            .replace('{z}', match[1])
            .replace('{x}', match[2])
            .replace('{y}', match[3]),
          location.origin,
        ).href;
        worker.postMessage({
          id: taskId,
          url,
          z: Number(match[1]),
          x: Number(match[2]),
          y: Number(match[3]),
        });
      }),
  );
  return {
    url: `${scheme}://{z}/{x}/{y}`,
    dispose() {
      disposed = true;
      removeProtocol(scheme);
      worker.terminate();
      failAll();
    },
  };
}
