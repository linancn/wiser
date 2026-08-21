import { describe, expect, it, vi } from 'vitest';

import type {
  SearchBackendHit,
  SearchBackendRequest,
} from '../../../src/search/index.js';
import {
  Neo4jSearchBackend,
  OpenSearchSearchBackend,
  PgSTACSearchBackend,
  PostGISSearchBackend,
  SearchBackendAdapterError,
  WeaviateSearchBackend,
  type PostGISSearchClient,
  type PostGISSearchPool,
} from '../../../src/search/backends/index.js';

const TENANT_ID = 'b2000000-0000-4000-8000-000000000001';
const PROJECT_ID = 'b2000000-0000-4000-8000-000000000002';
const DATA_ITEM_ID = 'b2000000-0000-4000-8000-000000000003';
const VERSION_ID = 'b2000000-0000-4000-8000-000000000004';
const EVIDENCE_ID = 'b2000000-0000-4000-8000-000000000005';

function request(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    query: 'Yongding ecological evidence',
    tenantId: TENANT_ID,
    projectId: PROJECT_ID,
    maxSecurityLevel: 'L2_RESTRICTED',
    maximumPolicyVersion: 7,
    versionIds: [VERSION_ID],
    acceptanceStatuses: ['PASSED', 'CONDITIONALLY_PASSED'],
    publicationStatuses: ['PUBLISHED'],
    businessDomains: ['water-monitoring'],
    securityLevels: ['L0_PUBLIC', 'L1_INTERNAL', 'L2_RESTRICTED'],
    channels: ['fulltext'],
    limit: 25,
    ...overrides,
  } as SearchBackendRequest;
}

function projection(): SearchBackendHit {
  return {
    tenantId: TENANT_ID,
    projectId: PROJECT_ID,
    dataItemId: DATA_ITEM_ID,
    versionId: VERSION_ID,
    evidenceId: EVIDENCE_ID,
    qualityGrade: 'A',
    acceptanceStatus: 'PASSED',
    publicationStatus: 'PUBLISHED',
    securityLevel: 'L1_INTERNAL',
    policyVersion: 6,
    excerptFragments: [{ field: 'title', text: 'Yongding evidence' }],
    limitations: [],
  };
}

function indexedProjection() {
  const { excerptFragments: _ignored, ...governance } = projection();
  return { ...governance, content: 'Yongding indexed evidence' };
}

function indexedSearchHit(): SearchBackendHit {
  return {
    ...projection(),
    excerptFragments: [{ field: 'content', text: 'Yongding indexed evidence' }],
  };
}

function jsonResponse(value: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(value), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  );
}

function mockFetch(factory: () => Promise<Response>) {
  return vi.fn((...args: Parameters<typeof globalThis.fetch>) => {
    void args;
    return factory();
  });
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('expected a JSON object');
  }
  return value as Readonly<Record<string, unknown>>;
}

function firstFetchCall(fetcher: ReturnType<typeof mockFetch>) {
  const call = fetcher.mock.calls[0];
  if (call === undefined) throw new Error('expected one fetch call');
  const [input, init] = call;
  const url =
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : input.url;
  if (typeof init?.body !== 'string') {
    throw new Error('expected a JSON request body');
  }
  return {
    url,
    init,
    body: record(JSON.parse(init.body) as unknown),
  };
}

function expectAdapterCode(error: unknown, code: string) {
  expect(error).toBeInstanceOf(SearchBackendAdapterError);
  expect((error as SearchBackendAdapterError).code).toBe(code);
}

