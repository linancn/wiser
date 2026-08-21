import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';

import type {
  DataStructuredQueryPort,
  GeoQueryPort,
  GraphQueryPort,
  ScopedSpecialQueryRequest,
} from './special-query-executors.js';

export interface QueryAdapterPgResult {
  readonly rows: readonly Record<string, unknown>[];
}

export interface QueryAdapterPgClient {
  query(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryAdapterPgResult>;
  release(): void;
}

export interface QueryAdapterPgPool {
  connect(): Promise<QueryAdapterPgClient>;
}

export interface QueryAdapterHttpRequest {
  readonly method: 'POST';
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: unknown;
  readonly signal: AbortSignal;
}

export interface QueryAdapterHttpClient {
  request(request: QueryAdapterHttpRequest): Promise<{
    readonly status: number;
    readonly body?: unknown;
  }>;
}

export type QueryAdapterErrorCode =
  | 'BACKEND_UNAVAILABLE'
  | 'INVALID_BACKEND_RESULT'
  | 'INVALID_CONFIGURATION'
  | 'INVALID_CURSOR'
  | 'INVALID_QUERY'
  | 'QUERY_ABORTED'
  | 'RESPONSE_LIMIT_EXCEEDED';

const ERROR_MESSAGES: Readonly<Record<QueryAdapterErrorCode, string>> = {
  BACKEND_UNAVAILABLE: 'The query backend is unavailable.',
  INVALID_BACKEND_RESULT: 'The query backend returned an invalid result.',
  INVALID_CONFIGURATION: 'The query adapter configuration is invalid.',
  INVALID_CURSOR: 'The query cursor is invalid.',
  INVALID_QUERY: 'The bounded query is invalid.',
  QUERY_ABORTED: 'The query was aborted.',
  RESPONSE_LIMIT_EXCEEDED: 'The query response exceeded its configured limit.',
};

export class QueryAdapterError extends Error {
  constructor(readonly code: QueryAdapterErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = 'QueryAdapterError';
  }
}

const SET_SCOPE_SQL = `
select
  set_config('wiser.tenant_id', $1, true),
  set_config('wiser.project_id', $2, true),
  set_config('wiser.max_security_level', $3, true),
  set_config('wiser.policy_version', $4, true)
`;

const SELECTED_VERSION_SQL = `
select version_id
from catalog.data_item_version
where tenant_id = $1::uuid and project_id = $2::uuid
  and data_item_id = $3::uuid
  and ($4::uuid is null or version_id = $4::uuid)
  and committed_at is not null and policy_version <= $5::bigint
order by version_number desc, version_id desc
limit 1
`;

const STRUCTURED_QUERY_SQL = `
select fragment.data_item_id, fragment.version_id, fragment.evidence_fragment_id,
  fragment.locator -> 'record' as record
from knowledge.evidence_fragment as fragment
where fragment.tenant_id = $1::uuid and fragment.project_id = $2::uuid
  and fragment.version_id = $3::uuid
  and fragment.policy_version <= $4::bigint
  and jsonb_typeof(fragment.locator -> 'record') = 'object'
  and not exists (
    select 1
    from jsonb_array_elements($5::jsonb) as filter
    where not case filter ->> 'operator'
      when 'EQ' then fragment.locator -> 'record' -> (filter ->> 'field') = filter -> 'value'
      when 'NE' then fragment.locator -> 'record' -> (filter ->> 'field') <> filter -> 'value'
      when 'IN' then fragment.locator -> 'record' -> (filter ->> 'field') <@ filter -> 'value'
      when 'CONTAINS' then fragment.locator -> 'record' -> (filter ->> 'field') @> filter -> 'value'
      when 'GT' then (fragment.locator -> 'record' ->> (filter ->> 'field'))::numeric > (filter ->> 'value')::numeric
      when 'GTE' then (fragment.locator -> 'record' ->> (filter ->> 'field'))::numeric >= (filter ->> 'value')::numeric
      when 'LT' then (fragment.locator -> 'record' ->> (filter ->> 'field'))::numeric < (filter ->> 'value')::numeric
      when 'LTE' then (fragment.locator -> 'record' ->> (filter ->> 'field'))::numeric <= (filter ->> 'value')::numeric
      else false
    end
  )
  and ($6::uuid is null or fragment.evidence_fragment_id > $6::uuid)
order by fragment.evidence_fragment_id
limit $7::integer
`;

const GEO_QUERY_SQL = `
/* data.geo.query fixed PostGIS query */
with input as (
  select ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON($5), $6::integer), 4490) as geometry
), ranked_extent as (
  select extent.*, row_number() over (
    partition by extent.data_item_id order by version.version_number desc
  ) as version_rank
  from catalog.spatial_extent as extent
  join catalog.data_item_version as version
    on version.tenant_id = extent.tenant_id
   and version.project_id = extent.project_id
   and version.version_id = extent.version_id
  where extent.tenant_id = $1::uuid and extent.project_id = $2::uuid
    and version.committed_at is not null
    and extent.policy_version <= $3::bigint
    and version.policy_version <= $3::bigint
    and ($7::uuid[] is null or extent.data_item_id = any($7))
)
select extent.spatial_extent_id::text as feature_id,
  extent.data_item_id, extent.version_id,
  ST_AsGeoJSON(extent.source_geometry)::jsonb as geometry,
  extent.source_crs,
  jsonb_build_object('distanceMeters',
    ST_Distance(extent.canonical_geometry::geography, input.geometry::geography)
  ) as properties
from ranked_extent as extent cross join input
where extent.version_rank = 1
  and not exists (
    select 1 from unnest($8::text[]) as predicate
    where not case predicate
      when 'INTERSECTS' then ST_Intersects(extent.canonical_geometry, input.geometry)
      when 'WITHIN' then ST_Within(extent.canonical_geometry, input.geometry)
      when 'CONTAINS' then ST_Contains(extent.canonical_geometry, input.geometry)
      when 'NEAREST' then true
      else false
    end
  )
order by case when 'NEAREST' = any($8::text[])
  then extent.canonical_geometry <-> input.geometry else 0 end,
  extent.spatial_extent_id
limit $9::integer
`;

const GEO_INTERSECT_SQL = `
/* data.geo.intersect fixed PostGIS query */
with left_item as (
  select extent.canonical_geometry as geometry
  from catalog.spatial_extent as extent
  join catalog.data_item_version as version
    on version.tenant_id = extent.tenant_id and version.project_id = extent.project_id
   and version.version_id = extent.version_id
  where extent.tenant_id = $1::uuid and extent.project_id = $2::uuid
    and extent.data_item_id = nullif($5::jsonb ->> 'dataItemId', '')::uuid
    and ($5::jsonb ->> 'versionId' is null
      or extent.version_id = ($5::jsonb ->> 'versionId')::uuid)
    and version.committed_at is not null and version.policy_version <= $3::bigint
  order by version.version_number desc limit 1
), left_target as (
  select geometry from left_item
  union all
  select ST_Transform(ST_SetSRID(
    ST_GeomFromGeoJSON((($5::jsonb -> 'geometry') - 'crs')::text),
    substring($5::jsonb -> 'geometry' ->> 'crs' from '[0-9]+$')::integer), 4490)
  where $5::jsonb ? 'geometry'
), right_item as (
  select extent.canonical_geometry as geometry
  from catalog.spatial_extent as extent
  join catalog.data_item_version as version
    on version.tenant_id = extent.tenant_id and version.project_id = extent.project_id
   and version.version_id = extent.version_id
  where extent.tenant_id = $1::uuid and extent.project_id = $2::uuid
    and extent.data_item_id = nullif($6::jsonb ->> 'dataItemId', '')::uuid
    and ($6::jsonb ->> 'versionId' is null
      or extent.version_id = ($6::jsonb ->> 'versionId')::uuid)
    and version.committed_at is not null and version.policy_version <= $3::bigint
  order by version.version_number desc limit 1
), right_target as (
  select geometry from right_item
  union all
  select ST_Transform(ST_SetSRID(
    ST_GeomFromGeoJSON((($6::jsonb -> 'geometry') - 'crs')::text),
    substring($6::jsonb -> 'geometry' ->> 'crs' from '[0-9]+$')::integer), 4490)
  where $6::jsonb ? 'geometry'
), ranked_extent as (
  select extent.*, row_number() over (
    partition by extent.data_item_id order by version.version_number desc
  ) as version_rank
  from catalog.spatial_extent as extent
  join catalog.data_item_version as version
    on version.tenant_id = extent.tenant_id
   and version.project_id = extent.project_id
   and version.version_id = extent.version_id
  where extent.tenant_id = $1::uuid and extent.project_id = $2::uuid
    and version.committed_at is not null
    and extent.policy_version <= $3::bigint
    and version.policy_version <= $3::bigint
)
select extent.spatial_extent_id::text as feature_id,
  extent.data_item_id, extent.version_id,
  ST_AsGeoJSON(extent.source_geometry)::jsonb as geometry,
  extent.source_crs, '{}'::jsonb as properties
from ranked_extent as extent
where extent.version_rank = 1
  and exists (select 1 from left_target l, right_target r
    where ST_Intersects(l.geometry, r.geometry)
      and ST_Intersects(extent.canonical_geometry, ST_Intersection(l.geometry, r.geometry)))
order by extent.spatial_extent_id
limit $7::integer
`;

function adapterError(code: QueryAdapterErrorCode) {
  return new QueryAdapterError(code);
}

function record(value: unknown): Readonly<Record<string, unknown>> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : null;
}

