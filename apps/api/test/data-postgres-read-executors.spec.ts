import { describe, expect, it } from 'vitest';

import { DATA_CAPABILITY_REGISTRY } from '@wiser/data-contracts';

import type {
  DataCapabilityAuditRecord,
  DataCapabilityExecutionContext,
} from '../src/data-foundation/capability-handler.js';
import {
  PostgresDataReadCursorError,
  PostgresDataReadNotFoundError,
  createPostgresDataReadRuntime,
  type PostgresDataReadClient,
  type PostgresDataReadPool,
} from '../src/data-foundation/postgres-read-executors.js';

const context: DataCapabilityExecutionContext = {
  principal: {
    actorId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    actorType: 'human',
    authenticationMethod: 'supabase_jwt',
    authUserId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    sessionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    expiresAt: '2026-08-22T01:00:00.000Z',
  },
  authorization: {
    tenantId: '11111111-1111-4111-8111-111111111111',
    projectId: '22222222-2222-4222-8222-222222222222',
    roles: ['data-steward'],
    scopes: ['data.catalog.read'],
    purpose: 'integration-test',
    maxSecurityLevel: 'L3_CONFIDENTIAL',
    authzVersion: 7,
  },
  effectiveMaxSecurityLevel: 'L2_RESTRICTED',
  traceId: 'a'.repeat(32),
  auditLevel: 'STANDARD',
  timeoutMs: 30_000,
  signal: new AbortController().signal,
};

const itemRow = {
  tenant_id: context.authorization.tenantId,
  data_item_id: '33333333-3333-4333-8333-333333333333',
  name: '永定河水质报告',
  business_domains: ['water-quality'],
  source_natures: ['observed'],
  source_channels: ['official'],
  processing_stage: 'STANDARDIZED',
  intended_uses: ['dispatch'],
  owner_project_id: context.authorization.projectId,
  source_organization: 'WISER Lab',
  source_contact: { name: 'Data Steward' },
  authorization_scope: 'data.catalog.read',
  citation_requirements: ['cite-source'],
  source_crs: 'EPSG:4326',
  canonical_crs: 'EPSG:4490',
  timezone: 'Asia/Shanghai',
  temporal_resolution: 'P1D',
  schema_version_id: null,
  unit_definitions: [],
  missing_value_rules: [],
  anomaly_rules: [],
  generation_method: 'OBSERVED',
  quality_grade: 'A',
  acceptance_status: 'PASSED',
  publication_status: 'PUBLISHED',
  security_level: 'L2_RESTRICTED',
  version: '1',
  update_mode: 'SNAPSHOT',
  created_at: '2026-08-22T00:00:00.000Z',
  updated_at: '2026-08-22T00:01:00.000Z',
};

const versionRow = {
  tenant_id: context.authorization.tenantId,
  data_item_id: itemRow.data_item_id,
  version_id: '44444444-4444-4444-8444-444444444444',
  version_number: '1',
  asset_ids: ['55555555-5555-4555-8555-555555555555'],
  source_hash: 'b'.repeat(64),
  metadata_hash: 'c'.repeat(64),
  schema_version_id: null,
  processing_stage: 'STANDARDIZED',
  generation_method: 'OBSERVED',
  quality_grade: 'A',
  acceptance_status: 'PASSED',
  publication_status: 'PUBLISHED',
  security_level: 'L2_RESTRICTED',
  created_at: '2026-08-22T00:00:00.000Z',
  committed_at: '2026-08-22T00:01:00.000Z',
  published_at: '2026-08-22T00:02:00.000Z',
  supersedes_version_id: null,
};

const ingestionId = '66666666-6666-4666-8666-666666666666';

const qualityIssueRow = {
  issue_id: '99999999-9999-4999-8999-999999999991',
  severity: 'ERROR',
  status: 'OPEN',
  field_path: 'properties.stationId',
  message: 'stationId is required',
  created_at: '2026-08-22T00:02:00.000Z',
};

