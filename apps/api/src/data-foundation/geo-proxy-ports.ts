import { Buffer } from 'node:buffer';

import {
  PlatformRequestContextSchema,
  type PlatformRequestContext,
} from '@wiser/platform-contracts';

import {
  DataFoundationGeoProxyError,
  type DataFoundationGeoAuditPort,
  type DataFoundationGeoAuditRecord,
  type DataFoundationGeoAuthorityPort,
  type DataFoundationGeoProxyPort,
  type DataFoundationGeoProxyRequest,
  type DataFoundationGeoProxyResponse,
  type DataFoundationGeoTarget,
} from './geo-proxy-module.js';

const MAXIMUM_PROXY_BYTES = 8 * 1024 * 1024;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const TRACE_PATTERN = /^[a-f0-9]{32}$/;
const BUCKET_PATTERN = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;
const COG_MEDIA_TYPES = new Set([
  'image/tiff',
  'image/geotiff',
  'application/geotiff',
  'application/x-geotiff',
]);

function proxyError(
  code: ConstructorParameters<typeof DataFoundationGeoProxyError>[0],
  cause?: unknown,
) {
  return new DataFoundationGeoProxyError(code, cause);
}

function rootOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw proxyError('INVALID_CONFIGURATION');
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username !== '' ||
    url.password !== '' ||
    url.search !== '' ||
    url.hash !== '' ||
    (url.pathname !== '' && url.pathname !== '/')
  ) {
    throw proxyError('INVALID_CONFIGURATION');
  }
  return url.origin;
}

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });
}

function validSecret(value: string): boolean {
  return (
    value.length >= 16 && value.length <= 2_048 && !hasControlCharacter(value)
  );
}

function safeHeader(value: string | null, maximum = 1_024) {
  return value !== null &&
    value.length > 0 &&
    value.length <= maximum &&
    !hasControlCharacter(value)
    ? value
    : undefined;
}

function exactQuery(
  request: DataFoundationGeoProxyRequest,
): Readonly<Record<string, string>> | null {
  const result: Record<string, string> = {};
  if (request.query.length > 32) return null;
  for (const [key, value] of request.query) {
    if (
      !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key) ||
      Object.hasOwn(result, key) ||
      value.length > 2_048 ||
      hasControlCharacter(value)
    ) {
      return null;
    }
    result[key] = value;
  }
  return result;
}

function safeS3Source(value: string, context: PlatformRequestContext) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  const parts = url.pathname.split('/').filter(Boolean);
  return (
    url.protocol === 's3:' &&
    url.username === '' &&
    url.password === '' &&
    url.search === '' &&
    url.hash === '' &&
    BUCKET_PATTERN.test(url.hostname) &&
    parts.length === 8 &&
    parts[0] === 'tenants' &&
    parts[1] === context.authorization.tenantId &&
    parts[2] === 'projects' &&
    parts[3] === context.authorization.projectId &&
    parts[4] === 'versions' &&
    UUID_PATTERN.test(parts[5] ?? '') &&
    parts[6] === 'sha256' &&
    HASH_PATTERN.test(parts[7] ?? '')
  );
}

function validateProxyRequest(request: DataFoundationGeoProxyRequest): void {
  const context = PlatformRequestContextSchema.safeParse(request.context);
  const query = exactQuery(request);
  if (
    !context.success ||
    query === null ||
    !['GET', 'HEAD'].includes(request.method) ||
    !(request.signal instanceof AbortSignal)
  ) {
    throw proxyError('INVALID_CONFIGURATION');
  }

  switch (request.target) {
    case 'GEOSERVER': {
      if (
        ![
          '/geoserver/wms',
          '/geoserver/wfs',
          '/geoserver/wcs',
          '/geoserver/gwc/service/wmts',
        ].includes(request.path) ||
        Object.keys(query).some((key) =>
          ['url', 'sld', 'sld_body', 'remote_ows'].includes(key),
        )
      ) {
        throw proxyError('INVALID_CONFIGURATION');
      }
      const cql = query['cql_filter'];
      if (
        cql !== undefined &&
        (!cql.includes(`tenant_id='${context.data.authorization.tenantId}'`) ||
          !cql.includes(`project_id='${context.data.authorization.projectId}'`))
      ) {
        throw proxyError('INVALID_CONFIGURATION');
      }
      break;
    }
    case 'STAC': {
      if (
        !(
          request.path === '/conformance' ||
          request.path === '/search' ||
          /^\/collections\/wiser-[a-f0-9]{32}(?:\/items(?:\/wiser-[a-f0-9]{48})?)?$/.test(
            request.path,
          )
        ) ||
        Object.keys(query).some(
          (key) =>
            ![
              'limit',
              'bbox',
              'datetime',
              'ids',
              'token',
              'collections',
            ].includes(key),
        )
      ) {
        throw proxyError('INVALID_CONFIGURATION');
      }
      break;
    }
    case 'TITILER': {
      if (
        !/^\/cog\/tiles\/WebMercatorQuad\/\d{1,2}\/\d+\/\d+\.(?:png|jpg|webp)$/.test(
          request.path,
        ) ||
        query['url'] === undefined ||
        !safeS3Source(query['url'], context.data) ||
        Object.keys(query).some(
          (key) =>
            ![
              'url',
              'resampling',
              'rescale',
              'bidx',
              'colormap_name',
              'return_mask',
            ].includes(key),
        )
      ) {
        throw proxyError('INVALID_CONFIGURATION');
      }
      break;
    }
    case 'MARTIN': {
      if (
        !/^\/wiser_spatial_extent_mvt\/\d{1,2}\/\d+\/\d+$/.test(request.path) ||
        Object.keys(query).length !== 5 ||
        query['tenantId'] !== context.data.authorization.tenantId ||
        query['projectId'] !== context.data.authorization.projectId ||
        !UUID_PATTERN.test(query['versionId'] ?? '') ||
        query['maxSecurityLevel'] !==
          context.data.authorization.maxSecurityLevel ||
        query['policyVersion'] !==
          String(context.data.authorization.authzVersion)
      ) {
        throw proxyError('INVALID_CONFIGURATION');
      }
      break;
    }
  }
}