describe('OpenSearchSearchBackend', () => {
  it('uses one fixed index and constructs the entire DSL from structured filters', async () => {
    const fetch = mockFetch(() =>
      jsonResponse({
        hits: { hits: [{ _score: 4.2, _source: indexedProjection() }] },
      }),
    );
    const backend = new OpenSearchSearchBackend({
      endpoint: 'https://opensearch.internal:9200',
      indexName: 'wiser-evidence-v1',
      username: 'wiser-search',
      password: 'private-password',
      fetch,
    });

    await expect(backend.search(request())).resolves.toEqual([
      indexedSearchHit(),
    ]);
    const { url, init, body } = firstFetchCall(fetch);
    expect(url).toBe(
      'https://opensearch.internal:9200/wiser-evidence-v1/_search',
    );
    expect(init?.method).toBe('POST');
    expect(new Headers(init?.headers).get('authorization')).toMatch(/^Basic /);
    expect(body).toMatchObject({
      size: 25,
      query: {
        bool: {
          must: [
            {
              multi_match: { query: 'Yongding ecological evidence' },
            },
          ],
        },
      },
    });
    const filters = record(record(body['query'])['bool'])['filter'];
    expect(filters).toEqual(
      expect.arrayContaining([
        { term: { tenantId: TENANT_ID } },
        { term: { projectId: PROJECT_ID } },
        { terms: { versionId: [VERSION_ID] } },
        { range: { policyVersion: { lte: 7 } } },
      ]),
    );
    expect(body).not.toHaveProperty('script');
  });
});

describe('WeaviateSearchBackend', () => {
  it('uses a fixed hybrid GraphQL document, derived tenant, injected vector, and structured where filter', async () => {
    const embed = vi.fn(() => Promise.resolve([0.25, 0.5, 0.75]));
    const fetch = mockFetch(() =>
      jsonResponse({
        data: {
          Get: {
            WiserEvidenceChunk: [
              { ...indexedProjection(), _additional: { score: '0.92' } },
            ],
          },
        },
      }),
    );
    const backend = new WeaviateSearchBackend({
      endpoint: 'http://weaviate.internal:8080',
      apiKey: 'private-weaviate-key',
      collectionName: 'WiserEvidenceChunk',
      embed,
      fetch,
    });

    await expect(
      backend.search(request({ channels: ['semantic'] })),
    ).resolves.toEqual([indexedSearchHit()]);
    expect(embed).toHaveBeenCalledWith('Yongding ecological evidence');
    const { url, body } = firstFetchCall(fetch);
    expect(url).toBe('http://weaviate.internal:8080/v1/graphql');
    expect(body['query']).toEqual(expect.stringContaining('hybrid'));
    expect(body['query']).toEqual(expect.stringContaining('tenant: $tenant'));
    expect(body['query']).toEqual(expect.stringContaining('limit: 25'));
    expect(body['query']).toEqual(expect.stringContaining(TENANT_ID));
    expect(body['query']).toEqual(expect.stringContaining('valueInt:7'));
    expect(body['query']).not.toEqual(
      expect.stringContaining('Yongding ecological evidence'),
    );
    expect(body['variables']).toMatchObject({
      tenant: TENANT_ID,
      query: 'Yongding ecological evidence',
      vector: [0.25, 0.5, 0.75],
    });
    expect(record(body['variables'])).not.toHaveProperty('where');
  });
});

describe('Neo4jSearchBackend', () => {
  it('posts one fixed parameterized read-only Cypher statement to the current Query API', async () => {
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
    const fetch = mockFetch(() =>
      jsonResponse(
        {
          data: {
            fields,
            values: [
              fields.map(
                (field) =>
                  projection()[field as keyof SearchBackendHit] ?? null,
              ),
            ],
          },
          queryType: 'r',
        },
        202,
      ),
    );
    const backend = new Neo4jSearchBackend({
      endpoint: 'http://neo4j.internal:7474',
      database: 'neo4j',
      username: 'neo4j',
      password: 'private-neo4j-password',
      fetch,
    });

    await expect(
      backend.search(request({ channels: ['graph'] })),
    ).resolves.toEqual([projection()]);
    const { url, body } = firstFetchCall(fetch);
    expect(url).toBe('http://neo4j.internal:7474/db/neo4j/query/v2');
    expect(body['statement']).toEqual(
      expect.stringContaining('MATCH (entity:WiserEntity)'),
    );
    expect(body['statement']).toEqual(expect.stringContaining('$tenantId'));
    expect(body['statement']).not.toEqual(
      expect.stringContaining('Yongding ecological evidence'),
    );
    expect(body['parameters']).toMatchObject({
      tenantId: TENANT_ID,
      projectId: PROJECT_ID,
      query: 'Yongding ecological evidence',
      policyVersion: 7,
      limit: 25,
    });
  });
});

