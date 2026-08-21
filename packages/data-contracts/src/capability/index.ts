import { z } from 'zod';

import {
  AcceptanceStatusSchema,
  CreateDataItemInputSchema,
  CreateDataItemOutputSchema,
  DataItemSchema,
  DataItemVersionPageSchema,
  DataItemVersionSchema,
  GetDataItemVersionInputSchema,
  GetDataItemVersionOutputSchema,
  ListDataItemVersionsInputSchema,
  ProcessingStageSchema,
  QualityGradeSchema,
  SecurityLevelSchema,
} from '../catalog/index.js';
import {
  CursorSchema,
  DataFieldNameSchema,
  DataKeySchema,
  OffsetDateTimeSchema,
  PageRequestFields,
} from '../common.js';
import {
  ApproveIngestionInputSchema,
  GetIngestionInputSchema,
  IngestionOutputSchema,
  RejectIngestionInputSchema,
} from '../ingestion/index.js';
import {
  CancelOperationInputSchema,
  GetOperationEventsInputSchema,
  OperationEventPageSchema,
  OperationSchema,
} from '../operation/index.js';
import {
  CompleteUploadSessionInputSchema,
  CompleteUploadSessionOutputSchema,
  CreateUploadSessionInputSchema,
  CreateUploadSessionOutputSchema,
} from '../upload/index.js';
import {
  PlatformScopeSchema,
  PlatformUuidSchema,
} from '@wiser/platform-contracts';

export const DATA_CAPABILITY_IDS = [
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
] as const;

export const DataCapabilityIdSchema = z.enum(DATA_CAPABILITY_IDS);
export type DataCapabilityId = z.infer<typeof DataCapabilityIdSchema>;

export const DataItemPageSchema = z.strictObject({
  items: z.array(DataItemSchema),
  nextCursor: CursorSchema.optional(),
});

export const DataCatalogSearchInputSchema = z.strictObject({
  query: z.string().min(1).max(512).optional(),
  businessDomains: z.array(DataKeySchema).max(64).optional(),
  processingStages: z.array(ProcessingStageSchema).max(6).optional(),
  securityLevels: z.array(SecurityLevelSchema).max(4).optional(),
  qualityGrades: z.array(QualityGradeSchema).max(3).optional(),
  acceptanceStatuses: z.array(AcceptanceStatusSchema).max(6).optional(),
  ...PageRequestFields,
});

export const DataCatalogGetInputSchema = z.strictObject({
  dataItemId: PlatformUuidSchema,
  versionId: PlatformUuidSchema.optional(),
});

export const DataCatalogGetOutputSchema = z.strictObject({
  item: DataItemSchema,
  selectedVersion: DataItemVersionSchema.optional(),
});

export const DataQueryFilterSchema = z.strictObject({
  field: DataFieldNameSchema,
  operator: z.enum(['EQ', 'NE', 'GT', 'GTE', 'LT', 'LTE', 'IN', 'CONTAINS']),
  value: z.json(),
});

export const DataQueryInputSchema = z.strictObject({
  dataItemId: PlatformUuidSchema,
  versionId: PlatformUuidSchema.optional(),
  fields: z.array(DataFieldNameSchema).min(1).max(256),
  filters: z.array(DataQueryFilterSchema).max(128).optional(),
  ...PageRequestFields,
});

export const DataQueryOutputSchema = z.strictObject({
  dataItemId: PlatformUuidSchema,
  versionId: PlatformUuidSchema,
  columns: z.array(DataFieldNameSchema).max(256),
  rows: z.array(z.record(z.string(), z.json())).max(10_000),
  nextCursor: CursorSchema.optional(),
});

export const FederatedSearchInputSchema = z.strictObject({
  query: z.string().min(1).max(2048),
  businessDomains: z.array(DataKeySchema).max(64).optional(),
  securityLevels: z.array(SecurityLevelSchema).max(4).optional(),
  sources: z
    .array(z.enum(['catalog', 'fulltext', 'semantic', 'graph', 'geo', 'stac']))
    .min(1)
    .max(6)
    .optional(),
  ...PageRequestFields,
});

