import { randomUUID } from 'node:crypto';

import { Pool, type PoolClient } from 'pg';
import { describe, expect, it } from 'vitest';

import {
  DATA_CAPABILITY_REGISTRY,
  type DataCapabilityId,
  type UploadSessionDto,
} from '@wiser/data-contracts';

import type { DataCapabilityExecutionContext } from '../src/data-foundation/capability-handler.js';
import {
  PostgresDataCommandError,
  createPostgresDataCommandRuntime,
  type DataCommandObjectStore,
  type PostgresDataCommandClient,
  type PostgresDataCommandPool,
} from '../src/data-foundation/postgres-command-executors.js';

const TENANT_ID = 'd2000000-0000-4000-8000-000000000001';
const PROJECT_ID = 'd2000000-0000-4000-8000-000000000002';
const ACTOR_ID = 'd2000000-0000-4000-8000-000000000003';
const SESSION_ID = 'd2000000-0000-4000-8000-000000000005';
const ASSET_ID = 'd2000000-0000-4000-8000-000000000006';
const INGESTION_ID = 'd2000000-0000-4000-8000-000000000007';
const OPERATION_ID = 'd2000000-0000-4000-8000-000000000008';
const IDEMPOTENCY_KEY = 'd2000000-0000-4000-8000-000000000009';
const NOW = new Date('2026-08-22T05:00:00.000Z');
const SHA256 = 'a'.repeat(64);

const context: DataCapabilityExecutionContext = {
  principal: {
    actorId: ACTOR_ID,
    actorType: 'human',
    authenticationMethod: 'supabase_jwt',
    authUserId: ACTOR_ID,
    sessionId: 'd2000000-0000-4000-8000-000000000010',
  },
  authorization: {
    tenantId: TENANT_ID,
    projectId: PROJECT_ID,
    roles: ['data-steward'],
    scopes: ['data.ingestion.write', 'data.publish', 'data.operation.read'],
    purpose: 'operate',
    maxSecurityLevel: 'L2_RESTRICTED',
    authzVersion: 7,
  },
  effectiveMaxSecurityLevel: 'L2_RESTRICTED',
  traceId: 'd'.repeat(32),
  idempotencyKey: IDEMPOTENCY_KEY,
  auditLevel: 'FULL',
  timeoutMs: 120_000,
  signal: new AbortController().signal,
};

interface QueryCall {
  readonly text: string;
  readonly values: readonly unknown[];
}

class FakeClient implements PostgresDataCommandClient {
  readonly calls: QueryCall[] = [];
  readonly replay = new Map<string, unknown>();
  timeline: string[] = [];
  ingestionState = 'RECEIVED';
  ingestionVersion = 1;
  operationStatus = 'RUNNING';
  operationVersion = 2;
  uploadVersion = 1;
  uploadStatus = 'WAITING_INPUT';
  uploadExpiresAt = '2026-08-22T06:00:00.000Z';
  uploadRequestPayload: unknown;
  assetSecurity = 'L1_INTERNAL';
  existingAsset: Record<string, unknown> | undefined;
  zeroRowCountFor: string | undefined;
  released = false;

  query(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<{
    readonly rows: readonly Record<string, unknown>[];
    readonly rowCount: number;
  }> {
    this.calls.push({ text, values });
    if (
      this.zeroRowCountFor !== undefined &&
      text.includes(this.zeroRowCountFor)
    ) {
      return Promise.resolve({ rows: [], rowCount: 0 });
    }
    if (text.includes('data.upload.asset.insert')) {
      this.timeline.push('sql:asset-insert');
    }
    if (text.includes('data.command.idempotency.read')) {
      const payload = this.replay.get(String(values[0]));
      return Promise.resolve({
        rows: payload === undefined ? [] : [{ payload }],
        rowCount: payload === undefined ? 0 : 1,
      });
    }
    if (text.includes('data.command.outbox')) {
      this.replay.set(
        String(values[6]),
        JSON.parse(String(values[4])) as unknown,
      );
    }
    if (
      text.includes('data.command.operation.insert') &&
      values[3] === 'data.uploadSession.create'
    ) {
      this.uploadRequestPayload = JSON.parse(String(values[8])) as unknown;
    }
    if (text.includes('data.upload.session.lock')) {
      return Promise.resolve({
        rows: [
          {
            operation_id: String(values[0]),
            status: this.uploadStatus,
            row_version: this.uploadVersion,
            security_level: 'L1_INTERNAL',
            policy_version: 7,
            request_payload: this.uploadRequestPayload ?? {
              assets: [
                {
                  assetId: ASSET_ID,
                  uploadId: ASSET_ID,
                  fileName: 'stations.geojson',
                  sha256: SHA256,
                  sizeBytes: 4_096,
                  contentType: 'application/geo+json',
                  securityLevel: 'L1_INTERNAL',
                  method: 'PRESIGNED_PUT',
                  storageKey: `quarantine/${ASSET_ID}`,
                },
              ],
              expiresAt: this.uploadExpiresAt,
              createdAt: NOW.toISOString(),
            },
          },
        ],
        rowCount: 1,
      });
    }
    if (text.includes('data.ingestion.assets.lock')) {
      return Promise.resolve({
        rows: [{ asset_id: ASSET_ID, security_level: this.assetSecurity }],
        rowCount: 1,
      });
    }
    if (text.includes('data.ingestion.asset-ids.read')) {
      return Promise.resolve({
        rows: [{ asset_id: ASSET_ID, ordinal: 0 }],
        rowCount: 1,
      });
    }
    if (text.includes('data.ingestion.session.lock')) {
      return Promise.resolve({
        rows: [
          {
            ingestion_id: INGESTION_ID,
            state: this.ingestionState,
            row_version: this.ingestionVersion,
            intended_uses: ['hydrology-analysis'],
            requested_security_level: 'L1_INTERNAL',
            security_level: 'L1_INTERNAL',
            policy_version: 7,
            operation_id: OPERATION_ID,
            created_at: NOW.toISOString(),
            asset_ids: [ASSET_ID],
          },
        ],
        rowCount: 1,
      });
    }
    if (text.includes('data.operation.lock')) {
      return Promise.resolve({
        rows: [
          {
            operation_id: OPERATION_ID,
            capability_id: 'data.ingestion.submit',
            status: this.operationStatus,
            progress_percent: 30,
            row_version: this.operationVersion,
            security_level: 'L1_INTERNAL',
            created_at: NOW.toISOString(),
            updated_at: NOW.toISOString(),
          },
        ],
        rowCount: 1,
      });
    }
    if (text.includes('data.ingestion.job.lock')) {
      return Promise.resolve({
        rows: [
          {
            job_id: 'd2000000-0000-4000-8000-000000000099',
            operation_id: OPERATION_ID,
            status: 'WAITING_REVIEW',
            row_version: 2,
            security_level: 'L1_INTERNAL',
            policy_version: 7,
          },
        ],
        rowCount: 1,
      });
    }
    if (text.includes('data.upload.asset-by-hash.lock')) {
      return Promise.resolve({
        rows: this.existingAsset === undefined ? [] : [this.existingAsset],
        rowCount: this.existingAsset === undefined ? 0 : 1,
      });
    }
    if (text.includes('data.operation.cancel-jobs.update')) {
      return Promise.resolve({ rows: [], rowCount: 0 });
    }
    return Promise.resolve({ rows: [], rowCount: 1 });
  }

  release() {
    this.released = true;
  }
}

class FakePool implements PostgresDataCommandPool {
  readonly client = new FakeClient();
  ended = false;

