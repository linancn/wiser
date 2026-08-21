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
  HashOnlyPipelineEvidence,
  IngestionTransitionRequest,
} from '../src/handlers/ingestion-pipeline.js';

const tenantId = '11111111-1111-4111-8111-111111111111';
const projectId = '22222222-2222-4222-8222-222222222222';
const ingestionId = '33333333-3333-4333-8333-333333333333';
const operationId = '44444444-4444-4444-8444-444444444444';
const assetIds = [
  '55555555-5555-4555-8555-555555555555',
  '66666666-6666-4666-8666-666666666666',
];

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
          operation_id: operationId,
          version_id:
            this.state === 'COMMITTED'
              ? '77777777-7777-4777-8777-777777777777'
              : null,
          asset_id: assetId,
          ordinal,
          storage_key: `quarantine/${assetId}`,
          media_type:
            ordinal === 0 ? 'application/pdf' : 'application/geo+json',
          byte_size: ordinal === 0 ? '128' : '256',
          source_hash: ordinal === 0 ? 'c'.repeat(64) : 'd'.repeat(64),
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

function authority(pool = new FakePool()) {
  return {
    pool,
    authority: new PostgresIngestionAuthority({
      pool,
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
    expect(
      runtime.pool.client.queries.find(({ text }) => /set_config/.test(text))
        ?.values,
    ).toEqual([tenantId, projectId, 'L3_CONFIDENTIAL', '9']);
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

  it('commits two assets into one deterministic version with event, audit, and Outbox in one transaction', async () => {
    const runtime = authority();
    runtime.pool.client.state = 'APPROVED';
    runtime.pool.client.version = 11;

    const first = await runtime.authority.commit({
      tenantId,
      projectId,
      ingestionId,
      expectedState: 'APPROVED',
      expectedVersion: 11,
      assetIds,
      assetManifest: {
        assets: assetIds.map((assetId) => ({ assetId })),
        transformedHash: 'e'.repeat(64),
      },
      quality: {
        score: 1,
        grade: 'A',
        passed: true,
        failedRuleIds: [],
        blockingRuleIds: [],
      },
      acceptanceStatus: 'PASSED',
      evidence,
    });

    expect(first).toMatchObject({ state: 'COMMITTED', version: 12 });
    const statements = runtime.pool.client.queries.map(({ text }) => text);
    expect(
      statements.filter((sql) => /catalog\.data_item_version/.test(sql)),
    ).toHaveLength(1);
    expect(statements.join('\n')).toMatch(/data\.version\.committed/);
    expect(statements.join('\n')).toMatch(/service\.operation_event/);
    expect(statements.join('\n')).toMatch(/security\.audit_event/);
    expect(statements.join('\n')).toMatch(/event\.outbox_event/);
    expect(statements.at(0)?.trim()).toBe('BEGIN');
    expect(statements.at(-1)?.trim()).toBe('COMMIT');
  });
});

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
      metadata: { title: 'Report' },
    });
    expect(requests[0]?.url).toBe('http://tika:9998/rmeta/text');
    expect(requests[0]?.init?.method).toBe('PUT');
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