export const KnowledgeSearchInputSchema = z.strictObject({
  query: z.string().min(1).max(2048),
  dataItemIds: z.array(PlatformUuidSchema).max(256).optional(),
  minimumConfidence: z.number().min(0).max(1).optional(),
  ...PageRequestFields,
});

export const SearchResultSchema = z.strictObject({
  dataItemId: PlatformUuidSchema,
  versionId: PlatformUuidSchema,
  evidenceId: PlatformUuidSchema,
  source: z.string().min(1).max(128),
  score: z.number().finite(),
  qualityGrade: QualityGradeSchema,
  acceptanceStatus: AcceptanceStatusSchema,
  securityLevel: SecurityLevelSchema,
  generatedAt: OffsetDateTimeSchema,
  limitations: z.array(z.string().min(1).max(2048)).max(64),
  excerpt: z.string().max(8192).optional(),
});

export const SearchPageSchema = z.strictObject({
  items: z.array(SearchResultSchema),
  nextCursor: CursorSchema.optional(),
});

export const GraphExpandInputSchema = z.strictObject({
  entityId: z.string().min(1).max(256),
  relationTypes: z.array(DataKeySchema).max(64).optional(),
  maxDepth: z.number().int().min(1).max(8),
  ...PageRequestFields,
});

export const GraphFindPathInputSchema = z.strictObject({
  fromEntityId: z.string().min(1).max(256),
  toEntityId: z.string().min(1).max(256),
  relationTypes: z.array(DataKeySchema).max(64).optional(),
  maxDepth: z.number().int().min(1).max(12),
});

export const GraphNodeSchema = z.strictObject({
  entityId: z.string().min(1).max(256),
  label: z.string().min(1).max(256),
  dataItemId: PlatformUuidSchema,
  versionId: PlatformUuidSchema,
  evidenceId: PlatformUuidSchema,
  securityLevel: SecurityLevelSchema,
  qualityGrade: QualityGradeSchema,
  confidence: z.number().min(0).max(1),
});

export const GraphEdgeSchema = z.strictObject({
  edgeId: z.string().min(1).max(256),
  fromEntityId: z.string().min(1).max(256),
  toEntityId: z.string().min(1).max(256),
  relationType: DataKeySchema,
  evidenceId: PlatformUuidSchema,
  confidence: z.number().min(0).max(1),
});

export const GraphResultSchema = z.strictObject({
  nodes: z.array(GraphNodeSchema).max(10_000),
  edges: z.array(GraphEdgeSchema).max(20_000),
  nextCursor: CursorSchema.optional(),
});

export const GeoJsonGeometrySchema = z.strictObject({
  type: z.enum([
    'Point',
    'MultiPoint',
    'LineString',
    'MultiLineString',
    'Polygon',
    'MultiPolygon',
  ]),
  coordinates: z.json(),
  crs: z.string().min(3).max(128),
});

export const GeoTargetSchema = z.union([
  z.strictObject({
    dataItemId: PlatformUuidSchema,
    versionId: PlatformUuidSchema.optional(),
  }),
  z.strictObject({ geometry: GeoJsonGeometrySchema }),
]);

export const GeoQueryInputSchema = z.strictObject({
  geometry: GeoJsonGeometrySchema,
  predicates: z
    .array(z.enum(['INTERSECTS', 'WITHIN', 'CONTAINS', 'NEAREST']))
    .min(1)
    .max(4),
  dataItemIds: z.array(PlatformUuidSchema).max(256).optional(),
  ...PageRequestFields,
});

export const GeoIntersectInputSchema = z.strictObject({
  left: GeoTargetSchema,
  right: GeoTargetSchema,
  ...PageRequestFields,
});

export const GeoFeatureSchema = z.strictObject({
  featureId: z.string().min(1).max(256),
  dataItemId: PlatformUuidSchema,
  versionId: PlatformUuidSchema,
  geometry: GeoJsonGeometrySchema,
  properties: z.record(z.string(), z.json()),
});