const agentRunRow = {
  agent_run_id: '99999999-9999-4999-8999-999999999992',
  agent_kind: 'semantic-mapper',
  provider: 'deterministic-fake',
  model: 'wiser-fake-embedding-v1',
  deterministic: true,
  input_hash: 'd'.repeat(64),
  output_hash: 'e'.repeat(64),
  status: 'SUCCEEDED',
  created_at: '2026-08-22T00:01:00.000Z',
  updated_at: '2026-08-22T00:02:00.000Z',
};

const projectionStatusRow = {
  data_item_id: itemRow.data_item_id,
  version_id: versionRow.version_id,
  projection_kind: 'opensearch',
  status: 'SUCCEEDED',
  attempt_count: '1',
  projected_at: '2026-08-22T00:03:00.000Z',
  updated_at: '2026-08-22T00:03:00.000Z',
};

class FakeClient implements PostgresDataReadClient {
  readonly queries: Array<{
    readonly text: string;
    readonly values?: readonly unknown[];
  }> = [];
  notFound = false;
  emptyIngestionSummaries = false;
  released = false;

  query(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ readonly rows: readonly Record<string, unknown>[] }> {
    this.queries.push(values === undefined ? { text } : { text, values });
    if (/data\.catalog\.search/.test(text)) {
      return Promise.resolve({
        rows: this.notFound
          ? []
          : [
              itemRow,
              {
                ...itemRow,
                data_item_id: '99999999-9999-4999-8999-999999999999',
              },
            ],
      });
    }
    if (/data\.catalog\.item/.test(text)) {
      return Promise.resolve({ rows: this.notFound ? [] : [itemRow] });
    }
    if (/data\.catalog\.version/.test(text)) {
      return Promise.resolve({ rows: this.notFound ? [] : [versionRow] });
    }
    if (/data\.ingestion\.get/.test(text)) {
      return Promise.resolve({
        rows: this.notFound
          ? []
          : [
              {
                ingestion_id: ingestionId,
                tenant_id: context.authorization.tenantId,
                project_id: context.authorization.projectId,
                asset_ids: versionRow.asset_ids,
                intended_uses: ['dispatch'],
                requested_security_level: 'L2_RESTRICTED',
                state: 'COMMITTED',
                operation_id: '77777777-7777-4777-8777-777777777777',
                row_version: '2',
                created_at: '2026-08-22T00:00:00.000Z',
                updated_at: '2026-08-22T00:03:00.000Z',
              },
            ],
      });
    }
    if (/data\.ingestion\.quality-issues/.test(text)) {
      return Promise.resolve({
        rows: this.emptyIngestionSummaries ? [] : [qualityIssueRow],
      });
    }
    if (/data\.ingestion\.agent-runs/.test(text)) {
      return Promise.resolve({
        rows: this.emptyIngestionSummaries ? [] : [agentRunRow],
      });
    }
    if (/data\.ingestion\.linked-items/.test(text)) {
      return Promise.resolve({
        rows: this.emptyIngestionSummaries
          ? []
          : [
              {
                data_item_id: itemRow.data_item_id,
                version_id: versionRow.version_id,
              },
            ],
      });
    }
    if (/data\.ingestion\.projection-statuses/.test(text)) {
      return Promise.resolve({ rows: [projectionStatusRow] });
    }
    if (/data\.operation\.get/.test(text)) {
      return Promise.resolve({
        rows: this.notFound
          ? []
          : [
              {
                operation_id: '77777777-7777-4777-8777-777777777777',
                tenant_id: context.authorization.tenantId,
                project_id: context.authorization.projectId,
                capability_id: 'data.ingestion.submit',
                status: 'SUCCEEDED',
                progress_percent: 100,
                row_version: '3',
                created_at: '2026-08-22T00:00:00.000Z',
                updated_at: '2026-08-22T00:03:00.000Z',
                started_at: '2026-08-22T00:01:00.000Z',
                completed_at: '2026-08-22T00:03:00.000Z',
                error_code: null,
                error_message: null,
                error_retryable: null,
              },
            ],
      });
    }
    if (/data\.operation\.exists/.test(text)) {
      return Promise.resolve({ rows: this.notFound ? [] : [{ exists: true }] });
    }
    if (/data\.operation\.events/.test(text)) {
      return Promise.resolve({
        rows: [
          {
            event_id: '88888888-8888-4888-8888-888888888888',
            operation_id: '77777777-7777-4777-8777-777777777777',
            sequence_number: '1',
            event_type: 'SUCCEEDED',
            to_status: 'SUCCEEDED',
            progress_percent: 100,
            operation_version: '3',
            created_at: '2026-08-22T00:03:00.000Z',
            message: null,
          },
        ],
      });
    }
    return Promise.resolve({ rows: [] });
  }