  connect() {
    return Promise.resolve(this.client);
  }

  end() {
    this.ended = true;
    return Promise.resolve();
  }
}

class FakeObjectStore implements DataCommandObjectStore {
  readonly calls: Array<{ readonly method: string; readonly input: unknown }> =
    [];
  fail = false;
  failCompleteOnly = false;
  failPlanAt: number | undefined;
  timeline: string[] = [];

  planQuarantinePut(
    input: Parameters<DataCommandObjectStore['planQuarantinePut']>[0],
  ) {
    this.calls.push({ method: 'planQuarantinePut', input });
    this.timeline.push('s3:plan-single');
    if (
      this.fail ||
      (this.failPlanAt !== undefined &&
        this.calls.filter(({ method }) => method.startsWith('plan')).length ===
          this.failPlanAt)
    )
      return Promise.reject(new Error(`private-s3-detail-${SHA256}`));
    return Promise.resolve({
      kind: 'single' as const,
      bucket: 'wiser-authority',
      key: `quarantine/${input.uploadId}`,
      url: `https://signed.invalid/${input.uploadId}`,
      expiresAt: '2026-08-22T05:05:00.000Z',
      requiredHeaders:
        input.sha256 === undefined ? {} : { 'x-amz-meta-sha256': input.sha256 },
    });
  }

  planQuarantineMultipart(
    input: Parameters<DataCommandObjectStore['planQuarantineMultipart']>[0],
  ) {
    this.calls.push({ method: 'planQuarantineMultipart', input });
    this.timeline.push('s3:plan-multipart');
    if (
      this.fail ||
      (this.failPlanAt !== undefined &&
        this.calls.filter(({ method }) => method.startsWith('plan')).length ===
          this.failPlanAt)
    ) {
      return Promise.reject(new Error('private-s3-plan-detail'));
    }
    return Promise.resolve({
      kind: 'multipart' as const,
      bucket: 'wiser-authority',
      key: `quarantine/${input.uploadId}`,
      uploadId: `multipart-${input.uploadId}`,
      parts: [
        {
          partNumber: 1,
          sizeBytes: input.sizeBytes,
          url: `https://signed.invalid/${input.uploadId}/1`,
          expiresAt: '2026-08-22T05:05:00.000Z',
        },
      ],
    });
  }

  resignQuarantineMultipart(
    input: Parameters<DataCommandObjectStore['resignQuarantineMultipart']>[0],
  ) {
    this.calls.push({ method: 'resignQuarantineMultipart', input });
    this.timeline.push('s3:resign-multipart');
    return Promise.resolve({
      kind: 'multipart' as const,
      bucket: 'wiser-authority',
      key: `quarantine/${input.uploadId}`,
      uploadId: input.multipartUploadId,
      parts: [
        {
          partNumber: 1,
          sizeBytes: input.sizeBytes,
          url: `https://signed.invalid/${input.uploadId}/1?replay=1`,
          expiresAt: '2026-08-22T05:05:00.000Z',
        },
      ],
    });
  }

  completeQuarantineMultipart(
    input: Parameters<DataCommandObjectStore['completeQuarantineMultipart']>[0],
  ) {
    this.calls.push({ method: 'completeQuarantineMultipart', input });
    this.timeline.push('s3:complete-multipart');
    return this.fail || this.failCompleteOnly
      ? Promise.reject(new Error('private-s3-complete-detail'))
      : Promise.resolve();
  }

  verifyQuarantineObject(
    input: Parameters<DataCommandObjectStore['verifyQuarantineObject']>[0],
  ) {
    this.calls.push({ method: 'verifyQuarantineObject', input });
    this.timeline.push('s3:verify');
    return this.fail
      ? Promise.reject(new Error('private-s3-verify-detail'))
      : Promise.resolve();
  }

  abortQuarantineObject(
    input: Parameters<DataCommandObjectStore['abortQuarantineObject']>[0],
  ) {
    this.calls.push({ method: 'abortQuarantineObject', input });
    this.timeline.push('s3:abort');
    return Promise.resolve();
  }
}

function runtime(pool = new FakePool(), store = new FakeObjectStore()) {
  let sequence = 0;
  const timeline: string[] = [];
  pool.client.timeline = timeline;
  store.timeline = timeline;
  return {
    pool,
    store,
    timeline,
    runtime: createPostgresDataCommandRuntime(pool, store, {
      idFactory: () =>
        `e2000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`,
      clock: () => NOW,
    }),
  };
}

function executor(
  value: ReturnType<typeof createPostgresDataCommandRuntime>,
  id: DataCapabilityId,
) {
  return value.executors.find((candidate) => candidate.id === id)!;
}

class RollbackCommitPool implements PostgresDataCommandPool {
  readonly errors: string[] = [];