function aborted(signal: AbortSignal): void {
  if (signal.aborted) throw adapterError('QUERY_ABORTED');
}

function scopeValues(request: ScopedSpecialQueryRequest): readonly unknown[] {
  return [
    request.scope.tenantId,
    request.scope.projectId,
    request.scope.maxSecurityLevel,
    String(request.scope.maximumPolicyVersion),
  ];
}

async function transaction<T>(
  pool: QueryAdapterPgPool,
  request: ScopedSpecialQueryRequest,
  work: (client: QueryAdapterPgClient) => Promise<T>,
): Promise<T> {
  aborted(request.signal);
  let client: QueryAdapterPgClient;
  try {
    client = await pool.connect();
  } catch {
    throw adapterError('BACKEND_UNAVAILABLE');
  }
  let began = false;
  try {
    await client.query('begin');
    began = true;
    await client.query(SET_SCOPE_SQL, scopeValues(request));
    aborted(request.signal);
    const output = await work(client);
    aborted(request.signal);
    await client.query('commit');
    return output;
  } catch (error) {
    if (began) {
      try {
        await client.query('rollback');
      } catch {
        // Preserve the original, redacted failure surface.
      }
    }
    if (error instanceof QueryAdapterError) throw error;
    throw adapterError('BACKEND_UNAVAILABLE');
  } finally {
    client.release();
  }
}

