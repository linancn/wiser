export const DATA_FOUNDATION_ROUTES = Object.freeze([
  { path: '', key: 'overview' },
  { path: '/catalog', key: 'catalog' },
  { path: '/ingestions', key: 'ingestions' },
  { path: '/quality', key: 'quality' },
  { path: '/search', key: 'search' },
  { path: '/knowledge', key: 'knowledge' },
  { path: '/graph', key: 'graph' },
  { path: '/geo', key: 'geo' },
  { path: '/map', key: 'map' },
  { path: '/capabilities', key: 'capabilities' },
] as const);

export type DataFoundationRouteKey =
  (typeof DATA_FOUNDATION_ROUTES)[number]['key'];

export type UntrustedRouteValue = string | string[] | undefined;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SCOPE_PATTERN = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/;
const DATE_LIMIT = 128;

const PROCESSING_STAGES = [
  'RAW',
  'CLEANED',
  'STANDARDIZED',
  'INTERMEDIATE',
  'KNOWLEDGE',
  'METADATA_QUALITY',
] as const;
const SECURITY_LEVELS = [
  'L0_PUBLIC',
  'L1_INTERNAL',
  'L2_RESTRICTED',
  'L3_CONFIDENTIAL',
] as const;
const QUALITY_GRADES = ['A', 'B', 'C'] as const;
const ACCEPTANCE_STATUSES = [
  'PENDING',
  'PASSED',
  'CONDITIONALLY_PASSED',
  'CORRECTION_REQUIRED',
  'ARCHIVED_ONLY',
  'REJECTED',
] as const;
const PUBLICATION_STATUSES = [
  'UNPUBLISHED',
  'PUBLISHING',
  'PUBLISHED',
  'WITHDRAWN',
] as const;
const GENERATION_METHODS = [
  'OBSERVED',
  'DECLARED',
  'DERIVED_DETERMINISTIC',
  'DERIVED_AI_ASSISTED',
  'SYNTHETIC',
  'MODEL_OUTPUT',
] as const;
const UPDATE_MODES = ['APPEND', 'REPLACE', 'UPSERT', 'SNAPSHOT'] as const;
const INGESTION_STATES = [
  'RECEIVED',
  'QUARANTINED',
  'SECURITY_SCANNED',
  'FINGERPRINTED',
  'PROFILED',
  'CLASSIFIED',
  'SCHEMA_MAPPED',
  'SEMANTIC_MAPPED',
  'VALIDATED',
  'SPATIOTEMPORAL_ALIGNED',
  'REVIEW_REQUIRED',
  'APPROVED',
  'REJECTED',
  'COMMITTED',
  'PROJECTING',
  'PUBLISHED',
  'FAILED',
  'CANCELLED',
] as const;
const OPERATION_STATUSES = [
  'PENDING',
  'RUNNING',
  'WAITING_INPUT',
  'WAITING_REVIEW',
  'SUCCEEDED',
  'FAILED',
  'CANCELLED',
] as const;
const OPERATION_EVENT_TYPES = [
  'CREATED',
  'STARTED',
  'PROGRESS_REPORTED',
  'WAITING_INPUT',
  'WAITING_REVIEW',
  'SUCCEEDED',
  'FAILED',
  'CANCELLED',
] as const;
const PROJECTION_STATUSES = [
  'PENDING',
  'RUNNING',
  'SUCCEEDED',
  'FAILED',
] as const;
const GEOMETRY_TYPES = [
  'Point',
  'MultiPoint',
  'LineString',
  'MultiLineString',
  'Polygon',
  'MultiPolygon',
] as const;

type ProcessingStage = (typeof PROCESSING_STAGES)[number];
export type SecurityLevel = (typeof SECURITY_LEVELS)[number];
export type QualityGrade = (typeof QUALITY_GRADES)[number];
export type AcceptanceStatus = (typeof ACCEPTANCE_STATUSES)[number];
export type PublicationStatus = (typeof PUBLICATION_STATUSES)[number];
type GenerationMethod = (typeof GENERATION_METHODS)[number];
export type IngestionState = (typeof INGESTION_STATES)[number];
export type OperationStatus = (typeof OPERATION_STATUSES)[number];
export type ProjectionStatus = (typeof PROJECTION_STATUSES)[number];
export type GeometryType = (typeof GEOMETRY_TYPES)[number];

const REQUIRED_INGESTION_PREFIX = [
  'RECEIVED',
  'QUARANTINED',
  'SECURITY_SCANNED',
  'FINGERPRINTED',
  'PROFILED',
  'CLASSIFIED',
  'SCHEMA_MAPPED',
  'SEMANTIC_MAPPED',
  'VALIDATED',
  'SPATIOTEMPORAL_ALIGNED',
] as const satisfies readonly IngestionState[];

