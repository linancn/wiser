import { createRequire } from 'node:module';

import { describe, expect, it } from 'vitest';

import {
  ClamAvInstreamScanner,
  FixtureFakeAiPlanValidator,
  FixtureFakeAiPlanner,
  PostgresIngestionAuthority,
  TikaIngestionParser,
  type IngestionRuntimeClient,
  type IngestionRuntimePool,
} from '../src/adapters/ingestion-runtime.js';
import type {
  FrozenIngestionCheckpoint,
  HashOnlyPipelineEvidence,
  IngestionTransitionRequest,
} from '../src/handlers/ingestion-pipeline.js';
import { canonicalPipelineHash } from '../src/handlers/ingestion-pipeline.js';

const tenantId = '11111111-1111-4111-8111-111111111111';
const projectId = '22222222-2222-4222-8222-222222222222';
const ingestionId = '33333333-3333-4333-8333-333333333333';
const operationId = '44444444-4444-4444-8444-444444444444';
const assetIds = [
  '55555555-5555-4555-8555-555555555555',
  '66666666-6666-4666-8666-666666666666',
];
const uploadIds = [
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
] as const;
const blobIds = [
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
] as const;

const evidence: HashOnlyPipelineEvidence = {
  step: 'ai-schema-plan',
  inputHash: 'a'.repeat(64),
  outputHash: 'b'.repeat(64),
  agentRun: {
    kind: 'FAKE_AI_MAPPING',
    inputHash: 'a'.repeat(64),
    outputHash: 'b'.repeat(64),
    validator: 'injected',
  },
};

class FakeClient implements IngestionRuntimeClient {
  readonly queries: Array<{
    readonly text: string;
    readonly values?: readonly unknown[];
  }> = [];
  state = 'RECEIVED';
  version = 1;
  released = false;
  frozenCheckpoint?: FrozenIngestionCheckpoint;
  rejectAssetBind = false;
  failVersionInsertOnce = false;
  forceJsonMediaType = false;
  trustedHashes = true;

