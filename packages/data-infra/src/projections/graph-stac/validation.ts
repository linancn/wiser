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

function validTime(value: string): boolean {
  return (
    value.length <= 64 &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(
      value,
    ) &&
    Number.isFinite(Date.parse(value))
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
  'confidence',
  'reviewStatus',
  'validFrom',
  'validTo',
  'systemFrom',
  'systemTo',
  'policyVersion',
] as const;

export function validateGraphInput(
  value: KnowledgeGraphProjectionInput,
): KnowledgeGraphProjectionInput {
  if (
    value === null ||
    typeof value !== 'object' ||
    !exactKeys(value, [
      ...governedKeys,
      'entityId',
      'entityType',
      'entityName',
    ]) ||
    !UUID_PATTERN.test(value.entityId) ||
    !/^[a-z][a-z0-9_]{0,63}$/.test(value.entityType) ||
    value.entityName.length === 0 ||
    value.entityName.length > 512 ||
    [...value.entityName].some((character) => {
      const code = character.charCodeAt(0);
      return code <= 31 || code === 127;
    })
  ) {
    throw projectionError();
  }
  validateGovernance(value);
  return value;
}

function finiteCoordinates(value: unknown, depth = 0): boolean {
  if (depth > 8 || !Array.isArray(value) || value.length === 0) return false;
  return value.every((entry) =>
    typeof entry === 'number'
      ? Number.isFinite(entry)
      : finiteCoordinates(entry, depth + 1),
  );
}

function validBbox(value: readonly number[]): boolean {
  if (
    (value.length !== 4 && value.length !== 6) ||
    !value.every(Number.isFinite)
  ) {
    return false;
  }
  const dimensions = value.length / 2;
  for (let index = 0; index < dimensions; index += 1) {
    const minimum = value[index];
    const maximum = value[index + dimensions];
    if (minimum === undefined || maximum === undefined || minimum > maximum) {
      return false;
    }
  }
  return true;
}

export function validateStacInput(
  value: StacProjectionInput,
): StacProjectionInput {
  if (
    value === null ||
    typeof value !== 'object' ||
    !exactKeys(value, [
      ...governedKeys,
      'geometry',
      'bbox',
      'assetMediaType',
      'assetSizeBytes',
    ]) ||
    value.geometry === null ||
    typeof value.geometry !== 'object' ||
    !exactKeys(value.geometry, ['type', 'coordinates']) ||
    !new Set([
      'Point',
      'MultiPoint',
      'LineString',
      'MultiLineString',
      'Polygon',
      'MultiPolygon',
    ]).has(value.geometry.type) ||
    !finiteCoordinates(value.geometry.coordinates) ||
    !validBbox(value.bbox) ||
    value.assetMediaType.length < 3 ||
    value.assetMediaType.length > 255 ||
    !/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(value.assetMediaType) ||
    !Number.isSafeInteger(value.assetSizeBytes) ||
    value.assetSizeBytes < 1
  ) {
    throw projectionError();
  }
  validateGovernance(value);
  return value;
}
