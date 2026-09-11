import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
const probe = vi.hoisted(() => ({
  explore: vi.fn<(input: { view: string }) => Promise<unknown>>(),
  map: vi.fn((_props: Record<string, unknown>) => null),
}));
vi.mock('@/components/data-foundation-map', () => ({
  DataFoundationMap: probe.map,
}));
vi.mock('server-only', () => ({}));
vi.mock('@/components/data-resource-content', () => ({
  DataResourceContent: () => null,
}));
vi.mock('@/components/data-foundation-workspace', () => {
  const wrapper = ({ children }: { children?: ReactNode }) => children;
  return Object.fromEntries(
    [
      'MapQueryForm',
      'DataEmpty',
      'ExplorationEntry',
      'DataDisclosure',
      'AuthorityFlag',
      'DataDisclosure',
      'DataFailureState',
      'DataPageHeader',
      'DataPageMain',
      'DataSection',
      'FieldGrid',
      'ProtocolValue',
      'SectionHeading',
      'StatusBadge',
      'VersionList',
    ].map((name) => [name, wrapper]),
  );
});
vi.mock('@/lib/data-foundation-dal.server', () => ({
  getDataFoundationDal: () =>
    Promise.resolve({
      dataItem: () =>
        Promise.resolve({
          item: {
            dataItemId: '10000000-0000-4000-8000-000000000001',
            name: 'Raster fixture',
            sourceOrganization: 'Fixture',
            securityLevel: 'L1_INTERNAL',
            qualityGrade: 'A',
            acceptanceStatus: 'ACCEPTED',
            publicationStatus: 'PUBLISHED',
            processingStage: 'RAW',
          },
          selectedVersion: {
            dataItemId: '10000000-0000-4000-8000-000000000001',
            versionId: '10000000-0000-4000-8000-000000000002',
            version: 1,
            assetIds: [],
            tileAvailability: { vector: false, raster: true },
            securityLevel: 'L1_INTERNAL',
            qualityGrade: 'A',
            acceptanceStatus: 'ACCEPTED',
            publicationStatus: 'PUBLISHED',
            processingStage: 'RAW',
          },
        }),
      geo: () => Promise.resolve({ features: [] }),
      stacItems: () => Promise.resolve({ extents: [] }),
      capabilities: () =>
        Promise.resolve({ capabilities: [{ id: 'data.geo.query' }] }),
      versions: () => Promise.resolve({ items: [] }),
      explore: probe.explore,
    }),
}));
vi.mock('@/lib/data-foundation-page.server', () => ({
  dataFoundationMetadata: vi.fn(),
  dataPageFailure: vi.fn(),
  handleDataPageError: vi.fn(),
  invalidDataPageRequest: vi.fn(),
}));
import MapPage from './[locale]/data-foundation/map/page';
beforeEach(() => {
  probe.explore.mockReset();
  probe.map.mockClear();
  probe.explore.mockImplementation((input) =>
    Promise.resolve(
      input.view === 'resources'
        ? { queryId: 'fixture-query' }
        : input.view === 'map'
          ? { spatial: { bounds: [115, 40, 116, 41] } }
          : null,
    ),
  );
});
it.each(['zh-CN', 'en'])(
  'opens the pinned raster with its existing analysis bounds in %s',
  async (locale) => {
    const html = renderToStaticMarkup(
      await MapPage({
        params: Promise.resolve({
          locale,
          dataItemId: '10000000-0000-4000-8000-000000000001',
        }),
        searchParams: Promise.resolve({
          dataItem: '10000000-0000-4000-8000-000000000001',
          version: '10000000-0000-4000-8000-000000000002',
        }),
      }),
    );
    expect(probe.explore).toHaveBeenCalledWith({
      spec: {
        versions: [
          {
            dataItemId: '10000000-0000-4000-8000-000000000001',
            versionId: '10000000-0000-4000-8000-000000000002',
          },
        ],
      },
      view: 'resources',
      first: 1,
    });
    expect(probe.explore).toHaveBeenCalledWith({
      queryId: 'fixture-query',
      view: 'map',
      first: 1,
    });
    expect(probe.map.mock.calls[0]?.[0]).toMatchObject({
      requestedBounds: [115, 40, 116, 41],
      selectedVersion: '10000000-0000-4000-8000-000000000002',
    });
    expect(html).not.toContain('Invalid');
  },
);

it('does not invent a map extent when the pinned analysis has none', async () => {
  probe.explore.mockImplementation((input) =>
    Promise.resolve(
      input.view === 'resources'
        ? { queryId: 'fixture-query' }
        : { spatial: { bounds: null } },
    ),
  );
  renderToStaticMarkup(
    await MapPage({
      params: Promise.resolve({ locale: 'en' }),
      searchParams: Promise.resolve({
        dataItem: '10000000-0000-4000-8000-000000000001',
        version: '10000000-0000-4000-8000-000000000002',
      }),
    }),
  );
  expect(probe.map).not.toHaveBeenCalled();
});

it('uses a small query area around a point without treating it as an asset footprint', async () => {
  probe.explore.mockImplementation((input) =>
    Promise.resolve(
      input.view === 'resources'
        ? { queryId: 'fixture-query' }
        : { spatial: { bounds: [-77, 39, -77, 39] } },
    ),
  );
  renderToStaticMarkup(
    await MapPage({
      params: Promise.resolve({ locale: 'en' }),
      searchParams: Promise.resolve({
        dataItem: '10000000-0000-4000-8000-000000000001',
        version: '10000000-0000-4000-8000-000000000002',
      }),
    }),
  );
  expect(probe.map.mock.calls[0]?.[0]).toMatchObject({
    requestedBounds: [-77.001, 38.999, -76.999, 39.001],
    features: { type: 'FeatureCollection', features: [] },
  });
});
