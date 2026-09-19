// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  act,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  OpenExplorationViewOutputSchema,
  ExplorationResultSchema,
  type ExplorationResult,
} from '@wiser/data-contracts';
import { DataExplorer } from './data-explorer';
import { capturePresentation } from '@/lib/exploration-presentation';
import {
  readRelationView,
  relationSourceExploreHref,
} from '@/lib/relation-navigation';

function inputBody(init?: RequestInit): unknown {
  if (typeof init?.body !== 'string') throw new Error('Expected a JSON body');
  return JSON.parse(init.body);
}

const firstId = '10000000-0000-4000-8000-000000000001';
const secondId = '10000000-0000-4000-8000-000000000002';
function result(
  queryId: string,
  name: string,
  text: string,
): ExplorationResult {
  const now = Date.now();
  return ExplorationResultSchema.parse({
    queryId,
    spec: { text },
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 1800000).toISOString(),
    view: 'resources',
    totalCount: 1,
    resources: [
      {
        dataItemId: '20000000-0000-4000-8000-000000000001',
        versionId: '30000000-0000-4000-8000-000000000001',
        name,
        provider: 'Fixture provider',
        kind: 'CATALOG_ENTRY',
        assetCount: 1,
        recordCount: null,
        featureCount: null,
        limitations: [],
        readiness: {
          records: 'NOT_PARSED',
          spatial: 'NOT_PARSED',
          graph: 'NOT_PARSED',
        },
      },
    ],
  });
}
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
describe('exploration query navigation', () => {
  it('creates an owner-bound record query and restores the records view without a selected resource', async () => {
    const initial = result(firstId, 'Station source', 'station');
    const resource = initial.resources[0];
    const assetId = '40000000-0000-4000-8000-000000000001';
    const recordQuery = {
      assetId,
      filters: [
        {
          field: 'c1',
          type: 'text' as const,
          operator: 'eq' as const,
          value: '0001',
        },
      ],
    };
    const filtered = {
      ...initial,
      queryId: secondId,
      spec: {
        text: 'station',
        versions: [
          { dataItemId: resource.dataItemId, versionId: resource.versionId },
        ],
        recordQuery,
      },
    };
    const records = {
      ...initial,
      view: 'records',
      resources: [],
      selectedAssetId: assetId,
      assets: [
        {
          assetId,
          sourceHash: 'a'.repeat(64),
          status: 'READY',
          recordCount: 1,
          featureCount: 0,
          reason: null,
          paths: ['station.csv'],
          columns: [{ key: 'c1', label: 'Station' }],
        },
      ],
      records: [
        {
          recordId: '50000000-0000-4000-8000-000000000001',
          featureId: null,
          dataItemId: resource.dataItemId,
          versionId: resource.versionId,
          analysisId: '60000000-0000-4000-8000-000000000001',
          assetId,
          sourceId: null,
          index: 1,
          values: { c1: '0001' },
        },
      ],
    };
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json(records))
      .mockResolvedValueOnce(Response.json(filtered))
      .mockResolvedValueOnce(
        Response.json({ ...records, queryId: secondId, spec: filtered.spec }),
      );
    vi.stubGlobal('fetch', fetch);
    const user = userEvent.setup();
    render(
      <DataExplorer
        locale="en"
        initialResult={initial}
        initialFailure={null}
        initialText=""
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Station source' }));
    await user.click(screen.getByRole('tab', { name: 'Records' }));
    await screen.findByText('0001');
    await user.click(screen.getByText('Record conditions'));
    await user.click(screen.getByRole('button', { name: 'Add condition' }));
    await user.type(screen.getByLabelText('Value'), '0001');
    await user.click(
      screen.getByRole('button', { name: 'Apply to all views' }),
    );
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
    expect(inputBody(fetch.mock.calls[1][1] as RequestInit)).toEqual({
      baseQueryId: firstId,
      spec: filtered.spec,
      view: 'resources',
      first: 25,
    });
    expect(inputBody(fetch.mock.calls[2][1] as RequestInit)).toMatchObject({
      queryId: secondId,
      view: 'records',
      versionId: resource.versionId,
    });
    await screen.findByText('0001');
    expect(window.location.search).toBe(`?query=${secondId}&view=records`);
    expect(
      screen
        .getByRole('tab', { name: 'Records' })
        .getAttribute('aria-selected'),
    ).toBe('true');
  });
  it('submits all visible filters as one query and pages without changing its identity', async () => {
    const initial = result(firstId, 'First source', 'first');
    const filtered = {
      ...result(secondId, 'Filtered source', 'second'),
      nextCursor: 'next-page',
    };
    const last = {
      ...filtered,
      resources: [{ ...filtered.resources[0], name: 'Last source' }],
      nextCursor: undefined,
    };
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json(filtered))
      .mockResolvedValueOnce(Response.json(last))
      .mockResolvedValueOnce(Response.json(filtered));
    vi.stubGlobal('fetch', fetch);
    const user = userEvent.setup();
    render(
      <DataExplorer
        locale="zh-CN"
        initialResult={initial}
        initialFailure={null}
        initialText=""
      />,
    );
    await user.clear(screen.getByLabelText('查询数据'));
    await user.type(screen.getByLabelText('查询数据'), ' second ');
    await user.selectOptions(screen.getByLabelText('质量等级'), 'B');
    await user.click(screen.getByText('更多筛选'));
    await user.type(screen.getByLabelText('提供机构（完整名称）'), ' Example ');
    await user.selectOptions(
      screen.getByLabelText('登记类型'),
      'FILE_COLLECTION',
    );
    await user.selectOptions(screen.getByLabelText('内容就绪状态'), 'READY');
    await user.selectOptions(
      screen.getByLabelText('空间就绪状态'),
      'CRS_UNVERIFIED',
    );
    await user.click(screen.getByRole('button', { name: '查询' }));
    await screen.findByRole('button', { name: 'Filtered source' });
    expect(inputBody(fetch.mock.calls[0][1] as RequestInit)).toEqual({
      spec: {
        text: 'second',
        providers: ['Example'],
        kinds: ['FILE_COLLECTION'],
        qualityGrades: ['B'],
        readiness: { records: ['READY'], spatial: ['CRS_UNVERIFIED'] },
      },
      view: 'resources',
      first: 25,
    });
    await user.click(screen.getByRole('button', { name: '下一页' }));
    await screen.findByRole('button', { name: 'Last source' });
    expect(inputBody(fetch.mock.calls[1][1] as RequestInit)).toEqual({
      queryId: secondId,
      view: 'resources',
      first: 25,
      after: 'next-page',
    });
    await user.click(screen.getByRole('button', { name: '上一页' }));
    await screen.findByRole('button', { name: 'Filtered source' });
    expect(inputBody(fetch.mock.calls[2][1] as RequestInit)).toEqual({
      queryId: secondId,
      view: 'resources',
      first: 25,
    });
  });

  it.each([401, 403, 404, 409, 410, 422])(
    'clears selected data on an authority failure (%s)',
    async (status) => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(new Response('', { status })),
      );
      const user = userEvent.setup();
      render(
        <DataExplorer
          locale="zh-CN"
          initialResult={result(firstId, 'First source', 'first')}
          initialFailure={null}
          initialText=""
        />,
      );
      await user.click(screen.getByRole('button', { name: 'First source' }));
      await user.click(screen.getByRole('button', { name: '查询' }));
      await screen.findByRole('alert');
      expect(
        screen.getByTestId('data-explorer').getAttribute('data-query-id'),
      ).toBe('');
      expect(screen.queryByRole('button', { name: 'First source' })).toBeNull();
      expect(
        screen.getByTestId('explorer-inspector').textContent,
      ).not.toContain('Fixture provider');
    },
  );

  it('ignores a late aborted result and keeps the newest query', async () => {
    let finish: ((value: Response) => void) | undefined;
    const fetch = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValueOnce(
        Response.json(result(secondId, 'Newest source', 'newest')),
      );
    vi.stubGlobal('fetch', fetch);
    const user = userEvent.setup();
    render(
      <DataExplorer
        locale="zh-CN"
        initialResult={result(firstId, 'First source', 'first')}
        initialFailure={null}
        initialText=""
      />,
    );
    await user.click(screen.getByRole('button', { name: '查询' }));
    await user.click(screen.getByRole('button', { name: '查询中…' }));
    await screen.findByRole('button', { name: 'Newest source' });
    await act(async () => {
      finish?.(Response.json(result(firstId, 'Stale source', 'stale')));
      await Promise.resolve();
    });
    expect(screen.queryByRole('button', { name: 'Stale source' })).toBeNull();
    expect((fetch.mock.calls[0][1] as RequestInit).signal?.aborted).toBe(true);
  });

  it('keeps recoverable failures local and supports keyboard view navigation and clearing selection', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')));
    const user = userEvent.setup();
    render(
      <DataExplorer
        locale="zh-CN"
        initialResult={result(firstId, 'First source', 'first')}
        initialFailure={null}
        initialText=""
      />,
    );
    await user.click(screen.getByRole('button', { name: 'First source' }));
    await user.click(
      within(screen.getByTestId('explorer-inspector')).getByRole('button'),
    );
    expect(screen.getByText('选择数据查看详情')).toBeTruthy();
    await user.click(screen.getByRole('tab', { name: '资源' }));
    await user.keyboard('{ArrowRight}');
    expect(
      screen.getByRole('tab', { name: '记录' }).getAttribute('aria-selected'),
    ).toBe('true');
    expect(new URL(window.location.href).searchParams.get('view')).toBe(
      'records',
    );
    expect(screen.getByText('先选择一个资源，再查看其中的记录。')).toBeTruthy();
    await user.keyboard('{Home}');
    await user.click(screen.getByRole('button', { name: '查询' }));
    await screen.findByRole('alert');
    expect(screen.getByRole('button', { name: 'First source' })).toBeTruthy();
  });

  it('restores authorized query conditions from browser history without embedding filters in the URL', async () => {
    window.history.replaceState(
      { framework: 'preserved' },
      '',
      '/zh-CN/data-foundation/explore?q=first',
    );
    const first = result(firstId, 'First source', 'first');
    const second = result(secondId, 'Second source', 'second');
    const fetch = vi.fn((_url: unknown, init?: RequestInit) => {
      const input = inputBody(init) as { queryId?: string };
      return Promise.resolve(
        Response.json(input.queryId === firstId ? first : second),
      );
    });
    vi.stubGlobal('fetch', fetch);
    const user = userEvent.setup();
    render(
      <DataExplorer
        locale="zh-CN"
        initialResult={first}
        initialFailure={null}
        initialText="first"
      />,
    );
    await user.click(screen.getByRole('button', { name: 'First source' }));
    expect(
      within(screen.getByTestId('explorer-inspector')).getByText(
        'Fixture provider',
      ),
    ).toBeTruthy();
    const before = window.history.length;
    await user.clear(screen.getByLabelText('查询数据'));
    await user.type(screen.getByLabelText('查询数据'), 'second');
    await user.click(screen.getByRole('button', { name: '查询' }));
    await screen.findByRole('button', { name: 'Second source' });
    expect(window.history.length).toBe(before + 1);
    expect(new URL(window.location.href).searchParams.get('q')).toBeNull();
    expect(window.history.state).toMatchObject({ framework: 'preserved' });
    window.history.back();
    await screen.findByRole('button', { name: 'First source' });
    await waitFor(() =>
      expect(screen.getByLabelText<HTMLInputElement>('查询数据').value).toBe(
        'first',
      ),
    );
    expect(screen.getByTestId('explorer-inspector').textContent).not.toContain(
      'Fixture provider',
    );
  });
});

