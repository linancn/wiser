import type {
  SearchBackendHit,
  SearchBackendPort,
  SearchBackendRequest,
} from '../index.js';
import { OPENSEARCH_EVIDENCE_INDEX } from '../../projections/evidence/opensearch.js';
import {
  adapterError,
  basicAuthorization,
  fetchJson,
  isRecord,
  parseSearchBackendHit,
  requiredFetch,
  safeEndpoint,
  type SearchBackendFetch,
  validateBackendRequest,
} from './common.js';

const SOURCE_FIELDS = Object.freeze([
  'tenantId',
  'projectId',
  'dataItemId',
  'versionId',
  'evidenceId',
  'qualityGrade',
  'acceptanceStatus',
  'publicationStatus',
  'securityLevel',
  'policyVersion',
  'content',
  'limitations',
]);

export interface OpenSearchSearchBackendOptions {
  readonly endpoint: string;
  readonly indexName: string;
  readonly username: string;
  readonly password: string;
  readonly fetch?: SearchBackendFetch;
  readonly timeoutMs?: number;
}

export class OpenSearchSearchBackend implements SearchBackendPort {
  readonly source = 'opensearch' as const;
  readonly #url: URL;
  readonly #authorization: string;
  readonly #fetch: SearchBackendFetch;
  readonly #timeoutMs: number;

  constructor(options: OpenSearchSearchBackendOptions) {
    const endpoint = safeEndpoint(options.endpoint);
    if (options.indexName !== OPENSEARCH_EVIDENCE_INDEX) {
      throw adapterError('INVALID_CONFIGURATION');
    }
    this.#url = new URL(
      `${encodeURIComponent(options.indexName)}/_search`,
      endpoint,
    );
    this.#authorization = basicAuthorization(
      options.username,
      options.password,
    );
    this.#fetch = requiredFetch(options.fetch ?? globalThis.fetch);
    this.#timeoutMs = options.timeoutMs ?? 10_000;
    if (
      !Number.isSafeInteger(this.#timeoutMs) ||
      this.#timeoutMs < 100 ||
      this.#timeoutMs > 120_000
    ) {
      throw adapterError('INVALID_CONFIGURATION');
    }
  }

  readonly search = async (
    rawRequest: SearchBackendRequest,
  ): Promise<readonly SearchBackendHit[]> => {
    const request = validateBackendRequest(
      rawRequest,
      new Set(['catalog', 'fulltext']),
    );
    const filters: unknown[] = [
      { term: { tenantId: request.tenantId } },
      { term: { projectId: request.projectId } },
      { terms: { securityLevel: request.securityLevels } },
      { range: { policyVersion: { lte: request.maximumPolicyVersion } } },
      { terms: { acceptanceStatus: request.acceptanceStatuses } },
      { terms: { publicationStatus: request.publicationStatuses } },
      { terms: { channels: request.channels } },
    ];
    if (request.versionIds.length > 0) {
      filters.push({ terms: { versionId: request.versionIds } });
    }
    if (request.businessDomains.length > 0) {
      filters.push({ terms: { businessDomains: request.businessDomains } });
    }
    const body = {
      size: request.limit,
      track_total_hits: false,
      _source: SOURCE_FIELDS,
      query: {
        bool: {
          must: [
            {
              multi_match: {
                query: request.query,
                fields: ['content'],
                type: 'best_fields',
              },
            },
          ],
          filter: filters,
        },
      },
      sort: [
        { _score: 'desc' },
        { dataItemId: 'asc' },
        { versionId: 'asc' },
        { evidenceId: 'asc' },
      ],
    };
    const response = await fetchJson(
      this.#fetch,
      this.#url,
      {
        method: 'POST',
        headers: {
          accept: 'application/json',
          authorization: this.#authorization,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
      },
      this.#timeoutMs,
    );
    if (!isRecord(response) || !isRecord(response['hits'])) {
      throw adapterError('INVALID_RESPONSE');
    }
    const hits = response['hits']['hits'];
    if (!Array.isArray(hits) || hits.length > request.limit) {
      throw adapterError('INVALID_RESPONSE');
    }
    return hits.map((entry: unknown) => {
      if (!isRecord(entry)) throw adapterError('INVALID_RESPONSE');
      const source = entry['_source'];
      if (!isRecord(source) || typeof source['content'] !== 'string') {
        throw adapterError('INVALID_RESPONSE');
      }
      const { content, ...projection } = source;
      return parseSearchBackendHit(
        {
          ...projection,
          excerptFragments: [{ field: 'content', text: content }],
        },
        request,
      );
    });
  };
}
