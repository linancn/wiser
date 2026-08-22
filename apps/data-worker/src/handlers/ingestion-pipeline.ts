import { createHash } from 'node:crypto';

import {
  DATA_INGESTION_PROCESS_JOB_TYPE,
  type ClaimedDataJob,
  type DataIngestionProcessJobPayload,
} from '@wiser/data-infra';
import {
  evaluateQualityGate,
  transitionIngestionState,
  type DeterministicQualityCheck,
  type QualityGateDecision,
} from '@wiser/data-core';

import {
  DataJobHandlerError,
  type DataJobHandler,
  type DataJobHandlerResult,
} from './registry.js';

export { DATA_INGESTION_PROCESS_JOB_TYPE };

export type PipelineIngestionState =
  | 'RECEIVED'
  | 'QUARANTINED'
  | 'SECURITY_SCANNED'
  | 'FINGERPRINTED'
  | 'PROFILED'
  | 'CLASSIFIED'
  | 'SCHEMA_MAPPED'
  | 'SEMANTIC_MAPPED'
  | 'VALIDATED'
  | 'SPATIOTEMPORAL_ALIGNED'
  | 'REVIEW_REQUIRED'
  | 'APPROVED'
  | 'REJECTED'
  | 'COMMITTED'
  | 'PROJECTING'
  | 'PUBLISHED'
  | 'FAILED'
  | 'CANCELLED';

export type PipelineSecurityLevel =
  'L0_PUBLIC' | 'L1_INTERNAL' | 'L2_RESTRICTED' | 'L3_CONFIDENTIAL';

export type IngestionPipelinePayload = DataIngestionProcessJobPayload;

export interface IngestionAssetCheckpoint {
  readonly assetId: string;
  readonly ordinal: number;
  readonly uploadId: string;
  readonly contentBlobId?: string;
  readonly objectRef: string;
  readonly mediaType: string;
  readonly sourceKind: 'document' | 'geojson';
  readonly size: number;
  readonly sourceHash?: string;
}

export interface HashOnlyPipelineEvidence {
  readonly step: string;
  readonly inputHash: string;
  readonly outputHash: string;
  readonly agentRun?: {
    readonly kind: 'FAKE_AI_MAPPING';
    readonly inputHash: string;
    readonly outputHash: string;
    readonly validator: 'injected';
  };
}

export interface IngestionTransitionRequest {
  readonly tenantId: string;
  readonly projectId: string;
  readonly ingestionId: string;
  readonly expectedState: PipelineIngestionState;
  readonly expectedVersion: number;
  readonly toState: PipelineIngestionState;
  readonly evidence: HashOnlyPipelineEvidence;
  readonly securityLevel: PipelineSecurityLevel;
  readonly policyVersion: number;
}

export interface FrozenIngestionCheckpoint {
  readonly reviewHash: string;
  readonly assetIds: readonly string[];
  readonly assetManifest: Readonly<Record<string, unknown>>;
  readonly quality: QualityGateDecision;
  readonly alignment: Readonly<Record<string, unknown>>;
}

export interface PipelineSpatialFact {
  readonly assetId: string;
  readonly sourceCrs: 'EPSG:4326' | 'EPSG:4490' | 'EPSG:3857';
  readonly sourceGeoJson: Readonly<Record<string, unknown>>;
}

export interface IngestionAuthorityPort {
  load(request: {
    readonly tenantId: string;
    readonly projectId: string;
    readonly ingestionId: string;
    readonly securityLevel: PipelineSecurityLevel;
    readonly policyVersion: number;
  }): Promise<{
    readonly state: PipelineIngestionState;
    readonly version: number;
    readonly versionId?: string;
    readonly securityLevel: PipelineSecurityLevel;
    readonly policyVersion: number;
    readonly assets: readonly IngestionAssetCheckpoint[];
    readonly frozenCheckpoint?: FrozenIngestionCheckpoint;
  }>;
  transition(request: IngestionTransitionRequest): Promise<{
    readonly state: PipelineIngestionState;
    readonly version: number;
  }>;
  recordFingerprints(request: {
    readonly tenantId: string;
    readonly projectId: string;
    readonly ingestionId: string;
    readonly expectedState: 'SECURITY_SCANNED';
    readonly expectedVersion: number;
    readonly securityLevel: PipelineSecurityLevel;
    readonly policyVersion: number;
    readonly fingerprints: readonly {
      readonly assetId: string;
      readonly ordinal: number;
      readonly size: number;
      readonly mediaType: string;
      readonly sourceHash: string;
    }[];
    readonly evidence: HashOnlyPipelineEvidence;
  }): Promise<{ readonly state: 'FINGERPRINTED'; readonly version: number }>;
  freezeCheckpoint(request: {
    readonly tenantId: string;
    readonly projectId: string;
    readonly ingestionId: string;
    readonly expectedState: 'SPATIOTEMPORAL_ALIGNED';
    readonly expectedVersion: number;
    readonly toState: 'REVIEW_REQUIRED' | 'APPROVED';
    readonly securityLevel: PipelineSecurityLevel;
    readonly policyVersion: number;
    readonly checkpoint: FrozenIngestionCheckpoint;
    readonly evidence: HashOnlyPipelineEvidence;
  }): Promise<{
    readonly state: 'REVIEW_REQUIRED' | 'APPROVED';
    readonly version: number;
    readonly reviewHash: string;
  }>;
  commit(request: {
    readonly tenantId: string;
    readonly projectId: string;
    readonly ingestionId: string;
    readonly expectedState: 'APPROVED';
    readonly expectedVersion: number;
    readonly checkpoint: FrozenIngestionCheckpoint;
    readonly acceptanceStatus: 'PASSED';
    readonly evidence: HashOnlyPipelineEvidence;
    readonly securityLevel: PipelineSecurityLevel;
    readonly policyVersion: number;
  }): Promise<{
    readonly state: 'COMMITTED';
    readonly version: number;
    readonly versionId: string;
  }>;
}

