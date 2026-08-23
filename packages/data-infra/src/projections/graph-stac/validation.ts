import { createHash } from 'node:crypto';

import { GraphStacProjectionError } from './errors.js';
import type {
  GovernedProjectionInput,
  KnowledgeGraphProjectionInput,
  StacProjectionInput,
} from './types.js';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const OFFSET_TIMESTAMP_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/;
const SECURITY_LEVELS = new Set([
  'L0_PUBLIC',
  'L1_INTERNAL',
  'L2_RESTRICTED',
  'L3_CONFIDENTIAL',
]);
const REVIEW_STATUSES = new Set(['PENDING', 'APPROVED', 'REJECTED']);
const QUALITY_GRADES = new Set(['A', 'B', 'C']);
const ACCEPTANCE_STATUSES = new Set([
  'PENDING',
  'PASSED',
  'CONDITIONALLY_PASSED',
  'CORRECTION_REQUIRED',
  'ARCHIVED_ONLY',
  'REJECTED',
]);
const PUBLICATION_STATUSES = new Set([
  'UNPUBLISHED',
  'PUBLISHING',
  'PUBLISHED',
  'WITHDRAWN',
]);
const CHANNELS = new Set([
  'catalog',
  'fulltext',
  'semantic',
  'graph',
  'geo',
  'stac',
]);
const DATA_KEY = /^[a-z][a-z0-9-]*(?:[.:][a-z0-9][a-z0-9_-]*)*$/;

export function projectionError(): GraphStacProjectionError {
  return new GraphStacProjectionError('INVALID_PROJECTION_INPUT');
}

export function deterministicId(
  namespace: string,
  values: readonly string[],
): string {
  const hash = createHash('sha256');
  hash.update(namespace, 'utf8');
  for (const value of values) hash.update('\0', 'utf8').update(value, 'utf8');
  return hash.digest('hex');
}

export function rootHttpUrl(
  value: string,
  code: 'INVALID_GRAPH_CONFIGURATION' | 'INVALID_STAC_CONFIGURATION',
): string {
  try {
    const url = new URL(value);
    if (
      (url.protocol !== 'http:' && url.protocol !== 'https:') ||
      url.username.length > 0 ||
      url.password.length > 0 ||
      url.search.length > 0 ||
      url.hash.length > 0 ||
      (url.pathname !== '' && url.pathname !== '/')
    ) {
      throw new GraphStacProjectionError(code);
    }
    return url.origin;
  } catch (error) {
    if (error instanceof GraphStacProjectionError) throw error;
    throw new GraphStacProjectionError(code);
  }
}

function exactKeys(value: object, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  const sorted = [...expected].sort();
  return (
    keys.length === sorted.length && keys.every((key, i) => key === sorted[i])
  );
}

function leapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function maximumDay(year: number, month: number): number {
  if (month === 2) return leapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function validTime(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 64) return false;
  const match = OFFSET_TIMESTAMP_PATTERN.exec(value);
  if (match === null) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offset = match[8];
  const offsetHour = offset === 'Z' ? 0 : Number(offset?.slice(1, 3));
  const offsetMinute = offset === 'Z' ? 0 : Number(offset?.slice(4, 6));
  return (
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= maximumDay(year, month) &&
    hour <= 23 &&
    minute <= 59 &&
    second <= 59 &&
    offsetHour <= 23 &&
    offsetMinute <= 59 &&
    Number.isFinite(Date.parse(value))
  );
}

function validStringArray(
  value: unknown,
  maximum: number,
  predicate: (entry: string) => boolean,
): boolean {
  return (
    Array.isArray(value) &&
    value.length <= maximum &&
    value.every(
      (entry) =>
        typeof entry === 'string' &&
        entry.length > 0 &&
        entry.length <= 2_048 &&
        predicate(entry),
    )
  );
}