function boundedInteger(
  value: unknown,
  fallback: number,
  maximum: number,
): number {
  if (value === undefined) return fallback;
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < 1 ||
    (value as number) > maximum
  ) {
    throw adapterError('INVALID_QUERY');
  }
  return value as number;
}

function strings(value: unknown, maximum: number): readonly string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > maximum) {
    throw adapterError('INVALID_QUERY');
  }
  const output: string[] = [];
  for (const entry of value as readonly unknown[]) {
    if (
      typeof entry !== 'string' ||
      !/^[A-Za-z][A-Za-z0-9_.-]{0,127}$/.test(entry)
    ) {
      throw adapterError('INVALID_QUERY');
    }
    output.push(entry);
  }
  return output;
}

function boundedText(value: unknown, maximum = 256): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > maximum) {
    throw adapterError('INVALID_QUERY');
  }
  return value;
}

function uuid(value: unknown, optional = false): string | null {
  if (optional && value === undefined) return null;
  if (typeof value !== 'string' || !/^[0-9a-f-]{36}$/i.test(value)) {
    throw adapterError('INVALID_QUERY');
  }
  return value;
}

function queryFingerprint(
  request: ScopedSpecialQueryRequest,
  input: unknown,
): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        tenantId: request.scope.tenantId,
        projectId: request.scope.projectId,
        maxSecurityLevel: request.scope.maxSecurityLevel,
        maximumPolicyVersion: request.scope.maximumPolicyVersion,
        input,
      }),
    )
    .digest('hex');
}