export function ingestionStepState(
  current: IngestionState,
  stage: IngestionState,
): 'complete' | 'current' | 'future' {
  if (current === stage) return 'current';
  if (['REJECTED', 'FAILED', 'CANCELLED'].includes(current)) return 'future';
  const prefixIndex = REQUIRED_INGESTION_PREFIX.indexOf(
    current as (typeof REQUIRED_INGESTION_PREFIX)[number],
  );
  const stagePrefixIndex = REQUIRED_INGESTION_PREFIX.indexOf(
    stage as (typeof REQUIRED_INGESTION_PREFIX)[number],
  );
  if (prefixIndex >= 0) {
    return stagePrefixIndex >= 0 && stagePrefixIndex < prefixIndex
      ? 'complete'
      : 'future';
  }
  if (stagePrefixIndex >= 0) return 'complete';
  const publicationPath = ['APPROVED', 'COMMITTED', 'PROJECTING', 'PUBLISHED'];
  const currentPublicationIndex = publicationPath.indexOf(current);
  const stagePublicationIndex = publicationPath.indexOf(stage);
  return currentPublicationIndex >= 0 &&
    stagePublicationIndex >= 0 &&
    stagePublicationIndex < currentPublicationIndex
    ? 'complete'
    : 'future';
}

export interface DataCatalogItemDto {
  readonly dataItemId: string;
  readonly name: string;
  readonly businessDomains: readonly string[];
  readonly processingStage: ProcessingStage;
  readonly ownerProjectId: string;
  readonly sourceOrganization: string;
  readonly authorizationScope: string;
  readonly generationMethod: GenerationMethod;
  readonly qualityGrade: QualityGrade;
  readonly acceptanceStatus: AcceptanceStatus;
  readonly publicationStatus: PublicationStatus;
  readonly securityLevel: SecurityLevel;
  readonly version: number;
  readonly updatedAt: string;
  readonly sourceCrs?: string;
  readonly canonicalCrs?: string;
  readonly spatialExtent?: {
    readonly bbox: readonly [number, number, number, number];
    readonly crs: string;
  };
  readonly temporalExtent?: {
    readonly start: string;
    readonly end: string;
  };
}

export interface DataCatalogPageDto {
  readonly items: readonly DataCatalogItemDto[];
  readonly nextCursor?: string;
}

export interface DataItemVersionDto {
  readonly dataItemId: string;
  readonly versionId: string;
  readonly version: number;
  readonly assetIds: readonly string[];
  readonly sourceHash: string;
  readonly processingStage: ProcessingStage;
  readonly generationMethod: GenerationMethod;
  readonly qualityGrade: QualityGrade;
  readonly acceptanceStatus: AcceptanceStatus;
  readonly publicationStatus: PublicationStatus;
  readonly securityLevel: SecurityLevel;
  readonly createdAt: string;
  readonly committedAt?: string;
  readonly publishedAt?: string;
}

export interface DataItemDetailDto {
  readonly item: DataCatalogItemDto;
  readonly selectedVersion?: DataItemVersionDto;
}

export interface DataItemVersionPageDto {
  readonly items: readonly DataItemVersionDto[];
  readonly nextCursor?: string;
}

export interface IngestionDto {
  readonly ingestionId: string;
  readonly projectId: string;
  readonly assetIds: readonly string[];
  readonly intendedUses: readonly string[];
  readonly requestedSecurityLevel: SecurityLevel;
  readonly state: IngestionState;
  readonly operationId?: string;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly qualityIssues?: readonly QualityIssueSummaryDto[];
  readonly agentRuns?: readonly AgentRunSummaryDto[];
  readonly projectionStatuses?: readonly ProjectionStatusSummaryDto[];
}

export interface QualityIssueSummaryDto {
  readonly issueId: string;
  readonly severity: string;
  readonly status: string;
  readonly fieldPath?: string;
  readonly message: string;
  readonly createdAt: string;
}

