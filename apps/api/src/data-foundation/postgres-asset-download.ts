import type { S3AuthorityObjectStore } from '@wiser/data-infra/object-store';
import type { PlatformRequestContext } from '@wiser/platform-contracts';

interface AssetDownloadClient {
  query(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ readonly rows: readonly Record<string, unknown>[] }>;
  release(): void;
}

export interface AssetDownloadPool {
  connect(): Promise<AssetDownloadClient>;
  end(): Promise<void>;
}

export type AssetDownloadObjectStore = Pick<
  S3AuthorityObjectStore,
  'planVersionDownload'
>;

const SET_SCOPE_SQL = `
/* data.asset-download.scope */
select set_config('wiser.tenant_id', $1, true),
  set_config('wiser.project_id', $2, true),
  set_config('wiser.max_security_level', $3, true),
  set_config('wiser.policy_version', $4, true),
  set_config('statement_timeout', '10000', true)
`;

const LOOKUP_SQL = `
/* data.asset-download.lookup */
select encode(asset.content_hash, 'hex') as content_hash,
  asset.security_level, asset.policy_version
from catalog.asset as asset
join ingestion.input_asset as input
  on input.tenant_id = asset.tenant_id
 and input.project_id = asset.project_id
 and input.asset_id = asset.asset_id
where asset.tenant_id = $1::uuid and asset.project_id = $2::uuid
  and asset.version_id = $3::uuid and asset.lifecycle_state = 'RAW'
  and asset.content_hash is not null and asset.content_blob_id is not null
  and security.authorized_row(asset.tenant_id, asset.project_id,
    asset.security_level, asset.policy_version)
order by input.ordinal, asset.asset_id
limit 1
for key share of asset
`;

const AUDIT_SQL = `
/* data.asset-download.audit */
insert into security.audit_event (
  tenant_id, project_id, actor_id, action, resource_type, resource_id,
  decision, purpose, context, security_level, policy_version, row_version
) values (
  $1::uuid, $2::uuid, $3::uuid, 'data.asset.download',
  'data-item-version', $4, 'ALLOWED', $5,
  jsonb_build_object('traceId', $6::text), $7, $8::bigint, 1
)
`;

const HASH_PATTERN = /^[a-f0-9]{64}$/;

export class PostgresDataAssetDownloadError extends Error {
  constructor(readonly code: 'NOT_FOUND' | 'UNAVAILABLE') {
    super('Data asset download failed safely.');
    this.name = 'PostgresDataAssetDownloadError';
  }
}

export class PostgresDataAssetDownloadPort {
  readonly #pool: AssetDownloadPool;
  readonly #objectStore: AssetDownloadObjectStore;
  readonly #ttlSeconds: number;

  constructor(options: {
    readonly pool: AssetDownloadPool;
    readonly objectStore: AssetDownloadObjectStore;
    readonly ttlSeconds?: number;
  }) {
    const ttlSeconds = options.ttlSeconds ?? 60;
    if (
      typeof options.pool?.connect !== 'function' ||
      typeof options.objectStore?.planVersionDownload !== 'function' ||
      !Number.isSafeInteger(ttlSeconds) ||
      ttlSeconds < 60 ||
      ttlSeconds > 900
    ) {
      throw new PostgresDataAssetDownloadError('UNAVAILABLE');
    }
    this.#pool = options.pool;
    this.#objectStore = options.objectStore;
    this.#ttlSeconds = ttlSeconds;
  }

  async createDownload(input: {
    readonly context: PlatformRequestContext;
    readonly versionId: string;
  }): Promise<{ readonly url: string; readonly expiresAt: string }> {
    let client: AssetDownloadClient;
    try {
      client = await this.#pool.connect();
    } catch {
      throw new PostgresDataAssetDownloadError('UNAVAILABLE');
    }
    try {
      await client.query('BEGIN');
      await client.query(SET_SCOPE_SQL, [
        input.context.authorization.tenantId,
        input.context.authorization.projectId,
        input.context.authorization.maxSecurityLevel,
        String(input.context.authorization.authzVersion),
      ]);
      const result = await client.query(LOOKUP_SQL, [
        input.context.authorization.tenantId,
        input.context.authorization.projectId,
        input.versionId,
      ]);
      const row = result.rows[0];
      const contentHash = row?.['content_hash'];
      const securityLevel = row?.['security_level'];
      const policyVersion = Number(row?.['policy_version']);
      if (
        row === undefined ||
        result.rows.length !== 1 ||
        typeof contentHash !== 'string' ||
        !HASH_PATTERN.test(contentHash) ||
        typeof securityLevel !== 'string' ||
        !Number.isSafeInteger(policyVersion)
      ) {
        await client.query('ROLLBACK');
        throw new PostgresDataAssetDownloadError('NOT_FOUND');
      }
      const signed = await this.#objectStore.planVersionDownload({
        tenantId: input.context.authorization.tenantId,
        projectId: input.context.authorization.projectId,
        versionId: input.versionId,
        sha256: contentHash,
        ttlSeconds: this.#ttlSeconds,
      });
      await client.query(AUDIT_SQL, [
        input.context.authorization.tenantId,
        input.context.authorization.projectId,
        input.context.principal.actorId,
        input.versionId,
        input.context.authorization.purpose,
        input.context.traceId,
        securityLevel,
        policyVersion,
      ]);
      await client.query('COMMIT');
      return Object.freeze({ url: signed.url, expiresAt: signed.expiresAt });
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // The sanitized port error remains authoritative.
      }
      if (error instanceof PostgresDataAssetDownloadError) throw error;
      throw new PostgresDataAssetDownloadError('UNAVAILABLE');
    } finally {
      client.release();
    }
  }
}
