import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { getDictionary } from '@/lib/i18n';
import { DataFoundationMap } from './data-foundation-map';
vi.mock('maplibre-gl', () => ({ setWorkerUrl: vi.fn() }));
vi.mock('./amap-basemap', () => ({ AmapBasemap: () => null }));
it.each(['zh-CN', 'en'] as const)(
  'does not present coordinate conversion as verified position in %s',
  (locale) => {
    const copy = getDictionary(locale).dataFoundation.mapPage;
    const html = renderToStaticMarkup(
      <DataFoundationMap
        locale={locale}
        ariaLabel={copy.mapAria}
        displayCrs="EPSG:4326"
        features={{ type: 'FeatureCollection', features: [] }}
        stacExtents={[]}
        labels={{ ...copy }}
      />,
    );
    expect(html).not.toContain(
      locale === 'zh-CN' ? '已按高德底图对齐' : 'Aligned with the AMap basemap',
    );
    expect(html).toContain(
      locale === 'zh-CN'
        ? '位置尚待独立核对'
        : 'Position still needs independent verification',
    );
  },
);
