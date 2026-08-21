import type {
  EmbeddingPort,
  EvidenceProjectionInput,
  KnowledgeGraphProjectionInput,
  ProjectionEvent,
  ProjectionTarget,
  SpatialProjectionInput,
  StacProjectionInput,
} from '@wiser/data-infra';

type SecurityLevel = ProjectionEvent['securityLevel'];
type QualityGrade = EvidenceProjectionInput['qualityGrade'];
type AcceptanceStatus = EvidenceProjectionInput['acceptanceStatus'];

export interface ProjectionAuthoritySnapshot {
  readonly tenantId: string;
  readonly projectId: string;
  readonly dataItem: {
    readonly dataItemId: string;
    readonly name: string;
    readonly businessDomains: readonly string[];
    readonly securityLevel: SecurityLevel;
    readonly policyVersion: number;
  };
  readonly version: {
    readonly versionId: string;
    readonly sourceHash: string;
    readonly qualityGrade: QualityGrade;
    readonly acceptanceStatus: AcceptanceStatus;
    readonly publicationStatus:
      'UNPUBLISHED' | 'PUBLISHING' | 'PUBLISHED' | 'WITHDRAWN';
    readonly committedAt: string;
    readonly securityLevel: SecurityLevel;
    readonly policyVersion: number;
  };
  readonly assets: readonly {
    readonly assetId: string;
    readonly contentBlobId: string;
    readonly sourceHash: string;
    readonly mediaType: string;
    readonly sizeBytes: number;
    readonly versionStorageKey: string;
    readonly ordinal: number;
  }[];
  readonly evidence: readonly {
    readonly evidenceId: string;
    readonly assetId: string;
    readonly sourceHash: string;
    readonly locator: Readonly<Record<string, unknown>>;
    readonly excerpt: string | null;
  }[];
  readonly spatial: readonly {
    readonly spatialExtentId: string;
    readonly sourceCrs: string;
    readonly sourceGeoJson: SpatialProjectionInput['sourceGeoJson'];
    readonly wgs84GeoJson: StacProjectionInput['geometry'];
    readonly bbox: readonly number[];
  }[];
  readonly quality: {
    readonly checkRunId: string;
    readonly score: number;
    readonly qualityGrade: QualityGrade;
    readonly acceptanceStatus: AcceptanceStatus;
  };
  readonly lineage: {
    readonly processRunId: string;
    readonly processType: string;
    readonly implementationVersion: string;
  };
}

export interface ProjectionAuthorityIds {
  readonly dataItemId: string;
  readonly versionId: string;
  readonly assetIds: readonly string[];
  readonly contentBlobIds: readonly string[];
  readonly evidenceFragmentIds: readonly string[];
  readonly spatialExtentIds: readonly string[];
  readonly checkRunId: string;
  readonly processRunId: string;
}

export interface ProjectionHydrationAuthority {
  load(
    event: ProjectionEvent,
    ids: ProjectionAuthorityIds,
  ): Promise<ProjectionAuthoritySnapshot>;
  close(): Promise<void>;
}

