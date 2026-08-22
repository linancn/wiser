import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

import {
  DATA_CAPABILITY_IDS,
  type DataCapabilityId,
} from '@wiser/data-contracts';

import { buildApp } from '../src/app.js';
import { createDefaultApiModules } from '../src/main.js';
import type {
  DataCapabilityAuditPort,
  DataCapabilityExecutor,
} from '../src/data-foundation/capability-handler.js';
import {
  createDataFoundationRuntimeFromEnvironment,
  type DataFoundationRuntimeFactories,
} from '../src/data-foundation/runtime.js';
import type { PlatformAuthRuntime } from '../src/platform/auth-runtime.js';

const enabledEnvironment = {
  DATA_FOUNDATION_MODE: 'enabled',
  DATA_DATABASE_URL: 'postgresql://data:secret@data-postgres:5432/wiser',
  DATA_S3_ENDPOINT: 'http://seaweedfs:8333',
  DATA_S3_PUBLIC_ENDPOINT: 'http://127.0.0.1:18333',
  DATA_S3_REGION: 'us-east-1',
  DATA_S3_BUCKET: 'wiser-authority',
  DATA_S3_ACCESS_KEY_ID: 'local-access',
  DATA_S3_SECRET_ACCESS_KEY: 'local-secret-value',
  DATA_WORKER_URL: 'http://data-worker:3003',
  DATA_WEAVIATE_URL: 'http://weaviate:8080',
  DATA_WEAVIATE_API_KEY: 'weaviate-secret',
  DATA_OPENSEARCH_URL: 'http://opensearch:9200',
  DATA_OPENSEARCH_USERNAME: 'wiser',
  DATA_OPENSEARCH_PASSWORD: 'opensearch-secret',
  DATA_NEO4J_URL: 'http://neo4j:7474',
  DATA_NEO4J_DATABASE: 'neo4j',
  DATA_NEO4J_USERNAME: 'wiser',
  DATA_NEO4J_PASSWORD: 'neo4j-secret',
  DATA_STAC_API_URL: 'http://stac-api:8080',
  DATA_STAC_API_BEARER_TOKEN: 'stac-bearer-secret',
  DATA_PUBLIC_API_ORIGIN: 'http://api:3001',
} as NodeJS.ProcessEnv;

const authRuntime: PlatformAuthRuntime = {
  module: { id: 'platform.auth-runtime', register() {} },
  resolver: { resolve: () => Promise.resolve(null) },
};

function executor(id: DataCapabilityId): DataCapabilityExecutor {
  return { id, execute: () => Promise.resolve({}) };
}

const readIds = [
  'data.catalog.search',
  'data.catalog.get',
  'data.catalog.versions.list',
  'data.catalog.versions.get',
  'data.ingestion.get',
  'data.operation.get',
  'data.operation.events',
] as const;
const commandIds = DATA_CAPABILITY_IDS.filter(
  (id) =>
    !readIds.includes(id as (typeof readIds)[number]) &&
    ![
      'data.query',
      'data.search.federated',
      'data.knowledge.search',
      'data.graph.expand',
      'data.graph.findPath',
      'data.geo.query',
      'data.geo.intersect',
    ].includes(id),
);
const specialIds = [
  'data.query',
  'data.search.federated',
  'data.knowledge.search',
  'data.graph.expand',
  'data.graph.findPath',
  'data.geo.query',
  'data.geo.intersect',
] as const;

function factories(overrides: Partial<DataFoundationRuntimeFactories> = {}) {
  const closePool = vi.fn(() => Promise.resolve());
  const closeObjectStore = vi.fn(() => Promise.resolve());
  const createPool = vi.fn(() => ({ close: closePool }));
  const audit: DataCapabilityAuditPort = { record: () => Promise.resolve() };
  const value: DataFoundationRuntimeFactories = {
    createPool,
    createObjectStore: vi.fn(() => ({
      store: {} as never,
      close: closeObjectStore,
      probe: () => Promise.resolve(true),
    })),
    createReadRuntime: vi.fn(() => ({
      executors: readIds.map(executor),
      audit,
    })),
    createCommandRuntime: vi.fn(() => ({
      executors: commandIds.map(executor),
    })),
    createSpecialExecutors: vi.fn(() => specialIds.map(executor)),
    probeDatabase: vi.fn(() => Promise.resolve(true)),
    probeWorker: vi.fn(() => Promise.resolve(true)),
    ...overrides,
  };
  return { value, closePool, closeObjectStore, createPool };
}

