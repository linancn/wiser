import { SpatialProjectionError } from './errors.js';
import type {
  GeoJsonPosition,
  SpatialProjectionInput,
  SupportedGeoJsonGeometry,
} from './types.js';

const INPUT_KEYS = Object.freeze([
  'dataItemId',
  'policyVersion',
  'projectId',
  'securityLevel',
  'sourceCrs',
  'sourceGeoJson',
  'tenantId',
  'versionId',
]);
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CRS = /^EPSG:([1-9]\d{0,5})$/;
const SECURITY_LEVELS = new Set([
  'L0_PUBLIC',
  'L1_INTERNAL',
  'L2_RESTRICTED',
  'L3_CONFIDENTIAL',
]);

function invalid(message: string): never {
  throw new SpatialProjectionError('INVALID_SPATIAL_PROJECTION_INPUT', message);
}

function object(value: unknown, field: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    invalid(`${field} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  candidate: Readonly<Record<string, unknown>>,
  expected: readonly string[],
  field: string,
): void {
  const actual = Object.keys(candidate).sort();
  const sortedExpected = [...expected].sort();
  if (
    actual.length !== sortedExpected.length ||
    actual.some((key, index) => key !== sortedExpected[index])
  ) {
    invalid(`${field} contains missing or unknown fields.`);
  }
}

function uuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !UUID.test(value)) {
    invalid(`${field} must be a UUID.`);
  }
  return value;
}

function position(value: unknown, counter: { count: number }): GeoJsonPosition {
  if (!Array.isArray(value) || (value.length !== 2 && value.length !== 3)) {
    invalid('GeoJSON position must contain two or three ordinates.');
  }
  const ordinates: number[] = [];
  for (const ordinate of value as unknown[]) {
    if (typeof ordinate !== 'number' || !Number.isFinite(ordinate)) {
      invalid('GeoJSON ordinates must be finite numbers.');
    }
    ordinates.push(ordinate);
  }
  counter.count += 1;
  if (counter.count > 100_000) invalid('GeoJSON geometry is too large.');
  return ordinates as unknown as GeoJsonPosition;
}

function positions(
  value: unknown,
  minimum: number,
  counter: { count: number },
): readonly GeoJsonPosition[] {
  if (!Array.isArray(value) || value.length < minimum) {
    invalid('GeoJSON coordinate sequence is invalid.');
  }
  return value.map((item) => position(item, counter));
}

function ring(
  value: unknown,
  counter: { count: number },
): readonly GeoJsonPosition[] {
  const result = positions(value, 4, counter);
  const first = result[0]!;
  const last = result.at(-1)!;
  if (
    first.length !== last.length ||
    first.some((ordinate, index) => ordinate !== last[index])
  ) {
    invalid('GeoJSON polygon rings must be closed.');
  }
  return result;
}

function geometry(value: unknown): SupportedGeoJsonGeometry {
  const candidate = object(value, 'sourceGeoJson');
  exactKeys(candidate, ['type', 'coordinates'], 'sourceGeoJson');
  const counter = { count: 0 };
  switch (candidate.type) {
    case 'Point':
      return {
        type: 'Point',
        coordinates: position(candidate.coordinates, counter),
      };
    case 'MultiPoint':
      return {
        type: 'MultiPoint',
        coordinates: positions(candidate.coordinates, 1, counter),
      };
    case 'LineString':
      return {
        type: 'LineString',
        coordinates: positions(candidate.coordinates, 2, counter),
      };
    case 'MultiLineString': {
      if (
        !Array.isArray(candidate.coordinates) ||
        candidate.coordinates.length < 1
      ) {
        invalid('GeoJSON MultiLineString is invalid.');
      }
      return {
        type: 'MultiLineString',
        coordinates: candidate.coordinates.map((line) =>
          positions(line, 2, counter),
        ),
      };
    }
    case 'Polygon': {
      if (
        !Array.isArray(candidate.coordinates) ||
        candidate.coordinates.length < 1
      ) {
        invalid('GeoJSON Polygon is invalid.');
      }
      return {
        type: 'Polygon',
        coordinates: candidate.coordinates.map((candidateRing) =>
          ring(candidateRing, counter),
        ),
      };
    }
    case 'MultiPolygon': {
      if (
        !Array.isArray(candidate.coordinates) ||
        candidate.coordinates.length < 1
      ) {
        invalid('GeoJSON MultiPolygon is invalid.');
      }
      return {
        type: 'MultiPolygon',
        coordinates: candidate.coordinates.map((polygon) => {
          if (!Array.isArray(polygon) || polygon.length < 1) {
            invalid('GeoJSON MultiPolygon polygon is invalid.');
          }
          return polygon.map((candidateRing) => ring(candidateRing, counter));
        }),
      };
    }
    default:
      invalid('sourceGeoJson type is unsupported.');
  }
}

export interface ValidatedSpatialProjectionInput extends SpatialProjectionInput {
  readonly sourceSrid: number;
}

export function validateSpatialProjectionInput(
  value: unknown,
): ValidatedSpatialProjectionInput {
  const candidate = object(value, 'Spatial projection input');
  exactKeys(candidate, INPUT_KEYS, 'Spatial projection input');
  if (
    typeof candidate.policyVersion !== 'number' ||
    !Number.isSafeInteger(candidate.policyVersion) ||
    candidate.policyVersion < 1
  ) {
    invalid('policyVersion must be a positive integer.');
  }
  if (
    typeof candidate.securityLevel !== 'string' ||
    !SECURITY_LEVELS.has(candidate.securityLevel)
  ) {
    invalid('securityLevel is invalid.');
  }
  if (typeof candidate.sourceCrs !== 'string') {
    invalid('sourceCrs is invalid.');
  }
  const crsMatch = CRS.exec(candidate.sourceCrs);
  if (crsMatch?.[1] === undefined) invalid('sourceCrs is invalid.');
  const sourceSrid = Number(crsMatch[1]);

  return Object.freeze({
    tenantId: uuid(candidate.tenantId, 'tenantId'),
    projectId: uuid(candidate.projectId, 'projectId'),
    dataItemId: uuid(candidate.dataItemId, 'dataItemId'),
    versionId: uuid(candidate.versionId, 'versionId'),
    sourceGeoJson: geometry(candidate.sourceGeoJson),
    sourceCrs: candidate.sourceCrs,
    sourceSrid,
    securityLevel:
      candidate.securityLevel as SpatialProjectionInput['securityLevel'],
    policyVersion: candidate.policyVersion,
  });
}
