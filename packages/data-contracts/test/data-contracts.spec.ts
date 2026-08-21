import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  AcceptanceStatusSchema,
  CapabilityDefinitionSchema,
  DATA_CAPABILITY_IDS,
  DATA_CAPABILITY_REGISTRY,
  DataItemSchema,
  DataItemVersionSchema,
  IngestionStateSchema,
  OperationSchema,
  OperationStatusSchema,
  ProcessingStageSchema,
  PublicationStatusSchema,
  QualityGradeSchema,
  SecurityLevelSchema,
  type DataCapabilityId,
} from '../src/index.js';

const TENANT_ID = '20000000-0000-4000-8000-000000000001';
const PROJECT_ID = '20000000-0000-4000-8000-000000000002';
const DATA_ITEM_ID = '20000000-0000-4000-8000-000000000003';
const VERSION_ID = '20000000-0000-4000-8000-000000000004';
const SCHEMA_VERSION_ID = '20000000-0000-4000-8000-000000000005';
const ASSET_ID = '20000000-0000-4000-8000-000000000006';
const INGESTION_ID = '20000000-0000-4000-8000-000000000007';
const OPERATION_ID = '20000000-0000-4000-8000-000000000008';

const dataItem = {
  tenantId: TENANT_ID,
  dataItemId: DATA_ITEM_ID,
  name: 'Yongding monitoring stations',
  businessDomains: ['water-monitoring'],
  sourceNatures: ['observed'],
  sourceChannels: ['file-upload'],
  processingStage: 'STANDARDIZED',
  intendedUses: ['hydrology-analysis'],
  ownerProjectId: PROJECT_ID,
  sourceOrganization: 'WISER fixture laboratory',
  sourceContact: {
    name: 'Data steward',
    email: 'steward@example.test',
  },
  authorizationScopes: ['data.catalog.read'],
  citationRequirements: ['Cite the immutable data item version.'],
  spatialExtent: {
    bbox: [115, 39, 117, 41],
    crs: 'EPSG:4490',
  },
  sourceCrs: 'EPSG:4326',
  canonicalCrs: 'EPSG:4490',
  temporalExtent: {
    start: '2023-04-01T00:00:00+08:00',
    end: '2023-05-31T23:59:59+08:00',
  },
  timezone: 'Asia/Shanghai',
  temporalResolution: 'PT1H',
  schemaVersionId: SCHEMA_VERSION_ID,
  unitDefinitions: [
    {
      field: 'flowM3s',
      sourceUnit: 'm3/s',
      canonicalUnit: 'm3/s',
    },
  ],
  missingValueRules: [
    {
      ruleId: 'missing.station-id',
      description: 'stationId must be present.',
    },
  ],
  anomalyRules: [
    {
      ruleId: 'anomaly.negative-flow',
      description: 'flowM3s must not be negative.',
    },
  ],
  generationMethod: 'OBSERVED',
  qualityGrade: 'A',
  acceptanceStatus: 'PASSED',
  publicationStatus: 'PUBLISHED',
  securityLevel: 'L1_INTERNAL',
  version: 3,
  updateMode: 'SNAPSHOT',
  createdAt: '2026-08-22T01:00:00Z',
  updatedAt: '2026-08-22T01:05:00Z',
} as const;

const dataItemVersion = {
  tenantId: TENANT_ID,
  dataItemId: DATA_ITEM_ID,
  versionId: VERSION_ID,
  version: 3,
  assetIds: [ASSET_ID],
  sourceHash:
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  metadataHash:
    'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
  schemaVersionId: SCHEMA_VERSION_ID,
  processingStage: 'STANDARDIZED',
  generationMethod: 'OBSERVED',
  qualityGrade: 'A',
  acceptanceStatus: 'PASSED',
  publicationStatus: 'PUBLISHED',
  securityLevel: 'L1_INTERNAL',
  createdAt: '2026-08-22T01:00:00Z',
  committedAt: '2026-08-22T01:04:00Z',
  publishedAt: '2026-08-22T01:05:00Z',
} as const;

const operation = {
  operationId: OPERATION_ID,
  tenantId: TENANT_ID,
  projectId: PROJECT_ID,
  capabilityId: 'data.ingestion.create',
  status: 'PENDING',
  resource: `operation://${OPERATION_ID}`,
  progressPercent: 0,
  version: 1,
  createdAt: '2026-08-22T01:00:00Z',
  updatedAt: '2026-08-22T01:00:00Z',
} as const;

const point = {
  type: 'Point',
  coordinates: [116.3, 39.9],
  crs: 'EPSG:4490',
} as const;