  query(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ readonly rows: readonly Record<string, unknown>[] }> {
    this.queries.push(values === undefined ? { text } : { text, values });
    if (/ingestion\.runtime\.load/.test(text)) {
      return Promise.resolve({
        rows: assetIds.map((assetId, ordinal) => ({
          state: this.state,
          row_version: String(this.version),
          requested_security_level: 'L0_PUBLIC',
          security_level: 'L0_PUBLIC',
          policy_version: '9',
          operation_id: operationId,
          version_id:
            this.state === 'COMMITTED'
              ? '77777777-7777-4777-8777-777777777777'
              : null,
          asset_id: assetId,
          ordinal,
          storage_key: `tenants/${tenantId}/projects/${projectId}/quarantine/${uploadIds[ordinal]}/object`,
          media_type: this.forceJsonMediaType
            ? 'application/json'
            : ordinal === 0
              ? 'application/pdf'
              : 'application/geo+json',
          byte_size: ordinal === 0 ? '128' : '256',
          source_hash: this.trustedHashes
            ? ordinal === 0
              ? 'c'.repeat(64)
              : 'd'.repeat(64)
            : null,
          content_blob_id: this.trustedHashes ? blobIds[ordinal] : null,
          frozen_checkpoint: this.frozenCheckpoint ?? null,
        })),
      });
    }
    if (/ingestion\.runtime\.lock/.test(text)) {
      return Promise.resolve({
        rows: [
          {
            state: this.state,
            row_version: String(this.version),
            requested_security_level: 'L0_PUBLIC',
            security_level: 'L0_PUBLIC',
            policy_version: '9',
            operation_id: operationId,
            intended_uses: ['dispatch'],
          },
        ],
      });
    }
    if (/ingestion\.runtime\.transition/.test(text)) {
      this.state = String(values?.[1]);
      this.version += 1;
      return Promise.resolve({
        rows: [{ state: this.state, row_version: String(this.version) }],
      });
    }
    if (/ingestion\.runtime\.fingerprint-assets-lock/.test(text)) {
      return Promise.resolve({
        rows: assetIds.map((assetId, ordinal) => ({
          asset_id: assetId,
          ordinal,
          storage_key: `tenants/${tenantId}/projects/${projectId}/quarantine/${uploadIds[ordinal]}/object`,
          media_type:
            ordinal === 0 ? 'application/pdf' : 'application/geo+json',
          byte_size: ordinal === 0 ? '128' : '256',
          content_blob_id: null,
          trusted_hash: null,
          input_fingerprint: null,
        })),
      });
    }
    if (/ingestion\.runtime\.content-blob-upsert/.test(text)) {
      return Promise.resolve({
        rows: [
          {
            content_blob_id: values?.[0],
            trusted_hash: values?.[3],
            byte_size: values?.[4],
            security_level: values?.[5],
            policy_version: values?.[6],
            lifecycle_state: 'FINGERPRINTED',
            raw_storage_key: null,
          },
        ],
      });
    }
    if (/ingestion\.runtime\.content-blob-lock/.test(text)) {
      const ordinal = values?.[2] === 'c'.repeat(64) ? 0 : 1;
      return Promise.resolve({
        rows: [
          {
            content_blob_id: blobIds[ordinal],
            trusted_hash: values?.[2],
            byte_size: ordinal === 0 ? '128' : '256',
            security_level: 'L0_PUBLIC',
            policy_version: '9',
            lifecycle_state: 'FINGERPRINTED',
            raw_storage_key: null,
          },
        ],
      });
    }
    if (/ingestion\.runtime\.content-blob-promote/.test(text)) {
      return Promise.resolve({
        rows: [
          {
            content_blob_id: values?.[2],
            raw_storage_key: values?.[3],
            lifecycle_state: 'RAW',
          },
        ],
      });
    }
    if (/ingestion\.runtime\.asset-content-bind/.test(text)) {
      return Promise.resolve({ rows: [{ asset_id: values?.[0] }] });
    }
    if (/ingestion\.runtime\.input-fingerprint/.test(text)) {
      return Promise.resolve({ rows: [{ asset_id: values?.[0] }] });
    }
    if (/ingestion\.runtime\.review-checkpoint/.test(text)) {
      this.frozenCheckpoint = JSON.parse(
        String(values?.[5]),
      ) as FrozenIngestionCheckpoint;
      return Promise.resolve({ rows: [{ transform_plan_id: values?.[0] }] });
    }
    if (/ingestion\.runtime\.review-session/.test(text)) {
      this.state = String(values?.[1]);
      this.version += 1;
      return Promise.resolve({
        rows: [{ state: this.state, row_version: String(this.version) }],
      });
    }
    if (
      /ingestion\.runtime\.commit-version/.test(text) &&
      this.failVersionInsertOnce
    ) {
      this.failVersionInsertOnce = false;
      return Promise.reject(new Error('database password=secret'));
    }
    if (/ingestion\.runtime\.commit-version/.test(text)) {
      return Promise.resolve({ rows: [{ version_id: values?.[0] }] });
    }
    if (/ingestion\.runtime\.frozen-checkpoint-lock/.test(text)) {
      return Promise.resolve({
        rows:
          this.frozenCheckpoint === undefined
            ? []
            : [{ plan: this.frozenCheckpoint }],
      });
    }
    if (/ingestion\.runtime\.commit-assets/.test(text)) {
      return Promise.resolve({
        rows: this.rejectAssetBind
          ? []
          : assetIds.map((assetId) => ({ asset_id: assetId })),
      });
    }
    if (/ingestion\.runtime\.committed-version/.test(text)) {
      return Promise.resolve({
        rows: [
          {
            version_id: '77777777-7777-4777-8777-777777777777',
          },
        ],
      });
    }
    if (/ingestion\.runtime\.commit-session/.test(text)) {
      this.state = 'COMMITTED';
      this.version += 1;
      return Promise.resolve({
        rows: [{ state: this.state, row_version: String(this.version) }],
      });
    }
    if (/ingestion\.runtime\.operation-lock/.test(text)) {
      return Promise.resolve({
        rows: [{ status: 'RUNNING', row_version: '3' }],
      });
    }
    return Promise.resolve({ rows: [] });
  }

  release(): void {
    this.released = true;
  }
}

class FakePool implements IngestionRuntimePool {
  readonly client = new FakeClient();

  connect(): Promise<IngestionRuntimeClient> {
    return Promise.resolve(this.client);
  }
}

class FakeObjectStore {
  readonly calls: Array<Record<string, unknown>> = [];

  commitQuarantineObject(input: Record<string, unknown>) {
    this.calls.push(structuredClone(input));
    return Promise.resolve({
      raw: {
        bucket: 'wiser-data',
        key: `raw/${String(input.sha256)}`,
      },
      version: {
        bucket: 'wiser-data',
        key: `versions/${String(input.versionId)}/${String(input.sha256)}`,
      },
      reused: { raw: this.calls.length > 2, version: this.calls.length > 2 },
    });
  }
}

function frozenCheckpoint(): FrozenIngestionCheckpoint {
  const base = {
    assetIds,
    assetManifest: {
      assets: assetIds.map((assetId, ordinal) => ({
        assetId,
        ordinal,
        uploadId:
          ordinal === 0
            ? 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
            : 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        quarantineObjectRef: `tenants/${tenantId}/projects/${projectId}/quarantine/${uploadIds[ordinal]}/object`,
        sourceKind: ordinal === 0 ? 'document' : 'geojson',
        mediaType: ordinal === 0 ? 'application/pdf' : 'application/geo+json',
        size: ordinal === 0 ? 128 : 256,
        sourceHash: ordinal === 0 ? 'c'.repeat(64) : 'd'.repeat(64),
        scanHash: '1'.repeat(64),
        parserHash: ordinal === 0 ? 'c'.repeat(64) : 'd'.repeat(64),
        profileHash: '2'.repeat(64),
        classificationHash: '3'.repeat(64),
      })),
      transformedArtifactRef: 'quarantine/transform',
      transformedHash: 'e'.repeat(64),
      validatedPlan: {
        schemaPlan: { version: '1' },
        semanticPlan: { version: '1' },
        confidence: 1,
        planHash: 'f'.repeat(64),
      },
    },
    quality: {
      score: 1,
      grade: 'A' as const,
      passed: true,
      failedRuleIds: [] as string[],
      blockingRuleIds: [] as string[],
    },
    alignment: { alignmentHash: '9'.repeat(64) },
  };
  return { ...base, reviewHash: canonicalPipelineHash(base) };
}

