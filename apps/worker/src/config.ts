import { hostname } from 'node:os';

import type { PoolConfig } from 'pg';

import { WorkerError } from './types.js';

export interface WorkerConfig {
  readonly database: PoolConfig;
  readonly workerId: string;
  readonly claimLimit: number;
  readonly leaseMs: number;
  readonly pollIntervalMs: number;
  readonly healthHost: string;
  readonly healthPort: number;
}

function positiveInteger(
  value: string | undefined,
  fallback: number,
  field: string,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new WorkerError(
      'INVALID_WORKER_CONFIG',
      `${field} must be an integer between 1 and ${maximum}.`,
    );
  }
  return parsed;
}

export function loadWorkerConfig(
  environment: NodeJS.ProcessEnv = process.env,
): WorkerConfig {
  const connectionString = environment.DATABASE_URL;
  if (connectionString === undefined || connectionString.length === 0) {
    throw new WorkerError('INVALID_WORKER_CONFIG', 'DATABASE_URL is required.');
  }
  return {
    database: {
      connectionString,
      application_name: 'agent-excon-evaluation-worker',
      max: positiveInteger(
        environment.WORKER_DB_POOL_SIZE,
        5,
        'WORKER_DB_POOL_SIZE',
        50,
      ),
    },
    workerId:
      environment.WORKER_ID ?? `${hostname()}-evaluation-worker-${process.pid}`,
    claimLimit: positiveInteger(
      environment.WORKER_CLAIM_LIMIT,
      4,
      'WORKER_CLAIM_LIMIT',
      100,
    ),
    leaseMs: positiveInteger(
      environment.WORKER_LEASE_MS,
      120_000,
      'WORKER_LEASE_MS',
    ),
    pollIntervalMs: positiveInteger(
      environment.WORKER_POLL_INTERVAL_MS,
      1_000,
      'WORKER_POLL_INTERVAL_MS',
    ),
    healthHost: environment.WORKER_HEALTH_HOST ?? '0.0.0.0',
    healthPort: positiveInteger(
      environment.WORKER_HEALTH_PORT,
      8081,
      'WORKER_HEALTH_PORT',
      65_535,
    ),
  };
}
