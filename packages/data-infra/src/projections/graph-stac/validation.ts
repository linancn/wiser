import { createHash } from 'node:crypto';

import { GraphStacProjectionError } from './errors.js';
import type {
  GovernedProjectionInput,
  KnowledgeGraphProjectionInput,
  StacProjectionInput,
} from './types.js';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
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

function validTime(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= 64 &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(
      value,
    ) &&
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
    !UUID_PATTERN.test(input.tenantId) ||
    !UUID_PATTERN.test(input.projectId) ||
    !UUID_PATTERN.test(input.dataItemId) ||
    !UUID_PATTERN.test(input.versionId) ||
    !UUID_PATTERN.test(input.evidenceId) ||
    !SHA256_PATTERN.test(input.sourceHash) ||
    !SECURITY_LEVELS.has(input.securityLevel) ||
    !QUALITY_GRADES.has(input.qualityGrade) ||
    !ACCEPTANCE_STATUSES.has(input.acceptanceStatus) ||
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
  return candidate;
}

function finiteCoordinates(value: unknown, depth = 0): boolean {
  if (depth > 8 || !Array.isArray(value) || value.length === 0) return false;
  return value.every((entry) =>
    typeof entry === 'number'
      ? Number.isFinite(entry)
      : finiteCoordinates(entry, depth + 1),
  );
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
  if (value === null || typeof value !== 'object') {
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
    candidate.geometry === null ||
    typeof candidate.geometry !== 'object' ||
    !exactKeys(candidate.geometry, ['type', 'coordinates']) ||
    !new Set([
      'Point',
      'MultiPoint',
      'LineString',
      'MultiLineString',
      'Polygon',
      'MultiPolygon',
    ]).has(candidate.geometry.type) ||
    !finiteCoordinates(candidate.geometry.coordinates) ||
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
  return candidate;
}
