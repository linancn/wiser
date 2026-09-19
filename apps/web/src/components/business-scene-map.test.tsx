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
      { children?: ReactNode; onLoad: () => void; onMoveEnd: () => void }
    >((p, ref) => {
      probe.load = p.onLoad;
      probe.move = p.onMoveEnd;
      useImperativeHandle(ref, () => ({
        fitBounds: probe.fit,
        getZoom: () => 8,
        getCenter: () => ({ lng: 115, lat: 40 }),
        project: () => ({ x: 100, y: 100 }),
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

it('uses available space for large unlocated groups without collapsing members or overlapping their symbols', async () => {
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
  const circles = [
    ...screen
      .getByTestId('business-spatial-scene')
      .querySelectorAll('[data-node-id] circle'),
  ];
  expect(circles).toHaveLength(600);
  for (const [i, circle] of circles.entries()) {
    const x = Number(circle.getAttribute('cx')),
      y = Number(circle.getAttribute('cy'));
    expect(x).toBeGreaterThan(570);
    expect(x).toBeLessThan(1000);
    expect(y).toBeGreaterThan(35);
    expect(y).toBeLessThan(640);
    for (const other of circles.slice(i + 1)) {
      expect(
        Math.hypot(
          x - Number(other.getAttribute('cx')),
          y - Number(other.getAttribute('cy')),
        ),
      ).toBeGreaterThan(6);
    }
  }
});

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
