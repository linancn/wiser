import { describe, expect, it } from 'vitest';

import { DATA_CAPABILITY_REGISTRY } from '@wiser/data-contracts';

import {
  Neo4jGraphQueryPort,
  PostgisGeoQueryPort,
  PostgresStructuredDataQueryPort,
  QueryAdapterError,
  type QueryAdapterHttpClient,
  type QueryAdapterHttpRequest,
  type QueryAdapterPgClient,
  type QueryAdapterPgPool,
} from '../src/data-foundation/query-adapters.js';
import type { ScopedSpecialQueryRequest } from '../src/data-foundation/special-query-executors.js';

const scope = {
  tenantId: 'e1000000-0000-4000-8000-000000000001',
  projectId: 'e1000000-0000-4000-8000-000000000002',
  maxSecurityLevel: 'L2_RESTRICTED',
  maximumPolicyVersion: 9,
} as const;
const DATA_ITEM_ID = 'e1000000-0000-4000-8000-000000000003';
const VERSION_ID = 'e1000000-0000-4000-8000-000000000004';
const EVIDENCE_ID = 'e1000000-0000-4000-8000-000000000005';

class FakePgClient implements QueryAdapterPgClient {
  readonly calls: { text: string; values: readonly unknown[] }[] = [];
  readonly results: { rows: readonly Record<string, unknown>[] }[] = [];
  failure?: Error;
  released = false;

  query(text: string, values: readonly unknown[] = []) {
    this.calls.push({ text, values });
    if (/^\s*(?:begin|commit|rollback)\s*$/i.test(text)) {
      return Promise.resolve({ rows: [] });
    }
    if (this.failure && !/rollback/i.test(text))
      return Promise.reject(this.failure);
    return Promise.resolve(this.results.shift() ?? { rows: [] });
  }

  release(): void {
    this.released = true;
  }
}

class FakePool implements QueryAdapterPgPool {
  constructor(readonly client: FakePgClient) {}
  connect(): Promise<QueryAdapterPgClient> {
    return Promise.resolve(this.client);
  }
}

class FakeHttp implements QueryAdapterHttpClient {
  readonly requests: QueryAdapterHttpRequest[] = [];
  responses: { status: number; body?: unknown }[] = [];
  request(request: QueryAdapterHttpRequest) {
    this.requests.push(structuredClone(request));
    return Promise.resolve(this.responses.shift() ?? { status: 200, body: {} });
  }
}

function request(input: Record<string, unknown>): ScopedSpecialQueryRequest {
  return { scope, input, signal: new AbortController().signal };
}

