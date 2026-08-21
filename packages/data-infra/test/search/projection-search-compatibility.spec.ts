import { describe, expect, it } from 'vitest';

import {
  OpenSearchEvidenceProjection,
  WeaviateEvidenceProjection,
  type ProjectionHttpClient,
  type ProjectionHttpRequest,
} from '../../src/projections/evidence/index.js';
import {
  Neo4jKnowledgeGraphProjection,
  StacCatalogProjection,
  type GraphStacHttpClient,
  type GraphStacHttpRequest,
} from '../../src/projections/graph-stac/index.js';
import {
  Neo4jSearchBackend,
  OpenSearchSearchBackend,
  PgSTACSearchBackend,
  WeaviateSearchBackend,
} from '../../src/search/backends/index.js';
import type { SearchBackendRequest } from '../../src/search/index.js';

const TENANT_ID = 'a1000000-0000-4000-8000-000000000001';
const PROJECT_ID = 'a1000000-0000-4000-8000-000000000002';
const DATA_ITEM_ID = 'a1000000-0000-4000-8000-000000000003';
const VERSION_ID = 'a1000000-0000-4000-8000-000000000004';
const ASSET_ID = 'a1000000-0000-4000-8000-000000000005';
const CHUNK_ID = 'a1000000-0000-4000-8000-000000000006';
const EVIDENCE_ID = 'a1000000-0000-4000-8000-000000000007';
const DOCUMENT_ID = 'a1000000-0000-4000-8000-000000000008';
const ENTITY_ID = 'a1000000-0000-4000-8000-000000000009';
const SOURCE_HASH = 'a'.repeat(64);

const evidenceInput = {
  tenantId: TENANT_ID,
  projectId: PROJECT_ID,
  dataItemId: DATA_ITEM_ID,
  versionId: VERSION_ID,
  assetId: ASSET_ID,
  chunkId: CHUNK_ID,
  evidenceId: EVIDENCE_ID,
  sourceHash: SOURCE_HASH,
  securityLevel: 'L2_RESTRICTED',
  qualityGrade: 'A',
  acceptanceStatus: 'PASSED',
  publicationStatus: 'PUBLISHED',
  policyVersion: 7,
  businessDomains: ['water-monitoring'],
  channels: ['fulltext', 'semantic'],
  limitations: [],
  documentId: DOCUMENT_ID,
  pageOrSection: 'station-summary',
  language: 'en',
  chunkingStrategy: 'markdown-heading-v1',
  embeddingModel: 'fake-deterministic-embedding',
  embeddingVersion: '1.0.0',
  content: 'Yongding ecological evidence',
  vector: [0.25, 0.5, 0.75],
} as const;

const governedInput = {
  tenantId: TENANT_ID,
  projectId: PROJECT_ID,
  dataItemId: DATA_ITEM_ID,
  versionId: VERSION_ID,
  evidenceId: EVIDENCE_ID,
  sourceHash: SOURCE_HASH,
  securityLevel: 'L2_RESTRICTED',
  qualityGrade: 'A',
  acceptanceStatus: 'PASSED',
  publicationStatus: 'PUBLISHED',
  businessDomains: ['water-monitoring'],
  channels: ['graph', 'stac'],
  limitations: [],
  confidence: 0.9,
  reviewStatus: 'APPROVED',
  validFrom: '2026-01-01T00:00:00.000Z',
  validTo: '2026-12-31T23:59:59.000Z',
  systemFrom: '2026-08-22T00:00:00.000Z',
  systemTo: null,
  policyVersion: 7,
} as const;

function record(value: unknown): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Expected an object.');
  }
  return value as Readonly<Record<string, unknown>>;
}

class ProjectionClient implements ProjectionHttpClient, GraphStacHttpClient {
  readonly requests: Array<ProjectionHttpRequest | GraphStacHttpRequest> = [];

  request(request: ProjectionHttpRequest | GraphStacHttpRequest) {
    this.requests.push(structuredClone(request));
    return Promise.resolve({ status: 200, body: {} });
  }
}

function searchRequest(
  channel: 'fulltext' | 'semantic' | 'graph' | 'stac',
): SearchBackendRequest {
  return {
    query: 'Yongding',
    tenantId: TENANT_ID,
    projectId: PROJECT_ID,
    maxSecurityLevel: 'L2_RESTRICTED',
    maximumPolicyVersion: 7,
    versionIds: [VERSION_ID],
    acceptanceStatuses: ['PASSED', 'CONDITIONALLY_PASSED'],
    publicationStatuses: ['PUBLISHED'],
    businessDomains: ['water-monitoring'],
    securityLevels: ['L0_PUBLIC', 'L1_INTERNAL', 'L2_RESTRICTED'],
    channels: [channel],
    limit: 10,
  };
}

function response(value: unknown, status = 200): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify(value), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  );
}

function evidenceSearchSource(properties: Readonly<Record<string, unknown>>) {
  return {
    tenantId: properties['tenantId'],
    projectId: properties['projectId'],
    dataItemId: properties['dataItemId'],
    versionId: properties['versionId'],
    evidenceId: properties['evidenceId'],
    qualityGrade: properties['qualityGrade'],
    acceptanceStatus: properties['acceptanceStatus'],
    publicationStatus: properties['publicationStatus'],
    securityLevel: properties['securityLevel'],
    policyVersion: properties['policyVersion'],
    content: properties['content'],
    limitations: properties['limitations'],
  };
}

