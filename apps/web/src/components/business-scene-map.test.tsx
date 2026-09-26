// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { BusinessSceneMap } from './business-scene-map';
import { defaultSceneView } from '@/lib/business-scene-view';
import type { BusinessScene } from '@/lib/business-scene';
import type { RelationAssertion } from '@wiser/data-contracts';
const probe = vi.hoisted(() => ({
  load: null as null | (() => void),
  click: null as
    | null
    | ((event: {
        features: { properties: typeof record }[];
        point?: { x: number; y: number };
      }) => void),
  query: vi.fn<(...args: unknown[]) => { properties: typeof record }[]>(
    () => [],
  ),
  interactiveLayers: [] as string[],
  fit: vi.fn<
    (
      bounds: [[number, number], [number, number]],
      options: {
        padding:
          number | { left: number; right: number; top: number; bottom: number };
        duration: number;
        maxZoom: number;
      },
    ) => void
  >(),
  jump: vi.fn(),
  move: null as null | (() => void),
}));
vi.mock('maplibre-gl', () => ({ setWorkerUrl: vi.fn() }));
vi.mock('./amap-basemap', () => ({ AmapBasemap: () => null }));
vi.mock('react-map-gl/maplibre', async () => {
  const { forwardRef, useImperativeHandle } = await import('react');
  return {
    default: forwardRef<
      unknown,
      {
        children?: ReactNode;
        onLoad: () => void;
        onMoveEnd: () => void;
        onClick?: NonNullable<typeof probe.click>;
        interactiveLayerIds?: string[];
      }
    >((p, ref) => {
      probe.load = p.onLoad;
      probe.click = p.onClick ?? null;
      probe.interactiveLayers = p.interactiveLayerIds ?? [];
      probe.move = p.onMoveEnd;
      useImperativeHandle(ref, () => ({
        fitBounds: probe.fit,
        getZoom: () => 8,
        getCenter: () => ({ lng: 115, lat: 40 }),
        project: () => ({ x: 100, y: 100 }),
        queryRenderedFeatures: probe.query,
        jumpTo: probe.jump,
        zoomIn: vi.fn(),
        zoomOut: vi.fn(),
      }));
      return <div>{p.children}</div>;
    }),
    Source: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    Layer: () => null,
  };
});
const id = '10000000-0000-4000-8000-000000000001';
const record = {
  recordId: id,
  featureId: id,
  dataItemId: id,
  versionId: id,
  analysisId: id,
  assetId: id,
  sourceId: null,
  index: 1,
  values: {},
};
const page = {
  queryId: id,
  spec: {},
  view: 'map',
  resources: [],
  totalCount: 1,
  createdAt: '2026-09-15T00:00:00Z',
  expiresAt: '2026-09-15T00:30:00Z',
  features: [
    {
      type: 'Feature',
      id,
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [115, 40],
            [116, 40],
            [116, 41],
            [115, 40],
          ],
        ],
      },
      properties: record,
    },
  ],
};
const scene: BusinessScene = {
  nodes: [
    {
      id: 'bound',
      label: '影像覆盖范围',
      kind: 'DOCUMENT',
      group: 'spatial',
      classificationBasis: null,
      record,
      periods: [],
    },
    {
      id: 'unlocated',
      label: '同名地点',
      kind: 'PLACE',
      group: 'PLACE',
      classificationBasis: null,
      record: null,
      periods: [],
    },
  ],
  edges: [],
};
const props = {
  scene,
  queryId: id,
  locale: 'zh-CN' as const,
  onInvalidated: vi.fn(),
  width: 1000,
  settings: { ...defaultSceneView, form: 'space' as const },
  onSettings: vi.fn(),
  focus: { nodes: new Set<string>(), edges: new Set<string>() },
  onSelect: vi.fn(),
  onEdge: vi.fn(),
  selectedId: null,
};
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  probe.query.mockReset().mockReturnValue([]);
});
it('opens a thin river hit near the pointer without assigning locations to nearby objects', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      Response.json({
        ...page,
        features: [
          {
            ...page.features[0],
            geometry: {
              type: 'LineString',
              coordinates: [
                [115, 40],
                [116, 41],
              ],
            },
          },
        ],
      }),
    ),
  );
  probe.query.mockReturnValue([
    { properties: record },
    { properties: { ...record, recordId: 'unrelated' } },
  ]);
  render(<BusinessSceneMap {...props} />);
  await waitFor(() =>
    expect(
      screen.getByTestId('business-spatial-scene').getAttribute('data-state'),
    ).toBe('ready'),
  );
  act(() => probe.click?.({ features: [], point: { x: 100, y: 200 } }));
  expect(props.onSelect).toHaveBeenCalledWith('bound');
  expect(props.onSelect).not.toHaveBeenCalledWith('unlocated');
  expect(probe.query).toHaveBeenCalledWith(
    [
      [94, 194],
      [106, 206],
    ],
    {
      layers: ['business-scene-outlines', 'business-scene-points'],
      filter: ['in', ['geometry-type'], ['literal', ['LineString', 'Point']]],
    },
  );
  expect(probe.fit).not.toHaveBeenCalled();
  expect(probe.jump).not.toHaveBeenCalled();
});
it.each([
  ['zh-CN', '查看关联参考范围（1）', '不表示资料自身坐标'],
  [
    'en',
    'View related reference extents (1)',
    'not the source’s own coordinates',
  ],
] as const)(
  'locates a related area separately from exact object location in %s',
  async (locale, label, hint) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(page)));
    const linked: BusinessScene = {
      nodes: [
        { ...scene.nodes[0], kind: 'PLACE' },
        scene.nodes[1],
        { ...scene.nodes[1], id: 'doc', kind: 'DOCUMENT' },
      ],
      edges: [
        {
          id: 'about',
          from: 'doc',
          to: 'unlocated',
          row: {
            status: 'PENDING_REVIEW',
            candidate: {
              predicate: 'ABOUT_ENTITY',
              subject: { label: '资料' },
              object: { label: '地区' },
              qualifiers: {
                context: {
                  recordNature: 'SOURCE_RELATION',
                  locationRole: 'REFERENCE_LOCATION',
                },
              },
            },
          } as RelationAssertion,
        },
        {
          id: 'identity',
          from: 'unlocated',
          to: 'bound',
          row: {
            status: 'PENDING_REVIEW',
            candidate: {
              predicate: 'IDENTITY_MATCH',
              subject: { label: '地区' },
              object: { label: '参考面' },
              qualifiers: {
                context: {
                  recordNature: 'SOURCE_RELATION',
                  locationRole: 'REFERENCE_LOCATION',
                },
              },
            },
          } as RelationAssertion,
        },
      ],
    };
    const rendered = render(
      <BusinessSceneMap
        {...props}
        scene={linked}
        locale={locale}
        selectedId="doc"
      />,
    );
    await waitFor(() =>
      expect(
        screen.getByTestId('business-spatial-scene').dataset.anchorCount,
      ).toBe('1'),
    );
    const button = screen.getByRole('button', { name: label });
    expect(screen.getByText(new RegExp(hint))).toBeTruthy();
    expect(
      screen
        .getByRole('button', {
          name: locale === 'zh-CN' ? '定位所选对象' : 'Locate selected object',
        })
        .hasAttribute('disabled'),
    ).toBe(true);
    probe.fit.mockClear();
    fireEvent.click(button);
    expect(probe.fit).toHaveBeenCalledWith(
      [
        // Existing map ingestion converts WGS84 into the Amap display frame.
        [115.00626998658886, 40.00119093393262],
        [116.00626990745596, 41.001679553289065],
      ],
      expect.objectContaining({ maxZoom: 11, duration: 0 }),
    );
    expect(props.onSelect).not.toHaveBeenCalled();
    expect(
      screen.getByTestId('business-spatial-scene').dataset.anchorCount,
    ).toBe('1');
    rendered.rerender(
      <BusinessSceneMap
        {...props}
        scene={linked}
        locale={locale}
        selectedId={null}
      />,
    );
    expect(screen.queryByRole('button', { name: label })).toBeNull();
  },
);
it.each([
  [
    'zh-CN',
    '地图几何：点 0 · 线 0 · 面 1 · 混合 0',
    '有地名、尚未绑定范围的对象：1',
  ],
  [
    'en',
    'Map geometries: points 0 · lines 0 · areas 1 · mixed 0',
    'Named spatial objects without a bound extent: 1',
  ],
] as const)(
  'explains geometry and named-unbound coverage in %s',
  async (locale, shapes, names) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(page)));
    render(<BusinessSceneMap {...props} locale={locale} />);
    expect(await screen.findByText(shapes)).toBeTruthy();
    expect(screen.getByText(names)).toBeTruthy();
  },
);
it('does not claim zero spatial coverage while loading or after a denied response', async () => {
  let resolve!: (response: Response) => void;
  vi.stubGlobal(
    'fetch',
    vi.fn().mockReturnValue(
      new Promise<Response>((r) => {
        resolve = r;
      }),
    ),
  );
  render(<BusinessSceneMap {...props} />);
  expect(screen.queryByTestId('spatial-coverage')).toBeNull();
  await act(async () => {
    resolve(Response.json({}, { status: 403 }));
    await Promise.resolve();
  });
  expect(screen.queryByTestId('spatial-coverage')).toBeNull();
});
it('uses the full scoped map and only binds exact records while retaining unlocated nodes', async () => {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValue(Response.json(page));
  vi.stubGlobal('fetch', fetch);
  render(<BusinessSceneMap {...props} />);
  act(() => probe.load?.());
  await waitFor(() =>
    expect(
      screen.getByTestId('business-spatial-scene').dataset.anchorCount,
    ).toBe('1'),
  );
  const root = screen.getByTestId('business-spatial-scene');
  expect(root.querySelectorAll('[data-node-id]')).toHaveLength(2);
  expect(
    root
      .querySelector('[data-node-id="unlocated"]')
      ?.getAttribute('data-anchored'),
  ).toBe('false');
  expect(JSON.parse(fetch.mock.calls[0][1]?.body as string)).toEqual({
    queryId: id,
    view: 'map',
    first: 200,
  });
  act(() => probe.move?.());
  expect(props.onSettings).toHaveBeenCalledWith(
    expect.objectContaining({ mapLon: 115, mapLat: 40, mapZoom: 8 }),
  );
  fireEvent.click(root.querySelector('[data-node-id="bound"]')!);
  expect(props.onSelect).toHaveBeenCalledWith('bound');
});
it('rejects a changed query response and never shows its geometry', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      Response.json({
        ...page,
        queryId: '20000000-0000-4000-8000-000000000001',
      }),
    ),
  );
  render(<BusinessSceneMap {...props} />);
  await screen.findByRole('alert');
  expect(screen.getByTestId('business-spatial-scene').dataset.anchorCount).toBe(
    '0',
  );
});
it('invalidates denial and retries a transient failure without retaining prior geometry', async () => {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(new Response('', { status: 403 }))
    .mockResolvedValueOnce(
      Response.json({ ...page, totalCount: 0, features: [] }),
    );
  vi.stubGlobal('fetch', fetch);
  render(<BusinessSceneMap {...props} />);
  await screen.findByRole('alert');
  expect(props.onInvalidated).toHaveBeenCalledWith(id, 403);
  fireEvent.click(screen.getByRole('button', { name: '重新读取位置依据' }));
  await screen.findByText(
    '当前范围没有可绑定的位置几何，可继续查看未定位资料。',
  );
  expect(screen.getByTestId('business-spatial-scene').dataset.anchorCount).toBe(
    '0',
  );
});
it('aborts pending location requests on unmount', () => {
  let signal: AbortSignal | undefined;
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof globalThis.fetch>((_url, init) => {
      signal = init?.signal ?? undefined;
      return new Promise(() => {});
    }),
  );
  const view = render(<BusinessSceneMap {...props} />);
  view.unmount();
  expect(signal?.aborted).toBe(true);
});