  constructor(
    private readonly pool: Pool,
    private readonly roleName: string,
  ) {
    if (!/^wiser_command_test_[a-z0-9_]+$/.test(roleName)) {
      throw new Error('invalid test role');
    }
  }

  async connect(): Promise<PostgresDataCommandClient> {
    const client: PoolClient = await this.pool.connect();
    const errors = this.errors;
    await client.query(`set role ${this.roleName}`);
    return {
      async query(text, values = []) {
        try {
          const result = await client.query<Record<string, unknown>>(
            text.toLowerCase() === 'commit' ? 'rollback' : text,
            text.toLowerCase() === 'commit' ? [] : [...values],
          );
          return { rows: result.rows, rowCount: result.rowCount };
        } catch (error) {
          errors.push(
            `${/\/\* ([^*]+) \*\//.exec(text)?.[1] ?? text.slice(0, 32)}: ${error instanceof Error ? error.message : 'unknown'}`,
          );
          throw error;
        }
      },
      release() {
        client.release();
      },
    };
  }

  async end(): Promise<void> {
    await this.pool.end();
  }
}

class SavepointRollbackPool implements PostgresDataCommandPool {
  capturedJobPayload: unknown;

  constructor(private readonly client: PoolClient) {}

  connect(): Promise<PostgresDataCommandClient> {
    const client = this.client;
    return Promise.resolve({
      query: async (text, values = []) => {
        const command = text.toLowerCase();
        if (command === 'begin') {
          const result = await client.query('savepoint command_executor_test');
          return { rows: result.rows, rowCount: result.rowCount };
        }
        if (command === 'commit') {
          const captured = await client.query<{ readonly payload: unknown }>(
            `select payload from ingestion.job
             where job_type = 'data.ingestion.process'
             order by created_at desc limit 1`,
          );
          this.capturedJobPayload = captured.rows[0]?.payload;
          await client.query('rollback to savepoint command_executor_test');
          const result = await client.query(
            'release savepoint command_executor_test',
          );
          return { rows: result.rows, rowCount: result.rowCount };
        }
        if (command === 'rollback') {
          await client.query('rollback to savepoint command_executor_test');
          const result = await client.query(
            'release savepoint command_executor_test',
          );
          return { rows: result.rows, rowCount: result.rowCount };
        }
        const result = await client.query<Record<string, unknown>>(text, [
          ...values,
        ]);
        return { rows: result.rows, rowCount: result.rowCount };
      },
      release() {
        // The outer integration transaction owns this client.
      },
    });
  }