class FakePostGISClient implements PostGISSearchClient {
  readonly calls: Array<{
    readonly text: string;
    readonly values: readonly unknown[];
  }> = [];
  released = false;

  query<Row = Readonly<Record<string, unknown>>>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<{ readonly rows: readonly Row[] }> {
    this.calls.push({ text, values });
    if (text.includes('platform-search:postgis-query')) {
      return Promise.resolve({ rows: [projection() as Row] });
    }
    return Promise.resolve({ rows: [] });
  }

  release() {
    this.released = true;
  }
}

class FakePostGISPool implements PostGISSearchPool {
  constructor(readonly client: FakePostGISClient) {}

  connect() {
    return Promise.resolve(this.client);
  }
}

describe('PostGISSearchBackend', () => {
  it('sets RLS GUCs and executes only fixed parameterized SQL in one transaction', async () => {
    const client = new FakePostGISClient();
    const backend = new PostGISSearchBackend({
      pool: new FakePostGISPool(client),
    });

    await expect(
      backend.search(request({ channels: ['geo'] })),
    ).resolves.toEqual([projection()]);
    expect(client.calls[0]?.text.toLowerCase()).toBe('begin');
    const guc = client.calls.find(({ text }) =>
      text.includes('platform-search:postgis-rls'),
    );
    expect(guc?.values).toEqual([TENANT_ID, PROJECT_ID, 'L2_RESTRICTED', '7']);
    const queryCall = client.calls.find(({ text }) =>
      text.includes('platform-search:postgis-query'),
    );
    expect(queryCall?.text).toContain('$1::uuid');
    expect(queryCall?.text).not.toContain('Yongding ecological evidence');
    expect(queryCall?.values).toContain('Yongding ecological evidence');
    expect(client.calls.at(-1)?.text.toLowerCase()).toBe('commit');
    expect(client.released).toBe(true);
  });

  it('rolls back and sanitizes database failures', async () => {
    const secret = 'must-not-leak-database-detail';
    const calls: string[] = [];
    let released = false;
    const client: PostGISSearchClient = {
      query(text) {
        calls.push(text);
        return text.includes('platform-search:postgis-query')
          ? Promise.reject(new Error(secret))
          : Promise.resolve({ rows: [] });
      },
      release() {
        released = true;
      },
    };
    const backend = new PostGISSearchBackend({
      pool: { connect: () => Promise.resolve(client) },
    });

    let caught: unknown;
    try {
      await backend.search(request({ channels: ['geo'] }));
    } catch (error) {
      caught = error;
    }
    expectAdapterCode(caught, 'BACKEND_UNAVAILABLE');
    expect((caught as Error).message).not.toContain(secret);
    expect(calls.map((text) => text.toLowerCase())).toContain('rollback');
    expect(released).toBe(true);
  });
});