it('ignores a late denial from an abandoned query while retaining the current geometry', async () => {
  let finishOld!: (response: Response) => void;
  const currentId = '20000000-0000-4000-8000-000000000001';
  vi.stubGlobal(
    'fetch',
    vi
      .fn<typeof globalThis.fetch>()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishOld = resolve;
          }),
      )
      .mockResolvedValueOnce(Response.json({ ...page, queryId: currentId })),
  );
  const view = render(<BusinessSceneMap {...props} />);
  view.rerender(<BusinessSceneMap {...props} queryId={currentId} />);
  await waitFor(() =>
    expect(
      screen.getByTestId('business-spatial-scene').dataset.anchorCount,
    ).toBe('1'),
  );
  await act(async () => {
    finishOld(new Response('', { status: 403 }));
    await Promise.resolve();
  });
  expect(props.onInvalidated).not.toHaveBeenCalled();
  expect(screen.getByTestId('business-spatial-scene').dataset.state).toBe(
    'ready',
  );
  expect(screen.getByTestId('business-spatial-scene').dataset.anchorCount).toBe(
    '1',
  );
});

it('does not dispatch continuation pages after unmount while an earlier body is pending', async () => {
  let finishBody!: (value: unknown) => void;
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce({
      ok: true,
      json: () =>
        new Promise((resolve) => {
          finishBody = resolve;
        }),
    } as Response)
    .mockResolvedValue(Response.json(page));
  vi.stubGlobal('fetch', fetch);
  const view = render(<BusinessSceneMap {...props} />);
  await waitFor(() => expect(finishBody).toBeTypeOf('function'));
  view.unmount();
  await act(async () => {
    finishBody({ ...page, totalCount: 2, nextCursor: 'next' });
    await Promise.resolve();
  });
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(props.onInvalidated).not.toHaveBeenCalled();
});

