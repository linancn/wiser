import type { GraphStacHttpRequest } from '@wiser/data-infra';
import { expect, it, vi } from 'vitest';
import {
  BusinessProjectionConsumer,
  Neo4jBusinessProjection,
} from '@wiser/data-infra';
const row = {
  assertionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  tenantId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  projectId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  versionId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  dataItemId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  mappingVersion: 'v1',
  securityLevel: 'L1_INTERNAL',
  policyVersion: 1,
  active: false,
  candidate: {
    subject: {
      key: 's',
      label: "Quoted ' name",
      kind: 'ENTERPRISE',
      externalId: null,
    },
    predicate: 'FLOWS_TO',
    object: {
      key: 'o',
      label: 'External target',
      kind: 'EXTERNAL_ENTITY',
      externalId: 'outside:154',
    },
    qualifiers: {
      measure: null,
      unit: null,
      observedAt: null,
      missing: true,
      spatialScope: null,
      limitations: [],
      reportedConclusion: null,
    },
    generation: { method: 'SOURCE_FIELDS', model: null },
    evidence: [
      {
        assetId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
        sourceHash: 'a'.repeat(64),
        locator: 'source field NEXT_DOWN',
        excerpt: null,
        polarity: 'SUPPORTS',
      },
    ],
    supersedesId: null,
  },
};

it('batches governed relations and removes inactive edges with stable parameterized identities', async () => {
  const request = vi.fn((_input: GraphStacHttpRequest) =>
    Promise.resolve({
      status: 200,
      body: { data: { values: [] } },
    }),
  );
  const target = new Neo4jBusinessProjection({
    baseUrl: 'http://neo4j:7474',
    database: 'neo4j',
    username: 'neo4j',
    password: 'synthetic',
    http: { request },
  });

  await target.putBatch([row]);
  await target.putBatch([row]);
  expect(request.mock.calls[0]?.[0]).toEqual(request.mock.calls[2]?.[0]);
  const body = request.mock.calls[0]?.[0].body as {
    statement: string;
    parameters: { rows: Record<string, unknown>[] };
  };
  expect(body.statement).not.toContain("Quoted ' name");
  expect(body.statement).toContain('DELETE');
  expect(body.parameters.rows[0]?.['active']).toBe(false);
  request.mockResolvedValueOnce({
    status: 200,
    body: { errors: [{ message: 'synthetic' }] },
  } as never);
  await expect(target.putBatch([row])).rejects.toThrow(
    'Business projection unavailable',
  );
});

it('keeps the durable cursor on projection failure and completes a resumed sweep', async () => {
  let checkpoint: unknown = null;
  let available = true;
  const authority = {
    assertion_id: row.assertionId,
    tenant_id: row.tenantId,
    project_id: row.projectId,
    data_item_id: row.dataItemId,
    version_id: row.versionId,
    mapping_version: row.mappingVersion,
    security_level: row.securityLevel,
    policy_version: row.policyVersion,
    candidate: row.candidate,
    active: true,
  };
  const query = vi.fn(async (sql: string, values: readonly unknown[] = []) => {
    await Promise.resolve();
    if (sql.startsWith('select last_assertion_id'))
      return { rows: [{ last_assertion_id: checkpoint }] };
    if (sql.startsWith('select b.assertion_id'))
      return { rows: checkpoint ? [] : [authority] };
    if (sql.startsWith('update service.relation_projection_checkpoint'))
      checkpoint = values[3];
    return { rows: [] };
  });
  const release = vi.fn(),
    end = vi.fn(async () => {});
  const request = vi.fn((_input: GraphStacHttpRequest) =>
    Promise.resolve({
      status: available ? 200 : 503,
      body: {},
    }),
  );
  const target = new Neo4jBusinessProjection({
    baseUrl: 'http://neo4j:7474',
    database: 'neo4j',
    username: 'neo4j',
    password: 'synthetic',
    http: { request },
  });
  const consumer = new BusinessProjectionConsumer(
    { connect: () => Promise.resolve({ query, release }), end },
    target,
  );
  const scope = {
    tenantId: row.tenantId,
    projectId: row.projectId,
    maxSecurityLevel: 'L1_INTERNAL' as const,
    policyVersion: 1,
  };
  await expect(consumer.processBatch(scope, 101)).rejects.toThrow(
    'Invalid business projection batch',
  );
  available = false;
  await expect(consumer.processBatch(scope, 1)).rejects.toThrow(
    'Business projection unavailable',
  );
  expect(checkpoint).toBeNull();
  expect(query.mock.calls.at(-1)?.[0]).toBe('rollback');
  available = true;
  expect(await consumer.processBatch(scope, 1)).toEqual({
    readEvents: 1,
    projected: 1,
    sweepComplete: false,
  });
  expect(checkpoint).toBe(row.assertionId);
  expect(await consumer.processBatch(scope, 1)).toEqual({
    readEvents: 0,
    projected: 0,
    sweepComplete: true,
  });
  expect(checkpoint).toBeNull();
  expect(
    request.mock.calls.filter(([r]) =>
      String((r.body as { statement: string }).statement).startsWith(
        'CREATE CONSTRAINT',
      ),
    ),
  ).toHaveLength(2);
  expect(release).toHaveBeenCalledTimes(3);
  await consumer.close();
  expect(end).toHaveBeenCalledOnce();
});

it('rejects credentials and path injection in a projection target', () => {
  for (const baseUrl of [
    'file:///tmp/graph',
    'http://user:secret@neo4j:7474',
    'http://neo4j:7474/other',
    'http://neo4j:7474?query=x',
  ]) {
    expect(
      () =>
        new Neo4jBusinessProjection({
          baseUrl,
          database: 'neo4j',
          username: 'neo4j',
          password: 'synthetic',
          http: { request: vi.fn() },
        }),
    ).toThrow('Invalid business projection target');
  }
});