export const GeoQueryOutputSchema = z.strictObject({
  features: z.array(GeoFeatureSchema).max(10_000),
  nextCursor: CursorSchema.optional(),
});

export const CreateIngestionInputSchema = z.strictObject({
  assetIds: z.array(PlatformUuidSchema).min(1).max(10_000),
  ownerProjectId: PlatformUuidSchema,
  intendedUses: z.array(DataKeySchema).min(1).max(64),
  requestedSecurityLevel: SecurityLevelSchema,
});

export const CreateIngestionOutputSchema = z.strictObject({
  ingestionId: PlatformUuidSchema,
  operation: OperationSchema,
});

export const SubmitIngestionInputSchema = z.strictObject({
  ingestionId: PlatformUuidSchema,
  expectedVersion: z.number().int().positive(),
});

export const OperationOutputSchema = z.strictObject({
  operation: OperationSchema,
});

export const GetOperationInputSchema = z.strictObject({
  operationId: PlatformUuidSchema,
});

const RuntimeZodSchema = z.custom<z.ZodType>(
  (candidate) =>
    typeof candidate === 'object' &&
    candidate !== null &&
    'safeParse' in candidate &&
    typeof candidate.safeParse === 'function',
  { error: 'inputSchema and outputSchema must be Zod runtime schemas.' },
);

export const CapabilityRestMappingSchema = z.strictObject({
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
  path: z
    .string()
    .min(1)
    .max(512)
    .regex(/^\/api\/data\/v1\//),
  successStatus: z.number().int().min(200).max(299),
  responseMode: z.enum(['JSON', 'SSE']).optional(),
});

export const CapabilityGraphqlMappingSchema = z.strictObject({
  operationType: z.enum(['query', 'mutation']),
  field: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[a-z][A-Za-z0-9]*$/),
});

export const CapabilityMcpMappingSchema = z.strictObject({
  toolName: z
    .string()
    .min(1)
    .max(128)
    .regex(/^data_[a-z0-9_]+$/),
});

export const CapabilitySkillMappingSchema = z.strictObject({
  operation: DataCapabilityIdSchema,
});

export const CapabilityDefinitionSchema = z.strictObject({
  id: DataCapabilityIdSchema,
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  kind: z.enum(['query', 'command']),
  inputSchema: RuntimeZodSchema,
  outputSchema: RuntimeZodSchema,
  requiredScopes: z.array(PlatformScopeSchema).min(1).max(32),
  maxSecurityLevel: SecurityLevelSchema,
  executionMode: z.enum(['SYNCHRONOUS', 'ASYNCHRONOUS']),
  timeout: z.number().int().min(100).max(900_000),
  idempotent: z.boolean(),
  auditLevel: z.enum(['STANDARD', 'DETAILED', 'FULL']),
  restMapping: CapabilityRestMappingSchema,
  graphqlMapping: CapabilityGraphqlMappingSchema,
  mcpMapping: CapabilityMcpMappingSchema,
  skillMapping: CapabilitySkillMappingSchema,
});
export type CapabilityDefinition = z.infer<typeof CapabilityDefinitionSchema>;

function defineCapability(
  definition: CapabilityDefinition,
): Readonly<CapabilityDefinition> {
  return Object.freeze(CapabilityDefinitionSchema.parse(definition));
}

