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
const FEATURE_ID_A = 'e1000000-0000-4000-8000-000000000006';
const FEATURE_ID_B = 'e1000000-0000-4000-8000-000000000007';
const FEATURE_ID_C = 'e1000000-0000-4000-8000-000000000008';
const GEO_SNAPSHOT_AT = '2026-08-23T10:00:00.000000Z';

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
  connectCalls = 0;

  constructor(readonly client: FakePgClient) {}
  connect(): Promise<QueryAdapterPgClient> {
    this.connectCalls += 1;
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

function geoRow(featureId: string, distanceMeters: number) {
  return {
    feature_id: featureId,
    data_item_id: DATA_ITEM_ID,
    version_id: VERSION_ID,
    geometry: { type: 'Point', coordinates: [116.2, 39.8] },
    source_crs: 'EPSG:4326',
    properties: { distanceMeters },
    sort_distance: distanceMeters,
    snapshot_at: GEO_SNAPSHOT_AT,
  };
}

function changeOpaqueCursor(cursor: string): string {
  const index = Math.floor(cursor.length / 2);
  const replacement = cursor[index] === 'A' ? 'B' : 'A';
  return `${cursor.slice(0, index)}${replacement}${cursor.slice(index + 1)}`;
}

describe('Postgres structured authority query port', () => {
  it('queries only fixed evidence locator records with scoped GUCs and bounded cursor output', async () => {
    const client = new FakePgClient();
    client.results.push(
      { rows: [] },
      { rows: [{ version_id: VERSION_ID }] },
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
      ['begin', 'select', 'select', 'select', 'commit'],
    );
    const versionSql = client.calls[2]!.text;
    const sql = client.calls[3]!.text;
    expect(sql).toContain('knowledge.evidence_fragment');
    expect(sql).toContain("locator -> 'record'");
    expect(versionSql).toContain('catalog.data_item_version');
    expect(versionSql).toContain('version_number desc');
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

  it('returns an empty page for an existing committed version without record fragments', async () => {
    const client = new FakePgClient();
    client.results.push(
      { rows: [] },
      { rows: [{ version_id: VERSION_ID }] },
      { rows: [] },
      { rows: [] },
    );
    const port = new PostgresStructuredDataQueryPort({
      pool: new FakePool(client),
    });

    await expect(
      port.query(request({ dataItemId: DATA_ITEM_ID, fields: ['station'] })),
    ).resolves.toEqual({
      dataItemId: DATA_ITEM_ID,
      versionId: VERSION_ID,
      columns: ['station'],
      rows: [],
    });
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
      { rows: [{ version_id: VERSION_ID }] },
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
        queryType: 'r',
        data: {
          fields: ['graph'],
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
        queryType: 'r',
        data: {
          fields: ['graph'],
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

  it('returns an empty graph for a valid zero-row backend result', async () => {
    const http = new FakeHttp();
    http.responses.push({
      status: 200,
      body: { queryType: 'r', data: { fields: ['graph'], values: [] } },
    });
    const port = new Neo4jGraphQueryPort({
      baseUrl: 'http://neo4j:7474',
      database: 'neo4j',
      authorization: 'Basic safe-credential',
      http,
    });
    await expect(
      port.expand(request({ entityId: 'missing', maxDepth: 2 })),
    ).resolves.toEqual({ nodes: [], edges: [] });
  });

  it('includes an isolated visible seed and keeps publication gates in the traversal', async () => {
    const http = new FakeHttp();
    http.responses.push({
      status: 200,
      body: {
        queryType: 'r',
        data: { fields: ['graph'], values: [[{ nodes: [], edges: [] }]] },
      },
    });
    const port = new Neo4jGraphQueryPort({
      baseUrl: 'http://neo4j:7474',
      database: 'neo4j',
      authorization: 'Basic safe-credential',
      http,
    });
    await port.expand(request({ entityId: DATA_ITEM_ID, maxDepth: 2 }));
    const statement = (http.requests[0]!.body as { statement: string })
      .statement;
    expect(statement).toContain('[*0..2]');
    expect(statement).toContain("node.publicationStatus = 'PUBLISHED'");
    expect(statement).toContain("edge.publicationStatus = 'PUBLISHED'");
  });

  it('merges every returned path instead of discarding all but the first', async () => {
    const http = new FakeHttp();
    const node = (id: string) => ({
      entityId: id,
      label: id,
      dataItemId: DATA_ITEM_ID,
      versionId: VERSION_ID,
      evidenceId: EVIDENCE_ID,
      securityLevel: 'L2_RESTRICTED',
      qualityGrade: 'A',
      confidence: 0.9,
    });
    const edge = {
      edgeId: 'ab',
      fromEntityId: 'a',
      toEntityId: 'b',
      relationType: 'RELATED',
      evidenceId: EVIDENCE_ID,
      confidence: 0.9,
    };
    http.responses.push({
      status: 200,
      body: {
        queryType: 'r',
        data: {
          fields: ['graph'],
          values: [
            [{ nodes: [node('a')], edges: [] }],
            [{ nodes: [node('a'), node('b')], edges: [edge] }],
          ],
        },
      },
    });
    const port = new Neo4jGraphQueryPort({
      baseUrl: 'http://neo4j:7474',
      database: 'neo4j',
      authorization: 'Basic safe-credential',
      http,
    });
    await expect(
      port.expand(request({ entityId: 'a', maxDepth: 2 })),
    ).resolves.toEqual({ nodes: [node('a'), node('b')], edges: [edge] });
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
        versionId: VERSION_ID,
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
    expect(sql).toContain('dense_rank() over');
    expect(sql).not.toContain('row_number() over');
    expect(sql).toMatch(
      /ranked_version as \([\s\S]+from catalog\.data_item_version as version/,
    );
    expect(sql).toContain('$8::uuid is null or version.version_id = $8');
    expect(sql).toContain('$8::uuid is not null or version.version_rank = 1');
    expect(sql).toContain('join catalog.spatial_extent as extent');
    expect(sql).not.toContain('ranked_extent as');
    expect(sql).toContain('unnest($9::text[])');
    expect(sql).toContain(
      'security.security_rank(extent.security_level) <= security.security_rank($4)',
    );
    expect(sql).toContain(
      'security.security_rank(version.security_level) <= security.security_rank($4)',
    );
    expect(client.calls[2]!.values[3]).toBe(scope.maxSecurityLevel);
    expect(client.calls[2]!.values[7]).toBe(VERSION_ID);
    expect(client.calls[2]!.values[8]).toEqual(['INTERSECTS', 'NEAREST']);
    expect(sql).not.toContain('116.2');
  });

  it('uses latest-visible-version semantics when no immutable version is requested', async () => {
    const client = new FakePgClient();
    client.results.push({ rows: [] }, { rows: [] });
    const port = new PostgisGeoQueryPort({ pool: new FakePool(client) });

    await port.query(
      request({
        geometry: {
          type: 'Point',
          coordinates: [116.2, 39.8],
          crs: 'EPSG:4326',
        },
        predicates: ['INTERSECTS'],
        first: 10,
      }),
    );

    expect(client.calls[2]!.values[7]).toBeNull();
  });

  it('reads first plus one and continues after a stable feature-order cursor', async () => {
    const client = new FakePgClient();
    client.results.push(
      { rows: [] },
      {
        rows: [
          geoRow(FEATURE_ID_A, 0),
          geoRow(FEATURE_ID_B, 0),
          geoRow(FEATURE_ID_C, 0),
        ],
      },
      { rows: [] },
      { rows: [geoRow(FEATURE_ID_C, 0)] },
    );
    const port = new PostgisGeoQueryPort({
      pool: new FakePool(client),
      maximumFeatures: 100,
    });
    const input = {
      geometry: {
        type: 'Point',
        coordinates: [116.2, 39.8],
        crs: 'EPSG:4326',
      },
      predicates: ['INTERSECTS'],
      versionId: VERSION_ID,
      first: 2,
    };

    const firstPage = (await port.query(request(input))) as {
      features: readonly { featureId: string }[];
      nextCursor?: string;
    };

    expect(firstPage.features.map(({ featureId }) => featureId)).toEqual([
      FEATURE_ID_A,
      FEATURE_ID_B,
    ]);
    expect(firstPage.nextCursor).toEqual(expect.any(String));
    expect(firstPage.nextCursor).not.toContain(FEATURE_ID_B);
    expect(client.calls[2]!.values.at(-1)).toBe(3);

    const secondPage = (await port.query(
      request({ ...input, after: firstPage.nextCursor }),
    )) as {
      features: readonly { featureId: string }[];
      nextCursor?: string;
    };

    expect(secondPage).toMatchObject({
      features: [{ featureId: FEATURE_ID_C }],
    });
    expect(secondPage).not.toHaveProperty('nextCursor');
    expect(client.calls[6]!.text).toMatch(/spatial_extent_id\s*>/i);
    expect(JSON.stringify(client.calls[6]!.values)).toContain(FEATURE_ID_B);
    expect(client.calls[6]!.values).toContain(GEO_SNAPSHOT_AT);
    expect(client.calls[6]!.text).toContain('created_at <=');
  });

  it('rejects changed, cross-query, and cross-scope cursors before connecting', async () => {
    const client = new FakePgClient();
    client.results.push(
      { rows: [] },
      { rows: [geoRow(FEATURE_ID_A, 0), geoRow(FEATURE_ID_B, 0)] },
    );
    const pool = new FakePool(client);
    const port = new PostgisGeoQueryPort({ pool, maximumFeatures: 100 });
    const input = {
      geometry: {
        type: 'Point',
        coordinates: [116.2, 39.8],
        crs: 'EPSG:4326',
      },
      predicates: ['INTERSECTS'],
      versionId: VERSION_ID,
      first: 1,
    };
    const firstPage = (await port.query(request(input))) as {
      nextCursor?: string;
    };
    expect(firstPage.nextCursor).toEqual(expect.any(String));
    const cursor = firstPage.nextCursor!;
    expect(pool.connectCalls).toBe(1);

    await expect(
      Promise.resolve().then(() =>
        port.query(
          request({
            ...input,
            geometry: { ...input.geometry, coordinates: [117, 40] },
            after: cursor,
          }),
        ),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_CURSOR' });
    await expect(
      Promise.resolve().then(() =>
        port.query({
          scope: {
            ...scope,
            projectId: 'e1000000-0000-4000-8000-000000000009',
          },
          input: { ...input, after: cursor },
          signal: new AbortController().signal,
        }),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_CURSOR' });
    await expect(
      Promise.resolve().then(() =>
        port.query(request({ ...input, after: changeOpaqueCursor(cursor) })),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_CURSOR' });
    expect(pool.connectCalls).toBe(1);
  });

  it('continues NEAREST pages by distance and feature id without ties drifting', async () => {
    const client = new FakePgClient();
    client.results.push(
      { rows: [] },
      {
        rows: [
          geoRow(FEATURE_ID_A, 10),
          geoRow(FEATURE_ID_B, 10),
          geoRow(FEATURE_ID_C, 20),
        ],
      },
      { rows: [] },
      { rows: [geoRow(FEATURE_ID_C, 20)] },
    );
    const port = new PostgisGeoQueryPort({
      pool: new FakePool(client),
      nearestLimit: 25,
    });
    const input = {
      geometry: {
        type: 'Point',
        coordinates: [116.2, 39.8],
        crs: 'EPSG:4326',
      },
      predicates: ['NEAREST'],
      versionId: VERSION_ID,
      first: 2,
    };
    const firstPage = (await port.query(request(input))) as {
      features: readonly { featureId: string }[];
      nextCursor?: string;
    };
    expect(firstPage.features.map(({ featureId }) => featureId)).toEqual([
      FEATURE_ID_A,
      FEATURE_ID_B,
    ]);
    expect(firstPage.nextCursor).toEqual(expect.any(String));

    const secondPage = (await port.query(
      request({ ...input, after: firstPage.nextCursor }),
    )) as { features: readonly { featureId: string }[] };

    expect(secondPage.features.map(({ featureId }) => featureId)).toEqual([
      FEATURE_ID_C,
    ]);
    expect(client.calls[6]!.text).toContain('<->');
    expect(JSON.stringify(client.calls[6]!.values)).toContain(FEATURE_ID_B);
    expect(JSON.stringify(client.calls[6]!.values)).toContain('10');
  });

  it('rejects an invalid immutable version before acquiring PostgreSQL state', () => {
    const client = new FakePgClient();
    const port = new PostgisGeoQueryPort({ pool: new FakePool(client) });

    expect(() =>
      port.query(
        request({
          geometry: {
            type: 'Point',
            coordinates: [116.2, 39.8],
            crs: 'EPSG:4326',
          },
          predicates: ['INTERSECTS'],
          versionId: 'not-a-uuid',
          first: 10,
        }),
      ),
    ).toThrowError(QueryAdapterError);
    expect(client.calls).toHaveLength(0);
  });

  it('selects target and candidate versions before collecting their extents', async () => {
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
    const sql = client.calls[2]!.text;
    expect(sql).toContain("->> 'versionId'");
    expect(sql).toContain('version_number desc');
    expect(sql).toContain('left_ranked_version as');
    expect(sql).toContain('left_selected_version as');
    expect(sql).toContain('right_ranked_version as');
    expect(sql).toContain('right_selected_version as');
    expect(sql).toContain('ranked_candidate_version as');
    expect(sql).toContain('selected_candidate_version as');
    expect(sql).toContain('statement_timestamp()');
    expect(sql).toContain('version.committed_at <=');
    expect(sql).toContain('version.created_at <=');
    expect(sql).toContain('extent.created_at <=');
    expect(sql).toMatch(
      /ranked_candidate_version as \([\s\S]+from catalog\.data_item_version as version/,
    );
    expect(sql).toMatch(
      /from selected_candidate_version as version\s+join catalog\.spatial_extent as extent/,
    );
    expect(sql).not.toContain('ranked_extent as');
    expect(sql.match(/dense_rank\(\) over/g)).toHaveLength(3);
    expect(sql).not.toContain('row_number() over');
    expect(
      sql.match(/extent\.tenant_id\s*=\s*version\.tenant_id/g),
    ).toHaveLength(3);
    expect(
      sql.match(/extent\.project_id\s*=\s*version\.project_id/g),
    ).toHaveLength(3);
    expect(
      sql.match(/extent\.data_item_id\s*=\s*version\.data_item_id/g),
    ).toHaveLength(3);
    expect(
      sql.match(/extent\.version_id\s*=\s*version\.version_id/g),
    ).toHaveLength(3);
    expect(
      sql.match(
        /security\.security_rank\(version\.security_level\)\s*<=\s*security\.security_rank\(\$4\)/g,
      ),
    ).toHaveLength(3);
    expect(
      sql.match(
        /security\.security_rank\(extent\.security_level\)\s*<=\s*security\.security_rank\(\$4\)/g,
      ),
    ).toHaveLength(3);
    expect(sql.match(/ST_UnaryUnion\s*\(\s*ST_Collect\s*\(/g)).toHaveLength(2);
    expect(String(client.calls[2]!.values[4])).toContain(VERSION_ID);
  });

  it('reads first plus one and continues intersections from a snapshot-bound feature cursor', async () => {
    const client = new FakePgClient();
    client.results.push(
      { rows: [] },
      {
        rows: [
          geoRow(FEATURE_ID_A, 0),
          geoRow(FEATURE_ID_B, 0),
          geoRow(FEATURE_ID_C, 0),
        ],
      },
      { rows: [] },
      { rows: [geoRow(FEATURE_ID_C, 0)] },
    );
    const port = new PostgisGeoQueryPort({
      pool: new FakePool(client),
      maximumFeatures: 100,
    });
    const input = {
      left: { dataItemId: DATA_ITEM_ID, versionId: VERSION_ID },
      right: {
        geometry: {
          type: 'Point',
          coordinates: [116.2, 39.8],
          crs: 'EPSG:4326',
        },
      },
      first: 2,
    };

    const firstPage = (await port.intersect(request(input))) as {
      features: readonly { featureId: string }[];
      nextCursor?: string;
    };

    expect(firstPage.features.map(({ featureId }) => featureId)).toEqual([
      FEATURE_ID_A,
      FEATURE_ID_B,
    ]);
    expect(firstPage.nextCursor).toEqual(expect.any(String));
    expect(firstPage.nextCursor).not.toContain(FEATURE_ID_B);
    expect(client.calls[2]!.values.at(-1)).toBe(3);

    const secondPage = (await port.intersect(
      request({ ...input, after: firstPage.nextCursor }),
    )) as {
      features: readonly { featureId: string }[];
      nextCursor?: string;
    };

    expect(secondPage).toMatchObject({
      features: [{ featureId: FEATURE_ID_C }],
    });
    expect(secondPage).not.toHaveProperty('nextCursor');
    expect(client.calls[6]!.text).toMatch(/spatial_extent_id\s*>/i);
    expect(client.calls[6]!.text).toMatch(
      /order by\s+extent\.spatial_extent_id/i,
    );
    expect(JSON.stringify(client.calls[6]!.values)).toContain(FEATURE_ID_B);
    expect(client.calls[6]!.values).toContain(GEO_SNAPSHOT_AT);
    expect(client.calls[6]!.text).toContain('created_at <=');
  });

  it('rejects changed, cross-scope, and tampered intersection cursors before connecting', async () => {
    const client = new FakePgClient();
    client.results.push(
      { rows: [] },
      { rows: [geoRow(FEATURE_ID_A, 0), geoRow(FEATURE_ID_B, 0)] },
    );
    const pool = new FakePool(client);
    const port = new PostgisGeoQueryPort({ pool, maximumFeatures: 100 });
    const input = {
      left: { dataItemId: DATA_ITEM_ID, versionId: VERSION_ID },
      right: {
        geometry: {
          type: 'Point',
          coordinates: [116.2, 39.8],
          crs: 'EPSG:4326',
        },
      },
      first: 1,
    };
    const firstPage = (await port.intersect(request(input))) as {
      nextCursor?: string;
    };
    expect(firstPage.nextCursor).toEqual(expect.any(String));
    const cursor = firstPage.nextCursor!;
    expect(pool.connectCalls).toBe(1);

    await expect(
      Promise.resolve().then(() =>
        port.intersect(
          request({
            ...input,
            right: {
              geometry: {
                ...input.right.geometry,
                coordinates: [117, 40],
              },
            },
            after: cursor,
          }),
        ),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_CURSOR' });
    await expect(
      Promise.resolve().then(() =>
        port.intersect({
          scope: {
            ...scope,
            projectId: 'e1000000-0000-4000-8000-000000000009',
          },
          input: { ...input, after: cursor },
          signal: new AbortController().signal,
        }),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_CURSOR' });
    await expect(
      Promise.resolve().then(() =>
        port.intersect(
          request({ ...input, after: changeOpaqueCursor(cursor) }),
        ),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_CURSOR' });
    expect(pool.connectCalls).toBe(1);
  });
});