it('never exposes partial geometry when a continuation page fails and recovers through retry', async () => {
  let finishNext!: (response: Response) => void;
  vi.stubGlobal(
    'fetch',
    vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        Response.json({ ...page, totalCount: 2, nextCursor: 'next' }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishNext = resolve;
          }),
      )
      .mockResolvedValueOnce(Response.json(page)),
  );
  render(<BusinessSceneMap {...props} />);
  act(() => probe.load?.());
  await waitFor(() => expect(finishNext).toBeTypeOf('function'));
  expect(screen.getByTestId('business-spatial-scene').dataset.state).toBe(
    'loading',
  );
  expect(screen.getByTestId('business-spatial-scene').dataset.anchorCount).toBe(
    '0',
  );
  await act(async () => {
    finishNext(new Response('', { status: 503 }));
    await Promise.resolve();
  });
  await screen.findByRole('alert');
  expect(
    screen
      .getByTestId('business-spatial-scene')
      .querySelectorAll('[data-node-id]'),
  ).toHaveLength(0);
  expect(props.onInvalidated).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '重新读取位置依据' }));
  await waitFor(() =>
    expect(
      screen.getByTestId('business-spatial-scene').dataset.anchorCount,
    ).toBe('1'),
  );
});

it('clears already displayed geometry while a replacement query is pending and then denied', async () => {
  let finish!: (response: Response) => void;
  const currentId = '20000000-0000-4000-8000-000000000001';
  vi.stubGlobal(
    'fetch',
    vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(Response.json(page))
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      ),
  );
  const view = render(<BusinessSceneMap {...props} />);
  act(() => probe.load?.());
  await waitFor(() =>
    expect(
      screen.getByTestId('business-spatial-scene').dataset.anchorCount,
    ).toBe('1'),
  );
  expect(
    screen
      .getByTestId('business-spatial-scene')
      .querySelectorAll('[data-node-id]'),
  ).toHaveLength(2);
  view.rerender(<BusinessSceneMap {...props} queryId={currentId} />);
  expect(screen.getByTestId('business-spatial-scene').dataset.anchorCount).toBe(
    '0',
  );
  expect(
    screen
      .getByTestId('business-spatial-scene')
      .querySelectorAll('[data-node-id]'),
  ).toHaveLength(0);
  await act(async () => {
    finish(new Response('', { status: 403 }));
    await Promise.resolve();
  });
  await screen.findByRole('alert');
  expect(props.onInvalidated).toHaveBeenCalledWith(currentId, 403);
  expect(screen.getByTestId('business-spatial-scene').dataset.anchorCount).toBe(
    '0',
  );
});

