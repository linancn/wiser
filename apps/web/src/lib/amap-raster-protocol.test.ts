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
