import { createHash } from 'node:crypto';

import type { S3AuthorityObjectReader } from '@wiser/data-infra';

import type { DataWorkerRuntimeConfig } from '../config.js';
import {
  ClamAvInstreamScanner,
  FixtureFakeAiPlanner,
  FixtureFakeAiPlanValidator,
  TikaIngestionParser,
} from '../adapters/ingestion-runtime.js';
import {
  IngestionPipelinePortError,
  canonicalPipelineHash,
  type IngestionAuthorityPort,
  type IngestionPipelineOptions,
  type PipelineSpatialFact,
} from '../handlers/ingestion-pipeline.js';

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SUPPORTED_GEOMETRY = new Set([
  'Point',
  'MultiPoint',
  'LineString',
  'MultiLineString',
  'Polygon',
  'MultiPolygon',
]);

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function portError(
  category: string,
  retryable = true,
): IngestionPipelinePortError {
  return new IngestionPipelinePortError(
    category,
    retryable,
    'The default ingestion dependency failed safely.',
  );
}

function uploadIdFromObjectRef(
  objectRef: string,
  tenantId: string,
  projectId: string,
): string {
  const prefix = `tenants/${tenantId}/projects/${projectId}/quarantine/`;
  if (!objectRef.startsWith(prefix) || !objectRef.endsWith('/object')) {
    throw portError('INVALID_AUTHORITY_OBJECT_REFERENCE', false);
  }
  const uploadId = objectRef.slice(prefix.length, -'/object'.length);
  if (!UUID.test(uploadId) || uploadId.includes('/')) {
    throw portError('INVALID_AUTHORITY_OBJECT_REFERENCE', false);
  }
  return uploadId;
}

