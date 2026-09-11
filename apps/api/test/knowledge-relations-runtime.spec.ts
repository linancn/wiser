import { randomUUID } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { createKnowledgeRelationExecutors } from '../src/data-foundation/knowledge-relations-runtime.js';
import type { DataCapabilityExecutionContext } from '../src/data-foundation/capability-handler.js';

function fixture() {
  const item = randomUUID(),
    version = randomUUID(),
    actor = randomUUID();
  const candidate = {
    subject: {
      key: 'enterprise:1',
      label: 'Source enterprise',
      kind: 'ENTERPRISE',
      externalId: null,
    },
    predicate: 'HAS_DECLARED_MONITORING_POINT',
    object: {
      key: 'point:1',
      label: 'Source point',
      kind: 'MONITORING_POINT',
      externalId: null,
    },
    qualifiers: {
      measure: null,
      unit: null,
      observedAt: null,
      spatialScope: null,
      missing: true,
      limitations: [],
      reportedConclusion: null,
    },
    generation: { method: 'SOURCE_TABLE', model: null },
    evidence: [
      {
        assetId: randomUUID(),
        sourceHash: 'a'.repeat(64),
        locator: 'page 1 row 2',
        excerpt: null,
        polarity: 'SUPPORTS',
      },
    ],
    supersedesId: null,
  };
  const context: DataCapabilityExecutionContext = {
    principal: {
      actorId: actor,
      actorType: 'human',
      authenticationMethod: 'supabase_jwt',
      authUserId: actor,
      sessionId: randomUUID(),
    },
    authorization: {
      tenantId: randomUUID(),
      projectId: randomUUID(),
      roles: ['data-steward'],
      scopes: ['data.catalog.read', 'data.ingestion.write', 'data.publish'],
      purpose: 'unit-test',
      maxSecurityLevel: 'L1_INTERNAL',
      authzVersion: 1,
    },
    effectiveMaxSecurityLevel: 'L1_INTERNAL',
    traceId: 'a'.repeat(32),
    auditLevel: 'FULL',
    timeoutMs: 30000,
    signal: new AbortController().signal,
    idempotencyKey: randomUUID(),
  };
  const rows = new Map<string, Record<string, unknown>>();
  const ledger = new Map<unknown, unknown>();
  let visible = true;
  const query = vi.fn(async (sql: string, v: readonly unknown[] = []) => {
    await Promise.resolve();
    if (sql.includes('data.command.idempotency.read'))
      return {
        rows: ledger.has(v[0]) ? [{ payload: ledger.get(v[0]) }] : [],
        rowCount: ledger.has(v[0]) ? 1 : 0,
      };
    if (sql.includes('data.command.outbox.insert'))
      ledger.set(v[6], JSON.parse(String(v[4])));
    if (sql.includes('count(*)::int total'))
      return {
        rows: [
          {
            total: visible
              ? sql.includes('knowledge.assertion_binding')
                ? rows.size
                : 1
              : 0,
          },
        ],
        rowCount: 1,
      };
    if (
      sql.startsWith('select value') ||
      sql.startsWith('select assertion_id,encode')
    )
      return { rows: [], rowCount: 0 };
    if (sql.startsWith('insert into knowledge.assertion('))
      rows.set(String(v[0]), {
        assertion_id: v[0],
        data_item_id: item,
        version_id: version,
        row_version: 1,
        mapping_version: 'v1',
        status: 'PENDING_REVIEW',
        created_at: v[10],
        reviews: [],
      });
    if (sql.startsWith('insert into knowledge.assertion_binding'))
      rows.get(String(v[0]))!['candidate'] = JSON.parse(String(v[8]));
    if (sql.startsWith('insert into knowledge.review_record'))
      (rows.get(String(v[3]))!['reviews'] as unknown[]).push({
        reviewId: v[0],
        reviewerId: v[4],
        decision: v[5],
        rationale: v[6],
        createdAt: v[10],
      });
    if (sql.startsWith('update knowledge.assertion set'))
      Object.assign(rows.get(String(v[0]))!, {
        status: v[1],
        row_version: Number(v[3]) + 1,
      });
    if (sql.startsWith('select b.*'))
      return {
        rows: visible
          ? ((sql.includes('where b.assertion_id=')
              ? [rows.get(String(v[0]))].filter(Boolean)
              : [...rows.values()]) as Record<string, unknown>[])
          : [],
        rowCount: rows.size,
      };
    return { rows: [{}], rowCount: 1 };
  });
  const release = vi.fn();
  const pool = {
    connect: vi.fn(() => Promise.resolve({ query, release })),
    end: vi.fn(async () => {}),
  };
  const executors = createKnowledgeRelationExecutors(pool);
  const call = (name: string, input: unknown, ctx = context) =>
    executors.find((e) => e.id.endsWith(`.${name}`))!.execute(input, ctx);
  return {
    call,
    context,
    rows,
    query,
    release,
    pool,
    candidate,
    input: {
      dataItemId: item,
      versionId: version,
      mappingVersion: 'v1',
      candidates: [candidate],
    },
    withdraw: () => {
      visible = false;
    },
  };
}