it('aborts a pending continuation page and discards its late body without requesting a third page', async () => {
  let finish!: (response: Response) => void;
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(
      Response.json({ ...page, totalCount: 3, nextCursor: 'second' }),
    )
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
  vi.stubGlobal('fetch', fetch);
  const view = render(<BusinessSceneMap {...props} />);
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  const signal = fetch.mock.calls[1][1]?.signal;
  expect(signal).toBe(fetch.mock.calls[0][1]?.signal);
  view.unmount();
  expect(signal?.aborted).toBe(true);
  await act(async () => {
    finish(Response.json({ ...page, totalCount: 3, nextCursor: 'third' }));
    await Promise.resolve();
  });
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(props.onInvalidated).not.toHaveBeenCalled();
});

it('retains predicate colors, pending dashes and arrowless identity across the spatial presentation', async () => {
  const relation = (
    predicate: 'IDENTITY_MATCH' | 'ABOUT_ENTITY',
    status: 'PENDING_REVIEW' | 'APPROVED',
  ) => ({
    id: predicate,
    from: 'bound',
    to: 'unlocated',
    row: {
      status,
      candidate: {
        predicate,
        subject: { label: '影像覆盖范围' },
        object: { label: '同名地点' },
      },
    } as RelationAssertion,
  });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(page)));
  render(
    <BusinessSceneMap
      {...props}
      scene={{
        ...scene,
        edges: [
          relation('IDENTITY_MATCH', 'PENDING_REVIEW'),
          relation('ABOUT_ENTITY', 'APPROVED'),
        ],
      }}
    />,
  );
  act(() => probe.load?.());
  await waitFor(() =>
    expect(
      screen.getByTestId('business-spatial-scene').dataset.anchorCount,
    ).toBe('1'),
  );
  fireEvent.click(
    screen.getByRole('checkbox', { name: '显示本页对象的全部连线' }),
  );
  const root = screen.getByTestId('business-spatial-scene');
  const identity = root.querySelector(
    '[data-edge-id="IDENTITY_MATCH"] [data-relation-line]',
  );
  expect(identity?.getAttribute('stroke')).toBe('var(--scene-identity)');
  expect(identity?.getAttribute('stroke-dasharray')).toBe('5 3');
  expect(identity?.hasAttribute('marker-end')).toBe(false);
  const context = root.querySelector(
    '[data-edge-id="ABOUT_ENTITY"] [data-relation-line]',
  );
  expect(context?.getAttribute('stroke')).toBe('var(--scene-context)');
  expect(context?.hasAttribute('stroke-dasharray')).toBe(false);
  expect(context?.getAttribute('marker-end')).toContain('-context)');
  expect(
    root.querySelector('[data-node-id="bound"]')?.getAttribute('data-family'),
  ).toBe('asset');
  expect(root.querySelector('[data-node-id="bound"] rect')).not.toBeNull();
  expect(
    root
      .querySelector('[data-node-id="unlocated"] circle')
      ?.getAttribute('fill'),
  ).toBe('var(--scene-water)');
});