export interface AgentRunSummaryDto {
  readonly agentRunId: string;
  readonly agentKind: string;
  readonly provider: string;
  readonly model: string;
  readonly deterministic: boolean;
  readonly inputHash: string;
  readonly outputHash?: string;
  readonly status: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ProjectionStatusSummaryDto {
  readonly dataItemId: string;
  readonly versionId: string;
  readonly projectionKind: string;
  readonly status: ProjectionStatus;
  readonly attemptCount: number;
  readonly projectedAt?: string;
  readonly updatedAt: string;
}

export interface OperationDto {
  readonly operationId: string;
  readonly capabilityId: string;
  readonly status: OperationStatus;
  readonly progressPercent: number;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly error?: {
    readonly code: string;
    readonly retryable: boolean;
  };
}

export interface OperationEventDto {
  readonly eventId: string;
  readonly operationId: string;
  readonly sequence: number;
  readonly eventType: (typeof OPERATION_EVENT_TYPES)[number];
  readonly status: OperationStatus;
  readonly progressPercent: number;
  readonly occurredAt: string;
  readonly message?: string;
}

export interface SearchResultDto {
  readonly dataItemId: string;
  readonly versionId: string;
  readonly evidenceId: string;
  readonly source: string;
  readonly score: number;
  readonly qualityGrade: QualityGrade;
  readonly acceptanceStatus: AcceptanceStatus;
  readonly securityLevel: SecurityLevel;
  readonly generatedAt: string;
  readonly limitations: readonly string[];
  readonly excerpt?: string;
}

export interface SearchPageDto {
  readonly items: readonly SearchResultDto[];
  readonly nextCursor?: string;
}

export interface GraphResultDto {
  readonly nodes: readonly {
    readonly entityId: string;
    readonly label: string;
    readonly dataItemId: string;
    readonly versionId: string;
    readonly evidenceId: string;
    readonly securityLevel: SecurityLevel;
    readonly qualityGrade: QualityGrade;
    readonly confidence: number;
  }[];
  readonly edges: readonly {
    readonly edgeId: string;
    readonly fromEntityId: string;
    readonly toEntityId: string;
    readonly relationType: string;
    readonly evidenceId: string;
    readonly confidence: number;
  }[];
  readonly nextCursor?: string;
}

export interface GeoGeometryDto {
  readonly type: GeometryType;
  readonly coordinates: unknown;
  readonly crs: string;
}

export interface GeoFeatureDto {
  readonly featureId: string;
  readonly dataItemId: string;
  readonly versionId: string;
  readonly geometry: GeoGeometryDto;
}

export interface GeoQueryDto {
  readonly features: readonly GeoFeatureDto[];
  readonly nextCursor?: string;
}

export interface MapFeatureCollectionDto {
  readonly type: 'FeatureCollection';
  readonly features: readonly {
    readonly type: 'Feature';
    readonly id: string;
    readonly geometry: {
      readonly type: GeometryType;
      readonly coordinates: unknown;
    };
    readonly properties: {
      readonly dataItemId: string;
      readonly versionId: string;
    };
  }[];
}

export interface CapabilitySummaryDto {
  readonly id: string;
  readonly version: string;
  readonly kind: 'query' | 'command';
  readonly requiredScopes: readonly string[];
  readonly maxSecurityLevel: SecurityLevel;
  readonly executionMode: 'SYNCHRONOUS' | 'ASYNCHRONOUS';
  readonly timeout: number;
  readonly idempotent: boolean;
  readonly restMethod: string;
  readonly restPath: string;
}

export interface CapabilityRegistryDto {
  readonly registryVersion: string;
  readonly capabilities: readonly CapabilitySummaryDto[];
}

export interface DataHealthDto {
  readonly status: 'ready' | 'degraded';
  readonly database: boolean;
  readonly objectStore: boolean;
  readonly worker: boolean;
  readonly projections: 'rebuildable';
}

function fail(contract: string): never {
  throw new TypeError(`Invalid ${contract} response.`);
}

function object(value: unknown, contract: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail(contract);
  }
  return value as Record<string, unknown>;
}

function string(
  value: unknown,
  contract: string,
  minimum = 1,
  maximum = 8_192,
): string {
  if (
    typeof value !== 'string' ||
    value.length < minimum ||
    value.length > maximum
  ) {
    fail(contract);
  }
  return value;
}

function optionalString(
  value: unknown,
  contract: string,
  maximum = 8_192,
): string | undefined {
  return value === undefined ? undefined : string(value, contract, 1, maximum);
}

function uuid(value: unknown, contract: string): string {
  const candidate = string(value, contract, 36, 36);
  if (!UUID_PATTERN.test(candidate)) fail(contract);
  return candidate;
}

function sha256(value: unknown, contract: string): string {
  const candidate = string(value, contract, 64, 64);
  if (!/^[a-f0-9]{64}$/.test(candidate)) fail(contract);
  return candidate;
}

function boolean(value: unknown, contract: string): boolean {
  if (typeof value !== 'boolean') fail(contract);
  return value;
}

function date(value: unknown, contract: string): string {
  const candidate = string(value, contract, 1, DATE_LIMIT);
  if (!Number.isFinite(Date.parse(candidate))) fail(contract);
  return candidate;
}

function integer(
  value: unknown,
  contract: string,
  minimum = 0,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    fail(contract);
  }
  return value;
}

function finite(
  value: unknown,
  contract: string,
  minimum = -Number.MAX_VALUE,
  maximum = Number.MAX_VALUE,
): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < minimum ||
    value > maximum
  ) {
    fail(contract);
  }
  return value;
}

function oneOf<const Values extends readonly string[]>(
  value: unknown,
  values: Values,
  contract: string,
): Values[number] {
  const candidate = string(value, contract, 1, 128);
  if (!values.includes(candidate)) fail(contract);
  return candidate;
}

function strings(
  value: unknown,
  contract: string,
  maximum = 256,
): readonly string[] {
  if (!Array.isArray(value) || value.length > maximum) fail(contract);
  return value.map((item) => string(item, contract, 1, 2_048));
}