function decodeCursor(value: unknown, fingerprint: string): string | null {
  if (value === undefined) return null;
  if (typeof value !== 'string' || value.length > 512)
    throw adapterError('INVALID_CURSOR');
  try {
    const decoded = Buffer.from(value, 'base64url').toString('utf8');
    const parsed: unknown = JSON.parse(decoded);
    const cursor = record(parsed);
    const id = cursor?.['evidenceFragmentId'];
    if (
      cursor?.['fingerprint'] !== fingerprint ||
      typeof id !== 'string' ||
      !/^[0-9a-f-]{36}$/i.test(id)
    )
      throw adapterError('INVALID_CURSOR');
    return id;
  } catch (error) {
    if (error instanceof QueryAdapterError) throw error;
    throw adapterError('INVALID_CURSOR');
  }
}

export class PostgresStructuredDataQueryPort implements DataStructuredQueryPort {
  readonly #pool: QueryAdapterPgPool;
  readonly #maximumRows: number;
  readonly #maximumResponseBytes: number;

  constructor(options: {
    readonly pool: QueryAdapterPgPool;
    readonly maximumRows?: number;
    readonly maximumResponseBytes?: number;
  }) {
    this.#pool = options.pool;
    this.#maximumRows = options.maximumRows ?? 1_000;
    this.#maximumResponseBytes = options.maximumResponseBytes ?? 2_000_000;
  }

  query(request: ScopedSpecialQueryRequest): Promise<unknown> {
    const dataItemId = uuid(request.input['dataItemId'])!;
    const versionId = uuid(request.input['versionId'], true);
    const fields = strings(request.input['fields'], 256);
    const filters = Array.isArray(request.input['filters'])
      ? request.input['filters']
      : [];
    if (
      filters.length > 128 ||
      filters.some((filter) => record(filter) === null)
    ) {
      throw adapterError('INVALID_QUERY');
    }
    const first = boundedInteger(request.input['first'], 50, this.#maximumRows);
    const fingerprint = queryFingerprint(request, {
      dataItemId,
      versionId,
      fields,
      filters,
    });
    const after = decodeCursor(request.input['after'], fingerprint);
    return transaction(this.#pool, request, async (client) => {
      const versionResult = await client.query(SELECTED_VERSION_SQL, [
        request.scope.tenantId,
        request.scope.projectId,
        dataItemId,
        versionId,
        request.scope.maximumPolicyVersion,
      ]);
      const resolvedVersion = versionResult.rows[0]?.['version_id'];
      if (typeof resolvedVersion !== 'string') {
        throw adapterError('INVALID_BACKEND_RESULT');
      }
      const result = await client.query(STRUCTURED_QUERY_SQL, [
        request.scope.tenantId,
        request.scope.projectId,
        resolvedVersion,
        request.scope.maximumPolicyVersion,
        JSON.stringify(filters),
        after,
        first + 1,
      ]);
      const selected = result.rows.slice(0, first);
      const rows = selected.map((row) => {
        const source = record(row['record']);
        if (source === null) throw adapterError('INVALID_BACKEND_RESULT');
        return Object.fromEntries(
          fields.map((field) => [field, source[field] ?? null]),
        );
      });
      const output = {
        dataItemId,
        versionId: resolvedVersion,
        columns: fields,
        rows,
        ...(result.rows.length <= first
          ? {}
          : {
              nextCursor: Buffer.from(
                JSON.stringify({
                  evidenceFragmentId: selected.at(-1)?.['evidence_fragment_id'],
                  fingerprint,
                }),
              ).toString('base64url'),
            }),
      };
      if (
        Buffer.byteLength(JSON.stringify(output)) > this.#maximumResponseBytes
      ) {
        throw adapterError('RESPONSE_LIMIT_EXCEEDED');
      }
      return output;
    });
  }
}

