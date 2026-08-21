import { describe, expect, it } from 'vitest';

import { loadDataWorkerConfig } from '../src/config.js';

const TENANT_ID = '81000000-0000-4000-8000-000000000001';
const PROJECT_ID = '81000000-0000-4000-8000-000000000002';

const canonicalEnvironment = {
  DATA_DATABASE_URL:
    'postgresql://data_app:local@data-postgres:5432/wiser_data',
  DATA_TENANT_ID: TENANT_ID,
  DATA_PROJECT_ID: PROJECT_ID,
  DATA_MAX_SECURITY_LEVEL: 'L2_RESTRICTED',
  DATA_POLICY_VERSION: '7',
  DATA_WORKER_ID: 'worker-a',
  DATA_WORKER_CLAIM_LIMIT: '5',
  DATA_WORKER_HEALTH_HOST: '127.0.0.1',
  DATA_WORKER_HEALTH_PORT: '3003',
  DATA_JOB_LEASE_SECONDS: '120',
  DATA_JOB_HEARTBEAT_SECONDS: '30',
  DATA_JOB_POLL_INTERVAL_MS: '750',
} as const;

describe('Data Worker environment contract', () => {
  it('loads canonical DATA_* names and converts durations explicitly', () => {
    expect(loadDataWorkerConfig(canonicalEnvironment)).toEqual({
      databaseUrl: 'postgresql://data_app:local@data-postgres:5432/wiser_data',
      scope: {
        tenantId: TENANT_ID,
        projectId: PROJECT_ID,
        maxSecurityLevel: 'L2_RESTRICTED',
        policyVersion: 7,
      },
      workerId: 'worker-a',
      claimLimit: 5,
      leaseMs: 120_000,
      heartbeatIntervalMs: 30_000,
      pollIntervalMs: 750,
      healthHost: '127.0.0.1',
      healthPort: 3003,
      deprecatedAliases: [],
    });
  });

  it('prefers canonical names when legacy compatibility aliases coexist', () => {
    const config = loadDataWorkerConfig({
      ...canonicalEnvironment,
      WISER_DATA_TENANT_ID: '82000000-0000-4000-8000-000000000001',
      WISER_DATA_PROJECT_ID: '82000000-0000-4000-8000-000000000002',
      WISER_DATA_WORKER_ID: 'legacy-worker',
      WISER_DATA_LEASE_MS: '999999',
      DATA_WORKER_PORT: '3999',
    });

    expect(config.scope.tenantId).toBe(TENANT_ID);
    expect(config.scope.projectId).toBe(PROJECT_ID);
    expect(config.workerId).toBe('worker-a');
    expect(config.leaseMs).toBe(120_000);
    expect(config.healthPort).toBe(3003);
    expect(config.deprecatedAliases).toEqual([]);
  });

  it('supports the previous WISER_DATA_* names while reporting deprecation', () => {
    const config = loadDataWorkerConfig({
      DATA_DATABASE_URL: canonicalEnvironment.DATA_DATABASE_URL,
      WISER_DATA_TENANT_ID: TENANT_ID,
      WISER_DATA_PROJECT_ID: PROJECT_ID,
      WISER_DATA_MAX_SECURITY_LEVEL: 'L1_INTERNAL',
      WISER_DATA_POLICY_VERSION: '3',
      WISER_DATA_WORKER_ID: 'legacy-worker',
      WISER_DATA_CLAIM_LIMIT: '4',
      WISER_DATA_LEASE_MS: '90000',
      WISER_DATA_HEARTBEAT_MS: '15000',
      WISER_DATA_POLL_MS: '500',
      DATA_WORKER_PORT: '3013',
    });

    expect(config).toMatchObject({
      workerId: 'legacy-worker',
      claimLimit: 4,
      leaseMs: 90_000,
      heartbeatIntervalMs: 15_000,
      pollIntervalMs: 500,
      healthPort: 3013,
    });
    expect(config.deprecatedAliases).toEqual([
      'DATA_WORKER_PORT',
      'WISER_DATA_CLAIM_LIMIT',
      'WISER_DATA_HEARTBEAT_MS',
      'WISER_DATA_LEASE_MS',
      'WISER_DATA_MAX_SECURITY_LEVEL',
      'WISER_DATA_POLICY_VERSION',
      'WISER_DATA_POLL_MS',
      'WISER_DATA_PROJECT_ID',
      'WISER_DATA_TENANT_ID',
      'WISER_DATA_WORKER_ID',
    ]);
  });

  it.each([
    [{ ...canonicalEnvironment, DATA_DATABASE_URL: '' }],
    [{ ...canonicalEnvironment, DATA_TENANT_ID: '../tenant' }],
    [{ ...canonicalEnvironment, DATA_MAX_SECURITY_LEVEL: 'L4_SECRET' }],
    [{ ...canonicalEnvironment, DATA_JOB_LEASE_SECONDS: '0' }],
    [
      {
        ...canonicalEnvironment,
        DATA_JOB_LEASE_SECONDS: '30',
        DATA_JOB_HEARTBEAT_SECONDS: '30',
      },
    ],
    [{ ...canonicalEnvironment, DATA_WORKER_HEALTH_PORT: '70000' }],
  ])('fails closed for missing or invalid canonical configuration', (env) => {
    expect(() => loadDataWorkerConfig(env)).toThrow(
      'Invalid Data Worker configuration',
    );
  });
});