const openApps: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(openApps.splice(0).map((app) => app.close()));
});

describe('Data Foundation production runtime composition', () => {
  it('keeps Platform Auth, Data Foundation, and the existing EXCON host composition together', () => {
    const dataModules = [
      { id: 'data.foundation', register() {} },
      { id: 'data.foundation.rest', register() {} },
      { id: 'data.foundation.graphql', register() {} },
    ];
    const modules = createDefaultApiModules(
      {},
      {
        createPlatformAuthRuntime: () => authRuntime,
        createDataFoundationRuntime: () => ({
          enabled: true,
          modules: dataModules,
          executors: [],
        }),
      },
    );
    expect(modules.map(({ id }) => id)).toEqual([
      'platform.auth-runtime',
      'data.foundation',
      'data.foundation.rest',
      'data.foundation.graphql',
    ]);
  });

  it('merges exactly 7 read + 8 command + 7 special executors in static module order', async () => {
    const injected = factories();
    const runtime = createDataFoundationRuntimeFromEnvironment(
      enabledEnvironment,
      authRuntime,
      injected.value,
    );

    expect(runtime.executors.map(({ id }) => id).sort()).toEqual(
      [...DATA_CAPABILITY_IDS].sort(),
    );
    expect(runtime.modules.map(({ id }) => id)).toEqual([
      'data.foundation',
      'data.foundation.rest',
      'data.foundation.graphql',
    ]);
    const app = buildApp({ logger: false, modules: runtime.modules });
    openApps.push(app);
    await app.ready();
    await app.close();
    openApps.pop();
    expect(injected.closePool).toHaveBeenCalledOnce();
    expect(injected.closeObjectStore).toHaveBeenCalledOnce();
  });

  it('fails closed for Data enabled without unified Auth or partial executor sets', () => {
    expect(() =>
      createDataFoundationRuntimeFromEnvironment(
        enabledEnvironment,
        { module: null, resolver: null },
        factories().value,
      ),
    ).toThrow('unified Auth');

    const incomplete = factories({
      createSpecialExecutors: () => specialIds.slice(1).map(executor),
    });
    expect(() =>
      createDataFoundationRuntimeFromEnvironment(
        enabledEnvironment,
        authRuntime,
        incomplete.value,
      ),
    ).toThrow('22');
  });

  it('reports degraded readiness without leaking probe failures', async () => {
    const injected = factories({
      probeDatabase: () => Promise.reject(new Error('postgres secret')),
      probeWorker: () => Promise.resolve(false),
    });
    const runtime = createDataFoundationRuntimeFromEnvironment(
      enabledEnvironment,
      authRuntime,
      injected.value,
    );
    const app = buildApp({ logger: false, modules: runtime.modules });
    openApps.push(app);
    const response = await app.inject({
      method: 'GET',
      url: '/api/data/v1/health',
    });
    expect(response.statusCode).toBe(503);
    expect(response.body).not.toContain('secret');
    expect(response.json()).toMatchObject({
      authority: { database: false, objectStore: true },
      worker: false,
    });
  });

  it('leaves Data disabled without allocating resources', () => {
    const injected = factories();
    const runtime = createDataFoundationRuntimeFromEnvironment(
      { NODE_ENV: 'development', DATA_FOUNDATION_MODE: 'off' },
      { module: null, resolver: null },
      injected.value,
    );
    expect(runtime.modules).toEqual([]);
    expect(injected.createPool).not.toHaveBeenCalled();
  });
});
