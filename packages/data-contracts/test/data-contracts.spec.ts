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
const UPLOAD_SESSION_ID = '20000000-0000-4000-8000-000000000009';

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

const createDataItemInput: Record<string, unknown> = { ...dataItem };
for (const serverOwnedField of [
  'tenantId',
  'dataItemId',
  'qualityGrade',
  'acceptanceStatus',
  'publicationStatus',
  'version',
  'createdAt',
  'updatedAt',
]) {
  delete createDataItemInput[serverOwnedField];
}

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
  'data.catalog.create': createDataItemInput,
  'data.catalog.versions.list': { dataItemId: DATA_ITEM_ID, first: 25 },
  'data.catalog.versions.get': {
    dataItemId: DATA_ITEM_ID,
    versionId: VERSION_ID,
  },
  'data.uploadSession.create': {
    ownerProjectId: PROJECT_ID,
    objects: [
      {
        fileName: 'sample-stations.geojson',
        mediaType: 'application/geo+json',
        sizeBytes: 4096,
        sha256: dataItemVersion.sourceHash,
      },
    ],
    preferredMode: 'PRESIGNED_PUT',
  },
  'data.uploadSession.complete': {
    uploadSessionId: UPLOAD_SESSION_ID,
    expectedVersion: 1,
    objects: [
      {
        assetId: ASSET_ID,
        sizeBytes: 4096,
        sha256: dataItemVersion.sourceHash,
        etag: 'fixture-etag',
      },
    ],
  },
  'data.ingestion.get': { ingestionId: INGESTION_ID },
  'data.ingestion.approve': {
    ingestionId: INGESTION_ID,
    expectedVersion: 4,
    reviewNote: 'Quality and lineage gates passed.',
  },
  'data.ingestion.reject': {
    ingestionId: INGESTION_ID,
    expectedVersion: 4,
    reasonCode: 'QUALITY_GATE_FAILED',
    reason: 'Required station identifiers are missing.',
  },
  'data.operation.cancel': {
    operationId: OPERATION_ID,
    expectedVersion: 2,
    reason: 'The source upload was superseded.',
  },
  'data.operation.events': { operationId: OPERATION_ID, first: 100 },
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
  'data.catalog.create': {
    restMapping: {
      method: 'POST',
      path: '/api/data/v1/catalog/data-items',
      successStatus: 201,
    },
    graphqlMapping: { operationType: 'mutation', field: 'createDataItem' },
    mcpMapping: { toolName: 'data_catalog_create' },
    skillMapping: { operation: 'data.catalog.create' },
  },
  'data.catalog.versions.list': {
    restMapping: {
      method: 'GET',
      path: '/api/data/v1/catalog/data-items/:dataItemId/versions',
      successStatus: 200,
    },
    graphqlMapping: { operationType: 'query', field: 'dataItemVersions' },
    mcpMapping: { toolName: 'data_catalog_versions_list' },
    skillMapping: { operation: 'data.catalog.versions.list' },
  },
  'data.catalog.versions.get': {
    restMapping: {
      method: 'GET',
      path: '/api/data/v1/catalog/data-items/:dataItemId/versions/:versionId',
      successStatus: 200,
    },
    graphqlMapping: { operationType: 'query', field: 'dataItemVersion' },
    mcpMapping: { toolName: 'data_catalog_version_get' },
    skillMapping: { operation: 'data.catalog.versions.get' },
  },
  'data.uploadSession.create': {
    restMapping: {
      method: 'POST',
      path: '/api/data/v1/upload-sessions',
      successStatus: 201,
    },
    graphqlMapping: {
      operationType: 'mutation',
      field: 'createDataUploadSession',
    },
    mcpMapping: { toolName: 'data_upload_session_create' },
    skillMapping: { operation: 'data.uploadSession.create' },
  },
  'data.uploadSession.complete': {
    restMapping: {
      method: 'POST',
      path: '/api/data/v1/upload-sessions/:uploadSessionId/complete',
      successStatus: 200,
    },
    graphqlMapping: {
      operationType: 'mutation',
      field: 'completeDataUploadSession',
    },
    mcpMapping: { toolName: 'data_upload_session_complete' },
    skillMapping: { operation: 'data.uploadSession.complete' },
  },
  'data.ingestion.get': {
    restMapping: {
      method: 'GET',
      path: '/api/data/v1/ingestions/:ingestionId',
      successStatus: 200,
    },
    graphqlMapping: { operationType: 'query', field: 'dataIngestion' },
    mcpMapping: { toolName: 'data_ingestion_get' },
    skillMapping: { operation: 'data.ingestion.get' },
  },
  'data.ingestion.approve': {
    restMapping: {
      method: 'POST',
      path: '/api/data/v1/ingestions/:ingestionId/approve',
      successStatus: 202,
    },
    graphqlMapping: {
      operationType: 'mutation',
      field: 'approveDataIngestion',
    },
    mcpMapping: { toolName: 'data_ingestion_approve' },
    skillMapping: { operation: 'data.ingestion.approve' },
  },
  'data.ingestion.reject': {
    restMapping: {
      method: 'POST',
      path: '/api/data/v1/ingestions/:ingestionId/reject',
      successStatus: 200,
    },
    graphqlMapping: {
      operationType: 'mutation',
      field: 'rejectDataIngestion',
    },
    mcpMapping: { toolName: 'data_ingestion_reject' },
    skillMapping: { operation: 'data.ingestion.reject' },
  },
  'data.operation.cancel': {
    restMapping: {
      method: 'POST',
      path: '/api/data/v1/operations/:operationId/cancel',
      successStatus: 200,
    },
    graphqlMapping: {
      operationType: 'mutation',
      field: 'cancelDataOperation',
    },
    mcpMapping: { toolName: 'data_operation_cancel' },
    skillMapping: { operation: 'data.operation.cancel' },
  },
  'data.operation.events': {
    restMapping: {
      method: 'GET',
      path: '/api/data/v1/operations/:operationId/events',
      successStatus: 200,
      responseMode: 'SSE',
    },
    graphqlMapping: { operationType: 'query', field: 'dataOperationEvents' },
    mcpMapping: { toolName: 'data_operation_events' },
    skillMapping: { operation: 'data.operation.events' },
  },
} satisfies Record<DataCapabilityId, unknown>;

