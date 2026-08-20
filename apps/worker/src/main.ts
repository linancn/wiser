import { closeHealthServer, createHealthServer } from './health-server.js';
import { loadWorkerConfig } from './config.js';
import { ConsoleJsonLogger, toLogFields } from './logger.js';
import { PostgresEvaluationRepository } from './postgres-repository.js';
import { EvaluationWorker } from './worker.js';

async function main(): Promise<void> {
  const config = loadWorkerConfig();
  const logger = new ConsoleJsonLogger();
  const repository = new PostgresEvaluationRepository(config.database);
  const worker = new EvaluationWorker({
    repository,
    logger,
    workerId: config.workerId,
    claimLimit: config.claimLimit,
    leaseMs: config.leaseMs,
    pollIntervalMs: config.pollIntervalMs,
  });
  const healthServer = createHealthServer(worker, {
    host: config.healthHost,
    port: config.healthPort,
  });
  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('shutdown_signal_received', { signal });
    await closeHealthServer(healthServer);
    await worker.stop();
  };
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  await worker.run();
}

void main().catch((error: unknown) => {
  const logger = new ConsoleJsonLogger();
  logger.error('evaluation_worker_fatal', toLogFields(error));
  process.exitCode = 1;
});
