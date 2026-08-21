import { Buffer } from 'node:buffer';

import { describe, expect, it } from 'vitest';

import {
  GraphStacProjectionError,
  Neo4jKnowledgeGraphProjection,
  StacCatalogProjection,
  deterministicGraphProjectionId,
  deterministicStacItemId,
  type GraphStacHttpClient,
  type GraphStacHttpRequest,
  type GraphStacHttpResponse,
} from '../../../src/projections/graph-stac/index.js';

const common = {
  tenantId: '91000000-0000-4000-8000-000000000001',
  projectId: '91000000-0000-4000-8000-000000000002',
  dataItemId: '91000000-0000-4000-8000-000000000003',
  versionId: '91000000-0000-4000-8000-000000000004',
  evidenceId: '91000000-0000-4000-8000-000000000005',
  sourceHash: 'a'.repeat(64),
  securityLevel: 'L2_RESTRICTED',
  qualityGrade: 'A',
  acceptanceStatus: 'PASSED',
  publicationStatus: 'PUBLISHED',
  businessDomains: ['water-monitoring'],
  channels: ['graph', 'stac'],
  limitations: [],
  confidence: 0.91,
  reviewStatus: 'APPROVED',
  validFrom: '2026-01-01T00:00:00.000Z',
  validTo: '2026-12-31T23:59:59.000Z',
  systemFrom: '2026-08-22T00:00:00.000Z',
  systemTo: null,
  policyVersion: 7,
} as const;

const graphInput = {
  ...common,
  entityId: '91000000-0000-4000-8000-000000000006',
  entityType: 'water_body',
  entityName: '永定河',
} as const;

const stacInput = {
  ...common,
  title: 'Yongding governed asset',
  description: 'Published WISER STAC evidence.',
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [115.5, 39.5],
        [116.5, 39.5],
        [116.5, 40.5],
        [115.5, 39.5],
      ],
    ],
  },
  bbox: [115.5, 39.5, 116.5, 40.5],
  assetMediaType: 'application/geo+json',
  assetSizeBytes: 12_345,
} as const;

class FakeHttpClient implements GraphStacHttpClient {
  readonly requests: GraphStacHttpRequest[] = [];
  readonly responses: GraphStacHttpResponse[] = [];

  request(request: GraphStacHttpRequest): Promise<GraphStacHttpResponse> {
    this.requests.push(structuredClone(request));
    return Promise.resolve(this.responses.shift() ?? { status: 200, body: {} });
  }
}

