// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { ExplorationViewContext } from './exploration-view-context';
import { createExplorationViewState } from '@/lib/exploration-view-state';
import { ExplorationViewSpecSchema } from '@wiser/data-contracts';
import type { ExplorationResult } from '@wiser/data-contracts';
import { DataExplorerGraph } from './data-explorer-graph';
const probe = vi.hoisted(() => ({
  props: {} as {
    result?: unknown;
    onSelect?: (id: string) => void;
    path?: unknown;
  },
}));
vi.mock('./data-foundation-graph', () => ({
  KnowledgeGraphCanvas: (props: typeof probe.props) => {
    probe.props = props;
    return <div data-testid="canvas" />;
  },
}));
function requestBody(value: unknown): unknown {
  if (typeof value !== 'string') throw new Error('Expected JSON body');
  return JSON.parse(value) as unknown;
}
const id = '10000000-0000-4000-8000-000000000001';
const node = {
  id: `version:${id}`,
  kind: 'VERSION' as const,
  label: 'v1',
  dataItemId: id,
  versionId: id,
};
const result: ExplorationResult = {
  queryId: id,
  spec: {},
  view: 'graph',
  createdAt: '2026-09-08T00:00:00Z',
  expiresAt: '2026-09-08T00:30:00Z',
  resources: [],
  totalCount: 1,
  graph: {
    nodes: [
      node,
      {
        ...node,
        id: `asset:${id}:${id}`,
        kind: 'ASSET',
        assetId: id,
        label: 'file.json',
      },
    ],
    edges: [
      {
        id: 'edge',
        source: node.id,
        target: `asset:${id}:${id}`,
        relation: 'HAS_ASSET',
      },
    ],
    truncated: false,
    grain: 'versions',
  },
};
const props = {
  queryId: id,
  locale: 'en' as const,
  versionId: null,
  selectedRecord: null,
  selectedNode: null,
  onSelect: vi.fn(),
  onInvalidated: vi.fn(),
};
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});
it('expands a selected asset, pages neighbors and returns to the overview', async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify(result))),
    );
  vi.stubGlobal('fetch', fetcher);
  const user = userEvent.setup();
  const rendered = render(<DataExplorerGraph {...props} />);
  await screen.findByTestId('canvas');
  act(() => probe.props.onSelect?.(`asset:${id}:${id}`));
  expect(props.onSelect).toHaveBeenCalledWith(result.graph!.nodes[1]);
  rendered.rerender(
    <DataExplorerGraph {...props} selectedNode={result.graph!.nodes[1]} />,
  );
  await user.click(screen.getByRole('button', { name: 'Expand records' }));
  await waitFor(() =>
    expect(fetcher).toHaveBeenLastCalledWith(
      '/api/data-foundation/explore',
      expect.objectContaining({
        body: expect.stringContaining('"detail":"records"') as unknown,
      }),
    ),
  );
  expect(requestBody(fetcher.mock.calls.at(-1)?.[1]?.body)).toMatchObject({
    versionId: id,
    assetId: id,
  });
  await user.click(screen.getByRole('button', { name: 'Show query overview' }));
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
});
it('queries relation filters and a bounded path without exposing arbitrary endpoints', async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify(result))),
    );
  vi.stubGlobal('fetch', fetcher);
  const user = userEvent.setup();
  render(<DataExplorerGraph {...props} />);
  await screen.findByTestId('canvas');
  await user.click(screen.getByText('Relations and path'));
  await user.click(screen.getByRole('checkbox', { name: 'Contains evidence' }));
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  const body = requestBody(fetcher.mock.calls.at(-1)?.[1]?.body) as {
    graph: { relations: string[] };
  };
  expect(body.graph.relations).not.toContain('HAS_EVIDENCE');
  await user.selectOptions(screen.getByLabelText('Path start'), node.id);
  await user.selectOptions(
    screen.getByLabelText('Path end'),
    `asset:${id}:${id}`,
  );
  await user.click(screen.getByRole('button', { name: 'Find directed path' }));
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
  expect(requestBody(fetcher.mock.calls.at(-1)?.[1]?.body)).toMatchObject({
    graph: { path: { from: node.id, to: `asset:${id}:${id}`, maxDepth: 8 } },
  });
});
it('invalidates revoked scope, retries transient failures and rejects mismatched query responses', async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(new Response('', { status: 503 }))
    .mockResolvedValueOnce(new Response('', { status: 403 }));
  vi.stubGlobal('fetch', fetcher);
  const user = userEvent.setup();
  const rendered = render(<DataExplorerGraph {...props} />);
  await screen.findByRole('alert');
  expect(props.onInvalidated).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Try again' }));
  await waitFor(() =>
    expect(props.onInvalidated).toHaveBeenCalledWith(id, 403),
  );
  rendered.unmount();
  fetcher.mockResolvedValue(
    new Response(
      JSON.stringify({
        ...result,
        queryId: '20000000-0000-4000-8000-000000000001',
      }),
    ),
  );
  render(<DataExplorerGraph {...props} />);
  await screen.findByRole('alert');
  expect(screen.queryByTestId('canvas')).toBeNull();
});

