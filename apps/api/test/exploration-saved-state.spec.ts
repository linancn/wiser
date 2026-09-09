import { expect, it, vi } from 'vitest';
import {
  ExplorationViewSpecSchema,
  ExplorationResultSchema,
} from '@wiser/data-contracts';
import { rebindExplorationView } from '../src/data-foundation/exploration-saved-state.js';
import { createExplorationSavedExecutors } from '../src/data-foundation/exploration-saved.js';
import { PostgresExplorationExecutor } from '../src/data-foundation/exploration-runtime.js';
import type { QueryAdapterPgPool } from '../src/data-foundation/query-adapters.js';
import type { DataCapabilityExecutionContext } from '../src/data-foundation/capability-handler.js';
const id = '10000000-0000-4000-8000-000000000001',
  next = '20000000-0000-4000-8000-000000000001';
const encode = (value: unknown) =>
  Buffer.from(JSON.stringify(value)).toString('base64url');
it('reissues resource and graph continuations without modifying source identities or the saved input', () => {
  const graphCursor = encode({
    binding: JSON.stringify({
      queryId: id,
      view: 'graph',
      versionId: id,
      detail: 'records',
    }),
    offset: 31,
  });
  const resourceCursor = encode({ queryId: id, offset: 25 });
  const view = ExplorationViewSpecSchema.parse({
    activeView: 'graph',
    requests: {
      resources: { queryId: id, view: 'resources', after: resourceCursor },
      graph: { queryId: id, view: 'graph', versionId: id, after: graphCursor },
    },
    navigation: {
      resources: { page: 1, cursors: [null, resourceCursor] },
      graph: { page: 1, cursors: [null, graphCursor] },
    },
    selection: { dataItemId: id, versionId: id },
  });
  const restored = rebindExplorationView(view, id, next);
  expect(restored.requests.resources?.after).toBe(
    encode({ queryId: next, offset: 25 }),
  );
  expect(restored.requests.graph?.after).toBe(
    encode({
      binding: JSON.stringify({
        queryId: next,
        view: 'graph',
        versionId: id,
        detail: 'records',
      }),
      offset: 31,
    }),
  );
  expect(restored.navigation?.graph?.cursors[1]).toBe(
    restored.requests.graph?.after,
  );
  expect(restored.selection).toEqual(view.selection);
  expect(view.requests.graph?.queryId).toBe(id);
  for (const cursor of [
    'invalid',
    encode({ queryId: next, offset: 1 }),
    encode({ binding: JSON.stringify({ queryId: next }), offset: 1 }),
    encode({ queryId: id, offset: -1 }),
  ])
    expect(() =>
      rebindExplorationView(
        {
          ...view,
          activeView: 'resources',
          requests: {
            resources: {
              queryId: id,
              view: 'resources',
              first: 25,
              after: cursor,
            },
          },
        },
        id,
        next,
      ),
    ).toThrow();
  expect(() => rebindExplorationView(view, next, id)).toThrow();
});
const context: DataCapabilityExecutionContext = {
  principal: {
    actorId: id,
    actorType: 'human',
    authenticationMethod: 'supabase_jwt',
    authUserId: id,
    sessionId: id,
    expiresAt: '2099-01-01T00:00:00Z',
  },
  authorization: {
    tenantId: id,
    projectId: id,
    roles: ['data-steward'],
    scopes: ['data.query.execute', 'data.catalog.read'],
    purpose: 'test',
    maxSecurityLevel: 'L1_INTERNAL',
    authzVersion: 1,
  },
  effectiveMaxSecurityLevel: 'L1_INTERNAL',
  traceId: 'a'.repeat(32),
  auditLevel: 'DETAILED',
  timeoutMs: 30000,
  signal: new AbortController().signal,
};
it('exports the authorized bounded representation with matching count units and never marks later pages complete', async () => {
  const pool = {
    connect: vi.fn<QueryAdapterPgPool['connect']>(),
    end: () => Promise.resolve(),
  };
  const exploration = new PostgresExplorationExecutor(pool);
  const execute = vi.spyOn(exploration, 'execute');
  const exporter = createExplorationSavedExecutors(pool, exploration).find(
    (executor) => executor.id === 'data.explore.export',
  )!;
  const base = {
    queryId: id,
    spec: {},
    createdAt: '2026-09-08T00:00:00Z',
    expiresAt: '2026-09-08T00:30:00Z',
    resources: [],
    totalCount: 0,
  };
  execute.mockResolvedValue(
    ExplorationResultSchema.parse({ ...base, view: 'resources' }),
  );
  expect(
    await exporter.execute(
      { request: { queryId: id, view: 'resources' } },
      context,
    ),
  ).toMatchObject({
    coverage: {
      unit: 'resources',
      returnedCount: 0,
      totalCount: 0,
      complete: true,
    },
  });
  expect(
    await exporter.execute(
      { request: { queryId: id, view: 'resources', after: 'opaque' } },
      context,
    ),
  ).toMatchObject({ coverage: { complete: false } });
  execute.mockResolvedValue(
    ExplorationResultSchema.parse({ ...base, view: 'map', features: [] }),
  );
  expect(
    await exporter.execute({ request: { queryId: id, view: 'map' } }, context),
  ).toMatchObject({ coverage: { unit: 'records', complete: true } });
  execute.mockResolvedValue(
    ExplorationResultSchema.parse({
      ...base,
      view: 'graph',
      graph: { nodes: [], edges: [], truncated: true, grain: 'evidence' },
    }),
  );
  expect(
    await exporter.execute(
      { request: { queryId: id, view: 'graph' } },
      context,
    ),
  ).toMatchObject({ coverage: { unit: 'evidence', complete: false } });
  execute.mockRejectedValue(new Error('Revoked'));
  await expect(
    exporter.execute({ request: { queryId: id, view: 'resources' } }, context),
  ).rejects.toThrow('Revoked');
  expect(pool.connect).not.toHaveBeenCalled();
});

