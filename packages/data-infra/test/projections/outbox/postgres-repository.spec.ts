import { describe, expect, it } from 'vitest';

import {
  PostgresProjectionOutboxRepository,
  type ProjectionDatabaseClient,
  type ProjectionDatabasePool,
  type ProjectionEvent,
  type ProjectionScope,
} from '../../../src/projections/outbox/postgres-repository.js';

const scope: ProjectionScope = {
  tenantId: '81000000-0000-4000-8000-000000000001',
  projectId: '81000000-0000-4000-8000-000000000002',
  maxSecurityLevel: 'L3_CONFIDENTIAL',
  policyVersion: 4,
};

const event: ProjectionEvent = {
  outboxEventId: '11',
  eventId: '81000000-0000-4000-8000-000000000011',
  tenantId: scope.tenantId,
  projectId: scope.projectId,
  dataItemId: '82000000-0000-4000-8000-000000000001',
  versionId: '83000000-0000-4000-8000-000000000001',
  eventType: 'data.version.committed',
  idempotencyKey: 'version-1-committed',
  securityLevel: 'L2_RESTRICTED',
  policyVersion: scope.policyVersion,
  payload: { dataItemId: 'ignored-by-fixture', fixture: true },
  createdAt: '2026-08-22T03:30:00.000Z',
};

class FakeProjectionClient implements ProjectionDatabaseClient {
  readonly queries: Array<{
    readonly text: string;
    readonly values?: readonly unknown[];
  }> = [];
  released = false;

  query(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ readonly rows: readonly Record<string, unknown>[] }> {
    this.queries.push(values === undefined ? { text } : { text, values });
    if (/from event\.outbox_event/i.test(text)) {
      return Promise.resolve({
        rows: [
          {
            outbox_event_id: event.outboxEventId,
            event_id: event.eventId,
            tenant_id: event.tenantId,
            project_id: event.projectId,
            event_type: event.eventType,
            idempotency_key: event.idempotencyKey,
            security_level: event.securityLevel,
            policy_version: String(event.policyVersion),
            payload: {
              dataItemId: event.dataItemId,
              versionId: event.versionId,
              fixture: true,
            },
            created_at: event.createdAt,
          },
        ],
      });
    }
    if (/select projection_kind, status/i.test(text)) {
      return Promise.resolve({
        rows: [
          { projection_kind: 'WEAVIATE', status: 'PENDING' },
          { projection_kind: 'STAC', status: 'SUCCEEDED' },
        ],
      });
    }
    return Promise.resolve({ rows: [] });
  }

  release(): void {
    this.released = true;
  }
}

class FakeProjectionPool implements ProjectionDatabasePool {
  readonly clients: FakeProjectionClient[] = [];
  ended = false;

  connect(): Promise<ProjectionDatabaseClient> {
    const client = new FakeProjectionClient();
    this.clients.push(client);
    return Promise.resolve(client);
  }

  end(): Promise<void> {
    this.ended = true;
    return Promise.resolve();
  }
}

describe('Postgres projection outbox repository', () => {
  it('reads only ordered committed-version events after a scoped checkpoint', async () => {
    const pool = new FakeProjectionPool();
    const repository = new PostgresProjectionOutboxRepository(pool);

    await expect(
      repository.readBatch(scope, 'projection-worker-v1', 10),
    ).resolves.toEqual([
      {
        ...event,
        payload: {
          dataItemId: event.dataItemId,
          versionId: event.versionId,
          fixture: true,
        },
      },
    ]);

    const client = pool.clients[0]!;
    expect(client.queries.at(0)?.text.trim()).toBe('BEGIN');
    expect(client.queries.some(({ text }) => /set_config/i.test(text))).toBe(
      true,
    );
    const read = client.queries.find(({ text }) =>
      /from event\.outbox_event/i.test(text),
    );
    expect(read?.text).toMatch(/event\.consumer_checkpoint/i);
    expect(read?.text).toMatch(/data\.version\.committed/i);
    expect(read?.text).toMatch(/order by outbox_event\.outbox_event_id/i);
    expect(read?.values).toContain(10);
    expect(client.queries.at(-1)?.text.trim()).toBe('COMMIT');
    expect(client.released).toBe(true);
  });

  it('creates idempotent ledger rows, stores only safe failure categories, and advances monotonically', async () => {
    const pool = new FakeProjectionPool();
    const repository = new PostgresProjectionOutboxRepository(pool);

    await expect(
      repository.prepare(event, ['WEAVIATE', 'STAC']),
    ).resolves.toEqual(
      new Map([
        ['WEAVIATE', 'PENDING'],
        ['STAC', 'SUCCEEDED'],
      ]),
    );
    await repository.markRunning(event, 'WEAVIATE');
    await repository.markFailed(
      event,
      'WEAVIATE',
      'VECTOR_BACKEND_UNAVAILABLE',
    );
    await repository.markSucceeded(event, 'WEAVIATE');
    await repository.advanceCheckpoint(scope, 'projection-worker-v1', event);

    const statements = pool.clients.flatMap((client) => client.queries);
    const prepare = statements.find(({ text }) =>
      /insert into service\.projection_status/i.test(text),
    );
    expect(prepare?.text).toMatch(/on conflict/i);
    expect(prepare?.values).toContain(event.eventId);
    const failure = statements.find(
      ({ text }) =>
        /update service\.projection_status/i.test(text) &&
        /error_detail/i.test(text) &&
        /FAILED/.test(text),
    );
    expect(failure?.text).toMatch(
      /jsonb_build_object\('category', \$5::text\)/i,
    );
    expect(failure?.values).toContain('VECTOR_BACKEND_UNAVAILABLE');
    expect(JSON.stringify(failure?.values)).not.toContain('password');
    const checkpoint = statements.find(({ text }) =>
      /insert into event\.consumer_checkpoint/i.test(text),
    );
    expect(checkpoint?.text).toMatch(/greatest/i);
    expect(checkpoint?.text).toMatch(
      /last_error\s*=\s*case[\s\S]*jsonb_build_object\('category'/i,
    );
    expect(checkpoint?.values).toContain(event.outboxEventId);
    expect(pool.clients.every(({ released }) => released)).toBe(true);

    await repository.close();
    expect(pool.ended).toBe(true);
  });
});
