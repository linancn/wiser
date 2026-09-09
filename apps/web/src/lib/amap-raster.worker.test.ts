import type * as RasterModule from './amap-raster';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mapping = vi.hoisted(() => vi.fn(() => new Float64Array([0.5, 0.5])));
vi.mock('./amap-raster', async (original) => ({
  ...(await original<typeof RasterModule>()),
  rasterMapping: mapping,
}));
const url =
  'https://wiser.test/api/data-foundation/geo/tiles/raster/versions/3c9220e3-a5dc-5254-b134-4cc0f6944108/WebMercatorQuad/5/0/0.png';
let host: {
  location: URL;
  onmessage: ((event: { data: unknown }) => void) | null;
  postMessage: ReturnType<typeof vi.fn>;
};
let fetch: ReturnType<typeof vi.fn<typeof globalThis.fetch>>;
let bitmap: { width: number; height: number; close: ReturnType<typeof vi.fn> };
let written: Uint8ClampedArray;
function send(data: Record<string, unknown> = {}) {
  host.onmessage!({ data: { id: 1, url, z: 5, x: 0, y: 0, ...data } });
}
beforeEach(async () => {
  vi.resetModules();
  mapping.mockReturnValue(new Float64Array([0.5, 0.5]));
  host = {
    location: new URL('https://wiser.test/'),
    onmessage: null,
    postMessage: vi.fn(),
  };
  bitmap = { width: 256, height: 256, close: vi.fn() };
  fetch = vi.fn<typeof globalThis.fetch>(() =>
    Promise.resolve(new Response(new Blob(['png']), { status: 200 })),
  );
  vi.stubGlobal('self', host);
  vi.stubGlobal('fetch', fetch);
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(() => Promise.resolve(bitmap)),
  );
  vi.stubGlobal(
    'OffscreenCanvas',
    class {
      getContext() {
        return {
          drawImage() {},
          getImageData() {
            return { data: new Uint8ClampedArray([10, 20, 30, 255]) };
          },
          createImageData() {
            return { data: new Uint8ClampedArray(256 * 256 * 4) };
          },
          putImageData(image: { data: Uint8ClampedArray }) {
            written = image.data;
          },
        };
      }
      convertToBlob() {
        return Promise.resolve(new Blob(['encoded']));
      }
    },
  );
  await import('./amap-raster.worker');
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
it('returns encoded pixels from authorized source tiles and preserves transparent out-of-world samples', async () => {
  mapping.mockReturnValue(
    new Float64Array([0.5, 0.5, -1, 0.5, 0.5, -1, 8192, 0.5, 0.5, 8192]),
  );
  send();
  await vi.waitFor(() => expect(host.postMessage).toHaveBeenCalled());
  expect([...written.slice(0, 8)]).toEqual([10, 20, 30, 255, 0, 0, 0, 0]);
  expect(fetch).toHaveBeenCalledOnce();
  expect(fetch.mock.calls[0][1]).toMatchObject({
    credentials: 'same-origin',
    cache: 'no-store',
  });
  expect(bitmap.close).toHaveBeenCalledOnce();
  expect(host.postMessage.mock.calls[0][0]).toMatchObject({
    id: 1,
    data: expect.any(ArrayBuffer) as unknown,
  });
});
it.each([
  { url: 'https://foreign.test/a.png' },
  { url: 'https://wiser.test/private.png' },
])('rejects ungoverned sources before a network request: %j', async (data) => {
  send(data);
  await vi.waitFor(() =>
    expect(host.postMessage).toHaveBeenCalledWith({ id: 1, failed: true }),
  );
  expect(fetch).not.toHaveBeenCalled();
});
it.each(['denied', 'oversized', 'width', 'height'] as const)(
  'fails closed for %s source responses',
  async (kind) => {
    if (kind === 'denied')
      fetch.mockResolvedValue(new Response(null, { status: 403 }));
    if (kind === 'oversized')
      fetch.mockResolvedValue(
        new Response(new Uint8Array(8 * 1024 * 1024 + 1)),
      );
    if (kind === 'width') bitmap.width = 512;
    if (kind === 'height') bitmap.height = 512;
    send();
    await vi.waitFor(() =>
      expect(host.postMessage).toHaveBeenCalledWith({ id: 1, failed: true }),
    );
    if (kind === 'width' || kind === 'height')
      expect(bitmap.close).toHaveBeenCalledOnce();
  },
);
it('bounds fanout before issuing adjacent tile requests', async () => {
  mapping.mockReturnValue(
    new Float64Array(
      Array.from({ length: 17 }, (_, x) => [x * 256 + 0.5, 0.5]).flat(),
    ),
  );
  send();
  await vi.waitFor(() =>
    expect(host.postMessage).toHaveBeenCalledWith({ id: 1, failed: true }),
  );
  expect(fetch).not.toHaveBeenCalled();
});
it('cancels pending I/O without publishing an obsolete tile or an error', async () => {
  fetch.mockImplementation(
    (_input, init) =>
      new Promise((_resolve, reject) =>
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('Aborted', 'AbortError')),
        ),
      ),
  );
  send();
  expect(fetch).toHaveBeenCalledOnce();
  send({ cancel: true });
  send({ id: 999, cancel: true });
  expect(fetch.mock.calls[0][1]?.signal?.aborted).toBe(true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(host.postMessage).not.toHaveBeenCalled();
});
