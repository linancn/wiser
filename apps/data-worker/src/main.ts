import {
  closeDataWorkerHttpServer,
  createDataWorkerHttpServer,
} from './http/server.js';
import { loadDataWorkerConfig } from './config.js';
import { createDefaultDataWorkerRuntime } from './runtime/default-runtime.js';
import type { DataWorkerLogger } from './scheduler.js';

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

export async function main(environment: NodeJS.ProcessEnv): Promise<void> {
  const config = loadDataWorkerConfig(environment);
  if (config.deprecatedAliases.length > 0) {
    logger.warn('data_worker_deprecated_environment_aliases', {
      aliases: config.deprecatedAliases,
    });
  }
  const composition = createDefaultDataWorkerRuntime(config, logger);
  if (composition.jobTypes.length === 0) {
    throw new Error('Data Worker default handler registry is empty.');
  }
  const { runtime, scheduler } = composition;
  const server = createDataWorkerHttpServer(scheduler);
  server.listen(config.healthPort, config.healthHost);

  const abort = new AbortController();
  const shutdown = () => abort.abort();
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  try {
    await runtime.start(abort.signal);
  } finally {
    await runtime.stop();
    await closeDataWorkerHttpServer(server);
    process.off('SIGINT', shutdown);
    process.off('SIGTERM', shutdown);
  }
}

void main(process.env).catch((error: unknown) => {
  logger.error('data_worker_start_failed', {
    category:
      error instanceof Error
        ? 'DATA_WORKER_START_FAILED'
        : 'DATA_WORKER_UNKNOWN_FAILURE',
  });
  process.exitCode = 1;
});
