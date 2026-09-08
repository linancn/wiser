import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { parse } from 'csv-parse';

export const ANALYSIS_PARSER_VERSION = '1.0.0';
export type AnalysisValue =
  | null
  | boolean
  | number
  | string
  | AnalysisValue[]
  | { [key: string]: AnalysisValue };
export interface AnalysisColumn {
  readonly key: string;
  readonly label: string;
}
export type AnalysisContentEvent =
  | { readonly type: 'schema'; readonly columns: readonly AnalysisColumn[] }
  | {
      readonly type: 'record';
      readonly index: number;
      readonly recordId: string;
      readonly featureId: string | null;
      readonly sourceId: string | null;
      readonly values: Readonly<Record<string, AnalysisValue>>;
      readonly geometry: AnalysisValue;
      readonly sourceCrs: string | null;
    }
  | {
      readonly type: 'summary';
      readonly recordCount: number;
      readonly featureCount: number;
      readonly status: 'READY' | 'EMPTY' | 'PARTIAL';
      readonly reason?: string | null;
    };
export class AnalysisContentError extends Error {
  constructor(
    readonly code:
      | 'INVALID_CONTENT'
      | 'INVALID_GEOMETRY'
      | 'UNKNOWN_CRS'
      | 'HASH_MISMATCH'
      | 'RECORD_LIMIT'
      | 'SIZE_LIMIT'
      | 'COLUMN_LIMIT'
      | 'ARCHIVE_LIMIT'
      | 'UNSAFE_ARCHIVE'
      | 'ENCRYPTED_CONTENT'
      | 'INVALID_FORMAT'
      | 'INCONSISTENT_COLUMNS'
      | 'CAPACITY_LIMIT'
      | 'PARSING_FAILED'
      | 'MISSING_COMPANION',
  ) {
    super(code);
    this.name = 'AnalysisContentError';
  }
}
export interface AnalysisContentInput {
  readonly bytes: Uint8Array;
  readonly format: 'csv' | 'json';
  readonly dataItemId: string;
  readonly versionId: string;
  readonly assetId: string;
  readonly sourceHash: string;
  readonly maximumRecords?: number;
}
function fail(code: AnalysisContentError['code']): never {
  throw new AnalysisContentError(code);
}
function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
function jsonValue(value: unknown, depth = 0): AnalysisValue {
  if (depth > 16) fail('INVALID_CONTENT');
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.length <= 1048576) return value;
  if (Array.isArray(value))
    return (value as unknown[]).map((v) => jsonValue(v, depth + 1));
  const entries = object(value);
  if (entries)
    return Object.fromEntries(
      Object.entries(entries).map(([k, v]) => [k, jsonValue(v, depth + 1)]),
    );
  return fail('INVALID_CONTENT');
}
function columns(labels: readonly string[]): AnalysisColumn[] {
  if (
    labels.length > 256 ||
    labels.some((label) => label.length === 0 || label.length > 512) ||
    new Set(labels).size !== labels.length
  )
    fail('INVALID_CONTENT');
  return labels.map((label, index) => ({ key: `c${index + 1}`, label }));
}
type AnalysisIdentity = Pick<
  AnalysisContentInput,
  'dataItemId' | 'versionId' | 'assetId' | 'sourceHash'