const expectedCapabilityScopes = {
  'data.catalog.search': ['data.catalog.read'],
  'data.catalog.get': ['data.catalog.read'],
  'data.query': ['data.query.execute'],
  'data.search.federated': ['data.search.execute'],
  'data.knowledge.search': ['data.knowledge.read'],
  'data.graph.expand': ['data.graph.read'],
  'data.graph.findPath': ['data.graph.read'],
  'data.geo.query': ['data.geo.read'],
  'data.geo.intersect': ['data.geo.read'],
  'data.ingestion.create': ['data.ingestion.write'],
  'data.ingestion.submit': ['data.ingestion.write'],
  'data.operation.get': ['data.operation.read'],
  'data.catalog.create': ['data.ingestion.write'],
  'data.catalog.versions.list': ['data.catalog.read'],
  'data.catalog.versions.get': ['data.catalog.read'],
  'data.uploadSession.create': ['data.ingestion.write'],
  'data.uploadSession.complete': ['data.ingestion.write'],
  'data.ingestion.get': ['data.operation.read'],
  'data.ingestion.approve': ['data.publish'],
  'data.ingestion.reject': ['data.publish'],
  'data.operation.cancel': ['data.operation.read', 'data.ingestion.write'],
  'data.operation.events': ['data.operation.read'],
} satisfies Record<DataCapabilityId, readonly string[]>;