const validCapabilityInputs = {
  'data.catalog.search': { query: 'monitoring station', first: 20 },
  'data.catalog.get': { dataItemId: DATA_ITEM_ID },
  'data.query': {
    dataItemId: DATA_ITEM_ID,
    fields: ['stationId', 'flowM3s'],
    first: 10,
  },
  'data.search.federated': { query: 'Yongding evidence', first: 10 },
  'data.knowledge.search': { query: 'ecological flow', first: 10 },
  'data.graph.expand': {
    entityId: 'station:001',
    maxDepth: 2,
    first: 10,
  },
  'data.graph.findPath': {
    fromEntityId: 'station:001',
    toEntityId: 'basin:yongding',
    maxDepth: 5,
  },
  'data.geo.query': {
    geometry: point,
    predicates: ['INTERSECTS'],
    first: 10,
  },
  'data.geo.intersect': {
    left: { dataItemId: DATA_ITEM_ID },
    right: { geometry: point },
    first: 10,
  },
  'data.ingestion.create': {
    assetIds: [ASSET_ID],
    ownerProjectId: PROJECT_ID,
    intendedUses: ['hydrology-analysis'],
    requestedSecurityLevel: 'L1_INTERNAL',
  },
  'data.ingestion.submit': {
    ingestionId: INGESTION_ID,
    expectedVersion: 1,
  },
  'data.operation.get': { operationId: OPERATION_ID },
} satisfies Record<
  DataCapabilityId,
  Readonly<Record<string, unknown>>
>;

describe('Data Foundation status contracts', () => {
  it('accepts every specified status and keeps the dimensions independent', () => {
    expect(SecurityLevelSchema.options).toEqual([
      'L0_PUBLIC',
      'L1_INTERNAL',
      'L2_RESTRICTED',
      'L3_CONFIDENTIAL',
    ]);
    expect(QualityGradeSchema.options).toEqual(['A', 'B', 'C']);
    expect(AcceptanceStatusSchema.options).toEqual([
      'PENDING',
      'PASSED',
      'CONDITIONALLY_PASSED',
      'CORRECTION_REQUIRED',
      'ARCHIVED_ONLY',
      'REJECTED',
    ]);
    expect(PublicationStatusSchema.options).toEqual([
      'UNPUBLISHED',
      'PUBLISHING',
      'PUBLISHED',
      'WITHDRAWN',
    ]);
    expect(ProcessingStageSchema.options).toEqual([
      'RAW',
      'CLEANED',
      'STANDARDIZED',
      'INTERMEDIATE',
      'KNOWLEDGE',
      'METADATA_QUALITY',
    ]);
    expect(IngestionStateSchema.options).toEqual([
      'RECEIVED',
      'QUARANTINED',
      'SECURITY_SCANNED',
      'FINGERPRINTED',
      'PROFILED',
      'CLASSIFIED',
      'SCHEMA_MAPPED',
      'SEMANTIC_MAPPED',
      'TRANSFORMED',
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
    ]);
    expect(OperationStatusSchema.options).toEqual([
      'PENDING',
      'RUNNING',
      'WAITING_INPUT',
      'WAITING_REVIEW',
      'SUCCEEDED',
      'FAILED',
      'CANCELLED',
    ]);

    expect(SecurityLevelSchema.safeParse('SECRET').success).toBe(false);
    expect(QualityGradeSchema.safeParse('PASSED').success).toBe(false);
    expect(AcceptanceStatusSchema.safeParse('A').success).toBe(false);
  });
});

describe('Data Foundation DTO contracts', () => {
  it('accepts complete DataItem, DataItemVersion, and Operation DTOs', () => {
    expect(DataItemSchema.parse(dataItem)).toEqual(dataItem);
    expect(DataItemVersionSchema.parse(dataItemVersion)).toEqual(
      dataItemVersion,
    );
    expect(OperationSchema.parse(operation)).toEqual(operation);
  });

  it('rejects unknown fields at every public DTO boundary', () => {
    expect(
      DataItemSchema.safeParse({ ...dataItem, databasePassword: 'leaked' })
        .success,
    ).toBe(false);
    expect(
      DataItemVersionSchema.safeParse({ ...dataItemVersion, mutable: true })
        .success,
    ).toBe(false);
    expect(OperationSchema.safeParse({ ...operation, internalJobId: 'job-1' }).success).toBe(
      false,
    );
  });
});

