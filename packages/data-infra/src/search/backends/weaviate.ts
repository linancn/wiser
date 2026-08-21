import type {
  SearchBackendHit,
  SearchBackendPort,
  SearchBackendRequest,
} from '../index.js';
import { WEAVIATE_EVIDENCE_COLLECTION } from '../../projections/evidence/weaviate.js';
import {
  adapterError,
  fetchJson,
  isRecord,
  parseSearchBackendHit,
  requiredFetch,
  requiredSecret,
  safeEndpoint,
  type SearchBackendFetch,
  validateBackendRequest,
} from './common.js';

export type SearchEmbeddingPort = (query: string) => Promise<readonly number[]>;

export interface WeaviateSearchBackendOptions {
  readonly endpoint: string;
  readonly apiKey: string;
  readonly collectionName: string;
  readonly embed: SearchEmbeddingPort;
  readonly fetch?: SearchBackendFetch;
  readonly timeoutMs?: number;
}

function tenantName(request: SearchBackendRequest) {
  return request.tenantId;
}

function graphQlString(value: string): string {
  return JSON.stringify(value);
}

function graphQlStrings(values: readonly string[]): string {
  return `[${values.map(graphQlString).join(',')}]`;
}

function whereGraphQl(request: SearchBackendRequest): string {
  const operands = [
    `{path:["tenantId"],operator:Equal,valueText:${graphQlString(request.tenantId)}}`,
    `{path:["projectId"],operator:Equal,valueText:${graphQlString(request.projectId)}}`,
    `{path:["securityLevel"],operator:ContainsAny,valueText:${graphQlStrings(request.securityLevels)}}`,
    `{path:["policyVersion"],operator:LessThanEqual,valueInt:${request.maximumPolicyVersion}}`,
    `{path:["acceptanceStatus"],operator:ContainsAny,valueText:${graphQlStrings(request.acceptanceStatuses)}}`,
    `{path:["publicationStatus"],operator:ContainsAny,valueText:${graphQlStrings(request.publicationStatuses)}}`,
    `{path:["channels"],operator:ContainsAny,valueText:${graphQlStrings(request.channels)}}`,
  ];
  if (request.versionIds.length > 0) {
    operands.push(
      `{path:["versionId"],operator:ContainsAny,valueText:${graphQlStrings(request.versionIds)}}`,
    );
  }
  if (request.businessDomains.length > 0) {
    operands.push(
      `{path:["businessDomains"],operator:ContainsAny,valueText:${graphQlStrings(request.businessDomains)}}`,
    );
  }
  return `{operator:And,operands:[${operands.join(',')}]}`;
}

export class WeaviateSearchBackend implements SearchBackendPort {
  readonly source = 'weaviate' as const;
  readonly #url: URL;
  readonly #apiKey: string;
  readonly #collectionName: string;
  readonly #embed: SearchEmbeddingPort;
  readonly #fetch: SearchBackendFetch;
  readonly #timeoutMs: number;

  constructor(options: WeaviateSearchBackendOptions) {
    const endpoint = safeEndpoint(options.endpoint);
    if (
      options.collectionName !== WEAVIATE_EVIDENCE_COLLECTION ||
      typeof options.embed !== 'function'
    ) {
      throw adapterError('INVALID_CONFIGURATION');
    }
    this.#url = new URL('v1/graphql', endpoint);
    this.#apiKey = requiredSecret(options.apiKey);
    this.#collectionName = options.collectionName;
    this.#embed = options.embed;
    this.#fetch = requiredFetch(options.fetch ?? globalThis.fetch);
    this.#timeoutMs = options.timeoutMs ?? 15_000;
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
    const request = validateBackendRequest(rawRequest, new Set(['semantic']));
    let vector: readonly number[];
    try {
      vector = await this.#embed(request.query);
    } catch {
      throw adapterError('EMBEDDING_UNAVAILABLE');
    }
    if (
      !Array.isArray(vector) ||
      vector.length < 1 ||
      vector.length > 4_096 ||
      !(vector as readonly unknown[]).every(
        (value) => typeof value === 'number' && Number.isFinite(value),
      )
    ) {
      throw adapterError('EMBEDDING_UNAVAILABLE');
    }
    const response = await fetchJson(
      this.#fetch,
      this.#url,
      {
        method: 'POST',
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${this.#apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          query: `query WiserSearch($tenant: String!, $query: String!, $vector: [Float!]!) { Get { ${this.#collectionName}(tenant: $tenant hybrid: { query: $query vector: $vector alpha: 0.5 fusionType: relativeScoreFusion } where: ${whereGraphQl(request)} limit: ${request.limit}) { tenantId projectId dataItemId versionId evidenceId qualityGrade acceptanceStatus publicationStatus securityLevel policyVersion content limitations _additional { score } } } }`,
          variables: {
            tenant: tenantName(request),
            query: request.query,
            vector,
          },
        }),
      },
      this.#timeoutMs,
    );
    if (
      !isRecord(response) ||
      response['errors'] !== undefined ||
      !isRecord(response['data']) ||
      !isRecord(response['data']['Get'])
    ) {
      throw adapterError('INVALID_RESPONSE');
    }
    const rows = response['data']['Get'][this.#collectionName];
    if (!Array.isArray(rows) || rows.length > request.limit) {
      throw adapterError('INVALID_RESPONSE');
    }
    return rows.map((row: unknown) => {
      if (!isRecord(row)) throw adapterError('INVALID_RESPONSE');
      const { _additional: _ignored, content, ...projection } = row;
      if (typeof content !== 'string') throw adapterError('INVALID_RESPONSE');
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