  release(): void {
    this.released = true;
  }
}

class FakePool implements PostgresDataReadPool {
  readonly client = new FakeClient();
  ended = false;

  connect(): Promise<PostgresDataReadClient> {
    return Promise.resolve(this.client);
  }

  end(): Promise<void> {
    this.ended = true;
    return Promise.resolve();
  }
}

function executor(
  runtime: ReturnType<typeof createPostgresDataReadRuntime>,
  id: keyof typeof DATA_CAPABILITY_REGISTRY,
) {
  return runtime.executors.find((candidate) => candidate.id === id)!;
}

describe('data-postgres RLS read executors', () => {
  it('provides exactly the seven read capabilities', () => {
    const runtime = createPostgresDataReadRuntime(new FakePool());
    expect(runtime.executors.map(({ id }) => id)).toEqual([
      'data.catalog.search',
      'data.catalog.get',
      'data.catalog.versions.list',
      'data.catalog.versions.get',
      'data.ingestion.get',
      'data.operation.get',
      'data.operation.events',
    ]);
  });

  it('uses one short read-only transaction, fixed SQL, and all RLS settings', async () => {
    const pool = new FakePool();
    const runtime = createPostgresDataReadRuntime(pool);
    const output = await executor(runtime, 'data.catalog.search').execute(
      { query: '永定河', first: 1 },
      context,
    );

    expect(
      DATA_CAPABILITY_REGISTRY['data.catalog.search'].outputSchema.safeParse(
        output,
      ).success,
    ).toBe(true);
    const statements = pool.client.queries.map(({ text }) => text.trim());
    expect(statements.at(0)).toBe('BEGIN READ ONLY');
    expect(statements.at(-1)).toBe('COMMIT');
    const scope = pool.client.queries.find(({ text }) =>
      /set_config/i.test(text),
    );
    expect(scope?.values).toEqual([
      context.authorization.tenantId,
      context.authorization.projectId,
      context.effectiveMaxSecurityLevel,
      String(context.authorization.authzVersion),
    ]);
    const search = pool.client.queries.find(({ text }) =>
      /data\.catalog\.search/.test(text),
    );
    expect(search?.text).toContain('$1');
    expect(search?.text).not.toContain('永定河');
    expect(search?.values).toContain('永定河');
    expect(pool.client.released).toBe(true);
  });

  it('binds catalog cursors to capability and authorization scope', async () => {
    const runtime = createPostgresDataReadRuntime(new FakePool());
    const page = (await executor(runtime, 'data.catalog.search').execute(
      { first: 1 },
      context,
    )) as { nextCursor: string };
    const otherContext = {
      ...context,
      authorization: {
        ...context.authorization,
        projectId: '99999999-9999-4999-8999-999999999999',
      },
    };

    await expect(
      executor(runtime, 'data.catalog.search').execute(
        { first: 1, after: page.nextCursor },
        otherContext,
      ),
    ).rejects.toBeInstanceOf(PostgresDataReadCursorError);
  });

  it('maps catalog get and version list/get to exact public DTOs', async () => {
    const runtime = createPostgresDataReadRuntime(new FakePool());
    const get = await executor(runtime, 'data.catalog.get').execute(
      { dataItemId: itemRow.data_item_id },
      context,
    );
    const versions = await executor(
      runtime,
      'data.catalog.versions.list',
    ).execute({ dataItemId: itemRow.data_item_id, first: 10 }, context);
    const version = await executor(
      runtime,
      'data.catalog.versions.get',
    ).execute(
      { dataItemId: itemRow.data_item_id, versionId: versionRow.version_id },
      context,
    );

    expect(
      DATA_CAPABILITY_REGISTRY['data.catalog.get'].outputSchema.safeParse(get)
        .success,
    ).toBe(true);
    expect(
      DATA_CAPABILITY_REGISTRY[
        'data.catalog.versions.list'
      ].outputSchema.safeParse(versions).success,
    ).toBe(true);
    expect(
      DATA_CAPABILITY_REGISTRY[
        'data.catalog.versions.get'
      ].outputSchema.safeParse(version).success,
    ).toBe(true);
  });

  it('maps ingestion, operation, and append-only event reads to exact DTOs', async () => {
    const runtime = createPostgresDataReadRuntime(new FakePool());
    const ingestion = await executor(runtime, 'data.ingestion.get').execute(
      { ingestionId: '66666666-6666-4666-8666-666666666666' },
      context,
    );
    const operation = await executor(runtime, 'data.operation.get').execute(
      { operationId: '77777777-7777-4777-8777-777777777777' },
      context,
    );
    const events = await executor(runtime, 'data.operation.events').execute(
      { operationId: '77777777-7777-4777-8777-777777777777', first: 10 },
      context,
    );

    expect(
      DATA_CAPABILITY_REGISTRY['data.ingestion.get'].outputSchema.safeParse(
        ingestion,
      ).success,
    ).toBe(true);
    expect(ingestion).toEqual({
      ingestion: {
        ingestionId,
        tenantId: context.authorization.tenantId,
        projectId: context.authorization.projectId,
        assetIds: versionRow.asset_ids,
        intendedUses: ['dispatch'],
        requestedSecurityLevel: 'L2_RESTRICTED',
        state: 'COMMITTED',
        operationId: '77777777-7777-4777-8777-777777777777',
        version: 2,
        createdAt: '2026-08-22T00:00:00.000Z',
        updatedAt: '2026-08-22T00:03:00.000Z',
      },
      qualityIssues: [
        {
          issueId: qualityIssueRow.issue_id,
          severity: 'ERROR',
          status: 'OPEN',
          fieldPath: 'properties.stationId',
          message: 'stationId is required',
          createdAt: '2026-08-22T00:02:00.000Z',
        },
      ],
      agentRuns: [
        {
          agentRunId: agentRunRow.agent_run_id,
          agentKind: 'semantic-mapper',
          provider: 'deterministic-fake',
          model: 'wiser-fake-embedding-v1',
          deterministic: true,
          inputHash: 'd'.repeat(64),
          outputHash: 'e'.repeat(64),
          status: 'SUCCEEDED',
          createdAt: '2026-08-22T00:01:00.000Z',
          updatedAt: '2026-08-22T00:02:00.000Z',
        },
      ],
      projectionStatuses: [
        {
          dataItemId: itemRow.data_item_id,
          versionId: versionRow.version_id,
          projectionKind: 'opensearch',
          status: 'SUCCEEDED',
          attemptCount: 1,
          projectedAt: '2026-08-22T00:03:00.000Z',
          updatedAt: '2026-08-22T00:03:00.000Z',
        },
      ],
    });
    expect(
      DATA_CAPABILITY_REGISTRY['data.operation.get'].outputSchema.safeParse(
        operation,
      ).success,
    ).toBe(true);
    expect(
      DATA_CAPABILITY_REGISTRY['data.operation.events'].outputSchema.safeParse(
        events,
      ).success,
    ).toBe(true);
  });

  it('returns real empty summary arrays and queries projections by linked data item', async () => {
    const pool = new FakePool();
    const runtime = createPostgresDataReadRuntime(pool);
    const populated = await executor(runtime, 'data.ingestion.get').execute(
      { ingestionId },
      context,
    );
    const projectionQuery = pool.client.queries.find(({ text }) =>
      /data\.ingestion\.projection-statuses/.test(text),
    );
    expect(pool.client.queries.at(0)?.text.trim()).toBe('BEGIN READ ONLY');
    expect(pool.client.queries.at(-1)?.text.trim()).toBe('COMMIT');
    expect(
      pool.client.queries.filter(
        ({ text }) => text.trim() === 'BEGIN READ ONLY',
      ),
    ).toHaveLength(1);
    expect(projectionQuery?.values).toEqual([
      [itemRow.data_item_id],
      [versionRow.version_id],
    ]);
    expect(
      pool.client.queries
        .filter(({ text }) => /data\.ingestion\./.test(text))
        .every(
          ({ text }) => !/evidence|error_detail|idempotency_key/i.test(text),
        ),
    ).toBe(true);
    expect(
      DATA_CAPABILITY_REGISTRY['data.ingestion.get'].outputSchema.safeParse(
        populated,
      ).success,
    ).toBe(true);

    const emptyPool = new FakePool();
    emptyPool.client.emptyIngestionSummaries = true;
    const emptyRuntime = createPostgresDataReadRuntime(emptyPool);
    const empty = await executor(emptyRuntime, 'data.ingestion.get').execute(
      { ingestionId },
      context,
    );
    expect(empty).toMatchObject({
      qualityIssues: [],
      agentRuns: [],
      projectionStatuses: [],
    });
    expect(
      emptyPool.client.queries.some(({ text }) =>
        /data\.ingestion\.projection-statuses/.test(text),
      ),
    ).toBe(false);
  });

  it('returns the same safe 404 for absent and RLS-hidden resources', async () => {
    const pool = new FakePool();
    pool.client.notFound = true;
    const runtime = createPostgresDataReadRuntime(pool);

    for (const [id, input] of [
      ['data.catalog.get', { dataItemId: itemRow.data_item_id }],
      [
        'data.catalog.versions.get',
        { dataItemId: itemRow.data_item_id, versionId: versionRow.version_id },
      ],
      [
        'data.ingestion.get',
        { ingestionId: '66666666-6666-4666-8666-666666666666' },
      ],
      [
        'data.operation.get',
        { operationId: '77777777-7777-4777-8777-777777777777' },
      ],
    ] as const) {
      await expect(
        executor(runtime, id).execute(input, context),
      ).rejects.toBeInstanceOf(PostgresDataReadNotFoundError);
    }
  });
});