it('paginates bounded neighbors and ignores a response after cancellation', async () => {
  const fetcher = vi.fn<typeof fetch>().mockImplementation((_url, init) => {
    const body = requestBody(init?.body) as { after?: string };
    return Promise.resolve(
      new Response(
        JSON.stringify({
          ...result,
          ...(body.after ? {} : { nextCursor: 'next-page' }),
        }),
      ),
    );
  });
  vi.stubGlobal('fetch', fetcher);
  const user = userEvent.setup();
  const rendered = render(<DataExplorerGraph {...props} />);
  await screen.findByTestId('canvas');
  await user.click(screen.getByRole('button', { name: 'Next page' }));
  await waitFor(() =>
    expect(requestBody(fetcher.mock.calls.at(-1)?.[1]?.body)).toMatchObject({
      after: 'next-page',
    }),
  );
  await waitFor(() =>
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Next page' })
        .disabled,
    ).toBe(true),
  );
  await user.click(screen.getByRole('button', { name: 'Previous page' }));
  await waitFor(() =>
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Previous page' })
        .disabled,
    ).toBe(true),
  );
  rendered.unmount();
  let complete: ((value: Response) => void) | undefined;
  fetcher.mockImplementation(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  const late = render(<DataExplorerGraph {...props} />);
  await waitFor(() => expect(complete).toBeDefined());
  const signal = fetcher.mock.calls.at(-1)?.[1]?.signal;
  late.unmount();
  expect(signal?.aborted).toBe(true);
  await act(async () => {
    complete?.(new Response('', { status: 403 }));
    await Promise.resolve();
  });
  expect(props.onInvalidated).not.toHaveBeenCalled();
});

it('restores saved graph focus, relation filtering and page navigation as one request', async () => {
  const state = createExplorationViewState(
    id,
    ExplorationViewSpecSchema.parse({
      activeView: 'graph',
      requests: {
        graph: {
          queryId: id,
          view: 'graph',
          versionId: id,
          first: 30,
          after: 'neighbors-2',
          graph: {
            detail: 'assets',
            relations: ['HAS_ASSET'],
            path: { from: node.id, to: `asset:${id}:${id}`, maxDepth: 2 },
          },
        },
      },
      navigation: { graph: { page: 1, cursors: [null, 'neighbors-2'] } },
    }),
  );
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValue(Response.json(result));
  vi.stubGlobal('fetch', fetch);
  render(
    <ExplorationViewContext.Provider value={state}>
      <DataExplorerGraph {...props} />
    </ExplorationViewContext.Provider>,
  );
  await waitFor(() =>
    expect(state.capture('graph')?.requests.graph?.after).toBe('neighbors-2'),
  );
  expect(requestBody(fetch.mock.calls[0]?.[1]?.body)).toMatchObject({
    versionId: id,
    after: 'neighbors-2',
    graph: {
      detail: 'assets',
      relations: ['HAS_ASSET'],
      path: { from: node.id, to: `asset:${id}:${id}`, maxDepth: 2 },
    },
  });
  expect(state.capture('graph')?.navigation?.graph?.page).toBe(1);
});