it('keeps all 600 unlocated identities reachable through named pages', async () => {
  const nodes = Array.from({ length: 600 }, (_, i) => ({
    ...scene.nodes[1],
    id: String(i),
    group: i < 450 ? 'PLACE' : 'BASIN',
  }));
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(
        Response.json({ ...page, totalCount: 0, features: [] }),
      ),
  );
  render(<BusinessSceneMap {...props} scene={{ nodes, edges: [] }} />);
  act(() => probe.load?.());
  await waitFor(() =>
    expect(screen.getByTestId('business-spatial-scene').dataset.state).toBe(
      'ready',
    ),
  );
  // Named paging replaces the fixed dot grid; prove every original ID remains reachable.
  const seen = new Set<string>();
  const next = screen.getByRole('button', { name: '下一页资料' });
  for (let pageIndex = 0; pageIndex < 100; pageIndex++) {
    const items = screen
      .getByTestId('business-spatial-scene')
      .querySelectorAll('[data-node-id]');
    expect(items).toHaveLength(6);
    for (const item of items) seen.add(item.getAttribute('data-node-id')!);
    expect(next.hasAttribute('disabled')).toBe(pageIndex === 99);
    if (pageIndex < 99) fireEvent.click(next);
  }
  expect(seen).toEqual(new Set(nodes.map((n) => n.id)));
}, 20000);