function uuids(
  value: unknown,
  contract: string,
  maximum = 10_000,
): readonly string[] {
  if (!Array.isArray(value) || value.length > maximum) fail(contract);
  return value.map((item) => uuid(item, contract));
}

function optionalCursor(value: unknown, contract: string): string | undefined {
  if (value === undefined) return undefined;
  const cursor = string(value, contract, 1, 2_048);
  if (!/^[A-Za-z0-9_-]+$/.test(cursor)) fail(contract);
  return cursor;
}

function optionalArray<Result>(
  value: unknown,
  contract: string,
  parser: (entry: unknown, contract: string) => Result,
): readonly Result[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 200) fail(contract);
  return value.map((entry) => parser(entry, contract));
}

function validateRequiredDataItemShape(
  row: Record<string, unknown>,
  contract: string,
): void {
  uuid(row.tenantId, contract);
  strings(row.sourceNatures, contract, 32);
  strings(row.sourceChannels, contract, 32);
  strings(row.intendedUses, contract, 64);
  strings(row.citationRequirements, contract, 32);
  if (!Array.isArray(row.unitDefinitions)) fail(contract);
  if (!Array.isArray(row.missingValueRules)) fail(contract);
  if (!Array.isArray(row.anomalyRules)) fail(contract);
  oneOf(row.updateMode, UPDATE_MODES, contract);
  date(row.createdAt, contract);
}

function parseSpatialExtent(
  value: unknown,
  contract: string,
): DataCatalogItemDto['spatialExtent'] {
  if (value === undefined) return undefined;
  const row = object(value, contract);
  if (!Array.isArray(row.bbox) || row.bbox.length !== 4) fail(contract);
  const bbox = row.bbox.map((coordinate) => finite(coordinate, contract));
  const [minimumX, minimumY, maximumX, maximumY] = bbox;
  if (
    minimumX === undefined ||
    minimumY === undefined ||
    maximumX === undefined ||
    maximumY === undefined ||
    minimumX > maximumX ||
    minimumY > maximumY
  ) {
    fail(contract);
  }
  return {
    bbox: [minimumX, minimumY, maximumX, maximumY],
    crs: string(row.crs, contract, 3, 128),
  };
}

function parseTemporalExtent(
  value: unknown,
  contract: string,
): DataCatalogItemDto['temporalExtent'] {
  if (value === undefined) return undefined;
  const row = object(value, contract);
  const start = date(row.start, contract);
  const end = date(row.end, contract);
  if (Date.parse(start) > Date.parse(end)) fail(contract);
  return { start, end };
}

function parseDataCatalogItem(
  value: unknown,
  contract = 'catalog',
): DataCatalogItemDto {
  const row = object(value, contract);
  validateRequiredDataItemShape(row, contract);
  const authorizationScope = string(row.authorizationScope, contract, 3, 128);
  if (!SCOPE_PATTERN.test(authorizationScope)) fail(contract);
  const sourceCrs = optionalString(row.sourceCrs, contract, 128);
  const canonicalCrs = optionalString(row.canonicalCrs, contract, 128);
  const spatialExtent = parseSpatialExtent(row.spatialExtent, contract);
  const temporalExtent = parseTemporalExtent(row.temporalExtent, contract);
  return {
    dataItemId: uuid(row.dataItemId, contract),
    name: string(row.name, contract, 1, 256),
    businessDomains: strings(row.businessDomains, contract, 64),
    processingStage: oneOf(row.processingStage, PROCESSING_STAGES, contract),
    ownerProjectId: uuid(row.ownerProjectId, contract),
    sourceOrganization: string(row.sourceOrganization, contract, 1, 256),
    authorizationScope,
    generationMethod: oneOf(row.generationMethod, GENERATION_METHODS, contract),
    qualityGrade: oneOf(row.qualityGrade, QUALITY_GRADES, contract),
    acceptanceStatus: oneOf(
      row.acceptanceStatus,
      ACCEPTANCE_STATUSES,
      contract,
    ),
    publicationStatus: oneOf(
      row.publicationStatus,
      PUBLICATION_STATUSES,
      contract,
    ),
    securityLevel: oneOf(row.securityLevel, SECURITY_LEVELS, contract),
    version: integer(row.version, contract, 1),
    updatedAt: date(row.updatedAt, contract),
    ...(sourceCrs === undefined ? {} : { sourceCrs }),
    ...(canonicalCrs === undefined ? {} : { canonicalCrs }),
    ...(spatialExtent === undefined ? {} : { spatialExtent }),
    ...(temporalExtent === undefined ? {} : { temporalExtent }),
  };
}

