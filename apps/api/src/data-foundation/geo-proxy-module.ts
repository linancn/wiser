import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';

import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  FastifySchema,
  RouteHandlerMethod,
} from 'fastify';
import { z } from 'zod';

import { deterministicStacCollectionId } from '@wiser/data-infra';
import {
  PlatformRequestContextSchema,
  type PlatformRequestContext,
} from '@wiser/platform-contracts';

import type { WiserApiModule } from '../platform/modules.js';

const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COLLECTION_PATTERN = /^wiser-[a-f0-9]{32}$/;
const ITEM_PATTERN = /^wiser-[a-f0-9]{48}$/;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const SAFE_BUCKET_PATTERN = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;
const READ_METHODS = new Set(['GET', 'HEAD']);
const FORBIDDEN_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'] as const;

export type DataFoundationGeoTarget =
  'GEOSERVER' | 'STAC' | 'TITILER' | 'MARTIN';

export type DataFoundationGeoProxyErrorCode =
  | 'INVALID_CONFIGURATION'
  | 'INVALID_RESPONSE'
  | 'NOT_FOUND'
  | 'RESPONSE_TOO_LARGE'
  | 'TIMEOUT'
  | 'UPSTREAM_UNAVAILABLE';

export class DataFoundationGeoProxyError extends Error {
  constructor(
    readonly code: DataFoundationGeoProxyErrorCode,
    cause?: unknown,
  ) {
    super(
      'Data Foundation GIS request failed safely.',
      cause === undefined ? undefined : { cause },
    );
    this.name = 'DataFoundationGeoProxyError';
  }
}

export interface DataFoundationGeoRequestContextResolver {
  resolve(input: {
    readonly token: string;
    readonly tenantId: string;
    readonly projectId: string;
    readonly purpose: string;
    readonly traceId: string;
  }): Promise<PlatformRequestContext | null>;
}

export interface DataFoundationGeoAuthorityPort {
  authorizeVectorVersion(input: {
    readonly context: PlatformRequestContext;
    readonly versionId: string;
  }): Promise<void>;
  resolveRasterVersion(input: {
    readonly context: PlatformRequestContext;
    readonly versionId: string;
  }): Promise<{ readonly sourceUrl: string }>;
}

export interface DataFoundationGeoProxyRequest {
  readonly target: DataFoundationGeoTarget;
  readonly path: string;
  readonly method: 'GET' | 'HEAD';
  readonly query: readonly (readonly [string, string])[];
  readonly context: PlatformRequestContext;
  readonly signal: AbortSignal;
}

export interface DataFoundationGeoProxyResponse {
  readonly status: number;
  readonly contentType: string;
  readonly body: Uint8Array;
  readonly etag?: string;
  readonly lastModified?: string;
}

export interface DataFoundationGeoProxyPort {
  request(
    input: DataFoundationGeoProxyRequest,
  ): Promise<DataFoundationGeoProxyResponse>;
}

export interface DataFoundationGeoAuditRecord {
  readonly action: 'data.geo.read';
  readonly decision: 'ALLOWED' | 'DENIED' | 'FAILED';
  readonly target: DataFoundationGeoTarget | 'UNRESOLVED';
  readonly routeHash: string;
  readonly traceId: string;
  readonly occurredAt: string;
  readonly reason?: string;
  readonly context?: PlatformRequestContext;
}

export interface DataFoundationGeoAuditPort {
  record(record: DataFoundationGeoAuditRecord): Promise<void>;
}

export interface DataFoundationGeoProxyModuleOptions {
  readonly resolver: DataFoundationGeoRequestContextResolver;
  readonly authority: DataFoundationGeoAuthorityPort;
  readonly proxy: DataFoundationGeoProxyPort;
  readonly audit: DataFoundationGeoAuditPort;
  readonly timeoutMs?: number;
  readonly maximumResponseBytes?: number;
  readonly now?: () => Date;
}

interface ErrorMapping {
  readonly status: number;
  readonly code: string;
  readonly message: string;
}