  end(): Promise<void> {
    return Promise.resolve();
  }
}

describe('PostgreSQL Data Foundation command executors', () => {
  it('provides exactly the eight concrete command capabilities', () => {
    const value = runtime();
    expect(value.runtime.executors.map(({ id }) => id)).toEqual([
      'data.catalog.create',
      'data.uploadSession.create',
      'data.uploadSession.complete',
      'data.ingestion.create',
      'data.ingestion.submit',
      'data.ingestion.approve',
      'data.ingestion.reject',
      'data.operation.cancel',
    ]);
  });

  it('creates only a metadata draft with fixed SQL and an atomic ledger', async () => {
    const value = runtime();
    const output = await executor(value.runtime, 'data.catalog.create').execute(
      {
        name: 'Station draft',
        businessDomains: ['water-monitoring'],
        sourceNatures: ['observed'],
        sourceChannels: ['file-upload'],
        processingStage: 'RAW',
        intendedUses: ['hydrology-analysis'],
        ownerProjectId: PROJECT_ID,
        sourceOrganization: 'WISER Lab',
        authorizationScope: 'data.catalog.read',
        citationRequirements: [],
        unitDefinitions: [],
        missingValueRules: [],
        anomalyRules: [],
        generationMethod: 'OBSERVED',
        securityLevel: 'L1_INTERNAL',
        updateMode: 'SNAPSHOT',
      },
      context,
    );

    expect(
      DATA_CAPABILITY_REGISTRY['data.catalog.create'].outputSchema.safeParse(
        output,
      ).success,
    ).toBe(true);
    const sql = value.pool.client.calls.map(({ text }) => text).join('\n');
    expect(sql).toContain('data.catalog.create');
    expect(sql).not.toMatch(/insert into catalog\.data_item_version/i);
    for (const marker of [
      'data.command.scope',
      'data.command.operation',
      'data.command.operation-event',
      'data.command.audit',
      'data.command.outbox',
    ]) {
      expect(sql).toContain(marker);
    }
    expect(value.pool.client.calls[0]?.text.toLowerCase()).toBe('begin');
    expect(value.pool.client.calls.at(-1)?.text.toLowerCase()).toBe('commit');
  });

  it('replays ordinary command results without repeating writes', async () => {
    const value = runtime();
    const create = executor(value.runtime, 'data.catalog.create');
    const input = {
      name: 'Replay draft',
      businessDomains: ['water-monitoring'],
      sourceNatures: ['observed'],
      sourceChannels: ['file-upload'],
      processingStage: 'RAW',
      intendedUses: ['hydrology-analysis'],
      ownerProjectId: PROJECT_ID,
      sourceOrganization: 'WISER Lab',
      authorizationScope: 'data.catalog.read',
      citationRequirements: [],
      unitDefinitions: [],
      missingValueRules: [],
      anomalyRules: [],
      generationMethod: 'OBSERVED',
      securityLevel: 'L1_INTERNAL',
      updateMode: 'SNAPSHOT',
    } as const;
    const first = await create.execute(input, context);
    const replay = await create.execute(input, context);
    expect(replay).toEqual(first);
    expect(
      value.pool.client.calls.filter(({ text }) =>
        text.includes('data.catalog.create'),
      ),
    ).toHaveLength(1);
  });

  it('re-signs safe upload metadata on replay and rejects a changed request', async () => {
    const value = runtime();
    const create = executor(value.runtime, 'data.uploadSession.create');
    const singleInput = {
      ownerProjectId: PROJECT_ID,
      objects: [
        {
          fileName: 'stations.geojson',
          mediaType: 'application/geo+json',
          sizeBytes: 4_096,
          sha256: SHA256,
        },
      ],
      preferredMode: 'PRESIGNED_PUT',
    };
    const output = await create.execute(singleInput, context);
    expect(
      DATA_CAPABILITY_REGISTRY[
        'data.uploadSession.create'
      ].outputSchema.safeParse(output).success,
    ).toBe(true);
    expect(value.store.calls[0]?.method).toBe('planQuarantinePut');
    const ledgerValues = value.pool.client.calls
      .filter(({ text }) => text.includes('data.command.outbox'))
      .flatMap(({ values }) => values.map(String));
    expect(ledgerValues.join('\n')).not.toContain('https://signed.invalid');
    const storedOperation = value.pool.client.calls.find(
      ({ text, values }) =>
        text.includes('data.command.operation.insert') &&
        values[3] === 'data.uploadSession.create',
    );
    expect(JSON.parse(String(storedOperation?.values[8]))).toMatchObject({
      assets: [{ fileName: 'stations.geojson' }],
    });

    const replay = await create.execute(singleInput, context);
    expect(replay).toEqual(output);
    expect(
      value.store.calls.filter(({ method }) => method === 'planQuarantinePut'),
    ).toHaveLength(2);
    await expect(
      create.execute({ ...singleInput, preferredMode: 'MULTIPART' }, context),
    ).rejects.toSatisfy((error: unknown) => {
      expect((error as PostgresDataCommandError).code).toBe(
        'IDEMPOTENCY_CONFLICT',
      );
      return true;
    });
  });

  it('accepts upload-session creation without a precomputed sha256', async () => {
    const value = runtime();

    const output = await executor(
      value.runtime,
      'data.uploadSession.create',
    ).execute(
      {
        ownerProjectId: PROJECT_ID,
        objects: [
          {
            fileName: 'large-source.bin',
            mediaType: 'application/octet-stream',
            sizeBytes: 4_096,
          },
        ],
      },
      context,
    );

    expect(
      DATA_CAPABILITY_REGISTRY[
        'data.uploadSession.create'
      ].outputSchema.safeParse(output).success,
    ).toBe(true);
    expect(value.store.calls[0]?.input).not.toHaveProperty('sha256');
  });

  it('rejects an expired upload session before touching S3', async () => {
    const value = runtime();
    value.pool.client.uploadExpiresAt = '2026-08-22T04:59:59.000Z';

    await expect(
      executor(value.runtime, 'data.uploadSession.complete').execute(
        {
          uploadSessionId: SESSION_ID,
          expectedVersion: 1,
          objects: [{ assetId: ASSET_ID, sizeBytes: 4_096, sha256: SHA256 }],
        },
        context,
      ),
    ).rejects.toMatchObject({ code: 'UPLOAD_SESSION_EXPIRED' });
    expect(value.store.calls).toHaveLength(0);
  });

  it('verifies completed objects before inserting authority Asset rows', async () => {
    const value = runtime();
    const output = await executor(
      value.runtime,
      'data.uploadSession.complete',
    ).execute(
      {
        uploadSessionId: SESSION_ID,
        expectedVersion: 1,
        objects: [{ assetId: ASSET_ID, sizeBytes: 4_096, sha256: SHA256 }],
      },
      context,
    );
    expect(
      DATA_CAPABILITY_REGISTRY[
        'data.uploadSession.complete'
      ].outputSchema.safeParse(output).success,
    ).toBe(true);
    const verifyIndex = value.timeline.indexOf('s3:verify');
    const insertIndex = value.timeline.indexOf('sql:asset-insert');
    expect(verifyIndex).toBeGreaterThanOrEqual(0);
    expect(insertIndex).toBeGreaterThanOrEqual(0);
    expect(verifyIndex).toBeLessThan(insertIndex);
    expect(value.pool.client.calls[insertIndex]?.text).not.toMatch(/delete/i);
  });

  it('rejects stale upload and operation versions before side effects', async () => {
    const value = runtime();
    value.pool.client.uploadVersion = 2;
    await expect(
      executor(value.runtime, 'data.uploadSession.complete').execute(
        {
          uploadSessionId: SESSION_ID,
          expectedVersion: 1,
          objects: [{ assetId: ASSET_ID, sizeBytes: 4_096, sha256: SHA256 }],
        },
        context,
      ),
    ).rejects.toSatisfy((error: unknown) => {
      expect((error as PostgresDataCommandError).code).toBe('VERSION_CONFLICT');
      return true;
    });
    expect(value.store.calls).toHaveLength(0);

    value.pool.client.operationVersion = 3;
    await expect(
      executor(value.runtime, 'data.operation.cancel').execute(
        { operationId: OPERATION_ID, expectedVersion: 2 },
        { ...context, idempotencyKey: 'd2000000-0000-4000-8000-000000000014' },
      ),
    ).rejects.toSatisfy((error: unknown) => {
      expect((error as PostgresDataCommandError).code).toBe('VERSION_CONFLICT');
      return true;
    });
  });

  it('keeps RECEIVED on submit and wakes the same static processing job on approval', async () => {
    const value = runtime();
    await executor(value.runtime, 'data.ingestion.create').execute(
      {
        assetIds: [ASSET_ID],
        ownerProjectId: PROJECT_ID,
        intendedUses: ['hydrology-analysis'],
        requestedSecurityLevel: 'L1_INTERNAL',
      },
      context,
    );
    value.pool.client.operationStatus = 'WAITING_INPUT';
    await executor(value.runtime, 'data.ingestion.submit').execute(
      { ingestionId: INGESTION_ID, expectedVersion: 1 },
      { ...context, idempotencyKey: 'd2000000-0000-4000-8000-000000000011' },
    );
    value.pool.client.ingestionState = 'REVIEW_REQUIRED';
    value.pool.client.ingestionVersion = 2;
    value.pool.client.operationStatus = 'WAITING_REVIEW';
    await executor(value.runtime, 'data.ingestion.approve').execute(
      { ingestionId: INGESTION_ID, expectedVersion: 2, reviewNote: 'ok' },
      { ...context, idempotencyKey: 'd2000000-0000-4000-8000-000000000012' },
    );
    await executor(value.runtime, 'data.ingestion.reject').execute(
      {
        ingestionId: INGESTION_ID,
        expectedVersion: 2,
        reasonCode: 'QUALITY_GATE_FAILED',
        reason: 'invalid',
      },
      { ...context, idempotencyKey: 'd2000000-0000-4000-8000-000000000013' },
    );

    const sql = value.pool.client.calls.map(({ text }) => text).join('\n');
    expect(sql).toContain('data.ingestion.session.lock');
    expect(sql.match(/data\.ingestion\.job\.insert/g)).toHaveLength(1);
    expect(sql.match(/data\.ingestion\.job\.wake/g)).toHaveLength(1);
    expect(sql).toContain("'data.ingestion.process'");
    expect(sql).not.toContain('SCAN_AND_PROFILE');
    expect(sql).not.toContain('COMMIT_APPROVED_INGESTION');
    const submitUpdate = value.pool.client.calls.find(({ text }) =>
      text.includes('data.ingestion.submit.operation'),
    );
    expect(submitUpdate?.text).not.toMatch(/set\s+state\s*=/i);
    expect(sql).not.toMatch(/insert into catalog\.data_item_version/i);
  });

  it('uses explicit tenant/project/security/policy predicates on every lock and update', async () => {
    const value = runtime();
    await executor(value.runtime, 'data.operation.cancel').execute(
      { operationId: OPERATION_ID, expectedVersion: 2 },
      context,
    );

    const guarded = value.pool.client.calls.filter(({ text }) =>
      /data\.(?:upload|ingestion|operation)\..*(?:lock|update|cancel)/.test(
        text,
      ),
    );
    expect(guarded.length).toBeGreaterThan(0);
    for (const { text } of guarded) {
      expect(text).toMatch(/tenant_id/i);
      expect(text).toMatch(/project_id/i);
      expect(text).toMatch(/security_level/i);
      expect(text).toMatch(/policy_version/i);
    }
  });

  it('locks and cancels an Operation with optimistic versioning and no deletes', async () => {
    const value = runtime();
    const output = await executor(
      value.runtime,
      'data.operation.cancel',
    ).execute(
      { operationId: OPERATION_ID, expectedVersion: 2, reason: 'superseded' },
      context,
    );
    expect(
      DATA_CAPABILITY_REGISTRY['data.operation.cancel'].outputSchema.safeParse(
        output,
      ).success,
    ).toBe(true);
    const sql = value.pool.client.calls.map(({ text }) => text).join('\n');
    expect(sql).toContain('data.operation.lock');
    expect(sql).toContain('data.ingestion.cancel.update');
    expect(sql).toContain('data.operation.cancel-jobs.update');
    expect(sql).toContain('for update');
    expect(sql).not.toMatch(/delete\s+from/i);
  });

  it('rolls back and sanitizes S3 failures before Asset insertion', async () => {
    const value = runtime();
    value.store.fail = true;
    let caught: unknown;
    try {
      await executor(value.runtime, 'data.uploadSession.complete').execute(
        {
          uploadSessionId: SESSION_ID,
          expectedVersion: 1,
          objects: [{ assetId: ASSET_ID, sizeBytes: 4_096, sha256: SHA256 }],
        },
        context,
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(PostgresDataCommandError);
    expect((caught as PostgresDataCommandError).code).toBe(
      'OBJECT_STORE_UNAVAILABLE',
    );
    expect((caught as Error).message).not.toContain('private-s3');
    expect(
      value.pool.client.calls.some(({ text }) =>
        text.includes('data.upload.asset.insert'),
      ),
    ).toBe(false);
    expect(
      value.pool.client.calls.some(
        ({ text }) => text.toLowerCase() === 'rollback',
      ),
    ).toBe(true);
  });

  it('persists spatial and temporal metadata instead of echoing uncommitted fields', async () => {
    const value = runtime();

    await executor(value.runtime, 'data.catalog.create').execute(
      {
        name: 'Spatiotemporal draft',
        businessDomains: ['water-monitoring'],
        sourceNatures: ['observed'],
        sourceChannels: ['file-upload'],
        processingStage: 'RAW',
        intendedUses: ['hydrology-analysis'],
        ownerProjectId: PROJECT_ID,
        sourceOrganization: 'WISER Lab',
        authorizationScope: 'data.catalog.read',
        citationRequirements: [],
        spatialExtent: { bbox: [116, 39, 117, 40], crs: 'EPSG:4326' },
        sourceCrs: 'EPSG:4326',
        canonicalCrs: 'EPSG:4490',
        temporalExtent: {
          start: '2026-08-01T00:00:00.000Z',
          end: '2026-08-02T00:00:00.000Z',
        },
        timezone: 'Asia/Shanghai',
        temporalResolution: 'P1D',
        unitDefinitions: [],
        missingValueRules: [],
        anomalyRules: [],
        generationMethod: 'OBSERVED',
        securityLevel: 'L1_INTERNAL',
        updateMode: 'SNAPSHOT',
      },
      context,
    );

    const sql = value.pool.client.calls.map(({ text }) => text).join('\n');
    expect(sql).toContain('data.catalog.spatial-extent.insert');
    expect(sql).toContain('data.catalog.temporal-extent.insert');
    const scope = value.pool.client.calls.find(({ text }) =>
      text.includes('data.command.scope'),
    );
    expect(scope?.values[4]).toBe('120000ms');
  });

  it('uses a bounded dynamic multipart size for a legal 5 TiB upload', async () => {
    const value = runtime();
    const fiveTib = 5 * 1024 * 1024 * 1024 * 1024;

    await executor(value.runtime, 'data.uploadSession.create').execute(
      {
        ownerProjectId: PROJECT_ID,
        preferredMode: 'MULTIPART',
        objects: [
          {
            fileName: 'archive.bin',
            mediaType: 'application/octet-stream',
            sizeBytes: fiveTib,
          },
        ],
      },
      context,
    );

    const plan = value.store.calls.find(
      ({ method }) => method === 'planQuarantineMultipart',
    )?.input as { readonly partSizeBytes: number };
    expect(plan.partSizeBytes).toBeGreaterThanOrEqual(
      Math.ceil(fiveTib / 10_000),
    );
    expect(plan.partSizeBytes).toBeLessThanOrEqual(5 * 1024 * 1024 * 1024);
  });

  it('inherits the maximum asset classification and never substitutes the caller ceiling', async () => {
    const value = runtime();
    value.pool.client.assetSecurity = 'L2_RESTRICTED';

    await executor(value.runtime, 'data.ingestion.create').execute(
      {
        assetIds: [ASSET_ID],
        ownerProjectId: PROJECT_ID,
        intendedUses: ['hydrology-analysis'],
        requestedSecurityLevel: 'L0_PUBLIC',
      },
      context,
    );

    const sessionInsert = value.pool.client.calls.find(({ text }) =>
      text.includes('data.ingestion.create'),
    );
    const inputInsert = value.pool.client.calls.find(({ text }) =>
      text.includes('data.ingestion.input-asset.insert'),
    );
    expect(sessionInsert?.values[5]).toBe('L2_RESTRICTED');
    expect(inputInsert?.values[6]).toBe('L2_RESTRICTED');
    expect(sessionInsert?.values[5]).not.toBe('L3_CONFIDENTIAL');
  });

  it('emits the exact frozen worker payload on submit and approval wake-up', async () => {
    const value = runtime();
    value.pool.client.operationStatus = 'WAITING_INPUT';
    await executor(value.runtime, 'data.ingestion.submit').execute(
      { ingestionId: INGESTION_ID, expectedVersion: 1 },
      context,
    );
    value.pool.client.ingestionState = 'REVIEW_REQUIRED';
    value.pool.client.ingestionVersion = 2;
    value.pool.client.operationStatus = 'WAITING_REVIEW';
    await executor(value.runtime, 'data.ingestion.approve').execute(
      { ingestionId: INGESTION_ID, expectedVersion: 2 },
      { ...context, idempotencyKey: randomUUID() },
    );

    const submitted = value.pool.client.calls.find(({ text }) =>
      text.includes('data.ingestion.job.insert'),
    );
    const approved = value.pool.client.calls.find(({ text }) =>
      text.includes('data.ingestion.job.wake'),
    );
    expect(JSON.parse(String(submitted?.values[6]))).toEqual({
      tenantId: TENANT_ID,
      projectId: PROJECT_ID,
      ingestionId: INGESTION_ID,
      expectedState: 'RECEIVED',
      expectedVersion: 1,
    });
    expect(JSON.parse(String(approved?.values[1]))).toEqual({
      tenantId: TENANT_ID,
      projectId: PROJECT_ID,
      ingestionId: INGESTION_ID,
      expectedState: 'APPROVED',
      expectedVersion: 3,
    });
  });

  it('deterministically reuses an existing same-hash Asset', async () => {
    const value = runtime();
    const existingAssetId = 'd2000000-0000-4000-8000-000000000077';
    value.pool.client.existingAsset = {
      asset_id: existingAssetId,
      storage_key: 'raw/existing',
      media_type: 'application/geo+json',
      byte_size: 4_096,
      security_level: 'L2_RESTRICTED',
      policy_version: 7,
    };

    const output = (await executor(
      value.runtime,
      'data.uploadSession.complete',
    ).execute(
      {
        uploadSessionId: SESSION_ID,
        expectedVersion: 1,
        objects: [{ assetId: ASSET_ID, sizeBytes: 4_096, sha256: SHA256 }],
      },
      context,
    )) as { readonly uploadSession: UploadSessionDto };

    expect(output.uploadSession.assetIds).toEqual([existingAssetId]);
    expect(
      value.pool.client.calls.some(({ text }) =>
        text.includes('data.upload.asset.insert'),
      ),
    ).toBe(false);
  });

  it('refuses same-hash reuse when immutable size or media metadata differs', async () => {
    const value = runtime();
    value.pool.client.existingAsset = {
      asset_id: 'd2000000-0000-4000-8000-000000000077',
      storage_key: 'raw/existing',
      media_type: 'application/pdf',
      byte_size: 123,
      security_level: 'L1_INTERNAL',
      policy_version: 7,
    };

    await expect(
      executor(value.runtime, 'data.uploadSession.complete').execute(
        {
          uploadSessionId: SESSION_ID,
          expectedVersion: 1,
          objects: [{ assetId: ASSET_ID, sizeBytes: 4_096, sha256: SHA256 }],
        },
        context,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('HEAD-verifies a multipart completion retry after the S3 side effect', async () => {
    const value = runtime();
    value.pool.client.uploadRequestPayload = {
      assets: [
        {
          assetId: ASSET_ID,
          uploadId: ASSET_ID,
          fileName: 'stations.geojson',
          sizeBytes: 4_096,
          contentType: 'application/geo+json',
          securityLevel: 'L1_INTERNAL',
          method: 'MULTIPART',
          storageKey: `quarantine/${ASSET_ID}`,
          multipartUploadId: 'multipart-existing',
          partSizeBytes: 8 * 1024 * 1024,
        },
      ],
      expiresAt: value.pool.client.uploadExpiresAt,
      createdAt: NOW.toISOString(),
    };
    value.store.failCompleteOnly = true;

    await expect(
      executor(value.runtime, 'data.uploadSession.complete').execute(
        {
          uploadSessionId: SESSION_ID,
          expectedVersion: 1,
          objects: [
            {
              assetId: ASSET_ID,
              sizeBytes: 4_096,
              sha256: SHA256,
              multipartUploadId: 'multipart-existing',
              parts: [{ partNumber: 1, etag: 'etag-1' }],
            },
          ],
        },
        context,
      ),
    ).resolves.toBeDefined();
    expect(
      value.store.calls.filter(
        ({ method }) => method === 'verifyQuarantineObject',
      ).length,
    ).toBeGreaterThanOrEqual(2);
  });

  it('compensates already-created upload plans when a later object fails', async () => {
    const value = runtime();
    value.store.failPlanAt = 2;

    await expect(
      executor(value.runtime, 'data.uploadSession.create').execute(
        {
          ownerProjectId: PROJECT_ID,
          objects: [
            {
              fileName: 'one.bin',
              mediaType: 'application/octet-stream',
              sizeBytes: 1_024,
            },
            {
              fileName: 'two.bin',
              mediaType: 'application/octet-stream',
              sizeBytes: 2_048,
            },
          ],
        },
        context,
      ),
    ).rejects.toMatchObject({ code: 'OBJECT_STORE_UNAVAILABLE' });
    expect(
      value.store.calls.filter(
        ({ method }) => method === 'abortQuarantineObject',
      ),
    ).toHaveLength(1);
  });

  it('fails closed on aborted requests and zero-row optimistic updates', async () => {
    const aborted = new AbortController();
    aborted.abort();
    const before = runtime();
    await expect(
      executor(before.runtime, 'data.operation.cancel').execute(
        { operationId: OPERATION_ID, expectedVersion: 2 },
        { ...context, signal: aborted.signal },
      ),
    ).rejects.toMatchObject({ code: 'COMMAND_ABORTED' });
    expect(before.pool.client.calls).toHaveLength(0);

    const stale = runtime();
    stale.pool.client.zeroRowCountFor = 'data.operation.cancel.update';
    await expect(
      executor(stale.runtime, 'data.operation.cancel').execute(
        { operationId: OPERATION_ID, expectedVersion: 2 },
        context,
      ),
    ).rejects.toMatchObject({ code: 'PERSISTENCE_FAILED' });
    expect(
      stale.pool.client.calls.some(
        ({ text }) => text.toLowerCase() === 'rollback',
      ),
    ).toBe(true);
  });

  const realPostgresTest =
    process.env['WISER_DATA_PG_INTEGRATION'] === '1' ? it : it.skip;

  realPostgresTest(
    'executes fixed SQL as a non-BYPASSRLS role and proves rollback isolation',
    async () => {
      const connectionString =
        process.env['DATA_TEST_DATABASE_URL'] ??
        'postgresql://wiser_data:wiser-local-data-4f8c71b0f3e947d4@127.0.0.1:55432/wiser_data';
      const admin = new Pool({ connectionString, max: 2 });
      const suffix = `${process.pid}_${Date.now().toString(36)}`;
      const roleName = `wiser_command_test_${suffix}`;
      const hiddenTenantId = randomUUID();
      const hiddenProjectId = randomUUID();
      const crossTenantOperationId = randomUUID();
      const highSecurityOperationId = randomUUID();
      let commandRuntime: ReturnType<
        typeof createPostgresDataCommandRuntime
      > | null = null;
      let preparedClient: PoolClient | null = null;
      try {
        await admin.query(
          `create role ${roleName} nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls`,
        );
        await admin.query(
          `grant usage on schema catalog, ingestion, service, security, event to ${roleName}`,
        );
        await admin.query(
          `grant select, insert, update on all tables in schema catalog, ingestion, service, security, event to ${roleName}`,
        );
        await admin.query(
          `grant usage, select on all sequences in schema catalog, ingestion, service, security, event to ${roleName}`,
        );
        await admin.query(
          `grant execute on all functions in schema ingestion, security, event to ${roleName}`,
        );
        const fixtureSql = `
          insert into service.operation (
            operation_id, tenant_id, project_id, capability_id, actor_id,
            status, progress_percent, idempotency_key, request_payload,
            security_level, policy_version, row_version
          ) values ($1::uuid, $2::uuid, $3::uuid, 'data.ingestion.create',
            $4::uuid, 'RUNNING', 10, $5, '{}'::jsonb, $6, 1, 1)
        `;
        await admin.query(fixtureSql, [
          crossTenantOperationId,
          hiddenTenantId,
          hiddenProjectId,
          ACTOR_ID,
          `fixture:${crossTenantOperationId}`,
          'L1_INTERNAL',
        ]);
        await admin.query(fixtureSql, [
          highSecurityOperationId,
          TENANT_ID,
          PROJECT_ID,
          ACTOR_ID,
          `fixture:${highSecurityOperationId}`,
          'L3_CONFIDENTIAL',
        ]);

        const applicationPool = new Pool({ connectionString, max: 1 });
        const rollbackPool = new RollbackCommitPool(applicationPool, roleName);
        commandRuntime = createPostgresDataCommandRuntime(
          rollbackPool,
          new FakeObjectStore(),
          { clock: () => NOW, idFactory: randomUUID },
        );
        let catalogOutput: unknown;
        try {
          catalogOutput = await executor(
            commandRuntime,
            'data.catalog.create',
          ).execute(
            {
              name: 'Rollback-only draft',
              businessDomains: ['water-monitoring'],
              sourceNatures: ['observed'],
              sourceChannels: ['file-upload'],
              processingStage: 'RAW',
              intendedUses: ['hydrology-analysis'],
              ownerProjectId: PROJECT_ID,
              sourceOrganization: 'WISER Lab',
              authorizationScope: 'data.catalog.read',
              citationRequirements: [],
              spatialExtent: {
                bbox: [116, 39, 117, 40],
                crs: 'EPSG:4326',
              },
              sourceCrs: 'EPSG:4326',
              canonicalCrs: 'EPSG:4490',
              temporalExtent: {
                start: '2026-08-01T00:00:00.000Z',
                end: '2026-08-02T00:00:00.000Z',
              },
              timezone: 'Asia/Shanghai',
              unitDefinitions: [],
              missingValueRules: [],
              anomalyRules: [],
              generationMethod: 'OBSERVED',
              securityLevel: 'L1_INTERNAL',
              updateMode: 'SNAPSHOT',
            },
            { ...context, idempotencyKey: randomUUID() },
          );
        } catch (error) {
          throw new Error(
            `real PostgreSQL command failed: ${rollbackPool.errors.at(-1) ?? 'no database detail'}`,
            { cause: error },
          );
        }
        const output = catalogOutput as {
          readonly item: { readonly dataItemId: string };
        };
        const rolledBack = await admin.query<{ readonly count: number }>(
          'select count(*)::integer as count from catalog.data_item where data_item_id = $1::uuid',
          [output.item.dataItemId],
        );
        expect(rolledBack.rows[0]?.count).toBe(0);

        await expect(
          executor(commandRuntime, 'data.operation.cancel').execute(
            { operationId: crossTenantOperationId, expectedVersion: 1 },
            { ...context, idempotencyKey: randomUUID() },
          ),
        ).rejects.toMatchObject({ code: 'NOT_FOUND' });
        await expect(
          executor(commandRuntime, 'data.operation.cancel').execute(
            { operationId: highSecurityOperationId, expectedVersion: 1 },
            {
              ...context,
              effectiveMaxSecurityLevel: 'L1_INTERNAL',
              idempotencyKey: randomUUID(),
            },
          ),
        ).rejects.toMatchObject({ code: 'NOT_FOUND' });

        await commandRuntime.close();
        commandRuntime = null;

        const pipelineOperationId = randomUUID();
        const pipelineIngestionId = randomUUID();
        const pipelineAssetId = randomUUID();
        preparedClient = await admin.connect();
        await preparedClient.query('begin');
        await preparedClient.query(
          `insert into catalog.asset (
             asset_id, tenant_id, project_id, storage_key, content_hash,
             media_type, byte_size, lifecycle_state, security_level,
             policy_version, row_version
           ) values ($1::uuid, $2::uuid, $3::uuid, $4, decode($5, 'hex'),
             'application/json', 128, 'QUARANTINED', 'L1_INTERNAL', 1, 1)`,
          [
            pipelineAssetId,
            TENANT_ID,
            PROJECT_ID,
            `integration/${pipelineAssetId}`,
            'c'.repeat(64),
          ],
        );
        await preparedClient.query(
          `insert into service.operation (
             operation_id, tenant_id, project_id, capability_id, actor_id,
             status, progress_percent, idempotency_key, request_payload,
             security_level, policy_version, row_version
           ) values ($1::uuid, $2::uuid, $3::uuid, 'data.ingestion.create',
             $4::uuid, 'WAITING_INPUT', 0, $5, '{}'::jsonb,
             'L1_INTERNAL', 1, 1)`,
          [
            pipelineOperationId,
            TENANT_ID,
            PROJECT_ID,
            ACTOR_ID,
            `fixture:${pipelineOperationId}`,
          ],
        );
        await preparedClient.query(
          `insert into ingestion.session (
             ingestion_id, tenant_id, project_id, operation_id,
             owner_project_id, state, intended_uses, expected_version,
             requested_security_level, security_level, policy_version,
             row_version
           ) values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $3::uuid,
             'RECEIVED', array['hydrology-analysis'], 1, 'L1_INTERNAL',
             'L1_INTERNAL', 1, 1)`,
          [pipelineIngestionId, TENANT_ID, PROJECT_ID, pipelineOperationId],
        );
        await preparedClient.query(
          `insert into ingestion.input_asset (
             input_asset_id, tenant_id, project_id, ingestion_id, asset_id,
             ordinal, scan_status, security_level, policy_version, row_version
           ) values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, 0,
             'PENDING', 'L1_INTERNAL', 1, 1)`,
          [
            randomUUID(),
            TENANT_ID,
            PROJECT_ID,
            pipelineIngestionId,
            pipelineAssetId,
          ],
        );
        await preparedClient.query(`set role ${roleName}`);
        const savepointPool = new SavepointRollbackPool(preparedClient);
        const pipelineRuntime = createPostgresDataCommandRuntime(
          savepointPool,
          new FakeObjectStore(),
          { clock: () => NOW, idFactory: randomUUID },
        );
        await executor(pipelineRuntime, 'data.ingestion.submit').execute(
          { ingestionId: pipelineIngestionId, expectedVersion: 1 },
          { ...context, idempotencyKey: randomUUID() },
        );
        expect(savepointPool.capturedJobPayload).toEqual({
          tenantId: TENANT_ID,
          projectId: PROJECT_ID,
          ingestionId: pipelineIngestionId,
          expectedState: 'RECEIVED',
          expectedVersion: 1,
        });
        await pipelineRuntime.close();
        await preparedClient.query('reset role');
        const postRollback = await preparedClient.query<{
          readonly session_state: string;
          readonly operation_status: string;
          readonly job_count: number;
        }>(
          `select session.state as session_state,
             operation.status as operation_status,
             (select count(*)::integer from ingestion.job
              where ingestion_id = session.ingestion_id) as job_count
           from ingestion.session as session
           join service.operation as operation
             on operation.operation_id = session.operation_id
           where session.ingestion_id = $1::uuid`,
          [pipelineIngestionId],
        );
        expect(postRollback.rows[0]).toMatchObject({
          session_state: 'RECEIVED',
          operation_status: 'WAITING_INPUT',
          job_count: 0,
        });
        await preparedClient.query('rollback');
        preparedClient.release();
        preparedClient = null;
      } finally {
        if (commandRuntime !== null) {
          await commandRuntime.close().catch(() => undefined);
        }
        if (preparedClient !== null) {
          await preparedClient.query('reset role').catch(() => undefined);
          await preparedClient.query('rollback').catch(() => undefined);
          preparedClient.release();
        }
        await admin
          .query(
            'delete from service.operation where operation_id = any($1::uuid[])',
            [[crossTenantOperationId, highSecurityOperationId]],
          )
          .catch(() => undefined);
        await admin.query(`drop owned by ${roleName}`).catch(() => undefined);
        await admin
          .query(`drop role if exists ${roleName}`)
          .catch(() => undefined);
        await admin.end();
      }
    },
    30_000,
  );
});