describe('append-only data-postgres audit port', () => {
  it('writes only hashes and bounded context, then closes the injected pool', async () => {
    const pool = new FakePool();
    const runtime = createPostgresDataReadRuntime(pool, {
      auditPolicyVersion: 7,
    });
    const record: DataCapabilityAuditRecord = {
      capabilityId: 'data.catalog.get',
      actorId: context.principal.actorId,
      actorType: context.principal.actorType,
      tenantId: context.authorization.tenantId,
      projectId: context.authorization.projectId,
      purpose: context.authorization.purpose,
      traceId: context.traceId,
      auditLevel: 'STANDARD',
      decision: 'SUCCEEDED',
      inputHash: 'd'.repeat(64),
      outputHash: 'e'.repeat(64),
      occurredAt: '2026-08-22T00:04:00.000Z',
    };

    await runtime.audit.record(record);

    const insert = pool.client.queries.find(({ text }) =>
      /insert into security\.audit_event/i.test(text),
    );
    expect(insert?.text).not.toMatch(
      /request_payload|result_payload|input_payload|output_payload/i,
    );
    expect(insert?.values).not.toContain(JSON.stringify(record));
    expect(insert?.values).toContain(record.inputHash);
    expect(insert?.values).toContain(record.outputHash);
    await runtime.close();
    expect(pool.ended).toBe(true);
  });
});
