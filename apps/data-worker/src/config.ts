import {
  loadSeaweedFsS3AuthorityConfig,
  type DataJobScope,
  type SeaweedFsS3AuthorityConfig,
} from '@wiser/data-infra';

export interface DataWorkerRuntimeConfig {
  readonly databaseUrl: string;
  readonly scope: DataJobScope;
  readonly workerId: string;
  readonly claimLimit: number;
  readonly leaseMs: number;
  readonly heartbeatIntervalMs: number;
  readonly pollIntervalMs: number;
  readonly healthHost: string;
  readonly healthPort: number;
  readonly workerActorId: string;
  readonly objectStore: SeaweedFsS3AuthorityConfig;
  readonly ingestion: {
    readonly clamavHost: string;
    readonly clamavPort: number;
    readonly clamavTimeoutMs: number;
    readonly clamavMaximumResponseBytes: number;
    readonly tikaEndpoint: string;
    readonly tikaTimeoutMs: number;
    readonly maximumObjectBytes: number;
    readonly tikaMaximumResponseBytes: number;
    readonly minimumQualityScore: number;
    readonly minimumAiConfidence: number;
  };
  readonly projection: {
    readonly weaviateBaseUrl: string;
    readonly weaviateApiKey: string;
    readonly openSearchBaseUrl: string;
    readonly openSearchUsername: string;
    readonly openSearchPassword: string;
    readonly neo4jBaseUrl: string;
    readonly neo4jDatabase: string;
    readonly neo4jUsername: string;
    readonly neo4jPassword: string;
    readonly stacBaseUrl: string;
    readonly stacBearerToken: string;
    readonly stacAssetBaseUrl: string;
    readonly consumerName: string;
    readonly batchLimit: number;
    readonly pollIntervalMs: number;
    readonly httpTimeoutMs: number;
    readonly httpMaximumResponseBytes: number;
    readonly maximumCachedEvents: number;
    readonly embeddingDimensions: number;
    readonly embeddingVersion: string;
    readonly publicationWaitTimeoutMs: number;
    readonly publicationWaitPollMs: number;
  };
  readonly deprecatedAliases: readonly string[];
}

interface ResolvedValue {
  readonly value: string | undefined;
  readonly alias?: string;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SEMANTIC_VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const SECURITY_LEVELS = new Set<DataJobScope['maxSecurityLevel']>([
  'L0_PUBLIC',
  'L1_INTERNAL',
  'L2_RESTRICTED',
  'L3_CONFIDENTIAL',
]);

function invalid(name: string): Error {
  return new Error(`Invalid Data Worker configuration: ${name}.`);
}

function resolveValue(
  environment: Readonly<Record<string, string | undefined>>,
  canonical: string,
  aliases: readonly string[] = [],
): ResolvedValue {
  if (environment[canonical] !== undefined) {
    return { value: environment[canonical] };
  }
  for (const alias of aliases) {
    if (environment[alias] !== undefined) {
      return { value: environment[alias], alias };
    }
  }
  return { value: undefined };
}

function required(value: ResolvedValue, name: string): string {
  if (value.value === undefined || value.value.length === 0)
    throw invalid(name);
  return value.value;
}

function integer(
  value: ResolvedValue,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (value.value === undefined) return fallback;
  const parsed = Number(value.value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw invalid(name);
  }
  return parsed;
}

function postgresUrl(value: string): string {
  try {
    const url = new URL(value);
    if (
      (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') ||
      url.hostname.length === 0 ||
      url.pathname.length < 2
    ) {
      throw invalid('DATA_DATABASE_URL');
    }
    return value;
  } catch {
    throw invalid('DATA_DATABASE_URL');
  }
}

function rootUrl(value: ResolvedValue, name: string): string {
  const raw = required(value, name);
  try {
    const url = new URL(raw);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (url.pathname !== '' && url.pathname !== '/')
    ) {
      throw invalid(name);
    }
    return url.origin;
  } catch {
    throw invalid(name);
  }
}

function decimal(
  value: ResolvedValue,
  name: string,
  minimum: number,
  maximum: number,
): number {
  const parsed = Number(required(value, name));
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) {
    throw invalid(name);
  }
  return parsed;
}

function secret(value: ResolvedValue, name: string, minimum = 8): string {
  const raw = required(value, name);
  if (
    raw.length < minimum ||
    raw.length > 2_048 ||
    [...raw].some((character) => {
      const code = character.charCodeAt(0);
      return code <= 31 || code === 127;
    })
  ) {
    throw invalid(name);
  }
  return raw;
}