export interface IngestionPipelineOptions {
  readonly authority: IngestionAuthorityPort;
  readonly quarantine: {
    put(input: {
      readonly tenantId: string;
      readonly projectId: string;
      readonly ingestionId: string;
      readonly asset: IngestionAssetCheckpoint;
    }): Promise<{
      readonly objectRef: string;
      readonly size: number;
    }>;
  };
  readonly scanner: {
    scan(input: {
      readonly objectRef: string;
    }): Promise<{ readonly clean: boolean }>;
  };
  readonly fingerprint: {
    sha256(input: { readonly objectRef: string }): Promise<string>;
  };
  readonly parser: {
    parse(input: {
      readonly objectRef: string;
      readonly mediaType: string;
      readonly sourceKind: 'document' | 'geojson';
    }): Promise<{
      readonly kind: 'document' | 'geojson';
      readonly contentHash: string;
      readonly metadata: Readonly<Record<string, unknown>>;
    }>;
  };
  readonly profiler: {
    profile(input: unknown): Promise<{ readonly profileHash: string }>;
  };
  readonly classifier: {
    classify(input: unknown): Promise<{
      readonly risk: 'LOW' | 'HIGH';
      readonly restricted: boolean;
      readonly confidence: number;
      readonly classificationHash: string;
    }>;
  };
  readonly aiPlanner: { propose(input: unknown): Promise<unknown> };
  readonly aiValidator: {
    validate(input: unknown): {
      readonly schemaPlan: Readonly<Record<string, unknown>>;
      readonly semanticPlan: Readonly<Record<string, unknown>>;
      readonly confidence: number;
    };
  };
  readonly transformer: {
    transform(input: unknown): Promise<{
      readonly artifactRef: string;
      readonly outputHash: string;
    }>;
  };
  readonly quality: {
    check(input: unknown): Promise<readonly DeterministicQualityCheck[]>;
  };
  readonly aligner: {
    align(input: unknown): Promise<{
      readonly alignmentHash: string;
      readonly spatialFacts?: readonly PipelineSpatialFact[];
    }>;
  };
  readonly minimumQualityScore: number;
  readonly minimumAiConfidence: number;
}

export class IngestionPipelinePortError extends Error {
  constructor(
    readonly category: string,
    readonly retryable: boolean,
    message: string,
  ) {
    super(message);
    this.name = 'IngestionPipelinePortError';
  }
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const PAYLOAD_KEYS = Object.freeze([
  'expectedState',
  'expectedVersion',
  'ingestionId',
]);

const PIPELINE_RANK: Readonly<Partial<Record<PipelineIngestionState, number>>> =
  {
    RECEIVED: 0,
    QUARANTINED: 1,
    SECURITY_SCANNED: 2,
    FINGERPRINTED: 3,
    PROFILED: 4,
    CLASSIFIED: 5,
    SCHEMA_MAPPED: 6,
    SEMANTIC_MAPPED: 7,
    VALIDATED: 8,
    SPATIOTEMPORAL_ALIGNED: 9,
    APPROVED: 10,
    COMMITTED: 11,
    PROJECTING: 12,
    PUBLISHED: 13,
  };

function safeFailure(
  category: string,
  retryable: boolean,
  message = 'The ingestion pipeline could not complete safely.',
): DataJobHandlerError {
  return new DataJobHandlerError(category, retryable, message);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  });
}

function hasMethod(value: unknown, method: string): boolean {
  return isRecord(value) && typeof value[method] === 'function';
}

