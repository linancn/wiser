import { PostgresDataJobRepository } from '@wiser/data-infra';

import {
  closeDataWorkerHttpServer,
  createDataWorkerHttpServer,
  DataWorkerScheduler,
  StaticJobHandlerRegistry,
  type DataWorkerLogger,
} from './index.js';
import { loadDataWorkerConfig } from './config.js';

const logger: DataWorkerLogger = {
  info(event, context) {
    console.info(JSON.stringify({ level: 'info', event, ...context }));
  },
  warn(event, context) {
    console.warn(JSON.stringify({ level: 'warn', event, ...context }));
  },
  error(event, context) {
    console.error(JSON.stringify({ level: 'error', event, ...context }));
  },
};

async function main(environment: NodeJS.ProcessEnv): Promise<void> {
  const config = loadDataWorkerConfig(environment);
  if (config.deprecatedAliases.length > 0) {
    logger.warn('data_worker_deprecated_environment_aliases', {
      aliases: config.deprecatedAliases,
    });
  }
  const repository = PostgresDataJobRepository.connect(config.databaseUrl);
  const scheduler = new DataWorkerScheduler({
    repository,
    handlers: new StaticJobHandlerRegistry([]),
    logger,
    scope: config.scope,
    workerId: config.workerId,
    claimLimit: config.claimLimit,
    leaseMs: config.leaseMs,
    heartbeatIntervalMs: config.heartbeatIntervalMs,
    pollIntervalMs: config.pollIntervalMs,
  });
  const server = createDataWorkerHttpServer(scheduler);
  server.listen(config.healthPort, config.healthHost);

  const abort = new AbortController();
  const shutdown = () => abort.abort();
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  try {
    await scheduler.start(abort.signal);
  } finally {
    await scheduler.stop();
    await closeDataWorkerHttpServer(server);
    process.off('SIGINT', shutdown);
    process.off('SIGTERM', shutdown);
  }
}

void main(process.env).catch((error: unknown) => {
  logger.error('data_worker_start_failed', {
    message: error instanceof Error ? error.message : 'Unknown error',
  });
  process.exitCode = 1;
});
