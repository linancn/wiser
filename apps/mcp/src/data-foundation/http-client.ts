import { z } from 'zod';

import {
  createDataFoundationMcpModule,
  type DataFoundationHttpClient,
  type DataFoundationHttpRequest,
} from './module.js';
import type { JsonObject } from '../http-client.js';

const MAX_RESPONSE_BYTES = 1_048_576;
const MAX_SSE_EVENTS = 10_000;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class DataFoundationApiError extends Error {
  constructor(
    readonly code: 'INVALID_RESPONSE' | 'REQUEST_FAILED',
    readonly status?: number,
  ) {
    super(
      status === undefined
        ? 'Data Foundation API request failed.'
        : `Data Foundation API request failed with HTTP ${status}.`,
    );
    this.name = 'DataFoundationApiError';
  }
}

export interface FetchDataFoundationHttpClientOptions {
  readonly baseUrl: string;
  readonly token: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly timeoutMs?: number;
}

export interface DataFoundationMcpRuntime {
  readonly client: DataFoundationHttpClient;
  readonly module: ReturnType<typeof createDataFoundationMcpModule>;
}

function controlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  });
}

function baseUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value.endsWith('/') ? value : `${value}/`);
  } catch {
    throw new Error('DATA_API_URL is invalid.');
  }
  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.search.length > 0 ||
    url.hash.length > 0 ||
    !url.pathname.endsWith('/api/data/v1/')
  ) {
    throw new Error('DATA_API_URL is invalid.');
  }
  return url;
}

function requestPath(value: string): string {
  if (
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value.includes('?') ||
    value.includes('#') ||
    value.split('/').some((segment) => segment === '..')
  ) {
    throw new DataFoundationApiError('REQUEST_FAILED');
  }
  return value.replace(/^\/+/, '');
}

async function boundedText(response: Response): Promise<string> {
  const declared = response.headers.get('content-length');
  if (
    declared !== null &&
    (!/^\d+$/.test(declared) || Number(declared) > MAX_RESPONSE_BYTES)
  ) {
    throw new DataFoundationApiError('INVALID_RESPONSE', response.status);
  }
  if (response.body === null) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let result = '';
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      const value: unknown = chunk.value;
      if (!(value instanceof Uint8Array)) {
        throw new DataFoundationApiError('INVALID_RESPONSE', response.status);
      }
      bytes += value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) {
        throw new DataFoundationApiError('INVALID_RESPONSE', response.status);
      }
      result += decoder.decode(value, { stream: true });
    }
    result += decoder.decode();
    return result;
  } finally {
    reader.releaseLock();
  }
}

function jsonObject(text: string, status: number): JsonObject {
  let parsed: unknown;
  try {
    parsed = text.length === 0 ? {} : JSON.parse(text);
  } catch {
    throw new DataFoundationApiError('INVALID_RESPONSE', status);
  }
  const json = z.json().safeParse(parsed);
  if (!json.success || json.data === null || Array.isArray(json.data)) {
    throw new DataFoundationApiError('INVALID_RESPONSE', status);
  }
  return json.data as JsonObject;
}

function sseObject(
  text: string,
  status: number,
  nextCursor: string | null,
): JsonObject {
  const items: unknown[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith('data: ')) continue;
    if (items.length >= MAX_SSE_EVENTS) {
      throw new DataFoundationApiError('INVALID_RESPONSE', status);
    }
    try {
      items.push(JSON.parse(line.slice(6)) as unknown);
    } catch {
      throw new DataFoundationApiError('INVALID_RESPONSE', status);
    }
  }
  const parsed = z.array(z.json()).safeParse(items);
  if (!parsed.success) {
    throw new DataFoundationApiError('INVALID_RESPONSE', status);
  }
  return {
    items: parsed.data,
    ...(nextCursor === null ? {} : { nextCursor }),
  };
}

export class FetchDataFoundationHttpClient implements DataFoundationHttpClient {
  readonly #baseUrl: URL;
  readonly #token: string;
  readonly #fetch: typeof globalThis.fetch;
  readonly #timeoutMs: number;