function authority(pool = new FakePool(), objectStore = new FakeObjectStore()) {
  return {
    pool,
    objectStore,
    authority: new PostgresIngestionAuthority({
      pool,
      objectStore,
      workerActorId: '88888888-8888-4888-8888-888888888888',
      maximumPolicyVersion: 9,
    }),
  };
}

describe('Postgres ingestion authority adapter', () => {
  it('loads ordered authoritative assets under four RLS settings', async () => {
    const runtime = authority();
    const checkpoint = await runtime.authority.load({
      tenantId,
      projectId,
      ingestionId,
      securityLevel: 'L0_PUBLIC',
      policyVersion: 9,
    });

    expect(checkpoint).toMatchObject({
      state: 'RECEIVED',
      version: 1,
      securityLevel: 'L0_PUBLIC',
      assets: [
        { assetId: assetIds[0], ordinal: 0, sourceKind: 'document' },
        { assetId: assetIds[1], ordinal: 1, sourceKind: 'geojson' },
      ],
    });
    const statements = runtime.pool.client.queries.map(({ text }) =>
      text.trim(),
    );
    expect(statements.at(0)).toBe('BEGIN READ ONLY');
    expect(statements.at(-1)).toBe('COMMIT');
    expect(checkpoint).toMatchObject({ policyVersion: 9 });
    expect(
      runtime.pool.client.queries.find(({ text }) => /set_config/.test(text))
        ?.values,
    ).toEqual([tenantId, projectId, 'L0_PUBLIC', '9']);
  });

  it('locks expected state/version and persists only hash evidence plus Agent run/action/plan', async () => {
    const runtime = authority();
    const request: IngestionTransitionRequest = {
      tenantId,
      projectId,
      ingestionId,
      expectedState: 'RECEIVED',
      expectedVersion: 1,
      toState: 'SCHEMA_MAPPED',
      evidence,
      securityLevel: 'L0_PUBLIC',
      policyVersion: 9,
    };
    await runtime.authority.transition(request);

    const sql = runtime.pool.client.queries.map(({ text }) => text).join('\n');
    expect(sql).toMatch(/for update/i);
    expect(sql).toContain('ingestion.runtime.agent-run');
    expect(sql).toContain('ingestion.runtime.agent-action');
    expect(sql).toContain('ingestion.runtime.transform-plan');
    expect(sql).toContain('security.audit_event');
    expect(JSON.stringify(runtime.pool.client.queries)).not.toContain(
      'schemaPlan',
    );
    expect(JSON.stringify(runtime.pool.client.queries)).toContain(
      evidence.inputHash,
    );
    expect(runtime.pool.client.released).toBe(true);
  });

  it('records only Worker-computed fingerprints into content Blob, Asset, and input CAS before advancing', async () => {
    const runtime = authority();
    runtime.pool.client.state = 'SECURITY_SCANNED';
    runtime.pool.client.version = 3;
    runtime.pool.client.trustedHashes = false;
    await expect(
      runtime.authority.recordFingerprints({
        tenantId,
        projectId,
        ingestionId,
        expectedState: 'SECURITY_SCANNED',
        expectedVersion: 3,
        securityLevel: 'L0_PUBLIC',
        policyVersion: 9,
        fingerprints: assetIds.map((assetId, ordinal) => ({
          assetId,
          ordinal,
          size: ordinal === 0 ? 128 : 256,
          mediaType: ordinal === 0 ? 'application/pdf' : 'application/geo+json',
          sourceHash: ordinal === 0 ? 'c'.repeat(64) : 'd'.repeat(64),
        })),
        evidence,
      }),
    ).resolves.toEqual({ state: 'FINGERPRINTED', version: 4 });
    const sql = runtime.pool.client.queries.map(({ text }) => text).join('\n');
    expect(sql).toContain('ingestion.runtime.fingerprint-assets-lock');
    expect(sql).toContain('ingestion.runtime.content-blob-upsert');
    expect(sql).toContain('ingestion.runtime.asset-content-bind');
    expect(sql).toContain('ingestion.runtime.input-fingerprint');
    expect(sql).toMatch(/content_blob_id/);
  });

  it('rejects duplicate content within one ingestion without overwriting either Asset', async () => {
    const runtime = authority();
    runtime.pool.client.state = 'SECURITY_SCANNED';
    runtime.pool.client.version = 3;
    const duplicateHash = 'c'.repeat(64);
    await expect(
      runtime.authority.recordFingerprints({
        tenantId,
        projectId,
        ingestionId,
        expectedState: 'SECURITY_SCANNED',
        expectedVersion: 3,
        securityLevel: 'L0_PUBLIC',
        policyVersion: 9,
        fingerprints: assetIds.map((assetId, ordinal) => ({
          assetId,
          ordinal,
          size: 128,
          mediaType: 'application/pdf',
          sourceHash: duplicateHash,
        })),
        evidence,
      }),
    ).rejects.toMatchObject({
      category: 'INGESTION_DUPLICATE_CONTENT',
      retryable: false,
    });
    expect(runtime.pool.client.queries).toHaveLength(0);
  });

  it('freezes the review checkpoint before exposing REVIEW_REQUIRED', async () => {
    const runtime = authority();
    runtime.pool.client.state = 'SPATIOTEMPORAL_ALIGNED';
    runtime.pool.client.version = 10;
    const checkpoint = frozenCheckpoint();
    await expect(
      runtime.authority.freezeCheckpoint({
        tenantId,
        projectId,
        ingestionId,
        expectedState: 'SPATIOTEMPORAL_ALIGNED',
        expectedVersion: 10,
        toState: 'REVIEW_REQUIRED',
        securityLevel: 'L0_PUBLIC',
        policyVersion: 9,
        checkpoint,
        evidence,
      }),
    ).resolves.toMatchObject({
      state: 'REVIEW_REQUIRED',
      version: 11,
      reviewHash: checkpoint.reviewHash,
    });
    const sql = runtime.pool.client.queries.map(({ text }) => text).join('\n');
    expect(sql).toContain('ingestion.runtime.review-checkpoint');
    expect(sql).toContain('quality.check_run');
    expect(sql).toContain('quality.scorecard');
    expect(sql).toContain('lineage.process_run');
  });

  it('copies two quarantine objects before one deterministic DB version and leaves Operation settlement to the scheduler', async () => {
    const runtime = authority();
    runtime.pool.client.state = 'APPROVED';
    runtime.pool.client.version = 11;
    const checkpoint = frozenCheckpoint();
    runtime.pool.client.frozenCheckpoint = checkpoint;

    const first = await runtime.authority.commit({
      tenantId,
      projectId,
      ingestionId,
      expectedState: 'APPROVED',
      expectedVersion: 11,
      checkpoint,
      acceptanceStatus: 'PASSED',
      evidence,
      securityLevel: 'L0_PUBLIC',
      policyVersion: 9,
    });

    expect(first).toMatchObject({ state: 'COMMITTED', version: 12 });
    const statements = runtime.pool.client.queries.map(({ text }) => text);
    expect(
      statements.filter((sql) =>
        /ingestion\.runtime\.commit-version/.test(sql),
      ),
    ).toHaveLength(1);
    expect(statements.join('\n')).toMatch(/data\.version\.committed/);
    expect(statements.join('\n')).toMatch(/security\.audit_event/);
    expect(statements.join('\n')).toMatch(/event\.outbox_event/);
    expect(statements.join('\n')).toMatch(/knowledge\.evidence_fragment/);
    expect(statements.join('\n')).toMatch(/asset\.version_id is null/);
    expect(statements.join('\n')).toMatch(/input\.ingestion_id = \$3::uuid/);
    expect(statements.join('\n')).not.toMatch(
      /operation-update|operation-event/,
    );
    expect(runtime.objectStore.calls).toHaveLength(2);
    expect(
      JSON.stringify(
        runtime.pool.client.queries.find(({ text }) =>
          /commit-version/.test(text),
        )?.values,
      ),
    ).not.toContain('quarantine/');
    expect(statements.filter((sql) => /^BEGIN/.test(sql.trim()))).toEqual([
      'BEGIN READ ONLY',
      'BEGIN',
    ]);
    expect(statements.at(-1)?.trim()).toBe('COMMIT');
  });

  it('derives a different immutable version identity for a different frozen manifest hash', async () => {
    const firstRuntime = authority();
    firstRuntime.pool.client.state = 'APPROVED';
    firstRuntime.pool.client.version = 11;
    const firstCheckpoint = frozenCheckpoint();
    firstRuntime.pool.client.frozenCheckpoint = firstCheckpoint;

    const secondRuntime = authority();
    secondRuntime.pool.client.state = 'APPROVED';
    secondRuntime.pool.client.version = 11;
    const original = frozenCheckpoint();
    const secondBase = {
      assetIds: original.assetIds,
      assetManifest: {
        ...original.assetManifest,
        transformedHash: '0'.repeat(64),
      },
      quality: original.quality,
      alignment: original.alignment,
    };
    const secondCheckpoint = {
      ...secondBase,
      reviewHash: canonicalPipelineHash(secondBase),
    };
    secondRuntime.pool.client.frozenCheckpoint = secondCheckpoint;

    const commit = (
      runtime: ReturnType<typeof authority>,
      checkpoint: FrozenIngestionCheckpoint,
    ) =>
      runtime.authority.commit({
        tenantId,
        projectId,
        ingestionId,
        expectedState: 'APPROVED',
        expectedVersion: 11,
        checkpoint,
        acceptanceStatus: 'PASSED',
        evidence,
        securityLevel: 'L0_PUBLIC',
        policyVersion: 9,
      });
    const first = await commit(firstRuntime, firstCheckpoint);
    const second = await commit(secondRuntime, secondCheckpoint);
    expect(first.versionId).not.toBe(second.versionId);
    expect(firstRuntime.objectStore.calls[0]?.versionId).toBe(first.versionId);
    expect(secondRuntime.objectStore.calls[0]?.versionId).toBe(
      second.versionId,
    );
  });

  it('rejects an asset already bound elsewhere and rolls the DB transaction back', async () => {
    const runtime = authority();
    runtime.pool.client.state = 'APPROVED';
    runtime.pool.client.version = 11;
    runtime.pool.client.rejectAssetBind = true;
    const checkpoint = frozenCheckpoint();
    runtime.pool.client.frozenCheckpoint = checkpoint;
    await expect(
      runtime.authority.commit({
        tenantId,
        projectId,
        ingestionId,
        expectedState: 'APPROVED',
        expectedVersion: 11,
        checkpoint,
        acceptanceStatus: 'PASSED',
        evidence,
        securityLevel: 'L0_PUBLIC',
        policyVersion: 9,
      }),
    ).rejects.toMatchObject({
      category: 'INGESTION_ASSET_REBIND_CONFLICT',
      retryable: false,
    });
    expect(
      runtime.pool.client.queries.map(({ text }) => text.trim()),
    ).toContain('ROLLBACK');
  });

  it('retries safely after immutable S3 copies succeed but the DB commit rolls back', async () => {
    const runtime = authority();
    runtime.pool.client.state = 'APPROVED';
    runtime.pool.client.version = 11;
    runtime.pool.client.failVersionInsertOnce = true;
    const checkpoint = frozenCheckpoint();
    runtime.pool.client.frozenCheckpoint = checkpoint;
    const request = {
      tenantId,
      projectId,
      ingestionId,
      expectedState: 'APPROVED' as const,
      expectedVersion: 11,
      checkpoint,
      acceptanceStatus: 'PASSED' as const,
      evidence,
      securityLevel: 'L0_PUBLIC' as const,
      policyVersion: 9,
    };
    await expect(runtime.authority.commit(request)).rejects.toMatchObject({
      category: 'INGESTION_DATABASE_UNAVAILABLE',
      retryable: true,
    });
    await expect(runtime.authority.commit(request)).resolves.toMatchObject({
      state: 'COMMITTED',
    });
    expect(runtime.objectStore.calls).toHaveLength(4);
    expect(runtime.objectStore.calls[0]).toEqual(runtime.objectStore.calls[2]);
    expect(runtime.objectStore.calls[1]).toEqual(runtime.objectStore.calls[3]);
  });

  it('treats ordinary application/json as a document, never as GeoJSON', async () => {
    const runtime = authority();
    runtime.pool.client.forceJsonMediaType = true;
    const checkpoint = await runtime.authority.load({
      tenantId,
      projectId,
      ingestionId,
      securityLevel: 'L0_PUBLIC',
      policyVersion: 9,
    });
    expect(
      checkpoint.assets.every((asset) => asset.sourceKind === 'document'),
    ).toBe(true);
  });
});