const errors = {
  unauthenticated: {
    status: 401,
    code: 'NOT_AUTHENTICATED',
    message:
      '需要 Bearer credential、Tenant、Project 与 Purpose。 / Bearer credential, Tenant, Project, and Purpose are required.',
  },
  unauthorized: {
    status: 403,
    code: 'NOT_AUTHORIZED',
    message:
      '当前身份无权访问该数据项目上下文。 / The current identity is not authorized for this data project context.',
  },
  forbidden: {
    status: 403,
    code: 'FORBIDDEN',
    message:
      '当前身份无权读取 GIS 数据。 / The current identity cannot read GIS data.',
  },
  method: {
    status: 405,
    code: 'METHOD_NOT_ALLOWED',
    message:
      'GIS 代理仅允许只读方法。 / The GIS proxy accepts read-only methods.',
  },
  validation: {
    status: 422,
    code: 'VALIDATION_FAILED',
    message:
      'GIS 请求未通过安全校验。 / The GIS request failed security validation.',
  },
  notFound: {
    status: 404,
    code: 'GEO_RESOURCE_NOT_FOUND',
    message: 'GIS 资源不存在。 / The GIS resource does not exist.',
  },
  tooLarge: {
    status: 413,
    code: 'GEO_RESPONSE_TOO_LARGE',
    message:
      'GIS 响应超过安全上限。 / The GIS response exceeds the safe limit.',
  },
  invalidResponse: {
    status: 502,
    code: 'GEO_UPSTREAM_INVALID',
    message:
      'GIS 上游响应无效。 / The GIS upstream returned an invalid response.',
  },
  unavailable: {
    status: 503,
    code: 'GEO_UPSTREAM_UNAVAILABLE',
    message:
      'GIS 服务暂时不可用。 / The GIS service is temporarily unavailable.',
  },
  internal: {
    status: 500,
    code: 'INTERNAL_ERROR',
    message:
      '服务暂时无法完成 GIS 请求。 / The service could not complete the GIS request.',
  },
} as const satisfies Readonly<Record<string, ErrorMapping>>;

const GeoErrorResponseSchema = {
  description: 'Stable bilingual GIS proxy error without upstream details.',
  type: 'object',
  additionalProperties: false,
  required: ['code', 'message', 'traceId'],
  properties: {
    code: { type: 'string' },
    message: { type: 'string' },
    traceId: { type: 'string', pattern: '^[a-f0-9]{32}$' },
  },
} as const;

const GeoAuthHeadersSchema = {
  type: 'object',
  required: [
    'authorization',
    'x-wiser-tenant-id',
    'x-wiser-project-id',
    'x-wiser-purpose',
  ],
  properties: {
    authorization: { type: 'string', pattern: '^Bearer [^\\s]+$' },
    'x-wiser-tenant-id': { type: 'string', format: 'uuid' },
    'x-wiser-project-id': { type: 'string', format: 'uuid' },
    'x-wiser-purpose': { type: 'string', minLength: 1, maxLength: 96 },
  },
} as const;

function geoResponses(success: Readonly<Record<string, unknown>>) {
  return {
    200: success,
    401: GeoErrorResponseSchema,
    403: GeoErrorResponseSchema,
    404: GeoErrorResponseSchema,
    413: GeoErrorResponseSchema,
    422: GeoErrorResponseSchema,
    502: GeoErrorResponseSchema,
    503: GeoErrorResponseSchema,
  } as const;
}

const OgcRouteSchema = {
  tags: ['data-foundation'],
  summary: 'Governed read-only OGC proxy',
  description:
    'Maps an authenticated WISER context to one fixed GeoServer WMS, WFS, WCS, or WMTS endpoint. GeoServer REST/admin and remote URL parameters are not reachable.',
  operationId: 'data_geo_ogc_proxy',
  security: [{ bearerAuth: [] }],
  headers: GeoAuthHeadersSchema,
  params: {
    type: 'object',
    required: ['service'],
    properties: {
      service: { type: 'string', enum: ['wms', 'wfs', 'wcs', 'wmts'] },
    },
  },
  querystring: {
    type: 'object',
    required: ['request'],
    properties: {
      request: {
        type: 'string',
        description:
          'Service-specific read operation such as GetCapabilities, GetMap, GetFeature, GetCoverage, or GetTile.',
      },
      service: { type: 'string' },
      version: { type: 'string' },
      versionId: { type: 'string', format: 'uuid' },
      bbox: { type: 'string' },
      crs: { type: 'string' },
      srs: { type: 'string' },
      width: { type: 'integer', minimum: 1, maximum: 4096 },
      height: { type: 'integer', minimum: 1, maximum: 4096 },
      format: { type: 'string' },
    },
    additionalProperties: true,
  },
  response: geoResponses({
    description:
      'Whitelisted OGC XML, GeoJSON/GML, raster image, or vector-tile response.',
    type: 'string',
  }),
} as const satisfies FastifySchema;

const StacWildcardRouteSchema = {
  tags: ['data-foundation'],
  summary: 'Governed tenant/project STAC proxy',
  description:
    'Exposes only the deterministic STAC collection for the authenticated tenant and project.',
  operationId: 'data_geo_stac_proxy',
  security: [{ bearerAuth: [] }],
  headers: GeoAuthHeadersSchema,
  params: {
    type: 'object',
    required: ['*'],
    properties: {
      '*': {
        type: 'string',
        description:
          'Whitelisted conformance, search, or current collection/item path.',
      },
    },
  },
  querystring: {
    type: 'object',
    properties: {
      limit: { type: 'integer', minimum: 1, maximum: 100 },
      bbox: { type: 'string' },
      datetime: { type: 'string' },
      ids: { type: 'string' },
      token: { type: 'string' },
    },
    additionalProperties: false,
  },
  response: geoResponses({
    description: 'Bounded STAC JSON or GeoJSON response.',
    type: 'object',
    additionalProperties: true,
  }),
} as const satisfies FastifySchema;