describe('Neo4j knowledge graph projection', () => {
  it('derives deterministic scoped identities and replays one fixed MERGE query', async () => {
    const http = new FakeHttpClient();
    const projection = new Neo4jKnowledgeGraphProjection({
      baseUrl: 'http://neo4j:7474',
      database: 'neo4j',
      username: 'wiser-projector',
      password: 'neo4j-secret',
      http,
    });

    const first = await projection.put(graphInput);
    const replay = await projection.put({ ...graphInput });

    expect(first).toEqual(replay);
    expect(first.projectionId).toBe(deterministicGraphProjectionId(graphInput));
    expect(first.projectionId).toMatch(/^[a-f0-9]{64}$/);
    expect(http.requests).toHaveLength(2);
    expect(http.requests[0]).toEqual(http.requests[1]);
    expect(http.requests[0]).toMatchObject({
      method: 'POST',
      url: 'http://neo4j:7474/db/neo4j/query/v2',
      headers: {
        Authorization: `Basic ${Buffer.from('wiser-projector:neo4j-secret').toString('base64')}`,
        'Content-Type': 'application/json',
      },
    });
    const body = http.requests[0]?.body as {
      statement: string;
      parameters: Record<string, unknown>;
    };
    expect(body.statement).toContain('MERGE (entity:WiserEntity');
    expect(body.statement).toContain('MERGE (dataItem:WiserDataItem');
    expect(body.statement).toContain('MERGE (version:WiserDataVersion');
    expect(body.statement).toContain('MERGE (evidence:WiserEvidence');
    expect(body.statement).toContain(
      'MERGE (entity)-[relation:EVIDENCED_BY {projectionId: $projectionId}]',
    );
    expect(body.statement).not.toContain(graphInput.entityName);
    expect(body.statement).not.toContain(graphInput.sourceHash);
    expect(body.parameters).toMatchObject({
      projectionId: first.projectionId,
      entityId: graphInput.entityId,
      dataItemId: graphInput.dataItemId,
      versionId: graphInput.versionId,
      evidenceId: graphInput.evidenceId,
      sourceHash: graphInput.sourceHash,
      securityLevel: graphInput.securityLevel,
      qualityGrade: graphInput.qualityGrade,
      acceptanceStatus: graphInput.acceptanceStatus,
      publicationStatus: graphInput.publicationStatus,
      businessDomains: graphInput.businessDomains,
      channels: graphInput.channels,
      confidence: graphInput.confidence,
      reviewStatus: graphInput.reviewStatus,
      validFrom: graphInput.validFrom,
      validTo: graphInput.validTo,
      systemFrom: graphInput.systemFrom,
      systemTo: graphInput.systemTo,
    });
    expect(body.parameters.dataItemVersionRelationId).toMatch(/^[a-f0-9]{64}$/);
    expect(body.parameters.versionEvidenceRelationId).toMatch(/^[a-f0-9]{64}$/);
    expect(body.parameters.dataItemVersionRelationId).not.toBe(
      first.projectionId,
    );
    expect(body.parameters.versionEvidenceRelationId).not.toBe(
      first.projectionId,
    );
  });

  it('does not expose arbitrary Cypher, unsafe endpoints, or upstream secrets', async () => {
    expect(
      () =>
        new Neo4jKnowledgeGraphProjection({
          baseUrl: 'http://neo4j:7474/db/other',
          database: '../system',
          username: 'wiser-projector',
          password: 'neo4j-secret',
          http: new FakeHttpClient(),
        }),
    ).toThrow(GraphStacProjectionError);

    const http = new FakeHttpClient();
    http.responses.push({
      status: 500,
      body: { message: 'neo4j-secret leaked upstream' },
    });
    const projection = new Neo4jKnowledgeGraphProjection({
      baseUrl: 'http://neo4j:7474',
      database: 'neo4j',
      username: 'wiser-projector',
      password: 'neo4j-secret',
      http,
    });
    let error: unknown;
    try {
      await projection.put(graphInput);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(GraphStacProjectionError);
    expect(String(error)).not.toContain('neo4j-secret');
    expect(String(error)).not.toContain('leaked upstream');
    expect(String(error)).not.toContain('http://neo4j:7474');
  });
});

describe('STAC 1.1 catalog projection', () => {
  it('PUTs an idempotent Collection and Item with governed assets', async () => {
    const http = new FakeHttpClient();
    const projection = new StacCatalogProjection({
      baseUrl: 'http://stac-api:8080',
      bearerToken: 'stac-projector-secret',
      assetBaseUrl: 'http://api:3001',
      http,
    });

    const first = await projection.put(stacInput);
    const replay = await projection.put({ ...stacInput });

    expect(first).toEqual(replay);
    expect(first.itemId).toBe(deterministicStacItemId(stacInput));
    expect(http.requests).toHaveLength(4);
    expect(http.requests[0]).toEqual(http.requests[2]);
    expect(http.requests[1]).toEqual(http.requests[3]);
    expect(http.requests[0]).toMatchObject({
      method: 'POST',
      url: 'http://stac-api:8080/collections',
      headers: {
        Authorization: 'Bearer stac-projector-secret',
        'Content-Type': 'application/json',
      },
    });
    expect(http.requests[0]?.body).toMatchObject({
      stac_version: '1.1.0',
      type: 'Collection',
      id: first.collectionId,
      license: 'proprietary',
      extent: {
        spatial: { bbox: [stacInput.bbox] },
        temporal: { interval: [[stacInput.validFrom, stacInput.validTo]] },
      },
      'wiser:tenant_id': stacInput.tenantId,
      'wiser:project_id': stacInput.projectId,
      'wiser:policy_version': stacInput.policyVersion,
    });
    expect(http.requests[1]).toMatchObject({
      method: 'POST',
      url: `http://stac-api:8080/collections/${first.collectionId}/items`,
    });
    expect(http.requests[1]?.body).toMatchObject({
      stac_version: '1.1.0',
      type: 'Feature',
      id: first.itemId,
      collection: first.collectionId,
      bbox: stacInput.bbox,
      geometry: stacInput.geometry,
      properties: {
        datetime: stacInput.validFrom,
        title: stacInput.title,
        description: stacInput.description,
        'wiser:tenant_id': stacInput.tenantId,
        'wiser:project_id': stacInput.projectId,
        'wiser:version_id': stacInput.versionId,
        'wiser:security_level': stacInput.securityLevel,
        'wiser:policy_version': stacInput.policyVersion,
        'wiser:source_hash': stacInput.sourceHash,
        acceptanceStatus: stacInput.acceptanceStatus,
        publicationStatus: stacInput.publicationStatus,
        businessDomains: stacInput.businessDomains,
        channels: stacInput.channels,
      },
      assets: {
        source: {
          href: `http://api:3001/api/data/v1/tenants/${stacInput.tenantId}/projects/${stacInput.projectId}/versions/${stacInput.versionId}/assets/source`,
          type: stacInput.assetMediaType,
          roles: ['data'],
          'file:checksum': `sha256:${stacInput.sourceHash}`,
          'file:size': stacInput.assetSizeBytes,
        },
      },
    });
  });

  it('uses fixed PUT replacement after STAC transaction conflicts', async () => {
    const http = new FakeHttpClient();
    http.responses.push(
      { status: 409 },
      { status: 200 },
      { status: 409 },
      { status: 200 },
    );
    const projection = new StacCatalogProjection({
      baseUrl: 'http://stac-api:8080',
      bearerToken: 'stac-projector-secret',
      assetBaseUrl: 'http://api:3001',
      http,
    });

    const result = await projection.put(stacInput);

    expect(http.requests.map(({ method }) => method)).toEqual([
      'POST',
      'PUT',
      'POST',
      'PUT',
    ]);
    expect(http.requests[1]?.url).toBe(
      `http://stac-api:8080/collections/${result.collectionId}`,
    );
    expect(http.requests[3]?.url).toBe(
      `http://stac-api:8080/collections/${result.collectionId}/items/${result.itemId}`,
    );
  });

  it.each([
    { ...stacInput, tenantId: '../other-tenant' },
    { ...stacInput, sourceHash: 'not-a-hash' },
    { ...stacInput, bbox: [116, 40, 115, 39] },
    { ...stacInput, policyVersion: 0 },
    { ...stacInput, qualityGrade: 'D' },
    { ...stacInput, assetUrl: 'https://attacker.example/secret' },
  ])(
    'rejects malformed, traversal, and arbitrary projection input %#',
    async (candidate) => {
      const projection = new StacCatalogProjection({
        baseUrl: 'http://stac-api:8080',
        bearerToken: 'stac-projector-secret',
        assetBaseUrl: 'http://api:3001',
        http: new FakeHttpClient(),
      });
      await expect(projection.put(candidate)).rejects.toBeInstanceOf(
        GraphStacProjectionError,
      );
    },
  );

  it('rejects non-authorized URL configuration and redacts HTTP failures', async () => {
    expect(
      () =>
        new StacCatalogProjection({
          baseUrl: 'http://stac-api:8080/arbitrary/path',
          bearerToken: 'stac-projector-secret',
          assetBaseUrl: 'https://attacker.example/assets',
          http: new FakeHttpClient(),
        }),
    ).toThrow(GraphStacProjectionError);

    const http = new FakeHttpClient();
    http.responses.push({
      status: 503,
      body: { detail: 'stac-projector-secret upstream detail' },
    });
    const projection = new StacCatalogProjection({
      baseUrl: 'http://stac-api:8080',
      bearerToken: 'stac-projector-secret',
      assetBaseUrl: 'http://api:3001',
      http,
    });
    let error: unknown;
    try {
      await projection.put(stacInput);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(GraphStacProjectionError);
    expect(String(error)).not.toContain('stac-projector-secret');
    expect(String(error)).not.toContain('upstream detail');
  });
});