it.each([
  [
    'LineString',
    [
      [115, 40],
      [117, 41],
    ],
  ],
  [
    'MultiLineString',
    [
      [
        [115, 40],
        [117, 41],
      ],
    ],
  ],
  [
    'Polygon',
    [
      [
        [115, 40],
        [117, 40],
        [117, 41],
        [115, 40],
      ],
    ],
  ],
  [
    'MultiPolygon',
    [
      [
        [
          [115, 40],
          [117, 40],
          [117, 41],
          [115, 40],
        ],
      ],
    ],
  ],
])(
  'locates the full %s extent instead of presenting its center as a point',
  async (type, coordinates) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        Response.json({
          ...page,
          features: [{ ...page.features[0], geometry: { type, coordinates } }],
        }),
      ),
    );
    render(<BusinessSceneMap {...props} selectedId="bound" />);
    act(() => probe.load?.());
    await waitFor(() =>
      expect(
        screen.getByTestId('business-spatial-scene').dataset.anchorCount,
      ).toBe('1'),
    );
    // The initial viewport fit is an effect after geometry is rendered.
    // Wait for it before isolating the explicit locate action.
    await waitFor(() => expect(probe.fit).toHaveBeenCalledOnce());
    probe.fit.mockClear();
    fireEvent.click(screen.getByRole('button', { name: '定位所选对象' }));
    expect(probe.jump).not.toHaveBeenCalled();
    expect(probe.fit).toHaveBeenCalledOnce();
    const [bounds, options] = probe.fit.mock.calls[0];
    expect(bounds[1][0] - bounds[0][0]).toBeGreaterThan(1.9);
    expect(bounds[1][1] - bounds[0][1]).toBeGreaterThan(0.9);
    expect(typeof options.padding).toBe('object');
    if (typeof options.padding !== 'object')
      throw Error('Expected asymmetric map padding');
    expect(options.padding.right).toBeGreaterThan(options.padding.left);
    expect(options.duration).toBe(0);
  },
);

it('keeps explicit OSM attribution visible outside the interactive canvas', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          ...page,
          features: page.features.map((f) => ({
            ...f,
            properties: {
              ...f.properties,
              values: { c6: '© OpenStreetMap contributors · ODbL 1.0' },
            },
          })),
        }),
    }),
  );
  render(<BusinessSceneMap {...props} />);
  const link = await screen.findByRole('link', {
    name: '© OpenStreetMap contributors · ODbL 1.0',
  });
  expect(link.getAttribute('href')).toBe(
    'https://www.openstreetmap.org/copyright',
  );
  expect(link.closest('svg')).toBeNull();
});