describe('Data Foundation capability registry', () => {
  it('contains every required capability with complete transport mappings', () => {
    expect(DATA_CAPABILITY_IDS).toEqual([
      'data.catalog.search',
      'data.catalog.get',
      'data.query',
      'data.search.federated',
      'data.knowledge.search',
      'data.graph.expand',
      'data.graph.findPath',
      'data.geo.query',
      'data.geo.intersect',
      'data.ingestion.create',
      'data.ingestion.submit',
      'data.operation.get',
    ]);
    expect(Object.keys(DATA_CAPABILITY_REGISTRY)).toEqual(
      DATA_CAPABILITY_IDS,
    );

    for (const capabilityId of DATA_CAPABILITY_IDS) {
      const definition = DATA_CAPABILITY_REGISTRY[capabilityId];
      expect(definition.id).toBe(capabilityId);
      expect(CapabilityDefinitionSchema.safeParse(definition).success).toBe(
        true,
      );
      expect(definition.requiredScopes.length).toBeGreaterThan(0);
      expect(definition.restMapping.path).toMatch(/^\/api\/data\/v1\//);
      expect(definition.graphqlMapping.field.length).toBeGreaterThan(0);
      expect(definition.mcpMapping.toolName).toMatch(/^data_/);
      expect(definition.skillMapping.operation).toBe(capabilityId);
    }
  });

  it('validates every capability input strictly', () => {
    for (const capabilityId of DATA_CAPABILITY_IDS) {
      const definition = DATA_CAPABILITY_REGISTRY[capabilityId];
      const input = validCapabilityInputs[capabilityId];
      expect(definition.inputSchema.safeParse(input).success).toBe(true);
      expect(
        definition.inputSchema.safeParse({ ...input, untrustedExtra: true })
          .success,
      ).toBe(false);
    }
  });

  it('rejects incomplete or extended capability definitions', () => {
    const definition = DATA_CAPABILITY_REGISTRY['data.catalog.search'];
    expect(
      CapabilityDefinitionSchema.safeParse({
        ...definition,
        directDatabaseAccess: true,
      }).success,
    ).toBe(false);
  });
});

describe('Data Foundation JSON Schema generation', () => {
  it('keeps enum and strict DTO JSON Schema output stable', () => {
    expect(
      z.toJSONSchema(SecurityLevelSchema, { target: 'draft-7' }),
    ).toEqual({
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'string',
      enum: ['L0_PUBLIC', 'L1_INTERNAL', 'L2_RESTRICTED', 'L3_CONFIDENTIAL'],
    });

    const generated = z.toJSONSchema(DataItemSchema, { target: 'draft-7' });
    expect({
      type: generated.type,
      additionalProperties: generated.additionalProperties,
      propertyKeys: Object.keys(generated.properties ?? {}),
      required: generated.required,
    }).toEqual({
      type: 'object',
      additionalProperties: false,
      propertyKeys: [
        'tenantId',
        'dataItemId',
        'name',
        'businessDomains',
        'sourceNatures',
        'sourceChannels',
        'processingStage',
        'intendedUses',
        'ownerProjectId',
        'sourceOrganization',
        'sourceContact',
        'authorizationScopes',
        'citationRequirements',
        'spatialExtent',
        'sourceCrs',
        'canonicalCrs',
        'temporalExtent',
        'timezone',
        'temporalResolution',
        'schemaVersionId',
        'unitDefinitions',
        'missingValueRules',
        'anomalyRules',
        'generationMethod',
        'qualityGrade',
        'acceptanceStatus',
        'publicationStatus',
        'securityLevel',
        'version',
        'updateMode',
        'createdAt',
        'updatedAt',
      ],
      required: [
        'tenantId',
        'dataItemId',
        'name',
        'businessDomains',
        'sourceNatures',
        'sourceChannels',
        'processingStage',
        'intendedUses',
        'ownerProjectId',
        'sourceOrganization',
        'authorizationScopes',
        'citationRequirements',
        'unitDefinitions',
        'missingValueRules',
        'anomalyRules',
        'generationMethod',
        'qualityGrade',
        'acceptanceStatus',
        'publicationStatus',
        'securityLevel',
        'version',
        'updateMode',
        'createdAt',
        'updatedAt',
      ],
    });
  });

  it('generates strict JSON Schema for every capability input and output', () => {
    for (const capabilityId of DATA_CAPABILITY_IDS) {
      const definition = DATA_CAPABILITY_REGISTRY[capabilityId];
      for (const schema of [definition.inputSchema, definition.outputSchema]) {
        const generated = z.toJSONSchema(schema, { target: 'draft-7' });
        expect(generated.type).toBe('object');
        expect(generated.additionalProperties).toBe(false);
      }
    }
  });
});
