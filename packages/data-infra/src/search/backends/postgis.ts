import type {
  SearchBackendHit,
  SearchBackendPort,
  SearchBackendRequest,
} from '../index.js';
import {
  SearchBackendAdapterError,
  adapterError,
  parseSearchBackendHit,
  validateBackendRequest,
} from './common.js';

export interface PostGISSearchQueryResult<Row> {
  readonly rows: readonly Row[];
}

export interface PostGISSearchClient {
  query<Row = Readonly<Record<string, unknown>>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<PostGISSearchQueryResult<Row>>;
  release(): void;
}

export interface PostGISSearchPool {
  connect(): Promise<PostGISSearchClient>;
}

export interface PostGISSearchBackendOptions {
  readonly pool: PostGISSearchPool;
}

const RLS_SQL = `
/* platform-search:postgis-rls */
select
  set_config('wiser.tenant_id', $1, true),
  set_config('wiser.project_id', $2, true),
  set_config('wiser.max_security_level', $3, true),
  set_config('wiser.policy_version', $4, true)
`;

const SEARCH_SQL = `
/* platform-search:postgis-query */
select
  evidence.tenant_id as "tenantId",
  evidence.project_id as "projectId",
  evidence.data_item_id as "dataItemId",
  evidence.version_id as "versionId",
  evidence.evidence_fragment_id as "evidenceId",
  version.quality_grade as "qualityGrade",
  version.acceptance_status as "acceptanceStatus",
  version.publication_status as "publicationStatus",
  case greatest(
    security.security_rank(evidence.security_level),
    security.security_rank(version.security_level),
    security.security_rank(item.security_level)
  )
    when 0 then 'L0_PUBLIC'
    when 1 then 'L1_INTERNAL'
    when 2 then 'L2_RESTRICTED'
    when 3 then 'L3_CONFIDENTIAL'
  end as "securityLevel",
  greatest(evidence.policy_version, version.policy_version, item.policy_version)::integer
    as "policyVersion",
  case
    when evidence.excerpt is null then '[]'::jsonb
    else jsonb_build_array(
      jsonb_build_object('field', 'excerpt', 'text', evidence.excerpt)
    )
  end as "excerptFragments",
  '[]'::jsonb as limitations
from knowledge.evidence_fragment as evidence
join catalog.data_item_version as version
  on version.tenant_id = evidence.tenant_id
 and version.project_id = evidence.project_id
 and version.version_id = evidence.version_id
join catalog.data_item as item
  on item.tenant_id = evidence.tenant_id
 and item.project_id = evidence.project_id
 and item.data_item_id = evidence.data_item_id
where evidence.tenant_id = $1::uuid
  and evidence.project_id = $2::uuid
  and evidence.security_level = any($3::text[])
  and greatest(evidence.policy_version, version.policy_version, item.policy_version)
    <= $4::bigint
  and (
    to_tsvector('simple', coalesce(item.name, '') || ' ' || coalesce(evidence.excerpt, ''))
    @@ websearch_to_tsquery('simple', $5)
  )
  and (cardinality($6::uuid[]) = 0 or evidence.version_id = any($6::uuid[]))
  and version.acceptance_status = any($7::text[])
  and version.publication_status = any($8::text[])
  and (
    cardinality($9::text[]) = 0
    or item.business_domains && $9::text[]
  )
order by
  ts_rank(
    to_tsvector('simple', coalesce(item.name, '') || ' ' || coalesce(evidence.excerpt, '')),
    websearch_to_tsquery('simple', $5)
  ) desc,
  evidence.data_item_id,
  evidence.version_id,
  evidence.evidence_fragment_id
limit $10::integer
`;

export class PostGISSearchBackend implements SearchBackendPort {
  readonly source = 'postgis' as const;
  readonly #pool: PostGISSearchPool;

  constructor(options: PostGISSearchBackendOptions) {
    if (
      options.pool === null ||
      typeof options.pool !== 'object' ||
      typeof options.pool.connect !== 'function'
    ) {
      throw adapterError('INVALID_CONFIGURATION');
    }
    this.#pool = options.pool;
  }

  readonly search = async (
    rawRequest: SearchBackendRequest,
  ): Promise<readonly SearchBackendHit[]> => {
    const request = validateBackendRequest(rawRequest, new Set(['geo']));
    let client: PostGISSearchClient;
    try {
      client = await this.#pool.connect();
    } catch {
      throw adapterError('BACKEND_UNAVAILABLE');
    }
    let began = false;
    try {
      await client.query('begin');
      began = true;
      await client.query(RLS_SQL, [
        request.tenantId,
        request.projectId,
        request.maxSecurityLevel,
        String(request.maximumPolicyVersion),
      ]);
      const result = await client.query<Readonly<Record<string, unknown>>>(
        SEARCH_SQL,
        [
          request.tenantId,
          request.projectId,
          request.securityLevels,
          request.maximumPolicyVersion,
          request.query,
          request.versionIds,
          request.acceptanceStatuses,
          request.publicationStatuses,
          request.businessDomains,
          request.limit,
        ],
      );
      if (!Array.isArray(result.rows) || result.rows.length > request.limit) {
        throw adapterError('INVALID_RESPONSE');
      }
      const hits = result.rows.map((row) =>
        parseSearchBackendHit(row, request),
      );
      await client.query('commit');
      return hits;
    } catch (error) {
      if (began) {
        try {
          await client.query('rollback');
        } catch {
          // Preserve the sanitized adapter error below.
        }
      }
      if (error instanceof SearchBackendAdapterError) throw error;
      throw adapterError('BACKEND_UNAVAILABLE');
    } finally {
      client.release();
    }
  };
}