async function boundedBody(
  response: Response,
  maximumBytes: number,
): Promise<Uint8Array> {
  const declared = response.headers.get('content-length');
  if (
    declared !== null &&
    (!/^\d+$/.test(declared) || Number(declared) > maximumBytes)
  ) {
    throw proxyError('RESPONSE_TOO_LARGE');
  }
  if (response.body === null) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      if (!(chunk.value instanceof Uint8Array)) {
        throw proxyError('INVALID_RESPONSE');
      }
      length += chunk.value.byteLength;
      if (length > maximumBytes) {
        await reader.cancel();
        throw proxyError('RESPONSE_TOO_LARGE');
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  return new Uint8Array(Buffer.concat(chunks, length));
}

export class FixedOriginDataFoundationGeoProxyPort implements DataFoundationGeoProxyPort {
  readonly #origins: Readonly<Record<DataFoundationGeoTarget, string>>;
  readonly #stacAuthorization: string;
  readonly #fetch: typeof globalThis.fetch;
  readonly #maximumResponseBytes: number;

  constructor(options: {
    readonly origins: Readonly<Record<DataFoundationGeoTarget, string>>;
    readonly stacBearerToken: string;
    readonly fetch?: typeof globalThis.fetch;
    readonly maximumResponseBytes?: number;
  }) {
    const maximumResponseBytes =
      options.maximumResponseBytes ?? MAXIMUM_PROXY_BYTES;
    if (
      !validSecret(options.stacBearerToken) ||
      typeof (options.fetch ?? globalThis.fetch) !== 'function' ||
      !Number.isSafeInteger(maximumResponseBytes) ||
      maximumResponseBytes < 1_024 ||
      maximumResponseBytes > MAXIMUM_PROXY_BYTES
    ) {
      throw proxyError('INVALID_CONFIGURATION');
    }
    this.#origins = Object.freeze({
      GEOSERVER: rootOrigin(options.origins.GEOSERVER),
      STAC: rootOrigin(options.origins.STAC),
      TITILER: rootOrigin(options.origins.TITILER),
      MARTIN: rootOrigin(options.origins.MARTIN),
    });
    this.#stacAuthorization = `Bearer ${options.stacBearerToken}`;
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#maximumResponseBytes = maximumResponseBytes;
  }

  async request(
    request: DataFoundationGeoProxyRequest,
  ): Promise<DataFoundationGeoProxyResponse> {
    validateProxyRequest(request);
    const url = new URL(request.path, this.#origins[request.target]);
    if (url.origin !== this.#origins[request.target]) {
      throw proxyError('INVALID_CONFIGURATION');
    }
    for (const [key, value] of request.query)
      url.searchParams.append(key, value);
    const headers = new Headers({
      accept:
        request.target === 'MARTIN'
          ? 'application/vnd.mapbox-vector-tile, application/x-protobuf'
          : request.target === 'TITILER'
            ? 'image/png, image/jpeg, image/webp'
            : request.target === 'STAC'
              ? 'application/geo+json, application/json'
              : 'application/xml, application/geo+json, application/json, image/png, image/jpeg, image/tiff',
    });
    if (request.target === 'STAC') {
      headers.set('authorization', this.#stacAuthorization);
    }
    let response: Response;
    try {
      response = await this.#fetch(url, {
        method: request.method,
        headers,
        redirect: 'error',
        signal: request.signal,
      });
    } catch (error) {
      if (request.signal.aborted) throw proxyError('TIMEOUT', error);
      throw proxyError('UPSTREAM_UNAVAILABLE', error);
    }
    const contentType = response.headers.get('content-type');
    if (contentType === null || contentType.length > 255) {
      throw proxyError('INVALID_RESPONSE');
    }
    const etag = safeHeader(response.headers.get('etag'));
    const lastModified = safeHeader(response.headers.get('last-modified'));
    return Object.freeze({
      status: response.status,
      contentType,
      body: await boundedBody(response, this.#maximumResponseBytes),
      ...(etag === undefined ? {} : { etag }),
      ...(lastModified === undefined ? {} : { lastModified }),
    });
  }
}

