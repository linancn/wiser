import 'server-only';

import { connection } from 'next/server';
import {
  DATA_CAPABILITY_REGISTRY,
  type DataCapabilityId,
  CreateExplorationViewInputSchema,
  CreateExplorationViewOutputSchema,
  ListExplorationViewsInputSchema,
  ListExplorationViewsOutputSchema,
  OpenExplorationViewInputSchema,
  OpenExplorationViewOutputSchema,
  RevokeExplorationViewOutputSchema,
  ExportExplorationInputSchema,
  ExportExplorationOutputSchema,
  ExplorationQueryInputSchema,
  ExplorationResultSchema,
  type ExplorationResult,
} from '@wiser/data-contracts';

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
import {
  verifiedSessionAccessToken,
  VerifiedSessionError,
  type VerifiedSessionClient,
} from './supabase/verified-session';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PURPOSE_PATTERN = /^[a-z][a-z0-9-]{0,95}$/;
const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_RESPONSE_LIMIT_BYTES = 4_194_304;
const GEO_PAGE_SIZE = 100;
const MAX_GEO_FEATURES = 10_000;
const MAX_GEO_PAGES = 101;

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });
}

export interface DataFoundationWebConfig {
  readonly apiOrigin: string;
  readonly tenantId: string;
  readonly projectId: string;
  readonly purpose: string;
  readonly requestTimeoutMs: number;
  readonly responseLimitBytes: number;
}

