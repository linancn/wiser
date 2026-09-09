import { EvidenceProjectionError } from './errors.js';
import { embeddingCollectionName } from '../../embedding/config.js';
import type { EmbeddingModelIdentity } from '../../embedding/types.js';
import { deterministicEvidenceProjectionId } from './identity.js';
import {
  assertBackendAccepted,
  evidenceProperties,
  requestProjectionBackend,
} from './shared.js';
import type {
  EvidenceProjectionResult,
  ProjectionHttpClient,
} from './types.js';
import {
  validateBaseUrl,
  validateEvidenceProjectionInput,
  validateSecret,
} from './validation.js';

export const WEAVIATE_EVIDENCE_COLLECTION = 'WiserEvidenceChunkV2';

const PROPERTY_NAMES = [
  'tenantId',
  'projectId',
  'dataItemId',
  'versionId',
  'assetId',
  'chunkId',
  'evidenceId',
  'sourceHash',
  'securityLevel',
  'qualityGrade',
  'acceptanceStatus',
  'publicationStatus',
  'documentId',
  'pageOrSection',
  'language',
  'chunkingStrategy',
  'embeddingModel',
  'embeddingVersion',
  'content',
] as const;

const ARRAY_PROPERTY_NAMES = [
  'businessDomains',
  'channels',
  'limitations',
] as const;

const FILTERABLE_PROPERTY_NAMES = new Set<string>([
  'tenantId',
  'projectId',
  'dataItemId',
  'versionId',
  'evidenceId',
  'securityLevel',
  'acceptanceStatus',
  'publicationStatus',
  'businessDomains',
  'channels',
]);

function exactTextProperty(name: string, dataType: 'text' | 'text[]') {
  return Object.freeze({
    name,
    dataType: Object.freeze([dataType]),
    tokenization: 'field',
    indexFilterable: FILTERABLE_PROPERTY_NAMES.has(name),
    indexSearchable: false,
  });
}

export const WEAVIATE_EVIDENCE_SCHEMA = Object.freeze({
  class: WEAVIATE_EVIDENCE_COLLECTION,
  description:
    'WISER governed evidence chunks for pure worker-supplied vector recall.',
  vectorizer: 'none',
  multiTenancyConfig: Object.freeze({
    enabled: true,
    autoTenantCreation: false,
  }),
  properties: Object.freeze([
    ...PROPERTY_NAMES.map((name) => exactTextProperty(name, 'text')),
    ...ARRAY_PROPERTY_NAMES.map((name) => exactTextProperty(name, 'text[]')),
    Object.freeze({
      name: 'policyVersion',
      dataType: Object.freeze(['int']),
      indexFilterable: true,
      indexRangeFilters: true,
    }),
  ]),
});

export interface WeaviateEvidenceProjectionOptions {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly vectorDimensions: number;
  readonly embeddingModel?: EmbeddingModelIdentity;
  readonly http: ProjectionHttpClient;
}

export class WeaviateEvidenceProjection {
  readonly #baseUrl: string;
  readonly #headers: Readonly<Record<string, string>>;
  readonly #http: ProjectionHttpClient;
  readonly #vectorDimensions: number;
  readonly #embeddingModel: EmbeddingModelIdentity | undefined;
  readonly #collectionName: string;
  readonly #description: string;

