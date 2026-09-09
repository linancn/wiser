import { rasterMapping, sampleRaster } from './amap-raster';
const active = new Map<number, AbortController>();
// Only version-bound same-origin API tiles are accepted. No persistent tile cache:
// identity/permission changes must be checked again on every new map request.
self.onmessage = (
  event: MessageEvent<{
    id: number;
    cancel?: boolean;
    url: string;
    z: number;
    x: number;
    y: number;
  }>,
) => {
  const { id, url, z, x, y, cancel } = event.data;
  if (cancel) {
    active.get(id)?.abort();
    active.delete(id);
    return;
  }
  const controller = new AbortController();
  active.set(id, controller);
  void (async () => {
    try {
      const source = new URL(url);
      const path =
        /^(\/api\/data-foundation\/geo\/tiles\/raster\/versions\/[a-f0-9-]{36}\/WebMercatorQuad\/)\d+\/\d+\/\d+\.png$/.exec(
          source.pathname,
        );
      if (source.origin !== self.location.origin || !path)
        throw new Error('Invalid source');
      const mapping = rasterMapping(z, x, y);
      const coordinates = new Map<string, [number, number]>();
      for (let i = 0; i < mapping.length; i += 2) {
        const tx = Math.floor(mapping[i] / 256),
          ty = Math.floor(mapping[i + 1] / 256);
        if (tx >= 0 && ty >= 0 && tx < 2 ** z && ty < 2 ** z)
          coordinates.set(`${tx}/${ty}`, [tx, ty]);
      }
      if (coordinates.size > 16)
        throw new Error('Raster request exceeds display bound');
      const pixels = new Map<string, Uint8ClampedArray>();
      const queue = [...coordinates.entries()];
      // At most four adjacent source requests per output tile run concurrently.
      await Promise.all(
        Array.from({ length: Math.min(4, queue.length) }, async () => {
          while (queue.length) {
            controller.signal.throwIfAborted();
            const [key, [tx, ty]] = queue.shift()!;
            const tileUrl = new URL(source);
            tileUrl.pathname = `${path[1]}${z}/${tx}/${ty}.png`;
            const response = await fetch(tileUrl, {
              credentials: 'same-origin',
              cache: 'no-store',
              signal: controller.signal,
            });
            if (!response.ok) throw new Error('Raster unavailable');
            const blob = await response.blob();
            if (blob.size > 8 * 1024 * 1024)
              throw new Error('Raster too large');
            const bitmap = await createImageBitmap(blob);
            if (bitmap.width !== 256 || bitmap.height !== 256) {
              bitmap.close();
              throw new Error('Unexpected tile dimensions');
            }
            const canvas = new OffscreenCanvas(256, 256),
              context = canvas.getContext('2d')!;
            context.drawImage(bitmap, 0, 0);
            bitmap.close();
            pixels.set(key, context.getImageData(0, 0, 256, 256).data);
          }
        }),
      );
      controller.signal.throwIfAborted();
      const output = sampleRaster(mapping, (px, py) => {
        const tile = pixels.get(
          `${Math.floor(px / 256)}/${Math.floor(py / 256)}`,
        );
        if (!tile) return [0, 0, 0, 0];
        const index = ((py % 256) * 256 + (px % 256)) * 4;
        return tile.subarray(index, index + 4);
      });
      const canvas = new OffscreenCanvas(256, 256),
        context = canvas.getContext('2d')!;
      const image = context.createImageData(256, 256);
      image.data.set(output);
      context.putImageData(image, 0, 0);
      const data = await (
        await canvas.convertToBlob({ type: 'image/png' })
      ).arrayBuffer();
      controller.signal.throwIfAborted();
      self.postMessage({ id, data }, { transfer: [data] });
    } catch {
      if (!controller.signal.aborted) {
        controller.abort();
        self.postMessage({ id, failed: true });
      }
    } finally {
      active.delete(id);
    }
  })();
};