describe('projection/search storage compatibility', () => {
  it('reads the exact OpenSearch and Weaviate documents emitted by evidence projections', async () => {
    const openSearchProjectionHttp = new ProjectionClient();
    const openSearchProjection = new OpenSearchEvidenceProjection({
      baseUrl: 'https://opensearch:9200',
      indexName: 'wiser-evidence-v1',
      username: 'admin',
      password: 'opensearch-secret',
      http: openSearchProjectionHttp,
    });
    await openSearchProjection.put(evidenceInput);
    const indexed = record(openSearchProjectionHttp.requests[0]?.body);

    const openSearch = new OpenSearchSearchBackend({
      endpoint: 'https://opensearch:9200',
      indexName: 'wiser-evidence-v1',
      username: 'admin',
      password: 'opensearch-secret',
      fetch: () =>
        response({
          hits: { hits: [{ _source: evidenceSearchSource(indexed) }] },
        }),
    });
    await expect(openSearch.search(searchRequest('fulltext'))).resolves.toEqual(
      [
        expect.objectContaining({
          dataItemId: DATA_ITEM_ID,
          versionId: VERSION_ID,
          evidenceId: EVIDENCE_ID,
          excerptFragments: [{ field: 'content', text: evidenceInput.content }],
        }),
      ],
    );

    const weaviateProjectionHttp = new ProjectionClient();
    const weaviateProjection = new WeaviateEvidenceProjection({
      baseUrl: 'http://weaviate:8080',
      apiKey: 'weaviate-secret',
      http: weaviateProjectionHttp,
    });
    await weaviateProjection.put(evidenceInput);
    const objectRequest = weaviateProjectionHttp.requests.find(
      (request) =>
        request.body !== null &&
        typeof request.body === 'object' &&
        !Array.isArray(request.body) &&
        'properties' in request.body,
    );
    const objectBody = record(objectRequest?.body);
    const properties = record(objectBody['properties']);
    const weaviate = new WeaviateSearchBackend({
      endpoint: 'http://weaviate:8080',
      apiKey: 'weaviate-secret',
      collectionName: 'WiserEvidenceChunk',
      embed: () => Promise.resolve(evidenceInput.vector),
      fetch: () =>
        response({
          data: {
            Get: {
              WiserEvidenceChunk: [
                { ...evidenceSearchSource(properties), _additional: {} },
              ],
            },
          },
        }),
    });
    await expect(weaviate.search(searchRequest('semantic'))).resolves.toEqual([
      expect.objectContaining({
        dataItemId: DATA_ITEM_ID,
        versionId: VERSION_ID,
        evidenceId: EVIDENCE_ID,
      }),
    ]);
  });

  it('reads the governed records emitted by Neo4j and STAC projections', async () => {
    const graphHttp = new ProjectionClient();
    const graph = new Neo4jKnowledgeGraphProjection({
      baseUrl: 'http://neo4j:7474',
      database: 'neo4j',
      username: 'neo4j',
      password: 'neo4j-secret',
      http: graphHttp,
    });
    await graph.put({
      ...governedInput,
      entityId: ENTITY_ID,
      entityType: 'water_body',
      entityName: 'Yongding River',
    });
    const graphParameters = record(
      record(graphHttp.requests[0]?.body)['parameters'],
    );
    const fields = [
      'tenantId',
      'projectId',
      'dataItemId',
      'versionId',
      'evidenceId',
      'qualityGrade',
      'acceptanceStatus',
      'publicationStatus',
      'securityLevel',
      'policyVersion',
      'excerptFragments',
      'limitations',
    ];
    const graphRow = [
      graphParameters['tenantId'],
      graphParameters['projectId'],
      graphParameters['dataItemId'],
      graphParameters['versionId'],
      graphParameters['evidenceId'],
      graphParameters['qualityGrade'],
      graphParameters['acceptanceStatus'],
      graphParameters['publicationStatus'],
      graphParameters['securityLevel'],
      graphParameters['policyVersion'],
      [{ field: 'entityName', text: 'Yongding River' }],
      graphParameters['limitations'],
    ];
    const neo4j = new Neo4jSearchBackend({
      endpoint: 'http://neo4j:7474',
      database: 'neo4j',
      username: 'neo4j',
      password: 'neo4j-secret',
      fetch: () =>
        response({ queryType: 'r', data: { fields, values: [graphRow] } }, 202),
    });
    await expect(neo4j.search(searchRequest('graph'))).resolves.toHaveLength(1);

    const stacHttp = new ProjectionClient();
    const stac = new StacCatalogProjection({
      baseUrl: 'http://stac-api:8080',
      bearerToken: 'stac-projector-secret',
      assetBaseUrl: 'http://api:3001',
      http: stacHttp,
    });
    const stacIdentity = await stac.put({
      ...governedInput,
      title: 'Yongding governed asset',
      description: 'Published WISER STAC evidence.',
      geometry: { type: 'Point', coordinates: [116.1, 39.7] },
      bbox: [116.1, 39.7, 116.1, 39.7],
      assetMediaType: 'application/geo+json',
      assetSizeBytes: 1_024,
    });
    const item = record(stacHttp.requests[1]?.body);
    const pgstac = new PgSTACSearchBackend({
      endpoint: 'http://stac-api:8080',
      bearerToken: 'stac-projector-secret',
      fetch: (_input, init) => {
        if (typeof init?.body !== 'string') {
          throw new Error('Expected a serialized STAC search request.');
        }
        const requestBody = record(JSON.parse(init.body) as unknown);
        expect(requestBody['collections']).toEqual([stacIdentity.collectionId]);
        return response({
          type: 'FeatureCollection',
          features: [item],
        });
      },
    });
    await expect(pgstac.search(searchRequest('stac'))).resolves.toHaveLength(1);
  });
});
