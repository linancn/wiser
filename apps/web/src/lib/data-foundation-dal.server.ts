import 'server-only';

import { connection } from 'next/server';

import {
  parseCapabilityRegistry,
  parseDataCatalogPage,
  parseDataHealth,
  parseDataItemDetail,
  parseDataItemVersionPage,
  parseGeoQuery,
  parseGraphResult,
  parseIngestion,
  parseOperation,
  parseOperationEventStream,
  parseSearchPage,
  parseStacFeatureCollection,
  type CapabilityRegistryDto,
  type DataCatalogPageDto,
  type DataHealthDto,
  type DataItemDetailDto,
  type DataItemVersionPageDto,
  type GeoGeometryDto,
  type GeoQueryDto,
  type GraphResultDto,
  type IngestionDto,
  type OperationDto,
  type OperationEventDto,
  type SearchPageDto,
  type StacFeatureCollectionDto,
} from './data-foundation';
import { createWiserServerSupabaseClient } from './supabase/server';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PURPOSE_PATTERN = /^[a-z][a-z0-9-]{0,95}$/;
const MAX_ACCESS_TOKEN_BYTES = 16_384;
const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_RESPONSE_LIMIT_BYTES = 4_194_304;

export interface DataFoundationWebConfig {
  readonly apiOrigin: string;
  readonly tenantId: string;
  readonly projectId: string;
  readonly purpose: string;
  readonly requestTimeoutMs: number;
  readonly responseLimitBytes: number;
}

export interface DataFoundationAuthClient {
  readonly auth: {
    getClaims(): Promise<{
      readonly data: { readonly claims?: unknown } | null;
      readonly error: unknown;
    }>;
    getSession(): Promise<{
      readonly data: {
        readonly session: { readonly access_token?: unknown } | null;
      } | null;
      readonly error: unknown;
    }>;
  };
}

export type DataFoundationApiErrorKind =
  | 'authentication'
  | 'authorization'
  | 'configuration'
  | 'contract'
  | 'invalid-request'
  | 'not-found'
  | 'unavailable';

export class DataFoundationApiError extends Error {
  constructor(
    readonly kind: DataFoundationApiErrorKind,
    readonly status: number,
  ) {
    super(`Data Foundation request failed: ${kind}.`);
    this.name = 'DataFoundationApiError';
  }
}

export interface DataFoundationDal {
  health(): Promise<DataHealthDto>;
  capabilities(): Promise<CapabilityRegistryDto>;
  catalog(input: {
    readonly query?: string;
    readonly qualityGrades?: readonly string[];
    readonly first: number;
    readonly after?: string;
  }): Promise<DataCatalogPageDto>;
  dataItem(dataItemId: string, versionId?: string): Promise<DataItemDetailDto>;
  versions(dataItemId: string): Promise<DataItemVersionPageDto>;
  ingestion(ingestionId: string): Promise<IngestionDto>;
  operation(operationId: string): Promise<OperationDto>;
  operationEvents(operationId: string): Promise<readonly OperationEventDto[]>;
  search(query: string): Promise<SearchPageDto>;
  knowledge(query: string): Promise<SearchPageDto>;
  graph(entityId: string): Promise<GraphResultDto>;
  geo(geometry: GeoGeometryDto): Promise<GeoQueryDto>;
  stacItems(input?: {
    readonly bbox?: readonly [number, number, number, number];
  }): Promise<StacFeatureCollectionDto>;
}

interface DataFoundationDalOptions {
  readonly config: DataFoundationWebConfig;
  readonly createAuthClient: () => Promise<DataFoundationAuthClient | null>;
  readonly fetch?: typeof globalThis.fetch;
  readonly now?: () => Date;
}

interface VerifiedClaims {
  readonly sub: string;
  readonly sessionId: string;
  readonly exp: number;
}