function validatedAuthorityAssets(value: unknown): IngestionAssetCheckpoint[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 10_000) {
    throw new IngestionPipelinePortError(
      'INGESTION_AUTHORITY_CONFLICT',
      false,
      'Authority assets are invalid.',
    );
  }
  const assets: IngestionAssetCheckpoint[] = [];
  const assetIds = new Set<string>();
  for (const entry of value as readonly unknown[]) {
    if (!isRecord(entry)) {
      throw new IngestionPipelinePortError(
        'INGESTION_AUTHORITY_CONFLICT',
        false,
        'Authority asset is invalid.',
      );
    }
    const assetId = entry.assetId;
    const ordinal = entry.ordinal;
    const uploadId = entry.uploadId;
    const contentBlobId = entry.contentBlobId;
    const objectRef = entry.objectRef;
    const mediaType = entry.mediaType;
    const sourceKind = entry.sourceKind;
    const size = entry.size;
    const sourceHash = entry.sourceHash;
    if (
      typeof assetId !== 'string' ||
      !UUID.test(assetId) ||
      assetIds.has(assetId) ||
      typeof ordinal !== 'number' ||
      !Number.isSafeInteger(ordinal) ||
      ordinal < 0 ||
      typeof uploadId !== 'string' ||
      !UUID.test(uploadId) ||
      (contentBlobId !== undefined &&
        (typeof contentBlobId !== 'string' || !UUID.test(contentBlobId))) ||
      typeof objectRef !== 'string' ||
      objectRef.length < 1 ||
      typeof mediaType !== 'string' ||
      mediaType.length < 1 ||
      hasControlCharacter(mediaType) ||
      (sourceKind !== 'document' && sourceKind !== 'geojson') ||
      typeof size !== 'number' ||
      !Number.isSafeInteger(size) ||
      size < 0 ||
      (sourceHash !== undefined &&
        (typeof sourceHash !== 'string' || !SHA256.test(sourceHash)))
    ) {
      throw new IngestionPipelinePortError(
        'INGESTION_AUTHORITY_CONFLICT',
        false,
        'Authority asset is invalid.',
      );
    }
    assetIds.add(assetId);
    assets.push({
      assetId,
      ordinal,
      uploadId,
      ...(contentBlobId === undefined ? {} : { contentBlobId }),
      objectRef,
      mediaType,
      sourceKind,
      size,
      ...(sourceHash === undefined ? {} : { sourceHash }),
    });
  }
  assets.sort((left, right) => left.ordinal - right.ordinal);
  if (assets.some((asset, index) => asset.ordinal !== index)) {
    throw new IngestionPipelinePortError(
      'INGESTION_AUTHORITY_CONFLICT',
      false,
      'Authority asset ordinals must be contiguous.',
    );
  }
  return assets;
}

function payload(value: ClaimedDataJob): IngestionPipelinePayload {
  if (
    value.jobType !== DATA_INGESTION_PROCESS_JOB_TYPE ||
    !isRecord(value.payload)
  ) {
    throw safeFailure('INVALID_INGESTION_JOB', false);
  }
  const keys = Object.keys(value.payload).sort();
  if (
    keys.length !== PAYLOAD_KEYS.length ||
    keys.some((key, index) => key !== PAYLOAD_KEYS[index])
  ) {
    throw safeFailure('INVALID_INGESTION_JOB', false);
  }
  const candidate = value.payload;
  for (const key of ['ingestionId']) {
    if (typeof candidate[key] !== 'string' || !UUID.test(candidate[key])) {
      throw safeFailure('INVALID_INGESTION_JOB', false);
    }
  }
  if (
    (candidate.expectedState !== 'RECEIVED' &&
      candidate.expectedState !== 'APPROVED') ||
    typeof candidate.expectedVersion !== 'number' ||
    !Number.isSafeInteger(candidate.expectedVersion) ||
    candidate.expectedVersion < 1
  ) {
    throw safeFailure('INVALID_INGESTION_JOB', false);
  }
  return candidate as unknown as IngestionPipelinePayload;
}

function canonical(value: unknown, ancestors: ReadonlySet<object>): string {
  if (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'string'
  ) {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new IngestionPipelinePortError(
        'INVALID_PIPELINE_HASH_INPUT',
        false,
        'Hash input must contain finite JSON numbers.',
      );
    }
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (typeof value !== 'object' || value === undefined) {
    throw new IngestionPipelinePortError(
      'INVALID_PIPELINE_HASH_INPUT',
      false,
      'Hash input must be JSON-compatible.',
    );
  }
  if (ancestors.has(value)) {
    throw new IngestionPipelinePortError(
      'INVALID_PIPELINE_HASH_INPUT',
      false,
      'Hash input must be acyclic.',
    );
  }
  const next = new Set(ancestors);
  next.add(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonical(item, next)).join(',')}]`;
  }
  const prototype = Object.getPrototypeOf(value) as unknown;
  if (prototype !== Object.prototype && prototype !== null) {
    throw new IngestionPipelinePortError(
      'INVALID_PIPELINE_HASH_INPUT',
      false,
      'Hash input must use plain JSON objects.',
    );
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.some(([, item]) => item === undefined)) {
    throw new IngestionPipelinePortError(
      'INVALID_PIPELINE_HASH_INPUT',
      false,
      'Hash input must not contain undefined values.',
    );
  }
  entries.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return `{${entries
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item, next)}`)
    .join(',')}}`;
}

export function canonicalPipelineHash(value: unknown): string {
  return createHash('sha256')
    .update(canonical(value, new Set()), 'utf8')
    .digest('hex');
}

function sha256(
  value: unknown,
  category = 'INVALID_PIPELINE_PORT_RESPONSE',
): string {
  if (typeof value !== 'string' || !SHA256.test(value)) {
    throw new IngestionPipelinePortError(
      category,
      false,
      'Invalid hash response.',
    );
  }
  return value;
}

function boundedText(value: unknown): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 2_048) {
    throw new IngestionPipelinePortError(
      'INVALID_PIPELINE_PORT_RESPONSE',
      false,
      'Invalid text response.',
    );
  }
  return value;
}

