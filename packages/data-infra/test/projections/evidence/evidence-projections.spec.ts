import { describe, expect, it } from 'vitest';

import {
  EvidenceProjectionError,
  OpenSearchEvidenceProjection,
  WEAVIATE_EVIDENCE_COLLECTION,
  WeaviateEvidenceProjection,
  deterministicEvidenceProjectionId,
  type ProjectionHttpClient,
  type ProjectionHttpRequest,
  type ProjectionHttpResponse,
} from '../../../src/projections/evidence/index.js';

const input = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  projectId: '22222222-2222-4222-8222-222222222222',
  dataItemId: '33333333-3333-4333-8333-333333333333',
  versionId: '44444444-4444-4444-8444-444444444444',
  assetId: '55555555-5555-4555-8555-555555555555',
  chunkId: '66666666-6666-4666-8666-666666666666',
  evidenceId: '77777777-7777-4777-8777-777777777777',
  sourceHash: 'a'.repeat(64),
  securityLevel: 'L2_RESTRICTED',
  qualityGrade: 'A',
  acceptanceStatus: 'PASSED',
  publicationStatus: 'PUBLISHED',
  policyVersion: 7,
  businessDomains: ['water-monitoring'],
  channels: ['fulltext', 'semantic'],
  limitations: [],
  documentId: '99999999-9999-4999-8999-999999999999',
  pageOrSection: '第 12 页 / 水质证据',
  language: 'zh-CN',
  chunkingStrategy: 'markdown-heading-v1',
  embeddingModel: 'fake-deterministic-embedding',
  embeddingVersion: '1.0.0',
  content: '永定河生态补水证据片段。',
  vector: [0.25, -0.5, 0.75],
} as const;

class FakeHttpClient implements ProjectionHttpClient {
  readonly requests: ProjectionHttpRequest[] = [];
  readonly responses: ProjectionHttpResponse[] = [];

  request(request: ProjectionHttpRequest): Promise<ProjectionHttpResponse> {
    this.requests.push(structuredClone(request));
    return Promise.resolve(this.responses.shift() ?? { status: 200, body: {} });
  }
}

describe('evidence projection identity and validation', () => {
  it('derives a stable RFC UUID from scoped immutable evidence identity', () => {
    const first = deterministicEvidenceProjectionId(input);
    const replay = deterministicEvidenceProjectionId({ ...input });
    const other = deterministicEvidenceProjectionId({
      ...input,
      chunkId: '88888888-8888-4888-8888-888888888888',
    });

    expect(first).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(replay).toBe(first);
    expect(other).not.toBe(first);
  });

  it.each([
    { ...input, chunkId: '../other-tenant' },
    { ...input, sourceHash: 'not-a-sha256' },
    { ...input, vector: [0, Number.NaN] },
    { ...input, pageOrSection: '' },
    { ...input, unexpected: 'field' },
  ])('rejects malformed and unknown projection input %#', async (candidate) => {
    const projection = new WeaviateEvidenceProjection({
      baseUrl: 'http://weaviate:8080',
      apiKey: 'weaviate-secret',
      http: new FakeHttpClient(),
    });

    await expect(projection.put(candidate)).rejects.toBeInstanceOf(
      EvidenceProjectionError,
    );
  });
});