function parseVersion(
  value: unknown,
  contract = 'data item version',
): DataItemVersionDto {
  const row = object(value, contract);
  uuid(row.tenantId, contract);
  string(row.metadataHash, contract, 64, 64);
  const committedAt =
    row.committedAt === undefined ? undefined : date(row.committedAt, contract);
  const publishedAt =
    row.publishedAt === undefined ? undefined : date(row.publishedAt, contract);
  return {
    dataItemId: uuid(row.dataItemId, contract),
    versionId: uuid(row.versionId, contract),
    version: integer(row.version, contract, 1),
    assetIds: uuids(row.assetIds, contract),
    sourceHash: string(row.sourceHash, contract, 64, 64),
    processingStage: oneOf(row.processingStage, PROCESSING_STAGES, contract),
    generationMethod: oneOf(row.generationMethod, GENERATION_METHODS, contract),
    qualityGrade: oneOf(row.qualityGrade, QUALITY_GRADES, contract),
    acceptanceStatus: oneOf(
      row.acceptanceStatus,
      ACCEPTANCE_STATUSES,
      contract,
    ),
    publicationStatus: oneOf(
      row.publicationStatus,
      PUBLICATION_STATUSES,
      contract,
    ),
    securityLevel: oneOf(row.securityLevel, SECURITY_LEVELS, contract),
    createdAt: date(row.createdAt, contract),
    ...(committedAt === undefined ? {} : { committedAt }),
    ...(publishedAt === undefined ? {} : { publishedAt }),
  };
}

export function parseDataCatalogPage(value: unknown): DataCatalogPageDto {
  const contract = 'catalog';
  const row = object(value, contract);
  if (!Array.isArray(row.items) || row.items.length > 10_000) fail(contract);
  const nextCursor = optionalCursor(row.nextCursor, contract);
  return {
    items: row.items.map((item) => parseDataCatalogItem(item, contract)),
    ...(nextCursor === undefined ? {} : { nextCursor }),
  };
}

export function parseDataItemDetail(value: unknown): DataItemDetailDto {
  const contract = 'data item';
  const row = object(value, contract);
  const selectedVersion =
    row.selectedVersion === undefined
      ? undefined
      : parseVersion(row.selectedVersion, contract);
  return {
    item: parseDataCatalogItem(row.item, contract),
    ...(selectedVersion === undefined ? {} : { selectedVersion }),
  };
}

export function parseDataItemVersionPage(
  value: unknown,
): DataItemVersionPageDto {
  const contract = 'data item version page';
  const row = object(value, contract);
  if (!Array.isArray(row.items) || row.items.length > 10_000) fail(contract);
  const nextCursor = optionalCursor(row.nextCursor, contract);
  return {
    items: row.items.map((item) => parseVersion(item, contract)),
    ...(nextCursor === undefined ? {} : { nextCursor }),
  };
}

export function parseIngestion(value: unknown): IngestionDto {
  const contract = 'ingestion';
  const envelope = object(value, contract);
  const row = object(envelope.ingestion, contract);
  uuid(row.tenantId, contract);
  const operationId =
    row.operationId === undefined ? undefined : uuid(row.operationId, contract);
  const qualityIssues = optionalArray(
    envelope.qualityIssues,
    contract,
    parseQualityIssue,
  );
  const agentRuns = optionalArray(envelope.agentRuns, contract, parseAgentRun);
  const projectionStatuses = optionalArray(
    envelope.projectionStatuses,
    contract,
    parseProjectionStatus,
  );
  return {
    ingestionId: uuid(row.ingestionId, contract),
    projectId: uuid(row.projectId, contract),
    assetIds: uuids(row.assetIds, contract),
    intendedUses: strings(row.intendedUses, contract, 64),
    requestedSecurityLevel: oneOf(
      row.requestedSecurityLevel,
      SECURITY_LEVELS,
      contract,
    ),
    state: oneOf(row.state, INGESTION_STATES, contract),
    ...(operationId === undefined ? {} : { operationId }),
    version: integer(row.version, contract, 1),
    createdAt: date(row.createdAt, contract),
    updatedAt: date(row.updatedAt, contract),
    ...(qualityIssues === undefined ? {} : { qualityIssues }),
    ...(agentRuns === undefined ? {} : { agentRuns }),
    ...(projectionStatuses === undefined ? {} : { projectionStatuses }),
  };
}

function parseQualityIssue(
  value: unknown,
  contract: string,
): QualityIssueSummaryDto {
  const row = object(value, contract);
  const fieldPath = optionalString(row.fieldPath, contract, 512);
  return {
    issueId: uuid(row.issueId, contract),
    severity: string(row.severity, contract, 1, 64),
    status: string(row.status, contract, 1, 64),
    ...(fieldPath === undefined ? {} : { fieldPath }),
    message: string(row.message, contract, 1, 4_096),
    createdAt: date(row.createdAt, contract),
  };
}

