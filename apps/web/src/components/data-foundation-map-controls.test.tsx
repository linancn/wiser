// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { DataFoundationMap } from './data-foundation-map';
import { getDictionary } from '@/lib/i18n';

const probe = vi.hoisted(() => ({ paint: vi.fn(), dispose: vi.fn() }));
vi.mock('maplibre-gl', () => ({
  setWorkerUrl: vi.fn(),
  NavigationControl: class {},
  Map: class {
    touchZoomRotate = { disableRotation: vi.fn() };
    addControl() {}
    on() {}
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
      (
        screen.getByRole('checkbox', {
          name: copy.rasterLayer,
        }) as HTMLInputElement
      ).checked,
    ).toBe(true);
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
    expect((slider as HTMLInputElement).disabled).toBe(true);
  },
);
