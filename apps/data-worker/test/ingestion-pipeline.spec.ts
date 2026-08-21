import { describe, expect, it } from 'vitest';

import type { ClaimedDataJob } from '@wiser/data-infra';

import { DataJobHandlerError } from '../src/handlers/registry.js';
import {
  DATA_INGESTION_PROCESS_JOB_TYPE,
  IngestionPipelinePortError,
  canonicalPipelineHash,
  createIngestionPipelineHandler,
  type FrozenIngestionCheckpoint,
  type IngestionAssetCheckpoint,
  type IngestionAuthorityPort,
  type PipelineIngestionState,
  type IngestionPipelineOptions,
  type IngestionTransitionRequest,
} from '../src/handlers/ingestion-pipeline.js';

const payload = {
  ingestionId: '33333333-3333-4333-8333-333333333333',
  expectedState: 'RECEIVED',
  expectedVersion: 1,
} as const;

const job: ClaimedDataJob = {
  jobId: '55555555-5555-4555-8555-555555555555',
  tenantId: '11111111-1111-4111-8111-111111111111',
  projectId: '22222222-2222-4222-8222-222222222222',
  operationId: '66666666-6666-4666-8666-666666666666',
  jobType: DATA_INGESTION_PROCESS_JOB_TYPE,
  payload,
  attemptCount: 1,
  maxAttempts: 5,
  leaseOwner: 'worker-a',
  leaseExpiresAt: '2026-08-22T01:00:00.000Z',
  rowVersion: 2,
  cancelRequested: false,
  securityLevel: 'L0_PUBLIC',
  policyVersion: 9,
};

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

class FakeAuthority implements IngestionAuthorityPort {
  readonly order: string[];
  readonly transitions: IngestionTransitionRequest[] = [];
  commits = 0;
  frozenCheckpoint?: FrozenIngestionCheckpoint;
  state: PipelineIngestionState = 'RECEIVED';
  version = 1;
  versionId?: string;
  securityLevel: 'L0_PUBLIC' | 'L2_RESTRICTED' = 'L0_PUBLIC';
  assets: IngestionAssetCheckpoint[] = [
    {
      assetId: '44444444-4444-4444-8444-444444444444',
      ordinal: 0,
      uploadId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      objectRef: 'quarantine/object-0',
      mediaType: 'application/pdf',
      sourceKind: 'document' as const,
      size: 128,
    },
  ];

  constructor(order: string[]) {
    this.order = order;
  }

  load() {
    this.order.push('authority:load');
    return Promise.resolve({
      state: this.state,
      version: this.version,
      securityLevel: this.securityLevel,
      policyVersion: 9,
      assets: this.assets,
      ...(this.frozenCheckpoint === undefined
        ? {}
        : { frozenCheckpoint: this.frozenCheckpoint }),
      ...(this.versionId === undefined ? {} : { versionId: this.versionId }),
    });
  }

  freezeCheckpoint(
    request: Parameters<IngestionAuthorityPort['freezeCheckpoint']>[0],
  ) {
    expect(request.expectedState).toBe(this.state);
    expect(request.expectedVersion).toBe(this.version);
    this.order.push(`authority:${request.toState}`);
    this.state = request.toState;
    this.version += 1;
    this.frozenCheckpoint = structuredClone(request.checkpoint);
    return Promise.resolve({
      state: request.toState,
      version: this.version,
      reviewHash: request.checkpoint.reviewHash,
    });
  }

  transition(request: IngestionTransitionRequest) {
    expect(request.expectedState).toBe(this.state);
    expect(request.expectedVersion).toBe(this.version);
    this.transitions.push(structuredClone(request));
    this.order.push(`authority:${request.toState}`);
    this.state = request.toState;
    this.version += 1;
    return Promise.resolve({ state: request.toState, version: this.version });
  }