it('retries an aborted snapshot transaction before exposing a saved list', async () => {
  let attempts = 0;
  const release = vi.fn();
  const pool = {
    end: () => Promise.resolve(),
    connect: vi.fn<QueryAdapterPgPool['connect']>(() => {
      const attempt = ++attempts;
      return Promise.resolve({
        release,
        query: (sql: string) => {
          if (attempt === 1 && sql.startsWith('select set_config'))
            return Promise.reject(
              Object.assign(new Error('Retryable transaction'), {
                code: '40001',
              }),
            );
          return Promise.resolve({ rows: [] });
        },
      });
    }),
  };
  const list = createExplorationSavedExecutors(pool).find(
    (executor) => executor.id === 'data.explore.view.list',
  )!;
  await expect(list.execute({}, context)).resolves.toEqual({ items: [] });
  expect(attempts).toBe(2);
  expect(release).toHaveBeenCalledTimes(2);
});

it('reauthorizes every saved version before creating any new query', async () => {
  const viewSpec = ExplorationViewSpecSchema.parse({
    activeView: 'resources',
    requests: { resources: { queryId: id, view: 'resources' } },
  });
  const query = vi.fn<
    (sql: string) => Promise<{ rows: Record<string, unknown>[] }>
  >((sql) =>
    Promise.resolve({
      rows: sql.includes('from service.exploration_saved_view')
        ? [
            {
              view_id: id,
              query_id: id,
              actor_id: id,
              title: 'Shared',
              visibility: 'project',
              spec: {},
              version_refs: [
                { dataItemId: id, versionId: id, analysisId: null },
                { dataItemId: next, versionId: next, analysisId: null },
              ],
              view_spec: viewSpec,
              created_at: '2026-09-08T00:00:00Z',
              revoked_at: null,
            },
          ]
        : sql.includes('count(*)::int as total')
          ? [{ total: 1 }]
          : [],
    }),
  );
  const release = vi.fn();
  const pool = {
    connect: () => Promise.resolve({ query, release }),
    end: () => Promise.resolve(),
  };
  const open = createExplorationSavedExecutors(pool).find(
    (value) => value.id === 'data.explore.view.open',
  )!;
  await expect(open.execute({ viewId: id }, context)).rejects.toMatchObject({
    code: 'CONFLICT',
  });
  expect(query.mock.calls.some(([sql]) => sql.startsWith('insert into'))).toBe(
    false,
  );
  expect(query.mock.calls.at(-1)?.[0]).toBe('rollback');
  expect(release).toHaveBeenCalledOnce();
});