function geometryFromMetadata(
  metadata: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> | undefined {
  const source = metadata['sourceGeoJson'];
  if (!isRecord(source)) return undefined;
  if (SUPPORTED_GEOMETRY.has(String(source.type))) return source;
  if (source.type === 'Feature' && isRecord(source.geometry)) {
    return SUPPORTED_GEOMETRY.has(String(source.geometry.type))
      ? source.geometry
      : collapseGeometryCollection([source.geometry]);
  }
  if (source.type === 'FeatureCollection' && Array.isArray(source.features)) {
    const geometries: Readonly<Record<string, unknown>>[] = [];
    for (const feature of source.features as unknown[]) {
      if (!isRecord(feature) || !isRecord(feature.geometry)) return undefined;
      geometries.push(feature.geometry);
    }
    return collapseGeometryCollection(geometries);
  }
  if (
    source.type === 'GeometryCollection' &&
    Array.isArray(source.geometries)
  ) {
    const geometries = (source.geometries as unknown[]).filter(isRecord);
    if (geometries.length !== source.geometries.length) return undefined;
    return collapseGeometryCollection(geometries);
  }
  return undefined;
}

function collapseGeometryCollection(
  geometries: readonly Readonly<Record<string, unknown>>[],
): Readonly<Record<string, unknown>> | undefined {
  const points: unknown[] = [];
  const lines: unknown[] = [];
  const polygons: unknown[] = [];
  const collect = (
    geometry: Readonly<Record<string, unknown>>,
    depth: number,
  ): boolean => {
    if (depth > 8) return false;
    const coordinates = geometry['coordinates'];
    switch (geometry['type']) {
      case 'Point':
        points.push(coordinates);
        return true;
      case 'MultiPoint':
        if (!Array.isArray(coordinates)) return false;
        for (const point of coordinates as unknown[]) points.push(point);
        return true;
      case 'LineString':
        lines.push(coordinates);
        return true;
      case 'MultiLineString':
        if (!Array.isArray(coordinates)) return false;
        for (const line of coordinates as unknown[]) lines.push(line);
        return true;
      case 'Polygon':
        polygons.push(coordinates);
        return true;
      case 'MultiPolygon':
        if (!Array.isArray(coordinates)) return false;
        for (const polygon of coordinates as unknown[]) polygons.push(polygon);
        return true;
      case 'GeometryCollection': {
        const nested = geometry['geometries'];
        return (
          Array.isArray(nested) &&
          nested.length > 0 &&
          nested.every(
            (candidate) => isRecord(candidate) && collect(candidate, depth + 1),
          )
        );
      }
      default:
        return false;
    }
  };
  if (
    geometries.length === 0 ||
    !geometries.every((item) => collect(item, 0))
  ) {
    return undefined;
  }
  const populated = [points, lines, polygons].filter(
    (coordinates) => coordinates.length > 0,
  );
  if (populated.length !== 1) return undefined;
  if (points.length > 0) return { type: 'MultiPoint', coordinates: points };
  if (lines.length > 0) return { type: 'MultiLineString', coordinates: lines };
  return { type: 'MultiPolygon', coordinates: polygons };
}

export function createDefaultIngestionPipelineOptions(options: {
  readonly authority: IngestionAuthorityPort;
  readonly reader: S3AuthorityObjectReader;
  readonly config: DataWorkerRuntimeConfig;
}): IngestionPipelineOptions {
  const { scope } = options.config;
  const read = (objectRef: string) => {
    const uploadId = uploadIdFromObjectRef(
      objectRef,
      scope.tenantId,
      scope.projectId,
    );
    return options.reader.readQuarantineObject({
      tenantId: scope.tenantId,
      projectId: scope.projectId,
      uploadId,
      maximumBytes: options.config.ingestion.maximumObjectBytes,
    });
  };
  const scanner = new ClamAvInstreamScanner({
    read,
    host: options.config.ingestion.clamavHost,
    port: options.config.ingestion.clamavPort,
    timeoutMs: options.config.ingestion.clamavTimeoutMs,
    maximumBytes: options.config.ingestion.maximumObjectBytes,
    maximumResponseBytes: options.config.ingestion.clamavMaximumResponseBytes,
  });
  const parser = new TikaIngestionParser({
    endpoint: options.config.ingestion.tikaEndpoint,
    read,
    timeoutMs: options.config.ingestion.tikaTimeoutMs,
    maximumInputBytes: options.config.ingestion.maximumObjectBytes,
    maximumResponseBytes: options.config.ingestion.tikaMaximumResponseBytes,
  });

  return {
    authority: options.authority,
    quarantine: {
      async put({ asset }) {
        try {
          const stat = await options.reader.statQuarantineObject({
            tenantId: scope.tenantId,
            projectId: scope.projectId,
            uploadId: asset.uploadId,
          });
          if (
            stat.sizeBytes !== asset.size ||
            stat.contentType !== asset.mediaType
          ) {
            throw portError('OBJECT_INTEGRITY_MISMATCH', false);
          }
          return { objectRef: asset.objectRef, size: stat.sizeBytes };
        } catch (error) {
          if (error instanceof IngestionPipelinePortError) throw error;
          throw portError('OBJECT_STORE_TEMPORARY');
        }
      },
    },
    scanner,
    fingerprint: {
      async sha256({ objectRef }) {
        try {
          const digest = createHash('sha256');
          for await (const chunk of await read(objectRef)) digest.update(chunk);
          return digest.digest('hex');
        } catch (error) {
          if (error instanceof IngestionPipelinePortError) throw error;
          throw portError('OBJECT_STORE_TEMPORARY');
        }
      },
    },
    parser,
    profiler: {
      profile(input) {
        return Promise.resolve({ profileHash: canonicalPipelineHash(input) });
      },
    },
    classifier: {
      classify(input) {
        return Promise.resolve({
          risk: 'LOW' as const,
          restricted: false,
          confidence: 1,
          classificationHash: canonicalPipelineHash({
            classifier: 'wiser-deterministic-fixture-v1',
            input,
          }),
        });
      },
    },
    aiPlanner: new FixtureFakeAiPlanner(),
    aiValidator: new FixtureFakeAiPlanValidator(),
    transformer: {
      transform(input) {
        const outputHash = canonicalPipelineHash({
          transformer: 'wiser-deterministic-transform-v1',
          input,
        });
        return Promise.resolve({
          artifactRef: `transforms/sha256/${outputHash}`,
          outputHash,
        });
      },
    },
    quality: {
      check() {
        return Promise.resolve([
          {
            ruleId: 'default.authority-integrity',
            status: 'PASSED' as const,
            weight: 1,
            blocking: true,
          },
        ]);
      },
    },
    aligner: {
      align(input) {
        if (!isRecord(input) || !Array.isArray(input['parsedAssets'])) {
          return Promise.reject(portError('INVALID_ALIGNMENT_INPUT', false));
        }
        const spatialFacts: PipelineSpatialFact[] = [];
        for (const value of input['parsedAssets'] as unknown[]) {
          if (!isRecord(value) || value['kind'] !== 'geojson') continue;
          const metadata = value['metadata'];
          const assetId = value['assetId'];
          if (!isRecord(metadata) || typeof assetId !== 'string') {
            return Promise.reject(portError('INVALID_ALIGNMENT_INPUT', false));
          }
          const sourceGeoJson = geometryFromMetadata(metadata);
          const sourceCrs = metadata['sourceCrs'];
          if (
            sourceGeoJson === undefined ||
            !['EPSG:4326', 'EPSG:4490', 'EPSG:3857'].includes(String(sourceCrs))
          ) {
            return Promise.reject(portError('UNSUPPORTED_GEOJSON', false));
          }
          spatialFacts.push({
            assetId,
            sourceCrs: sourceCrs as PipelineSpatialFact['sourceCrs'],
            sourceGeoJson,
          });
        }
        const alignmentHash = canonicalPipelineHash({ spatialFacts });
        return Promise.resolve({
          alignmentHash,
          ...(spatialFacts.length === 0
            ? {}
            : { spatialFacts: Object.freeze(spatialFacts) }),
        });
      },
    },
    minimumQualityScore: options.config.ingestion.minimumQualityScore,
    minimumAiConfidence: options.config.ingestion.minimumAiConfidence,
  };
}