function parseAgentRun(value: unknown, contract: string): AgentRunSummaryDto {
  const row = object(value, contract);
  const outputHash =
    row.outputHash === undefined ? undefined : sha256(row.outputHash, contract);
  return {
    agentRunId: uuid(row.agentRunId, contract),
    agentKind: string(row.agentKind, contract, 1, 128),
    provider: string(row.provider, contract, 1, 128),
    model: string(row.model, contract, 1, 256),
    deterministic: boolean(row.deterministic, contract),
    inputHash: sha256(row.inputHash, contract),
    ...(outputHash === undefined ? {} : { outputHash }),
    status: string(row.status, contract, 1, 64),
    createdAt: date(row.createdAt, contract),
    updatedAt: date(row.updatedAt, contract),
  };
}

function parseProjectionStatus(
  value: unknown,
  contract: string,
): ProjectionStatusSummaryDto {
  const row = object(value, contract);
  const projectedAt =
    row.projectedAt === undefined ? undefined : date(row.projectedAt, contract);
  return {
    dataItemId: uuid(row.dataItemId, contract),
    versionId: uuid(row.versionId, contract),
    projectionKind: string(row.projectionKind, contract, 1, 128),
    status: oneOf(row.status, PROJECTION_STATUSES, contract),
    attemptCount: integer(row.attemptCount, contract),
    ...(projectedAt === undefined ? {} : { projectedAt }),
    updatedAt: date(row.updatedAt, contract),
  };
}

export function parseOperation(value: unknown): OperationDto {
  const contract = 'operation';
  const row = object(value, contract);
  uuid(row.tenantId, contract);
  uuid(row.projectId, contract);
  string(row.resource, contract, 1, 256);
  const startedAt =
    row.startedAt === undefined ? undefined : date(row.startedAt, contract);
  const completedAt =
    row.completedAt === undefined ? undefined : date(row.completedAt, contract);
  let error: OperationDto['error'];
  if (row.error !== undefined) {
    const errorRow = object(row.error, contract);
    string(errorRow.message, contract, 1, 2_048);
    error = {
      code: string(errorRow.code, contract, 1, 128),
      retryable:
        typeof errorRow.retryable === 'boolean'
          ? errorRow.retryable
          : fail(contract),
    };
  }
  return {
    operationId: uuid(row.operationId, contract),
    capabilityId: string(row.capabilityId, contract, 3, 128),
    status: oneOf(row.status, OPERATION_STATUSES, contract),
    progressPercent: integer(row.progressPercent, contract, 0, 100),
    version: integer(row.version, contract, 1),
    createdAt: date(row.createdAt, contract),
    updatedAt: date(row.updatedAt, contract),
    ...(startedAt === undefined ? {} : { startedAt }),
    ...(completedAt === undefined ? {} : { completedAt }),
    ...(error === undefined ? {} : { error }),
  };
}

function parseOperationEvent(value: unknown): OperationEventDto {
  const contract = 'operation event';
  const row = object(value, contract);
  integer(row.operationVersion, contract, 1);
  const message = optionalString(row.message, contract, 2_048);
  return {
    eventId: uuid(row.eventId, contract),
    operationId: uuid(row.operationId, contract),
    sequence: integer(row.sequence, contract, 1),
    eventType: oneOf(row.eventType, OPERATION_EVENT_TYPES, contract),
    status: oneOf(row.status, OPERATION_STATUSES, contract),
    progressPercent: integer(row.progressPercent, contract, 0, 100),
    occurredAt: date(row.occurredAt, contract),
    ...(message === undefined ? {} : { message }),
  };
}

export function parseOperationEventStream(value: string): OperationEventDto[] {
  if (value.length > 1_048_576) fail('operation event stream');
  const events: OperationEventDto[] = [];
  for (const block of value.split(/\n\n+/)) {
    const data = block
      .split('\n')
      .find((line) => line.startsWith('data: '))
      ?.slice(6);
    if (data === undefined) continue;
    try {
      events.push(parseOperationEvent(JSON.parse(data) as unknown));
    } catch {
      fail('operation event stream');
    }
  }
  return events;
}

function parseSearchResult(value: unknown): SearchResultDto {
  const contract = 'search';
  const row = object(value, contract);
  const excerpt = optionalString(row.excerpt, contract, 8_192);
  return {
    dataItemId: uuid(row.dataItemId, contract),
    versionId: uuid(row.versionId, contract),
    evidenceId: uuid(row.evidenceId, contract),
    source: string(row.source, contract, 1, 128),
    score: finite(row.score, contract),
    qualityGrade: oneOf(row.qualityGrade, QUALITY_GRADES, contract),
    acceptanceStatus: oneOf(
      row.acceptanceStatus,
      ACCEPTANCE_STATUSES,
      contract,
    ),
    securityLevel: oneOf(row.securityLevel, SECURITY_LEVELS, contract),
    generatedAt: date(row.generatedAt, contract),
    limitations: strings(row.limitations, contract, 64),
    ...(excerpt === undefined ? {} : { excerpt }),
  };
}

