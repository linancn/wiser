import { z } from 'zod';

export type JsonPrimitive = boolean | null | number | string;
export type JsonValue = JsonObject | JsonPrimitive | JsonValue[];
export type JsonObject = { [key: string]: JsonValue };

export interface AgentExconHttpRequest {
  readonly method: 'GET' | 'POST';
  readonly path: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly query?: Readonly<Record<string, boolean | number | string>>;
  readonly body?: JsonObject;
}

export interface AgentExconHttpClient {
  request(request: AgentExconHttpRequest): Promise<JsonValue>;
}

export interface FetchAgentExconHttpClientOptions {
  readonly baseUrl: string;
  readonly token: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly timeoutMs?: number;
}

interface AgentExconApiErrorOptions {
  readonly status: number;
  readonly payload: unknown;
  readonly retryAfter?: string;
}

export class AgentExconApiError extends Error {
  readonly status: number;
  readonly payload: unknown;
  readonly retryAfter?: string;

  constructor(options: AgentExconApiErrorOptions) {
    super(`Agent EXCON API request failed with HTTP ${options.status}.`);
    this.name = 'AgentExconApiError';
    this.status = options.status;
    this.payload = options.payload;
    if (options.retryAfter !== undefined) {
      this.retryAfter = options.retryAfter;
    }
  }
}

const JsonValueSchema = z.json();

function normalizeBaseUrl(value: string): URL {
  const url = new URL(value.endsWith('/') ? value : `${value}/`);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(
      'API 地址必须使用 HTTP(S)。 / The API URL must use HTTP(S).',
    );
  }
  if (url.username !== '' || url.password !== '') {
    throw new Error(
      'API 地址不能包含凭据。 / The API URL must not contain credentials.',
    );
  }
  return url;
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text === '') {
    return {};
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(
      `Agent EXCON API 返回了无效 JSON（HTTP ${response.status}）。 / ` +
        `The Agent EXCON API returned invalid JSON (HTTP ${response.status}).`,
    );
  }
}

export class FetchAgentExconHttpClient implements AgentExconHttpClient {
  readonly #baseUrl: URL;
  readonly #fetch: typeof globalThis.fetch;
  readonly #timeoutMs: number;
  readonly #token: string;

  constructor(options: FetchAgentExconHttpClientOptions) {
    if (options.token.trim() === '') {
      throw new Error(
        'API token 不能为空。 / The API token must not be empty.',
      );
    }
    this.#baseUrl = normalizeBaseUrl(options.baseUrl);
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#timeoutMs = options.timeoutMs ?? 30_000;
    this.#token = options.token;
  }

  async request(request: AgentExconHttpRequest): Promise<JsonValue> {
    const url = new URL(request.path.replace(/^\/+/, ''), this.#baseUrl);
    for (const [key, value] of Object.entries(request.query ?? {})) {
      url.searchParams.set(key, String(value));
    }

    const headers = new Headers({
      Accept: 'application/json',
      Authorization: `Bearer ${this.#token}`,
      ...request.headers,
    });
    if (request.body !== undefined) {
      headers.set('Content-Type', 'application/json');
    }

    const response = await this.#fetch(url, {
      method: request.method,
      headers,
      ...(request.body === undefined
        ? {}
        : { body: JSON.stringify(request.body) }),
      signal: AbortSignal.timeout(this.#timeoutMs),
    });
    const payload = await readJson(response);

    if (!response.ok) {
      const retryAfter = response.headers.get('Retry-After');
      throw new AgentExconApiError({
        status: response.status,
        payload,
        ...(retryAfter === null ? {} : { retryAfter }),
      });
    }

    const parsed = JsonValueSchema.safeParse(payload);
    if (!parsed.success) {
      throw new Error(
        'Agent EXCON API 成功响应必须是有效 JSON。 / ' +
          'A successful Agent EXCON API response must be valid JSON.',
      );
    }
    return parsed.data;
  }
}

export function createHttpClientFromEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): FetchAgentExconHttpClient {
  const token =
    environment['AGENT_EXCON_API_KEY'] ?? environment['AGENT_EXCON_API_TOKEN'];
  if (token === undefined || token.trim() === '') {
    throw new Error(
      '缺少 AGENT_EXCON_API_KEY。请配置短期参训 token 后重试。 / ' +
        'AGENT_EXCON_API_KEY is required. Configure a short-lived participant token and retry.',
    );
  }

  return new FetchAgentExconHttpClient({
    baseUrl:
      environment['AGENT_EXCON_API_URL'] ??
      environment['AGENT_EXCON_API_BASE_URL'] ??
      'http://127.0.0.1:3001/api/v1/',
    token,
  });
}