describe('Weaviate evidence projection', () => {
  it('creates one self-vectorized multi-tenant collection with every governed field', async () => {
    const http = new FakeHttpClient();
    http.responses.push({ status: 404 }, { status: 200 });
    const projection = new WeaviateEvidenceProjection({
      baseUrl: 'http://weaviate:8080',
      apiKey: 'weaviate-secret',
      http,
    });

    await projection.ensureCollection();

    expect(http.requests[0]).toMatchObject({
      method: 'GET',
      url: `http://weaviate:8080/v1/schema/${WEAVIATE_EVIDENCE_COLLECTION}`,
      headers: { Authorization: 'Bearer weaviate-secret' },
    });
    const create = http.requests[1]!;
    expect(create).toMatchObject({
      method: 'POST',
      url: 'http://weaviate:8080/v1/schema',
      headers: { Authorization: 'Bearer weaviate-secret' },
    });
    expect(create.body).toMatchObject({
      class: WEAVIATE_EVIDENCE_COLLECTION,
      vectorizer: 'none',
      multiTenancyConfig: { enabled: true, autoTenantCreation: true },
    });
    expect(
      (create.body as { properties: Array<{ name: string }> }).properties.map(
        ({ name }) => name,
      ),
    ).toEqual(
      expect.arrayContaining([
        'tenantId',
        'projectId',
        'dataItemId',
        'versionId',
        'assetId',
        'chunkId',
        'evidenceId',
        'sourceHash',
        'securityLevel',
        'qualityGrade',
        'acceptanceStatus',
        'publicationStatus',
        'policyVersion',
        'businessDomains',
        'channels',
        'limitations',
        'documentId',
        'pageOrSection',
        'language',
        'chunkingStrategy',
        'embeddingModel',
        'embeddingVersion',
        'content',
      ]),
    );
    const propertyTypes = new Map(
      (
        create.body as {
          properties: Array<{ name: string; dataType: string[] }>;
        }
      ).properties.map(({ name, dataType }) => [name, dataType]),
    );
    expect(propertyTypes.get('businessDomains')).toEqual(['text[]']);
    expect(propertyTypes.get('channels')).toEqual(['text[]']);
    expect(propertyTypes.get('limitations')).toEqual(['text[]']);
    expect(propertyTypes.get('policyVersion')).toEqual(['int']);
  });

  it('uses authenticated tenant-scoped idempotent PUT with a worker vector', async () => {
    const http = new FakeHttpClient();
    http.responses.push(
      { status: 200 },
      { status: 404 },
      { status: 200 },
      { status: 200 },
      { status: 200 },
      { status: 200 },
    );
    const projection = new WeaviateEvidenceProjection({
      baseUrl: 'http://weaviate:8080',
      apiKey: 'weaviate-secret',
      http,
    });

    const first = await projection.put(input);
    const replay = await projection.put(input);

    expect(replay).toEqual(first);
    expect(http.requests).toHaveLength(6);
    expect(http.requests[0]).toMatchObject({
      method: 'POST',
      url: `http://weaviate:8080/v1/schema/${WEAVIATE_EVIDENCE_COLLECTION}/tenants`,
      body: [{ name: input.tenantId }],
    });
    expect(http.requests[3]).toEqual(http.requests[0]);
    expect(http.requests[1]?.method).toBe('GET');
    expect(http.requests[4]).toEqual(http.requests[1]);
    expect(http.requests[2]?.method).toBe('POST');
    expect(http.requests[5]?.method).toBe('PUT');
    expect(http.requests[1]?.url).toBe(http.requests[5]?.url);
    expect(http.requests[2]?.url).toContain(
      `/v1/objects?tenant=${input.tenantId}`,
    );
    expect(http.requests[2]?.headers).toMatchObject({
      Authorization: 'Bearer weaviate-secret',
      'Content-Type': 'application/json',
    });
    expect(http.requests[2]?.body).toMatchObject({
      class: WEAVIATE_EVIDENCE_COLLECTION,
      id: first.projectionId,
      tenant: input.tenantId,
      vector: input.vector,
      properties: {
        tenantId: input.tenantId,
        projectId: input.projectId,
        securityLevel: input.securityLevel,
        sourceHash: input.sourceHash,
        policyVersion: input.policyVersion,
        publicationStatus: input.publicationStatus,
        businessDomains: input.businessDomains,
        channels: input.channels,
        content: input.content,
      },
    });
  });

  it('replaces the same deterministic object after an id conflict', async () => {
    const http = new FakeHttpClient();
    http.responses.push(
      { status: 200 },
      { status: 404 },
      { status: 422 },
      { status: 200 },
    );
    const projection = new WeaviateEvidenceProjection({
      baseUrl: 'http://weaviate:8080',
      apiKey: 'weaviate-secret',
      http,
    });

    const result = await projection.put(input);

    expect(http.requests.map(({ method }) => method)).toEqual([
      'POST',
      'GET',
      'POST',
      'PUT',
    ]);
    expect(http.requests[3]?.url).toBe(
      `http://weaviate:8080/v1/objects/${WEAVIATE_EVIDENCE_COLLECTION}/${result.projectionId}?tenant=${input.tenantId}`,
    );
  });

  it('rejects anonymous or unsafe endpoint configuration', () => {
    expect(
      () =>
        new WeaviateEvidenceProjection({
          baseUrl: 'http://weaviate:8080/path',
          apiKey: '',
          http: new FakeHttpClient(),
        }),
    ).toThrow(EvidenceProjectionError);
  });
});

