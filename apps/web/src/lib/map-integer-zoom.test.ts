import { expect, it, vi } from 'vitest';
import { requireIntegerMapZoom } from './map-integer-zoom';

it('keeps fitted bounds covered, snaps later moves and registers only once per map', () => {
  let zoom = 10.75;
  const listeners: (() => void)[] = [];
  const map = {
    getZoom: () => zoom,
    jumpTo: vi.fn((camera: { zoom: number }) => {
      zoom = camera.zoom;
    }),
    on: vi.fn((_event: 'moveend', listener: () => void) => {
      listeners.push(listener);
    }),
    scrollZoom: { disable: vi.fn() },
    touchZoomRotate: { disable: vi.fn() },
  };
  requireIntegerMapZoom(map);
  requireIntegerMapZoom(map);
  expect(zoom).toBe(10);
  expect(map.on).toHaveBeenCalledOnce();
  expect(map.scrollZoom.disable).toHaveBeenCalledOnce();
  expect(map.touchZoomRotate.disable).toHaveBeenCalledOnce();
  zoom = 12.25;
  listeners[0]();
  expect(zoom).toBe(12);
  listeners[0]();
  expect(map.jumpTo).toHaveBeenCalledTimes(2);
});