export function parseSearchPage(value: unknown): SearchPageDto {
  const contract = 'search';
  const row = object(value, contract);
  if (!Array.isArray(row.items) || row.items.length > 10_000) fail(contract);
  const nextCursor = optionalCursor(row.nextCursor, contract);
  return {
    items: row.items.map(parseSearchResult),
    ...(nextCursor === undefined ? {} : { nextCursor }),
  };
}

export function parseGraphResult(value: unknown): GraphResultDto {
  const contract = 'graph';
  const row = object(value, contract);
  if (
    !Array.isArray(row.nodes) ||
    row.nodes.length > 10_000 ||
    !Array.isArray(row.edges) ||
    row.edges.length > 20_000
  ) {
    fail(contract);
  }
  const nextCursor = optionalCursor(row.nextCursor, contract);
  return {
    nodes: row.nodes.map((value) => {
      const node = object(value, contract);
      return {
        entityId: string(node.entityId, contract, 1, 256),
        label: string(node.label, contract, 1, 256),
        dataItemId: uuid(node.dataItemId, contract),
        versionId: uuid(node.versionId, contract),
        evidenceId: uuid(node.evidenceId, contract),
        securityLevel: oneOf(node.securityLevel, SECURITY_LEVELS, contract),
        qualityGrade: oneOf(node.qualityGrade, QUALITY_GRADES, contract),
        confidence: finite(node.confidence, contract, 0, 1),
      };
    }),
    edges: row.edges.map((value) => {
      const edge = object(value, contract);
      return {
        edgeId: string(edge.edgeId, contract, 1, 256),
        fromEntityId: string(edge.fromEntityId, contract, 1, 256),
        toEntityId: string(edge.toEntityId, contract, 1, 256),
        relationType: string(edge.relationType, contract, 1, 128),
        evidenceId: uuid(edge.evidenceId, contract),
        confidence: finite(edge.confidence, contract, 0, 1),
      };
    }),
    ...(nextCursor === undefined ? {} : { nextCursor }),
  };
}

function coordinateArray(value: unknown): readonly unknown[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 100_000) {
    fail('geo');
  }
  return value;
}

function coordinatePosition(value: unknown): readonly number[] {
  const coordinates = coordinateArray(value);
  if (
    coordinates.length < 2 ||
    coordinates.length > 4 ||
    !coordinates.every(
      (coordinate) =>
        typeof coordinate === 'number' && Number.isFinite(coordinate),
    )
  ) {
    fail('geo');
  }
  return coordinates.map((coordinate) => finite(coordinate, 'geo'));
}

function coordinatePositions(value: unknown): readonly (readonly number[])[] {
  return coordinateArray(value).map(coordinatePosition);
}

function coordinateRings(
  value: unknown,
): readonly (readonly (readonly number[])[])[] {
  return coordinateArray(value).map(coordinatePositions);
}

function coordinatePolygons(
  value: unknown,
): readonly (readonly (readonly (readonly number[])[])[])[] {
  return coordinateArray(value).map(coordinateRings);
}

function parseGeometry(value: unknown): GeoGeometryDto {
  const contract = 'geo';
  const row = object(value, contract);
  const type = oneOf(row.type, GEOMETRY_TYPES, contract);
  const coordinates = (() => {
    switch (type) {
      case 'Point':
        return coordinatePosition(row.coordinates);
      case 'MultiPoint':
      case 'LineString':
        return coordinatePositions(row.coordinates);
      case 'MultiLineString':
      case 'Polygon':
        return coordinateRings(row.coordinates);
      case 'MultiPolygon':
        return coordinatePolygons(row.coordinates);
    }
  })();
  return {
    type,
    coordinates,
    crs: string(row.crs, contract, 3, 128),
  };
}

export function parseGeoQuery(value: unknown): GeoQueryDto {
  const contract = 'geo';
  const row = object(value, contract);
  if (!Array.isArray(row.features) || row.features.length > 10_000) {
    fail(contract);
  }
  const nextCursor = optionalCursor(row.nextCursor, contract);
  return {
    features: row.features.map((value) => {
      const feature = object(value, contract);
      object(feature.properties, contract);
      return {
        featureId: string(feature.featureId, contract, 1, 256),
        dataItemId: uuid(feature.dataItemId, contract),
        versionId: uuid(feature.versionId, contract),
        geometry: parseGeometry(feature.geometry),
      };
    }),
    ...(nextCursor === undefined ? {} : { nextCursor }),
  };
}

export function toMapFeatureCollection(
  value: GeoQueryDto,
): MapFeatureCollectionDto {
  return {
    type: 'FeatureCollection',
    features: value.features.map((feature) => ({
      type: 'Feature',
      id: feature.featureId,
      geometry: {
        type: feature.geometry.type,
        coordinates: feature.geometry.coordinates,
      },
      properties: {
        dataItemId: feature.dataItemId,
        versionId: feature.versionId,
      },
    })),
  };
}

