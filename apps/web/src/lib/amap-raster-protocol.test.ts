import { expect, it, vi } from 'vitest';
import { registerAmapRaster } from './amap-raster-protocol';
import { addProtocol, removeProtocol } from 'maplibre-gl';
vi.mock('maplibre-gl', () => ({
  addProtocol: vi.fn(),
  removeProtocol: vi.fn(),
}));
it('pins the source to an authorized same-origin version and aborts worker tasks on disposal', async () => {
  const worker = {
    postMessage: vi.fn(),
    terminate: vi.fn(),
    onmessage: null,
    onerror: null,
  };
  const Worker = vi.fn(function () {
    return worker;
  });
  vi.stubGlobal('Worker', Worker);
  vi.stubGlobal(
    'location',
    new URL('https://wiser.test/zh-CN/data-foundation/map'),
  );
  expect(() =>
    registerAmapRaster('https://foreign.test/{z}/{x}/{y}.png'),
  ).toThrow();
  const template =
    '/api/data-foundation/geo/tiles/raster/versions/3c9220e3-a5dc-5254-b134-4cc0f6944108/WebMercatorQuad/{z}/{x}/{y}.png';
  const protocol = registerAmapRaster(template);
  const handler = vi.mocked(addProtocol).mock.calls.at(-1)![1];
  const url = protocol.url
    .replace('{z}', '8')
    .replace('{x}', '210')
    .replace('{y}', '97');
  const controller = new AbortController();
  const task = handler({ url }, controller);
  const rejected = expect(task).rejects.toThrow();
  controller.abort();
  await rejected;
  expect(worker.postMessage).toHaveBeenCalledWith(
    expect.objectContaining({ cancel: true }),
  );
  const outstanding = handler({ url }, new AbortController());
  const disposed = expect(outstanding).rejects.toThrow();
  protocol.dispose();
  await disposed;
  expect(worker.terminate).toHaveBeenCalledOnce();
  expect(removeProtocol).toHaveBeenCalled();
  vi.unstubAllGlobals();
});

it('settles successful, failed and stale replies and rejects requests after worker failure or disposal', async () => {
  const worker: {
    postMessage: ReturnType<typeof vi.fn>;
    terminate: ReturnType<typeof vi.fn>;
    onmessage:
      | ((event: {
          data: { id: number; data?: ArrayBuffer; failed?: boolean };
        }) => void)
      | null;
    onerror: (() => void) | null;
  } = {
    postMessage: vi.fn(),
    terminate: vi.fn(),
    onmessage: null,
    onerror: null,
  };
  vi.stubGlobal(
    'Worker',
    vi.fn(function () {
      return worker;
    }),
  );
  vi.stubGlobal('location', new URL('https://wiser.test'));
  const protocol = registerAmapRaster(
    '/api/data-foundation/geo/tiles/raster/versions/3c9220e3-a5dc-5254-b134-4cc0f6944108/WebMercatorQuad/{z}/{x}/{y}.png',
  );
  const handler = vi.mocked(addProtocol).mock.calls.at(-1)![1];
  const url = protocol.url
    .replace('{z}', '1')
    .replace('{x}', '0')
    .replace('{y}', '0');
  const value = handler({ url }, new AbortController());
  const id = (worker.postMessage.mock.calls.at(-1)![0] as { id: number }).id;
  const data = new ArrayBuffer(4);
  worker.onmessage?.({ data: { id, data } });
  await expect(value).resolves.toEqual({ data });
  worker.onmessage?.({ data: { id, failed: true } });
  const failure = handler({ url }, new AbortController());
  const rejected = expect(failure).rejects.toThrow('Raster tile unavailable');
  worker.onmessage?.({ data: { id: id + 1, failed: true } });
  await rejected;
  await expect(
    handler({ url: 'https://foreign.test' }, new AbortController()),
  ).rejects.toThrow('Invalid raster tile');
  const aborted = new AbortController();
  aborted.abort();
  await expect(handler({ url }, aborted)).rejects.toThrow();
  const pending = handler({ url }, new AbortController());
  const stopped = expect(pending).rejects.toThrow('Raster worker stopped');
  worker.onerror?.();
  await stopped;
  protocol.dispose();
  await expect(handler({ url }, new AbortController())).rejects.toThrow();
  vi.unstubAllGlobals();
});
