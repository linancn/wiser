import { describe, expect, it, vi } from 'vitest';

import {
  SearchOrchestrator,
  SearchOrchestratorError,
  type SearchBackendHit,
  type SearchBackendPort,
} from '../../src/search/index.js';

const TENANT_ID = 'a2000000-0000-4000-8000-000000000001';
const PROJECT_ID = 'a2000000-0000-4000-8000-000000000002';
const ITEM_A = 'a2000000-0000-4000-8000-000000000003';
const ITEM_B = 'a2000000-0000-4000-8000-000000000004';
const ITEM_C = 'a2000000-0000-4000-8000-000000000005';
const VERSION_A = 'a2000000-0000-4000-8000-000000000006';
const VERSION_B = 'a2000000-0000-4000-8000-000000000007';
const VERSION_C = 'a2000000-0000-4000-8000-000000000008';
const EVIDENCE_A = 'a2000000-0000-4000-8000-000000000009';
const EVIDENCE_B = 'a2000000-0000-4000-8000-000000000010';
const EVIDENCE_C = 'a2000000-0000-4000-8000-000000000011';
const NOW = new Date('2026-08-22T04:00:00.000Z');

type BackendName = 'opensearch' | 'weaviate' | 'neo4j' | 'postgis' | 'pgstac';

function hit(
  dataItemId: string,
  versionId: string,
  evidenceId: string,
  overrides: Partial<SearchBackendHit> = {},
): SearchBackendHit {
  return {
    tenantId: TENANT_ID,
    projectId: PROJECT_ID,
    dataItemId,
    versionId,
    evidenceId,
    qualityGrade: 'A',
    acceptanceStatus: 'PASSED',
    publicationStatus: 'PUBLISHED',
    securityLevel: 'L1_INTERNAL',
    policyVersion: 3,
    excerptFragments: [
      { field: 'title', text: `Title for ${dataItemId}` },
      { field: 'secretNote', text: 'must-not-leak' },
    ],
    limitations: [],
    ...overrides,
  };
}

function backend(
  source: BackendName,
  hits: readonly SearchBackendHit[] = [],
  failure?: Error,
): SearchBackendPort {
  return {
    source,
    search: vi.fn(() =>
      failure === undefined ? Promise.resolve(hits) : Promise.reject(failure),
    ),
  };
}

function orchestrator(
  overrides: Partial<{
    readonly openSearch: SearchBackendPort;
    readonly weaviate: SearchBackendPort;
    readonly neo4j: SearchBackendPort;
    readonly postgis: SearchBackendPort;
    readonly pgstac: SearchBackendPort;
    readonly reranker: {
      rerank(input: unknown): Promise<readonly unknown[]>;
    };
  }> = {},
) {
  return new SearchOrchestrator({
    openSearch: backend('opensearch'),
    weaviate: backend('weaviate'),
    neo4j: backend('neo4j'),
    postgis: backend('postgis'),
    pgstac: backend('pgstac'),
    clock: () => NOW,
    ...overrides,
  });
}

function input(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    tenantId: TENANT_ID,
    projectId: PROJECT_ID,
    query: 'Yongding monitoring evidence',
    maxSecurityLevel: 'L1_INTERNAL' as const,
    policyVersion: 3,
    businessDomains: ['water-monitoring'],
    securityLevels: ['L0_PUBLIC', 'L1_INTERNAL'] as const,
    versionIds: [VERSION_A, VERSION_B, VERSION_C],
    allowedExcerptFields: ['title'],
    first: 20,
    ...overrides,
  };
}

