import type {
  SearchBackendHit,
  SearchBackendPort,
  SearchBackendRequest,
} from '../index.js';
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
  'MATCH (entity:WiserEntity)-[:EVIDENCED_BY]->(evidence:WiserEvidence) WHERE evidence.tenantId = $tenantId AND evidence.projectId = $projectId AND evidence.securityLevel IN $securityLevels AND CASE evidence.securityLevel WHEN "L0_PUBLIC" THEN 0 WHEN "L1_INTERNAL" THEN 1 WHEN "L2_RESTRICTED" THEN 2 WHEN "L3_CONFIDENTIAL" THEN 3 END <= CASE $maxSecurityLevel WHEN "L0_PUBLIC" THEN 0 WHEN "L1_INTERNAL" THEN 1 WHEN "L2_RESTRICTED" THEN 2 WHEN "L3_CONFIDENTIAL" THEN 3 END AND evidence.policyVersion <= $policyVersion AND evidence.acceptanceStatus IN $acceptanceStatuses AND evidence.publicationStatus IN $publicationStatuses AND any(channel IN $channels WHERE channel IN coalesce(evidence.channels, [])) AND (size($versionIds) = 0 OR evidence.versionId IN $versionIds) AND (size($businessDomains) = 0 OR any(domain IN $businessDomains WHERE domain IN coalesce(evidence.businessDomains, []))) AND toLower(coalesce(entity.name, "")) CONTAINS toLower($query) RETURN evidence.tenantId AS tenantId, evidence.projectId AS projectId, evidence.dataItemId AS dataItemId, evidence.versionId AS versionId, evidence.evidenceId AS evidenceId, evidence.qualityGrade AS qualityGrade, evidence.acceptanceStatus AS acceptanceStatus, evidence.publicationStatus AS publicationStatus, evidence.securityLevel AS securityLevel, evidence.policyVersion AS policyVersion, [{field: "entityName", text: coalesce(entity.name, "")}] AS excerptFragments, coalesce(evidence.limitations, []) AS limitations ORDER BY entity.name, evidence.dataItemId, evidence.versionId, evidence.evidenceId LIMIT $limit';

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
            tenantId: request.tenantId,
            projectId: request.projectId,
            query: request.query,
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
