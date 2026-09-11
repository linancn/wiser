// @vitest-environment jsdom
import { createRef } from 'react';
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AmapBasemap, type AmapBasemapHandle } from './amap-basemap';

const mock = vi.hoisted(() => ({
  options: vi.fn(),
  center: vi.fn(),
  destroy: vi.fn(),
  load: vi.fn(),
  webgl: true,
}));
vi.mock('@/lib/amap-loader', () => ({
  loadAmap: () =>
    Promise.resolve({
      Browser: { isWebGL: mock.webgl },
      Map: class {
        constructor(_element: HTMLElement, options: unknown) {
          mock.options(options);
        }
        on(_event: string, callback: () => void) {
          mock.load.mockImplementation(callback);
        }
        setZoomAndCenter = mock.center;
        destroy = mock.destroy;
        setMapStyle() {}
        resize() {}
      },
    }),
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mock.webgl = true;
});

it('requests integral overlay zoom only when the SDK falls back from WebGL', async () => {
  mock.webgl = false;
  const onIntegerZoom = vi.fn();
  render(<AmapBasemap ref={null} locale="en" onIntegerZoom={onIntegerZoom} />);
  await waitFor(() => expect(onIntegerZoom).toHaveBeenCalledOnce());
});

it('retains a camera arriving before the official SDK and releases its map on unmount', async () => {
  const ref = createRef<AmapBasemapHandle>();
  const result = render(<AmapBasemap ref={ref} locale="zh-CN" />);
  ref.current!.syncCamera({
    longitude: 116.39754,
    latitude: 39.908901,
    zoom: 15.25,
    bearing: 0,
    pitch: 0,
  });
  await waitFor(() => expect(mock.options).toHaveBeenCalled());
  expect(mock.options.mock.calls[0][0]).toMatchObject({
    center: [116.39754, 39.908901],
    zoom: 16.25,
    viewMode: '3D',
    pitch: 0,
    rotation: 0,
    dragEnable: false,
  });
  ref.current!.syncCamera({
    longitude: -77.1276,
    latitude: 38.9498,
    zoom: 8,
    bearing: 0,
    pitch: 0,
  });
  expect(mock.center).toHaveBeenLastCalledWith(9, [-77.1276, 38.9498], true);
  result.unmount();
  expect(mock.destroy).toHaveBeenCalledOnce();
});