interface GeoAuthorityClient {
  query(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ readonly rows: readonly Record<string, unknown>[] }>;
  release(): void;
}

export interface DataFoundationGeoAuthorityPool {
  connect(): Promise<GeoAuthorityClient>;
}

const SET_SCOPE_SQL = `
/* data.geo-authority.scope */
select set_config('wiser.tenant_id', $1, true),
  set_config('wiser.project_id', $2, true),
  set_config('wiser.max_security_level', $3, true),
  set_config('wiser.policy_version', $4, true),
  set_config('statement_timeout', '5000', true)
`;

const VECTOR_VERSION_SQL = `
/* data.geo-authority.vector */
select version.version_id::text
from catalog.data_item_version as version
where version.tenant_id = $1::uuid and version.project_id = $2::uuid
  and version.version_id = $3::uuid and version.committed_at is not null
  and security.authorized_row(version.tenant_id, version.project_id,
    version.security_level, version.policy_version)
  and exists (
    select 1 from catalog.spatial_extent as extent
    where extent.tenant_id = version.tenant_id
      and extent.project_id = version.project_id
      and extent.version_id = version.version_id
      and security.authorized_row(extent.tenant_id, extent.project_id,
        extent.security_level, extent.policy_version)
  )
limit 1
for key share of version
`;

const RASTER_VERSION_SQL = `
/* data.geo-authority.raster */
select asset.version_id::text, asset.storage_key,
  encode(asset.content_hash, 'hex') as content_hash, asset.media_type
from catalog.asset as asset
join catalog.data_item_version as version
  on version.tenant_id = asset.tenant_id
 and version.project_id = asset.project_id
 and version.version_id = asset.version_id
join ingestion.input_asset as input
  on input.tenant_id = asset.tenant_id
 and input.project_id = asset.project_id
 and input.asset_id = asset.asset_id
where asset.tenant_id = $1::uuid and asset.project_id = $2::uuid
  and asset.version_id = $3::uuid and version.committed_at is not null
  and asset.lifecycle_state = 'RAW' and asset.content_hash is not null
  and asset.content_blob_id is not null
  and lower(btrim(split_part(asset.media_type, ';', 1))) in (
    'image/tiff', 'image/geotiff', 'application/geotiff',
    'application/x-geotiff'
  )
  and security.authorized_row(asset.tenant_id, asset.project_id,
    asset.security_level, asset.policy_version)
  and security.authorized_row(version.tenant_id, version.project_id,
    version.security_level, version.policy_version)
order by input.ordinal, asset.asset_id
limit 1
for key share of asset, version
`;

const AUDIT_SQL = `
/* data.geo-authority.audit */
insert into security.audit_event (
  tenant_id, project_id, actor_id, action, resource_type, resource_id,
  decision, purpose, context, security_level, policy_version, row_version
) values (
  $1::uuid, $2::uuid, $3::uuid, 'data.geo.read', $4, $5, $6, $7,
  jsonb_build_object('traceId', $8::text, 'target', $9::text,
    'reason', $10::text), $11, $12::bigint, 1
)
`;

async function rollback(client: GeoAuthorityClient) {
  try {
    await client.query('ROLLBACK');
  } catch {
    // The stable authority error remains authoritative.
  }
}

function validateAuthorityInput(input: {
  readonly context: PlatformRequestContext;
  readonly versionId: string;
}) {
  const context = PlatformRequestContextSchema.safeParse(input.context);
  if (!context.success || !UUID_PATTERN.test(input.versionId)) {
    throw proxyError('NOT_FOUND');
  }
  return context.data;
}