const capabilityRegistry = {
  'data.catalog.search': defineCapability({
    id: 'data.catalog.search',
    version: '1.0.0',
    kind: 'query',
    inputSchema: DataCatalogSearchInputSchema,
    outputSchema: DataItemPageSchema,
    requiredScopes: ['data.catalog.read'],
    maxSecurityLevel: 'L3_CONFIDENTIAL',
    executionMode: 'SYNCHRONOUS',
    timeout: 30_000,
    idempotent: true,
    auditLevel: 'STANDARD',
    restMapping: {
      method: 'GET',
      path: '/api/data/v1/catalog/data-items',
      successStatus: 200,
    },
    graphqlMapping: { operationType: 'query', field: 'dataCatalog' },
    mcpMapping: { toolName: 'data_catalog_search' },
    skillMapping: { operation: 'data.catalog.search' },
  }),
  'data.catalog.get': defineCapability({
    id: 'data.catalog.get',
    version: '1.0.0',
    kind: 'query',
    inputSchema: DataCatalogGetInputSchema,
    outputSchema: DataCatalogGetOutputSchema,
    requiredScopes: ['data.catalog.read'],
    maxSecurityLevel: 'L3_CONFIDENTIAL',
    executionMode: 'SYNCHRONOUS',
    timeout: 30_000,
    idempotent: true,
    auditLevel: 'STANDARD',
    restMapping: {
      method: 'GET',
      path: '/api/data/v1/catalog/data-items/:dataItemId',
      successStatus: 200,
    },
    graphqlMapping: { operationType: 'query', field: 'dataItem' },
    mcpMapping: { toolName: 'data_catalog_get' },
    skillMapping: { operation: 'data.catalog.get' },
  }),
  'data.query': defineCapability({
    id: 'data.query',
    version: '1.0.0',
    kind: 'query',
    inputSchema: DataQueryInputSchema,
    outputSchema: DataQueryOutputSchema,
    requiredScopes: ['data.query.execute'],
    maxSecurityLevel: 'L3_CONFIDENTIAL',
    executionMode: 'SYNCHRONOUS',
    timeout: 60_000,
    idempotent: true,
    auditLevel: 'DETAILED',
    restMapping: {
      method: 'POST',
      path: '/api/data/v1/query',
      successStatus: 200,
    },
    graphqlMapping: { operationType: 'query', field: 'dataQuery' },
    mcpMapping: { toolName: 'data_query' },
    skillMapping: { operation: 'data.query' },
  }),
  'data.search.federated': defineCapability({
    id: 'data.search.federated',
    version: '1.0.0',
    kind: 'query',
    inputSchema: FederatedSearchInputSchema,
    outputSchema: SearchPageSchema,
    requiredScopes: ['data.search.execute'],
    maxSecurityLevel: 'L3_CONFIDENTIAL',
    executionMode: 'SYNCHRONOUS',
    timeout: 60_000,
    idempotent: true,
    auditLevel: 'DETAILED',
    restMapping: {
      method: 'POST',
      path: '/api/data/v1/search',
      successStatus: 200,
    },
    graphqlMapping: { operationType: 'query', field: 'dataSearch' },
    mcpMapping: { toolName: 'data_search_federated' },
    skillMapping: { operation: 'data.search.federated' },
  }),
  'data.knowledge.search': defineCapability({
    id: 'data.knowledge.search',
    version: '1.0.0',
    kind: 'query',
    inputSchema: KnowledgeSearchInputSchema,
    outputSchema: SearchPageSchema,
    requiredScopes: ['data.knowledge.read'],
    maxSecurityLevel: 'L3_CONFIDENTIAL',
    executionMode: 'SYNCHRONOUS',
    timeout: 60_000,
    idempotent: true,
    auditLevel: 'DETAILED',
    restMapping: {
      method: 'POST',
      path: '/api/data/v1/knowledge/search',
      successStatus: 200,
    },
    graphqlMapping: { operationType: 'query', field: 'knowledgeSearch' },
    mcpMapping: { toolName: 'data_knowledge_search' },
    skillMapping: { operation: 'data.knowledge.search' },
  }),
  'data.graph.expand': defineCapability({
    id: 'data.graph.expand',
    version: '1.0.0',
    kind: 'query',
    inputSchema: GraphExpandInputSchema,
    outputSchema: GraphResultSchema,
    requiredScopes: ['data.graph.read'],
    maxSecurityLevel: 'L3_CONFIDENTIAL',
    executionMode: 'SYNCHRONOUS',
    timeout: 60_000,
    idempotent: true,
    auditLevel: 'DETAILED',
    restMapping: {
      method: 'POST',
      path: '/api/data/v1/graph/expand',
      successStatus: 200,
    },
    graphqlMapping: { operationType: 'query', field: 'graphExpand' },
    mcpMapping: { toolName: 'data_graph_expand' },
    skillMapping: { operation: 'data.graph.expand' },
  }),
  'data.graph.findPath': defineCapability({
    id: 'data.graph.findPath',
    version: '1.0.0',
    kind: 'query',
    inputSchema: GraphFindPathInputSchema,
    outputSchema: GraphResultSchema,
    requiredScopes: ['data.graph.read'],
    maxSecurityLevel: 'L3_CONFIDENTIAL',
    executionMode: 'SYNCHRONOUS',
    timeout: 60_000,
    idempotent: true,
    auditLevel: 'DETAILED',
    restMapping: {
      method: 'POST',
      path: '/api/data/v1/graph/find-path',
      successStatus: 200,
    },
    graphqlMapping: { operationType: 'query', field: 'graphFindPath' },
    mcpMapping: { toolName: 'data_graph_find_path' },
    skillMapping: { operation: 'data.graph.findPath' },
  }),
  'data.geo.query': defineCapability({
    id: 'data.geo.query',
    version: '1.0.0',
    kind: 'query',
    inputSchema: GeoQueryInputSchema,
    outputSchema: GeoQueryOutputSchema,
    requiredScopes: ['data.geo.read'],
    maxSecurityLevel: 'L3_CONFIDENTIAL',
    executionMode: 'SYNCHRONOUS',
    timeout: 60_000,
    idempotent: true,
    auditLevel: 'DETAILED',
    restMapping: {
      method: 'POST',
      path: '/api/data/v1/geo/query',
      successStatus: 200,
    },
    graphqlMapping: { operationType: 'query', field: 'geoQuery' },
    mcpMapping: { toolName: 'data_geo_query' },
    skillMapping: { operation: 'data.geo.query' },
  }),
  'data.geo.intersect': defineCapability({
    id: 'data.geo.intersect',
    version: '1.0.0',
    kind: 'query',
    inputSchema: GeoIntersectInputSchema,
    outputSchema: GeoQueryOutputSchema,
    requiredScopes: ['data.geo.read'],
    maxSecurityLevel: 'L3_CONFIDENTIAL',
    executionMode: 'SYNCHRONOUS',
    timeout: 60_000,
    idempotent: true,
    auditLevel: 'DETAILED',
    restMapping: {
      method: 'POST',
      path: '/api/data/v1/geo/intersect',
      successStatus: 200,
    },
    graphqlMapping: { operationType: 'query', field: 'geoIntersect' },
    mcpMapping: { toolName: 'data_geo_intersect' },
    skillMapping: { operation: 'data.geo.intersect' },
  }),
  'data.ingestion.create': defineCapability({
    id: 'data.ingestion.create',
    version: '1.0.0',
    kind: 'command',
    inputSchema: CreateIngestionInputSchema,
    outputSchema: CreateIngestionOutputSchema,
    requiredScopes: ['data.ingestion.write'],
    maxSecurityLevel: 'L3_CONFIDENTIAL',
    executionMode: 'ASYNCHRONOUS',
    timeout: 120_000,
    idempotent: true,
    auditLevel: 'FULL',
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
  }),
  'data.ingestion.submit': defineCapability({
    id: 'data.ingestion.submit',
    version: '1.0.0',
    kind: 'command',
    inputSchema: SubmitIngestionInputSchema,
    outputSchema: OperationOutputSchema,
    requiredScopes: ['data.ingestion.write'],
    maxSecurityLevel: 'L3_CONFIDENTIAL',
    executionMode: 'ASYNCHRONOUS',
    timeout: 120_000,
    idempotent: true,
    auditLevel: 'FULL',
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
  }),
  'data.operation.get': defineCapability({
    id: 'data.operation.get',
    version: '1.0.0',
    kind: 'query',
    inputSchema: GetOperationInputSchema,
    outputSchema: OperationSchema,
    requiredScopes: ['data.operation.read'],
    maxSecurityLevel: 'L3_CONFIDENTIAL',
    executionMode: 'SYNCHRONOUS',
    timeout: 30_000,
    idempotent: true,
    auditLevel: 'STANDARD',
    restMapping: {
      method: 'GET',
      path: '/api/data/v1/operations/:operationId',
      successStatus: 200,
    },
    graphqlMapping: { operationType: 'query', field: 'dataOperation' },
    mcpMapping: { toolName: 'data_operation_get' },
    skillMapping: { operation: 'data.operation.get' },
  }),
  'data.catalog.create': defineCapability({
    id: 'data.catalog.create',
    version: '1.0.0',
    kind: 'command',
    inputSchema: CreateDataItemInputSchema,
    outputSchema: CreateDataItemOutputSchema,
    requiredScopes: ['data.ingestion.write'],
    maxSecurityLevel: 'L3_CONFIDENTIAL',
    executionMode: 'SYNCHRONOUS',
    timeout: 30_000,
    idempotent: true,
    auditLevel: 'FULL',
    restMapping: {
      method: 'POST',
      path: '/api/data/v1/catalog/data-items',
      successStatus: 201,
    },
    graphqlMapping: { operationType: 'mutation', field: 'createDataItem' },
    mcpMapping: { toolName: 'data_catalog_create' },
    skillMapping: { operation: 'data.catalog.create' },
  }),
  'data.catalog.versions.list': defineCapability({
    id: 'data.catalog.versions.list',
    version: '1.0.0',
    kind: 'query',
    inputSchema: ListDataItemVersionsInputSchema,
    outputSchema: DataItemVersionPageSchema,
    requiredScopes: ['data.catalog.read'],
    maxSecurityLevel: 'L3_CONFIDENTIAL',
    executionMode: 'SYNCHRONOUS',
    timeout: 30_000,
    idempotent: true,
    auditLevel: 'STANDARD',
    restMapping: {
      method: 'GET',
      path: '/api/data/v1/catalog/data-items/:dataItemId/versions',
      successStatus: 200,
    },
    graphqlMapping: { operationType: 'query', field: 'dataItemVersions' },
    mcpMapping: { toolName: 'data_catalog_versions_list' },
    skillMapping: { operation: 'data.catalog.versions.list' },
  }),
  'data.catalog.versions.get': defineCapability({
    id: 'data.catalog.versions.get',
    version: '1.0.0',
    kind: 'query',
    inputSchema: GetDataItemVersionInputSchema,
    outputSchema: GetDataItemVersionOutputSchema,
    requiredScopes: ['data.catalog.read'],
    maxSecurityLevel: 'L3_CONFIDENTIAL',
    executionMode: 'SYNCHRONOUS',
    timeout: 30_000,
    idempotent: true,
    auditLevel: 'STANDARD',
    restMapping: {
      method: 'GET',
      path: '/api/data/v1/catalog/data-items/:dataItemId/versions/:versionId',
      successStatus: 200,
    },
    graphqlMapping: { operationType: 'query', field: 'dataItemVersion' },
    mcpMapping: { toolName: 'data_catalog_version_get' },
    skillMapping: { operation: 'data.catalog.versions.get' },
  }),
  'data.uploadSession.create': defineCapability({
    id: 'data.uploadSession.create',
    version: '1.0.0',
    kind: 'command',
    inputSchema: CreateUploadSessionInputSchema,
    outputSchema: CreateUploadSessionOutputSchema,
    requiredScopes: ['data.ingestion.write'],
    maxSecurityLevel: 'L3_CONFIDENTIAL',
    executionMode: 'SYNCHRONOUS',
    timeout: 30_000,
    idempotent: true,
    auditLevel: 'FULL',
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
  }),
  'data.uploadSession.complete': defineCapability({
    id: 'data.uploadSession.complete',
    version: '1.0.0',
    kind: 'command',
    inputSchema: CompleteUploadSessionInputSchema,
    outputSchema: CompleteUploadSessionOutputSchema,
    requiredScopes: ['data.ingestion.write'],
    maxSecurityLevel: 'L3_CONFIDENTIAL',
    executionMode: 'SYNCHRONOUS',
    timeout: 60_000,
    idempotent: true,
    auditLevel: 'FULL',
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
  }),
  'data.ingestion.get': defineCapability({
    id: 'data.ingestion.get',
    version: '1.0.0',
    kind: 'query',
    inputSchema: GetIngestionInputSchema,
    outputSchema: IngestionOutputSchema,
    requiredScopes: ['data.operation.read'],
    maxSecurityLevel: 'L3_CONFIDENTIAL',
    executionMode: 'SYNCHRONOUS',
    timeout: 30_000,
    idempotent: true,
    auditLevel: 'STANDARD',
    restMapping: {
      method: 'GET',
      path: '/api/data/v1/ingestions/:ingestionId',
      successStatus: 200,
    },
    graphqlMapping: { operationType: 'query', field: 'dataIngestion' },
    mcpMapping: { toolName: 'data_ingestion_get' },
    skillMapping: { operation: 'data.ingestion.get' },
  }),
  'data.ingestion.approve': defineCapability({
    id: 'data.ingestion.approve',
    version: '1.0.0',
    kind: 'command',
    inputSchema: ApproveIngestionInputSchema,
    outputSchema: OperationOutputSchema,
    requiredScopes: ['data.publish'],
    maxSecurityLevel: 'L3_CONFIDENTIAL',
    executionMode: 'ASYNCHRONOUS',
    timeout: 120_000,
    idempotent: true,
    auditLevel: 'FULL',
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
  }),
  'data.ingestion.reject': defineCapability({
    id: 'data.ingestion.reject',
    version: '1.0.0',
    kind: 'command',
    inputSchema: RejectIngestionInputSchema,
    outputSchema: IngestionOutputSchema,
    requiredScopes: ['data.publish'],
    maxSecurityLevel: 'L3_CONFIDENTIAL',
    executionMode: 'SYNCHRONOUS',
    timeout: 30_000,
    idempotent: true,
    auditLevel: 'FULL',
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
  }),
  'data.operation.cancel': defineCapability({
    id: 'data.operation.cancel',
    version: '1.0.0',
    kind: 'command',
    inputSchema: CancelOperationInputSchema,
    outputSchema: OperationSchema,
    requiredScopes: ['data.operation.read', 'data.ingestion.write'],
    maxSecurityLevel: 'L3_CONFIDENTIAL',
    executionMode: 'SYNCHRONOUS',
    timeout: 30_000,
    idempotent: true,
    auditLevel: 'FULL',
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
  }),
  'data.operation.events': defineCapability({
    id: 'data.operation.events',
    version: '1.0.0',
    kind: 'query',
    inputSchema: GetOperationEventsInputSchema,
    outputSchema: OperationEventPageSchema,
    requiredScopes: ['data.operation.read'],
    maxSecurityLevel: 'L3_CONFIDENTIAL',
    executionMode: 'SYNCHRONOUS',
    timeout: 900_000,
    idempotent: true,
    auditLevel: 'DETAILED',
    restMapping: {
      method: 'GET',
      path: '/api/data/v1/operations/:operationId/events',
      successStatus: 200,
      responseMode: 'SSE',
    },
    graphqlMapping: { operationType: 'query', field: 'dataOperationEvents' },
    mcpMapping: { toolName: 'data_operation_events' },
    skillMapping: { operation: 'data.operation.events' },
  }),
} satisfies Record<DataCapabilityId, Readonly<CapabilityDefinition>>;

export const DATA_CAPABILITY_REGISTRY: Readonly<
  Record<DataCapabilityId, Readonly<CapabilityDefinition>>
> = Object.freeze(capabilityRegistry);
