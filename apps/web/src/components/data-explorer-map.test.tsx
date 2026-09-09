// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import {
  ExplorationResultSchema,
  type ExplorationResult,
} from '@wiser/data-contracts';
import DataExplorerMap from './data-explorer-map';
type ProbeProps = {
  children?: ReactNode;
  onLoad?: () => void;
  onIdle?: () => void;
  onError?: (event: { error: unknown }) => void;
  onClick?: (event: {
    features: { properties: Record<string, unknown> }[];
    lngLat: [number, number];
  }) => void;
};
const probe = vi.hoisted(() => ({
  props: {} as ProbeProps,
  layers: new Map<string, { layout?: Record<string, unknown> }>(),
  fitBounds: vi.fn(),
  easeTo: vi.fn(),
}));
vi.mock('maplibre-gl', () => ({ setWorkerUrl: vi.fn() }));
vi.mock('react-map-gl/maplibre', async () => {
  const { forwardRef, useImperativeHandle } = await import('react');
  return {
    default: forwardRef<unknown, ProbeProps>((props, ref) => {
      probe.props = props;
      useImperativeHandle(ref, () => ({
        fitBounds: probe.fitBounds,
        easeTo: probe.easeTo,
        getZoom: () => 4,
        getBounds: () => ({
          getWest: () => -190,
          getSouth: () => 38,
          getEast: () => -77,
          getNorth: () => 39,
        }),
        getMap: () => ({
          getLayer: () => true,
          queryRenderedFeatures: () => [
            { properties: { recordId: 'one' } },
            { properties: { recordId: 'one' } },
          ],
        }),
      }));
      return <div>{props.children}</div>;
    }),
    Source: ({ children }: { children?: ReactNode }) => children,
    Layer: (props: { id: string; layout?: Record<string, unknown> }) => {
      probe.layers.set(props.id, props);
      return null;
    },
    NavigationControl: () => null,
    AttributionControl: () => null,
  };
});
const id = '10000000-0000-4000-8000-000000000001';
const result: ExplorationResult = {
  queryId: id,
  spec: {},
  view: 'map',
  resources: [],
  totalCount: 1,
  createdAt: '2026-09-08T00:00:00Z',
  expiresAt: '2026-09-08T00:30:00Z',
  features: [],
  spatial: { bounds: [-78, 38, -77, 39], mercatorFeatureCount: 1 },
};
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  probe.layers.clear();
});
it('toggles geometry layers and applies a bounded viewport independently of visual layer visibility', async () => {
  const onBounds = vi.fn();
  const user = userEvent.setup();
  render(
    <DataExplorerMap
      result={result}
      selectedId={null}
      onSelect={vi.fn()}
      onInvalidated={vi.fn()}
      locale="en"
      onBounds={onBounds}
    />,
  );
  act(() => probe.props.onLoad?.());
  await user.click(screen.getByText('Layers and legend'));
  await user.click(
    screen.getByRole('checkbox', { name: 'Points and clusters' }),
  );
  expect(probe.layers.get('records-points')?.layout?.['visibility']).toBe(
    'none',
  );
  await user.click(screen.getByRole('button', { name: 'Filter to this area' }));
  expect(onBounds).toHaveBeenCalledWith([-180, 38, -77, 39]);
  act(() => probe.props.onIdle?.());
  expect(
    screen
      .getByTestId('explorer-map')
      .getAttribute('data-rendered-feature-count'),
  ).toBe('1');
  expect(probe.fitBounds).toHaveBeenCalled();
});
it('invalidates denied tiles and offers a fresh map attempt without retaining the failed canvas', async () => {
  const onInvalidated = vi.fn();
  const user = userEvent.setup();
  render(
    <DataExplorerMap
      result={result}
      selectedId={null}
      onSelect={vi.fn()}
      onInvalidated={onInvalidated}
      locale="en"
    />,
  );
  act(() => probe.props.onError?.({ error: { status: 403 } }));
  expect(onInvalidated).toHaveBeenCalledWith(id, 403);
  await user.click(screen.getByRole('button', { name: 'Reload map' }));
  act(() => probe.props.onLoad?.());
  expect(screen.getByTestId('explorer-map').getAttribute('data-ready')).toBe(
    'true',
  );
});

it('zooms clusters without a record fetch and reauthorizes individual feature selection', async () => {
  const record = {
    recordId: id,
    featureId: id,
    dataItemId: id,
    versionId: id,
    analysisId: id,
    assetId: id,
    sourceId: '0001',
    index: 1,
    values: { station: '0001' },
  };
  const fetch = vi.fn().mockResolvedValue(
    Response.json(
      ExplorationResultSchema.parse({
        queryId: id,
        spec: {},
        view: 'records',
        resources: [],
        totalCount: 1,
        createdAt: result.createdAt,
        expiresAt: result.expiresAt,
        records: [record],
        assets: [
          {
            assetId: id,
            sourceHash: 'a'.repeat(64),
            status: 'READY',
            recordCount: 1,
            featureCount: 1,
            reason: null,
            paths: ['station.json'],
            columns: [{ key: 'station', label: 'Station' }],
          },
        ],
        selectedAssetId: id,
      }),
    ),
  );
  vi.stubGlobal('fetch', fetch);
  const onSelect = vi.fn();
  render(
    <DataExplorerMap
      result={result}
      selectedId={null}
      onSelect={onSelect}
      onInvalidated={vi.fn()}
      locale="en"
    />,
  );
  act(() =>
    probe.props.onClick?.({
      features: [{ properties: { cluster: true, count: 9 } }],
      lngLat: [-77, 39],
    }),
  );
  expect(probe.easeTo).toHaveBeenCalledWith({
    center: [-77, 39],
    zoom: 6,
    duration: 0,
  });
  expect(fetch).not.toHaveBeenCalled();
  act(() =>
    probe.props.onClick?.({
      features: [{ properties: { recordId: id, versionId: id, assetId: id } }],
      lngLat: [-77, 39],
    }),
  );
  await waitFor(() => expect(onSelect).toHaveBeenCalledWith(record));
  expect(
    screen.getByTestId('explorer-map').getAttribute('data-selected-record'),
  ).toBe(id);
});
it('refuses mismatched record responses and propagates revoked feature permissions', async () => {
  for (const response of [
    Response.json({
      queryId: '20000000-0000-4000-8000-000000000001',
      spec: {},
      createdAt: result.createdAt,
      expiresAt: result.expiresAt,
      view: 'records',
      resources: [],
      totalCount: 0,
      assets: [],
      records: [],
    }),
    new Response(null, { status: 403 }),
  ]) {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
    const onSelect = vi.fn(),
      onInvalidated = vi.fn();
    const rendered = render(
      <DataExplorerMap
        result={result}
        selectedId={null}
        onSelect={onSelect}
        onInvalidated={onInvalidated}
        locale="en"
      />,
    );
    act(() =>
      probe.props.onClick?.({
        features: [
          { properties: { recordId: id, versionId: id, assetId: id } },
        ],
        lngLat: [0, 0],
      }),
    );
    await screen.findByRole('button', { name: 'Reload map' });
    expect(onSelect).not.toHaveBeenCalled();
    if (response.status === 403)
      expect(onInvalidated).toHaveBeenCalledWith(id, 403);
    rendered.unmount();
  }
});
