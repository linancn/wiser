import { createDataPostgresPool } from '@wiser/data-infra';
import { loadDataWorkerConfig } from './config.js';
import {
  BusinessProjectionConsumer,
  Neo4jBusinessProjection,
} from '@wiser/data-infra';
import { BoundedProjectionHttpClient } from './runtime/http-client.js';

async function main() {
  const config = loadDataWorkerConfig(process.env);
  const http = new BoundedProjectionHttpClient({
    allowedOrigins: [config.projection.neo4jBaseUrl],
    timeoutMs: config.projection.httpTimeoutMs,
    maximumResponseBytes: config.projection.httpMaximumResponseBytes,
  });
  const consumer = new BusinessProjectionConsumer(
    createDataPostgresPool({
      connectionString: config.databaseUrl,
      applicationName: 'wiser-business-rebuild',
      maximumConnections: 1,
    }),
    new Neo4jBusinessProjection({
      baseUrl: config.projection.neo4jBaseUrl,
      database: config.projection.neo4jDatabase,
      username: config.projection.neo4jUsername,
      password: config.projection.neo4jPassword,
      http,
    }),
  );
  const stop = new AbortController(),
    abort = () => stop.abort();
  process.once('SIGINT', abort);
  process.once('SIGTERM', abort);
  try {
    let sweeps = 0,
      processed = 0;
    // Finish any durable in-progress sweep, then complete one full pass after rebuild starts.
    while (sweeps < 2) {
      if (stop.signal.aborted)
        throw Error('Business rebuild interrupted; checkpoint retained');
      const result = await consumer.processBatch(
        config.scope,
        config.projection.batchLimit,
      );
      processed += result.projected;
      if (result.sweepComplete) sweeps++;
    }
    process.stdout.write(
      JSON.stringify({
        event: 'business_relation_rebuild_complete',
        processed,
        sweeps,
      }) + '\n',
    );
  } finally {
    process.removeListener('SIGINT', abort);
    process.removeListener('SIGTERM', abort);
    http.close();
    await consumer.close();
  }
}
void main().catch(() => {
  process.stderr.write(
    'Business relation rebuild failed; inspect the configured target and resume.\n',
  );
  process.exitCode = 1;
});
