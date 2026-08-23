import type {
  SearchBackendHit,
  SearchBackendPort,
  SearchBackendRequest,
} from '../index.js';
import { NEO4J_ENTITY_FULLTEXT_INDEX } from '../../projections/graph-stac/neo4j.js';
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

const DATABASE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/;
const FIELDS = Object.freeze([
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
  'excerptFragments',
  'limitations',
]);

const CYPHER =
  'CALL db.index.fulltext.queryNodes($indexName, $query) YIELD node AS entity, score MATCH (entity:WiserEntity)-[relation:EVIDENCED_BY]->(evidence:WiserEvidence) WHERE entity.tenantId = $tenantId AND entity.projectId = $projectId AND relation.tenantId = $tenantId AND relation.projectId = $projectId AND evidence.tenantId = $tenantId AND evidence.projectId = $projectId AND entity.securityLevel IN $securityLevels AND relation.securityLevel IN $securityLevels AND evidence.securityLevel IN $securityLevels AND CASE evidence.securityLevel WHEN "L0_PUBLIC" THEN 0 WHEN "L1_INTERNAL" THEN 1 WHEN "L2_RESTRICTED" THEN 2 WHEN "L3_CONFIDENTIAL" THEN 3 END <= CASE $maxSecurityLevel WHEN "L0_PUBLIC" THEN 0 WHEN "L1_INTERNAL" THEN 1 WHEN "L2_RESTRICTED" THEN 2 WHEN "L3_CONFIDENTIAL" THEN 3 END AND entity.policyVersion <= $policyVersion AND relation.policyVersion <= $policyVersion AND evidence.policyVersion <= $policyVersion AND entity.acceptanceStatus IN $acceptanceStatuses AND relation.acceptanceStatus IN $acceptanceStatuses AND evidence.acceptanceStatus IN $acceptanceStatuses AND entity.publicationStatus IN $publicationStatuses AND relation.publicationStatus IN $publicationStatuses AND evidence.publicationStatus IN $publicationStatuses AND any(channel IN $channels WHERE channel IN coalesce(evidence.channels, [])) AND (size($versionIds) = 0 OR evidence.versionId IN $versionIds) AND (size($businessDomains) = 0 OR any(domain IN $businessDomains WHERE domain IN coalesce(evidence.businessDomains, []))) RETURN evidence.tenantId AS tenantId, evidence.projectId AS projectId, evidence.dataItemId AS dataItemId, evidence.versionId AS versionId, evidence.evidenceId AS evidenceId, evidence.qualityGrade AS qualityGrade, evidence.acceptanceStatus AS acceptanceStatus, evidence.publicationStatus AS publicationStatus, evidence.securityLevel AS securityLevel, evidence.policyVersion AS policyVersion, [{field: "entityName", text: coalesce(entity.name, "")}] AS excerptFragments, coalesce(evidence.limitations, []) AS limitations ORDER BY score DESC, entity.name, evidence.dataItemId, evidence.versionId, evidence.evidenceId LIMIT $limit';

function literalFullTextQuery(value: string): string {
  const normalized = value.normalize('NFKC').trim();
  if (normalized.length === 0) throw adapterError('INVALID_REQUEST');
  const terms = normalized.split(/\s+/u);
  if (terms.length > 64) throw adapterError('INVALID_REQUEST');
  return terms
    .map((term) => `"${term.replace(/[+\-!(){}[\]^"~*?:\\/&|]/gu, '\\$&')}"`)
    .join(' OR ');
}

export interface Neo4jSearchBackendOptions {
  readonly endpoint: string;
  readonly database: string;
  readonly username: string;
  readonly password: string;
  readonly fetch?: SearchBackendFetch;
  readonly timeoutMs?: number;
}

export class Neo4jSearchBackend implements SearchBackendPort {
  readonly source = 'neo4j' as const;
  readonly #url: URL;
  readonly #authorization: string;
  readonly #fetch: SearchBackendFetch;
  readonly #timeoutMs: number;

  constructor(options: Neo4jSearchBackendOptions) {
    const endpoint = safeEndpoint(options.endpoint);
    if (!DATABASE_PATTERN.test(options.database)) {
      throw adapterError('INVALID_CONFIGURATION');
    }
    this.#url = new URL(
      `db/${encodeURIComponent(options.database)}/query/v2`,
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
    const request = validateBackendRequest(rawRequest, new Set(['graph']));
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
        body: JSON.stringify({
          statement: CYPHER,
          parameters: {
            indexName: NEO4J_ENTITY_FULLTEXT_INDEX,
            tenantId: request.tenantId,
            projectId: request.projectId,
            query: literalFullTextQuery(request.query),
            maxSecurityLevel: request.maxSecurityLevel,
            securityLevels: request.securityLevels,
            policyVersion: request.maximumPolicyVersion,
            versionIds: request.versionIds,
            acceptanceStatuses: request.acceptanceStatuses,
            publicationStatuses: request.publicationStatuses,
            businessDomains: request.businessDomains,
            channels: request.channels,
            limit: request.limit,
          },
          maxExecutionTime: Math.max(1, Math.floor(this.#timeoutMs / 1_000)),
        }),
      },
      this.#timeoutMs,
    );
    if (
      !isRecord(response) ||
      response['queryType'] !== 'r' ||
      !isRecord(response['data']) ||
      !Array.isArray(response['data']['fields']) ||
      !Array.isArray(response['data']['values']) ||
      JSON.stringify(response['data']['fields']) !== JSON.stringify(FIELDS) ||
      response['data']['values'].length > request.limit
    ) {
      throw adapterError('INVALID_RESPONSE');
    }
    return (response['data']['values'] as readonly unknown[]).map((row) => {
      if (!Array.isArray(row) || row.length !== FIELDS.length) {
        throw adapterError('INVALID_RESPONSE');
      }
      const projection = Object.fromEntries(
        FIELDS.map((field, index) => [field, row[index]]),
      );
      return parseSearchBackendHit(projection, request);
    });
  };
}