const StacRootRouteSchema = {
  ...StacWildcardRouteSchema,
  operationId: 'data_geo_stac_collection',
  params: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
} as const satisfies FastifySchema;

const VectorTileRouteSchema = {
  tags: ['data-foundation'],
  summary: 'Governed immutable-version vector tile',
  description:
    'Reauthorizes the immutable version through data-postgres RLS before calling the tenant-scoped Martin MVT function.',
  operationId: 'data_geo_vector_tile',
  security: [{ bearerAuth: [] }],
  headers: GeoAuthHeadersSchema,
  params: {
    type: 'object',
    required: ['versionId', 'z', 'x', 'tile'],
    properties: {
      versionId: { type: 'string', format: 'uuid' },
      z: { type: 'integer', minimum: 0, maximum: 22 },
      x: { type: 'integer', minimum: 0 },
      tile: { type: 'string', pattern: '^\\d+\\.pbf$' },
    },
  },
  response: geoResponses({
    description: 'Mapbox Vector Tile with source-layer authority.',
    type: 'string',
    contentEncoding: 'binary',
    contentMediaType: 'application/vnd.mapbox-vector-tile',
  }),
} as const satisfies FastifySchema;

const RasterTileRouteSchema = {
  tags: ['data-foundation'],
  summary: 'Governed immutable-version raster tile',
  description:
    'Resolves an authorized COG authority asset server-side and calls fixed-origin TiTiler without accepting a client URL or source.',
  operationId: 'data_geo_raster_tile',
  security: [{ bearerAuth: [] }],
  headers: GeoAuthHeadersSchema,
  params: {
    type: 'object',
    required: ['versionId', 'tms', 'z', 'x', 'tile'],
    properties: {
      versionId: { type: 'string', format: 'uuid' },
      tms: { type: 'string', enum: ['WebMercatorQuad'] },
      z: { type: 'integer', minimum: 0, maximum: 22 },
      x: { type: 'integer', minimum: 0 },
      tile: { type: 'string', pattern: '^\\d+\\.(?:png|jpg|webp)$' },
    },
  },
  querystring: {
    type: 'object',
    properties: {
      resampling: { type: 'string' },
      rescale: { type: 'string' },
      bidx: { type: 'integer', minimum: 1, maximum: 256 },
      colormap_name: { type: 'string' },
      return_mask: { type: 'boolean' },
    },
    additionalProperties: false,
  },
  response: geoResponses({
    description: 'PNG, JPEG, or WebP raster tile.',
    type: 'string',
    contentEncoding: 'binary',
    contentMediaType: 'image/png',
  }),
} as const satisfies FastifySchema;

const passThroughGeoValidatorCompiler = () => (value: unknown) => ({ value });
const passThroughGeoSerializerCompiler =
  () =>
  (value: unknown): string =>
    Buffer.isBuffer(value)
      ? (value as unknown as string)
      : JSON.stringify(value);

function registerReadOnlyRoute(
  app: FastifyInstance,
  url: string,
  schema: FastifySchema,
  handler: RouteHandlerMethod,
): void {
  app.route({
    method: 'GET',
    url,
    schema,
    validatorCompiler: passThroughGeoValidatorCompiler,
    serializerCompiler: passThroughGeoSerializerCompiler,
    handler,
  });
  app.route({
    method: [...FORBIDDEN_METHODS],
    url,
    schema: { hide: true },
    handler,
  });
}

function geoError(
  code: DataFoundationGeoProxyErrorCode,
  cause?: unknown,
): DataFoundationGeoProxyError {
  return new DataFoundationGeoProxyError(code, cause);
}

function singleHeader(value: string | readonly string[] | undefined) {
  return typeof value === 'string' ? value : undefined;
}

function bearerToken(value: string | undefined): string | null {
  return /^Bearer ([^\s]+)$/.exec(value ?? '')?.[1] ?? null;
}

function traceId(request: FastifyRequest): string {
  const candidate = request.id.replaceAll('-', '').toLowerCase();
  return /^[a-f0-9]{32}$/.test(candidate)
    ? candidate
    : createHash('sha256').update(request.id).digest('hex').slice(0, 32);
}

function setNoStore(reply: FastifyReply): void {
  reply.header(
    'Cache-Control',
    'private, no-cache, no-store, max-age=0, must-revalidate',
  );
  reply.header('Expires', '0');
  reply.header('Pragma', 'no-cache');
}