function hostname(value: ResolvedValue, name: string): string {
  const raw = required(value, name);
  if (
    raw.length > 253 ||
    !/^[A-Za-z0-9][A-Za-z0-9.-]*$/.test(raw) ||
    raw.includes('..')
  ) {
    throw invalid(name);
  }
  return raw;
}

function safeKey(
  value: ResolvedValue,
  name: string,
  pattern = /^[A-Za-z][A-Za-z0-9._-]{0,127}$/,
): string {
  const raw = required(value, name);
  if (!pattern.test(raw)) throw invalid(name);
  return raw;
}

export function loadDataWorkerConfig(
  environment: Readonly<Record<string, string | undefined>>,
): DataWorkerRuntimeConfig {
  const usedAliases: string[] = [];
  const value = (canonical: string, aliases: readonly string[] = []) => {
    const resolved = resolveValue(environment, canonical, aliases);
    if (resolved.alias !== undefined) usedAliases.push(resolved.alias);
    return resolved;
  };
  const legacyValue = (alias: string): ResolvedValue => {
    const legacy = environment[alias];
    if (legacy !== undefined) usedAliases.push(alias);
    return { value: legacy };
  };

  const databaseUrl = postgresUrl(
    required(value('DATA_DATABASE_URL'), 'DATA_DATABASE_URL'),
  );
  const tenantId = required(
    value('DATA_TENANT_ID', ['WISER_DATA_TENANT_ID']),
    'DATA_TENANT_ID',
  );
  const projectId = required(
    value('DATA_PROJECT_ID', ['WISER_DATA_PROJECT_ID']),
    'DATA_PROJECT_ID',
  );
  if (!UUID_PATTERN.test(tenantId)) throw invalid('DATA_TENANT_ID');
  if (!UUID_PATTERN.test(projectId)) throw invalid('DATA_PROJECT_ID');

  const maxSecurityLevel = required(
    value('DATA_MAX_SECURITY_LEVEL', ['WISER_DATA_MAX_SECURITY_LEVEL']),
    'DATA_MAX_SECURITY_LEVEL',
  ) as DataJobScope['maxSecurityLevel'];
  if (!SECURITY_LEVELS.has(maxSecurityLevel)) {
    throw invalid('DATA_MAX_SECURITY_LEVEL');
  }
  const policyVersion = integer(
    value('DATA_POLICY_VERSION', ['WISER_DATA_POLICY_VERSION']),
    'DATA_POLICY_VERSION',
    1,
    1,
    Number.MAX_SAFE_INTEGER,
  );
  const workerId = required(
    value('DATA_WORKER_ID', ['WISER_DATA_WORKER_ID']),
    'DATA_WORKER_ID',
  );
  if (
    workerId.length > 128 ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(workerId)
  ) {
    throw invalid('DATA_WORKER_ID');
  }

  const claimLimit = integer(
    value('DATA_WORKER_CLAIM_LIMIT', ['WISER_DATA_CLAIM_LIMIT']),
    'DATA_WORKER_CLAIM_LIMIT',
    8,
    1,
    1_000,
  );
  const canonicalLeaseSeconds = value('DATA_JOB_LEASE_SECONDS');
  const legacyLeaseMs =
    canonicalLeaseSeconds.value === undefined
      ? legacyValue('WISER_DATA_LEASE_MS')
      : { value: undefined };
  const leaseMs =
    canonicalLeaseSeconds.value !== undefined
      ? integer(
          canonicalLeaseSeconds,
          'DATA_JOB_LEASE_SECONDS',
          120,
          1,
          86_400,
        ) * 1_000
      : integer(
          legacyLeaseMs,
          'DATA_JOB_LEASE_SECONDS',
          120_000,
          1,
          86_400_000,
        );
  const canonicalHeartbeatSeconds = value('DATA_JOB_HEARTBEAT_SECONDS');
  const legacyHeartbeatMs =
    canonicalHeartbeatSeconds.value === undefined
      ? legacyValue('WISER_DATA_HEARTBEAT_MS')
      : { value: undefined };
  const heartbeatIntervalMs =
    canonicalHeartbeatSeconds.value !== undefined
      ? integer(
          canonicalHeartbeatSeconds,
          'DATA_JOB_HEARTBEAT_SECONDS',
          30,
          1,
          86_400,
        ) * 1_000
      : integer(
          legacyHeartbeatMs,
          'DATA_JOB_HEARTBEAT_SECONDS',
          30_000,
          1,
          86_400_000,
        );
  if (heartbeatIntervalMs >= leaseMs) {
    throw invalid('DATA_JOB_HEARTBEAT_SECONDS');
  }
  const pollIntervalMs = integer(
    value('DATA_JOB_POLL_INTERVAL_MS', ['WISER_DATA_POLL_MS']),
    'DATA_JOB_POLL_INTERVAL_MS',
    1_000,
    1,
    60_000,
  );
  const healthHost = value('DATA_WORKER_HEALTH_HOST').value ?? '0.0.0.0';
  if (
    healthHost.length > 253 ||
    !/^[A-Za-z0-9][A-Za-z0-9.-]*$/.test(healthHost)
  ) {
    throw invalid('DATA_WORKER_HEALTH_HOST');
  }
  const healthPort = integer(
    value('DATA_WORKER_HEALTH_PORT', ['DATA_WORKER_PORT']),
    'DATA_WORKER_HEALTH_PORT',
    3_003,
    1,
    65_535,
  );

  const workerActorId = required(
    value('DATA_WORKER_ACTOR_ID'),
    'DATA_WORKER_ACTOR_ID',
  );
  if (!UUID_PATTERN.test(workerActorId)) throw invalid('DATA_WORKER_ACTOR_ID');
  let objectStore: SeaweedFsS3AuthorityConfig;
  try {
    objectStore = loadSeaweedFsS3AuthorityConfig(environment);
  } catch {
    throw invalid('DATA_S3_*');
  }
  const maximumObjectBytes = integer(
    value('DATA_INGESTION_MAX_OBJECT_BYTES'),
    'DATA_INGESTION_MAX_OBJECT_BYTES',
    100 * 1024 * 1024,
    1,
    5 * 1024 * 1024 * 1024 * 1024,
  );
  const tikaMaximumResponseBytes = integer(
    value('DATA_TIKA_MAX_RESPONSE_BYTES'),
    'DATA_TIKA_MAX_RESPONSE_BYTES',
    16 * 1024 * 1024,
    16,
    maximumObjectBytes,
  );
  const publicationWaitTimeoutMs = integer(
    value('DATA_PUBLICATION_WAIT_TIMEOUT_MS'),
    'DATA_PUBLICATION_WAIT_TIMEOUT_MS',
    90_000,
    1_000,
    3_600_000,
  );
  if (publicationWaitTimeoutMs >= leaseMs) {
    throw invalid('DATA_PUBLICATION_WAIT_TIMEOUT_MS');
  }

  const ingestion = {
    clamavHost: hostname(value('DATA_CLAMAV_HOST'), 'DATA_CLAMAV_HOST'),
    clamavPort: integer(
      value('DATA_CLAMAV_PORT'),
      'DATA_CLAMAV_PORT',
      3_310,
      1,
      65_535,
    ),
    clamavTimeoutMs: integer(
      value('DATA_CLAMAV_TIMEOUT_MS'),
      'DATA_CLAMAV_TIMEOUT_MS',
      30_000,
      100,
      300_000,
    ),
    clamavMaximumResponseBytes: integer(
      value('DATA_CLAMAV_MAX_RESPONSE_BYTES'),
      'DATA_CLAMAV_MAX_RESPONSE_BYTES',
      4_096,
      16,
      1_048_576,
    ),
    tikaEndpoint: rootUrl(value('DATA_TIKA_ENDPOINT'), 'DATA_TIKA_ENDPOINT'),
    tikaTimeoutMs: integer(
      value('DATA_TIKA_TIMEOUT_MS'),
      'DATA_TIKA_TIMEOUT_MS',
      30_000,
      100,
      300_000,
    ),
    maximumObjectBytes,
    tikaMaximumResponseBytes,
    minimumQualityScore: decimal(
      value('DATA_INGESTION_MIN_QUALITY_SCORE'),
      'DATA_INGESTION_MIN_QUALITY_SCORE',
      Number.EPSILON,
      1,
    ),
    minimumAiConfidence: decimal(
      value('DATA_INGESTION_MIN_AI_CONFIDENCE'),
      'DATA_INGESTION_MIN_AI_CONFIDENCE',
      0,
      1,
    ),
  };

  const projection = {
    weaviateBaseUrl: rootUrl(value('DATA_WEAVIATE_URL'), 'DATA_WEAVIATE_URL'),
    weaviateApiKey: secret(
      value('DATA_WEAVIATE_API_KEY'),
      'DATA_WEAVIATE_API_KEY',
    ),
    openSearchBaseUrl: rootUrl(
      value('DATA_OPENSEARCH_URL'),
      'DATA_OPENSEARCH_URL',
    ),
    openSearchUsername: safeKey(
      value('DATA_OPENSEARCH_USERNAME'),
      'DATA_OPENSEARCH_USERNAME',
    ),
    openSearchPassword: secret(
      value('DATA_OPENSEARCH_PASSWORD'),
      'DATA_OPENSEARCH_PASSWORD',
    ),
    neo4jBaseUrl: rootUrl(value('DATA_NEO4J_URL'), 'DATA_NEO4J_URL'),
    neo4jDatabase: safeKey(value('DATA_NEO4J_DATABASE'), 'DATA_NEO4J_DATABASE'),
    neo4jUsername: safeKey(value('DATA_NEO4J_USERNAME'), 'DATA_NEO4J_USERNAME'),
    neo4jPassword: secret(value('DATA_NEO4J_PASSWORD'), 'DATA_NEO4J_PASSWORD'),
    stacBaseUrl: rootUrl(value('DATA_STAC_API_URL'), 'DATA_STAC_API_URL'),
    stacBearerToken: secret(
      value('DATA_STAC_BEARER_TOKEN'),
      'DATA_STAC_BEARER_TOKEN',
      16,
    ),
    stacAssetBaseUrl: rootUrl(
      value('DATA_STAC_ASSET_BASE_URL'),
      'DATA_STAC_ASSET_BASE_URL',
    ),
    consumerName: safeKey(
      value('DATA_PROJECTION_CONSUMER_NAME'),
      'DATA_PROJECTION_CONSUMER_NAME',
      /^[a-z][a-z0-9._:-]{2,127}$/,
    ),
    batchLimit: integer(
      value('DATA_PROJECTION_BATCH_LIMIT'),
      'DATA_PROJECTION_BATCH_LIMIT',
      8,
      1,
      100,
    ),
    pollIntervalMs: integer(
      value('DATA_PROJECTION_POLL_INTERVAL_MS'),
      'DATA_PROJECTION_POLL_INTERVAL_MS',
      1_000,
      1,
      60_000,
    ),
    httpTimeoutMs: integer(
      value('DATA_PROJECTION_HTTP_TIMEOUT_MS'),
      'DATA_PROJECTION_HTTP_TIMEOUT_MS',
      30_000,
      100,
      300_000,
    ),
    httpMaximumResponseBytes: integer(
      value('DATA_PROJECTION_HTTP_MAX_RESPONSE_BYTES'),
      'DATA_PROJECTION_HTTP_MAX_RESPONSE_BYTES',
      1_048_576,
      16,
      64 * 1024 * 1024,
    ),
    maximumCachedEvents: integer(
      value('DATA_PROJECTION_CACHE_EVENTS'),
      'DATA_PROJECTION_CACHE_EVENTS',
      32,
      1,
      1_000,
    ),
    embeddingDimensions: integer(
      value('DATA_FAKE_EMBEDDING_DIMENSIONS'),
      'DATA_FAKE_EMBEDDING_DIMENSIONS',
      32,
      8,
      4_096,
    ),
    embeddingVersion: safeKey(
      value('DATA_FAKE_EMBEDDING_VERSION'),
      'DATA_FAKE_EMBEDDING_VERSION',
      SEMANTIC_VERSION_PATTERN,
    ),
    publicationWaitTimeoutMs,
    publicationWaitPollMs: integer(
      value('DATA_PUBLICATION_WAIT_POLL_MS'),
      'DATA_PUBLICATION_WAIT_POLL_MS',
      250,
      10,
      10_000,
    ),
  };

  return {
    databaseUrl,
    scope: { tenantId, projectId, maxSecurityLevel, policyVersion },
    workerId,
    claimLimit,
    leaseMs,
    heartbeatIntervalMs,
    pollIntervalMs,
    healthHost,
    healthPort,
    workerActorId,
    objectStore,
    ingestion: Object.freeze(ingestion),
    projection: Object.freeze(projection),
    deprecatedAliases: [...new Set(usedAliases)].sort(),
  };
}