describe('SearchOrchestrator', () => {
  it('pushes every authorization and lifecycle filter into all backends without raw query languages', async () => {
    let started = 0;
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ports = Object.fromEntries(
      (['opensearch', 'weaviate', 'neo4j', 'postgis', 'pgstac'] as const).map(
        (source) => {
          const port: SearchBackendPort = {
            source,
            search: vi.fn(async () => {
              started += 1;
              if (started === 5) release?.();
              await gate;
              return [];
            }),
          };
          return [source, port];
        },
      ),
    ) as Record<BackendName, SearchBackendPort>;
    const search = orchestrator({
      openSearch: ports.opensearch,
      weaviate: ports.weaviate,
      neo4j: ports.neo4j,
      postgis: ports.postgis,
      pgstac: ports.pgstac,
    });

    await expect(search.search(input())).resolves.toEqual({ items: [] });
    expect(started).toBe(5);
    for (const port of Object.values(ports)) {
      expect(port.search).toHaveBeenCalledOnce();
      const request = vi.mocked(port.search).mock.calls[0]?.[0];
      expect(request).toMatchObject({
        tenantId: TENANT_ID,
        projectId: PROJECT_ID,
        maxSecurityLevel: 'L1_INTERNAL',
        maximumPolicyVersion: 3,
        versionIds: [VERSION_A, VERSION_B, VERSION_C],
        acceptanceStatuses: ['PASSED', 'CONDITIONALLY_PASSED'],
        publicationStatuses: ['PUBLISHED'],
        securityLevels: ['L0_PUBLIC', 'L1_INTERNAL'],
      });
      expect(Object.keys(request ?? {}).sort()).toEqual([
        'acceptanceStatuses',
        'businessDomains',
        'channels',
        'limit',
        'maxSecurityLevel',
        'maximumPolicyVersion',
        'projectId',
        'publicationStatuses',
        'query',
        'securityLevels',
        'tenantId',
        'versionIds',
      ]);
      expect(request).not.toHaveProperty('sql');
      expect(request).not.toHaveProperty('dsl');
      expect(request).not.toHaveProperty('cypher');
    }
  });

  it('uses RRF(k=60), fuses sources, and deduplicates by data item plus version', async () => {
    const search = orchestrator({
      openSearch: backend('opensearch', [
        hit(ITEM_A, VERSION_A, EVIDENCE_A),
        hit(ITEM_B, VERSION_B, EVIDENCE_B),
      ]),
      weaviate: backend('weaviate', [
        hit(ITEM_B, VERSION_B, EVIDENCE_B),
        hit(ITEM_C, VERSION_C, EVIDENCE_C),
        hit(ITEM_A, VERSION_A, EVIDENCE_A),
      ]),
    });

    const result = await search.search(input());

    expect(result.items.map(({ dataItemId }) => dataItemId)).toEqual([
      ITEM_B,
      ITEM_A,
      ITEM_C,
    ]);
    expect(result.items).toHaveLength(3);
    expect(result.items[0]).toMatchObject({
      dataItemId: ITEM_B,
      versionId: VERSION_B,
      source: 'opensearch+weaviate',
      score: 1 / 62 + 1 / 61,
      generatedAt: NOW.toISOString(),
    });
    expect(result.items[1]?.score).toBeCloseTo(1 / 61 + 1 / 63, 12);
  });

  it('enforces authority again, removes unauthorized excerpt fields, and records limitations', async () => {
    const valid = hit(ITEM_A, VERSION_A, EVIDENCE_A);
    const search = orchestrator({
      openSearch: backend('opensearch', [
        hit(ITEM_B, VERSION_B, EVIDENCE_B, {
          tenantId: 'b2000000-0000-4000-8000-000000000001',
        }),
        hit(ITEM_B, VERSION_B, EVIDENCE_B, {
          projectId: 'b2000000-0000-4000-8000-000000000002',
        }),
        hit(ITEM_C, VERSION_C, EVIDENCE_C),
        hit(ITEM_B, VERSION_B, EVIDENCE_B, {
          securityLevel: 'L2_RESTRICTED',
        }),
        hit(ITEM_B, VERSION_B, EVIDENCE_B, { policyVersion: 4 }),
        hit(ITEM_B, VERSION_B, EVIDENCE_B, {
          acceptanceStatus: 'REJECTED',
        }),
        hit(ITEM_B, VERSION_B, EVIDENCE_B, {
          publicationStatus: 'UNPUBLISHED',
        }),
        valid,
      ]),
    });

    const result = await search.search(
      input({ versionIds: [VERSION_A, VERSION_B] }),
    );

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      dataItemId: ITEM_A,
      excerpt: `Title for ${ITEM_A}`,
      qualityGrade: 'A',
      acceptanceStatus: 'PASSED',
      securityLevel: 'L1_INTERNAL',
    });
    expect(result.items[0]?.limitations).toContain(
      'excerpt_fields_redacted:secretNote',
    );
    expect(JSON.stringify(result)).not.toContain('must-not-leak');
  });

  it('sorts ties stably and binds opaque cursors to the query and authorization context', async () => {
    const search = orchestrator({
      openSearch: backend('opensearch', [hit(ITEM_C, VERSION_C, EVIDENCE_C)]),
      weaviate: backend('weaviate', [hit(ITEM_B, VERSION_B, EVIDENCE_B)]),
      neo4j: backend('neo4j', [hit(ITEM_A, VERSION_A, EVIDENCE_A)]),
    });
    const first = await search.search(input({ first: 1 }));

    expect(first.items).toHaveLength(1);
    expect(first.items[0]?.dataItemId).toBe(ITEM_A);
    expect(first.nextCursor).toEqual(expect.any(String));
    const second = await search.search(
      input({ first: 1, after: first.nextCursor }),
    );
    expect(second.items).toHaveLength(1);
    expect(second.items[0]?.dataItemId).toBe(ITEM_B);

    await expect(
      search.search(
        input({ first: 1, after: first.nextCursor, query: 'other' }),
      ),
    ).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(SearchOrchestratorError);
      expect((error as SearchOrchestratorError).code).toBe('INVALID_CURSOR');
      return true;
    });
  });

  it('survives partial backend failure with safe limitations and fails closed when all backends fail', async () => {
    const partial = orchestrator({
      openSearch: backend('opensearch', [hit(ITEM_A, VERSION_A, EVIDENCE_A)]),
      weaviate: backend('weaviate', [], new Error('secret backend detail')),
      neo4j: backend('neo4j', [], new Error('connection refused')),
    });

    const result = await partial.search(input());
    expect(result.items[0]?.limitations).toEqual(
      expect.arrayContaining([
        'backend_unavailable:neo4j',
        'backend_unavailable:weaviate',
      ]),
    );
    expect(JSON.stringify(result)).not.toContain('secret backend detail');

    const failed = orchestrator({
      openSearch: backend('opensearch', [], new Error('failed')),
      weaviate: backend('weaviate', [], new Error('failed')),
      neo4j: backend('neo4j', [], new Error('failed')),
      postgis: backend('postgis', [], new Error('failed')),
      pgstac: backend('pgstac', [], new Error('failed')),
    });
    await expect(failed.search(input())).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(SearchOrchestratorError);
      expect((error as SearchOrchestratorError).code).toBe(
        'ALL_BACKENDS_FAILED',
      );
      return true;
    });
  });

  it('uses an optional reranker only after authorization and falls back safely on reranker failure', async () => {
    const rerank = vi.fn(() =>
      Promise.resolve([
        { dataItemId: ITEM_B, versionId: VERSION_B },
        { dataItemId: ITEM_A, versionId: VERSION_A },
      ]),
    );
    const search = orchestrator({
      openSearch: backend('opensearch', [
        hit(ITEM_A, VERSION_A, EVIDENCE_A),
        hit(ITEM_B, VERSION_B, EVIDENCE_B),
      ]),
      reranker: { rerank },
    });
    const reranked = await search.search(input());

    expect(reranked.items.map(({ dataItemId }) => dataItemId)).toEqual([
      ITEM_B,
      ITEM_A,
    ]);
    expect(JSON.stringify(rerank.mock.calls)).not.toContain('must-not-leak');

    const fallback = orchestrator({
      openSearch: backend('opensearch', [hit(ITEM_A, VERSION_A, EVIDENCE_A)]),
      reranker: { rerank: () => Promise.reject(new Error('private detail')) },
    });
    const fallbackResult = await fallback.search(input());
    expect(fallbackResult.items[0]?.limitations).toContain(
      'reranker_unavailable',
    );
    expect(JSON.stringify(fallbackResult)).not.toContain('private detail');
  });

  it('selects only requested structured backends', async () => {
    const openSearch = backend('opensearch');
    const weaviate = backend('weaviate');
    const neo4j = backend('neo4j');
    const postgis = backend('postgis');
    const pgstac = backend('pgstac');
    const search = orchestrator({
      openSearch,
      weaviate,
      neo4j,
      postgis,
      pgstac,
    });

    await search.search(input({ sources: ['catalog', 'semantic', 'stac'] }));

    expect(openSearch.search).toHaveBeenCalledOnce();
    expect(weaviate.search).toHaveBeenCalledOnce();
    expect(pgstac.search).toHaveBeenCalledOnce();
    expect(neo4j.search).not.toHaveBeenCalled();
    expect(postgis.search).not.toHaveBeenCalled();
    expect(vi.mocked(openSearch.search).mock.calls[0]?.[0].channels).toEqual([
      'catalog',
    ]);
  });
});