export type DataFoundationAuthClient = VerifiedSessionClient;

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
  assess(
    action: 'create' | 'get' | 'list',
    input: unknown,
    idempotencyKey?: string,
  ): Promise<unknown>;
  reconcile(
    action: 'create' | 'get' | 'review' | 'list',
    input: unknown,
    idempotencyKey?: string,
  ): Promise<unknown>;
  explorationView(
    action: 'create' | 'list' | 'open' | 'revoke' | 'export',
    input: unknown,
    idempotencyKey?: string,
  ): Promise<unknown>;
  explore(input: unknown): Promise<ExplorationResult>;
  health(): Promise<DataHealthDto>;
  capabilities(): Promise<CapabilityRegistryDto>;
  catalog(input: {
    readonly includeTotal?: boolean;
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
  search(query: string, after?: string): Promise<SearchPageDto>;
  knowledge(query: string, after?: string): Promise<SearchPageDto>;
  graph(entityId: string): Promise<GraphResultDto>;
  geo(input: {
    readonly geometry: GeoGeometryDto;
    readonly versionId?: string;
  }): Promise<GeoQueryDto>;
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

async function verifiedAccessToken(
  createAuthClient: DataFoundationDalOptions['createAuthClient'],
  now: () => Date,
): Promise<string> {
  try {
    return await verifiedSessionAccessToken(createAuthClient, now);
  } catch (error) {
    if (error instanceof VerifiedSessionError) {
      throw new DataFoundationApiError(error.kind, error.status);
    }
    throw new DataFoundationApiError('authentication', 401);
  }
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
      readonly idempotencyKey?: string;
      readonly expectedVersion?: number;
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
    if (init.idempotencyKey)
      headers.set('Idempotency-Key', init.idempotencyKey);
    if (init.expectedVersion !== undefined)
      headers.set('If-Match', `"v${init.expectedVersion}"`);
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
    assess: (action, input, idempotencyKey) => {
      const id: DataCapabilityId = `data.assessment.${action}`;
      const definition = DATA_CAPABILITY_REGISTRY[id];
      const checked = definition.inputSchema.safeParse(input);
      if (
        !checked.success ||
        (definition.kind === 'command' &&
          (!idempotencyKey || !UUID_PATTERN.test(idempotencyKey)))
      )
        throw new DataFoundationApiError('invalid-request', 422);
      const values = checked.data as Record<string, unknown>;
      let path = definition.restMapping.path;
      const body = { ...values };
      if (typeof body['assessmentId'] === 'string') {
        path = path.replace(
          ':assessmentId',
          encodeURIComponent(body['assessmentId']),
        );
        delete body['assessmentId'];
      }
      if (definition.restMapping.method === 'GET') {
        const query = new URLSearchParams(
          Object.entries(body).map(([key, value]) => [key, String(value)]),
        );
        if (query.size) path += `?${query}`;
      }
      return parsed(
        () =>
          call(path, {
            method: definition.restMapping.method as 'GET' | 'POST',
            ...(definition.kind === 'command' ? { body, idempotencyKey } : {}),
          }),
        (value) => definition.outputSchema.parse(value),
      );
    },

    reconcile: (action, input, idempotencyKey) => {
      const id: DataCapabilityId = `data.reconciliation.${action}`;
      const definition = DATA_CAPABILITY_REGISTRY[id];
      const checked = definition.inputSchema.safeParse(input);
      if (
        !checked.success ||
        (definition.kind === 'command' &&
          (!idempotencyKey || !UUID_PATTERN.test(idempotencyKey)))
      )
        throw new DataFoundationApiError('invalid-request', 422);
      const values = checked.data as Record<string, unknown>;
      let path = definition.restMapping.path;
      const body = { ...values };
      if (typeof body['batchId'] === 'string') {
        path = path.replace(':batchId', encodeURIComponent(body['batchId']));
        delete body['batchId'];
      }
      if (definition.restMapping.method === 'GET') {
        const query = new URLSearchParams(
          Object.entries(body).map(([key, value]) => [key, String(value)]),
        );
        if (query.size) path += `?${query}`;
      }
      return parsed(
        () =>
          call(path, {
            method: definition.restMapping.method as 'GET' | 'POST',
            ...(definition.kind === 'command' ? { body, idempotencyKey } : {}),
            ...(action === 'review'
              ? { expectedVersion: Number(values['expectedVersion']) }
              : {}),
          }),
        (value) => definition.outputSchema.parse(value),
      );
    },

    explorationView: (action, input, idempotencyKey) => {
      if (
        (action === 'create' || action === 'revoke') &&
        (!idempotencyKey || !UUID_PATTERN.test(idempotencyKey))
      )
        throw new DataFoundationApiError('invalid-request', 422);
      const schemas = {
        create: [
          CreateExplorationViewInputSchema,
          CreateExplorationViewOutputSchema,
        ],
        list: [
          ListExplorationViewsInputSchema,
          ListExplorationViewsOutputSchema,
        ],
        open: [OpenExplorationViewInputSchema, OpenExplorationViewOutputSchema],
        revoke: [
          OpenExplorationViewInputSchema,
          RevokeExplorationViewOutputSchema,
        ],
        export: [ExportExplorationInputSchema, ExportExplorationOutputSchema],
      } as const;
      const [inputSchema, outputSchema] = schemas[action];
      const checked = inputSchema.safeParse(input);
      if (!checked.success)
        throw new DataFoundationApiError('invalid-request', 422);
      const path =
        action === 'export'
          ? '/api/data/v1/explore/export'
          : action === 'open' || action === 'revoke'
            ? `/api/data/v1/explore/views/${OpenExplorationViewInputSchema.parse(checked.data).viewId}/${action}`
            : '/api/data/v1/explore/views';
      return parsed(
        () =>
          call(path, {
            method: action === 'list' ? 'GET' : 'POST',
            ...(action === 'list'
              ? {}
              : {
                  body:
                    action === 'open' || action === 'revoke'
                      ? {}
                      : checked.data,
                }),
            ...(idempotencyKey ? { idempotencyKey } : {}),
          }),
        (value) => outputSchema.parse(value),
      );
    },
    explore: (input) => {
      const criteria = ExplorationQueryInputSchema.safeParse(input);
      if (!criteria.success)
        throw new DataFoundationApiError('invalid-request', 422);
      return parsed(
        () =>
          call('/api/data/v1/explore/query', {
            method: 'POST',
            body: criteria.data,
          }),
        (value) => ExplorationResultSchema.parse(value),
      );
    },
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
      if (input.includeTotal !== undefined)
        search.set('includeTotal', String(input.includeTotal));
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
    search: (query, after) => {
      validateQuery(query, 2_048);
      if (after !== undefined) validateQuery(after, 8_192);
      return parsed(
        () =>
          call('/api/data/v1/search', {
            method: 'POST',
            body: {
              query,
              first: 10,
              ...(after === undefined ? {} : { after }),
            },
          }),
        parseSearchPage,
      );
    },
    knowledge: (query, after) => {
      validateQuery(query, 2_048);
      if (after !== undefined) validateQuery(after, 8_192);
      return parsed(
        () =>
          call('/api/data/v1/knowledge/search', {
            method: 'POST',
            body: {
              query,
              first: 10,
              ...(after === undefined ? {} : { after }),
            },
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
    geo: async ({ geometry, versionId }) => {
      if (versionId !== undefined) validateUuid(versionId);
      const query = {
        geometry,
        predicates: ['INTERSECTS'],
        ...(versionId === undefined ? {} : { versionId }),
        first: GEO_PAGE_SIZE,
      };
      const features: GeoQueryDto['features'][number][] = [];
      const seenCursors = new Set<string>();
      let after: string | undefined;
      for (let pageNumber = 0; pageNumber < MAX_GEO_PAGES; pageNumber += 1) {
        const page = await parsed(
          () =>
            call('/api/data/v1/geo/query', {
              method: 'POST',
              body: {
                ...query,
                ...(after === undefined ? {} : { after }),
              },
            }),
          parseGeoQuery,
        );
        if (
          page.features.length > GEO_PAGE_SIZE ||
          features.length + page.features.length > MAX_GEO_FEATURES
        ) {
          throw new DataFoundationApiError('contract', 502);
        }
        features.push(...page.features);
        const nextCursor = page.nextCursor;
        if (nextCursor === undefined) return { features };
        if (
          page.features.length === 0 ||
          features.length >= MAX_GEO_FEATURES ||
          seenCursors.has(nextCursor)
        ) {
          throw new DataFoundationApiError('contract', 502);
        }
        seenCursors.add(nextCursor);
        after = nextCursor;
      }
      throw new DataFoundationApiError('contract', 502);
    },
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
        hasControlCharacter(segment),
    )
  ) {
    return null;
  }
  const joined = path.join('/');
  if (
    /^(?:ogc\/(?:wms|wfs|wcs|wmts)|stac\/(?:conformance|search|collections\/(?:current|wiser-[a-f0-9]{32})(?:\/items(?:\/wiser-[a-f0-9]{48})?)?)|tiles\/vector\/(?:amap\/)?(?:versions|queries)\/[0-9a-f-]{36}\/\d{1,2}\/\d+\/\d+\.pbf|tiles\/raster\/versions\/[0-9a-f-]{36}\/WebMercatorQuad\/\d{1,2}\/\d+\/\d+\.(?:png|jpg|webp))$/i.test(
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
      hasControlCharacter(value)
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
  const mediaType = (contentType.split(';', 1)[0] ?? '').trim().toLowerCase();
  if (!GEO_PROXY_CONTENT_TYPES.has(mediaType)) {
    throw new DataFoundationApiError('contract', 502);
  }
  const body = await boundedBytes(response, options.config.responseLimitBytes);
  const headers = new Headers({
    'cache-control': 'private, no-cache, no-store, max-age=0, must-revalidate',
    'content-type': contentType,
  });
  const etag = response.headers.get('etag');
  if (etag !== null && etag.length <= 1_024 && !hasControlCharacter(etag)) {
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

export async function proxyDataFoundationAssetRequest(
  options: Omit<DataFoundationGeoWebProxyOptions, 'path'> & {
    readonly versionId: string;
    readonly assetId: string;
  },
): Promise<Response> {
  validateUuid(options.versionId);
  validateUuid(options.assetId);
  if (!['GET', 'HEAD'].includes(options.request.method))
    throw new DataFoundationApiError('invalid-request', 422);
  const search = new URL(options.request.url).searchParams;
  if (
    [...search.keys()].some(
      (key) => !['mode', 'filename', 'locale'].includes(key),
    ) ||
    [...search.keys()].some((key) => search.getAll(key).length !== 1) ||
    !['preview', 'download'].includes(search.get('mode') ?? 'download')
  )
    throw new DataFoundationApiError('invalid-request', 422);
  const rawName = search.get('filename') ?? options.assetId;
  if (rawName.length > 512 || hasControlCharacter(rawName))
    throw new DataFoundationApiError('invalid-request', 422);
  const filename = rawName.split(/[\\/]/).at(-1) || options.assetId;
  const accessToken = await verifiedAccessToken(
    options.createAuthClient,
    options.now ?? (() => new Date()),
  );
  const url = new URL(
    `/api/data/v1/tenants/${options.config.tenantId}/projects/${options.config.projectId}/versions/${options.versionId}/assets/${options.assetId}/content`,
    options.config.apiOrigin,
  );
  const range = options.request.headers.get('range');
  if (
    range !== null &&
    !/^bytes=(?:[0-9]{1,15}-[0-9]{0,15}|-[0-9]{1,15})$/.test(range)
  )
    throw new DataFoundationApiError('invalid-request', 422);
  let upstream: Response;
  try {
    upstream = await (options.fetch ?? globalThis.fetch)(url, {
      method: options.request.method,
      headers: {
        authorization: `Bearer ${accessToken}`,
        'x-wiser-tenant-id': options.config.tenantId,
        'x-wiser-project-id': options.config.projectId,
        'x-wiser-purpose': options.config.purpose,
        ...(range === null ? {} : { range }),
      },
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.any([
        options.request.signal,
        AbortSignal.timeout(120000),
      ]),
    });
  } catch {
    throw new DataFoundationApiError('unavailable', 503);
  }
  if (![200, 206, 416].includes(upstream.status)) {
    await upstream.body?.cancel();
    throw classifyStatus(upstream.status);
  }
  const mediaType = (
    upstream.headers.get('content-type') ?? 'application/octet-stream'
  )
    .split(';')[0]
    .trim()
    .toLowerCase();
  const preview =
    search.get('mode') === 'preview' &&
    [
      'text/html',
      'text/plain',
      'text/csv',
      'application/json',
      'application/geo+json',
      'application/pdf',
      'image/png',
      'image/jpeg',
      'image/webp',
      'image/gif',
    ].includes(mediaType);
  const type = [
    'text/html',
    'application/pdf',
    'image/png',
    'image/jpeg',
    'image/webp',
    'image/gif',
  ].includes(mediaType)
    ? mediaType
    : preview
      ? 'text/plain; charset=utf-8'
      : 'application/octet-stream';
  const headers = new Headers({
    'cache-control': 'private, no-cache, no-store, max-age=0, must-revalidate',
    'content-type': type,
    'x-content-type-options': 'nosniff',
    'content-security-policy':
      mediaType === 'application/pdf'
        ? "default-src 'none'; frame-ancestors 'self'"
        : "default-src 'none'; sandbox; style-src 'unsafe-inline'; img-src data:; frame-ancestors 'self'",
    'content-disposition': `${preview ? 'inline' : 'attachment'}; filename="source"; filename*=UTF-8''${encodeURIComponent(filename).replace(/['()*]/g, (character) => '%' + character.charCodeAt(0).toString(16).toUpperCase())}`,
  });
  for (const key of ['content-length', 'content-range', 'accept-ranges']) {
    const value = upstream.headers.get(key);
    if (value !== null && value.length < 128 && !hasControlCharacter(value))
      headers.set(key, value);
  }
  if (upstream.status === 416) headers.set('content-length', '0');
  const empty = options.request.method === 'HEAD' || upstream.status === 416;
  if (empty) await upstream.body?.cancel();
  return new Response(empty ? null : upstream.body, {
    status: upstream.status,
    headers,
  });
}