it('offers named, source-distinct unlocated objects with searchable paging without fetching another scope', async () => {
  const fetch = vi.fn().mockResolvedValue(Response.json(page));
  vi.stubGlobal('fetch', fetch);
  const nodes = Array.from({ length: 45 }, (_, i) => ({
    ...scene.nodes[1],
    id: `place-${i}`,
    label: '永定河平原段',
    sourceTitle: `月报-${String(i).padStart(2, '0')}`,
  }));
  render(
    <BusinessSceneMap
      {...props}
      scene={{ nodes: [scene.nodes[0], ...nodes], edges: [] }}
    />,
  );
  await waitFor(() =>
    expect(
      screen.getByTestId('business-spatial-scene').dataset.anchorCount,
    ).toBe('1'),
  );
  const search = screen.getByRole('searchbox', { name: '查找未定位资料' });
  expect(
    screen.getByRole('button', { name: /永定河平原段.*月报-00/ }),
  ).toBeTruthy();
  fireEvent.change(search, { target: { value: '月报-44' } });
  const match = screen.getByRole('button', { name: /永定河平原段.*月报-44/ });
  fireEvent.click(match);
  expect(props.onSelect).toHaveBeenCalledWith('place-44');
  expect(fetch).toHaveBeenCalledTimes(1);
  fireEvent.change(search, { target: { value: '没有的来源' } });
  expect(
    screen.getByText('当前列表没有匹配对象，可清除条件重试。'),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '清除查找条件' }));
  expect(
    screen.getByRole('button', { name: '下一页资料' }).hasAttribute('disabled'),
  ).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: '下一页资料' }));
  expect(
    screen.queryByRole('button', { name: /永定河平原段.*月报-00/ }),
  ).toBeNull();
});

it('keeps map relations quiet until selected and offers an explicit full-network option', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(page)));
  const edge = {
    id: 'link',
    from: 'bound',
    to: 'unlocated',
    row: {
      status: 'PENDING_REVIEW',
      candidate: {
        predicate: 'ABOUT_ENTITY',
        subject: { label: '资料' },
        object: { label: '同名地点' },
      },
    },
  } as BusinessScene['edges'][number];
  const view = render(
    <BusinessSceneMap {...props} scene={{ ...scene, edges: [edge] }} />,
  );
  await waitFor(() =>
    expect(
      screen.getByTestId('business-spatial-scene').dataset.anchorCount,
    ).toBe('1'),
  );
  act(() => probe.load?.());
  expect(view.container.querySelector('[data-edge-id="link"]')).toBeNull();
  fireEvent.click(
    screen.getByRole('checkbox', { name: '显示本页对象的全部连线' }),
  );
  expect(view.container.querySelector('[data-edge-id="link"]')).toBeTruthy();
  expect(view.container.querySelectorAll('[data-node-id]')).toHaveLength(2);
});

it('selects a real map geometry and exposes its related source without moving the camera', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(page)));
  const linked: BusinessScene = {
    nodes: [
      { ...scene.nodes[0], kind: 'PLACE' },
      {
        ...scene.nodes[1],
        id: 'report',
        label: '区域研究报告',
        kind: 'DOCUMENT',
        sourceTitle: '公开研究',
      },
    ],
    edges: [
      {
        id: 'report-area',
        from: 'report',
        to: 'bound',
        row: {
          status: 'PENDING_REVIEW',
          candidate: { predicate: 'ABOUT_ENTITY' },
        } as RelationAssertion,
      },
    ],
  };
  render(<BusinessSceneMap {...props} scene={linked} />);
  await waitFor(() =>
    expect(
      screen.getByTestId('business-spatial-scene').getAttribute('data-state'),
    ).toBe('ready'),
  );
  expect(probe.interactiveLayers).toContain('business-scene-areas');
  expect(probe.interactiveLayers).toContain('business-scene-outlines');
  expect(probe.click).toBeTypeOf('function');
  act(() => probe.click?.({ features: [{ properties: record }] }));
  expect(props.onSelect).toHaveBeenCalledWith('bound');
  fireEvent.click(
    screen.getByRole('button', { name: /区域研究报告.*公开研究/ }),
  );
  expect(props.onEdge).toHaveBeenCalledWith('report-area');
  expect(probe.fit).not.toHaveBeenCalled();
  expect(probe.jump).not.toHaveBeenCalled();
});
it('offers every overlapping binding and a keyboard choice instead of choosing the first match', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(page)));
  render(
    <BusinessSceneMap
      {...props}
      scene={{
        ...scene,
        nodes: [
          ...scene.nodes,
          {
            ...scene.nodes[0],
            id: 'other',
            label: '区域范围',
            sourceTitle: '另一来源',
          },
        ],
      }}
    />,
  );
  await waitFor(() =>
    expect(
      screen.getByTestId('business-spatial-scene').getAttribute('data-state'),
    ).toBe('ready'),
  );
  expect(probe.click).toBeTypeOf('function');
  act(() =>
    probe.click?.({
      features: [{ properties: record }, { properties: record }],
    }),
  );
  expect(props.onSelect).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: /区域范围.*另一来源/ }));
  expect(props.onSelect).toHaveBeenCalledWith('other');
});