  constructor(options: FetchDataFoundationHttpClientOptions) {
    if (
      options.token.length < 16 ||
      options.token.length > 8_192 ||
      controlCharacter(options.token)
    ) {
      throw new Error('DATA_API_BEARER_TOKEN is invalid.');
    }
    const timeoutMs = options.timeoutMs ?? 60_000;
    if (
      !Number.isSafeInteger(timeoutMs) ||
      timeoutMs < 100 ||
      timeoutMs > 900_000
    ) {
      throw new Error('Data Foundation API timeout is invalid.');
    }
    this.#baseUrl = baseUrl(options.baseUrl);
    this.#token = options.token;
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#timeoutMs = timeoutMs;
  }

  async request(request: DataFoundationHttpRequest): Promise<JsonObject> {
    const url = new URL(requestPath(request.path), this.#baseUrl);
    for (const [key, value] of Object.entries(request.query ?? {})) {
      url.searchParams.set(
        key,
        Array.isArray(value) ? value.join(',') : String(value),
      );
    }
    const requestHeaders = new Headers(request.headers);
    if (requestHeaders.has('authorization')) {
      throw new DataFoundationApiError('REQUEST_FAILED');
    }
    requestHeaders.set('Accept', 'application/json, text/event-stream');
    requestHeaders.set('Authorization', `Bearer ${this.#token}`);
    if (request.body !== undefined) {
      requestHeaders.set('Content-Type', 'application/json');
    }

    let response: Response;
    try {
      response = await this.#fetch(url, {
        method: request.method,
        headers: requestHeaders,
        ...(request.body === undefined
          ? {}
          : { body: JSON.stringify(request.body) }),
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
    } catch {
      throw new DataFoundationApiError('REQUEST_FAILED');
    }
    const text = await boundedText(response);
    if (!response.ok) {
      throw new DataFoundationApiError('REQUEST_FAILED', response.status);
    }
    const contentType = response.headers.get('content-type') ?? '';
    return contentType.toLowerCase().startsWith('text/event-stream')
      ? sseObject(text, response.status, response.headers.get('x-next-cursor'))
      : jsonObject(text, response.status);
  }
}

const ENVIRONMENT_KEYS = [
  'DATA_API_URL',
  'DATA_API_BEARER_TOKEN',
  'DATA_TENANT_ID',
  'DATA_PROJECT_ID',
  'DATA_PURPOSE',
] as const;

function required(
  environment: NodeJS.ProcessEnv,
  key: (typeof ENVIRONMENT_KEYS)[number],
): string {
  const value = environment[key];
  if (value === undefined || value.length === 0) {
    throw new Error(`${key} is required for the Data Foundation MCP module.`);
  }
  return value;
}

export function createDataFoundationMcpRuntimeFromEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): DataFoundationMcpRuntime | null {
  if (ENVIRONMENT_KEYS.every((key) => environment[key] === undefined)) {
    return null;
  }
  const configuredBaseUrl = required(environment, 'DATA_API_URL');
  const token = required(environment, 'DATA_API_BEARER_TOKEN');
  const tenantId = required(environment, 'DATA_TENANT_ID');
  const projectId = required(environment, 'DATA_PROJECT_ID');
  const purpose = required(environment, 'DATA_PURPOSE');
  if (!UUID_PATTERN.test(tenantId))
    throw new Error('DATA_TENANT_ID is invalid.');
  if (!UUID_PATTERN.test(projectId)) {
    throw new Error('DATA_PROJECT_ID is invalid.');
  }
  const client = new FetchDataFoundationHttpClient({
    baseUrl: configuredBaseUrl,
    token,
  });
  return Object.freeze({
    client,
    module: createDataFoundationMcpModule({
      http: client,
      tenantId,
      projectId,
      purpose,
    }),
  });
}

export type { DataFoundationHttpClient, DataFoundationHttpRequest };