export function isMapDisplayableFeature(feature: GeoFeatureDto): boolean {
  if (!['EPSG:4326', 'EPSG:4490', 'OGC:CRS84'].includes(feature.geometry.crs)) {
    return false;
  }
  function positionsInRange(value: unknown): boolean {
    if (!Array.isArray(value) || value.length === 0) return false;
    const coordinates: readonly unknown[] = value;
    const longitude: unknown = coordinates[0];
    const latitude: unknown = coordinates[1];
    if (typeof longitude === 'number' && typeof latitude === 'number') {
      return (
        Number.isFinite(longitude) &&
        Number.isFinite(latitude) &&
        longitude >= -180 &&
        longitude <= 180 &&
        latitude >= -90 &&
        latitude <= 90
      );
    }
    return coordinates.every(positionsInRange);
  }
  return positionsInRange(feature.geometry.coordinates);
}

export function parseCapabilityRegistry(value: unknown): CapabilityRegistryDto {
  const contract = 'capability registry';
  const row = object(value, contract);
  if (!Array.isArray(row.capabilities) || row.capabilities.length > 256) {
    fail(contract);
  }
  return {
    registryVersion: string(row.registryVersion, contract, 1, 32),
    capabilities: row.capabilities.map((value) => {
      const capability = object(value, contract);
      const rest = object(capability.restMapping, contract);
      const requiredScopes = strings(capability.requiredScopes, contract, 32);
      if (!requiredScopes.every((scope) => SCOPE_PATTERN.test(scope))) {
        fail(contract);
      }
      return {
        id: string(capability.id, contract, 3, 128),
        version: string(capability.version, contract, 5, 32),
        kind: oneOf(capability.kind, ['query', 'command'] as const, contract),
        requiredScopes,
        maxSecurityLevel: oneOf(
          capability.maxSecurityLevel,
          SECURITY_LEVELS,
          contract,
        ),
        executionMode: oneOf(
          capability.executionMode,
          ['SYNCHRONOUS', 'ASYNCHRONOUS'] as const,
          contract,
        ),
        timeout: integer(capability.timeout, contract, 100, 900_000),
        idempotent:
          typeof capability.idempotent === 'boolean'
            ? capability.idempotent
            : fail(contract),
        restMethod: string(rest.method, contract, 3, 8),
        restPath: string(rest.path, contract, 1, 512),
      };
    }),
  };
}

export function parseDataHealth(value: unknown): DataHealthDto {
  const contract = 'health';
  const row = object(value, contract);
  const authority = object(row.authority, contract);
  if (
    typeof authority.database !== 'boolean' ||
    typeof authority.objectStore !== 'boolean' ||
    typeof row.worker !== 'boolean'
  ) {
    fail(contract);
  }
  return {
    status: oneOf(row.status, ['ready', 'degraded'] as const, contract),
    database: authority.database,
    objectStore: authority.objectStore,
    worker: row.worker,
    projections: oneOf(row.projections, ['rebuildable'] as const, contract),
  };
}

export function parseDataRouteUuid(value: UntrustedRouteValue): string | null {
  return typeof value === 'string' && UUID_PATTERN.test(value) ? value : null;
}

export function parseSearchQuery(value: UntrustedRouteValue): string | null {
  if (value === undefined) return '';
  if (typeof value !== 'string') return null;
  const query = value.trim();
  return query.length <= 2_048 ? query : null;
}

export function parseGraphEntity(value: UntrustedRouteValue): string | null {
  if (value === undefined) return '';
  if (typeof value !== 'string') return null;
  const entity = value.trim();
  const hasControlCharacter = Array.from(entity).some(
    (character) => (character.codePointAt(0) ?? 0) < 32,
  );
  return entity.length <= 256 && !hasControlCharacter ? entity : null;
}

export function parseGeoBbox(
  value: UntrustedRouteValue,
): readonly [number, number, number, number] | null | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length > 256) return null;
  const parts = value.split(',');
  if (parts.length !== 4) return null;
  const numbers = parts.map((part) => Number(part));
  const [minimumX, minimumY, maximumX, maximumY] = numbers;
  if (
    minimumX === undefined ||
    minimumY === undefined ||
    maximumX === undefined ||
    maximumY === undefined ||
    !numbers.every(Number.isFinite) ||
    minimumX < -180 ||
    maximumX > 180 ||
    minimumY < -90 ||
    maximumY > 90 ||
    minimumX >= maximumX ||
    minimumY >= maximumY
  ) {
    return null;
  }
  return [minimumX, minimumY, maximumX, maximumY];
}

export function bboxGeometry(
  bbox: readonly [number, number, number, number],
): GeoGeometryDto {
  const [minimumX, minimumY, maximumX, maximumY] = bbox;
  return {
    type: 'Polygon',
    coordinates: [
      [
        [minimumX, minimumY],
        [maximumX, minimumY],
        [maximumX, maximumY],
        [minimumX, maximumY],
        [minimumX, minimumY],
      ],
    ],
    crs: 'EPSG:4326',
  };
}