const SECURITY_LEVELS = [
  'L0_PUBLIC',
  'L1_INTERNAL',
  'L2_RESTRICTED',
  'L3_CONFIDENTIAL',
] as const;

function graphTemplate(depth: number, path: boolean): string {
  const start = path
    ? 'MATCH (start:WiserEntity {entityId: $fromEntityId}), (target:WiserEntity {entityId: $toEntityId})'
    : 'MATCH (start:WiserEntity {entityId: $entityId})';
  const match = path
    ? `MATCH graph = shortestPath((start)-[*1..${depth}]-(target))`
    : `MATCH graph = (start)-[*1..${depth}]-(related:WiserEntity)`;
  return `${start}
WHERE start.tenantId = $tenantId AND start.projectId = $projectId
${match}
WHERE all(node IN nodes(graph) WHERE node.tenantId = $tenantId
  AND node.projectId = $projectId
  AND node.securityLevel IN $allowedSecurityLevels
  AND node.policyVersion <= $maximumPolicyVersion)
  AND all(edge IN relationships(graph) WHERE edge.tenantId = $tenantId
    AND edge.projectId = $projectId
    AND edge.securityLevel IN $allowedSecurityLevels
    AND edge.policyVersion <= $maximumPolicyVersion
    AND (size($relationTypes) = 0 OR type(edge) IN $relationTypes))
RETURN {nodes: [node IN nodes(graph) | {
    entityId: node.entityId, label: coalesce(node.label, node.name),
    dataItemId: node.dataItemId, versionId: node.versionId,
    evidenceId: node.evidenceId, securityLevel: node.securityLevel,
    qualityGrade: node.qualityGrade, confidence: node.confidence}],
  edges: [edge IN relationships(graph) | {
    edgeId: coalesce(edge.edgeId, edge.projectionId),
    fromEntityId: startNode(edge).entityId,
    toEntityId: endNode(edge).entityId, relationType: type(edge),
    evidenceId: edge.evidenceId, confidence: edge.confidence}]} AS graph
LIMIT $limit`;
}

const EXPAND_TEMPLATES = new Map(
  Array.from({ length: 12 }, (_, index) => [
    index + 1,
    graphTemplate(index + 1, false),
  ]),
);
const PATH_TEMPLATES = new Map(
  Array.from({ length: 12 }, (_, index) => [
    index + 1,
    graphTemplate(index + 1, true),
  ]),
);

export class Neo4jGraphQueryPort implements GraphQueryPort {
  readonly #url: string;
  readonly #authorization: string;
  readonly #http: QueryAdapterHttpClient;
  readonly #maximumNodes: number;
  readonly #maximumEdges: number;

  constructor(options: {
    readonly baseUrl: string;
    readonly database: string;
    readonly authorization: string;
    readonly http: QueryAdapterHttpClient;
    readonly maximumNodes?: number;
    readonly maximumEdges?: number;
  }) {
    try {
      const url = new URL(options.baseUrl);
      if (
        !['http:', 'https:'].includes(url.protocol) ||
        url.pathname !== '/' ||
        !/^[A-Za-z][A-Za-z0-9._-]{0,62}$/.test(options.database) ||
        options.authorization.length < 8
      ) {
        throw adapterError('INVALID_CONFIGURATION');
      }
      this.#url = `${url.origin}/db/${encodeURIComponent(options.database)}/query/v2`;
    } catch (error) {
      if (error instanceof QueryAdapterError) throw error;
      throw adapterError('INVALID_CONFIGURATION');
    }
    this.#authorization = options.authorization;
    this.#http = options.http;
    this.#maximumNodes = options.maximumNodes ?? 10_000;
    this.#maximumEdges = options.maximumEdges ?? 20_000;
  }

