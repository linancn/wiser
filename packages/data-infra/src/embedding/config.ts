import { createHash } from 'node:crypto';
import { DeterministicFakeEmbedding } from './fake.js';
import {
  OpenAiCompatibleEmbedding,
  QWEN_QUERY_INSTRUCTION,
  type OpenAiCompatibleEmbeddingOptions,
} from './openai-compatible.js';
import type { EmbeddingModelIdentity, EmbeddingPort } from './types.js';

export type DataEmbeddingConfig =
  | {
      readonly provider: 'fake';
      readonly dimensions: number;
      readonly version: string;
    }
  | ({ readonly provider: 'openai-compatible' } & Omit<
      OpenAiCompatibleEmbeddingOptions,
      'fetch'
    >);

export function loadDataEmbeddingConfig(
  environment: Readonly<Record<string, string | undefined>>,
): DataEmbeddingConfig {
  const provider = environment['DATA_EMBEDDING_PROVIDER'] || 'fake';
  if (provider === 'fake') {
    if (environment['NODE_ENV'] === 'production')
      throw new Error(
        'DATA_EMBEDDING_PROVIDER must be configured for production.',
      );
    const config = {
      provider,
      dimensions: Number(environment['DATA_FAKE_EMBEDDING_DIMENSIONS'] ?? '32'),
      version: environment['DATA_FAKE_EMBEDDING_VERSION'] ?? '1.0.0-fixture',
    } as const;
    new DeterministicFakeEmbedding(config);
    return Object.freeze(config);
  }
  if (provider !== 'openai-compatible')
    throw new Error('DATA_EMBEDDING_PROVIDER is invalid.');
  const required = (field: string): string => {
    const value = environment[field];
    if (!value) throw new Error(`Missing embedding configuration: ${field}.`);
    return value;
  };
  const apiKey = environment['DATA_EMBEDDING_API_KEY'];
  const config = {
    provider,
    baseUrl: required('DATA_EMBEDDING_BASE_URL'),
    model: required('DATA_EMBEDDING_MODEL'),
    version: required('DATA_EMBEDDING_VERSION'),
    dimensions: Number(required('DATA_EMBEDDING_DIMENSIONS')),
    queryInstruction:
      environment['DATA_EMBEDDING_QUERY_INSTRUCTION'] || QWEN_QUERY_INSTRUCTION,
    timeoutMs: Number(environment['DATA_EMBEDDING_TIMEOUT_MS'] || '15000'),
    ...(apiKey ? { apiKey } : {}),
  } as const;
  new OpenAiCompatibleEmbedding(config);
  return Object.freeze(config);
}

export function createDataEmbedding(
  config: DataEmbeddingConfig,
): EmbeddingPort {
  return config.provider === 'fake'
    ? new DeterministicFakeEmbedding(config)
    : new OpenAiCompatibleEmbedding(config);
}

// A new physical collection protects queries from vectors made with another profile.
export function embeddingCollectionName(model: EmbeddingModelIdentity): string {
  if (model.provider === 'fake') return 'WiserEvidenceChunkV2';
  const hash = createHash('sha256')
    .update(
      JSON.stringify({
        profile: 'wiser-evidence-embedding-v1',
        provider: model.provider,
        model: model.model,
        version: model.version,
        dimensions: model.dimensions,
        queryInstruction: model.queryInstruction ?? QWEN_QUERY_INSTRUCTION,
        normalization: 'l2',
      }),
    )
    .digest('hex')
    .slice(0, 20);
  return `WiserEvidenceChunkV3_${hash}`;
}
