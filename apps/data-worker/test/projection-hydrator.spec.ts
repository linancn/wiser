import { describe, expect, it, vi } from 'vitest';

import {
  DeterministicFakeEmbedding,
  type ProjectionEvent,
} from '@wiser/data-infra';

import {
  ProjectionInputHydrator,
  createProjectionTargets,
  type ProjectionAuthoritySnapshot,
  type ProjectionHydrationAuthority,
} from '../src/runtime/projection-hydrator.js';

const event: ProjectionEvent = {
  outboxEventId: '41',
  eventId: '41000000-0000-4000-8000-000000000041',
  tenantId: '41000000-0000-4000-8000-000000000001',
  projectId: '41000000-0000-4000-8000-000000000002',
  dataItemId: '41000000-0000-4000-8000-000000000003',
  versionId: '41000000-0000-4000-8000-000000000004',
  eventType: 'data.version.committed',
  idempotencyKey: 'data.version.committed:fixture-41',
  securityLevel: 'L2_RESTRICTED',
  policyVersion: 7,
  payload: {
    dataItemId: '41000000-0000-4000-8000-000000000003',
    versionId: '41000000-0000-4000-8000-000000000004',
    assetIds: ['41000000-0000-4000-8000-000000000005'],
    contentBlobIds: ['41000000-0000-4000-8000-000000000006'],
    evidenceFragmentIds: ['41000000-0000-4000-8000-000000000007'],
    spatialExtentIds: ['41000000-0000-4000-8000-000000000008'],
    checkRunId: '41000000-0000-4000-8000-000000000009',
    processRunId: '41000000-0000-4000-8000-000000000010',
  },
  createdAt: '2026-08-22T04:00:00.000Z',
};

const snapshot: ProjectionAuthoritySnapshot = {
  tenantId: event.tenantId,
  projectId: event.projectId,
  dataItem: {
    dataItemId: event.dataItemId,
    name: '永定河流量证据',
    businessDomains: ['river-flow'],
    securityLevel: event.securityLevel,
    policyVersion: event.policyVersion,
  },
  version: {
    versionId: event.versionId,
    sourceHash: 'a'.repeat(64),
    qualityGrade: 'A',
    acceptanceStatus: 'PASSED',
    publicationStatus: 'UNPUBLISHED',
    committedAt: '2026-08-22T03:59:00.000Z',
    securityLevel: event.securityLevel,
    policyVersion: event.policyVersion,
  },
  assets: [
    {
      assetId: '41000000-0000-4000-8000-000000000005',
      contentBlobId: '41000000-0000-4000-8000-000000000006',
      sourceHash: 'b'.repeat(64),
      mediaType: 'application/geo+json',
      sizeBytes: 512,
      versionStorageKey: 'tenants/t/projects/p/versions/v/sha256/hash',
      ordinal: 0,
    },
  ],
  evidence: [
    {
      evidenceId: '41000000-0000-4000-8000-000000000007',
      assetId: '41000000-0000-4000-8000-000000000005',
      sourceHash: 'b'.repeat(64),
      locator: { ordinal: 0 },
      excerpt: null,
    },
  ],
  spatial: [
    {
      spatialExtentId: '41000000-0000-4000-8000-000000000008',
      sourceCrs: 'EPSG:4326',
      sourceGeoJson: { type: 'Point', coordinates: [116.4, 39.9] },
      wgs84GeoJson: { type: 'Point', coordinates: [116.4, 39.9] },
      bbox: [116.4, 39.9, 116.4, 39.9],
    },
  ],
  quality: {
    checkRunId: '41000000-0000-4000-8000-000000000009',
    score: 1,
    qualityGrade: 'A',
    acceptanceStatus: 'PASSED',
  },
  lineage: {
    processRunId: '41000000-0000-4000-8000-000000000010',
    processType: 'INGESTION_PIPELINE',
    implementationVersion: 'wiser-ingestion-pipeline-1',
  },
};

class FakeAuthority implements ProjectionHydrationAuthority {
  readonly load = vi.fn(() => Promise.resolve(snapshot));
  close(): Promise<void> {
    return Promise.resolve();
  }
}

