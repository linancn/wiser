import { describe, expect, it, vi } from 'vitest';

import { DATA_CAPABILITY_IDS } from '@wiser/data-contracts';
import type { PlatformRequestContext } from '@wiser/platform-contracts';

import {
  DataCapabilityHandler,
  DataCapabilityHandlerError,
  type DataCapabilityAuditPort,
  type DataCapabilityExecutor,
} from '../src/data-foundation/capability-handler.js';

const context: PlatformRequestContext = {
  principal: {
    actorType: 'human',
    actorId: 'a1000000-0000-4000-8000-000000000001',
    authUserId: 'a1000000-0000-4000-8000-000000000001',
    sessionId: 'a1000000-0000-4000-8000-000000000002',
    authenticationMethod: 'supabase_jwt',
  },
  authorization: {
    tenantId: 'a1000000-0000-4000-8000-000000000003',
    projectId: 'a1000000-0000-4000-8000-000000000004',
    roles: ['data-steward'],
    scopes: [
      'data.catalog.read',
      'data.ingestion.write',
      'data.operation.read',
    ],
    purpose: 'water-governance',
    maxSecurityLevel: 'L2_RESTRICTED',
    authzVersion: 7,
  },
  traceId: 'a'.repeat(32),
};

class MemoryAudit implements DataCapabilityAuditPort {
  readonly records: unknown[] = [];

  record(value: unknown): Promise<void> {
    this.records.push(structuredClone(value));
    return Promise.resolve();
  }
}

function executor(
  id: (typeof DATA_CAPABILITY_IDS)[number],
  result: unknown = { items: [] },
): DataCapabilityExecutor {
  return {
    id,
    execute: vi.fn(() => Promise.resolve(result)),
  };
}

function allExecutors(
  override?: DataCapabilityExecutor,
): readonly DataCapabilityExecutor[] {
  return DATA_CAPABILITY_IDS.map((id) =>
    override?.id === id ? override : executor(id),
  );
}

describe('DataCapabilityHandler composition', () => {
  it('requires one and only one executor for every static capability', () => {
    const audit = new MemoryAudit();
    expect(
      () =>
        new DataCapabilityHandler({
          executors: allExecutors().slice(1),
          audit,
        }),
    ).toThrow('Missing Data Capability executor');
    expect(
      () =>
        new DataCapabilityHandler({
          executors: [...allExecutors(), executor('data.catalog.search')],
          audit,
        }),
    ).toThrow('Duplicate Data Capability executor');
  });

  it('validates input and output through the registry and passes a bounded authority context', async () => {
    const audit = new MemoryAudit();
    const search = executor('data.catalog.search', { items: [] });
    const handler = new DataCapabilityHandler({
      executors: allExecutors(search),
      audit,
      now: () => new Date('2026-08-22T04:30:00.000Z'),
    });

    await expect(
      handler.execute({
        capabilityId: 'data.catalog.search',
        input: { query: 'Yongding', first: 10 },
        requestContext: context,
      }),
    ).resolves.toEqual({ items: [] });

    expect(search.execute).toHaveBeenCalledOnce();
    const call = vi.mocked(search.execute).mock.calls[0];
    expect(call?.[0]).toEqual({ query: 'Yongding', first: 10 });
    expect(call?.[1]).toMatchObject({
      principal: context.principal,
      authorization: context.authorization,
      effectiveMaxSecurityLevel: 'L2_RESTRICTED',
      traceId: context.traceId,
      auditLevel: 'STANDARD',
      timeoutMs: 30_000,
    });
    expect(call?.[1].signal).toBeInstanceOf(AbortSignal);
    expect(audit.records).toHaveLength(1);
    expect(audit.records[0]).toMatchObject({
      capabilityId: 'data.catalog.search',
      actorId: context.principal.actorId,
      tenantId: context.authorization.tenantId,
      projectId: context.authorization.projectId,
      decision: 'SUCCEEDED',
      traceId: context.traceId,
      occurredAt: '2026-08-22T04:30:00.000Z',
    });
    expect(JSON.stringify(audit.records)).not.toContain('Yongding');
  });
});

