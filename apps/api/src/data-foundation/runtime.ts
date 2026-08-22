import { Buffer } from 'node:buffer';

import { Pool } from 'pg';

import { DATA_CAPABILITY_IDS } from '@wiser/data-contracts';
import {
  DeterministicFakeEmbedding,
  Neo4jSearchBackend,
  OPENSEARCH_EVIDENCE_INDEX,
  OpenSearchSearchBackend,
  PgSTACSearchBackend,
  PostGISSearchBackend,
  SearchOrchestrator,
  WEAVIATE_EVIDENCE_COLLECTION,
  WeaviateSearchBackend,
  createS3AuthorityObjectStore,
  createS3AuthorityPresigner,
  createSeaweedFsS3Client,
} from '@wiser/data-infra';

import {
  DataCapabilityHandler,
  type DataCapabilityAuditPort,
  type DataCapabilityExecutor,
} from './capability-handler.js';
import { createDataFoundationGraphqlModule } from './graphql-module.js';
import { createDataFoundationModule } from './plugin.js';
import {
  createPostgresDataCommandRuntime,
  type DataCommandObjectStore,
} from './postgres-command-executors.js';
import { createPostgresDataReadRuntime } from './postgres-read-executors.js';
import {
  Neo4jGraphQueryPort,
  PostgisGeoQueryPort,
  PostgresStructuredDataQueryPort,
  type QueryAdapterHttpClient,
} from './query-adapters.js';
import {
  createDataFoundationRestModule,
  type DataFoundationAssetDownloadPort,
} from './rest-module.js';
import { createDataFoundationResourceModule } from './resource-module.js';
import { PostgresDataFoundationResourcePort } from './postgres-resource-port.js';
import type { DataFoundationResourcePort } from './resource-types.js';
import {
  PostgresDataAssetDownloadPort,
  type AssetDownloadObjectStore,
} from './postgres-asset-download.js';
import {
  loadDataFoundationApiRuntimeConfig,
  type DataFoundationApiRuntimeConfig,
} from './runtime-config.js';
import { createSpecialQueryExecutors } from './special-query-executors.js';
import type { PlatformAuthRuntime } from '../platform/auth-runtime.js';
import type { WiserApiModule } from '../platform/modules.js';

export interface DataFoundationSharedPool {
  close(): Promise<void>;
}

export interface DataFoundationObjectStoreResource {
  readonly store: unknown;
  probe(): Promise<boolean>;
  close(): Promise<void>;
}

interface ExecutorRuntime {
  readonly executors: readonly DataCapabilityExecutor[];
}

interface ReadExecutorRuntime extends ExecutorRuntime {
  readonly audit: DataCapabilityAuditPort;
}

export interface DataFoundationRuntimeFactories {
  createPool(
    config: Extract<DataFoundationApiRuntimeConfig, { mode: 'enabled' }>,
  ): DataFoundationSharedPool;
  createObjectStore(
    config: Extract<DataFoundationApiRuntimeConfig, { mode: 'enabled' }>,
  ): DataFoundationObjectStoreResource;
  createReadRuntime(pool: DataFoundationSharedPool): ReadExecutorRuntime;
  createCommandRuntime(
    pool: DataFoundationSharedPool,
    objectStore: unknown,
  ): ExecutorRuntime;
  createSpecialExecutors(
    config: Extract<DataFoundationApiRuntimeConfig, { mode: 'enabled' }>,
    pool: DataFoundationSharedPool,
  ): readonly DataCapabilityExecutor[];
  createAssetDownloadPort(
    pool: DataFoundationSharedPool,
    objectStore: unknown,
  ): DataFoundationAssetDownloadPort;
  createResourcePort(
    config: Extract<DataFoundationApiRuntimeConfig, { mode: 'enabled' }>,
    pool: DataFoundationSharedPool,
  ): DataFoundationResourcePort;
  probeDatabase(pool: DataFoundationSharedPool): Promise<boolean>;
  probeWorker(workerUrl: string): Promise<boolean>;
}