function optionalEvidenceExcerpt(
  metadata: Readonly<Record<string, unknown>>,
): string | undefined {
  const value = metadata['wiser:excerpt'];
  if (value === undefined) return undefined;
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > 8_192 ||
    [...value].some((character) => {
      const code = character.charCodeAt(0);
      return (
        code === 0 || (code < 32 && !['\t', '\n', '\r'].includes(character))
      );
    })
  ) {
    throw new IngestionPipelinePortError(
      'INVALID_PIPELINE_PORT_RESPONSE',
      false,
      'Invalid evidence excerpt response.',
    );
  }
  return value;
}

function validatedAlignment(
  value: unknown,
  assets: readonly IngestionAssetCheckpoint[],
): Readonly<Record<string, unknown>> & {
  readonly alignmentHash: string;
  readonly spatialFacts?: readonly PipelineSpatialFact[];
} {
  if (!isRecord(value)) {
    throw new IngestionPipelinePortError(
      'INVALID_PIPELINE_PORT_RESPONSE',
      false,
      'Invalid alignment response.',
    );
  }
  const keys = Object.keys(value).sort();
  if (
    keys.some((key) => !['alignmentHash', 'spatialFacts'].includes(key)) ||
    typeof value.alignmentHash !== 'string' ||
    !SHA256.test(value.alignmentHash)
  ) {
    throw new IngestionPipelinePortError(
      'INVALID_PIPELINE_PORT_RESPONSE',
      false,
      'Invalid alignment response.',
    );
  }
  if (value.spatialFacts === undefined) {
    return Object.freeze({ alignmentHash: value.alignmentHash });
  }
  if (!Array.isArray(value.spatialFacts)) {
    throw new IngestionPipelinePortError(
      'INVALID_PIPELINE_PORT_RESPONSE',
      false,
      'Invalid spatial facts.',
    );
  }
  const assetById = new Map(assets.map((asset) => [asset.assetId, asset]));
  const seen = new Set<string>();
  const spatialFacts: PipelineSpatialFact[] = value.spatialFacts.map(
    (entry) => {
      if (!isRecord(entry)) {
        throw new IngestionPipelinePortError(
          'INVALID_PIPELINE_PORT_RESPONSE',
          false,
          'Invalid spatial fact.',
        );
      }
      const entryKeys = Object.keys(entry).sort();
      const assetId = entry.assetId;
      const sourceCrs = entry.sourceCrs;
      const sourceGeoJson = entry.sourceGeoJson;
      const asset =
        typeof assetId === 'string' ? assetById.get(assetId) : undefined;
      if (
        entryKeys.join(',') !== 'assetId,sourceCrs,sourceGeoJson' ||
        asset === undefined ||
        asset.sourceKind !== 'geojson' ||
        seen.has(asset.assetId) ||
        !['EPSG:4326', 'EPSG:4490', 'EPSG:3857'].includes(String(sourceCrs)) ||
        !isRecord(sourceGeoJson) ||
        ![
          'GeometryCollection',
          'Point',
          'MultiPoint',
          'LineString',
          'MultiLineString',
          'Polygon',
          'MultiPolygon',
        ].includes(String(sourceGeoJson.type))
      ) {
        throw new IngestionPipelinePortError(
          'INVALID_PIPELINE_PORT_RESPONSE',
          false,
          'Invalid spatial fact.',
        );
      }
      seen.add(asset.assetId);
      return Object.freeze({
        assetId: asset.assetId,
        sourceCrs: sourceCrs as PipelineSpatialFact['sourceCrs'],
        sourceGeoJson,
      });
    },
  );
  return Object.freeze({
    alignmentHash: value.alignmentHash,
    spatialFacts: Object.freeze(spatialFacts),
  });
}

function evidence(
  step: string,
  input: unknown,
  output: unknown,
  agentRun = false,
): HashOnlyPipelineEvidence {
  const inputHash = canonicalPipelineHash(input);
  const outputHash = canonicalPipelineHash(output);
  return Object.freeze({
    step,
    inputHash,
    outputHash,
    ...(agentRun
      ? {
          agentRun: Object.freeze({
            kind: 'FAKE_AI_MAPPING' as const,
            inputHash,
            outputHash,
            validator: 'injected' as const,
          }),
        }
      : {}),
  });
}

function forbiddenAiDecision(value: unknown, depth = 0): boolean {
  if (depth > 8 || value === null || typeof value !== 'object') return false;
  if (Array.isArray(value)) {
    return value.some((item) => forbiddenAiDecision(item, depth + 1));
  }
  return Object.entries(value as Record<string, unknown>).some(
    ([key, item]) =>
      ['grade', 'qualityGrade', 'acceptance', 'acceptanceStatus'].includes(
        key,
      ) || forbiddenAiDecision(item, depth + 1),
  );
}

