import { EvidenceProjectionError } from './errors.js';
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

export const WEAVIATE_EVIDENCE_COLLECTION = 'WiserEvidenceChunk';

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
  'documentId',
  'pageOrSection',
  'language',
  'chunkingStrategy',
  'embeddingModel',
  'embeddingVersion',
  'content',
] as const;

export const WEAVIATE_EVIDENCE_SCHEMA = Object.freeze({
  class: WEAVIATE_EVIDENCE_COLLECTION,
  description: 'WISER governed evidence chunks with worker-supplied vectors.',
  vectorizer: 'none',
  multiTenancyConfig: Object.freeze({
    enabled: true,
    autoTenantCreation: true,
  }),
  properties: Object.freeze([
    ...PROPERTY_NAMES.map((name) =>
      Object.freeze({ name, dataType: ['text'] }),
    ),
  ]),
});

export interface WeaviateEvidenceProjectionOptions {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly http: ProjectionHttpClient;
}

export class WeaviateEvidenceProjection {
  readonly #baseUrl: string;
  readonly #headers: Readonly<Record<string, string>>;
  readonly #http: ProjectionHttpClient;

  constructor(options: WeaviateEvidenceProjectionOptions) {
    if (options.http === null || typeof options.http?.request !== 'function') {
      throw new EvidenceProjectionError(
        'INVALID_EVIDENCE_PROJECTION_CONFIG',
        'Weaviate HTTP client is invalid.',
      );
    }
    this.#baseUrl = validateBaseUrl(options.baseUrl);
    this.#http = options.http;
    this.#headers = Object.freeze({
      Accept: 'application/json',
      Authorization: `Bearer ${validateSecret(options.apiKey, 'Weaviate API key')}`,
      'Content-Type': 'application/json',
    });
  }

  async ensureCollection(): Promise<void> {
    const existing = await requestProjectionBackend(this.#http, {
      method: 'GET',
      url: `${this.#baseUrl}/v1/schema/${WEAVIATE_EVIDENCE_COLLECTION}`,
      headers: this.#headers,
    });
    if (existing.status === 200) return;
    if (existing.status !== 404) assertBackendAccepted(existing, [200, 404]);
    const created = await requestProjectionBackend(this.#http, {
      method: 'POST',
      url: `${this.#baseUrl}/v1/schema`,
      headers: this.#headers,
      body: WEAVIATE_EVIDENCE_SCHEMA,
    });
    assertBackendAccepted(created, [200, 201]);
  }

  async put(value: unknown): Promise<EvidenceProjectionResult> {
    const input = validateEvidenceProjectionInput(value);
    const projectionId = deterministicEvidenceProjectionId(input);
    const tenant = encodeURIComponent(input.tenantId);
    const response = await requestProjectionBackend(this.#http, {
      method: 'PUT',
      url: `${this.#baseUrl}/v1/objects/${WEAVIATE_EVIDENCE_COLLECTION}/${projectionId}?tenant=${tenant}`,
      headers: this.#headers,
      body: {
        class: WEAVIATE_EVIDENCE_COLLECTION,
        id: projectionId,
        tenant: input.tenantId,
        properties: evidenceProperties(input),
        vector: input.vector,
      },
    });
    assertBackendAccepted(response, [200, 201, 204]);
    return Object.freeze({ projectionId });
  }
}