export interface DataFoundationRuntime {
  readonly enabled: boolean;
  readonly modules: readonly WiserApiModule[];
  readonly executors: readonly DataCapabilityExecutor[];
}

interface DefaultPool extends DataFoundationSharedPool {
  readonly pg: Pool;
}

function safeFetchProbe(url: string): Promise<boolean> {
  return fetch(url, { signal: AbortSignal.timeout(2_000) })
    .then((response) => response.ok)
    .catch(() => false);
}

const boundedHttpClient: QueryAdapterHttpClient = {
  async request(request) {
    let response: Response;
    try {
      response = await fetch(request.url, {
        method: request.method,
        headers: request.headers,
        body: JSON.stringify(request.body),
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(15_000)]),
      });
    } catch {
      throw new Error('Data projection HTTP backend is unavailable.');
    }
    const text = await response.text();
    if (Buffer.byteLength(text) > 2_000_000) {
      throw new Error('Data projection HTTP response is too large.');
    }
    let body: unknown;
    try {
      body = text.length === 0 ? {} : JSON.parse(text);
    } catch {
      throw new Error('Data projection HTTP response is invalid.');
    }
    return { status: response.status, body };
  },
};

const defaultFactories: DataFoundationRuntimeFactories = {
  createPool(config) {
    const pg = new Pool({
      connectionString: config.databaseUrl,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
    return { pg, close: () => pg.end() };
  },
  createObjectStore(config) {
    const client = createSeaweedFsS3Client(config.objectStore);
    const signingClient = createSeaweedFsS3Client({
      ...config.objectStore,
      endpoint: config.objectStorePublicEndpoint,
    });
    const store = createS3AuthorityObjectStore({
      bucket: config.objectStore.bucket,
      client,
      presign: createS3AuthorityPresigner(signingClient),
    });
    return {
      store,
      probe: () => safeFetchProbe(`${config.objectStore.endpoint}/status`),
      close: () => {
        client.destroy();
        signingClient.destroy();
        return Promise.resolve();
      },
    };
  },
  createReadRuntime(pool) {
    return createPostgresDataReadRuntime((pool as DefaultPool).pg);
  },
  createCommandRuntime(pool, objectStore) {
    return createPostgresDataCommandRuntime(
      (pool as DefaultPool).pg,
      objectStore as DataCommandObjectStore,
    );
  },
  createSpecialExecutors(config, pool) {
    const pg = (pool as DefaultPool).pg;
    const embedding = new DeterministicFakeEmbedding({
      dimensions: config.fakeEmbeddingDimensions,
      version: '1.0.0-fixture',
    });
    const search = new SearchOrchestrator({
      openSearch: new OpenSearchSearchBackend({
        endpoint: config.openSearch.url,
        indexName: OPENSEARCH_EVIDENCE_INDEX,
        username: config.openSearch.username,
        password: config.openSearch.password,
      }),
      weaviate: new WeaviateSearchBackend({
        endpoint: config.weaviate.url,
        apiKey: config.weaviate.apiKey,
        collectionName: WEAVIATE_EVIDENCE_COLLECTION,
        embed: (text) => embedding.embed(text),
      }),
      neo4j: new Neo4jSearchBackend({
        endpoint: config.neo4j.url,
        database: config.neo4j.database,
        username: config.neo4j.username,
        password: config.neo4j.password,
      }),
      postgis: new PostGISSearchBackend({ pool: pg }),
      pgstac: new PgSTACSearchBackend({
        endpoint: config.stac.url,
        bearerToken: config.stac.bearerToken,
      }),
    });
    return createSpecialQueryExecutors({
      search,
      data: new PostgresStructuredDataQueryPort({ pool: pg }),
      graph: new Neo4jGraphQueryPort({
        baseUrl: config.neo4j.url,
        database: config.neo4j.database,
        authorization: `Basic ${Buffer.from(
          `${config.neo4j.username}:${config.neo4j.password}`,
        ).toString('base64')}`,
        http: boundedHttpClient,
      }),
      geo: new PostgisGeoQueryPort({ pool: pg }),
    });
  },
  createAssetDownloadPort(pool, objectStore) {
    return new PostgresDataAssetDownloadPort({
      pool: (pool as DefaultPool).pg,
      objectStore: objectStore as AssetDownloadObjectStore,
      ttlSeconds: 60,
    });
  },
  createResourcePort(config, pool) {
    return new PostgresDataFoundationResourcePort({
      pool: (pool as DefaultPool).pg,
      stac: {
        baseUrl: config.stac.url,
        bearerToken: config.stac.bearerToken,
        publicApiOrigin: config.publicApiOrigin,
      },
    });
  },
  async probeDatabase(pool) {
    try {
      await (pool as DefaultPool).pg.query('select 1');
      return true;
    } catch {
      return false;
    }
  },
  probeWorker(workerUrl) {
    return safeFetchProbe(`${workerUrl}/health/ready`);
  },
};

function exactExecutors(
  groups: readonly (readonly DataCapabilityExecutor[])[],
): readonly DataCapabilityExecutor[] {
  const executors = groups.flat();
  const ids = executors.map(({ id }) => id);
  if (
    executors.length !== DATA_CAPABILITY_IDS.length ||
    new Set(ids).size !== DATA_CAPABILITY_IDS.length ||
    DATA_CAPABILITY_IDS.some((id) => !ids.includes(id))
  ) {
    throw new Error(
      'Data Foundation runtime must compose exactly 22 Capability executors.',
    );
  }
  return Object.freeze([...executors]);
}

export function createDataFoundationRuntimeFromEnvironment(
  environment: NodeJS.ProcessEnv,
  platformAuth: PlatformAuthRuntime,
  factories: DataFoundationRuntimeFactories = defaultFactories,
): DataFoundationRuntime {
  const config = loadDataFoundationApiRuntimeConfig(environment);
  if (config.mode === 'off') {
    return Object.freeze({ enabled: false, modules: [], executors: [] });
  }
  if (platformAuth.resolver === null) {
    throw new Error(
      'Data Foundation requires unified Auth and cannot run with Auth off.',
    );
  }

  const pool = factories.createPool(config);
  const objectStore = factories.createObjectStore(config);
  let closed = false;
  const closeOnce = async () => {
    if (closed) return;
    closed = true;
    const results = await Promise.allSettled([
      pool.close(),
      objectStore.close(),
    ]);
    if (results.some(({ status }) => status === 'rejected')) {
      throw new Error('Data Foundation resources could not close cleanly.');
    }
  };

  try {
    const read = factories.createReadRuntime(pool);
    const command = factories.createCommandRuntime(pool, objectStore.store);
    const special = factories.createSpecialExecutors(config, pool);
    const assetDownload = factories.createAssetDownloadPort(
      pool,
      objectStore.store,
    );
    const resources = factories.createResourcePort(config, pool);
    const executors = exactExecutors([
      read.executors,
      command.executors,
      special,
    ]);
    const handler = new DataCapabilityHandler({
      executors,
      audit: read.audit,
    });
    const readiness = async () => {
      const [database, objectStoreReady, worker] = await Promise.all([
        factories.probeDatabase(pool).catch(() => false),
        objectStore.probe().catch(() => false),
        factories.probeWorker(config.workerUrl).catch(() => false),
      ]);
      return { database, objectStore: objectStoreReady, worker };
    };
    const baseHealth = createDataFoundationModule({ readiness });
    const health: WiserApiModule = {
      ...baseHealth,
      async register(app) {
        await baseHealth.register(app);
        app.addHook('onClose', closeOnce);
      },
    };
    const modules = Object.freeze([
      health,
      createDataFoundationRestModule({
        resolver: platformAuth.resolver,
        handler,
        assetDownload,
      }),
      createDataFoundationGraphqlModule({
        resolver: platformAuth.resolver,
        handler,
        production: environment['NODE_ENV'] === 'production',
      }),
      createDataFoundationResourceModule({
        resolver: platformAuth.resolver,
        resources,
      }),
    ]);
    return Object.freeze({ enabled: true, modules, executors });
  } catch (error) {
    void closeOnce().catch(() => undefined);
    throw error;
  }
}