function sendError(
  request: FastifyRequest,
  reply: FastifyReply,
  mapping: ErrorMapping,
) {
  setNoStore(reply);
  if (mapping.status === 405) reply.header('Allow', 'GET, HEAD');
  return reply.status(mapping.status).send({
    code: mapping.code,
    message: mapping.message,
    traceId: traceId(request),
  });
}

function routeHash(request: FastifyRequest): string {
  const rawPath = request.raw.url?.split('?', 1)[0] ?? request.url;
  return createHash('sha256').update(rawPath).digest('hex');
}

function requestSearch(request: FastifyRequest): URLSearchParams | null {
  try {
    const raw = request.raw.url;
    if (raw === undefined || raw.length > 16_384) return null;
    return new URL(raw, 'http://wiser.invalid').searchParams;
  } catch {
    return null;
  }
}

function strictQuery(
  request: FastifyRequest,
  allowed: ReadonlySet<string>,
): readonly (readonly [string, string])[] | null {
  const search = requestSearch(request);
  if (search === null || [...search].length > 32) return null;
  const result: [string, string][] = [];
  const seen = new Set<string>();
  for (const [rawKey, value] of search) {
    const key = rawKey.toLowerCase();
    if (
      !allowed.has(key) ||
      seen.has(key) ||
      value.length > 2_048 ||
      /[\u0000-\u001f\u007f]/.test(value)
    ) {
      return null;
    }
    seen.add(key);
    result.push([key, value]);
  }
  return result;
}

function queryRecord(
  query: readonly (readonly [string, string])[],
): Readonly<Record<string, string>> {
  return Object.fromEntries(query);
}

function sortedQuery(
  query: Readonly<Record<string, string>>,
): readonly (readonly [string, string])[] {
  return Object.freeze(
    Object.entries(query)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => Object.freeze([key, value] as const)),
  );
}

async function resolveContext(
  request: FastifyRequest,
  resolver: DataFoundationGeoRequestContextResolver,
): Promise<
  | { readonly context: PlatformRequestContext }
  | { readonly error: ErrorMapping }
> {
  const token = bearerToken(singleHeader(request.headers.authorization));
  const tenantId = singleHeader(request.headers['x-wiser-tenant-id']);
  const projectId = singleHeader(request.headers['x-wiser-project-id']);
  const purpose = singleHeader(request.headers['x-wiser-purpose']);
  if (
    token === null ||
    tenantId === undefined ||
    projectId === undefined ||
    purpose === undefined
  ) {
    return { error: errors.unauthenticated };
  }
  let candidate: PlatformRequestContext | null;
  try {
    candidate = await resolver.resolve({
      token,
      tenantId,
      projectId,
      purpose,
      traceId: traceId(request),
    });
  } catch {
    return { error: errors.unavailable };
  }
  const parsed = PlatformRequestContextSchema.safeParse(candidate);
  if (
    !parsed.success ||
    parsed.data.authorization.tenantId !== tenantId ||
    parsed.data.authorization.projectId !== projectId ||
    parsed.data.authorization.purpose !== purpose
  ) {
    return { error: errors.unauthorized };
  }
  if (!parsed.data.authorization.scopes.includes('data.geo.read')) {
    return { error: errors.forbidden };
  }
  return { context: parsed.data };
}

const OGC_SERVICE = {
  wms: {
    name: 'WMS',
    requests: new Set(['getcapabilities', 'getmap', 'getfeatureinfo']),
    query: new Set([
      'request',
      'service',
      'version',
      'versionid',
      'bbox',
      'width',
      'height',
      'crs',
      'srs',
      'format',
      'transparent',
      'styles',
      'info_format',
      'i',
      'j',
    ]),
    path: '/geoserver/wms',
  },
  wfs: {
    name: 'WFS',
    requests: new Set(['getcapabilities', 'describefeaturetype', 'getfeature']),
    query: new Set([
      'request',
      'service',
      'version',
      'versionid',
      'count',
      'maxfeatures',
      'startindex',
      'outputformat',
      'srsname',
      'bbox',
      'propertyname',
    ]),
    path: '/geoserver/wfs',
  },
  wcs: {
    name: 'WCS',
    requests: new Set(['getcapabilities', 'describecoverage', 'getcoverage']),
    query: new Set([
      'request',
      'service',
      'version',
      'versionid',
      'subset',
      'format',
      'crs',
      'bbox',
      'width',
      'height',
    ]),
    path: '/geoserver/wcs',
  },
  wmts: {
    name: 'WMTS',
    requests: new Set(['getcapabilities', 'gettile', 'getfeatureinfo']),
    query: new Set([
      'request',
      'service',
      'version',
      'versionid',
      'style',
      'tilematrixset',
      'tilematrix',
      'tilerow',
      'tilecol',
      'format',
      'infoformat',
      'i',
      'j',
    ]),
    path: '/geoserver/gwc/service/wmts',
  },
} as const;