function assertOptions(options: IngestionPipelineOptions): void {
  if (
    !hasMethod(options.authority, 'transition') ||
    !hasMethod(options.authority, 'commit') ||
    !hasMethod(options.authority, 'load') ||
    !hasMethod(options.authority, 'recordFingerprints') ||
    !hasMethod(options.authority, 'freezeCheckpoint') ||
    !hasMethod(options.quarantine, 'put') ||
    !hasMethod(options.scanner, 'scan') ||
    !hasMethod(options.fingerprint, 'sha256') ||
    !hasMethod(options.parser, 'parse') ||
    !hasMethod(options.profiler, 'profile') ||
    !hasMethod(options.classifier, 'classify') ||
    !hasMethod(options.aiPlanner, 'propose') ||
    !hasMethod(options.aiValidator, 'validate') ||
    !hasMethod(options.transformer, 'transform') ||
    !hasMethod(options.quality, 'check') ||
    !hasMethod(options.aligner, 'align') ||
    !Number.isFinite(options.minimumQualityScore) ||
    options.minimumQualityScore <= 0 ||
    options.minimumQualityScore > 1 ||
    !Number.isFinite(options.minimumAiConfidence) ||
    options.minimumAiConfidence < 0 ||
    options.minimumAiConfidence > 1
  ) {
    throw safeFailure('INVALID_INGESTION_PIPELINE_CONFIG', false);
  }
}