  recordFingerprints(
    request: Parameters<IngestionAuthorityPort['recordFingerprints']>[0],
  ) {
    expect(request.expectedState).toBe(this.state);
    expect(request.expectedVersion).toBe(this.version);
    this.order.push('authority:FINGERPRINTED');
    this.assets = this.assets.map((asset, index) => ({
      ...asset,
      sourceHash: request.fingerprints[index]!.sourceHash,
    }));
    this.state = 'FINGERPRINTED';
    this.version += 1;
    return Promise.resolve({
      state: 'FINGERPRINTED' as const,
      version: this.version,
    });
  }

  commit(request: Parameters<IngestionAuthorityPort['commit']>[0]) {
    expect(request.expectedState).toBe('APPROVED');
    expect(request.expectedVersion).toBe(this.version);
    this.order.push('authority:COMMITTED');
    this.state = 'COMMITTED';
    this.version += 1;
    this.commits += 1;
    this.versionId = '77777777-7777-4777-8777-777777777777';
    return Promise.resolve({
      state: 'COMMITTED' as const,
      version: this.version,
      versionId: this.versionId,
    });
  }
}

function setup(
  overrides: {
    readonly clean?: boolean;
    readonly risk?: 'LOW' | 'HIGH';
    readonly restricted?: boolean;
    readonly aiConfidence?: number;
    readonly blockingFailure?: boolean;
    readonly parserError?: Error;
    readonly parserFailures?: number;
    readonly validatorError?: Error;
    readonly securityLevel?: 'L0_PUBLIC' | 'L2_RESTRICTED';
    readonly assetCount?: 1 | 2;
  } = {},
) {
  const order: string[] = [];
  const authority = new FakeAuthority(order);
  authority.securityLevel = overrides.securityLevel ?? 'L0_PUBLIC';
  if (overrides.assetCount === 2) {
    authority.assets = [
      ...authority.assets,
      {
        assetId: '99999999-9999-4999-8999-999999999999',
        ordinal: 1,
        uploadId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        objectRef: 'quarantine/object-1',
        mediaType: 'application/geo+json',
        sourceKind: 'geojson',
        size: 256,
      },
    ];
  }
  let parserFailures = overrides.parserFailures ?? 0;
  const options: IngestionPipelineOptions = {
    authority,
    quarantine: {
      put: ({ asset }) => {
        order.push('quarantine');
        return Promise.resolve({
          objectRef: asset.objectRef,
          size: asset.size,
        });
      },
    },
    scanner: {
      scan: () => {
        order.push('scan');
        return Promise.resolve({ clean: overrides.clean ?? true });
      },
    },
    fingerprint: {
      sha256: ({ objectRef }) => {
        order.push('fingerprint');
        return Promise.resolve(
          objectRef.endsWith('object-1') ? 'b'.repeat(64) : 'a'.repeat(64),
        );
      },
    },
    parser: {
      parse: ({ objectRef, sourceKind }) => {
        order.push('parse');
        if (parserFailures > 0) {
          parserFailures -= 1;
          return Promise.reject(
            new IngestionPipelinePortError(
              'TIKA_TEMPORARY',
              true,
              'temporary parser failure',
            ),
          );
        }
        if (overrides.parserError) return Promise.reject(overrides.parserError);
        return Promise.resolve({
          kind: sourceKind,
          contentHash: objectRef.endsWith('object-1')
            ? 'b'.repeat(64)
            : 'a'.repeat(64),
          metadata: { title: 'Water report' },
        });
      },
    },
    profiler: {
      profile: () => {
        order.push('profile');
        return Promise.resolve({ profileHash: 'c'.repeat(64) });
      },
    },
    classifier: {
      classify: () => {
        order.push('classify');
        return Promise.resolve({
          risk: overrides.risk ?? ('LOW' as const),
          restricted: overrides.restricted ?? false,
          confidence: 0.95,
          classificationHash: 'd'.repeat(64),
        });
      },
    },
    aiPlanner: {
      propose: () => {
        order.push('ai-plan');
        return Promise.resolve({
          schema: { fields: ['flow'] },
          semantics: ['river-flow'],
        });
      },
    },
    aiValidator: {
      validate: () => {
        order.push('validate-ai');
        if (overrides.validatorError) throw overrides.validatorError;
        return {
          schemaPlan: { fields: ['flow'] },
          semanticPlan: { concepts: ['river-flow'] },
          confidence: overrides.aiConfidence ?? 0.95,
        };
      },
    },
    transformer: {
      transform: () => {
        order.push('transform');
        return Promise.resolve({
          artifactRef: 'raw/sha256/a',
          outputHash: 'e'.repeat(64),
        });
      },
    },
    quality: {
      check: () => {
        order.push('quality');
        return Promise.resolve([
          {
            ruleId: 'schema.required',
            status: overrides.blockingFailure
              ? ('FAILED' as const)
              : ('PASSED' as const),
            weight: 1,
            blocking: true,
          },
        ]);
      },
    },
    aligner: {
      align: () => {
        order.push('align');
        return Promise.resolve({ alignmentHash: 'f'.repeat(64) });
      },
    },
    minimumQualityScore: 0.75,
    minimumAiConfidence: 0.8,
  };
  return {
    order,
    authority,
    handler: (candidate: ClaimedDataJob) =>
      createIngestionPipelineHandler(options)({
        ...candidate,
        securityLevel: authority.securityLevel,
      }),
  };
}

