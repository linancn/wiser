import { createHash } from 'node:crypto';

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
  authorizationScope: 'data.catalog.read',
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
} satisfies Record<DataCapabilityId, Readonly<Record<string, unknown>>>;

const expectedCapabilityMappings = {
  'data.catalog.search': {
    restMapping: {
      method: 'GET',
      path: '/api/data/v1/catalog/data-items',
      successStatus: 200,
    },
    graphqlMapping: { operationType: 'query', field: 'dataCatalog' },
    mcpMapping: { toolName: 'data_catalog_search' },
    skillMapping: { operation: 'data.catalog.search' },
  },
  'data.catalog.get': {
    restMapping: {
      method: 'GET',
      path: '/api/data/v1/catalog/data-items/:dataItemId',
      successStatus: 200,
    },
    graphqlMapping: { operationType: 'query', field: 'dataItem' },
    mcpMapping: { toolName: 'data_catalog_get' },
    skillMapping: { operation: 'data.catalog.get' },
  },
  'data.query': {
    restMapping: {
      method: 'POST',
      path: '/api/data/v1/query',
      successStatus: 200,
    },
    graphqlMapping: { operationType: 'query', field: 'dataQuery' },
    mcpMapping: { toolName: 'data_query' },
    skillMapping: { operation: 'data.query' },
  },
  'data.search.federated': {
    restMapping: {
      method: 'POST',
      path: '/api/data/v1/search',
      successStatus: 200,
    },
    graphqlMapping: { operationType: 'query', field: 'dataSearch' },
    mcpMapping: { toolName: 'data_search_federated' },
    skillMapping: { operation: 'data.search.federated' },
  },
  'data.knowledge.search': {
    restMapping: {
      method: 'POST',
      path: '/api/data/v1/knowledge/search',
      successStatus: 200,
    },
    graphqlMapping: { operationType: 'query', field: 'knowledgeSearch' },
    mcpMapping: { toolName: 'data_knowledge_search' },
    skillMapping: { operation: 'data.knowledge.search' },
  },
  'data.graph.expand': {
    restMapping: {
      method: 'POST',
      path: '/api/data/v1/graph/expand',
      successStatus: 200,
    },
    graphqlMapping: { operationType: 'query', field: 'graphExpand' },
    mcpMapping: { toolName: 'data_graph_expand' },
    skillMapping: { operation: 'data.graph.expand' },
  },
  'data.graph.findPath': {
    restMapping: {
      method: 'POST',
      path: '/api/data/v1/graph/find-path',
      successStatus: 200,
    },
    graphqlMapping: { operationType: 'query', field: 'graphFindPath' },
    mcpMapping: { toolName: 'data_graph_find_path' },
    skillMapping: { operation: 'data.graph.findPath' },
  },
  'data.geo.query': {
    restMapping: {
      method: 'POST',
      path: '/api/data/v1/geo/query',
      successStatus: 200,
    },
    graphqlMapping: { operationType: 'query', field: 'geoQuery' },
    mcpMapping: { toolName: 'data_geo_query' },
    skillMapping: { operation: 'data.geo.query' },
  },
  'data.geo.intersect': {
    restMapping: {
      method: 'POST',
      path: '/api/data/v1/geo/intersect',
      successStatus: 200,
    },
    graphqlMapping: { operationType: 'query', field: 'geoIntersect' },
    mcpMapping: { toolName: 'data_geo_intersect' },
    skillMapping: { operation: 'data.geo.intersect' },
  },
  'data.ingestion.create': {
    restMapping: {
      method: 'POST',
      path: '/api/data/v1/ingestions',
      successStatus: 202,
    },
    graphqlMapping: {
      operationType: 'mutation',
      field: 'createDataIngestion',
    },
    mcpMapping: { toolName: 'data_ingestion_create' },
    skillMapping: { operation: 'data.ingestion.create' },
  },
  'data.ingestion.submit': {
    restMapping: {
      method: 'POST',
      path: '/api/data/v1/ingestions/:ingestionId/submit',
      successStatus: 202,
    },
    graphqlMapping: {
      operationType: 'mutation',
      field: 'submitDataIngestion',
    },
    mcpMapping: { toolName: 'data_ingestion_submit' },
    skillMapping: { operation: 'data.ingestion.submit' },
  },
  'data.operation.get': {
    restMapping: {
      method: 'GET',
      path: '/api/data/v1/operations/:operationId',
      successStatus: 200,
    },
    graphqlMapping: { operationType: 'query', field: 'dataOperation' },
    mcpMapping: { toolName: 'data_operation_get' },
    skillMapping: { operation: 'data.operation.get' },
  },
} satisfies Record<DataCapabilityId, unknown>;