function ogcRequest(
  request: FastifyRequest,
  serviceValue: unknown,
): {
  readonly target: 'GEOSERVER';
  readonly path: string;
  readonly query: readonly (readonly [string, string])[];
  readonly versionId?: string;
} | null {
  if (typeof serviceValue !== 'string') return null;
  const definition = OGC_SERVICE[serviceValue as keyof typeof OGC_SERVICE];
  if (definition === undefined) return null;
  const query = strictQuery(request, definition.query);
  if (query === null) return null;
  const values = queryRecord(query);
  const operation = values['request']?.toLowerCase();
  if (
    operation === undefined ||
    !definition.requests.has(operation as never) ||
    (values['service'] !== undefined &&
      values['service'].toUpperCase() !== definition.name)
  ) {
    return null;
  }
  const versionId = values['versionid'];
  if (
    operation !== 'getcapabilities' &&
    (versionId === undefined || !UUID_PATTERN.test(versionId))
  ) {
    return null;
  }
  const upstream: Record<string, string> = {
    ...values,
    service: definition.name,
  };
  delete upstream['versionid'];
  if (versionId !== undefined) {
    const filter =
      `tenant_id='__WISER_TENANT__' AND project_id='__WISER_PROJECT__'` +
      ` AND version_id='${versionId}'`;
    if (serviceValue === 'wms') {
      upstream['layers'] = 'wiser:spatial_extent';
      upstream['cql_filter'] = filter;
    } else if (serviceValue === 'wfs') {
      upstream['typenames'] = 'wiser:spatial_extent';
      upstream['cql_filter'] = filter;
    } else if (serviceValue === 'wmts') {
      upstream['layer'] = 'wiser:spatial_extent';
      upstream['cql_filter'] = filter;
    } else {
      upstream['coverageid'] = `wiser:version-${versionId}`;
    }
  }
  return {
    target: 'GEOSERVER',
    path: definition.path,
    query: sortedQuery(upstream),
    ...(versionId === undefined ? {} : { versionId }),
  };
}

const STAC_QUERY = new Set(['limit', 'bbox', 'datetime', 'ids', 'token']);

function stacRequest(
  request: FastifyRequest,
  wildcard: unknown,
  context: PlatformRequestContext,
):
  | {
      readonly target: 'STAC';
      readonly path: string;
      readonly query: readonly (readonly [string, string])[];
    }
  | 'NOT_FOUND'
  | null {
  const collectionId = deterministicStacCollectionId({
    tenantId: context.authorization.tenantId,
    projectId: context.authorization.projectId,
  });
  if (typeof wildcard !== 'string') return null;
  let decoded: string;
  try {
    decoded = wildcard
      .split('/')
      .map((segment) => decodeURIComponent(segment))
      .join('/');
  } catch {
    return null;
  }
  if (
    decoded.length > 1_024 ||
    decoded.startsWith('/') ||
    decoded.endsWith('/') ||
    decoded.includes('..') ||
    decoded.includes('\\') ||
    /[\u0000-\u001f\u007f]/.test(decoded)
  ) {
    return null;
  }
  const segments = decoded === '' ? [] : decoded.split('/');
  const query = strictQuery(request, STAC_QUERY);
  if (query === null) return null;
  if (segments.length === 0) {
    return {
      target: 'STAC',
      path: `/collections/${collectionId}`,
      query: [],
    };
  }
  if (segments.length === 1 && segments[0] === 'conformance') {
    return query.length === 0
      ? { target: 'STAC', path: '/conformance', query }
      : null;
  }
  if (segments.length === 1 && segments[0] === 'search') {
    const values = { ...queryRecord(query), collections: collectionId };
    return { target: 'STAC', path: '/search', query: sortedQuery(values) };
  }
  if (segments[0] !== 'collections' || segments.length < 2) return null;
  const requestedCollection = segments[1];
  if (
    requestedCollection !== 'current' &&
    requestedCollection !== collectionId
  ) {
    return COLLECTION_PATTERN.test(requestedCollection ?? '')
      ? 'NOT_FOUND'
      : null;
  }
  if (segments.length === 2) {
    return query.length === 0
      ? { target: 'STAC', path: `/collections/${collectionId}`, query }
      : null;
  }
  if (segments[2] !== 'items') return null;
  if (segments.length === 3) {
    return {
      target: 'STAC',
      path: `/collections/${collectionId}/items`,
      query,
    };
  }
  const itemId = segments[3];
  if (
    segments.length !== 4 ||
    itemId === undefined ||
    !ITEM_PATTERN.test(itemId) ||
    query.length !== 0
  ) {
    return null;
  }
  return {
    target: 'STAC',
    path: `/collections/${collectionId}/items/${itemId}`,
    query,
  };
}