it('preserves the resource page size of views saved through the shared API', async () => {
  const initial = result(firstId, 'Station source', 'station');
  const saved = OpenExplorationViewOutputSchema.parse({
    savedView: {
      viewId: secondId,
      title: 'One resource per page',
      visibility: 'private',
      createdAt: initial.createdAt,
      revokedAt: null,
    },
    result: initial,
    viewSpec: {
      activeView: 'resources',
      requests: {
        resources: {
          queryId: firstId,
          view: 'resources',
          first: 1,
          after: 'resource-page-2',
        },
      },
      navigation: {
        resources: { page: 1, cursors: [null, 'resource-page-2'] },
      },
    },
  });
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(Response.json(initial));
  vi.stubGlobal('fetch', fetch);
  const user = userEvent.setup();
  render(
    <DataExplorer
      locale="en"
      initialResult={initial}
      initialFailure={null}
      initialText="station"
      initialSaved={saved}
    />,
  );
  await user.click(screen.getByRole('button', { name: 'Previous page' }));
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  expect(inputBody(fetch.mock.calls[0]?.[1])).toMatchObject({
    first: 1,
    view: 'resources',
    queryId: firstId,
  });
});

it('preserves a source-bound graph return across exploration history replacement and record tabs', async () => {
  const initial = result(firstId, 'Station source', 'station');
  const pin = {
    dataItemId: initial.resources[0].dataItemId,
    versionId: initial.resources[0].versionId,
  };
  const context = {
    ...pin,
    sources: [],
    status: 'PENDING_REVIEW' as const,
    preview: true,
    pages: 2,
    entity: JSON.stringify([pin.dataItemId, pin.versionId, 'v1', 'river']),
  };
  window.history.replaceState(
    null,
    '',
    relationSourceExploreHref('en', context, pin, 'records'),
  );
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve(
        Response.json({
          ...initial,
          view: 'records',
          records: [],
          assets: [],
          resources: [],
          totalCount: 0,
        }),
      ),
    ),
  );
  render(
    <DataExplorer
      locale="en"
      initialResult={initial}
      initialFailure={null}
      initialText="station"
    />,
  );
  const back = await screen.findByRole('link', {
    name: 'Return to the previous business graph',
  });
  expect(
    readRelationView(
      new URL(back.getAttribute('href')!, 'http://localhost').search,
      pin,
    ),
  ).toEqual(context);
  expect(
    JSON.parse(
      new URLSearchParams(window.location.search).get('returnRelations')!,
    ),
  ).toEqual(context);
  await userEvent.setup().click(screen.getByRole('tab', { name: 'Records' }));
  expect(new URLSearchParams(window.location.search).get('view')).toBe(
    'records',
  );
  expect(
    JSON.parse(
      new URLSearchParams(window.location.search).get('returnRelations')!,
    ),
  ).toEqual(context);
  expect(back.getAttribute('href')).toContain('#business-relations');
  window.history.replaceState(null, '', '/');
});

