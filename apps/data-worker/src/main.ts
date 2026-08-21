import { randomUUID } from 'node:crypto';

import {
  PostgresDataJobRepository,
  type DataJobScope,
} from '@wiser/data-infra';

import {
  closeDataWorkerHttpServer,
  createDataWorkerHttpServer,
  DataWorkerScheduler,
  StaticJobHandlerRegistry,
  type DataWorkerLogger,
} from './index.js';

function required(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

function positiveInteger(
  environment: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
): number {
  const value = environment[name];
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}

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
  const scope: DataJobScope = {
    tenantId: required(environment, 'WISER_DATA_TENANT_ID'),
    projectId: required(environment, 'WISER_DATA_PROJECT_ID'),
    maxSecurityLevel: required(
      environment,
      'WISER_DATA_MAX_SECURITY_LEVEL',
    ) as DataJobScope['maxSecurityLevel'],
    policyVersion: positiveInteger(environment, 'WISER_DATA_POLICY_VERSION', 1),
  };
  const repository = PostgresDataJobRepository.connect(
    required(environment, 'DATA_DATABASE_URL'),
  );
  const scheduler = new DataWorkerScheduler({
    repository,
    handlers: new StaticJobHandlerRegistry([]),
    logger,
    scope,
    workerId: environment['WISER_DATA_WORKER_ID'] ?? `worker-${randomUUID()}`,
    claimLimit: positiveInteger(environment, 'WISER_DATA_CLAIM_LIMIT', 8),
    leaseMs: positiveInteger(environment, 'WISER_DATA_LEASE_MS', 120_000),
    heartbeatIntervalMs: positiveInteger(
      environment,
      'WISER_DATA_HEARTBEAT_MS',
      30_000,
    ),
    pollIntervalMs: positiveInteger(environment, 'WISER_DATA_POLL_MS', 1_000),
  });
  const server = createDataWorkerHttpServer(scheduler);
  const port = positiveInteger(environment, 'DATA_WORKER_PORT', 3003);
  server.listen(port, '0.0.0.0');

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
