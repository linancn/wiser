import { createHash } from 'node:crypto';
import {
  ANALYSIS_PARSER_VERSION,
  AnalysisContentError,
  bindAnalysisRecord,
  type AnalysisContentEvent,
} from '@wiser/data-infra';
import { DataJobHandlerError } from '../handlers/registry.js';

export interface ExternalAnalysisInput {
  readonly bytes: Uint8Array;
  readonly sourceHash: string;
  readonly dataItemId: string;
  readonly versionId: string;
  readonly assetId: string;
  readonly format: string;
  readonly path: string;
  readonly companions?: readonly {
    readonly path: string;
    readonly bytes: Uint8Array;
    readonly sourceHash: string;
  }[];
  readonly signal?: AbortSignal;
}
const errors = new Set<AnalysisContentError['code']>([
  'INVALID_CONTENT',
  'INVALID_GEOMETRY',
  'UNKNOWN_CRS',
  'HASH_MISMATCH',
  'RECORD_LIMIT',
  'SIZE_LIMIT',
  'COLUMN_LIMIT',
  'ARCHIVE_LIMIT',
  'UNSAFE_ARCHIVE',
  'ENCRYPTED_CONTENT',
  'INVALID_FORMAT',
  'INCONSISTENT_COLUMNS',
  'CAPACITY_LIMIT',
  'PARSING_FAILED',
]);
function invalid(): never {
  throw new AnalysisContentError('INVALID_CONTENT');
}
function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    return invalid();
  return value as Record<string, unknown>;
}
function text(value: unknown, maximum: number): string {
  if (
    typeof value !== 'string' ||
    !value.length ||
    value.length > maximum ||
    value.includes('\0')
  )
    return invalid();
  return value;
}
function unavailable(): never {
  throw new DataJobHandlerError(
    'ANALYSIS_PARSER_UNAVAILABLE',
    true,
    'Source parsing is temporarily unavailable.',
  );
}
async function* frames(
  response: Response,
): AsyncGenerator<Record<string, unknown>> {
  if (
    !response.body ||
    !response.headers.get('content-type')?.startsWith('application/x-ndjson')
  )
    return invalid();
  const reader: ReadableStreamDefaultReader<Uint8Array> =
    response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let pending = '';
  let received = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > 1024 * 1024 * 1024)
        throw new AnalysisContentError('SIZE_LIMIT');
      pending += decoder.decode(value, { stream: true });
      let end: number;
      while ((end = pending.indexOf('\n')) !== -1) {
        const line = pending.slice(0, end);
        pending = pending.slice(end + 1);
        if (Buffer.byteLength(line) > 1024 * 1024)
          throw new AnalysisContentError('SIZE_LIMIT');
        yield object(JSON.parse(line));
      }
      if (Buffer.byteLength(pending) > 1024 * 1024)
        throw new AnalysisContentError('SIZE_LIMIT');
    }
    pending += decoder.decode();
    if (pending.length) invalid();
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
export function createExternalAnalysisParser(options: {
  readonly endpoint: string;
  readonly fetch?: typeof globalThis.fetch;
}) {
  const endpoint = new URL(options.endpoint);
  if (
    !['http:', 'https:'].includes(endpoint.protocol) ||
    endpoint.username ||
    endpoint.password ||
    endpoint.pathname !== '/' ||
    endpoint.search ||
    endpoint.hash
  )
    throw new Error('Invalid source parser endpoint.');
  const request = options.fetch ?? globalThis.fetch;
  return async function* (
    input: ExternalAnalysisInput,
  ): AsyncGenerator<AnalysisContentEvent> {
    const sources = [
      { path: input.path, bytes: input.bytes, sourceHash: input.sourceHash },
      ...(input.companions ?? []),
    ];
    if (
      sources.length > 64 ||
      sources.reduce((total, file) => total + file.bytes.byteLength, 0) >
        128 * 1024 * 1024
    )
      throw new AnalysisContentError('SIZE_LIMIT');
    const files = sources.map((file) => {
      if (file.bytes.byteLength > 64 * 1024 * 1024)
        throw new AnalysisContentError('SIZE_LIMIT');
      if (
        createHash('sha256').update(file.bytes).digest('hex') !==
        file.sourceHash
      )
        throw new AnalysisContentError('HASH_MISMATCH');
      return {
        name: file.path,
        sha256: file.sourceHash,
        base64: Buffer.from(file.bytes).toString('base64'),
      };
    });
    let response: Response;
    try {
      response = await request(new URL('/parse', endpoint), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          format: input.format,
          primary: input.path,
          files,
        }),
        signal: AbortSignal.any([
          AbortSignal.timeout(950000),
          ...(input.signal ? [input.signal] : []),
        ]),
      });
    } catch {
      return unavailable();
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      if (response.status >= 500 || response.status === 429)
        return unavailable();
      return invalid();
    }
    let sourceSeen = false;
    let keys: Set<string> | null = null;
    let summary: Extract<AnalysisContentEvent, { type: 'summary' }> | null =
      null;
    let records = 0;
    let features = 0;
    try {
      for await (const event of frames(response)) {
        if (summary) invalid();
        if (event['type'] === 'error') {
          const code = event['code'] as AnalysisContentError['code'];
          throw new AnalysisContentError(
            errors.has(code) ? code : 'PARSING_FAILED',
          );
        }
        if (!sourceSeen) {
          if (
            event['type'] !== 'source' ||
            event['sha256'] !== input.sourceHash ||
            event['parserVersion'] !== ANALYSIS_PARSER_VERSION
          )
            invalid();
          sourceSeen = true;
          continue;
        }
        if (event['type'] === 'schema') {
          if (
            keys ||
            !Array.isArray(event['columns']) ||
            event['columns'].length > 256
          )
            invalid();
          const columns = (event['columns'] as unknown[]).map((value) => {
            const column = object(value);
            return {
              key: text(column['key'], 128),
              label: text(column['label'], 512),
            };
          });
          keys = new Set(columns.map((column) => column.key));
          if (keys.size !== columns.length) invalid();
          yield { type: 'schema', columns };
        } else if (event['type'] === 'record') {
          if (
            !keys ||
            event['index'] !== records + 1 ||
            Object.keys(object(event['values'])).some((key) => !keys?.has(key))
          )
            invalid();
          const record = bindAnalysisRecord(input, {
            index: event['index'],
            values: event['values'],
            geometry: event['geometry'],
            sourceId: event['sourceId'],
            sourceCrs: event['sourceCrs'],
          });
          records += 1;
          if (record.geometry !== null) features += 1;
          yield record;
        } else if (event['type'] === 'summary') {
          const status = event['status'];
          if (
            !keys ||
            event['recordCount'] !== records ||
            event['featureCount'] !== features ||
            !['READY', 'EMPTY', 'PARTIAL'].includes(String(status)) ||
            (status === 'EMPTY' && records !== 0) ||
            (status === 'READY' && records === 0)
          )
            invalid();
          const reason =
            status === 'PARTIAL' ? text(event['reason'], 128) : null;
          summary = {
            type: 'summary',
            recordCount: records,
            featureCount: features,
            status: status as 'READY' | 'EMPTY' | 'PARTIAL',
            reason,
          };
        } else invalid();
      }
      if (!summary) invalid();
      yield summary;
    } catch (error) {
      if (error instanceof AnalysisContentError) throw error;
      if (error instanceof SyntaxError || error instanceof TypeError)
        return invalid();
      return unavailable();
    }
  };
}
