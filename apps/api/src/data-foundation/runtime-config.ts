import {
  loadSeaweedFsS3AuthorityConfig,
  type SeaweedFsS3AuthorityConfig,
} from '@wiser/data-infra';

export type DataFoundationApiRuntimeConfig =
  | { readonly mode: 'off' }
  | {
      readonly mode: 'enabled';
      readonly databaseUrl: string;
      readonly objectStore: SeaweedFsS3AuthorityConfig;
      readonly objectStorePublicEndpoint: string;
      readonly workerUrl: string;
      readonly weaviate: {
        readonly url: string;
        readonly apiKey: string;
      };
      readonly openSearch: {
        readonly url: string;
        readonly username: string;
        readonly password: string;
      };
      readonly neo4j: {
        readonly url: string;
        readonly database: string;
        readonly username: string;
        readonly password: string;
      };
      readonly stac: {
        readonly url: string;
        readonly bearerToken: string;
      };
      readonly publicApiOrigin: string;
      readonly fakeEmbeddingDimensions: number;
    };

const RUNTIME_FIELDS = [
  'DATA_DATABASE_URL',
  'DATA_S3_ENDPOINT',
  'DATA_S3_PUBLIC_ENDPOINT',
  'DATA_S3_REGION',
  'DATA_S3_BUCKET',
  'DATA_S3_ACCESS_KEY_ID',
  'DATA_S3_SECRET_ACCESS_KEY',
  'DATA_WORKER_URL',
  'DATA_WEAVIATE_URL',
  'DATA_WEAVIATE_API_KEY',
  'DATA_OPENSEARCH_URL',
  'DATA_OPENSEARCH_USERNAME',
  'DATA_OPENSEARCH_PASSWORD',
  'DATA_NEO4J_URL',
  'DATA_NEO4J_DATABASE',
  'DATA_NEO4J_USERNAME',
  'DATA_NEO4J_PASSWORD',
  'DATA_STAC_API_URL',
  'DATA_STAC_API_BEARER_TOKEN',
  'DATA_PUBLIC_API_ORIGIN',
] as const;

function invalid(field: string): Error {
  return new Error(`Invalid Data Foundation API configuration: ${field}.`);
}

function required(
  environment: NodeJS.ProcessEnv,
  field: (typeof RUNTIME_FIELDS)[number],
): string {
  const value = environment[field];
  if (value === undefined || value.length === 0) throw invalid(field);
  return value;
}

function endpoint(value: string, field: string): string {
  try {
    const url = new URL(value);
    if (
      (url.protocol !== 'http:' && url.protocol !== 'https:') ||
      url.username.length > 0 ||
      url.password.length > 0 ||
      url.search.length > 0 ||
      url.hash.length > 0 ||
      (url.pathname !== '' && url.pathname !== '/')
    ) {
      throw invalid(field);
    }
    return url.origin;
  } catch {
    throw invalid(field);
  }
}

function databaseUrl(value: string): string {
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

function credential(value: string, field: string, minimum = 8): string {
  if (
    value.length < minimum ||
    value.length > 2_048 ||
    [...value].some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127;
    })
  ) {
    throw invalid(field);
  }
  return value;
}

function identifier(value: string, field: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)) {
    throw invalid(field);
  }
  return value;
}

function embeddingDimensions(value: string | undefined): number {
  const parsed = Number(value ?? '64');
  if (!Number.isSafeInteger(parsed) || parsed < 8 || parsed > 4_096) {
    throw invalid('DATA_FAKE_EMBEDDING_DIMENSIONS');
  }
  return parsed;
}

function objectStore(environment: NodeJS.ProcessEnv) {
  for (const field of [
    'DATA_S3_ENDPOINT',
    'DATA_S3_REGION',
    'DATA_S3_BUCKET',
    'DATA_S3_ACCESS_KEY_ID',
    'DATA_S3_SECRET_ACCESS_KEY',
  ] as const) {
    required(environment, field);
  }
  try {
    return loadSeaweedFsS3AuthorityConfig(environment);
  } catch {
    throw invalid('DATA_S3_*');
  }
}

export function loadDataFoundationApiRuntimeConfig(
  environment: NodeJS.ProcessEnv,
): DataFoundationApiRuntimeConfig {
  const production = environment['NODE_ENV'] === 'production';
  const configuredMode = environment['DATA_FOUNDATION_MODE'];
  if (
    configuredMode !== undefined &&
    configuredMode !== 'off' &&
    configuredMode !== 'enabled'
  ) {
    throw invalid('DATA_FOUNDATION_MODE');
  }
  const hasRuntimeField = RUNTIME_FIELDS.some(
    (field) => environment[field] !== undefined,
  );
  const mode =
    configuredMode ?? (production || hasRuntimeField ? 'enabled' : 'off');
  if (mode === 'off') {
    if (production) {
      throw new Error('DATA_FOUNDATION_MODE=off is forbidden in production.');
    }
    return { mode: 'off' };
  }

  const config = {
    mode: 'enabled' as const,
    databaseUrl: databaseUrl(required(environment, 'DATA_DATABASE_URL')),
    objectStore: objectStore(environment),
    objectStorePublicEndpoint: endpoint(
      required(environment, 'DATA_S3_PUBLIC_ENDPOINT'),
      'DATA_S3_PUBLIC_ENDPOINT',
    ),
    workerUrl: endpoint(
      required(environment, 'DATA_WORKER_URL'),
      'DATA_WORKER_URL',
    ),
    weaviate: {
      url: endpoint(
        required(environment, 'DATA_WEAVIATE_URL'),
        'DATA_WEAVIATE_URL',
      ),
      apiKey: credential(
        required(environment, 'DATA_WEAVIATE_API_KEY'),
        'DATA_WEAVIATE_API_KEY',
      ),
    },
    openSearch: {
      url: endpoint(
        required(environment, 'DATA_OPENSEARCH_URL'),
        'DATA_OPENSEARCH_URL',
      ),
      username: identifier(
        required(environment, 'DATA_OPENSEARCH_USERNAME'),
        'DATA_OPENSEARCH_USERNAME',
      ),
      password: credential(
        required(environment, 'DATA_OPENSEARCH_PASSWORD'),
        'DATA_OPENSEARCH_PASSWORD',
      ),
    },
    neo4j: {
      url: endpoint(required(environment, 'DATA_NEO4J_URL'), 'DATA_NEO4J_URL'),
      database: identifier(
        required(environment, 'DATA_NEO4J_DATABASE'),
        'DATA_NEO4J_DATABASE',
      ),
      username: identifier(
        required(environment, 'DATA_NEO4J_USERNAME'),
        'DATA_NEO4J_USERNAME',
      ),
      password: credential(
        required(environment, 'DATA_NEO4J_PASSWORD'),
        'DATA_NEO4J_PASSWORD',
      ),
    },
    stac: {
      url: endpoint(
        required(environment, 'DATA_STAC_API_URL'),
        'DATA_STAC_API_URL',
      ),
      bearerToken: credential(
        required(environment, 'DATA_STAC_API_BEARER_TOKEN'),
        'DATA_STAC_API_BEARER_TOKEN',
        16,
      ),
    },
    publicApiOrigin: endpoint(
      required(environment, 'DATA_PUBLIC_API_ORIGIN'),
      'DATA_PUBLIC_API_ORIGIN',
    ),
    fakeEmbeddingDimensions: embeddingDimensions(
      environment['DATA_FAKE_EMBEDDING_DIMENSIONS'],
    ),
  };
  return Object.freeze(config);
}