export interface HydratedProjectionInputs {
  readonly postgis: readonly SpatialProjectionInput[];
  readonly evidence: readonly EvidenceProjectionInput[];
  readonly graph: readonly KnowledgeGraphProjectionInput[];
  readonly stac: StacProjectionInput;
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[a-f0-9]{64}$/;
const PAYLOAD_KEYS = [
  'assetIds',
  'checkRunId',
  'contentBlobIds',
  'dataItemId',
  'evidenceFragmentIds',
  'processRunId',
  'spatialExtentIds',
  'versionId',
] as const;

function hydrationError(): Error {
  return new Error('Projection hydration authority contract is invalid.');
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function uuid(value: unknown): string {
  if (typeof value !== 'string' || !UUID.test(value)) throw hydrationError();
  return value;
}

function uuidArray(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 10_000) {
    throw hydrationError();
  }
  const result = value.map(uuid);
  if (new Set(result).size !== result.length) throw hydrationError();
  return Object.freeze(result);
}

function authorityIds(event: ProjectionEvent): ProjectionAuthorityIds {
  if (!isRecord(event.payload)) throw hydrationError();
  const keys = Object.keys(event.payload).sort();
  if (
    keys.length !== PAYLOAD_KEYS.length ||
    keys.some((key, index) => key !== PAYLOAD_KEYS[index])
  ) {
    throw hydrationError();
  }
  const ids = {
    dataItemId: uuid(event.payload['dataItemId']),
    versionId: uuid(event.payload['versionId']),
    assetIds: uuidArray(event.payload['assetIds']),
    contentBlobIds: uuidArray(event.payload['contentBlobIds']),
    evidenceFragmentIds: uuidArray(event.payload['evidenceFragmentIds']),
    spatialExtentIds: uuidArray(event.payload['spatialExtentIds']),
    checkRunId: uuid(event.payload['checkRunId']),
    processRunId: uuid(event.payload['processRunId']),
  };
  if (
    ids.dataItemId !== event.dataItemId ||
    ids.versionId !== event.versionId ||
    ids.assetIds.length !== ids.contentBlobIds.length ||
    ids.spatialExtentIds.length !== 1
  ) {
    throw hydrationError();
  }
  return Object.freeze(ids);
}

function assertSnapshot(
  event: ProjectionEvent,
  ids: ProjectionAuthorityIds,
  snapshot: ProjectionAuthoritySnapshot,
): void {
  if (
    snapshot.tenantId !== event.tenantId ||
    snapshot.projectId !== event.projectId ||
    snapshot.dataItem.dataItemId !== event.dataItemId ||
    snapshot.version.versionId !== event.versionId ||
    snapshot.dataItem.securityLevel !== event.securityLevel ||
    snapshot.version.securityLevel !== event.securityLevel ||
    snapshot.dataItem.policyVersion !== event.policyVersion ||
    snapshot.version.policyVersion !== event.policyVersion ||
    snapshot.assets.length !== ids.assetIds.length ||
    snapshot.evidence.length !== ids.evidenceFragmentIds.length ||
    snapshot.spatial.length !== ids.spatialExtentIds.length ||
    snapshot.quality.checkRunId !== ids.checkRunId ||
    snapshot.lineage.processRunId !== ids.processRunId ||
    snapshot.assets.some(
      (asset, index) =>
        asset.assetId !== ids.assetIds[index] ||
        asset.contentBlobId !== ids.contentBlobIds[index] ||
        !SHA256.test(asset.sourceHash) ||
        asset.ordinal !== index ||
        asset.sizeBytes < 1,
    ) ||
    snapshot.evidence.some(
      (evidence, index) =>
        evidence.evidenceId !== ids.evidenceFragmentIds[index] ||
        !ids.assetIds.includes(evidence.assetId) ||
        !SHA256.test(evidence.sourceHash),
    ) ||
    snapshot.spatial.some(
      (spatial, index) =>
        spatial.spatialExtentId !== ids.spatialExtentIds[index],
    ) ||
    !Number.isFinite(snapshot.quality.score) ||
    snapshot.quality.score < 0 ||
    snapshot.quality.score > 1 ||
    snapshot.quality.qualityGrade !== snapshot.version.qualityGrade ||
    snapshot.quality.acceptanceStatus !== snapshot.version.acceptanceStatus ||
    !Number.isFinite(Date.parse(snapshot.version.committedAt))
  ) {
    throw hydrationError();
  }
}

function evidenceContent(
  snapshot: ProjectionAuthoritySnapshot,
  evidence: ProjectionAuthoritySnapshot['evidence'][number],
): string {
  const excerpt = evidence.excerpt?.trim();
  if (excerpt !== undefined && excerpt.length > 0) return excerpt;
  return `${snapshot.dataItem.name} — authority evidence sha256:${evidence.sourceHash}`;
}

export class ProjectionInputHydrator {
  readonly #authority: ProjectionHydrationAuthority;
  readonly #embedding: EmbeddingPort;
  readonly #maximumCachedEvents: number;
  readonly #cache = new Map<string, Promise<HydratedProjectionInputs>>();