it('restores a source-qualified map object only after its authorized geometry loads and clears it on return', async () => {
  let finish!: (response: Response) => void;
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    ),
  );
  const onMapObject = vi.fn();
  render(
    <BusinessSceneMap {...props} mapObject="bound" onMapObject={onMapObject} />,
  );
  expect(
    screen.queryByRole('region', { name: '此处关联的资料与知识' }),
  ).toBeNull();
  await act(async () => {
    finish(Response.json(page));
    await Promise.resolve();
  });
  expect(
    await screen.findByRole('region', { name: '此处关联的资料与知识' }),
  ).toBeTruthy();
  expect(
    screen
      .getByRole('button', { name: /影像覆盖范围/ })
      .getAttribute('aria-pressed'),
  ).toBe('true');
  fireEvent.click(screen.getByRole('button', { name: '返回未定位资料列表' }));
  expect(onMapObject).toHaveBeenCalledWith(null);
  expect(
    screen.queryByRole('region', { name: '此处关联的资料与知识' }),
  ).toBeNull();
});
it.each(['unlocated', 'missing'])(
  'does not restore a map target without an authorized exact binding: %s',
  async (mapObject) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(page)));
    render(
      <BusinessSceneMap
        {...props}
        mapObject={mapObject}
        onMapObject={vi.fn()}
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId('business-spatial-scene').dataset.state).toBe(
        'ready',
      ),
    );
    expect(
      screen.queryByRole('region', { name: '此处关联的资料与知识' }),
    ).toBeNull();
  },
);
it('persists an unambiguous map selection without persisting hit geometry or source text', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(page)));
  const onMapObject = vi.fn();
  render(<BusinessSceneMap {...props} onMapObject={onMapObject} />);
  await waitFor(() =>
    expect(screen.getByTestId('business-spatial-scene').dataset.state).toBe(
      'ready',
    ),
  );
  act(() => probe.click?.({ features: [{ properties: record }] }));
  expect(onMapObject).toHaveBeenCalledWith('bound');
});

it('preserves overlap choices when clearing a previous URL selection and follows later history restoration', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(page)));
  const overlapping = {
    ...scene,
    nodes: [
      ...scene.nodes,
      { ...scene.nodes[0], id: 'other', label: '另一区域' },
    ],
  };
  const onMapObject = vi.fn();
  const view = render(
    <BusinessSceneMap
      {...props}
      scene={overlapping}
      mapObject="bound"
      onMapObject={onMapObject}
    />,
  );
  await screen.findByRole('region', { name: '此处关联的资料与知识' });
  act(() => probe.click?.({ features: [{ properties: record }] }));
  expect(onMapObject).toHaveBeenLastCalledWith(null);
  view.rerender(
    <BusinessSceneMap
      {...props}
      scene={overlapping}
      mapObject={null}
      onMapObject={onMapObject}
    />,
  );
  expect(screen.getByRole('button', { name: /另一区域/ })).toBeTruthy();
  expect(props.onSelect).not.toHaveBeenCalled();
  view.rerender(
    <BusinessSceneMap
      {...props}
      scene={overlapping}
      mapObject="bound"
      onMapObject={onMapObject}
    />,
  );
  expect(
    screen
      .getByRole('button', { name: /影像覆盖范围/ })
      .getAttribute('aria-pressed'),
  ).toBe('true');
  expect(screen.queryByRole('button', { name: /另一区域/ })).toBeNull();
});