const asynchronousCapabilityIds = new Set<DataCapabilityId>([
  'data.ingestion.create',
  'data.ingestion.submit',
  'data.ingestion.approve',
]);

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
  'data.catalog.create': {
    input: '0254364350cd935921753ca74571dee5e3bbbb802de4a71bc2c61439c179f95a',
    output: '5e22a8d5e66d538f1b6e765e73c5e8d06250db62490f7fef56876378d05abd7a',
  },
  'data.catalog.versions.list': {
    input: '75619aee74646552dcf7b4939d615e01747a55cbe074ad7589894896d8fae176',
    output: '417d20fde3f862522707b7dcdc66e4e2a7d39f3574a74fbbaa84957b47aceb5a',
  },
  'data.catalog.versions.get': {
    input: 'e506474b6ef13975dec248cd0e32b68a09754d04f420a710355c0d15b105aa6a',
    output: '93d00d1053ece01534eee9d559c84f23faf74e2a71ffde53657ac36fd91f4504',
  },
  'data.uploadSession.create': {
    input: 'e8c8f8eb84563ca0b1c61f0ca9dbe55d00f5672f8c4117913b81dc21424d46e0',
    output: '6148abb3f3c2c150dd9ab9edbdff520a99a18af32fbbb27b5168ef6b8fc2763e',
  },
  'data.uploadSession.complete': {
    input: 'cb0cacc5b3b0687f6f2c8d4aa22eca8429327d757ebf201abd86b2a0626fce2d',
    output: 'b4475e14d0689a99bf4c89f7ce14b0bba97a4e3fa465dc71ea2af9e340146077',
  },
  'data.ingestion.get': {
    input: 'bf57edf9d7399573105b1a2ddcc13160b29c2a8de852e6b70e3aaba4dede9878',
    output: 'ab7ff15fce6f1b1d2b9fe851578aa973bedc10925bed0a5646afb6eeca875be3',
  },
  'data.ingestion.approve': {
    input: '284419a11ea425388676752a72d139705ca907bea613595468383bce808be9b4',
    output: '928bf9ac9cdd29b9a23353f39dee4a4b4c5cb50f2878b9fc92c3d3fbf53633be',
  },
  'data.ingestion.reject': {
    input: 'ef64d5a6d39a6695165c43780fee6f3feedd60aa77f9f10919e5d383972e9df6',
    output: 'ab7ff15fce6f1b1d2b9fe851578aa973bedc10925bed0a5646afb6eeca875be3',
  },
  'data.operation.cancel': {
    input: '9c3b5eb52eee1d4a21f3f318608d18c22fd3ab3b9d86bc4faa835993e59d37ec',
    output: 'f413231e63ad67f73058ed7e86bbd247ebd235de4dedb9472f618427fab4fd98',
  },
  'data.operation.events': {
    input: '247ee2e3a7b01ba0a273c3031da7336cd19085e1794eb8391216ddd28d4bf3f2',
    output: '8a06fb39f4dee6a7d8a92b8c6a4f4ab1f0b6bf873091ef8668b9a4dfff57c83a',
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
      expect(definition.requiredScopes).toEqual(
        expectedCapabilityScopes[capabilityId],
      );
      expect(definition.executionMode).toBe(
        asynchronousCapabilityIds.has(capabilityId)
          ? 'ASYNCHRONOUS'
          : 'SYNCHRONOUS',
      );
      expect(definition.idempotent).toBe(true);
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

  it('rejects missing required input fields wherever the operation requires them', () => {
    let checkedCapabilities = 0;

    for (const capabilityId of DATA_CAPABILITY_IDS) {
      const definition = DATA_CAPABILITY_REGISTRY[capabilityId];
      const input = validCapabilityInputs[capabilityId];
      for (const field of Object.keys(input)) {
        const incompleteInput: Record<string, unknown> = { ...input };
        delete incompleteInput[field];
        if (!definition.inputSchema.safeParse(incompleteInput).success) {
          checkedCapabilities += 1;
          break;
        }
      }
    }

    expect(checkedCapabilities).toBe(DATA_CAPABILITY_IDS.length - 1);
  });

  it('rejects raw database and projection-store languages', () => {
    expect(DATA_CAPABILITY_IDS).not.toContain('data.graph.query');
    expect(
      DATA_CAPABILITY_REGISTRY['data.query'].inputSchema.safeParse({
        sql: 'select * from catalog.data_item',
      }).success,
    ).toBe(false);
    expect(
      DATA_CAPABILITY_REGISTRY['data.graph.findPath'].inputSchema.safeParse({
        cypher: 'match (n) return n',
      }).success,
    ).toBe(false);
    expect(
      DATA_CAPABILITY_REGISTRY['data.search.federated'].inputSchema.safeParse({
        opensearchDsl: { query: { match_all: {} } },
      }).success,
    ).toBe(false);
  });

  it('returns the shared Operation contract for every asynchronous handler', () => {
    for (const capabilityId of asynchronousCapabilityIds) {
      const definition = DATA_CAPABILITY_REGISTRY[capabilityId];
      const output = z.toJSONSchema(definition.outputSchema, {
        target: 'draft-7',
      });

      expect(definition.restMapping.successStatus).toBe(202);
      expect(output.properties).toHaveProperty('operation');
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