  constructor(options: {
    readonly authority: ProjectionHydrationAuthority;
    readonly embedding: EmbeddingPort;
    readonly maximumCachedEvents: number;
  }) {
    if (
      typeof options.authority?.load !== 'function' ||
      typeof options.embedding?.embed !== 'function' ||
      !Number.isSafeInteger(options.maximumCachedEvents) ||
      options.maximumCachedEvents < 1 ||
      options.maximumCachedEvents > 1_000
    ) {
      throw hydrationError();
    }
    this.#authority = options.authority;
    this.#embedding = options.embedding;
    this.#maximumCachedEvents = options.maximumCachedEvents;
  }

  hydrate(event: ProjectionEvent): Promise<HydratedProjectionInputs> {
    const cached = this.#cache.get(event.eventId);
    if (cached !== undefined) return cached;
    if (this.#cache.size >= this.#maximumCachedEvents) {
      const oldest = this.#cache.keys().next().value;
      if (oldest !== undefined) this.#cache.delete(oldest);
    }
    const hydration = this.#hydrate(event);
    this.#cache.set(event.eventId, hydration);
    return hydration;
  }

  close(): Promise<void> {
    this.#cache.clear();
    return this.#authority.close();
  }

  async #hydrate(event: ProjectionEvent): Promise<HydratedProjectionInputs> {
    const ids = authorityIds(event);
    const snapshot = await this.#authority.load(event, ids);
    assertSnapshot(event, ids, snapshot);
    const channels = Object.freeze([
      'catalog',
      'fulltext',
      'semantic',
      'graph',
      'geo',
      'stac',
    ] as const);
    const evidenceInputs: EvidenceProjectionInput[] = [];
    const graphInputs: KnowledgeGraphProjectionInput[] = [];
    for (const evidence of snapshot.evidence) {
      const asset = snapshot.assets.find(
        ({ assetId }) => assetId === evidence.assetId,
      );
      if (asset === undefined) throw hydrationError();
      const content = evidenceContent(snapshot, evidence);
      const vector = await this.#embedding.embed(content);
      evidenceInputs.push({
        tenantId: event.tenantId,
        projectId: event.projectId,
        dataItemId: event.dataItemId,
        versionId: event.versionId,
        assetId: asset.assetId,
        chunkId: evidence.evidenceId,
        evidenceId: evidence.evidenceId,
        sourceHash: evidence.sourceHash,
        securityLevel: event.securityLevel,
        qualityGrade: snapshot.quality.qualityGrade,
        acceptanceStatus: snapshot.quality.acceptanceStatus,
        publicationStatus: 'PUBLISHED',
        policyVersion: event.policyVersion,
        businessDomains: snapshot.dataItem.businessDomains,
        channels,
        limitations: [],
        documentId: event.dataItemId,
        pageOrSection: `asset-${asset.ordinal}`,
        language: 'und',
        chunkingStrategy: 'authority-evidence-v1',
        embeddingModel: this.#embedding.model.model,
        embeddingVersion: this.#embedding.model.version,
        content,
        vector,
      });
      graphInputs.push({
        tenantId: event.tenantId,
        projectId: event.projectId,
        dataItemId: event.dataItemId,
        versionId: event.versionId,
        evidenceId: evidence.evidenceId,
        sourceHash: evidence.sourceHash,
        securityLevel: event.securityLevel,
        qualityGrade: snapshot.quality.qualityGrade,
        acceptanceStatus: snapshot.quality.acceptanceStatus,
        publicationStatus: 'PUBLISHED',
        businessDomains: snapshot.dataItem.businessDomains,
        channels,
        limitations: [],
        confidence: snapshot.quality.score,
        reviewStatus: 'APPROVED',
        validFrom: snapshot.version.committedAt,
        validTo: snapshot.version.committedAt,
        systemFrom: snapshot.version.committedAt,
        systemTo: null,
        policyVersion: event.policyVersion,
        entityId: event.dataItemId,
        entityType: 'data_item',
        entityName: snapshot.dataItem.name,
      });
    }
    const spatial = snapshot.spatial[0];
    const asset = snapshot.assets[0];
    const firstEvidence = snapshot.evidence[0];
    if (
      spatial === undefined ||
      asset === undefined ||
      firstEvidence === undefined
    ) {
      throw hydrationError();
    }
    const governed = {
      tenantId: event.tenantId,
      projectId: event.projectId,
      dataItemId: event.dataItemId,
      versionId: event.versionId,
      evidenceId: firstEvidence.evidenceId,
      sourceHash: firstEvidence.sourceHash,
      securityLevel: event.securityLevel,
      qualityGrade: snapshot.quality.qualityGrade,
      acceptanceStatus: snapshot.quality.acceptanceStatus,
      publicationStatus: 'PUBLISHED' as const,
      businessDomains: snapshot.dataItem.businessDomains,
      channels,
      limitations: [] as const,
      confidence: snapshot.quality.score,
      reviewStatus: 'APPROVED' as const,
      validFrom: snapshot.version.committedAt,
      validTo: snapshot.version.committedAt,
      systemFrom: snapshot.version.committedAt,
      systemTo: null,
      policyVersion: event.policyVersion,
    };
    return Object.freeze({
      postgis: Object.freeze(
        snapshot.spatial.map((extent) => ({
          spatialExtentId: extent.spatialExtentId,
          tenantId: event.tenantId,
          projectId: event.projectId,
          dataItemId: event.dataItemId,
          versionId: event.versionId,
          sourceGeoJson: extent.sourceGeoJson,
          sourceCrs: extent.sourceCrs,
          securityLevel: event.securityLevel,
          policyVersion: event.policyVersion,
        })),
      ),
      evidence: Object.freeze(evidenceInputs),
      graph: Object.freeze(graphInputs),
      stac: Object.freeze({
        ...governed,
        title: snapshot.dataItem.name,
        description: evidenceContent(snapshot, firstEvidence).slice(0, 4_096),
        geometry: spatial.wgs84GeoJson,
        bbox: spatial.bbox,
        assetMediaType: asset.mediaType,
        assetSizeBytes: asset.sizeBytes,
      }),
    });
  }
}