it('restores an exact record through its authorized query on history and never substitutes a missing record', async () => {
  const data = result(firstId, 'Spatial product', 'spatial');
  const source = data.resources[0];
  const record = {
    recordId: '50000000-0000-4000-8000-000000000001',
    featureId: '50000000-0000-4000-8000-000000000001',
    dataItemId: source.dataItemId,
    versionId: source.versionId,
    analysisId: '60000000-0000-4000-8000-000000000001',
    assetId: '70000000-0000-4000-8000-000000000001',
    sourceId: 'source-band-1',
    index: 1,
    values: { band: 1 },
  };
  const focus = {
    dataItemId: record.dataItemId,
    versionId: record.versionId,
    recordId: record.recordId,
  };
  const focused = `?query=${firstId}&recordFocus=${encodeURIComponent(JSON.stringify(focus))}`;
  window.history.replaceState(
    null,
    '',
    '/zh-CN/data-foundation/explore' + focused,
  );
  const records = ExplorationResultSchema.parse({
    ...data,
    view: 'records',
    resources: [],
    totalCount: 1,
    records: [record],
    assets: [
      {
        assetId: record.assetId,
        sourceHash: 'a'.repeat(64),
        status: 'READY',
        recordCount: 1,
        featureCount: 1,
        reason: null,
        paths: ['image.tif'],
        columns: [{ key: 'band', label: 'Band' }],
      },
    ],
  });
  let missing = false;
  const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
    await Promise.resolve();
    const request = inputBody(init) as { recordId?: string };
    return Response.json(
      request.recordId
        ? {
            ...records,
            totalCount: missing ? 0 : 1,
            records: missing ? [] : [record],
          }
        : data,
    );
  });
  vi.stubGlobal('fetch', fetcher);
  render(
    <DataExplorer
      locale="zh-CN"
      initialResult={data}
      initialFailure={null}
      initialText=""
      initialFocusedRecord={record}
    />,
  );
  expect(screen.getByText('source-band-1')).toBeTruthy();
  expect(new URLSearchParams(window.location.search).get('recordFocus')).toBe(
    JSON.stringify(focus),
  );
  act(() => {
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  await waitFor(() =>
    expect(
      fetcher.mock.calls.some(
        (c) =>
          (inputBody(c[1]) as { recordId?: string }).recordId ===
          record.recordId,
      ),
    ).toBe(true),
  );
  await screen.findByText('source-band-1');
  missing = true;
  act(() => {
    window.history.replaceState(
      null,
      '',
      '/zh-CN/data-foundation/explore' + focused,
    );
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  await screen.findByRole('alert');
  expect(screen.queryByText('source-band-1')).toBeNull();
});

it('preserves business node and category focus when initializing an existing query URL', () => {
  const identity = JSON.stringify([
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    'mapping-v1',
    'band:1',
  ]);
  window.history.replaceState(
    null,
    '',
    '/zh-CN/data-foundation/explore?' +
      new URLSearchParams({
        query: firstId,
        businessEntity: identity,
        businessKind: 'OBSERVATION',
      }).toString(),
  );
  render(
    <DataExplorer
      locale="zh-CN"
      initialResult={result(firstId, 'Band source', 'band')}
      initialFailure={null}
      initialText=""
    />,
  );
  const params = new URLSearchParams(window.location.search);
  expect(params.get('businessEntity')).toBe(identity);
  expect(params.get('businessKind')).toBe('OBSERVATION');
});

it('switches the visible view when a record return link supplies new route props', () => {
  const data = result(firstId, 'Band source', 'band');
  const props = {
    locale: 'zh-CN' as const,
    initialResult: data,
    initialFailure: null,
    initialText: '',
  };
  const rendered = render(<DataExplorer {...props} initialView="resources" />);
  rendered.rerender(<DataExplorer {...props} initialView="graph" />);
  expect(
    screen.getByRole('tab', { name: '知识图谱' }).getAttribute('aria-selected'),
  ).toBe('true');
});

it('does not submit a partial Chinese composition and searches after the composition ends', async () => {
  const initial = result(firstId, '永定河资料', '永定河');
  const fetcher = vi
    .fn()
    .mockResolvedValue(Response.json(result(secondId, '永定河资料', '永定河')));
  vi.stubGlobal('fetch', fetcher);
  render(
    <DataExplorer
      locale="zh-CN"
      initialResult={initial}
      initialFailure={null}
      initialText="永定河"
    />,
  );
  const input = screen.getByLabelText('查询数据');
  const before = fetcher.mock.calls.length;
  fireEvent.compositionStart(input);
  fireEvent.change(input, { target: { value: 'yong' } });
  fireEvent.submit(input.closest('form')!);
  expect(fetcher.mock.calls.length).toBe(before);
  fireEvent.compositionEnd(input, { data: '永定河' });
  fireEvent.change(input, { target: { value: '永定河' } });
  fireEvent.submit(input.closest('form')!);
  await waitFor(() =>
    expect(fetcher.mock.calls.length).toBeGreaterThan(before),
  );
});

it('restores a saved presentation after router initialization and preserves an intervening explicit choice', async () => {
  const initial = result(firstId, 'Station source', 'station');
  const presentation = capturePresentation(
    new URLSearchParams('businessForm=space&businessStyle=evidence'),
  );
  const saved = OpenExplorationViewOutputSchema.parse({
    savedView: {
      viewId: secondId,
      title: 'Spatial scene',
      visibility: 'private',
      createdAt: initial.createdAt,
      revokedAt: null,
    },
    result: initial,
    viewSpec: {
      activeView: 'resources',
      requests: { resources: { queryId: firstId, view: 'resources' } },
      presentation,
    },
  });
  window.history.replaceState(
    null,
    '',
    '/en/data-foundation/explore?saved=' + secondId,
  );
  const { unmount } = render(
    <DataExplorer
      locale="en"
      initialResult={initial}
      initialFailure={null}
      initialText="station"
      initialSaved={saved}
    />,
  );
  // The enclosing Next router installs its history listener after child mount effects.
  expect(new URLSearchParams(window.location.search).has('businessForm')).toBe(
    false,
  );
  window.history.replaceState(
    null,
    '',
    window.location.href + '&businessStyle=smooth',
  );
  await waitFor(() =>
    expect(
      new URLSearchParams(window.location.search).get('businessForm'),
    ).toBe('space'),
  );
  expect(new URLSearchParams(window.location.search).get('businessStyle')).toBe(
    'smooth',
  );
  expect(new URLSearchParams(window.location.search).get('saved')).toBe(
    secondId,
  );
  unmount();
  window.history.replaceState(null, '', '/');
});
