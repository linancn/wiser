import {
  createDataEmbedding,
  embeddingCollectionName,
  createDataPostgresPool,
  PostgresProjectionOutboxRepository,
  WeaviateEvidenceProjection,
  EvidenceProjectionError,
} from '@wiser/data-infra';
import { loadDataWorkerConfig } from './config.js';
import { BoundedProjectionHttpClient } from './runtime/http-client.js';
import { PostgresProjectionHydrationAuthority } from './runtime/postgres-projection-authority.js';
import { ProjectionInputHydrator } from './runtime/projection-hydrator.js';
import { rebuildEmbeddingProjection } from './runtime/embedding-rebuild.js';

async function main(): Promise<void> {
  const config = loadDataWorkerConfig(process.env);
  if (config.projection.embedding.provider !== 'openai-compatible')
    throw new Error(
      'Embedding rebuild requires an explicit real model profile.',
    );
  const embedding = createDataEmbedding(config.projection.embedding);
  const collection = embeddingCollectionName(embedding.model);
  const consumerName = `embedding-v1-${collection.split('_')[1]}`;
  const lockPool = createDataPostgresPool({
    connectionString: config.databaseUrl,
    applicationName: 'wiser-embedding-rebuild-lock',
    maximumConnections: 1,
  });
  const lock = await lockPool.connect();
  const lockKey = `${config.scope.tenantId}:${config.scope.projectId}:${collection}`;
  const http = new BoundedProjectionHttpClient({
    allowedOrigins: [config.projection.weaviateBaseUrl],
    timeoutMs: config.projection.httpTimeoutMs,
    maximumResponseBytes: config.projection.httpMaximumResponseBytes,
  });
  const authority = new PostgresProjectionHydrationAuthority(
    createDataPostgresPool({
      connectionString: config.databaseUrl,
      applicationName: 'wiser-embedding-rebuild-source',
      maximumConnections: 2,
    }),
  );
  const hydrator = new ProjectionInputHydrator({
    authority,
    embedding,
    maximumCachedEvents: 1,
  });
  const repository = PostgresProjectionOutboxRepository.connect(
    config.databaseUrl,
  );
  const target = new WeaviateEvidenceProjection({
    baseUrl: config.projection.weaviateBaseUrl,
    apiKey: config.projection.weaviateApiKey,
    vectorDimensions: embedding.model.dimensions,
    embeddingModel: embedding.model,
    http,
  });
  const stop = new AbortController();
  const abort = () => stop.abort();
  process.once('SIGINT', abort);
  process.once('SIGTERM', abort);
  try {
    const acquired = await lock.query(
      'select pg_try_advisory_lock(hashtext($1), hashtext($2)) as acquired',
      ['wiser-embedding-rebuild', lockKey],
    );
    if (acquired.rows[0]?.['acquired'] !== true)
      throw new Error(
        'Another embedding rebuild is already running for this project and profile.',
      );
    await target.ensureCollection();
    // readBatch seeds its checkpoint in one transaction; the next read sees it.
    await repository.readBatch(config.scope, consumerName, 1);
    process.stdout.write(
      JSON.stringify({
        event: 'embedding_rebuild_started',
        collection,
        model: embedding.model,
      }) + '\n',
    );
    const counts = await rebuildEmbeddingProjection({
      scope: config.scope,
      consumerName,
      repository,
      signal: stop.signal,
      project: async (event) => {
        const input = await hydrator.hydrate(event);
        for (const evidence of input.evidence) await target.put(evidence);
        return input.evidence.length;
      },
      progress: (counts) => {
        if (counts.events % 25 === 0)
          process.stdout.write(
            JSON.stringify({ event: 'embedding_rebuild_progress', ...counts }) +
              '\n',
          );
      },
    });
    process.stdout.write(
      JSON.stringify({
        event: 'embedding_rebuild_complete',
        collection,
        ...counts,
      }) + '\n',
    );
  } finally {
    process.removeListener('SIGINT', abort);
    process.removeListener('SIGTERM', abort);
    await lock
      .query('select pg_advisory_unlock(hashtext($1), hashtext($2))', [
        'wiser-embedding-rebuild',
        lockKey,
      ])
      .catch(() => undefined);
    lock.release();
    http.close();
    await Promise.allSettled([
      lockPool.end(),
      hydrator.close(),
      repository.close(),
    ]);
  }
}
main().catch((error: unknown) => {
  // Diagnostic categories and checkpoints suffice; upstream bodies may contain source content.
  process.stderr.write(
    'Embedding rebuild failed. Check service availability and the configured profile, then resume with the same profile.\n',
  );
  const safeCategories = new Map([
    ['Embedding input is invalid.', 'EMBEDDING_INPUT_INVALID'],
    ['Embedding response is invalid.', 'EMBEDDING_RESPONSE_INVALID'],
    ['Embedding service is unavailable.', 'EMBEDDING_UNAVAILABLE'],
    [
      'Projection hydration authority contract is invalid.',
      'AUTHORITY_HYDRATION_INVALID',
    ],
    ['Projection HTTP request failed safely.', 'PROJECTION_HTTP_FAILED'],
  ]);
  process.stderr.write(
    JSON.stringify({
      event: 'embedding_rebuild_failed',
      category:
        error instanceof EvidenceProjectionError
          ? error.code
          : error instanceof Error
            ? (safeCategories.get(error.message) ?? 'REBUILD_FAILED')
            : 'REBUILD_FAILED',
    }) + '\n',
  );
  process.exitCode = 1;
});
