import { describe, expect, it } from 'vitest';

import { DATA_CAPABILITY_REGISTRY } from '@wiser/data-contracts';

import type { DataCapabilityExecutionContext } from '../src/data-foundation/capability-handler.js';
import {
  SpecialQueryExecutorError,
  createSpecialQueryExecutors,
  type DataStructuredQueryPort,
  type GeoQueryPort,
  type GraphQueryPort,
  type ScopedSpecialQueryRequest,
  type SpecialSearchOrchestrator,
} from '../src/data-foundation/special-query-executors.js';

const context: DataCapabilityExecutionContext = {
  principal: {
    actorType: 'human',
    actorId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    authUserId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    sessionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    authenticationMethod: 'supabase_jwt',
  },
  authorization: {
    tenantId: '11111111-1111-4111-8111-111111111111',
    projectId: '22222222-2222-4222-8222-222222222222',
    roles: ['data-steward'],
    scopes: ['data.query.execute'],
    purpose: 'analysis',
    maxSecurityLevel: 'L3_CONFIDENTIAL',
    authzVersion: 9,
  },
  effectiveMaxSecurityLevel: 'L2_RESTRICTED',
  traceId: 'a'.repeat(32),
  auditLevel: 'DETAILED',
  timeoutMs: 60_000,
  signal: new AbortController().signal,
};

const dataItemId = '33333333-3333-4333-8333-333333333333';
const versionId = '44444444-4444-4444-8444-444444444444';
const evidenceId = '55555555-5555-4555-8555-555555555555';

class FakeSearch implements SpecialSearchOrchestrator {
  readonly requests: unknown[] = [];
  failure?: Error;

  search(request: unknown): Promise<unknown> {
    this.requests.push(structuredClone(request));
    if (this.failure) return Promise.reject(this.failure);
    return Promise.resolve({
      items: [
        {
          dataItemId,
          versionId,
          evidenceId,
          source: 'weaviate',
          score: 0.8,
          qualityGrade: 'A',
          acceptanceStatus: 'PASSED',
          securityLevel: 'L2_RESTRICTED',
          generatedAt: '2026-08-22T00:00:00.000Z',
          limitations: [],
          excerpt: 'authorized evidence',
        },
      ],
    });
  }
}

class FakeDataPort implements DataStructuredQueryPort {
  readonly requests: ScopedSpecialQueryRequest[] = [];

  query(request: ScopedSpecialQueryRequest): Promise<unknown> {
    this.requests.push(request);
    return Promise.resolve({
      dataItemId,
      versionId,
      columns: ['station', 'flow'],
      rows: [{ station: 'Lugouqiao', flow: 16.7 }],
    });
  }
}

class FakeGraphPort implements GraphQueryPort {
  readonly expandRequests: ScopedSpecialQueryRequest[] = [];
  readonly pathRequests: ScopedSpecialQueryRequest[] = [];
  securityLevel = 'L2_RESTRICTED';

  expand(request: ScopedSpecialQueryRequest): Promise<unknown> {
    this.expandRequests.push(structuredClone(request));
    return Promise.resolve(this.result());
  }

  findPath(request: ScopedSpecialQueryRequest): Promise<unknown> {
    this.pathRequests.push(structuredClone(request));
    return Promise.resolve(this.result());
  }

  private result() {
    return {
      nodes: [
        {
          entityId: 'station:lugouqiao',
          label: 'Lugouqiao',
          dataItemId,
          versionId,
          evidenceId,
          securityLevel: this.securityLevel,
          qualityGrade: 'A',
          confidence: 0.9,
        },
      ],
      edges: [],
    };
  }
}

class FakeGeoPort implements GeoQueryPort {
  readonly queryRequests: ScopedSpecialQueryRequest[] = [];
  readonly intersectRequests: ScopedSpecialQueryRequest[] = [];

  query(request: ScopedSpecialQueryRequest): Promise<unknown> {
    this.queryRequests.push(structuredClone(request));
    return Promise.resolve(this.result());
  }

  intersect(request: ScopedSpecialQueryRequest): Promise<unknown> {
    this.intersectRequests.push(structuredClone(request));
    return Promise.resolve(this.result());
  }

  private result() {
    return {
      features: [
        {
          featureId: 'station-lugouqiao',
          dataItemId,
          versionId,
          geometry: {
            type: 'Point',
            coordinates: [116.2, 39.8],
            crs: 'EPSG:4490',
          },
          properties: { station: 'Lugouqiao' },
        },
      ],
    };
  }
}

function setup() {
  const search = new FakeSearch();
  const data = new FakeDataPort();
  const graph = new FakeGraphPort();
  const geo = new FakeGeoPort();
  const executors = createSpecialQueryExecutors({ search, data, graph, geo });
  return { search, data, graph, geo, executors };
}

function executor(
  executors: ReturnType<typeof createSpecialQueryExecutors>,
  id: (typeof executors)[number]['id'],
) {
  return executors.find((candidate) => candidate.id === id)!;
}