const expectedJsonSchemaHashes = {
  'data.catalog.search': {
    input: '0200fec39a66bcfc428b442a5302a5171ec3d3d19fd98e937e1b85f60257ed49',
    output: 'dd965149834a8f23f11449b6988ca7acee74fa394e4964d4e4fb610f5fd434d1',
  },
  'data.catalog.get': {
    input: '59f8155f67dd96336971960f7143c640e2fd75643846ab1b4c835a1602857078',
    output: 'ec49b4213125b3a70612ef02f4859fb1861eee31947e5c69707f8bbf278953d2',
  },
  'data.query': {
    input: '20d4bff3890ed680749126034103e2bed7e1d67224cd0ca5837ce068568f0648',
    output: 'b1b42ca06ee4283a115c26570cbf68724807dca70f361815dd5932f38b7816c4',
  },
  'data.search.federated': {
    input: 'e542ee0fb3fba029e37dd03dfe259033d3a1a3dd85ee05d0b117beda5603bb1f',
    output: '7cd253bdc1e4ba282a199b8c9f17be12f207cb32e19d2be94358119d2a0195e9',
  },
  'data.knowledge.search': {
    input: 'bd3bd75072c95fa8489422d2974cd7f508cc1fc9a28c1d0419ba2bb4ee12503e',
    output: '7cd253bdc1e4ba282a199b8c9f17be12f207cb32e19d2be94358119d2a0195e9',
  },
  'data.graph.expand': {
    input: 'b2a97fa2b258d7ab662204c5d16c1d3f06a44ae08764897983e29bb3bddc67c4',
    output: 'f441e464b240788a240a2e06cb585f6762dcaa78fa76f3e523c063c964dadaef',
  },
  'data.graph.findPath': {
    input: '4e43ce54e4fe4f4997e32f1f2c6573bcf610e1d38921a4b4fd0093971831a10e',
    output: 'f441e464b240788a240a2e06cb585f6762dcaa78fa76f3e523c063c964dadaef',
  },
  'data.geo.query': {
    input: '2036d4561ed61bc9fab314ae85485e3f6663570ecbd6aee136dd72ef3ce26acb',
    output: 'dc587a390c429b04bdaecc5ea2facc37b323400e31a9a63e5db3f018f8673047',
  },
  'data.geo.intersect': {
    input: '149e9a9d34ec3aaa0abf18e5f998c5016d4fb8b397bcaf7b2cfa6669357a6fd0',
    output: 'dc587a390c429b04bdaecc5ea2facc37b323400e31a9a63e5db3f018f8673047',
  },
  'data.ingestion.create': {
    input: '2991848d7da6f56eb4640306c007e13e2f9727bff669d07d4f1dcbf7711ec2b4',
    output: '7b19ccfcc5f4207960d70b1c1db9eec56640a2370c6a27f3dfaa97e61008c6f4',
  },
  'data.ingestion.submit': {
    input: '47ed04cb0df6082ab3eebccb7e9baf18d299de127844ec5bb64c14f94ab26b62',
    output: '928bf9ac9cdd29b9a23353f39dee4a4b4c5cb50f2878b9fc92c3d3fbf53633be',
  },
  'data.operation.get': {
    input: '09011488985ab0fd152fd0d78a556e7a698c5491c863bf2ccef9984e486d0662',
    output: 'f413231e63ad67f73058ed7e86bbd247ebd235de4dedb9472f618427fab4fd98',
  },
} satisfies Record<
  DataCapabilityId,
  Readonly<{ input: string; output: string }>
>;

function normalizeJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry) => normalizeJson(entry));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Readonly<Record<string, unknown>>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, normalizeJson(entry)]),
    );
  }
  return value;
}

function jsonSchemaHash(schema: z.ZodType): string {
  const generated = z.toJSONSchema(schema, { target: 'draft-7' });
  const canonicalJson = JSON.stringify(normalizeJson(generated));
  return createHash('sha256').update(canonicalJson).digest('hex');
}

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
    expect(
      OperationSchema.safeParse({ ...operation, internalJobId: 'job-1' })
        .success,
    ).toBe(false);
  });

  it('rejects missing required fields at every public DTO boundary', () => {
    const dataItemWithoutName: Record<string, unknown> = { ...dataItem };
    delete dataItemWithoutName.name;
    const versionWithoutId: Record<string, unknown> = { ...dataItemVersion };
    delete versionWithoutId.versionId;
    const operationWithoutStatus: Record<string, unknown> = { ...operation };
    delete operationWithoutStatus.status;

    expect(DataItemSchema.safeParse(dataItemWithoutName).success).toBe(false);
    expect(DataItemVersionSchema.safeParse(versionWithoutId).success).toBe(
      false,
    );
    expect(OperationSchema.safeParse(operationWithoutStatus).success).toBe(
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
      'data.catalog.create',
      'data.catalog.versions.list',
      'data.catalog.versions.get',
      'data.uploadSession.create',
      'data.uploadSession.complete',
      'data.ingestion.get',
      'data.ingestion.approve',
      'data.ingestion.reject',
      'data.operation.cancel',
      'data.operation.events',
    ]);
    expect(Object.keys(DATA_CAPABILITY_REGISTRY)).toEqual(DATA_CAPABILITY_IDS);

    for (const capabilityId of DATA_CAPABILITY_IDS) {
      const definition = DATA_CAPABILITY_REGISTRY[capabilityId];
      expect(definition.id).toBe(capabilityId);
      expect(CapabilityDefinitionSchema.safeParse(definition).success).toBe(
        true,
      );
      expect(definition.requiredScopes.length).toBeGreaterThan(0);
      expect({
        restMapping: definition.restMapping,
        graphqlMapping: definition.graphqlMapping,
        mcpMapping: definition.mcpMapping,
        skillMapping: definition.skillMapping,
      }).toEqual(expectedCapabilityMappings[capabilityId]);
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
    const incompleteDefinition: Record<string, unknown> = { ...definition };
    delete incompleteDefinition.outputSchema;

    expect(
      CapabilityDefinitionSchema.safeParse(incompleteDefinition).success,
    ).toBe(false);
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
    expect(z.toJSONSchema(SecurityLevelSchema, { target: 'draft-7' })).toEqual({
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
        'authorizationScope',
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
        'authorizationScope',
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
      expect({
        input: jsonSchemaHash(definition.inputSchema),
        output: jsonSchemaHash(definition.outputSchema),
      }).toEqual(expectedJsonSchemaHashes[capabilityId]);
    }
  });
});
