import type {
  EmbeddingModelIdentity,
  EmbeddingPort,
  EmbeddingRequestOptions,
} from './types.js';

export const QWEN_QUERY_INSTRUCTION =
  'Given a web search query, retrieve relevant passages that answer the query';
export interface OpenAiCompatibleEmbeddingOptions {
  readonly baseUrl: string;
  readonly model: string;
  readonly version: string;
  readonly dimensions: number;
  readonly queryInstruction?: string;
  readonly apiKey?: string;
  readonly timeoutMs?: number;
  readonly fetch?: typeof globalThis.fetch;
}

function invalidConfig(): Error {
  return new Error('Embedding configuration is invalid.');
}
function invalidResponse(): Error {
  return new Error('Embedding response is invalid.');
}
function text(value: unknown, maximum: number): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    value.length <= maximum &&
    ![...value].some((character) => {
      const code = character.charCodeAt(0);
      return code === 127 || (code < 32 && ![9, 10, 13].includes(code));
    })
  );
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// Uses only the configured server. Credentials and input never enter error messages.
export class OpenAiCompatibleEmbedding implements EmbeddingPort {
  readonly model: EmbeddingModelIdentity;
  readonly #url: URL;
  readonly #fetch: typeof globalThis.fetch;
  readonly #headers: Readonly<Record<string, string>>;
  readonly #timeoutMs: number;

  constructor(options: OpenAiCompatibleEmbeddingOptions) {
    let base: URL;
    try {
      base = new URL(options.baseUrl);
    } catch {
      throw invalidConfig();
    }
    if (
      !['http:', 'https:'].includes(base.protocol) ||
      base.username ||
      base.password ||
      base.search ||
      base.hash ||
      !/^\/v1\/?$/.test(base.pathname)
    )
      throw invalidConfig();
    if (
      !text(options.model, 128) ||
      !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(options.model) ||
      options.version.length > 64 ||
      !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(options.version) ||
      !Number.isSafeInteger(options.dimensions) ||
      options.dimensions < 8 ||
      options.dimensions > 4096
    )
      throw invalidConfig();
    const instruction = options.queryInstruction ?? QWEN_QUERY_INSTRUCTION;
    if (!text(instruction, 1024)) throw invalidConfig();
    if (
      options.apiKey !== undefined &&
      (!text(options.apiKey, 2048) || /[\r\n]/.test(options.apiKey))
    )
      throw invalidConfig();
    this.#timeoutMs = options.timeoutMs ?? 15_000;
    if (
      !Number.isSafeInteger(this.#timeoutMs) ||
      this.#timeoutMs < 100 ||
      this.#timeoutMs > 120_000 ||
      (options.fetch !== undefined && typeof options.fetch !== 'function')
    )
      throw invalidConfig();
    this.#url = new URL(`${base.origin}/v1/embeddings`);
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#headers = Object.freeze({
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(options.apiKey === undefined
        ? {}
        : { Authorization: `Bearer ${options.apiKey}` }),
    });
    this.model = Object.freeze({
      provider: 'openai-compatible',
      model: options.model,
      version: options.version,
      dimensions: options.dimensions,
      queryInstruction: instruction,
    });
  }

  async embed(
    value: string,
    options?: EmbeddingRequestOptions,
  ): Promise<readonly number[]> {
    if (!text(value, 32768)) throw new Error('Embedding input is invalid.');
    const query =
      options?.purpose === 'query'
        ? `Instruct: ${this.model.queryInstruction}\nQuery: ${value}`
        : value;
    return (await this.#request([query]))[0]!;
  }

  async embedMany(
    values: readonly string[],
  ): Promise<readonly (readonly number[])[]> {
    if (
      !Array.isArray(values) ||
      values.length < 1 ||
      values.length > 16 ||
      !values.every((value) => text(value, 32768))
    )
      throw new Error('Embedding input is invalid.');
    return this.#request(values);
  }

  async #request(
    values: readonly string[],
  ): Promise<readonly (readonly number[])[]> {
    let response: Response;
    try {
      response = await this.#fetch(this.#url, {
        method: 'POST',
        headers: this.#headers,
        redirect: 'error',
        signal: AbortSignal.timeout(this.#timeoutMs),
        body: JSON.stringify({
          model: this.model.model,
          input: values,
          encoding_format: 'float',
        }),
      });
    } catch {
      throw new Error('Embedding service is unavailable.');
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error('Embedding service is unavailable.');
    }
    let body: unknown;
    try {
      const reader = response.body?.getReader();
      if (reader === undefined) throw invalidResponse();
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        const chunk: unknown = part.value;
        if (!(chunk instanceof Uint8Array)) throw invalidResponse();
        size += chunk.byteLength;
        if (size > 4 * 1024 * 1024) {
          await reader.cancel();
          throw invalidResponse();
        }
        chunks.push(chunk);
      }
      body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      throw invalidResponse();
    }
    if (
      !record(body) ||
      body['model'] !== this.model.model ||
      !Array.isArray(body['data']) ||
      body['data'].length !== values.length
    )
      throw invalidResponse();
    const vectors = new Map<number, readonly number[]>();
    for (const entry of body['data'] as unknown[]) {
      if (
        !record(entry) ||
        typeof entry['index'] !== 'number' ||
        !Number.isSafeInteger(entry['index']) ||
        entry['index'] < 0 ||
        entry['index'] >= values.length ||
        vectors.has(entry['index'])
      )
        throw invalidResponse();
      const vector: unknown = entry['embedding'];
      if (
        !Array.isArray(vector) ||
        vector.length !== this.model.dimensions ||
        !vector.every(
          (value: unknown) =>
            typeof value === 'number' && Number.isFinite(value),
        )
      )
        throw invalidResponse();
      const norm = Math.hypot(...(vector as number[]));
      if (!Number.isFinite(norm) || norm === 0) throw invalidResponse();
      vectors.set(
        entry['index'],
        Object.freeze((vector as number[]).map((value) => value / norm)),
      );
    }
    return Object.freeze(values.map((_, index) => vectors.get(index)!));
  }
}
