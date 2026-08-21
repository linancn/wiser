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
  validateUsername,
} from './validation.js';

export const OPENSEARCH_EVIDENCE_INDEX = 'wiser-evidence-v1';

const keywordProperties = [
  'projectionId',
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
  'language',
  'chunkingStrategy',
  'embeddingModel',
  'embeddingVersion',
  'documentId',
  'pageOrSection',
] as const;

export const OPENSEARCH_EVIDENCE_MAPPING = Object.freeze({
  settings: Object.freeze({
    analysis: Object.freeze({
      analyzer: Object.freeze({
        wiser_icu_zh: Object.freeze({
          type: 'custom',
          tokenizer: 'icu_tokenizer',
          filter: Object.freeze(['icu_folding', 'lowercase']),
        }),
      }),
    }),
  }),
  mappings: Object.freeze({
    dynamic: 'strict',
    properties: Object.freeze({
      ...Object.fromEntries(
        keywordProperties.map((name) => [
          name,
          Object.freeze({ type: 'keyword' }),
        ]),
      ),
      content: Object.freeze({ type: 'text', analyzer: 'wiser_icu_zh' }),
    }),
  }),
});

export interface OpenSearchEvidenceProjectionOptions {
  readonly baseUrl: string;
  readonly indexName: string;
  readonly username: string;
  readonly password: string;
  readonly http: ProjectionHttpClient;
}

export class OpenSearchEvidenceProjection {
  readonly #baseUrl: string;
  readonly #headers: Readonly<Record<string, string>>;
  readonly #http: ProjectionHttpClient;

  constructor(options: OpenSearchEvidenceProjectionOptions) {
    if (options.http === null || typeof options.http?.request !== 'function') {
      throw new EvidenceProjectionError(
        'INVALID_EVIDENCE_PROJECTION_CONFIG',
        'OpenSearch HTTP client is invalid.',
      );
    }
    if (options.indexName !== OPENSEARCH_EVIDENCE_INDEX) {
      throw new EvidenceProjectionError(
        'INVALID_EVIDENCE_PROJECTION_CONFIG',
        'OpenSearch evidence index is invalid.',
      );
    }
    const username = validateUsername(options.username);
    const password = validateSecret(options.password, 'OpenSearch password');
    this.#baseUrl = validateBaseUrl(options.baseUrl);
    this.#http = options.http;
    this.#headers = Object.freeze({
      Accept: 'application/json',
      Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`,
      'Content-Type': 'application/json',
    });
  }

  async ensureIndex(): Promise<void> {
    const existing = await requestProjectionBackend(this.#http, {
      method: 'GET',
      url: `${this.#baseUrl}/${OPENSEARCH_EVIDENCE_INDEX}`,
      headers: this.#headers,
    });
    if (existing.status === 200) return;
    if (existing.status !== 404) assertBackendAccepted(existing, [200, 404]);
    const created = await requestProjectionBackend(this.#http, {
      method: 'PUT',
      url: `${this.#baseUrl}/${OPENSEARCH_EVIDENCE_INDEX}`,
      headers: this.#headers,
      body: OPENSEARCH_EVIDENCE_MAPPING,
    });
    assertBackendAccepted(created, [200, 201]);
  }

  async put(value: unknown): Promise<EvidenceProjectionResult> {
    const input = validateEvidenceProjectionInput(value);
    const projectionId = deterministicEvidenceProjectionId(input);
    const response = await requestProjectionBackend(this.#http, {
      method: 'PUT',
      url: `${this.#baseUrl}/${OPENSEARCH_EVIDENCE_INDEX}/_doc/${projectionId}`,
      headers: this.#headers,
      body: { projectionId, ...evidenceProperties(input) },
    });
    assertBackendAccepted(response, [200, 201]);
    return Object.freeze({ projectionId });
  }
}