describe('Postgres structured authority query port', () => {
  it('queries only fixed evidence locator records with scoped GUCs and bounded cursor output', async () => {
    const client = new FakePgClient();
    client.results.push(
      { rows: [] },
      {
        rows: [
          {
            data_item_id: DATA_ITEM_ID,
            version_id: VERSION_ID,
            evidence_fragment_id: EVIDENCE_ID,
            record: { station: 'Lugouqiao', flow: 16.7, hidden: 'x' },
          },
        ],
      },
      { rows: [] },
    );
    const port = new PostgresStructuredDataQueryPort({
      pool: new FakePool(client),
      maximumRows: 100,
      maximumResponseBytes: 64_000,
    });

    const output = (await port.query(
      request({
        dataItemId: DATA_ITEM_ID,
        versionId: VERSION_ID,
        fields: ['station', 'flow'],
        filters: [{ field: 'flow', operator: 'GTE', value: 10 }],
        first: 10,
      }),
    )) as Record<string, unknown>;

    expect(output).toMatchObject({
      dataItemId: DATA_ITEM_ID,
      versionId: VERSION_ID,
      columns: ['station', 'flow'],
      rows: [{ station: 'Lugouqiao', flow: 16.7 }],
    });
    expect(client.calls.map(({ text }) => text.trim().split(/\s+/)[0])).toEqual(
      ['begin', 'select', 'with', 'commit'],
    );
    const sql = client.calls[2]!.text;
    expect(sql).toContain('knowledge.evidence_fragment');
    expect(sql).toContain("locator -> 'record'");
    expect(sql).toContain('catalog.data_item_version');
    expect(sql).toContain('selected_version');
    expect(sql).toContain('version_number desc');
    expect(sql).not.toContain('Lugouqiao');
    expect(sql).not.toContain('flow GTE');
    expect(client.calls[1]!.values).toEqual([
      scope.tenantId,
      scope.projectId,
      scope.maxSecurityLevel,
      String(scope.maximumPolicyVersion),
    ]);
    expect(client.released).toBe(true);
    expect(
      DATA_CAPABILITY_REGISTRY['data.query'].outputSchema.safeParse(output)
        .success,
    ).toBe(true);
  });

  it('rolls back and redacts database failures and honors AbortSignal', async () => {
    const client = new FakePgClient();
    client.failure = new Error('postgresql://secret raw SQL detail');
    const port = new PostgresStructuredDataQueryPort({
      pool: new FakePool(client),
    });
    const failure = await port
      .query(request({ dataItemId: DATA_ITEM_ID, fields: ['station'] }))
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(QueryAdapterError);
    expect(String(failure)).not.toContain('secret');
    expect(client.calls.some(({ text }) => /rollback/i.test(text))).toBe(true);

    const controller = new AbortController();
    controller.abort();
    await expect(
      port.query({
        ...request({ dataItemId: DATA_ITEM_ID, fields: ['station'] }),
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ code: 'QUERY_ABORTED' });
  });

  it('binds cursors to the scoped immutable query fingerprint', async () => {
    const client = new FakePgClient();
    client.results.push(
      { rows: [] },
      {
        rows: [
          {
            data_item_id: DATA_ITEM_ID,
            version_id: VERSION_ID,
            evidence_fragment_id: EVIDENCE_ID,
            record: { station: 'A' },
          },
          {
            data_item_id: DATA_ITEM_ID,
            version_id: VERSION_ID,
            evidence_fragment_id: 'e1000000-0000-4000-8000-000000000006',
            record: { station: 'B' },
          },
        ],
      },
    );
    const port = new PostgresStructuredDataQueryPort({
      pool: new FakePool(client),
      maximumRows: 1,
    });
    const page = (await port.query(
      request({ dataItemId: DATA_ITEM_ID, fields: ['station'], first: 1 }),
    )) as { nextCursor: string };
    await expect(
      Promise.resolve().then(() =>
        port.query(
          request({
            dataItemId: DATA_ITEM_ID,
            fields: ['other'],
            first: 1,
            after: page.nextCursor,
          }),
        ),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_CURSOR' });
  });
});

describe('Neo4j graph query port', () => {
  it('uses only prebuilt bounded-depth Cypher with authorization parameters', async () => {
    const http = new FakeHttp();
    http.responses.push({
      status: 200,
      body: {
        data: {
          fields: ['graph'],
          queryType: 'r',
          values: [
            [
              {
                nodes: [
                  {
                    entityId: 'station:001',
                    label: 'Station 001',
                    dataItemId: DATA_ITEM_ID,
                    versionId: VERSION_ID,
                    evidenceId: EVIDENCE_ID,
                    securityLevel: 'L2_RESTRICTED',
                    qualityGrade: 'A',
                    confidence: 0.9,
                  },
                ],
                edges: [],
                nextCursor: 'next',
              },
            ],
          ],
        },
      },
    });
    http.responses.push({
      status: 200,
      body: {
        data: {
          fields: ['graph'],
          queryType: 'r',
          values: [[{ nodes: [], edges: [], nextCursor: 'next' }]],
        },
      },
    });
    const port = new Neo4jGraphQueryPort({
      baseUrl: 'http://neo4j:7474',
      database: 'neo4j',
      authorization: 'Basic safe-credential',
      http,
      maximumNodes: 1_000,
      maximumEdges: 2_000,
    });

    const graph = await port.expand(
      request({
        entityId: 'station:001',
        relationTypes: ['EVIDENCED_BY'],
        maxDepth: 3,
        first: 10,
      }),
    );
    await port.findPath(
      request({
        fromEntityId: 'station:001',
        toEntityId: 'basin:yongding',
        maxDepth: 4,
      }),
    );

    const expand = http.requests[0]!.body as Record<string, unknown>;
    const path = http.requests[1]!.body as Record<string, unknown>;
    expect(expand.statement).toContain('[*1..3]');
    expect(path.statement).toContain('[*1..4]');
    expect(expand.statement).not.toContain('station:001');
    expect(expand.statement).toContain('tenantId = $tenantId');
    expect(expand.statement).toContain(
      'policyVersion <= $maximumPolicyVersion',
    );
    expect(expand.statement).toContain('edge.tenantId = $tenantId');
    expect(expand.statement).toContain('type(edge) IN $relationTypes');
    expect(expand.statement).toContain('dataItemId: node.dataItemId');
    expect(expand.statement).toContain('relationType: type(edge)');
    expect(expand.parameters).toMatchObject({
      ...scope,
      entityId: 'station:001',
      relationTypes: ['EVIDENCED_BY'],
    });
    expect(
      DATA_CAPABILITY_REGISTRY['data.graph.expand'].outputSchema.safeParse(
        graph,
      ).success,
    ).toBe(true);
  });

  it('rejects unsafe depth and redacts Neo4j response bodies', async () => {
    const http = new FakeHttp();
    const port = new Neo4jGraphQueryPort({
      baseUrl: 'http://neo4j:7474',
      database: 'neo4j',
      authorization: 'Basic safe-credential',
      http,
    });
    await expect(
      port.expand(request({ entityId: 'x', maxDepth: 13 })),
    ).rejects.toMatchObject({ code: 'INVALID_QUERY' });
    expect(http.requests).toHaveLength(0);
    http.responses.push({
      status: 500,
      body: { error: 'safe-credential leaked' },
    });
    const error = await port
      .expand(request({ entityId: 'x', maxDepth: 1 }))
      .catch((caught: unknown) => caught);
    expect(String(error)).not.toContain('safe-credential');
  });
});

describe('PostGIS geo query port', () => {
  it('uses fixed CRS-to-4490 predicate SQL and returns source-CRS GeoJSON', async () => {
    const client = new FakePgClient();
    client.results.push(
      { rows: [] },
      {
        rows: [
          {
            feature_id: 'extent-1',
            data_item_id: DATA_ITEM_ID,
            version_id: VERSION_ID,
            geometry: { type: 'Point', coordinates: [116.2, 39.8] },
            source_crs: 'EPSG:4326',
            properties: { distanceMeters: 25 },
          },
        ],
      },
      { rows: [] },
    );
    const port = new PostgisGeoQueryPort({
      pool: new FakePool(client),
      maximumFeatures: 100,
      nearestLimit: 25,
    });

    const output = await port.query(
      request({
        geometry: {
          type: 'Point',
          coordinates: [116.2, 39.8],
          crs: 'EPSG:4326',
        },
        predicates: ['INTERSECTS', 'NEAREST'],
        first: 10,
      }),
    );
    expect(output).toMatchObject({
      features: [
        {
          featureId: 'extent-1',
          geometry: {
            type: 'Point',
            coordinates: [116.2, 39.8],
            crs: 'EPSG:4326',
          },
        },
      ],
    });
    const sql = client.calls[2]!.text;
    expect(sql).toContain('ST_Transform');
    expect(sql).toContain('4490');
    expect(sql).toContain('source_geometry');
    expect(sql).toContain('<->');
    expect(sql).toContain('unnest($8::text[])');
    expect(client.calls[2]!.values[7]).toEqual(['INTERSECTS', 'NEAREST']);
    expect(sql).not.toContain('116.2');
  });

  it('uses optional item version filters for intersection targets', async () => {
    const client = new FakePgClient();
    client.results.push({ rows: [] }, { rows: [] });
    const port = new PostgisGeoQueryPort({ pool: new FakePool(client) });
    await port.intersect(
      request({
        left: { dataItemId: DATA_ITEM_ID, versionId: VERSION_ID },
        right: {
          geometry: {
            type: 'Point',
            coordinates: [116.2, 39.8],
            crs: 'EPSG:4326',
          },
        },
        first: 10,
      }),
    );
    expect(client.calls[2]!.text).toContain("->> 'versionId'");
    expect(client.calls[2]!.text).toContain('version_number desc');
    expect(String(client.calls[2]!.values[4])).toContain(VERSION_ID);
  });
});
