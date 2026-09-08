import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import type { PoolClient } from 'pg';
import {
  ExplorationResultSchema,
  CreateExplorationViewOutputSchema,
  OpenExplorationViewOutputSchema,
} from '@wiser/data-contracts';
import { createExplorationSavedExecutors } from '../../src/data-foundation/exploration-saved.js';
import { PostgresExplorationExecutor } from '../../src/data-foundation/exploration-runtime.js';
import type { DataCapabilityExecutionContext } from '../../src/data-foundation/capability-handler.js';
import type { QueryAdapterPgPool } from '../../src/data-foundation/query-adapters.js';
export async function verifySavedExploration(input: {
  client: PoolClient;
  pool: QueryAdapterPgPool;
  context: DataCapabilityExecutionContext;
  queryId: string;
  versionId: string;
  dataItemId: string;
  assetId: string;
  analysisId: string;
  secondRecord: string;
}) {
  const {
    client,
    pool,
    context,
    versionId,
    dataItemId,
    assetId,
    analysisId,
    secondRecord,
  } = input;
  const executor = new PostgresExplorationExecutor(pool);
  const saved = createExplorationSavedExecutors(
    { ...pool, end: () => Promise.resolve() },
    executor,
  );
  const call = (id: string, body: unknown, ctx = context) => {
    const capability = saved.find((value) => value.id === id);
    if (!capability) throw new Error('Missing saved-view capability');
    return capability.execute(body, ctx);
  };
  const command = (key = randomUUID()): DataCapabilityExecutionContext => ({
    ...context,
    idempotencyKey: key,
  });
  const q = ExplorationResultSchema.parse(
    await executor.execute(
      { baseQueryId: input.queryId, spec: {}, view: 'resources' },
      context,
    ),
  );
  const rows = ExplorationResultSchema.parse(
    await executor.execute(
      { queryId: q.queryId, view: 'records', versionId, assetId, first: 1 },
      context,
    ),
  );
  expect(rows.totalCount).toBe(2);
  const viewSpec = {
    activeView: 'records',
    requests: {
      resources: { queryId: q.queryId, view: 'resources', first: 25 },
      records: {
        queryId: q.queryId,
        view: 'records',
        versionId,
        assetId,
        first: 1,
        after: rows.nextCursor,
      },
    },
    navigation: { records: { page: 1, cursors: [null, rows.nextCursor] } },
    selection: { dataItemId, versionId, recordId: secondRecord },
  };
  const create = {
    queryId: q.queryId,
    title: 'Pinned original records',
    viewSpec,
  };
  const key = command();
  const created = CreateExplorationViewOutputSchema.parse(
    await call('data.explore.view.create', create, key),
  );
  expect(created.savedView.visibility).toBe('private');
  expect(await call('data.explore.view.create', create, key)).toEqual(created);
  await expect(
    call('data.explore.view.create', { ...create, title: 'Different' }, key),
  ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  const stranger = {
    ...context,
    principal: { ...context.principal, actorId: randomUUID() },
  };
  await expect(
    call(
      'data.explore.view.open',
      { viewId: created.savedView.viewId },
      stranger,
    ),
  ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  const shared = CreateExplorationViewOutputSchema.parse(
    await call(
      'data.explore.view.create',
      { ...create, visibility: 'project' },
      command(),
    ),
  );
  await client.query(
    'delete from service.exploration_snapshot where query_id=$1',
    [q.queryId],
  );
  const opened = OpenExplorationViewOutputSchema.parse(
    await call(
      'data.explore.view.open',
      { viewId: shared.savedView.viewId },
      stranger,
    ),
  );
  expect(opened.result.queryId).not.toBe(q.queryId);
  expect(opened.selectedRecord?.recordId).toBe(secondRecord);
  expect(opened.result.resources[0]?.analysis?.analysisId).toBe(analysisId);
  expect(opened.viewSpec.requests.records?.queryId).toBe(opened.result.queryId);
  const resumed = ExplorationResultSchema.parse(
    await executor.execute(opened.viewSpec.requests.records, stranger),
  );
  expect(resumed.totalCount).toBe(2);
  expect(resumed.records?.[0]?.recordId).toBe(secondRecord);
  expect(opened.viewSpec.navigation?.records?.cursors[1]).toBe(
    opened.viewSpec.requests.records?.after,
  );
  await expect(
    call(
      'data.explore.view.open',
      { viewId: shared.savedView.viewId },
      {
        ...stranger,
        authorization: { ...stranger.authorization, projectId: randomUUID() },
      },
    ),
  ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  await expect(
    call(
      'data.explore.view.revoke',
      { viewId: shared.savedView.viewId },
      { ...stranger, idempotencyKey: randomUUID() },
    ),
  ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  expect(await call('data.explore.view.list', {}, stranger)).toEqual({
    items: [],
  });
  const exported = await call(
    'data.explore.export',
    { request: opened.viewSpec.requests.records },
    stranger,
  );
  expect(exported).toMatchObject({
    coverage: {
      unit: 'records',
      returnedCount: 1,
      totalCount: 2,
      complete: false,
    },
    result: { records: [{ recordId: secondRecord }] },
  });
  const revoke = command();
  expect(
    await call(
      'data.explore.view.revoke',
      { viewId: shared.savedView.viewId },
      revoke,
    ),
  ).toEqual({ viewId: shared.savedView.viewId, revoked: true });
  expect(
    await call(
      'data.explore.view.revoke',
      { viewId: shared.savedView.viewId },
      revoke,
    ),
  ).toEqual({ viewId: shared.savedView.viewId, revoked: true });
  await expect(
    call(
      'data.explore.view.open',
      { viewId: shared.savedView.viewId },
      stranger,
    ),
  ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  // Saved configuration is immutable even for its creator and the non-bypass runtime role.
  await call('data.explore.view.list', {});
  await client.query('savepoint saved_immutable');
  await expect(
    client.query(
      'update service.exploration_saved_view set title=$2 where view_id=$1',
      [created.savedView.viewId, 'Changed'],
    ),
  ).rejects.toBeDefined();
  await client.query('rollback to savepoint saved_immutable');
}