it('replays imports and reviews through current authority and hides a withdrawn source', async () => {
  const f = fixture();
  const imported = (await f.call('import', f.input)) as {
    items: { assertionId: string }[];
  };
  const id = imported.items[0]!.assertionId;
  expect(await f.call('import', f.input)).toEqual(imported);
  expect(f.rows.size).toBe(1);
  const review = {
    assertionId: id,
    expectedVersion: 1,
    decision: 'APPROVED',
    rationale: 'Compared source row with the proposed relation.',
  };
  const ctx = { ...f.context, idempotencyKey: randomUUID() };
  const approved = await f.call('review', review, ctx);
  expect(approved).toMatchObject({
    assertion: {
      status: 'APPROVED',
      version: 2,
      confidence: null,
      reviews: [{ rationale: review.rationale }],
    },
  });
  expect(await f.call('review', review, ctx)).toEqual(approved);
  expect(await f.call('get', { assertionId: id })).toEqual(approved);
  expect(
    await f.call('list', {
      dataItemId: f.input.dataItemId,
      versionId: f.input.versionId,
    }),
  ).toMatchObject({ totalCount: 1, items: [{ assertionId: id }] });
  await expect(
    f.call('review', review, { ...ctx, idempotencyKey: randomUUID() }),
  ).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
  f.withdraw();
  await expect(f.call('import', f.input)).rejects.toMatchObject({
    code: 'NOT_FOUND',
  });
  await expect(f.call('get', { assertionId: id })).rejects.toMatchObject({
    code: 'NOT_FOUND',
  });
  expect(f.release).toHaveBeenCalledTimes(9);
});

it('rolls back reads on cancellation or persistence failure without exposing database errors', async () => {
  const f = fixture();
  await f.call('import', f.input);
  const abort = new AbortController();
  abort.abort();
  await expect(
    f.call(
      'list',
      { dataItemId: f.input.dataItemId, versionId: f.input.versionId },
      { ...f.context, signal: abort.signal },
    ),
  ).rejects.toMatchObject({ code: 'CAPABILITY_TIMEOUT' });
  f.query.mockRejectedValueOnce(Error('private server address'));
  await expect(
    f.call('get', { assertionId: randomUUID() }),
  ).rejects.toMatchObject({ code: 'EXECUTION_FAILED' });
  expect(f.query.mock.calls.filter(([sql]) => sql === 'rollback')).toHaveLength(
    2,
  );
  expect(f.release).toHaveBeenCalledTimes(3);
});

it('rejects automatic review, conflicting identities and oversized evidence before connecting', async () => {
  const f = fixture();
  await expect(
    f.call(
      'review',
      {},
      {
        ...f.context,
        principal: { ...f.context.principal, actorType: 'agent' },
      },
    ),
  ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await expect(
    f.call('import', {
      ...f.input,
      candidates: [
        f.candidate,
        {
          ...f.candidate,
          subject: { ...f.candidate.subject, label: 'Conflicting name' },
        },
      ],
    }),
  ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  const evidence = Array.from({ length: 30 }, (_, n) => ({
    ...f.candidate.evidence[0],
    locator: `row ${n}`,
    excerpt: 'x'.repeat(4000),
  }));
  await expect(
    f.call('import', {
      ...f.input,
      candidates: [{ ...f.candidate, evidence }],
    }),
  ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  expect(f.pool.connect).not.toHaveBeenCalled();
});