describe('DataCapabilityHandler security boundary', () => {
  it('rejects unknown input, missing scopes, and missing command idempotency before execution', async () => {
    const audit = new MemoryAudit();
    const search = executor('data.catalog.search');
    const ingestion = executor('data.ingestion.create');
    const handler = new DataCapabilityHandler({
      executors: allExecutors(search).map((candidate) =>
        candidate.id === ingestion.id ? ingestion : candidate,
      ),
      audit,
    });

    await expect(
      handler.execute({
        capabilityId: 'data.catalog.search',
        input: { query: 'water', first: 10, sql: 'select *' },
        requestContext: context,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(
      handler.execute({
        capabilityId: 'data.catalog.search',
        input: { query: 'water', first: 10 },
        requestContext: {
          ...context,
          authorization: { ...context.authorization, scopes: [] },
        },
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      handler.execute({
        capabilityId: 'data.ingestion.create',
        input: {
          assetIds: ['a1000000-0000-4000-8000-000000000005'],
          ownerProjectId: context.authorization.projectId,
          intendedUses: ['water-governance'],
          requestedSecurityLevel: 'L2_RESTRICTED',
        },
        requestContext: context,
      }),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REQUIRED' });

    expect(search.execute).not.toHaveBeenCalled();
    expect(ingestion.execute).not.toHaveBeenCalled();
    expect(audit.records).toHaveLength(3);
    expect(JSON.stringify(audit.records)).not.toContain('select *');
  });

  it('rejects requested security above the live ceiling and invalid executor output', async () => {
    const audit = new MemoryAudit();
    const ingestion = executor('data.ingestion.create');
    const brokenSearch = executor('data.catalog.search', {
      items: [],
      secret: 'must-not-leak',
    });
    const handler = new DataCapabilityHandler({
      executors: allExecutors().map((candidate) => {
        if (candidate.id === ingestion.id) return ingestion;
        if (candidate.id === brokenSearch.id) return brokenSearch;
        return candidate;
      }),
      audit,
    });

    await expect(
      handler.execute({
        capabilityId: 'data.ingestion.create',
        input: {
          assetIds: ['a1000000-0000-4000-8000-000000000005'],
          ownerProjectId: context.authorization.projectId,
          intendedUses: ['water-governance'],
          requestedSecurityLevel: 'L3_CONFIDENTIAL',
        },
        idempotencyKey: 'a1000000-0000-4000-8000-000000000006',
        requestContext: context,
      }),
    ).rejects.toMatchObject({ code: 'SECURITY_LEVEL_EXCEEDED' });
    await expect(
      handler.execute({
        capabilityId: 'data.catalog.search',
        input: { query: 'water', first: 10 },
        requestContext: context,
      }),
    ).rejects.toMatchObject({
      code: 'IMPLEMENTATION_CONTRACT_VIOLATION',
    });

    expect(JSON.stringify(audit.records)).not.toContain('must-not-leak');
  });

  it('uses stable public errors without retaining causes or payloads', () => {
    const error = new DataCapabilityHandlerError('FORBIDDEN');
    expect(error.message).toBe(
      '当前身份无权执行该数据能力。 / The current identity cannot execute this data capability.',
    );
    expect(error).not.toHaveProperty('cause');
  });

  it('translates only allowlisted executor status classes into public errors', async () => {
    const audit = new MemoryAudit();
    const missing = executor('data.catalog.get');
    vi.mocked(missing.execute).mockRejectedValue(
      Object.assign(new Error('private database detail'), { statusCode: 404 }),
    );
    const handler = new DataCapabilityHandler({
      executors: allExecutors(missing),
      audit,
    });

    await expect(
      handler.execute({
        capabilityId: 'data.catalog.get',
        input: { dataItemId: 'a1000000-0000-4000-8000-000000000005' },
        requestContext: context,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(JSON.stringify(audit.records)).not.toContain(
      'private database detail',
    );
  });
});