const TileParamsSchema = z.object({
  versionId: z.string().uuid(),
  z: z.coerce.number().int().min(0).max(22),
  x: z.coerce.number().int().nonnegative(),
  tile: z.string().regex(/^\d+\.(?:png|jpg|webp|pbf)$/),
});

function tileCoordinates(value: unknown) {
  const parsed = TileParamsSchema.safeParse(value);
  if (!parsed.success) return null;
  const separator = parsed.data.tile.lastIndexOf('.');
  const y = Number(parsed.data.tile.slice(0, separator));
  const format = parsed.data.tile.slice(separator + 1);
  const maximum = 2 ** parsed.data.z;
  if (
    !Number.isSafeInteger(y) ||
    y < 0 ||
    parsed.data.x >= maximum ||
    y >= maximum
  ) {
    return null;
  }
  return { ...parsed.data, y, format };
}

const RASTER_QUERY = new Set([
  'resampling',
  'rescale',
  'bidx',
  'colormap_name',
  'return_mask',
]);

function rasterQuery(request: FastifyRequest) {
  const query = strictQuery(request, RASTER_QUERY);
  if (query === null) return null;
  const values = queryRecord(query);
  if (
    (values['resampling'] !== undefined &&
      ![
        'nearest',
        'bilinear',
        'cubic',
        'cubic_spline',
        'lanczos',
        'average',
        'mode',
      ].includes(values['resampling'])) ||
    (values['bidx'] !== undefined &&
      !/^(?:[1-9]|[1-9]\d|1\d\d|2[0-4]\d|25[0-6])$/.test(values['bidx'])) ||
    (values['rescale'] !== undefined &&
      !/^-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?$/.test(values['rescale'])) ||
    (values['colormap_name'] !== undefined &&
      !/^[a-z][a-z0-9_-]{0,63}$/.test(values['colormap_name'])) ||
    (values['return_mask'] !== undefined &&
      !['true', 'false'].includes(values['return_mask']))
  ) {
    return null;
  }
  return values;
}

function safeRasterSource(
  value: string,
  context: PlatformRequestContext,
  versionId: string,
): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return (
    url.protocol === 's3:' &&
    url.username === '' &&
    url.password === '' &&
    url.search === '' &&
    url.hash === '' &&
    SAFE_BUCKET_PATTERN.test(url.hostname) &&
    url.pathname ===
      `/tenants/${context.authorization.tenantId}` +
        `/projects/${context.authorization.projectId}` +
        `/versions/${versionId}/sha256/${url.pathname.split('/').at(-1)}` &&
    HASH_PATTERN.test(url.pathname.split('/').at(-1) ?? '')
  );
}

function allowedContentType(
  target: DataFoundationGeoTarget,
  value: string,
): boolean {
  const mediaType = value.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  const allowed: Readonly<
    Record<DataFoundationGeoTarget, ReadonlySet<string>>
  > = {
    STAC: new Set(['application/json', 'application/geo+json']),
    MARTIN: new Set([
      'application/vnd.mapbox-vector-tile',
      'application/x-protobuf',
      'application/octet-stream',
    ]),
    TITILER: new Set(['image/png', 'image/jpeg', 'image/webp']),
    GEOSERVER: new Set([
      'application/xml',
      'text/xml',
      'application/json',
      'application/geo+json',
      'application/gml+xml',
      'application/vnd.ogc.gml',
      'application/vnd.mapbox-vector-tile',
      'image/png',
      'image/jpeg',
      'image/tiff',
    ]),
  };
  return allowed[target].has(mediaType);
}

function mapProxyError(error: unknown): ErrorMapping {
  if (!(error instanceof DataFoundationGeoProxyError)) {
    return errors.unavailable;
  }
  switch (error.code) {
    case 'NOT_FOUND':
      return errors.notFound;
    case 'RESPONSE_TOO_LARGE':
      return errors.tooLarge;
    case 'INVALID_RESPONSE':
      return errors.invalidResponse;
    case 'INVALID_CONFIGURATION':
      return errors.internal;
    case 'TIMEOUT':
    case 'UPSTREAM_UNAVAILABLE':
      return errors.unavailable;
  }
}