function validateGovernance(input: GovernedProjectionInput): void {
  if (
    typeof input.tenantId !== 'string' ||
    !UUID_PATTERN.test(input.tenantId) ||
    typeof input.projectId !== 'string' ||
    !UUID_PATTERN.test(input.projectId) ||
    typeof input.dataItemId !== 'string' ||
    !UUID_PATTERN.test(input.dataItemId) ||
    typeof input.versionId !== 'string' ||
    !UUID_PATTERN.test(input.versionId) ||
    typeof input.evidenceId !== 'string' ||
    !UUID_PATTERN.test(input.evidenceId) ||
    typeof input.sourceHash !== 'string' ||
    !SHA256_PATTERN.test(input.sourceHash) ||
    typeof input.securityLevel !== 'string' ||
    !SECURITY_LEVELS.has(input.securityLevel) ||
    typeof input.qualityGrade !== 'string' ||
    !QUALITY_GRADES.has(input.qualityGrade) ||
    typeof input.acceptanceStatus !== 'string' ||
    !ACCEPTANCE_STATUSES.has(input.acceptanceStatus) ||
    typeof input.publicationStatus !== 'string' ||
    !PUBLICATION_STATUSES.has(input.publicationStatus) ||
    !validStringArray(input.businessDomains, 64, (entry) =>
      DATA_KEY.test(entry),
    ) ||
    !validStringArray(input.channels, 6, (entry) => CHANNELS.has(entry)) ||
    !validStringArray(
      input.limitations,
      64,
      (entry) =>
        ![...entry].some((character) => {
          const code = character.charCodeAt(0);
          return code <= 31 || code === 127;
        }),
    ) ||
    !Number.isFinite(input.confidence) ||
    input.confidence < 0 ||
    input.confidence > 1 ||
    !REVIEW_STATUSES.has(input.reviewStatus) ||
    !validTime(input.validFrom) ||
    !validTime(input.validTo) ||
    Date.parse(input.validTo) < Date.parse(input.validFrom) ||
    !validTime(input.systemFrom) ||
    (input.systemTo !== null &&
      (!validTime(input.systemTo) ||
        Date.parse(input.systemTo) < Date.parse(input.systemFrom))) ||
    !Number.isSafeInteger(input.policyVersion) ||
    input.policyVersion < 1
  ) {
    throw projectionError();
  }
}

function governanceSnapshot(
  input: GovernedProjectionInput,
): GovernedProjectionInput {
  return Object.freeze({
    tenantId: input.tenantId,
    projectId: input.projectId,
    dataItemId: input.dataItemId,
    versionId: input.versionId,
    evidenceId: input.evidenceId,
    sourceHash: input.sourceHash,
    securityLevel: input.securityLevel,
    qualityGrade: input.qualityGrade,
    acceptanceStatus: input.acceptanceStatus,
    publicationStatus: input.publicationStatus,
    businessDomains: Object.freeze([...input.businessDomains]),
    channels: Object.freeze([...input.channels]),
    limitations: Object.freeze([...input.limitations]),
    confidence: input.confidence,
    reviewStatus: input.reviewStatus,
    validFrom: input.validFrom,
    validTo: input.validTo,
    systemFrom: input.systemFrom,
    systemTo: input.systemTo,
    policyVersion: input.policyVersion,
  });
}

const governedKeys = [
  'tenantId',
  'projectId',
  'dataItemId',
  'versionId',
  'evidenceId',
  'sourceHash',
  'securityLevel',
  'qualityGrade',
  'acceptanceStatus',
  'publicationStatus',
  'businessDomains',
  'channels',
  'limitations',
  'confidence',
  'reviewStatus',
  'validFrom',
  'validTo',
  'systemFrom',
  'systemTo',
  'policyVersion',
] as const;

export function validateGraphInput(
  value: unknown,
): KnowledgeGraphProjectionInput {
  if (value === null || typeof value !== 'object') {
    throw projectionError();
  }
  const candidate = value as KnowledgeGraphProjectionInput;
  if (
    !exactKeys(value, [
      ...governedKeys,
      'entityId',
      'entityType',
      'entityName',
    ]) ||
    typeof candidate.entityId !== 'string' ||
    typeof candidate.entityType !== 'string' ||
    typeof candidate.entityName !== 'string' ||
    !UUID_PATTERN.test(candidate.entityId) ||
    !/^[a-z][a-z0-9_]{0,63}$/.test(candidate.entityType) ||
    candidate.entityName.length === 0 ||
    candidate.entityName.length > 512 ||
    [...candidate.entityName].some((character) => {
      const code = character.charCodeAt(0);
      return code <= 31 || code === 127;
    })
  ) {
    throw projectionError();
  }
  validateGovernance(candidate);
  return Object.freeze({
    ...governanceSnapshot(candidate),
    entityId: candidate.entityId,
    entityType: candidate.entityType,
    entityName: candidate.entityName,
  });
}

interface CoordinateState {
  count: number;
  dimensions: 2 | 3 | undefined;
}

function position(value: unknown, state: CoordinateState): readonly number[] {
  if (!Array.isArray(value) || (value.length !== 2 && value.length !== 3)) {
    throw projectionError();
  }
  if (state.dimensions !== undefined && state.dimensions !== value.length) {
    throw projectionError();
  }
  const ordinates: number[] = [];
  for (const ordinate of value as readonly unknown[]) {
    if (typeof ordinate !== 'number' || !Number.isFinite(ordinate)) {
      throw projectionError();
    }
    ordinates.push(ordinate);
  }
  state.dimensions = value.length;
  state.count += 1;
  if (state.count > 100_000) throw projectionError();
  return Object.freeze(ordinates);
}

function positions(
  value: unknown,
  minimum: number,
  state: CoordinateState,
): readonly (readonly number[])[] {
  if (!Array.isArray(value) || value.length < minimum) {
    throw projectionError();
  }
  return Object.freeze(value.map((entry) => position(entry, state)));
}