const pgSmokeUrl = process.env['DATA_WORKER_PG_SMOKE_URL'];
const pgSmoke = pgSmokeUrl === undefined ? it.skip : it;

pgSmoke(
  'commits one frozen checkpoint against an isolated real PostgreSQL database',
  async () => {
    interface SmokePool extends IngestionRuntimePool {
      query(
        text: string,
        values?: readonly unknown[],
      ): Promise<{ readonly rows: readonly Record<string, unknown>[] }>;
      end(): Promise<void>;
    }
    type PoolConstructor = new (options: {
      readonly connectionString: string;
      readonly max: number;
    }) => SmokePool;
    const require = createRequire(import.meta.url);
    const pgModule: unknown = require('../../../packages/data-infra/node_modules/pg');
    if (
      pgModule === null ||
      typeof pgModule !== 'object' ||
      typeof Reflect.get(pgModule, 'Pool') !== 'function' ||
      pgSmokeUrl === undefined
    ) {
      throw new Error('PostgreSQL smoke dependency is unavailable.');
    }
    const Pool = Reflect.get(pgModule, 'Pool') as PoolConstructor;
    const pool = new Pool({ connectionString: pgSmokeUrl, max: 3 });
    const smokeTenant = 'a1111111-1111-4111-8111-111111111111';
    const smokeProject = 'a2222222-2222-4222-8222-222222222222';
    const smokeIngestion = 'a3333333-3333-4333-8333-333333333333';
    const smokeOperation = 'a4444444-4444-4444-8444-444444444444';
    const smokeActor = 'a5555555-5555-4555-8555-555555555555';
    const smokeAsset = 'a6666666-6666-4666-8666-666666666666';
    const smokeUpload = 'a7777777-7777-4777-8777-777777777777';
    const smokeHash = 'c'.repeat(64);
    const objectRef = `tenants/${smokeTenant}/projects/${smokeProject}/quarantine/${smokeUpload}/object`;
    const scopeSql = `select set_config('wiser.tenant_id', $1, true),
    set_config('wiser.project_id', $2, true),
    set_config('wiser.max_security_level', 'L0_PUBLIC', true),
    set_config('wiser.policy_version', '1', true)`;
    const seed = await pool.connect();
    await seed.query('BEGIN');
    try {
      await seed.query(scopeSql, [smokeTenant, smokeProject]);
      await seed.query(
        `insert into service.operation (
        operation_id, tenant_id, project_id, capability_id, actor_id, status,
        progress_percent, request_payload, security_level, policy_version,
        row_version
      ) values ($1, $2, $3, 'data.ingestion.submit', $4, 'RUNNING', 50,
        '{}'::jsonb, 'L0_PUBLIC', 1, 1)`,
        [smokeOperation, smokeTenant, smokeProject, smokeActor],
      );
      await seed.query(
        `insert into ingestion.session (
        ingestion_id, tenant_id, project_id, operation_id, owner_project_id,
        state, intended_uses, expected_version, requested_security_level,
        security_level, policy_version, row_version
      ) values ($1, $2, $3, $4, $3, 'SECURITY_SCANNED',
        array['analysis'], 1, 'L0_PUBLIC', 'L0_PUBLIC', 1, 3)`,
        [smokeIngestion, smokeTenant, smokeProject, smokeOperation],
      );
      await seed.query(
        `insert into catalog.asset (
        asset_id, tenant_id, project_id, storage_key, content_hash, media_type,
        byte_size, lifecycle_state, security_level, policy_version, row_version
      ) values ($1, $2, $3, $4, null, 'application/pdf', 128,
        'QUARANTINED', 'L0_PUBLIC', 1, 1)`,
        [smokeAsset, smokeTenant, smokeProject, objectRef],
      );
      await seed.query(
        `insert into ingestion.input_asset (
        input_asset_id, tenant_id, project_id, ingestion_id, asset_id, ordinal,
        scan_status, fingerprint, security_level, policy_version, row_version
      ) values (gen_random_uuid(), $1, $2, $3, $4, 0, 'CLEAN',
        null, 'L0_PUBLIC', 1, 1)`,
        [smokeTenant, smokeProject, smokeIngestion, smokeAsset],
      );
      await seed.query('COMMIT');
    } catch (error) {
      await seed.query('ROLLBACK');
      throw error;
    } finally {
      seed.release();
    }
    const base = {
      assetIds: [smokeAsset],
      assetManifest: {
        assets: [
          {
            assetId: smokeAsset,
            ordinal: 0,
            uploadId: smokeUpload,
            quarantineObjectRef: objectRef,
            sourceKind: 'document',
            mediaType: 'application/pdf',
            size: 128,
            sourceHash: smokeHash,
            scanHash: '1'.repeat(64),
            parserHash: smokeHash,
            profileHash: '2'.repeat(64),
            classificationHash: '3'.repeat(64),
          },
        ],
        transformedArtifactRef: 'quarantine/transform',
        transformedHash: 'e'.repeat(64),
        validatedPlan: {
          schemaPlan: { version: '1' },
          semanticPlan: { version: '1' },
          confidence: 1,
          planHash: 'f'.repeat(64),
        },
      },
      quality: {
        score: 1,
        grade: 'A' as const,
        passed: true,
        failedRuleIds: [] as string[],
        blockingRuleIds: [] as string[],
      },
      alignment: { alignmentHash: '9'.repeat(64) },
    };
    const checkpoint = { ...base, reviewHash: canonicalPipelineHash(base) };
    const smokeEvidence = {
      step: 'smoke',
      inputHash: 'a'.repeat(64),
      outputHash: 'b'.repeat(64),
    };
    const diagnosticPool: IngestionRuntimePool = {
      async connect() {
        const client = await pool.connect();
        return {
          async query(text, values) {
            try {
              return await client.query(text, values);
            } catch (error) {
              const marker =
                /\/\*\s*([^*]+)\*\//.exec(text)?.[1]?.trim() ??
                text.trim().split(/\s+/, 1)[0] ??
                'query';
              const rawCode: unknown =
                error !== null && typeof error === 'object'
                  ? Reflect.get(error, 'code')
                  : undefined;
              const code = typeof rawCode === 'string' ? rawCode : 'unknown';
              const message =
                error instanceof Error
                  ? error.message
                  : 'database query failed';
              process.stderr.write(
                `PostgreSQL smoke ${marker} failed (${code}): ${message}\n`,
              );
              throw error;
            }
          },
          release() {
            client.release();
          },
        };
      },
    };
    const smokeAuthority = new PostgresIngestionAuthority({
      pool: diagnosticPool,
      objectStore: {
        commitQuarantineObject: (input) =>
          Promise.resolve({
            raw: { bucket: 'wiser-data', key: `raw/${input.sha256}` },
            version: {
              bucket: 'wiser-data',
              key: `versions/${input.versionId}/${input.sha256}`,
            },
            reused: { raw: false, version: false },
          }),
      },
      workerActorId: smokeActor,
      maximumPolicyVersion: 1,
    });
    try {
      await expect(
        smokeAuthority.recordFingerprints({
          tenantId: smokeTenant,
          projectId: smokeProject,
          ingestionId: smokeIngestion,
          expectedState: 'SECURITY_SCANNED',
          expectedVersion: 3,
          securityLevel: 'L0_PUBLIC',
          policyVersion: 1,
          fingerprints: [
            {
              assetId: smokeAsset,
              ordinal: 0,
              size: 128,
              mediaType: 'application/pdf',
              sourceHash: smokeHash,
            },
          ],
          evidence: smokeEvidence,
        }),
      ).resolves.toEqual({ state: 'FINGERPRINTED', version: 4 });
      const transitions = [
        'PROFILED',
        'CLASSIFIED',
        'SCHEMA_MAPPED',
        'SEMANTIC_MAPPED',
        'VALIDATED',
        'SPATIOTEMPORAL_ALIGNED',
      ] as const;
      let transitionState: Parameters<
        PostgresIngestionAuthority['transition']
      >[0]['expectedState'] = 'FINGERPRINTED';
      let transitionVersion = 4;
      for (const toState of transitions) {
        await smokeAuthority.transition({
          tenantId: smokeTenant,
          projectId: smokeProject,
          ingestionId: smokeIngestion,
          expectedState: transitionState,
          expectedVersion: transitionVersion,
          toState,
          securityLevel: 'L0_PUBLIC',
          policyVersion: 1,
          evidence: smokeEvidence,
        });
        transitionState = toState;
        transitionVersion += 1;
      }
      await expect(
        smokeAuthority.freezeCheckpoint({
          tenantId: smokeTenant,
          projectId: smokeProject,
          ingestionId: smokeIngestion,
          expectedState: 'SPATIOTEMPORAL_ALIGNED',
          expectedVersion: 10,
          toState: 'APPROVED',
          securityLevel: 'L0_PUBLIC',
          policyVersion: 1,
          checkpoint,
          evidence: smokeEvidence,
        }),
      ).resolves.toMatchObject({ state: 'APPROVED', version: 11 });
      const committed = await smokeAuthority.commit({
        tenantId: smokeTenant,
        projectId: smokeProject,
        ingestionId: smokeIngestion,
        expectedState: 'APPROVED',
        expectedVersion: 11,
        checkpoint,
        acceptanceStatus: 'PASSED',
        evidence: smokeEvidence,
        securityLevel: 'L0_PUBLIC',
        policyVersion: 1,
      });
      const verify = await pool.connect();
      await verify.query('BEGIN');
      await verify.query(scopeSql, [smokeTenant, smokeProject]);
      const verified = await verify.query(
        `select session.state, operation.status,
        version.asset_manifest::text as manifest, asset.storage_key,
        encode(asset.content_hash, 'hex') as asset_hash,
        blob.lifecycle_state as blob_state, blob.raw_storage_key,
        (select count(*)::integer from knowledge.evidence_fragment
          where version_id = version.version_id) as evidence_count,
        (select count(*)::integer from event.outbox_event
          where aggregate_id = version.version_id::text) as outbox_count
      from ingestion.session as session
      join service.operation as operation
        on operation.operation_id = session.operation_id
      join catalog.data_item_version as version
        on version.data_item_id = session.ingestion_id
      join ingestion.input_asset as input
        on input.ingestion_id = session.ingestion_id
      join catalog.asset as asset on asset.asset_id = input.asset_id
      join catalog.content_blob as blob
        on blob.content_blob_id = asset.content_blob_id
      where session.ingestion_id = $1`,
        [smokeIngestion],
      );
      await verify.query('ROLLBACK');
      verify.release();
      expect(verified.rows[0]).toMatchObject({
        state: 'COMMITTED',
        status: 'RUNNING',
        evidence_count: 1,
        outbox_count: 1,
        asset_hash: smokeHash,
        blob_state: 'RAW',
      });
      expect(String(verified.rows[0]?.manifest)).not.toContain('quarantine/');
      expect(String(verified.rows[0]?.storage_key)).toContain('versions/');
      expect(String(verified.rows[0]?.raw_storage_key)).toBe(
        `raw/${smokeHash}`,
      );
      expect(committed.versionId).toMatch(/^[0-9a-f-]{36}$/);
    } finally {
      await pool.end();
    }
  },
);