  constructor(options: WeaviateEvidenceProjectionOptions) {
    if (options.http === null || typeof options.http?.request !== 'function') {
      throw new EvidenceProjectionError(
        'INVALID_EVIDENCE_PROJECTION_CONFIG',
        'Weaviate HTTP client is invalid.',
      );
    }
    if (
      !Number.isSafeInteger(options.vectorDimensions) ||
      options.vectorDimensions < 1 ||
      options.vectorDimensions > 4_096
    ) {
      throw new EvidenceProjectionError(
        'INVALID_EVIDENCE_PROJECTION_CONFIG',
        'Weaviate vector dimensions are invalid.',
      );
    }
    this.#baseUrl = validateBaseUrl(options.baseUrl);
    this.#http = options.http;
    this.#vectorDimensions = options.vectorDimensions;
    this.#embeddingModel = options.embeddingModel;
    if (
      options.embeddingModel !== undefined &&
      options.embeddingModel.dimensions !== options.vectorDimensions
    ) {
      throw new EvidenceProjectionError(
        'INVALID_EVIDENCE_PROJECTION_CONFIG',
        'Weaviate embedding profile is invalid.',
      );
    }
    this.#collectionName =
      options.embeddingModel === undefined
        ? WEAVIATE_EVIDENCE_COLLECTION
        : embeddingCollectionName(options.embeddingModel);
    this.#description =
      options.embeddingModel?.provider === 'openai-compatible'
        ? `WISER embedding profile ${this.#collectionName}: ${options.embeddingModel.model} ${options.embeddingModel.version} ${options.vectorDimensions} dimensions.`
        : WEAVIATE_EVIDENCE_SCHEMA.description;
    this.#headers = Object.freeze({
      Accept: 'application/json',
      Authorization: `Bearer ${validateSecret(options.apiKey, 'Weaviate API key')}`,
      'Content-Type': 'application/json',
    });
  }

  async ensureCollection(): Promise<void> {
    const existing = await requestProjectionBackend(this.#http, {
      method: 'GET',
      url: `${this.#baseUrl}/v1/schema/${this.#collectionName}`,
      headers: this.#headers,
    });
    if (existing.status === 200) {
      if (this.#embeddingModel?.provider === 'openai-compatible') {
        const schema = existing.body as
          | {
              class?: unknown;
              description?: unknown;
              vectorizer?: unknown;
              multiTenancyConfig?: { enabled?: unknown };
            }
          | undefined;
        if (
          schema?.class !== this.#collectionName ||
          schema.description !== this.#description ||
          schema.vectorizer !== 'none' ||
          schema.multiTenancyConfig?.enabled !== true
        ) {
          throw new EvidenceProjectionError(
            'INVALID_EVIDENCE_PROJECTION_CONFIG',
            'Weaviate collection does not match the embedding profile.',
          );
        }
      }
      return;
    }
    if (existing.status !== 404) assertBackendAccepted(existing, [200, 404]);
    const created = await requestProjectionBackend(this.#http, {
      method: 'POST',
      url: `${this.#baseUrl}/v1/schema`,
      headers: this.#headers,
      body: {
        ...WEAVIATE_EVIDENCE_SCHEMA,
        class: this.#collectionName,
        description: this.#description,
      },
    });
    assertBackendAccepted(created, [200, 201]);
  }

  async put(value: unknown): Promise<EvidenceProjectionResult> {
    const input = validateEvidenceProjectionInput(value);
    if (input.vector.length !== this.#vectorDimensions) {
      throw new EvidenceProjectionError(
        'INVALID_EVIDENCE_PROJECTION_INPUT',
        'Evidence projection vector dimensions do not match the collection.',
      );
    }
    if (
      this.#embeddingModel?.provider === 'openai-compatible' &&
      (input.embeddingModel !== this.#embeddingModel.model ||
        input.embeddingVersion !== this.#embeddingModel.version)
    ) {
      throw new EvidenceProjectionError(
        'INVALID_EVIDENCE_PROJECTION_INPUT',
        'Evidence embedding profile does not match the collection.',
      );
    }
    const projectionId = deterministicEvidenceProjectionId(input);
    const tenant = encodeURIComponent(input.tenantId);
    const tenantResponse = await requestProjectionBackend(this.#http, {
      method: 'POST',
      url: `${this.#baseUrl}/v1/schema/${this.#collectionName}/tenants`,
      headers: this.#headers,
      body: [{ name: input.tenantId }],
    });
    assertBackendAccepted(tenantResponse, [200]);
    const body = {
      class: this.#collectionName,
      id: projectionId,
      tenant: input.tenantId,
      properties: evidenceProperties(input),
      vector: input.vector,
    };
    const objectUrl = `${this.#baseUrl}/v1/objects/${this.#collectionName}/${projectionId}?tenant=${tenant}`;
    const existing = await requestProjectionBackend(this.#http, {
      method: 'GET',
      url: objectUrl,
      headers: this.#headers,
    });
    if (existing.status === 200) {
      const updated = await requestProjectionBackend(this.#http, {
        method: 'PUT',
        url: objectUrl,
        headers: this.#headers,
        body,
      });
      assertBackendAccepted(updated, [200, 204]);
    } else if (existing.status === 404) {
      const created = await requestProjectionBackend(this.#http, {
        method: 'POST',
        url: `${this.#baseUrl}/v1/objects?tenant=${tenant}`,
        headers: this.#headers,
        body,
      });
      if (created.status === 409 || created.status === 422) {
        const racedUpdate = await requestProjectionBackend(this.#http, {
          method: 'PUT',
          url: objectUrl,
          headers: this.#headers,
          body,
        });
        assertBackendAccepted(racedUpdate, [200, 204]);
      } else {
        assertBackendAccepted(created, [200, 201]);
      }
    } else {
      assertBackendAccepted(existing, [200, 404]);
    }
    return Object.freeze({ projectionId });
  }
}