export function createIngestionPipelineHandler(
  options: IngestionPipelineOptions,
): DataJobHandler {
  assertOptions(options);

  const run = async (job: ClaimedDataJob): Promise<DataJobHandlerResult> => {
    const input = payload(job);
    const tenantId = job.tenantId;
    const projectId = job.projectId;
    const securityLevel = job.securityLevel;
    const policyVersion = job.policyVersion;
    if (
      typeof tenantId !== 'string' ||
      !UUID.test(tenantId) ||
      typeof projectId !== 'string' ||
      !UUID.test(projectId) ||
      typeof securityLevel !== 'string' ||
      ![
        'L0_PUBLIC',
        'L1_INTERNAL',
        'L2_RESTRICTED',
        'L3_CONFIDENTIAL',
      ].includes(securityLevel) ||
      !Number.isSafeInteger(policyVersion) ||
      policyVersion === undefined ||
      policyVersion < 1
    ) {
      throw safeFailure('INVALID_INGESTION_JOB', false);
    }
    const checkpoint = await options.authority.load({
      tenantId,
      projectId,
      ingestionId: input.ingestionId,
      securityLevel,
      policyVersion,
    });
    if (
      !Number.isSafeInteger(checkpoint.version) ||
      checkpoint.version < input.expectedVersion
    ) {
      throw new IngestionPipelinePortError(
        'INGESTION_AUTHORITY_CONFLICT',
        false,
        'Authority checkpoint conflict.',
      );
    }
    if (
      checkpoint.securityLevel !== securityLevel ||
      checkpoint.policyVersion !== policyVersion ||
      (checkpoint.version === input.expectedVersion &&
        checkpoint.state !== input.expectedState)
    ) {
      throw new IngestionPipelinePortError(
        'INGESTION_AUTHORITY_CONFLICT',
        false,
        'Authority checkpoint does not match the job fence.',
      );
    }
    if (
      input.expectedState === 'APPROVED' &&
      !['APPROVED', 'COMMITTED', 'PROJECTING', 'PUBLISHED'].includes(
        checkpoint.state,
      )
    ) {
      throw new IngestionPipelinePortError(
        'INGESTION_AUTHORITY_CONFLICT',
        false,
        'Approved job fence does not match the authority checkpoint chain.',
      );
    }
    if (
      checkpoint.state === 'COMMITTED' ||
      checkpoint.state === 'PROJECTING' ||
      checkpoint.state === 'PUBLISHED'
    ) {
      if (
        checkpoint.versionId === undefined ||
        !UUID.test(checkpoint.versionId)
      ) {
        throw new IngestionPipelinePortError(
          'INGESTION_AUTHORITY_CONFLICT',
          false,
          'Committed checkpoint is missing its version.',
        );
      }
      return Object.freeze({
        status: 'SUCCEEDED',
        result: Object.freeze({
          ingestionId: input.ingestionId,
          state: checkpoint.state,
          versionId: checkpoint.versionId,
        }),
      });
    }
    if (checkpoint.state === 'REVIEW_REQUIRED') {
      return Object.freeze({
        status: 'WAITING_REVIEW',
        result: Object.freeze({
          ingestionId: input.ingestionId,
          state: checkpoint.state,
        }),
      });
    }
    if (
      checkpoint.state === 'REJECTED' ||
      checkpoint.state === 'FAILED' ||
      checkpoint.state === 'CANCELLED'
    ) {
      throw safeFailure(
        'INGESTION_TERMINAL',
        false,
        'The ingestion is already terminal.',
      );
    }
    if (
      ![
        'L0_PUBLIC',
        'L1_INTERNAL',
        'L2_RESTRICTED',
        'L3_CONFIDENTIAL',
      ].includes(checkpoint.securityLevel) ||
      !Array.isArray(checkpoint.assets)
    ) {
      throw new IngestionPipelinePortError(
        'INGESTION_AUTHORITY_CONFLICT',
        false,
        'Authority assets are invalid.',
      );
    }
    let assets = validatedAuthorityAssets(checkpoint.assets);
    let state: PipelineIngestionState = checkpoint.state;
    let version = checkpoint.version;

    const advance = async (
      toState: PipelineIngestionState,
      step: string,
      stepInput: unknown,
      stepOutput: unknown,
      agentRun = false,
    ): Promise<void> => {
      const currentRank = PIPELINE_RANK[state];
      const targetRank = PIPELINE_RANK[toState];
      if (
        currentRank !== undefined &&
        targetRank !== undefined &&
        currentRank >= targetRank
      ) {
        return;
      }
      transitionIngestionState(state, toState);
      const result = await options.authority.transition({
        tenantId,
        projectId,
        ingestionId: input.ingestionId,
        expectedState: state,
        expectedVersion: version,
        toState,
        evidence: evidence(step, stepInput, stepOutput, agentRun),
        securityLevel,
        policyVersion,
      });
      if (result.state !== toState || result.version !== version + 1) {
        throw new IngestionPipelinePortError(
          'INGESTION_AUTHORITY_CONFLICT',
          false,
          'Authority transition conflict.',
        );
      }
      state = result.state;
      version = result.version;
    };

    const commitCheckpoint = async (
      frozen: FrozenIngestionCheckpoint,
    ): Promise<DataJobHandlerResult> => {
      if (!SHA256.test(frozen.reviewHash)) {
        throw new IngestionPipelinePortError(
          'INGESTION_AUTHORITY_CONFLICT',
          false,
          'Frozen checkpoint hash is invalid.',
        );
      }
      const frozenBase = {
        assetIds: frozen.assetIds,
        assetManifest: frozen.assetManifest,
        quality: frozen.quality,
        alignment: frozen.alignment,
      };
      if (canonicalPipelineHash(frozenBase) !== frozen.reviewHash) {
        throw new IngestionPipelinePortError(
          'INGESTION_AUTHORITY_CONFLICT',
          false,
          'Frozen checkpoint content does not match its review hash.',
        );
      }
      transitionIngestionState(state, 'COMMITTED');
      const committed = await options.authority.commit({
        tenantId,
        projectId,
        ingestionId: input.ingestionId,
        expectedState: 'APPROVED',
        expectedVersion: version,
        checkpoint: frozen,
        acceptanceStatus: 'PASSED',
        evidence: evidence(
          'authoritative-commit',
          { reviewHash: frozen.reviewHash },
          { assetManifest: frozen.assetManifest },
        ),
        securityLevel,
        policyVersion,
      });
      if (
        committed.state !== 'COMMITTED' ||
        committed.version !== version + 1 ||
        !UUID.test(committed.versionId)
      ) {
        throw new IngestionPipelinePortError(
          'INGESTION_AUTHORITY_CONFLICT',
          false,
          'Authority commit conflict.',
        );
      }
      return Object.freeze({
        status: 'SUCCEEDED',
        result: Object.freeze({
          ingestionId: input.ingestionId,
          state: committed.state,
          versionId: committed.versionId,
          qualityGrade: frozen.quality.grade,
        }),
      });
    };

    if (state === 'APPROVED') {
      if (checkpoint.frozenCheckpoint === undefined) {
        throw new IngestionPipelinePortError(
          'INGESTION_AUTHORITY_CONFLICT',
          false,
          'Approved ingestion is missing its frozen checkpoint.',
        );
      }
      return commitCheckpoint(checkpoint.frozenCheckpoint);
    }

    const quarantined: Array<{
      readonly assetId: string;
      readonly objectRef: string;
      readonly size: number;
      readonly mediaType: string;
      readonly sourceKind: 'document' | 'geojson';
    }> = [];
    for (const asset of assets) {
      const result = await options.quarantine.put({
        tenantId,
        projectId,
        ingestionId: input.ingestionId,
        asset,
      });
      const objectRef = boundedText(result.objectRef);
      if (
        objectRef !== asset.objectRef ||
        !Number.isSafeInteger(result.size) ||
        result.size !== asset.size
      ) {
        throw new IngestionPipelinePortError(
          'INVALID_PIPELINE_PORT_RESPONSE',
          false,
          'Invalid quarantine response.',
        );
      }
      quarantined.push({
        assetId: asset.assetId,
        objectRef,
        size: result.size,
        mediaType: asset.mediaType,
        sourceKind: asset.sourceKind,
      });
    }
    await advance('QUARANTINED', 'quarantine', input, quarantined);

    const scans: Array<{ readonly assetId: string; readonly clean: boolean }> =
      [];
    for (const asset of quarantined) {
      const scan = await options.scanner.scan({ objectRef: asset.objectRef });
      if (typeof scan.clean !== 'boolean') {
        throw new IngestionPipelinePortError(
          'INVALID_PIPELINE_PORT_RESPONSE',
          false,
          'Invalid scan response.',
        );
      }
      scans.push({ assetId: asset.assetId, ...scan });
    }
    await advance('SECURITY_SCANNED', 'security-scan', quarantined, scans);
    if (scans.some((scan) => !scan.clean)) {
      await advance('REJECTED', 'malware-rejection', scans, { rejected: true });
      throw safeFailure(
        'MALWARE_DETECTED',
        false,
        'The quarantined asset was rejected.',
      );
    }

    const fingerprints: Array<{
      readonly assetId: string;
      readonly fingerprint: string;
    }> = [];
    for (const asset of quarantined) {
      const fingerprint = sha256(
        await options.fingerprint.sha256({ objectRef: asset.objectRef }),
      );
      const authoritativeHash = assets[fingerprints.length]!.sourceHash;
      if (
        authoritativeHash !== undefined &&
        fingerprint !== authoritativeHash
      ) {
        throw new IngestionPipelinePortError(
          'OBJECT_INTEGRITY_MISMATCH',
          false,
          'Fingerprint does not match the authoritative asset hash.',
        );
      }
      fingerprints.push({
        assetId: asset.assetId,
        fingerprint,
      });
    }
    if ((PIPELINE_RANK[state] ?? -1) < PIPELINE_RANK.FINGERPRINTED!) {
      const persisted = await options.authority.recordFingerprints({
        tenantId,
        projectId,
        ingestionId: input.ingestionId,
        expectedState: 'SECURITY_SCANNED',
        expectedVersion: version,
        securityLevel,
        policyVersion,
        fingerprints: fingerprints.map((fingerprint, index) => ({
          assetId: fingerprint.assetId,
          ordinal: assets[index]!.ordinal,
          size: assets[index]!.size,
          mediaType: assets[index]!.mediaType,
          sourceHash: fingerprint.fingerprint,
        })),
        evidence: evidence('fingerprint', quarantined, fingerprints),
      });
      if (
        persisted.state !== 'FINGERPRINTED' ||
        persisted.version !== version + 1
      ) {
        throw new IngestionPipelinePortError(
          'INGESTION_AUTHORITY_CONFLICT',
          false,
          'Authority fingerprint checkpoint conflict.',
        );
      }
      state = persisted.state;
      version = persisted.version;
      assets = assets.map((asset, index) => ({
        ...asset,
        sourceHash: fingerprints[index]!.fingerprint,
      }));
    } else if (assets.some((asset) => asset.sourceHash === undefined)) {
      throw new IngestionPipelinePortError(
        'INGESTION_AUTHORITY_CONFLICT',
        false,
        'Fingerprint checkpoint is missing trusted content identities.',
      );
    }

    const parsedAssets: Array<{
      readonly assetId: string;
      readonly kind: 'document' | 'geojson';
      readonly contentHash: string;
      readonly metadata: Readonly<Record<string, unknown>>;
    }> = [];
    const profiles: Array<{
      readonly assetId: string;
      readonly profileHash: string;
    }> = [];
    for (const asset of quarantined) {
      const parsed = await options.parser.parse({
        objectRef: asset.objectRef,
        mediaType: asset.mediaType,
        sourceKind: asset.sourceKind,
      });
      if (
        !isRecord(parsed) ||
        parsed.kind !== asset.sourceKind ||
        !isRecord(parsed.metadata)
      ) {
        throw new IngestionPipelinePortError(
          'INVALID_PIPELINE_PORT_RESPONSE',
          false,
          'Invalid parser response.',
        );
      }
      if (
        sha256(parsed.contentHash) !== assets[parsedAssets.length]!.sourceHash
      ) {
        throw new IngestionPipelinePortError(
          'OBJECT_INTEGRITY_MISMATCH',
          false,
          'Parsed content does not match the authoritative asset hash.',
        );
      }
      parsedAssets.push({ assetId: asset.assetId, ...parsed });
      const profile = await options.profiler.profile(parsed);
      sha256(profile.profileHash);
      profiles.push({ assetId: asset.assetId, ...profile });
    }
    await advance('PROFILED', 'parse-profile', fingerprints, {
      parsedAssets,
      profiles,
    });

    const classifications: Array<{
      readonly assetId: string;
      readonly risk: 'LOW' | 'HIGH';
      readonly restricted: boolean;
      readonly confidence: number;
      readonly classificationHash: string;
    }> = [];
    for (const [index, parsed] of parsedAssets.entries()) {
      const classification = await options.classifier.classify({
        parsed,
        profile: profiles[index],
      });
      if (
        !['LOW', 'HIGH'].includes(classification.risk) ||
        typeof classification.restricted !== 'boolean' ||
        !Number.isFinite(classification.confidence) ||
        classification.confidence < 0 ||
        classification.confidence > 1
      ) {
        throw new IngestionPipelinePortError(
          'INVALID_PIPELINE_PORT_RESPONSE',
          false,
          'Invalid classification response.',
        );
      }
      sha256(classification.classificationHash);
      classifications.push({ assetId: parsed.assetId, ...classification });
    }
    await advance('CLASSIFIED', 'classify', profiles, classifications);

    const rawPlan = await options.aiPlanner.propose({
      parsedAssets,
      profiles,
      classifications,
    });
    let plan: ReturnType<IngestionPipelineOptions['aiValidator']['validate']>;
    try {
      plan = options.aiValidator.validate(rawPlan);
    } catch {
      throw safeFailure(
        'AI_PLAN_INVALID',
        false,
        'The AI mapping plan was rejected.',
      );
    }
    if (
      !isRecord(plan.schemaPlan) ||
      !isRecord(plan.semanticPlan) ||
      !Number.isFinite(plan.confidence) ||
      plan.confidence < 0 ||
      plan.confidence > 1 ||
      forbiddenAiDecision(rawPlan) ||
      forbiddenAiDecision(plan)
    ) {
      throw safeFailure(
        'AI_PLAN_INVALID',
        false,
        'The AI mapping plan was rejected.',
      );
    }
    await advance(
      'SCHEMA_MAPPED',
      'ai-schema-plan',
      classifications,
      plan.schemaPlan,
      true,
    );
    await advance(
      'SEMANTIC_MAPPED',
      'ai-semantic-plan',
      plan.schemaPlan,
      plan.semanticPlan,
      true,
    );

    const transformed = await options.transformer.transform({
      parsedAssets,
      profiles,
      plan,
    });
    const artifactRef = boundedText(transformed.artifactRef);
    sha256(transformed.outputHash);
    const checks = await options.quality.check({
      parsedAssets,
      profiles,
      transformed,
    });
    const quality = evaluateQualityGate({
      checks,
      minimumPassingScore: options.minimumQualityScore,
    });
    await advance('VALIDATED', 'transform-quality', plan, {
      transformed,
      quality,
    });
    if (!quality.passed) {
      await advance('REJECTED', 'quality-rejection', quality, {
        rejected: true,
      });
      throw safeFailure(
        'QUALITY_GATE_REJECTED',
        false,
        'The deterministic quality gate rejected the ingestion.',
      );
    }

    const alignment = validatedAlignment(
      await options.aligner.align({
        parsedAssets,
        transformed,
      }),
      assets,
    );
    await advance(
      'SPATIOTEMPORAL_ALIGNED',
      'spatiotemporal-align',
      transformed,
      alignment,
    );

    const assetManifest = Object.freeze({
      assets: quarantined.map((asset, index) => {
        const evidenceExcerpt = optionalEvidenceExcerpt(
          parsedAssets[index]!.metadata,
        );
        return {
          assetId: asset.assetId,
          ordinal: assets[index]!.ordinal,
          uploadId: assets[index]!.uploadId,
          quarantineObjectRef: asset.objectRef,
          sourceKind: asset.sourceKind,
          mediaType: asset.mediaType,
          size: asset.size,
          sourceHash: fingerprints[index]!.fingerprint,
          scanHash: canonicalPipelineHash(scans[index]),
          parserHash: parsedAssets[index]!.contentHash,
          profileHash: profiles[index]!.profileHash,
          classificationHash: classifications[index]!.classificationHash,
          ...(evidenceExcerpt === undefined ? {} : { evidenceExcerpt }),
        };
      }),
      transformedArtifactRef: artifactRef,
      transformedHash: transformed.outputHash,
      validatedPlan: Object.freeze({
        schemaPlan: plan.schemaPlan,
        semanticPlan: plan.semanticPlan,
        confidence: plan.confidence,
        planHash: canonicalPipelineHash(plan),
      }),
    });
    const frozenBase = {
      assetIds: assets.map((asset) => asset.assetId),
      assetManifest,
      quality,
      alignment,
    };
    const frozen: FrozenIngestionCheckpoint = Object.freeze({
      ...frozenBase,
      reviewHash: canonicalPipelineHash(frozenBase),
    });

    const reviewRequired =
      checkpoint.securityLevel !== 'L0_PUBLIC' ||
      classifications.some(
        (classification) =>
          classification.risk === 'HIGH' ||
          classification.restricted ||
          classification.confidence < options.minimumAiConfidence,
      ) ||
      plan.confidence < options.minimumAiConfidence;
    if (reviewRequired) {
      const review = await options.authority.freezeCheckpoint({
        tenantId,
        projectId,
        ingestionId: input.ingestionId,
        expectedState: 'SPATIOTEMPORAL_ALIGNED',
        expectedVersion: version,
        toState: 'REVIEW_REQUIRED',
        securityLevel,
        policyVersion,
        checkpoint: frozen,
        evidence: evidence(
          'review-gate',
          { classifications, plan },
          { reviewHash: frozen.reviewHash },
        ),
      });
      if (
        review.state !== 'REVIEW_REQUIRED' ||
        review.version !== version + 1 ||
        review.reviewHash !== frozen.reviewHash
      ) {
        throw new IngestionPipelinePortError(
          'INGESTION_AUTHORITY_CONFLICT',
          false,
          'Review checkpoint conflict.',
        );
      }
      return Object.freeze({
        status: 'WAITING_REVIEW',
        result: Object.freeze({
          ingestionId: input.ingestionId,
          state: 'REVIEW_REQUIRED',
          qualityGrade: quality.grade,
        }),
      });
    }

    const approval = await options.authority.freezeCheckpoint({
      tenantId,
      projectId,
      ingestionId: input.ingestionId,
      expectedState: 'SPATIOTEMPORAL_ALIGNED',
      expectedVersion: version,
      toState: 'APPROVED',
      securityLevel,
      policyVersion,
      checkpoint: frozen,
      evidence: evidence('automatic-approval', quality, {
        approved: true,
        reviewHash: frozen.reviewHash,
      }),
    });
    if (
      approval.state !== 'APPROVED' ||
      approval.version !== version + 1 ||
      approval.reviewHash !== frozen.reviewHash
    ) {
      throw new IngestionPipelinePortError(
        'INGESTION_AUTHORITY_CONFLICT',
        false,
        'Automatic approval checkpoint conflict.',
      );
    }
    state = approval.state;
    version = approval.version;
    return commitCheckpoint(frozen);
  };

  return async (job) => {
    try {
      return await run(job);
    } catch (error) {
      if (error instanceof DataJobHandlerError) throw error;
      if (error instanceof IngestionPipelinePortError) {
        throw safeFailure(error.category, error.retryable);
      }
      throw safeFailure('INGESTION_PIPELINE_TEMPORARY', true);
    }
  };
}