describe('ClamAV and Tika ingestion clients', () => {
  it('frames ClamAV INSTREAM deterministically and interprets clean/infected responses', async () => {
    const frames: Uint8Array[] = [];
    const scanner = new ClamAvInstreamScanner({
      read: () => Promise.resolve(new Uint8Array([1, 2, 3, 4])),
      exchange: async (chunks) => {
        for await (const chunk of chunks) frames.push(chunk);
        return 'stream: OK\0';
      },
      timeoutMs: 1_000,
      maximumBytes: 1024,
      maximumResponseBytes: 256,
    });
    await expect(
      scanner.scan({ objectRef: 'quarantine/object' }),
    ).resolves.toEqual({ clean: true });
    expect(Buffer.from(frames[0]!).toString()).toBe('zINSTREAM\0');
    expect(Buffer.from(frames.at(-1)!)).toEqual(Buffer.alloc(4));
    expect(frames.some((frame) => frame.length === 8)).toBe(true);
  });

  it('streams ClamAV input and stops at the configured byte limit', async () => {
    const scanner = new ClamAvInstreamScanner({
      read: () =>
        Promise.resolve(
          (async function* () {
            await Promise.resolve();
            yield new Uint8Array([1, 2, 3]);
            yield new Uint8Array([4, 5, 6]);
          })(),
        ),
      exchange: async (chunks) => {
        for await (const _chunk of chunks) {
          // Drain to exercise the streaming limit.
        }
        return 'stream: OK\0';
      },
      timeoutMs: 1_000,
      maximumBytes: 5,
      maximumResponseBytes: 256,
    });
    await expect(
      scanner.scan({ objectRef: 'quarantine/object' }),
    ).rejects.toMatchObject({
      category: 'CLAMAV_INPUT_LIMIT',
      retryable: false,
    });
  });

  it('uses bounded internal Tika HTTP and sanitizes backend failures', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const parser = new TikaIngestionParser({
      endpoint: 'http://tika:9998',
      read: () => Promise.resolve(new TextEncoder().encode('hello water')),
      fetch: (url, init) => {
        const requestUrl =
          typeof url === 'string'
            ? url
            : url instanceof URL
              ? url.href
              : url.url;
        requests.push(
          init === undefined ? { url: requestUrl } : { url: requestUrl, init },
        );
        return Promise.resolve(
          new Response(
            JSON.stringify([
              { 'X-TIKA:content': 'hello water', title: 'Report' },
            ]),
            {
              status: 200,
              headers: { 'content-type': 'application/json' },
            },
          ),
        );
      },
      timeoutMs: 1_000,
      maximumInputBytes: 1024,
      maximumResponseBytes: 2048,
    });

    await expect(
      parser.parse({
        objectRef: 'quarantine/object',
        mediaType: 'application/pdf',
        sourceKind: 'document',
      }),
    ).resolves.toMatchObject({
      kind: 'document',
      metadata: { title: 'Report', 'wiser:excerpt': 'hello water' },
    });
    expect(requests[0]?.url).toBe('http://tika:9998/rmeta/text');
    expect(requests[0]?.init?.method).toBe('PUT');
  });

  it('preserves an allowlisted GeoJSON source CRS instead of assuming WGS84', async () => {
    const source = new TextEncoder().encode(
      JSON.stringify({
        type: 'FeatureCollection',
        crs: { type: 'name', properties: { name: 'EPSG:4490' } },
        features: [
          {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [116.2, 39.8] },
            properties: {},
          },
        ],
      }),
    );
    const parser = new TikaIngestionParser({
      endpoint: 'http://tika:9998',
      read: () => Promise.resolve(source),
      timeoutMs: 1_000,
      maximumInputBytes: 1024,
      maximumResponseBytes: 2048,
    });

    await expect(
      parser.parse({
        objectRef: 'quarantine/object',
        mediaType: 'application/geo+json',
        sourceKind: 'geojson',
      }),
    ).resolves.toMatchObject({
      kind: 'geojson',
      metadata: { sourceCrs: 'EPSG:4490' },
    });
  });

  it('cancels an oversized Tika response stream', async () => {
    let cancelled = false;
    const parser = new TikaIngestionParser({
      endpoint: 'http://tika:9998',
      read: () => Promise.resolve(new TextEncoder().encode('hello water')),
      fetch: () =>
        Promise.resolve(
          new Response(
            new ReadableStream<Uint8Array>({
              pull(controller) {
                controller.enqueue(new Uint8Array(32));
              },
              cancel() {
                cancelled = true;
              },
            }),
            { status: 200 },
          ),
        ),
      timeoutMs: 1_000,
      maximumInputBytes: 1024,
      maximumResponseBytes: 16,
    });
    await expect(
      parser.parse({
        objectRef: 'quarantine/object',
        mediaType: 'application/pdf',
        sourceKind: 'document',
      }),
    ).rejects.toMatchObject({
      category: 'TIKA_RESPONSE_LIMIT',
      retryable: false,
    });
    expect(cancelled).toBe(true);
  });
});

describe('deterministic fixture AI adapter', () => {
  it('returns a stable versioned plan and validates only its exact shape', async () => {
    const planner = new FixtureFakeAiPlanner();
    const validator = new FixtureFakeAiPlanValidator();
    const input = { profileHash: 'a'.repeat(64), fields: ['flow'] };
    const first = (await planner.propose(input)) as Record<string, unknown>;
    const replay = await planner.propose(structuredClone(input));
    expect(replay).toEqual(first);
    expect(first).toMatchObject({
      plannerId: 'wiser.fixture-ingestion-planner',
      plannerVersion: '1.0.0',
    });
    expect(validator.validate(first)).toMatchObject({ confidence: 1 });
    expect(() => validator.validate({ ...first, qualityGrade: 'A' })).toThrow();
  });
});
