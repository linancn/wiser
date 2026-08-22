import { describe, expect, it } from 'vitest';

import { loadDataWorkerConfig } from '../src/config.js';

const TENANT_ID = '81000000-0000-4000-8000-000000000001';
const PROJECT_ID = '81000000-0000-4000-8000-000000000002';

const dependencyEnvironment = {
  DATA_WORKER_ACTOR_ID: '81000000-0000-4000-8000-000000000003',
  DATA_S3_ENDPOINT: 'http://seaweedfs:8333',
  DATA_S3_REGION: 'us-east-1',
  DATA_S3_BUCKET: 'wiser-authority',
  DATA_S3_ACCESS_KEY_ID: 'wiser-data-access',
  DATA_S3_SECRET_ACCESS_KEY: 'wiser-data-secret-value',
  DATA_CLAMAV_HOST: 'clamav',
  DATA_CLAMAV_PORT: '3310',
  DATA_CLAMAV_TIMEOUT_MS: '30000',
  DATA_CLAMAV_MAX_RESPONSE_BYTES: '4096',
  DATA_TIKA_ENDPOINT: 'http://tika:9998',
  DATA_TIKA_TIMEOUT_MS: '30000',
  DATA_INGESTION_MAX_OBJECT_BYTES: '10485760',
  DATA_TIKA_MAX_RESPONSE_BYTES: '1048576',
  DATA_INGESTION_MIN_QUALITY_SCORE: '0.75',
  DATA_INGESTION_MIN_AI_CONFIDENCE: '0.8',
  DATA_WEAVIATE_URL: 'http://weaviate:8080',
  DATA_WEAVIATE_API_KEY: 'wiser-weaviate-key',
  DATA_OPENSEARCH_URL: 'https://opensearch:9200',
  DATA_OPENSEARCH_USERNAME: 'admin',
  DATA_OPENSEARCH_PASSWORD: 'WiserOpenSearchPassword',
  DATA_NEO4J_URL: 'http://neo4j:7474',
  DATA_NEO4J_DATABASE: 'neo4j',
  DATA_NEO4J_USERNAME: 'neo4j',
  DATA_NEO4J_PASSWORD: 'WiserNeo4jPassword',
  DATA_STAC_API_URL: 'http://stac-api:8080',
  DATA_STAC_BEARER_TOKEN: 'wiser-stac-token-value',
  DATA_STAC_ASSET_BASE_URL: 'http://api:3001',
  DATA_PROJECTION_CONSUMER_NAME: 'data-worker-projection-v1',
  DATA_PROJECTION_BATCH_LIMIT: '8',
  DATA_PROJECTION_POLL_INTERVAL_MS: '1000',
  DATA_PROJECTION_HTTP_TIMEOUT_MS: '30000',
  DATA_PROJECTION_HTTP_MAX_RESPONSE_BYTES: '1048576',
  DATA_PROJECTION_CACHE_EVENTS: '32',
  DATA_FAKE_EMBEDDING_DIMENSIONS: '32',
  DATA_FAKE_EMBEDDING_VERSION: '1.0.0-fixture',
  DATA_PUBLICATION_WAIT_TIMEOUT_MS: '90000',
  DATA_PUBLICATION_WAIT_POLL_MS: '250',
} as const;

const canonicalEnvironment = {
  ...dependencyEnvironment,
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
      workerActorId: dependencyEnvironment.DATA_WORKER_ACTOR_ID,
      objectStore: {
        endpoint: 'http://seaweedfs:8333',
        region: 'us-east-1',
        bucket: 'wiser-authority',
        forcePathStyle: true,
        credentials: {
          accessKeyId: 'wiser-data-access',
          secretAccessKey: 'wiser-data-secret-value',
        },
      },
      ingestion: {
        clamavHost: 'clamav',
        clamavPort: 3310,
        clamavTimeoutMs: 30000,
        clamavMaximumResponseBytes: 4096,
        tikaEndpoint: 'http://tika:9998',
        tikaTimeoutMs: 30000,
        maximumObjectBytes: 10485760,
        tikaMaximumResponseBytes: 1048576,
        minimumQualityScore: 0.75,
        minimumAiConfidence: 0.8,
      },
      projection: {
        weaviateBaseUrl: 'http://weaviate:8080',
        weaviateApiKey: 'wiser-weaviate-key',
        openSearchBaseUrl: 'https://opensearch:9200',
        openSearchUsername: 'admin',
        openSearchPassword: 'WiserOpenSearchPassword',
        neo4jBaseUrl: 'http://neo4j:7474',
        neo4jDatabase: 'neo4j',
        neo4jUsername: 'neo4j',
        neo4jPassword: 'WiserNeo4jPassword',
        stacBaseUrl: 'http://stac-api:8080',
        stacBearerToken: 'wiser-stac-token-value',
        stacAssetBaseUrl: 'http://api:3001',
        consumerName: 'data-worker-projection-v1',
        batchLimit: 8,
        pollIntervalMs: 1000,
        httpTimeoutMs: 30000,
        httpMaximumResponseBytes: 1048576,
        maximumCachedEvents: 32,
        embeddingDimensions: 32,
        embeddingVersion: '1.0.0-fixture',
        publicationWaitTimeoutMs: 90000,
        publicationWaitPollMs: 250,
      },
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
      ...dependencyEnvironment,
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
      DATA_PUBLICATION_WAIT_TIMEOUT_MS: '60000',
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
    [{ ...canonicalEnvironment, DATA_S3_SECRET_ACCESS_KEY: '' }],
    [{ ...canonicalEnvironment, DATA_TIKA_ENDPOINT: 'file:///tmp/tika' }],
    [{ ...canonicalEnvironment, DATA_INGESTION_MIN_QUALITY_SCORE: '1.1' }],
    [
      {
        ...canonicalEnvironment,
        DATA_WEAVIATE_URL: 'http://user@weaviate:8080',
      },
    ],
    [{ ...canonicalEnvironment, DATA_PROJECTION_BATCH_LIMIT: '101' }],
    [{ ...canonicalEnvironment, DATA_FAKE_EMBEDDING_VERSION: 'fixture-v1' }],
  ])('fails closed for missing or invalid canonical configuration', (env) => {
    expect(() => loadDataWorkerConfig(env)).toThrow(
      'Invalid Data Worker configuration',
    );
  });
});