describe('Agent-native ingestion pipeline', () => {
  it('has one static job type and strictly rejects malformed JSON payloads', async () => {
    expect(DATA_INGESTION_PROCESS_JOB_TYPE).toBe('data.ingestion.process');
    const { handler } = setup();
    for (const candidate of [
      { ...job, payload: { ...payload, ingestionId: '../escape' } },
      { ...job, payload: { ...payload, unexpected: true } },
      { ...job, jobType: 'data.ingestion.other' },
    ]) {
      await expect(handler(candidate)).rejects.toMatchObject({
        category: 'INVALID_INGESTION_JOB',
        retryable: false,
      });
    }
  });

  it('uses a deep canonical JSON hash with a fixed regression vector', () => {
    expect(
      canonicalPipelineHash({
        z: [{ beta: 2, alpha: 1 }, true],
        a: { nested: '水', number: -0 },
      }),
    ).toBe('59cb7d367be43ae34ad161a49488f5c2ee15c0825267e59521b2776f11ab3f61');
    expect(
      canonicalPipelineHash({
        a: { number: 0, nested: '水' },
        z: [{ alpha: 1, beta: 2 }, true],
      }),
    ).toBe('59cb7d367be43ae34ad161a49488f5c2ee15c0825267e59521b2776f11ab3f61');
  });

  it('runs the unique pipeline order and atomically commits ordinary passing L0 data', async () => {
    const { handler, order, authority } = setup();

    await expect(handler(job)).resolves.toMatchObject({
      status: 'SUCCEEDED',
      result: {
        ingestionId: payload.ingestionId,
        state: 'COMMITTED',
        qualityGrade: 'A',
      },
    });

    expect(order).toEqual([
      'authority:load',
      'quarantine',
      'authority:QUARANTINED',
      'scan',
      'authority:SECURITY_SCANNED',
      'fingerprint',
      'authority:FINGERPRINTED',
      'parse',
      'profile',
      'authority:PROFILED',
      'classify',
      'authority:CLASSIFIED',
      'ai-plan',
      'validate-ai',
      'authority:SCHEMA_MAPPED',
      'authority:SEMANTIC_MAPPED',
      'transform',
      'quality',
      'authority:VALIDATED',
      'align',
      'authority:SPATIOTEMPORAL_ALIGNED',
      'authority:APPROVED',
      'authority:COMMITTED',
    ]);
    expect(authority.commits).toBe(1);
    for (const transition of authority.transitions) {
      expect(transition.evidence.inputHash).toMatch(/^[a-f0-9]{64}$/);
      expect(transition.evidence.outputHash).toMatch(/^[a-f0-9]{64}$/);
      expect(JSON.stringify(transition.evidence)).not.toContain('Water report');
      expect(JSON.stringify(transition.evidence)).not.toContain('river-flow');
    }
  });

  it.each([
    { securityLevel: 'L2_RESTRICTED' as const },
    { risk: 'HIGH' as const },
    { restricted: true },
    { aiConfidence: 0.4 },
  ])(
    'stops high-risk, restricted, or low-confidence data at REVIEW_REQUIRED',
    async (options) => {
      const { handler, authority } = setup(options);

      await expect(handler(job)).resolves.toMatchObject({
        status: 'WAITING_REVIEW',
        result: { state: 'REVIEW_REQUIRED' },
      });
      expect(authority.state).toBe('REVIEW_REQUIRED');
      expect(authority.commits).toBe(0);
    },
  );

  it('persists infected scans as REJECTED and raises a non-retryable safe failure', async () => {
    const { handler, authority } = setup({ clean: false });
    await expect(handler(job)).rejects.toMatchObject({
      category: 'MALWARE_DETECTED',
      retryable: false,
    });
    expect(authority.state).toBe('REJECTED');
  });

  it('uses the deterministic quality gate and rejects blocking failures', async () => {
    const { handler, authority } = setup({ blockingFailure: true });
    await expect(handler(job)).rejects.toMatchObject({
      category: 'QUALITY_GATE_REJECTED',
      retryable: false,
    });
    expect(authority.state).toBe('REJECTED');
    expect(authority.commits).toBe(0);
  });

  it('resumes after a temporary parser failure from FINGERPRINTED and commits once', async () => {
    const { handler, authority, order } = setup({ parserFailures: 1 });
    await expect(handler(job)).rejects.toMatchObject({
      category: 'TIKA_TEMPORARY',
      retryable: true,
    });
    expect(authority.state).toBe('FINGERPRINTED');
    expect(authority.version).toBe(4);

    await expect(handler(job)).resolves.toMatchObject({
      status: 'SUCCEEDED',
      result: { state: 'COMMITTED' },
    });
    expect(authority.commits).toBe(1);
    expect(
      order.filter((entry) => entry === 'authority:FINGERPRINTED'),
    ).toHaveLength(1);
  });

  it('processes two ordered authority assets into one committed version', async () => {
    const { handler, authority, order } = setup({ assetCount: 2 });
    await expect(handler(job)).resolves.toMatchObject({
      status: 'SUCCEEDED',
      result: { state: 'COMMITTED' },
    });
    expect(authority.commits).toBe(1);
    expect(order.filter((entry) => entry === 'quarantine')).toHaveLength(2);
    expect(order.filter((entry) => entry === 'parse')).toHaveLength(2);
  });

  it('rejects non-contiguous authority ordinals before any external stage runs', async () => {
    const value = setup({ assetCount: 2 });
    value.authority.assets[1] = {
      ...value.authority.assets[1]!,
      ordinal: 2,
    };
    await expect(value.handler(job)).rejects.toMatchObject({
      category: 'INGESTION_AUTHORITY_CONFLICT',
      retryable: false,
    });
    expect(value.order).toEqual(['authority:load']);
  });

  it('commits an approved high-risk checkpoint without replaying any stage port', async () => {
    const reviewed = setup({ securityLevel: 'L2_RESTRICTED' });
    await expect(reviewed.handler(job)).resolves.toMatchObject({
      status: 'WAITING_REVIEW',
    });
    const frozen = reviewed.authority.frozenCheckpoint;
    expect(frozen).toBeDefined();
    if (frozen === undefined) throw new Error('missing frozen checkpoint');
    const manifestAssets = frozen.assetManifest.assets;
    const validatedPlan = frozen.assetManifest.validatedPlan;
    if (!Array.isArray(manifestAssets) || !isRecord(validatedPlan)) {
      throw new Error('invalid frozen checkpoint fixture');
    }
    const firstManifestAsset: unknown = manifestAssets[0];
    if (!isRecord(firstManifestAsset)) {
      throw new Error('invalid frozen asset fixture');
    }
    expect(firstManifestAsset.scanHash).toMatch(/^[a-f0-9]{64}$/);
    expect(validatedPlan.planHash).toMatch(/^[a-f0-9]{64}$/);
    expect(frozen.assetManifest).toMatchObject({
      assets: [
        {
          assetId: reviewed.authority.assets[0]!.assetId,
          sourceHash: 'a'.repeat(64),
          parserHash: 'a'.repeat(64),
          profileHash: 'c'.repeat(64),
          classificationHash: 'd'.repeat(64),
        },
      ],
      transformedHash: 'e'.repeat(64),
    });

    const approved = setup({ securityLevel: 'L2_RESTRICTED' });
    approved.authority.state = 'APPROVED';
    approved.authority.version = 11;
    approved.authority.frozenCheckpoint = frozen;
    const approvedJob = {
      ...job,
      securityLevel: 'L2_RESTRICTED' as const,
      payload: {
        ingestionId: payload.ingestionId,
        expectedState: 'APPROVED' as const,
        expectedVersion: 11,
      },
    };
    await expect(approved.handler(approvedJob)).resolves.toMatchObject({
      status: 'SUCCEEDED',
      result: { state: 'COMMITTED' },
    });
    expect(approved.order).toEqual(['authority:load', 'authority:COMMITTED']);
    expect(approved.authority.commits).toBe(1);
  });

  it('rejects an APPROVED job fence that does not match the checkpoint chain', async () => {
    const value = setup();
    value.authority.state = 'FINGERPRINTED';
    value.authority.version = 4;
    await expect(
      value.handler({
        ...job,
        payload: {
          ingestionId: payload.ingestionId,
          expectedState: 'APPROVED',
          expectedVersion: 3,
        },
      }),
    ).rejects.toMatchObject({
      category: 'INGESTION_AUTHORITY_CONFLICT',
      retryable: false,
    });
    expect(value.order).toEqual(['authority:load']);
  });

  it('rejects a computed fingerprint that differs from the authoritative source hash', async () => {
    const value = setup();
    value.authority.assets[0] = {
      ...value.authority.assets[0]!,
      sourceHash: 'b'.repeat(64),
    };
    await expect(value.handler(job)).rejects.toMatchObject({
      category: 'OBJECT_INTEGRITY_MISMATCH',
      retryable: false,
    });
    expect(value.authority.state).toBe('SECURITY_SCANNED');
  });

  it('returns persisted review/commit checkpoints without replaying stages', async () => {
    const review = setup();
    review.authority.state = 'REVIEW_REQUIRED';
    review.authority.version = 10;
    await expect(review.handler(job)).resolves.toMatchObject({
      status: 'WAITING_REVIEW',
      result: { state: 'REVIEW_REQUIRED' },
    });
    expect(review.order).toEqual(['authority:load']);

    const committed = setup();
    committed.authority.state = 'COMMITTED';
    committed.authority.version = 12;
    committed.authority.versionId = '77777777-7777-4777-8777-777777777777';
    await expect(committed.handler(job)).resolves.toMatchObject({
      status: 'SUCCEEDED',
      result: { state: 'COMMITTED', versionId: committed.authority.versionId },
    });
    expect(committed.order).toEqual(['authority:load']);
  });

  it('rejects invalid AI plans before transform and never lets AI assign grade or acceptance', async () => {
    const { handler, order } = setup({
      validatorError: new Error('raw model output contained a secret'),
    });
    const failure = await handler(job).catch((error: unknown) => error);
    expect(failure).toMatchObject({
      category: 'AI_PLAN_INVALID',
      retryable: false,
    });
    expect(String(failure)).not.toContain('secret');
    expect(order).not.toContain('transform');
  });

  it('classifies temporary dependency failures safely without leaking backend details', async () => {
    const { handler } = setup({
      parserError: new IngestionPipelinePortError(
        'TIKA_TEMPORARY',
        true,
        'http://tika:9998 password=secret',
      ),
    });
    const failure = await handler(job).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(DataJobHandlerError);
    expect(failure).toMatchObject({
      category: 'TIKA_TEMPORARY',
      retryable: true,
    });
    expect(String(failure)).not.toContain('tika:9998');
    expect(String(failure)).not.toContain('secret');
  });
});