  expand(request: ScopedSpecialQueryRequest): Promise<unknown> {
    return this.#run(request, false);
  }

  findPath(request: ScopedSpecialQueryRequest): Promise<unknown> {
    return this.#run(request, true);
  }

  async #run(
    request: ScopedSpecialQueryRequest,
    path: boolean,
  ): Promise<unknown> {
    aborted(request.signal);
    const maximumDepth = path ? 12 : 8;
    const depth = boundedInteger(request.input['maxDepth'], 1, maximumDepth);
    const statement = (path ? PATH_TEMPLATES : EXPAND_TEMPLATES).get(depth)!;
    const rank = SECURITY_LEVELS.indexOf(request.scope.maxSecurityLevel);
    const relationTypes =
      request.input['relationTypes'] === undefined
        ? []
        : strings(request.input['relationTypes'], 64);
    const parameters = {
      ...request.scope,
      allowedSecurityLevels: SECURITY_LEVELS.slice(0, rank + 1),
      relationTypes,
      limit: boundedInteger(request.input['first'], 100, this.#maximumNodes),
      ...(path
        ? {
            fromEntityId: boundedText(request.input['fromEntityId']),
            toEntityId: boundedText(request.input['toEntityId']),
          }
        : { entityId: boundedText(request.input['entityId']) }),
    };
    let response;
    try {
      response = await this.#http.request({
        method: 'POST',
        url: this.#url,
        headers: {
          Authorization: this.#authorization,
          'Content-Type': 'application/json',
        },
        body: { statement, parameters },
        signal: request.signal,
      });
    } catch {
      throw adapterError(
        request.signal.aborted ? 'QUERY_ABORTED' : 'BACKEND_UNAVAILABLE',
      );
    }
    if (response.status < 200 || response.status >= 300)
      throw adapterError('BACKEND_UNAVAILABLE');
    const body = record(response.body);
    const data = record(body?.['data']);
    const errors = body?.['errors'];
    const fields = data?.['fields'];
    if (
      data === null ||
      (Array.isArray(errors) && errors.length > 0) ||
      body?.['queryType'] !== 'r' ||
      !Array.isArray(fields) ||
      fields.length !== 1 ||
      fields[0] !== 'graph'
    ) {
      throw adapterError('INVALID_BACKEND_RESULT');
    }
    const values = data['values'];
    const graph =
      Array.isArray(values) && Array.isArray(values[0])
        ? record(values[0][0])
        : null;
    if (
      graph === null ||
      !Array.isArray(graph['nodes']) ||
      !Array.isArray(graph['edges']) ||
      graph['nodes'].length > this.#maximumNodes ||
      graph['edges'].length > this.#maximumEdges
    ) {
      throw adapterError('INVALID_BACKEND_RESULT');
    }
    return {
      nodes: graph['nodes'],
      edges: graph['edges'],
      ...(typeof graph['nextCursor'] === 'string'
        ? { nextCursor: graph['nextCursor'] }
        : {}),
    };
  }
}

function epsg(crs: unknown): number {
  const match = /^EPSG:([1-9]\d{0,5})$/.exec(
    typeof crs === 'string' ? crs : '',
  );
  if (match?.[1] === undefined) throw adapterError('INVALID_QUERY');
  return Number(match[1]);
}

function validCoordinates(value: unknown, depth = 0): boolean {
  if (!Array.isArray(value) || value.length === 0 || depth > 8) return false;
  return value.every((entry) =>
    typeof entry === 'number'
      ? Number.isFinite(entry)
      : validCoordinates(entry, depth + 1),
  );
}

function validateGeometry(value: unknown): Readonly<Record<string, unknown>> {
  const geometry = record(value);
  if (
    geometry === null ||
    ![
      'Point',
      'MultiPoint',
      'LineString',
      'MultiLineString',
      'Polygon',
      'MultiPolygon',
    ].includes(typeof geometry['type'] === 'string' ? geometry['type'] : '') ||
    !validCoordinates(geometry['coordinates'])
  ) {
    throw adapterError('INVALID_QUERY');
  }
  epsg(geometry['crs']);
  return geometry;
}