export function createDataFoundationGeoProxyModule(
  options: DataFoundationGeoProxyModuleOptions,
): WiserApiModule {
  const timeoutMs = options.timeoutMs ?? 5_000;
  const maximumResponseBytes =
    options.maximumResponseBytes ?? MAX_RESPONSE_BYTES;
  const now = options.now ?? (() => new Date());
  let recordContextlessDenial: (
    record: DataFoundationGeoAuditRecord,
  ) => void = () => undefined;
  if (
    typeof options.resolver?.resolve !== 'function' ||
    typeof options.authority?.authorizeVectorVersion !== 'function' ||
    typeof options.authority?.resolveRasterVersion !== 'function' ||
    typeof options.proxy?.request !== 'function' ||
    typeof options.audit?.record !== 'function' ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 100 ||
    timeoutMs > 30_000 ||
    !Number.isSafeInteger(maximumResponseBytes) ||
    maximumResponseBytes < 1_024 ||
    maximumResponseBytes > MAX_RESPONSE_BYTES ||
    typeof now !== 'function'
  ) {
    throw geoError('INVALID_CONFIGURATION');
  }

  async function audit(
    request: FastifyRequest,
    input: {
      readonly decision: DataFoundationGeoAuditRecord['decision'];
      readonly target: DataFoundationGeoAuditRecord['target'];
      readonly reason?: string;
      readonly context?: PlatformRequestContext;
    },
  ): Promise<boolean> {
    try {
      const occurredAt = now();
      if (!Number.isFinite(occurredAt.valueOf())) return false;
      const record: DataFoundationGeoAuditRecord = {
        action: 'data.geo.read',
        decision: input.decision,
        target: input.target,
        routeHash: routeHash(request),
        traceId: traceId(request),
        occurredAt: occurredAt.toISOString(),
        ...(input.reason === undefined ? {} : { reason: input.reason }),
        ...(input.context === undefined ? {} : { context: input.context }),
      };
      try {
        await options.audit.record(record);
      } catch (error) {
        if (record.context !== undefined) throw error;
        recordContextlessDenial(record);
      }
      return true;
    } catch {
      return false;
    }
  }

  async function deny(
    request: FastifyRequest,
    reply: FastifyReply,
    mapping: ErrorMapping,
    input: {
      readonly target?: DataFoundationGeoAuditRecord['target'];
      readonly context?: PlatformRequestContext;
    } = {},
  ) {
    const audited = await audit(request, {
      decision: 'DENIED',
      target: input.target ?? 'UNRESOLVED',
      reason: mapping.code,
      ...(input.context === undefined ? {} : { context: input.context }),
    });
    return sendError(request, reply, audited ? mapping : errors.internal);
  }

  async function execute(
    request: FastifyRequest,
    reply: FastifyReply,
    build: (
      context: PlatformRequestContext,
    ) =>
      | Promise<DataFoundationGeoProxyRequest | 'NOT_FOUND' | null>
      | DataFoundationGeoProxyRequest
      | 'NOT_FOUND'
      | null,
  ) {
    setNoStore(reply);
    if (!READ_METHODS.has(request.method)) {
      return deny(request, reply, errors.method);
    }
    const resolved = await resolveContext(request, options.resolver);
    if ('error' in resolved) {
      return deny(request, reply, resolved.error);
    }
    let proxyRequest: DataFoundationGeoProxyRequest | 'NOT_FOUND' | null;
    try {
      proxyRequest = await build(resolved.context);
    } catch (error) {
      const mapping = mapProxyError(error);
      return deny(request, reply, mapping, { context: resolved.context });
    }
    if (proxyRequest === 'NOT_FOUND') {
      return deny(request, reply, errors.notFound, {
        context: resolved.context,
      });
    }
    if (proxyRequest === null) {
      return deny(request, reply, errors.validation, {
        context: resolved.context,
      });
    }
    let response: DataFoundationGeoProxyResponse;
    try {
      response = await options.proxy.request(proxyRequest);
    } catch (error) {
      const mapping = mapProxyError(error);
      await audit(request, {
        decision: 'FAILED',
        target: proxyRequest.target,
        reason: mapping.code,
        context: resolved.context,
      });
      return sendError(request, reply, mapping);
    }
    if (response.status === 404) {
      return deny(request, reply, errors.notFound, {
        target: proxyRequest.target,
        context: resolved.context,
      });
    }
    if (response.status < 200 || response.status >= 300) {
      await audit(request, {
        decision: 'FAILED',
        target: proxyRequest.target,
        reason: 'GEO_UPSTREAM_UNAVAILABLE',
        context: resolved.context,
      });
      return sendError(request, reply, errors.unavailable);
    }
    if (response.body.byteLength > maximumResponseBytes) {
      return deny(request, reply, errors.tooLarge, {
        target: proxyRequest.target,
        context: resolved.context,
      });
    }
    if (!allowedContentType(proxyRequest.target, response.contentType)) {
      return deny(request, reply, errors.invalidResponse, {
        target: proxyRequest.target,
        context: resolved.context,
      });
    }
    if (
      !(await audit(request, {
        decision: 'ALLOWED',
        target: proxyRequest.target,
        context: resolved.context,
      }))
    ) {
      return sendError(request, reply, errors.internal);
    }
    reply.type(response.contentType);
    if (response.etag !== undefined) reply.header('ETag', response.etag);
    if (response.lastModified !== undefined) {
      reply.header('Last-Modified', response.lastModified);
    }
    return reply
      .status(response.status)
      .send(request.method === 'HEAD' ? undefined : Buffer.from(response.body));
  }

  return {
    id: 'data.foundation.geo-proxy',
    register(app) {
      recordContextlessDenial = (record) => {
        app.log.warn(
          {
            action: record.action,
            decision: record.decision,
            target: record.target,
            routeHash: record.routeHash,
            traceId: record.traceId,
            reason: record.reason,
            occurredAt: record.occurredAt,
          },
          'unauthenticated GIS proxy request denied',
        );
      };
      const ogcHandler: RouteHandlerMethod = (request, reply) =>
        execute(request, reply, async (context) => {
          const params = request.params as { readonly service?: unknown };
          const planned = ogcRequest(request, params.service);
          if (planned === null) return null;
          if (planned.versionId !== undefined) {
            await options.authority.authorizeVectorVersion({
              context,
              versionId: planned.versionId,
            });
          }
          const query = planned.query.map(
            ([key, value]) =>
              [
                key,
                value
                  .replace('__WISER_TENANT__', context.authorization.tenantId)
                  .replace(
                    '__WISER_PROJECT__',
                    context.authorization.projectId,
                  ),
              ] as const,
          );
          return {
            target: planned.target,
            path: planned.path,
            method: request.method as 'GET' | 'HEAD',
            query,
            context,
            signal: AbortSignal.timeout(timeoutMs),
          };
        });
      registerReadOnlyRoute(
        app,
        '/api/data/v1/geo/ogc/:service',
        OgcRouteSchema,
        ogcHandler,
      );

      const stacHandler = (request: FastifyRequest, reply: FastifyReply) =>
        execute(request, reply, (context) => {
          const params = request.params as { readonly '*'?: unknown };
          const planned = stacRequest(request, params['*'] ?? '', context);
          if (planned === null || planned === 'NOT_FOUND') return planned;
          return {
            target: planned.target,
            path: planned.path,
            method: request.method as 'GET' | 'HEAD',
            query: planned.query,
            context,
            signal: AbortSignal.timeout(timeoutMs),
          };
        });
      registerReadOnlyRoute(
        app,
        '/api/data/v1/geo/stac',
        StacRootRouteSchema,
        stacHandler,
      );
      registerReadOnlyRoute(
        app,
        '/api/data/v1/geo/stac/*',
        StacWildcardRouteSchema,
        stacHandler,
      );

      const vectorHandler: RouteHandlerMethod = (request, reply) =>
        execute(request, reply, async (context) => {
          const tile = tileCoordinates(request.params);
          if (tile === null || tile.format !== 'pbf') return null;
          const query = strictQuery(request, new Set());
          if (query === null || query.length !== 0) return null;
          await options.authority.authorizeVectorVersion({
            context,
            versionId: tile.versionId,
          });
          return {
            target: 'MARTIN',
            path: `/wiser_spatial_extent_mvt/${tile.z}/${tile.x}/${tile.y}`,
            method: request.method as 'GET' | 'HEAD',
            query: sortedQuery({
              tenantId: context.authorization.tenantId,
              projectId: context.authorization.projectId,
              versionId: tile.versionId,
              maxSecurityLevel: context.authorization.maxSecurityLevel,
              policyVersion: String(context.authorization.authzVersion),
            }),
            context,
            signal: AbortSignal.timeout(timeoutMs),
          };
        });
      registerReadOnlyRoute(
        app,
        '/api/data/v1/geo/tiles/vector/versions/:versionId/:z/:x/:tile',
        VectorTileRouteSchema,
        vectorHandler,
      );

      const rasterHandler: RouteHandlerMethod = (request, reply) =>
        execute(request, reply, async (context) => {
          const params = request.params as { readonly tms?: unknown };
          const tile = tileCoordinates(request.params);
          const query = rasterQuery(request);
          if (
            tile === null ||
            !['png', 'jpg', 'webp'].includes(tile.format) ||
            params.tms !== 'WebMercatorQuad' ||
            query === null
          ) {
            return null;
          }
          const source = await options.authority.resolveRasterVersion({
            context,
            versionId: tile.versionId,
          });
          if (!safeRasterSource(source.sourceUrl, context, tile.versionId)) {
            throw geoError('INVALID_RESPONSE');
          }
          return {
            target: 'TITILER',
            path:
              `/cog/tiles/WebMercatorQuad/${tile.z}/${tile.x}/${tile.y}` +
              `.${tile.format}`,
            method: request.method as 'GET' | 'HEAD',
            query: sortedQuery({ ...query, url: source.sourceUrl }),
            context,
            signal: AbortSignal.timeout(timeoutMs),
          };
        });
      registerReadOnlyRoute(
        app,
        '/api/data/v1/geo/tiles/raster/versions/:versionId/:tms/:z/:x/:tile',
        RasterTileRouteSchema,
        rasterHandler,
      );
    },
  };
}