function positiveInteger(
  value: string | undefined,
  fallback: number,
  maximum: number,
): number | null {
  if (value === undefined) return fallback;
  if (!/^[1-9]\d*$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed <= maximum ? parsed : null;
}

function httpOrigin(value: string | undefined): string | null {
  if (value === undefined || value.length > 2_048) return null;
  try {
    const url = new URL(value);
    if (
      (url.protocol !== 'http:' && url.protocol !== 'https:') ||
      url.username !== '' ||
      url.password !== '' ||
      url.search !== '' ||
      url.hash !== ''
    ) {
      return null;
    }
    url.pathname = url.pathname.replace(/\/+$/, '');
    return url.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

export function loadDataFoundationWebConfig(
  environment: NodeJS.ProcessEnv,
): DataFoundationWebConfig | null {
  const apiOrigin = httpOrigin(
    environment['WISER_DATA_API_INTERNAL_URL'] ??
      environment['AGENT_EXCON_API_INTERNAL_URL'],
  );
  const tenantId = environment['WISER_DATA_TENANT_ID'];
  const projectId = environment['WISER_DATA_PROJECT_ID'];
  const purpose = environment['WISER_DATA_PURPOSE'] ?? 'data-steward-console';
  const requestTimeoutMs = positiveInteger(
    environment['WISER_DATA_REQUEST_TIMEOUT_MS'],
    DEFAULT_TIMEOUT_MS,
    30_000,
  );
  const responseLimitBytes = positiveInteger(
    environment['WISER_DATA_RESPONSE_LIMIT_BYTES'],
    DEFAULT_RESPONSE_LIMIT_BYTES,
    8_388_608,
  );
  if (
    apiOrigin === null ||
    tenantId === undefined ||
    !UUID_PATTERN.test(tenantId) ||
    projectId === undefined ||
    !UUID_PATTERN.test(projectId) ||
    !PURPOSE_PATTERN.test(purpose) ||
    requestTimeoutMs === null ||
    responseLimitBytes === null
  ) {
    return null;
  }
  return {
    apiOrigin,
    tenantId,
    projectId,
    purpose,
    requestTimeoutMs,
    responseLimitBytes,
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function verifiedClaims(value: unknown, now: Date): VerifiedClaims | null {
  const claims = record(value);
  if (
    claims === null ||
    claims.role !== 'authenticated' ||
    typeof claims.sub !== 'string' ||
    !UUID_PATTERN.test(claims.sub) ||
    typeof claims.session_id !== 'string' ||
    !UUID_PATTERN.test(claims.session_id) ||
    typeof claims.exp !== 'number' ||
    !Number.isSafeInteger(claims.exp) ||
    claims.exp * 1_000 <= now.valueOf()
  ) {
    return null;
  }
  return {
    sub: claims.sub,
    sessionId: claims.session_id,
    exp: claims.exp,
  };
}

function decodeAccessTokenClaims(
  token: string,
): Record<string, unknown> | null {
  const parts = token.split('.');
  const payload = parts[1];
  if (parts.length !== 3 || payload === undefined) return null;
  try {
    const decoded = Buffer.from(payload, 'base64url').toString('utf8');
    if (Buffer.from(decoded).toString('base64url') !== payload) return null;
    return record(JSON.parse(decoded) as unknown);
  } catch {
    return null;
  }
}

async function verifiedAccessToken(
  createAuthClient: DataFoundationDalOptions['createAuthClient'],
  now: () => Date,
): Promise<string> {
  let client: DataFoundationAuthClient | null;
  try {
    client = await createAuthClient();
  } catch {
    throw new DataFoundationApiError('configuration', 503);
  }
  if (client === null) {
    throw new DataFoundationApiError('configuration', 503);
  }
  let claimsResult: Awaited<
    ReturnType<DataFoundationAuthClient['auth']['getClaims']>
  >;
  try {
    claimsResult = await client.auth.getClaims();
  } catch {
    throw new DataFoundationApiError('authentication', 401);
  }
  const claims =
    claimsResult.error === null
      ? verifiedClaims(claimsResult.data?.claims, now())
      : null;
  if (claims === null) {
    throw new DataFoundationApiError('authentication', 401);
  }
  let sessionResult: Awaited<
    ReturnType<DataFoundationAuthClient['auth']['getSession']>
  >;
  try {
    sessionResult = await client.auth.getSession();
  } catch {
    throw new DataFoundationApiError('authentication', 401);
  }
  const token = sessionResult.data?.session?.access_token;
  if (
    sessionResult.error !== null ||
    typeof token !== 'string' ||
    token.length === 0 ||
    Buffer.byteLength(token) > MAX_ACCESS_TOKEN_BYTES
  ) {
    throw new DataFoundationApiError('authentication', 401);
  }
  const payload = decodeAccessTokenClaims(token);
  if (
    payload?.sub !== claims.sub ||
    payload.session_id !== claims.sessionId ||
    payload.exp !== claims.exp ||
    payload.role !== 'authenticated'
  ) {
    throw new DataFoundationApiError('authentication', 401);
  }
  return token;
}

function classifyStatus(status: number): DataFoundationApiError {
  if (status === 401) return new DataFoundationApiError('authentication', 401);
  if (status === 403) return new DataFoundationApiError('authorization', 403);
  if (status === 404) return new DataFoundationApiError('not-found', 404);
  if (status === 400 || status === 409 || status === 422) {
    return new DataFoundationApiError('invalid-request', status);
  }
  if (status === 502 || status === 503 || status === 504) {
    return new DataFoundationApiError('unavailable', status);
  }
  return new DataFoundationApiError('unavailable', status);
}

async function boundedText(response: Response, limit: number): Promise<string> {
  const declared = response.headers.get('content-length');
  if (declared !== null) {
    const parsed = Number(declared);
    if (Number.isFinite(parsed) && parsed > limit) {
      throw new DataFoundationApiError('contract', 502);
    }
  }
  if (response.body === null) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel();
        throw new DataFoundationApiError('contract', 502);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

function json(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new DataFoundationApiError('contract', 502);
  }
}

function validateUuid(value: string): void {
  if (!UUID_PATTERN.test(value)) {
    throw new DataFoundationApiError('invalid-request', 422);
  }
}

function validateQuery(value: string, maximum: number): void {
  if (value.length < 1 || value.length > maximum) {
    throw new DataFoundationApiError('invalid-request', 422);
  }
}

export function createDataFoundationDal(
  options: DataFoundationDalOptions,
): DataFoundationDal {
  const request = options.fetch ?? globalThis.fetch;
  const now = options.now ?? (() => new Date());
  let tokenPromise: Promise<string> | undefined;
  const token = () => {
    tokenPromise ??= verifiedAccessToken(options.createAuthClient, now);
    return tokenPromise;
  };

  async function call(
    path: string,
    init: {
      readonly method?: 'GET' | 'POST';
      readonly body?: unknown;
      readonly acceptedStatuses?: readonly number[];
    } = {},
    mode: 'json' | 'sse' = 'json',
  ): Promise<unknown> {
    const accessToken = await token();
    const headers = new Headers({
      Accept:
        mode === 'sse'
          ? 'text/event-stream'
          : 'application/json; charset=utf-8',
      Authorization: `Bearer ${accessToken}`,
      'X-WISER-Tenant-ID': options.config.tenantId,
      'X-WISER-Project-ID': options.config.projectId,
      'X-WISER-Purpose': options.config.purpose,
    });
    if (init.body !== undefined) {
      headers.set('Content-Type', 'application/json; charset=utf-8');
    }
    let response: Response;
    try {
      response = await request(`${options.config.apiOrigin}${path}`, {
        method: init.method ?? 'GET',
        headers,
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(options.config.requestTimeoutMs),
      });
    } catch (error) {
      if (error instanceof DataFoundationApiError) throw error;
      throw new DataFoundationApiError('unavailable', 503);
    }
    if (
      !response.ok &&
      !(init.acceptedStatuses ?? []).includes(response.status)
    ) {
      throw classifyStatus(response.status);
    }
    const contentType = response.headers.get('content-type') ?? '';
    if (
      (mode === 'json' &&
        !contentType.includes('application/json') &&
        !contentType.includes('application/geo+json')) ||
      (mode === 'sse' && !contentType.includes('text/event-stream'))
    ) {
      throw new DataFoundationApiError('contract', 502);
    }
    let text: string;
    try {
      text = await boundedText(response, options.config.responseLimitBytes);
    } catch (error) {
      if (error instanceof DataFoundationApiError) throw error;
      throw new DataFoundationApiError('contract', 502);
    }
    return mode === 'json' ? json(text) : text;
  }

  async function parsed<Result>(
    work: () => Promise<unknown>,
    parse: (value: unknown) => Result,
  ): Promise<Result> {
    try {
      return parse(await work());
    } catch (error) {
      if (error instanceof DataFoundationApiError) throw error;
      throw new DataFoundationApiError('contract', 502);
    }
  }

  const dal: DataFoundationDal = {
    health: () =>
      parsed(
        () =>
          call('/api/data/v1/health', {
            acceptedStatuses: [503],
          }),
        parseDataHealth,
      ),
    capabilities: () =>
      parsed(() => call('/api/data/v1/capabilities'), parseCapabilityRegistry),
    catalog: (input) => {
      if (
        !Number.isSafeInteger(input.first) ||
        input.first < 1 ||
        input.first > 100
      ) {
        throw new DataFoundationApiError('invalid-request', 422);
      }
      const search = new URLSearchParams({ first: String(input.first) });
      if (input.query !== undefined) {
        validateQuery(input.query, 512);
        search.set('query', input.query);
      }
      if (input.qualityGrades !== undefined) {
        search.set('qualityGrades', input.qualityGrades.join(','));
      }
      if (input.after !== undefined) search.set('after', input.after);
      return parsed(
        () => call(`/api/data/v1/catalog/data-items?${search.toString()}`),
        parseDataCatalogPage,
      );
    },
    dataItem: (dataItemId, versionId) => {
      validateUuid(dataItemId);
      if (versionId !== undefined) validateUuid(versionId);
      const search = new URLSearchParams();
      if (versionId !== undefined) search.set('versionId', versionId);
      const suffix = search.size === 0 ? '' : `?${search.toString()}`;
      return parsed(
        () => call(`/api/data/v1/catalog/data-items/${dataItemId}${suffix}`),
        parseDataItemDetail,
      );
    },
    versions: (dataItemId) => {
      validateUuid(dataItemId);
      return parsed(
        () =>
          call(
            `/api/data/v1/catalog/data-items/${dataItemId}/versions?first=100`,
          ),
        parseDataItemVersionPage,
      );
    },
    ingestion: (ingestionId) => {
      validateUuid(ingestionId);
      return parsed(
        () => call(`/api/data/v1/ingestions/${ingestionId}`),
        parseIngestion,
      );
    },
    operation: (operationId) => {
      validateUuid(operationId);
      return parsed(
        () => call(`/api/data/v1/operations/${operationId}`),
        parseOperation,
      );
    },
    operationEvents: async (operationId) => {
      validateUuid(operationId);
      const value = await call(
        `/api/data/v1/operations/${operationId}/events?first=100`,
        {},
        'sse',
      );
      if (typeof value !== 'string') {
        throw new DataFoundationApiError('contract', 502);
      }
      try {
        return parseOperationEventStream(value);
      } catch {
        throw new DataFoundationApiError('contract', 502);
      }
    },
    search: (query) => {
      validateQuery(query, 2_048);
      return parsed(
        () =>
          call('/api/data/v1/search', {
            method: 'POST',
            body: { query, first: 50 },
          }),
        parseSearchPage,
      );
    },
    knowledge: (query) => {
      validateQuery(query, 2_048);
      return parsed(
        () =>
          call('/api/data/v1/knowledge/search', {
            method: 'POST',
            body: { query, first: 50 },
          }),
        parseSearchPage,
      );
    },
    graph: (entityId) => {
      validateQuery(entityId, 256);
      return parsed(
        () =>
          call('/api/data/v1/graph/expand', {
            method: 'POST',
            body: { entityId, maxDepth: 2, first: 100 },
          }),
        parseGraphResult,
      );
    },
    geo: (geometry) =>
      parsed(
        () =>
          call('/api/data/v1/geo/query', {
            method: 'POST',
            body: { geometry, predicates: ['INTERSECTS'], first: 100 },
          }),
        parseGeoQuery,
      ),
    stacItems: (input = {}) => {
      const search = new URLSearchParams({ limit: '100' });
      if (input.bbox !== undefined) {
        search.set('bbox', input.bbox.join(','));
      }
      return parsed(
        () => call(`/api/data/v1/geo/stac/search?${search.toString()}`),
        parseStacFeatureCollection,
      );
    },
  };
  return Object.freeze(dal);
}

const GEO_PROXY_CONTENT_TYPES = new Set([
  'application/json',
  'application/geo+json',
  'application/xml',
  'text/xml',
  'application/gml+xml',
  'application/vnd.ogc.gml',
  'application/vnd.mapbox-vector-tile',
  'application/x-protobuf',
  'application/octet-stream',
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/tiff',
]);

function governedGeoPath(path: readonly string[]): string | null {
  if (
    path.length < 2 ||
    path.length > 10 ||
    path.some(
      (segment) =>
        segment.length === 0 ||
        segment.length > 128 ||
        segment === '.' ||
        segment === '..' ||
        segment.includes('/') ||
        segment.includes('\\') ||
        /[\u0000-\u001f\u007f]/.test(segment),
    )
  ) {
    return null;
  }
  const joined = path.join('/');
  if (
    /^(?:ogc\/(?:wms|wfs|wcs|wmts)|stac\/(?:conformance|search|collections\/(?:current|wiser-[a-f0-9]{32})(?:\/items(?:\/wiser-[a-f0-9]{48})?)?)|tiles\/vector\/versions\/[0-9a-f-]{36}\/\d{1,2}\/\d+\/\d+\.pbf|tiles\/raster\/versions\/[0-9a-f-]{36}\/WebMercatorQuad\/\d{1,2}\/\d+\/\d+\.(?:png|jpg|webp))$/i.test(
      joined,
    )
  ) {
    return joined;
  }
  return null;
}

async function boundedBytes(
  response: Response,
  limit: number,
): Promise<Uint8Array> {
  const declared = response.headers.get('content-length');
  if (
    declared !== null &&
    (!/^\d+$/.test(declared) || Number(declared) > limit)
  ) {
    throw new DataFoundationApiError('contract', 502);
  }
  if (response.body === null) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > limit) {
        await reader.cancel();
        throw new DataFoundationApiError('contract', 502);
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  return new Uint8Array(Buffer.concat(chunks, length));
}

export interface DataFoundationGeoWebProxyOptions {
  readonly request: Request;
  readonly path: readonly string[];
  readonly config: DataFoundationWebConfig;
  readonly createAuthClient: () => Promise<DataFoundationAuthClient | null>;
  readonly fetch?: typeof globalThis.fetch;
  readonly now?: () => Date;
}

export async function proxyDataFoundationGeoRequest(
  options: DataFoundationGeoWebProxyOptions,
): Promise<Response> {
  const path = governedGeoPath(options.path);
  if (path === null || !['GET', 'HEAD'].includes(options.request.method)) {
    throw new DataFoundationApiError('invalid-request', 422);
  }
  const incoming = new URL(options.request.url);
  if ([...incoming.searchParams].length > 32) {
    throw new DataFoundationApiError('invalid-request', 422);
  }
  const seen = new Set<string>();
  for (const [rawKey, value] of incoming.searchParams) {
    const key = rawKey.toLowerCase();
    if (
      seen.has(key) ||
      ['url', 'source', 'href', 'sld', 'sld_body'].includes(key) ||
      value.length > 2_048 ||
      /[\u0000-\u001f\u007f]/.test(value)
    ) {
      throw new DataFoundationApiError('invalid-request', 422);
    }
    seen.add(key);
  }
  const accessToken = await verifiedAccessToken(
    options.createAuthClient,
    options.now ?? (() => new Date()),
  );
  const upstream = new URL(
    `/api/data/v1/geo/${path}`,
    `${options.config.apiOrigin}/`,
  );
  upstream.search = incoming.search;
  let response: Response;
  try {
    response = await (options.fetch ?? globalThis.fetch)(upstream, {
      method: options.request.method,
      headers: {
        accept:
          options.request.headers.get('accept') ??
          'application/json, application/geo+json, image/png, image/jpeg, image/webp, application/vnd.mapbox-vector-tile',
        authorization: `Bearer ${accessToken}`,
        'x-wiser-tenant-id': options.config.tenantId,
        'x-wiser-project-id': options.config.projectId,
        'x-wiser-purpose': options.config.purpose,
      },
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(options.config.requestTimeoutMs),
    });
  } catch {
    throw new DataFoundationApiError('unavailable', 503);
  }
  const contentType = response.headers.get('content-type') ?? '';
  const mediaType = contentType.split(';', 1)[0]!.trim().toLowerCase();
  if (!GEO_PROXY_CONTENT_TYPES.has(mediaType)) {
    throw new DataFoundationApiError('contract', 502);
  }
  const body = await boundedBytes(response, options.config.responseLimitBytes);
  const headers = new Headers({
    'cache-control': 'private, no-cache, no-store, max-age=0, must-revalidate',
    'content-type': contentType,
  });
  const etag = response.headers.get('etag');
  if (
    etag !== null &&
    etag.length <= 1_024 &&
    !/[\u0000-\u001f\u007f]/.test(etag)
  ) {
    headers.set('etag', etag);
  }
  const responseBody = new ArrayBuffer(body.byteLength);
  new Uint8Array(responseBody).set(body);
  return new Response(options.request.method === 'HEAD' ? null : responseBody, {
    status: response.status,
    headers,
  });
}

export async function getDataFoundationDal(): Promise<DataFoundationDal> {
  await connection();
  const config = loadDataFoundationWebConfig(process.env);
  if (config === null) {
    throw new DataFoundationApiError('configuration', 503);
  }
  return createDataFoundationDal({
    config,
    createAuthClient: async () =>
      (await createWiserServerSupabaseClient()) as DataFoundationAuthClient | null,
  });
}