describe('Data Foundation special query executors', () => {
  it('registers exactly the seven specialized query capabilities', () => {
    expect(setup().executors.map(({ id }) => id)).toEqual([
      'data.query',
      'data.search.federated',
      'data.knowledge.search',
      'data.graph.expand',
      'data.graph.findPath',
      'data.geo.query',
      'data.geo.intersect',
    ]);
  });

  it('pushes immutable tenant/project/security/policy scope into structured data query', async () => {
    const { executors, data } = setup();
    const output = await executor(executors, 'data.query').execute(
      { dataItemId, fields: ['station', 'flow'], first: 10 },
      context,
    );

    expect(
      DATA_CAPABILITY_REGISTRY['data.query'].outputSchema.safeParse(output)
        .success,
    ).toBe(true);
    expect(data.requests[0]).toMatchObject({
      scope: {
        tenantId: context.authorization.tenantId,
        projectId: context.authorization.projectId,
        maxSecurityLevel: context.effectiveMaxSecurityLevel,
        maximumPolicyVersion: context.authorization.authzVersion,
      },
      input: { dataItemId, fields: ['station', 'flow'] },
    });
    expect(Object.isFrozen(data.requests[0]?.scope)).toBe(true);
  });

  it('uses SearchOrchestrator with fixed authorization filters and excerpt allowlist', async () => {
    const { executors, search } = setup();
    const output = await executor(executors, 'data.search.federated').execute(
      { query: '永定河', sources: ['semantic', 'fulltext'], first: 20 },
      context,
    );

    expect(
      DATA_CAPABILITY_REGISTRY['data.search.federated'].outputSchema.safeParse(
        output,
      ).success,
    ).toBe(true);
    expect(search.requests[0]).toMatchObject({
      tenantId: context.authorization.tenantId,
      projectId: context.authorization.projectId,
      query: '永定河',
      maxSecurityLevel: context.effectiveMaxSecurityLevel,
      policyVersion: context.authorization.authzVersion,
      sources: ['semantic', 'fulltext'],
      allowedExcerptFields: ['content', 'description', 'excerpt', 'title'],
    });
  });

  it('restricts knowledge search to semantic evidence and post-filters requested data items/confidence', async () => {
    const { executors, search } = setup();
    const output = await executor(executors, 'data.knowledge.search').execute(
      {
        query: '生态补水',
        dataItemIds: [dataItemId],
        minimumConfidence: 0.75,
        first: 10,
      },
      context,
    );

    expect(
      DATA_CAPABILITY_REGISTRY['data.knowledge.search'].outputSchema.safeParse(
        output,
      ).success,
    ).toBe(true);
    expect(search.requests[0]).toMatchObject({ sources: ['semantic'] });
    expect(output).toMatchObject({ items: [{ dataItemId, score: 0.8 }] });
  });

  it('pushes scope into graph expand/path and geo query/intersection ports', async () => {
    const { executors, graph, geo } = setup();
    const graphExpand = await executor(executors, 'data.graph.expand').execute(
      { entityId: 'station:lugouqiao', maxDepth: 2, first: 10 },
      context,
    );
    const graphPath = await executor(executors, 'data.graph.findPath').execute(
      {
        fromEntityId: 'station:lugouqiao',
        toEntityId: 'station:qujiadian',
        maxDepth: 4,
      },
      context,
    );
    const geometry = {
      type: 'Point',
      coordinates: [116.2, 39.8],
      crs: 'EPSG:4490',
    };
    const geoQuery = await executor(executors, 'data.geo.query').execute(
      { geometry, predicates: ['INTERSECTS'], first: 10 },
      context,
    );
    const geoIntersect = await executor(
      executors,
      'data.geo.intersect',
    ).execute(
      { left: { geometry }, right: { dataItemId }, first: 10 },
      context,
    );

    expect(
      DATA_CAPABILITY_REGISTRY['data.graph.expand'].outputSchema.safeParse(
        graphExpand,
      ).success,
    ).toBe(true);
    expect(
      DATA_CAPABILITY_REGISTRY['data.graph.findPath'].outputSchema.safeParse(
        graphPath,
      ).success,
    ).toBe(true);
    expect(
      DATA_CAPABILITY_REGISTRY['data.geo.query'].outputSchema.safeParse(
        geoQuery,
      ).success,
    ).toBe(true);
    expect(
      DATA_CAPABILITY_REGISTRY['data.geo.intersect'].outputSchema.safeParse(
        geoIntersect,
      ).success,
    ).toBe(true);
    for (const request of [
      graph.expandRequests[0],
      graph.pathRequests[0],
      geo.queryRequests[0],
      geo.intersectRequests[0],
    ]) {
      expect(request?.scope).toMatchObject({
        tenantId: context.authorization.tenantId,
        projectId: context.authorization.projectId,
        maxSecurityLevel: context.effectiveMaxSecurityLevel,
        maximumPolicyVersion: context.authorization.authzVersion,
      });
    }
  });

  it('rejects over-clearance graph output even when an adapter violates its port contract', async () => {
    const { executors, graph } = setup();
    graph.securityLevel = 'L3_CONFIDENTIAL';
    await expect(
      executor(executors, 'data.graph.expand').execute(
        { entityId: 'station:lugouqiao', maxDepth: 2, first: 10 },
        context,
      ),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED_BACKEND_RESULT' });
  });

  it('sanitizes backend errors and rejects malformed outputs before returning them', async () => {
    const { executors, search } = setup();
    search.failure = new Error(
      'https://weaviate:8080 token=secret raw backend payload',
    );
    const failure = await executor(executors, 'data.search.federated')
      .execute({ query: '永定河', first: 10 }, context)
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(SpecialQueryExecutorError);
    expect(String(failure)).not.toContain('weaviate');
    expect(String(failure)).not.toContain('secret');
    expect(String(failure)).not.toContain('raw backend payload');
  });
});