export class PostgresDataFoundationGeoAuthorityPort
  implements DataFoundationGeoAuthorityPort, DataFoundationGeoAuditPort
{
  readonly #pool: DataFoundationGeoAuthorityPool;
  readonly #bucket: string;

  constructor(options: {
    readonly pool: DataFoundationGeoAuthorityPool;
    readonly bucket: string;
  }) {
    if (
      typeof options.pool?.connect !== 'function' ||
      !BUCKET_PATTERN.test(options.bucket) ||
      options.bucket.includes('..')
    ) {
      throw proxyError('INVALID_CONFIGURATION');
    }
    this.#pool = options.pool;
    this.#bucket = options.bucket;
  }

  async #client(): Promise<GeoAuthorityClient> {
    try {
      return await this.#pool.connect();
    } catch (error) {
      throw proxyError('UPSTREAM_UNAVAILABLE', error);
    }
  }

  async #scope(client: GeoAuthorityClient, context: PlatformRequestContext) {
    await client.query(SET_SCOPE_SQL, [
      context.authorization.tenantId,
      context.authorization.projectId,
      context.authorization.maxSecurityLevel,
      String(context.authorization.authzVersion),
    ]);
  }

  async authorizeVectorVersion(input: {
    readonly context: PlatformRequestContext;
    readonly versionId: string;
  }): Promise<void> {
    const context = validateAuthorityInput(input);
    const client = await this.#client();
    try {
      await client.query('BEGIN');
      await this.#scope(client, context);
      const result = await client.query(VECTOR_VERSION_SQL, [
        context.authorization.tenantId,
        context.authorization.projectId,
        input.versionId,
      ]);
      if (
        result.rows.length !== 1 ||
        result.rows[0]?.['version_id'] !== input.versionId
      ) {
        throw proxyError('NOT_FOUND');
      }
      await client.query('COMMIT');
    } catch (error) {
      await rollback(client);
      if (error instanceof DataFoundationGeoProxyError) throw error;
      throw proxyError('UPSTREAM_UNAVAILABLE', error);
    } finally {
      client.release();
    }
  }

  async resolveRasterVersion(input: {
    readonly context: PlatformRequestContext;
    readonly versionId: string;
  }): Promise<{ readonly sourceUrl: string }> {
    const context = validateAuthorityInput(input);
    const client = await this.#client();
    try {
      await client.query('BEGIN');
      await this.#scope(client, context);
      const result = await client.query(RASTER_VERSION_SQL, [
        context.authorization.tenantId,
        context.authorization.projectId,
        input.versionId,
      ]);
      const row = result.rows.find((candidate) => {
        const storageKey = candidate['storage_key'];
        const contentHash = candidate['content_hash'];
        const mediaType = candidate['media_type'];
        const expectedKey =
          `tenants/${context.authorization.tenantId}` +
          `/projects/${context.authorization.projectId}` +
          `/versions/${input.versionId}/sha256/${String(contentHash)}`;
        const normalizedMediaType =
          typeof mediaType === 'string'
            ? mediaType.split(';', 1)[0]!.trim().toLowerCase()
            : '';
        return (
          candidate['version_id'] === input.versionId &&
          typeof storageKey === 'string' &&
          typeof contentHash === 'string' &&
          HASH_PATTERN.test(contentHash) &&
          storageKey === expectedKey &&
          COG_MEDIA_TYPES.has(normalizedMediaType)
        );
      });
      if (row === undefined) {
        throw proxyError('NOT_FOUND');
      }
      const storageKey = row['storage_key'] as string;
      await client.query('COMMIT');
      return Object.freeze({
        sourceUrl: `s3://${this.#bucket}/${storageKey}`,
      });
    } catch (error) {
      await rollback(client);
      if (error instanceof DataFoundationGeoProxyError) throw error;
      throw proxyError('UPSTREAM_UNAVAILABLE', error);
    } finally {
      client.release();
    }
  }

  async record(record: DataFoundationGeoAuditRecord): Promise<void> {
    const context = PlatformRequestContextSchema.safeParse(record.context);
    if (
      !context.success ||
      !HASH_PATTERN.test(record.routeHash) ||
      !TRACE_PATTERN.test(record.traceId) ||
      !Number.isFinite(Date.parse(record.occurredAt))
    ) {
      throw proxyError('INVALID_CONFIGURATION');
    }
    const client = await this.#client();
    try {
      await client.query('BEGIN');
      await this.#scope(client, context.data);
      await client.query(AUDIT_SQL, [
        context.data.authorization.tenantId,
        context.data.authorization.projectId,
        context.data.principal.actorId,
        `geo-${record.target.toLowerCase()}`,
        record.routeHash,
        record.decision,
        context.data.authorization.purpose,
        record.traceId,
        record.target,
        record.reason ?? null,
        context.data.authorization.maxSecurityLevel,
        context.data.authorization.authzVersion,
      ]);
      await client.query('COMMIT');
    } catch (error) {
      await rollback(client);
      if (error instanceof DataFoundationGeoProxyError) throw error;
      throw proxyError('UPSTREAM_UNAVAILABLE', error);
    } finally {
      client.release();
    }
  }
}
