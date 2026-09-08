// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cleanup,
  act,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  ExplorationResultSchema,
  type ExplorationResult,
} from '@wiser/data-contracts';
import { DataExplorer } from './data-explorer';

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