interface PutProjection {
  put(input: unknown): unknown;
}

export function createProjectionTargets(options: {
  readonly hydrator: ProjectionInputHydrator;
  readonly postgis: PutProjection;
  readonly weaviate: PutProjection & { ensureCollection(): Promise<void> };
  readonly opensearch: PutProjection & { ensureIndex(): Promise<void> };
  readonly neo4j: PutProjection;
  readonly stac: PutProjection;
}): readonly ProjectionTarget[] {
  let weaviateReady: Promise<void> | undefined;
  let openSearchReady: Promise<void> | undefined;
  return Object.freeze([
    {
      kind: 'POSTGIS',
      project: async (event) => {
        const input = await options.hydrator.hydrate(event);
        for (const spatial of input.postgis) await options.postgis.put(spatial);
      },
    },
    {
      kind: 'WEAVIATE',
      project: async (event) => {
        weaviateReady ??= options.weaviate.ensureCollection();
        await weaviateReady;
        const input = await options.hydrator.hydrate(event);
        for (const evidence of input.evidence) {
          await options.weaviate.put(evidence);
        }
      },
    },
    {
      kind: 'OPENSEARCH',
      project: async (event) => {
        openSearchReady ??= options.opensearch.ensureIndex();
        await openSearchReady;
        const input = await options.hydrator.hydrate(event);
        for (const evidence of input.evidence) {
          await options.opensearch.put(evidence);
        }
      },
    },
    {
      kind: 'NEO4J',
      project: async (event) => {
        const input = await options.hydrator.hydrate(event);
        for (const graph of input.graph) await options.neo4j.put(graph);
      },
    },
    {
      kind: 'STAC',
      project: async (event) => {
        const input = await options.hydrator.hydrate(event);
        await options.stac.put(input.stac);
      },
    },
  ] satisfies readonly ProjectionTarget[]);
}