describe('OpenSearch evidence projection', () => {
  it('creates a fixed permission-aware mapping with the ICU Chinese analyzer', async () => {
    const http = new FakeHttpClient();
    http.responses.push({ status: 404 }, { status: 200 });
    const projection = new OpenSearchEvidenceProjection({
      baseUrl: 'https://opensearch:9200',
      indexName: 'wiser-evidence-v1',
      username: 'wiser-indexer',
      password: 'opensearch-secret',
      http,
    });

    await projection.ensureIndex();

    expect(http.requests[0]?.url).toBe(
      'https://opensearch:9200/wiser-evidence-v1',
    );
    const create = http.requests[1];
    expect(create?.method).toBe('PUT');
    expect(create?.body).toMatchObject({
      settings: {
        analysis: {
          analyzer: {
            wiser_icu_zh: {
              type: 'custom',
              tokenizer: 'icu_tokenizer',
              filter: ['icu_folding', 'lowercase'],
            },
          },
        },
      },
      mappings: {
        dynamic: 'strict',
        properties: {
          tenantId: { type: 'keyword' },
          projectId: { type: 'keyword' },
          versionId: { type: 'keyword' },
          securityLevel: { type: 'keyword' },
          qualityGrade: { type: 'keyword' },
          acceptanceStatus: { type: 'keyword' },
          publicationStatus: { type: 'keyword' },
          policyVersion: { type: 'long' },
          businessDomains: { type: 'keyword' },
          channels: { type: 'keyword' },
          content: { type: 'text', analyzer: 'wiser_icu_zh' },
        },
      },
    });
  });

  it('replays the same structured document through one authenticated PUT identity', async () => {
    const http = new FakeHttpClient();
    const projection = new OpenSearchEvidenceProjection({
      baseUrl: 'https://opensearch:9200',
      indexName: 'wiser-evidence-v1',
      username: 'wiser-indexer',
      password: 'opensearch-secret',
      http,
    });

    const first = await projection.put(input);
    const replay = await projection.put(input);

    expect(replay).toEqual(first);
    expect(http.requests[0]?.url).toBe(http.requests[1]?.url);
    expect(http.requests[0]?.url).toBe(
      `https://opensearch:9200/wiser-evidence-v1/_doc/${first.projectionId}`,
    );
    expect(http.requests[0]?.headers?.Authorization).toBe(
      `Basic ${Buffer.from('wiser-indexer:opensearch-secret').toString('base64')}`,
    );
    expect(http.requests[0]?.body).toMatchObject({
      tenantId: input.tenantId,
      projectId: input.projectId,
      dataItemId: input.dataItemId,
      versionId: input.versionId,
      securityLevel: input.securityLevel,
      qualityGrade: input.qualityGrade,
      acceptanceStatus: input.acceptanceStatus,
      publicationStatus: input.publicationStatus,
      policyVersion: input.policyVersion,
      businessDomains: input.businessDomains,
      channels: input.channels,
      content: input.content,
    });
  });

  it('rejects arbitrary index names and redacts credentials and response bodies', async () => {
    expect(
      () =>
        new OpenSearchEvidenceProjection({
          baseUrl: 'https://opensearch:9200',
          indexName: '../other-index',
          username: 'wiser-indexer',
          password: 'opensearch-secret',
          http: new FakeHttpClient(),
        }),
    ).toThrow(EvidenceProjectionError);

    const http = new FakeHttpClient();
    http.responses.push({
      status: 500,
      body: { error: 'opensearch-secret leaked-in-upstream-body' },
    });
    const projection = new OpenSearchEvidenceProjection({
      baseUrl: 'https://opensearch:9200',
      indexName: 'wiser-evidence-v1',
      username: 'wiser-indexer',
      password: 'opensearch-secret',
      http,
    });

    const failure = await projection
      .put(input)
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(EvidenceProjectionError);
    expect(String(failure)).not.toContain('opensearch-secret');
    expect(String(failure)).not.toContain('leaked-in-upstream-body');
    expect(String(failure)).not.toContain('https://opensearch:9200');
  });
});
