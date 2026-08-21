import {
  DeterministicFakeEmbedding,
  Neo4jKnowledgeGraphProjection,
  OPENSEARCH_EVIDENCE_INDEX,
  OpenSearchEvidenceProjection,
  PostgisSpatialProjection,
  PostgresDataJobRepository,
  PostgresProjectionOutboxRepository,
  ProjectionOutboxConsumer,
  StacCatalogProjection,
  WeaviateEvidenceProjection,
  createDataPostgresPool,
  createS3AuthorityObjectReader,
  createS3AuthorityObjectStore,
  createS3AuthorityPresigner,
  createSeaweedFsS3Client,
} from '@wiser/data-infra';

import { PostgresIngestionAuthority } from '../adapters/ingestion-runtime.js';
import type { DataWorkerRuntimeConfig } from '../config.js';
import { createIngestionPipelineHandler } from '../handlers/ingestion-pipeline.js';
import { DataWorkerScheduler, type DataWorkerLogger } from '../scheduler.js';
import {
  DataWorkerRuntime,
  PublishingProjectionRepository,
  createDefaultHandlerRegistry,
  createProjectionAwareIngestionHandler,
} from '../runtime.js';
import { createDefaultIngestionPipelineOptions } from './default-ports.js';
import { BoundedProjectionHttpClient } from './http-client.js';
import {
  PostgresProjectionHydrationAuthority,
  PostgresProjectionPublicationGate,
} from './postgres-projection-authority.js';
import {
  ProjectionInputHydrator,
  createProjectionTargets,
} from './projection-hydrator.js';

export interface DefaultDataWorkerComposition {
  readonly runtime: DataWorkerRuntime;
  readonly scheduler: DataWorkerScheduler;
  readonly jobTypes: readonly string[];
}

export function createDefaultDataWorkerRuntime(
  config: DataWorkerRuntimeConfig,
  logger: DataWorkerLogger,
): DefaultDataWorkerComposition {
  const s3Client = createSeaweedFsS3Client(config.objectStore);
  const objectStore = createS3AuthorityObjectStore({
    bucket: config.objectStore.bucket,
    client: s3Client,
    presign: createS3AuthorityPresigner(s3Client),
    clock: () => new Date(),
  });
  const objectReader = createS3AuthorityObjectReader({
    bucket: config.objectStore.bucket,
    client: s3Client,
  });
  const ingestionPool = createDataPostgresPool({
    connectionString: config.databaseUrl,
    applicationName: 'wiser-data-ingestion',
  });
  const ingestionAuthority = new PostgresIngestionAuthority({
    pool: ingestionPool,
    objectStore,
    workerActorId: config.workerActorId,
    maximumPolicyVersion: config.scope.policyVersion,
  });

  const publicationPool = createDataPostgresPool({
    connectionString: config.databaseUrl,
    applicationName: 'wiser-data-publication',
  });
  const publication = new PostgresProjectionPublicationGate(
    publicationPool,
    config.workerActorId,
  );
  const pipeline = createIngestionPipelineHandler(
    createDefaultIngestionPipelineOptions({
      authority: ingestionAuthority,
      reader: objectReader,
      config,
    }),
  );
  const ingestionHandler = createProjectionAwareIngestionHandler({
    handler: pipeline,
    publication,
    timeoutMs: config.projection.publicationWaitTimeoutMs,
    pollIntervalMs: config.projection.publicationWaitPollMs,
  });
  const handlers = createDefaultHandlerRegistry(ingestionHandler);
  const scheduler = new DataWorkerScheduler({
    repository: PostgresDataJobRepository.connect(config.databaseUrl),
    handlers,
    logger,
    scope: config.scope,
    workerId: config.workerId,
    claimLimit: config.claimLimit,
    leaseMs: config.leaseMs,
    heartbeatIntervalMs: config.heartbeatIntervalMs,
    pollIntervalMs: config.pollIntervalMs,
  });

  const http = new BoundedProjectionHttpClient({
    allowedOrigins: [
      config.projection.weaviateBaseUrl,
      config.projection.openSearchBaseUrl,
      config.projection.neo4jBaseUrl,
      config.projection.stacBaseUrl,
    ],
    timeoutMs: config.projection.httpTimeoutMs,
    maximumResponseBytes: config.projection.httpMaximumResponseBytes,
  });
  const hydrationPool = createDataPostgresPool({
    connectionString: config.databaseUrl,
    applicationName: 'wiser-data-hydration',
  });
  const hydrationAuthority = new PostgresProjectionHydrationAuthority(
    hydrationPool,
  );
  const hydrator = new ProjectionInputHydrator({
    authority: hydrationAuthority,
    embedding: new DeterministicFakeEmbedding({
      dimensions: config.projection.embeddingDimensions,
      version: config.projection.embeddingVersion,
    }),
    maximumCachedEvents: config.projection.maximumCachedEvents,
  });
  const spatialPool = createDataPostgresPool({
    connectionString: config.databaseUrl,
    applicationName: 'wiser-data-postgis',
  });
  const targets = createProjectionTargets({
    hydrator,
    postgis: new PostgisSpatialProjection(spatialPool),
    weaviate: new WeaviateEvidenceProjection({
      baseUrl: config.projection.weaviateBaseUrl,
      apiKey: config.projection.weaviateApiKey,
      http,
    }),
    opensearch: new OpenSearchEvidenceProjection({
      baseUrl: config.projection.openSearchBaseUrl,
      indexName: OPENSEARCH_EVIDENCE_INDEX,
      username: config.projection.openSearchUsername,
      password: config.projection.openSearchPassword,
      http,
    }),
    neo4j: new Neo4jKnowledgeGraphProjection({
      baseUrl: config.projection.neo4jBaseUrl,
      database: config.projection.neo4jDatabase,
      username: config.projection.neo4jUsername,
      password: config.projection.neo4jPassword,
      http,
    }),
    stac: new StacCatalogProjection({
      baseUrl: config.projection.stacBaseUrl,
      bearerToken: config.projection.stacBearerToken,
      assetBaseUrl: config.projection.stacAssetBaseUrl,
      http,
    }),
  });
  const outbox = new PostgresProjectionOutboxRepository(
    createDataPostgresPool({
      connectionString: config.databaseUrl,
      applicationName: 'wiser-data-outbox',
    }),
  );
  const publishingRepository = new PublishingProjectionRepository(
    outbox,
    publication,
  );
  const projectionConsumer = new ProjectionOutboxConsumer({
    repository: publishingRepository,
    targets,
    consumerName: config.projection.consumerName,
  });
  const runtime = new DataWorkerRuntime({
    scheduler,
    projectionConsumer,
    projectionScope: config.scope,
    projectionBatchLimit: config.projection.batchLimit,
    projectionPollIntervalMs: config.projection.pollIntervalMs,
    onProjectionError: (category) =>
      logger.warn('data_worker_projection_batch_failed', { category }),
    close: [
      () => hydrator.close(),
      () => publication.close(),
      () => ingestionPool.end(),
      () => spatialPool.end(),
      () => {
        s3Client.destroy();
        return Promise.resolve();
      },
    ],
  });
  return Object.freeze({
    runtime,
    scheduler,
    jobTypes: handlers.jobTypes,
  });
}