>;
function recordId(input: AnalysisIdentity, index: number): string {
  const hash = createHash('sha256')
    .update(
      [
        ANALYSIS_PARSER_VERSION,
        input.dataItemId,
        input.versionId,
        input.assetId,
        input.sourceHash,
        String(index),
      ].join('\0'),
    )
    .digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-8${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}
function row(
  input: AnalysisIdentity,
  index: number,
  values: Record<string, AnalysisValue>,
  geometry: AnalysisValue = null,
  sourceId: string | null = null,
): Extract<AnalysisContentEvent, { type: 'record' }> {
  const id = recordId(input, index);
  return {
    type: 'record',
    index,
    recordId: id,
    featureId: geometry === null ? null : id,
    sourceId,
    values,
    geometry,
    sourceCrs: geometry === null ? null : 'EPSG:4326',
  };
}
/** A parser supplies content; the worker binds identifiers to admitted authority. */
export function bindAnalysisRecord(
  input: AnalysisIdentity,
  content: {
    readonly index: number;
    readonly values: unknown;
    readonly geometry: unknown;
    readonly sourceId: unknown;
    readonly sourceCrs: unknown;
  },
): Extract<AnalysisContentEvent, { type: 'record' }> {
  if (
    !Number.isSafeInteger(content.index) ||
    content.index < 1 ||
    content.index > 2000000 ||
    !object(content.values)
  )
    fail('INVALID_CONTENT');
  if (
    content.sourceId !== null &&
    (typeof content.sourceId !== 'string' || content.sourceId.length > 1024)
  )
    fail('INVALID_CONTENT');
  if (content.geometry !== null && content.sourceCrs !== 'EPSG:4326')
    fail('UNKNOWN_CRS');
  return row(
    input,
    content.index,
    jsonValue(content.values) as Record<string, AnalysisValue>,
    geometry(content.geometry),
    content.sourceId,
  );
}
function validPosition(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    value.length <= 3 &&
    value.every((v) => typeof v === 'number' && Number.isFinite(v)) &&
    Math.abs(value[0] as number) <= 180 &&
    Math.abs(value[1] as number) <= 90
  );
}
function positions(value: unknown, minimum: number): value is number[][] {
  return (
    Array.isArray(value) &&
    value.length >= minimum &&
    value.every(validPosition)
  );
}
function ring(value: unknown): boolean {
  if (!positions(value, 4)) return false;
  const first = value[0]!;
  const last = value.at(-1)!;
  return (
    first.length === last.length &&
    first.every((coordinate, index) => coordinate === last[index])
  );
}
function polygon(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0 && value.every(ring);
}
function geometry(value: unknown, depth = 0): AnalysisValue {
  if (value === null) return null;
  const geom = object(value);
  if (!geom || depth > 8) return fail('INVALID_GEOMETRY');
  const coordinates = geom['coordinates'];
  let valid = false;
  switch (geom['type']) {
    case 'Point':
      valid = validPosition(coordinates);
      break;
    case 'MultiPoint':
      valid = positions(coordinates, 1);
      break;
    case 'LineString':
      valid = positions(coordinates, 2);
      break;
    case 'MultiLineString':
      valid =
        Array.isArray(coordinates) &&
        coordinates.length > 0 &&
        coordinates.every((value) => positions(value, 2));
      break;
    case 'Polygon':
      valid = polygon(coordinates);
      break;
    case 'MultiPolygon':
      valid =
        Array.isArray(coordinates) &&
        coordinates.length > 0 &&
        coordinates.every(polygon);
      break;
    case 'GeometryCollection': {
      const children = geom['geometries'];
      if (!Array.isArray(children)) return fail('INVALID_GEOMETRY');
      return {
        type: 'GeometryCollection',
        geometries: (children as unknown[]).map((child) =>
          geometry(child, depth + 1),
        ),
      };
    }
  }
  if (!valid) return fail('INVALID_GEOMETRY');
  return { type: String(geom['type']), coordinates: jsonValue(coordinates) };
}
function sourceCrs(value: Record<string, unknown>): void {
  if (value['crs'] === undefined) return;
  const crs = object(value['crs']);
  const name = object(crs?.['properties'])?.['name'];
  if (
    ![
      'EPSG:4326',
      'urn:ogc:def:crs:OGC:1.3:CRS84',
      'urn:ogc:def:crs:EPSG::4326',
    ].includes(String(name))
  )
    fail('UNKNOWN_CRS');
}