describe('five-target projection hydrator', () => {
  it('loads authority IDs once and creates exact governed inputs for every target', async () => {
    const authority = new FakeAuthority();
    const hydrator = new ProjectionInputHydrator({
      authority,
      embedding: new DeterministicFakeEmbedding({
        dimensions: 8,
        version: '1.0.0-fixture',
      }),
      maximumCachedEvents: 8,
    });
    const calls: {
      POSTGIS: unknown[];
      WEAVIATE: unknown[];
      OPENSEARCH: unknown[];
      NEO4J: unknown[];
      STAC: unknown[];
    } = {
      POSTGIS: [],
      WEAVIATE: [],
      OPENSEARCH: [],
      NEO4J: [],
      STAC: [],
    };
    const targets = createProjectionTargets({
      hydrator,
      postgis: { put: (input) => void calls.POSTGIS.push(input) },
      weaviate: {
        ensureCollection: () => Promise.resolve(),
        put: (input) => void calls.WEAVIATE.push(input),
      },
      opensearch: {
        ensureIndex: () => Promise.resolve(),
        put: (input) => void calls.OPENSEARCH.push(input),
      },
      neo4j: { put: (input) => void calls.NEO4J.push(input) },
      stac: { put: (input) => void calls.STAC.push(input) },
    });

    await Promise.all(targets.map((target) => target.project(event)));

    expect(targets.map(({ kind }) => kind)).toEqual([
      'POSTGIS',
      'WEAVIATE',
      'OPENSEARCH',
      'NEO4J',
      'STAC',
    ]);
    expect(authority.load).toHaveBeenCalledOnce();
    expect(calls.POSTGIS[0]).toMatchObject({
      dataItemId: event.dataItemId,
      versionId: event.versionId,
      sourceCrs: 'EPSG:4326',
    });
    for (const kind of ['WEAVIATE', 'OPENSEARCH'] as const) {
      expect(calls[kind][0]).toMatchObject({
        evidenceId: snapshot.evidence[0]?.evidenceId,
        sourceHash: snapshot.evidence[0]?.sourceHash,
        publicationStatus: 'PUBLISHED',
        embeddingModel: 'sha256-expansion',
        embeddingVersion: '1.0.0-fixture',
      });
      expect(calls[kind][0]).toHaveProperty('vector');
      expect(calls[kind][0]).toHaveProperty('content');
    }
    expect(calls.NEO4J[0]).toMatchObject({
      entityId: event.dataItemId,
      evidenceId: snapshot.evidence[0]?.evidenceId,
      reviewStatus: 'APPROVED',
    });
    expect(calls.STAC[0]).toMatchObject({
      geometry: snapshot.spatial[0]?.wgs84GeoJson,
      bbox: snapshot.spatial[0]?.bbox,
      assetMediaType: snapshot.assets[0]?.mediaType,
      publicationStatus: 'PUBLISHED',
    });
  });

  it('rejects an Outbox payload whose authority IDs do not match the event scope', async () => {
    const authority = new FakeAuthority();
    const hydrator = new ProjectionInputHydrator({
      authority,
      embedding: new DeterministicFakeEmbedding({
        dimensions: 8,
        version: '1.0.0-fixture',
      }),
      maximumCachedEvents: 8,
    });
    await expect(
      hydrator.hydrate({
        ...event,
        payload: { ...event.payload, versionId: crypto.randomUUID() },
      }),
    ).rejects.toThrow('Projection hydration');
    expect(authority.load).not.toHaveBeenCalled();
  });

  it('evicts transient authority and projection-initialization failures before retry', async () => {
    const authority = new FakeAuthority();
    authority.load.mockRejectedValueOnce(new Error('temporary database fault'));
    const hydrator = new ProjectionInputHydrator({
      authority,
      embedding: new DeterministicFakeEmbedding({
        dimensions: 8,
        version: '1.0.0-fixture',
      }),
      maximumCachedEvents: 8,
    });
    await expect(hydrator.hydrate(event)).rejects.toThrow('temporary');
    await expect(hydrator.hydrate(event)).resolves.toBeDefined();
    expect(authority.load).toHaveBeenCalledTimes(2);

    const ensureCollection = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('temporary collection fault'))
      .mockResolvedValue(undefined);
    const target = createProjectionTargets({
      hydrator,
      postgis: { put() {} },
      weaviate: { ensureCollection, put() {} },
      opensearch: { ensureIndex: () => Promise.resolve(), put() {} },
      neo4j: { put() {} },
      stac: { put() {} },
    }).find(({ kind }) => kind === 'WEAVIATE');
    expect(target).toBeDefined();
    if (target === undefined) throw new Error('missing Weaviate target');
    await expect(target.project(event)).rejects.toThrow('temporary');
    await expect(target.project(event)).resolves.toBeUndefined();
    expect(ensureCollection).toHaveBeenCalledTimes(2);
  });

  it('projects non-spatial evidence while making PostGIS and STAC explicit no-ops', async () => {
    const nonSpatialEvent: ProjectionEvent = {
      ...event,
      eventId: '41000000-0000-4000-8000-000000000042',
      payload: { ...event.payload, spatialExtentIds: [] },
    };
    const authority: ProjectionHydrationAuthority = {
      load: () => Promise.resolve({ ...snapshot, spatial: [] }),
      close: () => Promise.resolve(),
    };
    const hydrator = new ProjectionInputHydrator({
      authority,
      embedding: new DeterministicFakeEmbedding({
        dimensions: 8,
        version: '1.0.0-fixture',
      }),
      maximumCachedEvents: 8,
    });
    const calls = {
      postgis: vi.fn(),
      weaviate: vi.fn(),
      opensearch: vi.fn(),
      neo4j: vi.fn(),
      stac: vi.fn(),
    };
    const targets = createProjectionTargets({
      hydrator,
      postgis: { put: calls.postgis },
      weaviate: {
        ensureCollection: () => Promise.resolve(),
        put: calls.weaviate,
      },
      opensearch: {
        ensureIndex: () => Promise.resolve(),
        put: calls.opensearch,
      },
      neo4j: { put: calls.neo4j },
      stac: { put: calls.stac },
    });
    await Promise.all(targets.map((target) => target.project(nonSpatialEvent)));
    expect(calls.postgis).not.toHaveBeenCalled();
    expect(calls.stac).not.toHaveBeenCalled();
    expect(calls.weaviate).toHaveBeenCalledOnce();
    expect(calls.opensearch).toHaveBeenCalledOnce();
    expect(calls.neo4j).toHaveBeenCalledOnce();
  });
});