describe('PgSTACSearchBackend', () => {
  it('posts a bounded STAC CQL2 JSON search with all authority filters', async () => {
    const fetch = mockFetch(() =>
      jsonResponse({
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            id: EVIDENCE_ID,
            geometry: null,
            properties: {
              ...projection(),
              title: 'Yongding evidence',
              description: 'Published fixture evidence',
            },
          },
        ],
      }),
    );
    const backend = new PgSTACSearchBackend({
      endpoint: 'http://stac.internal:8080',
      bearerToken: 'private-stac-token',
      fetch,
    });

    await expect(
      backend.search(request({ channels: ['stac'] })),
    ).resolves.toEqual([
      {
        ...projection(),
        excerptFragments: [
          { field: 'title', text: 'Yongding evidence' },
          { field: 'description', text: 'Published fixture evidence' },
        ],
      },
    ]);
    const { url, body } = firstFetchCall(fetch);
    expect(url).toBe('http://stac.internal:8080/search');
    expect(body).toMatchObject({
      collections: [expect.stringMatching(/^wiser-[a-f0-9]{32}$/)],
      limit: 25,
      'filter-lang': 'cql2-json',
    });
    expect(JSON.stringify(body['filter'])).toContain(TENANT_ID);
    expect(JSON.stringify(body['filter'])).toContain('policyVersion');
  });
});

describe('controlled search backend boundaries', () => {
  it('rejects endpoint/auth misconfiguration and unknown request fields', async () => {
    expect(
      () =>
        new OpenSearchSearchBackend({
          endpoint: 'https://user:secret@example.test',
          indexName: 'unsafe/*',
          username: '',
          password: '',
        }),
    ).toThrow(SearchBackendAdapterError);

    const backend = new OpenSearchSearchBackend({
      endpoint: 'https://opensearch.internal:9200',
      indexName: 'wiser-evidence-v1',
      username: 'wiser',
      password: 'private',
      fetch: mockFetch(() => jsonResponse({ hits: { hits: [] } })),
    });
    await expect(
      backend.search(request({ dsl: { match_all: {} } })),
    ).rejects.toSatisfy((error: unknown) => {
      expectAdapterCode(error, 'INVALID_REQUEST');
      return true;
    });
  });

  it('bounds limits and sanitizes transport and response failures', async () => {
    const secret = 'must-not-leak-private-password';
    const unavailable = new OpenSearchSearchBackend({
      endpoint: 'https://opensearch.internal:9200',
      indexName: 'wiser-evidence-v1',
      username: 'wiser',
      password: secret,
      fetch: mockFetch(() => Promise.reject(new Error(secret))),
    });
    let caught: unknown;
    try {
      await unavailable.search(request());
    } catch (error) {
      caught = error;
    }
    expectAdapterCode(caught, 'BACKEND_UNAVAILABLE');
    expect(String((caught as Error).message)).not.toContain(secret);

    const malformed = new OpenSearchSearchBackend({
      endpoint: 'https://opensearch.internal:9200',
      indexName: 'wiser-evidence-v1',
      username: 'wiser',
      password: 'private',
      fetch: mockFetch(() =>
        jsonResponse({ hits: { hits: [{ _source: { token: secret } }] } }),
      ),
    });
    await expect(malformed.search(request())).rejects.toSatisfy(
      (error: unknown) => {
        expectAdapterCode(error, 'INVALID_RESPONSE');
        expect((error as Error).message).not.toContain(secret);
        return true;
      },
    );
    await expect(
      malformed.search(request({ limit: 10_001 })),
    ).rejects.toSatisfy((error: unknown) => {
      expectAdapterCode(error, 'INVALID_REQUEST');
      return true;
    });
  });

  it('sanitizes embedding failures before any Weaviate request', async () => {
    const secret = 'must-not-leak-embedding-detail';
    const fetch = mockFetch(() => jsonResponse({ data: { Get: {} } }));
    const backend = new WeaviateSearchBackend({
      endpoint: 'http://weaviate.internal:8080',
      apiKey: 'private-weaviate-key',
      collectionName: 'WiserEvidenceChunk',
      embed: () => Promise.reject(new Error(secret)),
      fetch,
    });
    let caught: unknown;
    try {
      await backend.search(request({ channels: ['semantic'] }));
    } catch (error) {
      caught = error;
    }
    expectAdapterCode(caught, 'EMBEDDING_UNAVAILABLE');
    expect((caught as Error).message).not.toContain(secret);
    expect(fetch).not.toHaveBeenCalled();
  });
});