function ring(
  value: unknown,
  state: CoordinateState,
): readonly (readonly number[])[] {
  const result = positions(value, 4, state);
  const first = result[0];
  const last = result.at(-1);
  if (
    first === undefined ||
    last === undefined ||
    first.length !== last.length ||
    first.some((ordinate, index) => ordinate !== last[index]) ||
    new Set(result.slice(0, -1).map((entry) => entry.join(','))).size < 3
  ) {
    throw projectionError();
  }
  return result;
}

function geometry(value: unknown): {
  readonly value: StacProjectionInput['geometry'];
  readonly dimensions: 2 | 3;
} {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw projectionError();
  }
  const candidate = value as Record<string, unknown>;
  if (!exactKeys(candidate, ['type', 'coordinates'])) {
    throw projectionError();
  }
  const state: CoordinateState = { count: 0, dimensions: undefined };
  let coordinates: unknown;
  switch (candidate.type) {
    case 'Point':
      coordinates = position(candidate.coordinates, state);
      break;
    case 'MultiPoint':
      coordinates = positions(candidate.coordinates, 1, state);
      break;
    case 'LineString':
      coordinates = positions(candidate.coordinates, 2, state);
      break;
    case 'MultiLineString':
      if (
        !Array.isArray(candidate.coordinates) ||
        candidate.coordinates.length < 1
      ) {
        throw projectionError();
      }
      coordinates = Object.freeze(
        candidate.coordinates.map((line) => positions(line, 2, state)),
      );
      break;
    case 'Polygon':
      if (
        !Array.isArray(candidate.coordinates) ||
        candidate.coordinates.length < 1
      ) {
        throw projectionError();
      }
      coordinates = Object.freeze(
        candidate.coordinates.map((candidateRing) =>
          ring(candidateRing, state),
        ),
      );
      break;
    case 'MultiPolygon':
      if (
        !Array.isArray(candidate.coordinates) ||
        candidate.coordinates.length < 1
      ) {
        throw projectionError();
      }
      coordinates = Object.freeze(
        candidate.coordinates.map((polygon) => {
          if (!Array.isArray(polygon) || polygon.length < 1) {
            throw projectionError();
          }
          return Object.freeze(
            polygon.map((candidateRing) => ring(candidateRing, state)),
          );
        }),
      );
      break;
    default:
      throw projectionError();
  }
  if (state.dimensions === undefined) throw projectionError();
  return Object.freeze({
    value: Object.freeze({
      type: candidate.type,
      coordinates,
    }),
    dimensions: state.dimensions,
  });
}

function validBbox(value: unknown): value is readonly number[] {
  if (!Array.isArray(value) || (value.length !== 4 && value.length !== 6)) {
    return false;
  }
  const numbers: readonly unknown[] = value;
  if (
    !numbers.every(
      (entry): entry is number =>
        typeof entry === 'number' && Number.isFinite(entry),
    )
  ) {
    return false;
  }
  const dimensions = numbers.length / 2;
  for (let index = 0; index < dimensions; index += 1) {
    const minimum = numbers[index];
    const maximum = numbers[index + dimensions];
    if (minimum === undefined || maximum === undefined || minimum > maximum) {
      return false;
    }
  }
  return true;
}

export function validateStacInput(value: unknown): StacProjectionInput {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw projectionError();
  }
  const candidate = value as StacProjectionInput;
  if (
    !exactKeys(value, [
      ...governedKeys,
      'geometry',
      'bbox',
      'title',
      'description',
      'assetMediaType',
      'assetSizeBytes',
    ]) ||
    !validBbox(candidate.bbox) ||
    typeof candidate.title !== 'string' ||
    candidate.title.length < 1 ||
    candidate.title.length > 512 ||
    typeof candidate.description !== 'string' ||
    candidate.description.length < 1 ||
    candidate.description.length > 4_096 ||
    [...candidate.title, ...candidate.description].some((character) => {
      const code = character.charCodeAt(0);
      return code <= 31 || code === 127;
    }) ||
    typeof candidate.assetMediaType !== 'string' ||
    candidate.assetMediaType.length < 3 ||
    candidate.assetMediaType.length > 255 ||
    !/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(
      candidate.assetMediaType,
    ) ||
    !Number.isSafeInteger(candidate.assetSizeBytes) ||
    candidate.assetSizeBytes < 1
  ) {
    throw projectionError();
  }
  validateGovernance(candidate);
  const validatedGeometry = geometry(candidate.geometry);
  if (candidate.bbox.length !== validatedGeometry.dimensions * 2) {
    throw projectionError();
  }
  return Object.freeze({
    ...governanceSnapshot(candidate),
    geometry: validatedGeometry.value,
    bbox: Object.freeze([...candidate.bbox]),
    title: candidate.title,
    description: candidate.description,
    assetMediaType: candidate.assetMediaType,
    assetSizeBytes: candidate.assetSizeBytes,
  });
}