/** Parsing never changes source values or asserts scientific quality or units. */
export async function* parseAnalysisContent(
  input: AnalysisContentInput,
): AsyncGenerator<AnalysisContentEvent> {
  if (input.bytes.byteLength > 64 * 1024 * 1024) fail('SIZE_LIMIT');
  if (
    createHash('sha256').update(input.bytes).digest('hex') !== input.sourceHash
  )
    fail('HASH_MISMATCH');
  const maximum = input.maximumRecords ?? 2000000;
  if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > 2000000)
    fail('RECORD_LIMIT');
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(input.bytes);
  } catch {
    return fail('INVALID_CONTENT');
  }
  if (/^\s*<(?:!doctype|html|\?xml|head|body)/i.test(text))
    fail('INVALID_CONTENT');
  let recordCount = 0;
  let featureCount = 0;
  if (input.format === 'csv') {
    const parser = parse({
      bom: true,
      skip_empty_lines: true,
      max_record_size: 1048576,
      relax_column_count: false,
    });
    function* chunks() {
      for (let start = 0; start < input.bytes.byteLength; start += 65536)
        yield input.bytes.subarray(start, start + 65536);
    }
    const stream = Readable.from(chunks(), { objectMode: false });
    stream.pipe(parser);
    let schema: AnalysisColumn[] | undefined;
    try {
      for await (const untrusted of parser) {
        if (
          !Array.isArray(untrusted) ||
          !untrusted.every((value) => typeof value === 'string')
        )
          fail('INVALID_CONTENT');
        const values = untrusted;
        if (schema === undefined) {
          schema = columns(values);
          yield { type: 'schema', columns: schema };
          continue;
        }
        if (++recordCount > maximum) fail('RECORD_LIMIT');
        yield row(
          input,
          recordCount,
          Object.fromEntries(
            schema.map((column, index) => [
              column.key,
              values[index] === '' ? null : values[index]!,
            ]),
          ),
        );
      }
      if (schema === undefined) yield { type: 'schema', columns: [] };
    } catch (error) {
      if (error instanceof AnalysisContentError) throw error;
      fail('INVALID_CONTENT');
    } finally {
      stream.destroy();
      parser.destroy();
    }
  } else {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return fail('INVALID_CONTENT');
    }
    const root = object(parsed);
    const isGeo =
      root?.['type'] === 'FeatureCollection' || root?.['type'] === 'Feature';
    if (isGeo && root) sourceCrs(root);
    const candidates: unknown = Array.isArray(parsed)
      ? parsed
      : root?.['type'] === 'Feature'
        ? [root]
        : (root?.['features'] ??
          root?.['records'] ??
          root?.['data'] ??
          (root ? [root] : null));
    if (!Array.isArray(candidates)) return fail('INVALID_CONTENT');
    if (candidates.length > maximum) fail('RECORD_LIMIT');
    const records = (candidates as unknown[]).map((candidate) => {
      const record = object(candidate);
      if (!record) return fail('INVALID_CONTENT');
      if (isGeo && record['type'] !== 'Feature') return fail('INVALID_CONTENT');
      const values = isGeo
        ? (object(record['properties']) ?? {})
        : (object(record['attributes']) ?? record);
      if (isGeo) sourceCrs(record);
      return {
        values,
        geometry: isGeo ? geometry(record['geometry']) : null,
        id:
          typeof record['id'] === 'string'
            ? record['id']
            : typeof record['id'] === 'number'
              ? String(record['id'])
              : null,
      };
    });
    const schema = columns([
      ...new Set(records.flatMap((record) => Object.keys(record.values))),
    ]);
    yield { type: 'schema', columns: schema };
    for (const record of records) {
      recordCount++;
      if (record.geometry !== null) featureCount++;
      yield row(
        input,
        recordCount,
        Object.fromEntries(
          schema.map((column) => [
            column.key,
            jsonValue(record.values[column.label] ?? null),
          ]),
        ),
        record.geometry,
        record.id,
      );
    }
  }
  yield {
    type: 'summary',
    recordCount,
    featureCount,
    status: recordCount === 0 ? 'EMPTY' : 'READY',
  };
}
