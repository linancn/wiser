import { describe, expect, it } from 'vitest';

import { loadDataFoundationApiRuntimeConfig } from '../src/data-foundation/runtime-config.js';

const complete = {
  NODE_ENV: 'test',
  DATA_FOUNDATION_MODE: 'enabled',
  DATA_DATABASE_URL:
    'postgresql://wiser_runtime:local@data-postgres:5432/wiser_data',
  DATA_S3_ENDPOINT: 'http://seaweedfs:8333',
  DATA_S3_PUBLIC_ENDPOINT: 'http://127.0.0.1:18333',
  DATA_S3_REGION: 'us-east-1',
  DATA_S3_BUCKET: 'wiser-authority',
  DATA_S3_ACCESS_KEY_ID: 'wiser-runtime',
  DATA_S3_SECRET_ACCESS_KEY: 'local-secret-value',
  DATA_WORKER_URL: 'http://data-worker:3003',
  DATA_WEAVIATE_URL: 'http://weaviate:8080',
  DATA_WEAVIATE_API_KEY: 'local-weaviate-key',
  DATA_OPENSEARCH_URL: 'https://opensearch:9200',
  DATA_OPENSEARCH_USERNAME: 'wiser_search',
  DATA_OPENSEARCH_PASSWORD: 'local-opensearch-password',
  DATA_NEO4J_URL: 'http://neo4j:7474',
  DATA_NEO4J_DATABASE: 'neo4j',
  DATA_NEO4J_USERNAME: 'neo4j',
  DATA_NEO4J_PASSWORD: 'local-neo4j-password',
  DATA_STAC_API_URL: 'http://stac-api:8080',
  DATA_STAC_API_BEARER_TOKEN: 'local-stac-bearer-token',
  DATA_PUBLIC_API_ORIGIN: 'http://api:3001',
  DATA_FAKE_EMBEDDING_DIMENSIONS: '64',
} as const;

describe('Data Foundation API runtime configuration', () => {
  it('stays explicitly disabled for an unconfigured local EXCON process', () => {
    expect(
      loadDataFoundationApiRuntimeConfig({ NODE_ENV: 'development' }),
    ).toEqual({ mode: 'off' });
    expect(
      loadDataFoundationApiRuntimeConfig({
        NODE_ENV: 'development',
        DATA_FOUNDATION_MODE: 'off',
      }),
    ).toEqual({ mode: 'off' });
  });

  it('defaults production to enabled and fails closed without every authority/projection dependency', () => {
    expect(() =>
      loadDataFoundationApiRuntimeConfig({ NODE_ENV: 'production' }),
    ).toThrow('DATA_DATABASE_URL');
    expect(() =>
      loadDataFoundationApiRuntimeConfig({
        NODE_ENV: 'production',
        DATA_FOUNDATION_MODE: 'off',
      }),
    ).toThrow('forbidden in production');
    expect(() =>
      loadDataFoundationApiRuntimeConfig({
        ...complete,
        DATA_NEO4J_PASSWORD: undefined,
      }),
    ).toThrow('DATA_NEO4J_PASSWORD');
  });

  it('returns canonical credential-free endpoints and exact bounded runtime values', () => {
    expect(loadDataFoundationApiRuntimeConfig(complete)).toEqual({
      mode: 'enabled',
      databaseUrl: complete.DATA_DATABASE_URL,
      objectStore: {
        endpoint: complete.DATA_S3_ENDPOINT,
        region: complete.DATA_S3_REGION,
        bucket: complete.DATA_S3_BUCKET,
        forcePathStyle: true,
        credentials: {
          accessKeyId: complete.DATA_S3_ACCESS_KEY_ID,
          secretAccessKey: complete.DATA_S3_SECRET_ACCESS_KEY,
        },
      },
      objectStorePublicEndpoint: complete.DATA_S3_PUBLIC_ENDPOINT,
      workerUrl: complete.DATA_WORKER_URL,
      weaviate: {
        url: complete.DATA_WEAVIATE_URL,
        apiKey: complete.DATA_WEAVIATE_API_KEY,
      },
      openSearch: {
        url: complete.DATA_OPENSEARCH_URL,
        username: complete.DATA_OPENSEARCH_USERNAME,
        password: complete.DATA_OPENSEARCH_PASSWORD,
      },
      neo4j: {
        url: complete.DATA_NEO4J_URL,
        database: complete.DATA_NEO4J_DATABASE,
        username: complete.DATA_NEO4J_USERNAME,
        password: complete.DATA_NEO4J_PASSWORD,
      },
      stac: {
        url: complete.DATA_STAC_API_URL,
        bearerToken: complete.DATA_STAC_API_BEARER_TOKEN,
      },
      publicApiOrigin: complete.DATA_PUBLIC_API_ORIGIN,
      fakeEmbeddingDimensions: 64,
    });
  });

  it('rejects URLs containing credentials and never echoes configured secrets', () => {
    const error = (() => {
      try {
        loadDataFoundationApiRuntimeConfig({
          ...complete,
          DATA_WEAVIATE_URL: 'http://admin:secret@weaviate:8080',
        });
      } catch (caught) {
        return caught;
      }
    })();
    expect(String(error)).toContain('DATA_WEAVIATE_URL');
    expect(String(error)).not.toContain('admin');
    expect(String(error)).not.toContain('secret');
  });
});
