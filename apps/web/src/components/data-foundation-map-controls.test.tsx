// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { DataFoundationMap } from './data-foundation-map';
import { getDictionary } from '@/lib/i18n';

const probe = vi.hoisted(() => ({
  paint: vi.fn(),
  dispose: vi.fn(),
  tiles: vi.fn(),
  removeSource: vi.fn(),
  removeLayer: vi.fn(),
  addLayer: vi.fn(),
  events: new Map<string, (e: Record<string, unknown>) => void>(),
}));
vi.mock('maplibre-gl', () => ({
  setWorkerUrl: vi.fn(),
  NavigationControl: class {},
  Map: class {
    touchZoomRotate = { disableRotation: vi.fn() };
    addControl() {}
    on(name: string, callback: (e: Record<string, unknown>) => void) {
      probe.events.set(name, callback);
    }
    isStyleLoaded() {
      return true;
    }
    getSource() {
      return { setTiles: probe.tiles };
    }
    getStyle() {
      return {
        sources: { 'governed-raster': { type: 'raster' } },
        layers: [
          {
            id: 'governed-raster-layer',
            type: 'raster',
            source: 'governed-raster',
            paint: { 'raster-opacity': 0.35 },
          },
          { id: 'authority-points' },
        ],
      };
    }
    removeSource = probe.removeSource;
    removeLayer = probe.removeLayer;
    addSource = probe.tiles;
    addLayer = probe.addLayer;
    once() {}
    off() {}
    getLayer() {
      return true;
    }
    setLayoutProperty() {}
    setPaintProperty = probe.paint;
    remove() {}
  },
}));
vi.mock('./amap-basemap', () => ({ AmapBasemap: () => null }));
vi.mock('@/lib/amap-raster-protocol', () => ({
  registerAmapRaster: () => ({
    url: 'amap-raster://fixture',
    dispose: probe.dispose,
  }),
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it.each(['zh-CN', 'en'] as const)(
  'opens actual raster pixels and adjusts opacity without recreating the source in %s',
  (locale) => {
    const copy = getDictionary(locale).dataFoundation.mapPage;
    render(
      <DataFoundationMap
        locale={locale}
        ariaLabel={copy.mapAria}
        displayCrs="EPSG:4326"
        features={{ type: 'FeatureCollection', features: [] }}
        stacExtents={[]}
        labels={copy}
        rasterTileUrl="/api/data-foundation/geo/tiles/raster/versions/10000000-0000-4000-8000-000000000001/WebMercatorQuad/{z}/{x}/{y}.png"
      />,
    );
    expect(
      screen.getByRole('checkbox', { name: copy.rasterLayer }),
    ).toHaveProperty('checked', true);
    const slider = screen.getByRole('slider', {
      name: locale === 'zh-CN' ? '栅格不透明度' : 'Raster opacity',
    });
    fireEvent.change(slider, { target: { value: '35' } });
    expect(probe.paint).toHaveBeenLastCalledWith(
      'governed-raster-layer',
      'raster-opacity',
      0.35,
    );
    expect(probe.dispose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('checkbox', { name: copy.rasterLayer }));
    expect(slider).toHaveProperty('disabled', true);
  },
);

it('retries failed raster tiles without recreating the map or losing display choices', () => {
  const copy = getDictionary('en').dataFoundation.mapPage;
  render(
    <DataFoundationMap
      locale="en"
      ariaLabel={copy.mapAria}
      displayCrs="EPSG:4326"
      features={{ type: 'FeatureCollection', features: [] }}
      stacExtents={[]}
      labels={copy}
      rasterTileUrl="/api/data-foundation/geo/tiles/raster/versions/10000000-0000-4000-8000-000000000001/WebMercatorQuad/{z}/{x}/{y}.png"
    />,
  );
  act(() => probe.events.get('error')?.({ sourceId: 'governed-raster' }));
  expect(screen.getByText(/Some image pixels could not/)).toBeDefined();
  act(() =>
    probe.events.get('sourcedata')?.({
      sourceId: 'governed-raster',
      isSourceLoaded: true,
    }),
  );
  expect(screen.getByRole('button', { name: 'Reload image' })).toBeDefined();
  fireEvent.click(screen.getByRole('button', { name: 'Reload image' }));
  expect(probe.tiles).toHaveBeenCalledOnce();
  expect(probe.dispose).toHaveBeenCalledOnce();
  expect(probe.removeSource).toHaveBeenCalledWith('governed-raster');
  expect(probe.addLayer).toHaveBeenCalledWith(
    expect.objectContaining({ paint: { 'raster-opacity': 0.35 } }),
    'authority-points',
  );
  expect(probe.removeSource.mock.invocationCallOrder[0]).toBeLessThan(
    probe.dispose.mock.invocationCallOrder[0],
  );
  act(() =>
    probe.events.get('sourcedata')?.({
      sourceId: 'governed-raster',
      isSourceLoaded: true,
    }),
  );
  expect(screen.queryByRole('button', { name: 'Reload image' })).toBeNull();
});