function validateGeoTarget(value: unknown): Readonly<Record<string, unknown>> {
  const target = record(value);
  if (target === null) throw adapterError('INVALID_QUERY');
  if (target['geometry'] !== undefined) {
    if (Object.keys(target).length !== 1) throw adapterError('INVALID_QUERY');
    validateGeometry(target['geometry']);
    return target;
  }
  uuid(target['dataItemId']);
  uuid(target['versionId'], true);
  if (
    Object.keys(target).some(
      (key) => key !== 'dataItemId' && key !== 'versionId',
    )
  ) {
    throw adapterError('INVALID_QUERY');
  }
  return target;
}

function geoOutput(rows: readonly Record<string, unknown>[]) {
  return {
    features: rows.map((row) => {
      const geometry = record(row['geometry']);
      if (
        geometry === null ||
        typeof row['feature_id'] !== 'string' ||
        typeof row['data_item_id'] !== 'string' ||
        typeof row['version_id'] !== 'string' ||
        typeof row['source_crs'] !== 'string'
      ) {
        throw adapterError('INVALID_BACKEND_RESULT');
      }
      return {
        featureId: row['feature_id'],
        dataItemId: row['data_item_id'],
        versionId: row['version_id'],
        geometry: { ...geometry, crs: row['source_crs'] },
        properties: record(row['properties']) ?? {},
      };
    }),
  };
}

export class PostgisGeoQueryPort implements GeoQueryPort {
  readonly #pool: QueryAdapterPgPool;
  readonly #maximumFeatures: number;
  readonly #nearestLimit: number;

  constructor(options: {
    readonly pool: QueryAdapterPgPool;
    readonly maximumFeatures?: number;
    readonly nearestLimit?: number;
  }) {
    this.#pool = options.pool;
    this.#maximumFeatures = options.maximumFeatures ?? 1_000;
    this.#nearestLimit = options.nearestLimit ?? 100;
  }

  query(request: ScopedSpecialQueryRequest): Promise<unknown> {
    const geometry = validateGeometry(request.input['geometry']);
    const predicates = strings(request.input['predicates'], 4);
    if (
      predicates.some(
        (item) =>
          !['INTERSECTS', 'WITHIN', 'CONTAINS', 'NEAREST'].includes(item),
      )
    )
      throw adapterError('INVALID_QUERY');
    const first = boundedInteger(
      request.input['first'],
      100,
      predicates.includes('NEAREST')
        ? this.#nearestLimit
        : this.#maximumFeatures,
    );
    return transaction(this.#pool, request, async (client) => {
      const result = await client.query(GEO_QUERY_SQL, [
        request.scope.tenantId,
        request.scope.projectId,
        request.scope.maximumPolicyVersion,
        request.scope.maxSecurityLevel,
        JSON.stringify({
          type: geometry['type'],
          coordinates: geometry['coordinates'],
        }),
        epsg(geometry['crs']),
        Array.isArray(request.input['dataItemIds'])
          ? request.input['dataItemIds']
          : null,
        predicates,
        first,
      ]);
      return geoOutput(result.rows);
    });
  }

  intersect(request: ScopedSpecialQueryRequest): Promise<unknown> {
    const left = validateGeoTarget(request.input['left']);
    const right = validateGeoTarget(request.input['right']);
    const first = boundedInteger(
      request.input['first'],
      100,
      this.#maximumFeatures,
    );
    return transaction(this.#pool, request, async (client) => {
      const result = await client.query(GEO_INTERSECT_SQL, [
        request.scope.tenantId,
        request.scope.projectId,
        request.scope.maximumPolicyVersion,
        request.scope.maxSecurityLevel,
        JSON.stringify(left),
        JSON.stringify(right),
        first,
      ]);
      return geoOutput(result.rows);
    });
  }
}
