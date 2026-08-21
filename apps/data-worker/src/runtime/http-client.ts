import type {
  GraphStacHttpClient,
  GraphStacHttpRequest,
  GraphStacHttpResponse,
  ProjectionHttpClient,
  ProjectionHttpRequest,
  ProjectionHttpResponse,
} from '@wiser/data-infra';

export class BoundedProjectionHttpClient
  implements ProjectionHttpClient, GraphStacHttpClient
{
  readonly #origins: ReadonlySet<string>;
  readonly #timeoutMs: number;
  readonly #maximumResponseBytes: number;
  readonly #fetch: typeof globalThis.fetch;

  constructor(options: {
    readonly allowedOrigins: readonly string[];
    readonly timeoutMs: number;
    readonly maximumResponseBytes: number;
    readonly fetch?: typeof globalThis.fetch;
  }) {
    const origins = new Set<string>();
    for (const value of options.allowedOrigins) {
      try {
        const url = new URL(value);
        if (
          !['http:', 'https:'].includes(url.protocol) ||
          url.username ||
          url.password ||
          url.pathname !== '/' ||
          url.search ||
          url.hash
        ) {
          throw new Error('invalid');
        }
        origins.add(url.origin);
      } catch {
        throw new Error('Projection HTTP configuration is invalid.');
      }
    }
    if (
      origins.size < 1 ||
      !Number.isSafeInteger(options.timeoutMs) ||
      options.timeoutMs < 100 ||
      !Number.isSafeInteger(options.maximumResponseBytes) ||
      options.maximumResponseBytes < 16 ||
      (options.fetch !== undefined && typeof options.fetch !== 'function')
    ) {
      throw new Error('Projection HTTP configuration is invalid.');
    }
    this.#origins = origins;
    this.#timeoutMs = options.timeoutMs;
    this.#maximumResponseBytes = options.maximumResponseBytes;
    this.#fetch = options.fetch ?? globalThis.fetch;
  }

  async request(
    request: ProjectionHttpRequest | GraphStacHttpRequest,
  ): Promise<ProjectionHttpResponse | GraphStacHttpResponse> {
    let url: URL;
    try {
      url = new URL(request.url);
    } catch {
      throw new Error('Projection HTTP request failed safely.');
    }
    if (
      !this.#origins.has(url.origin) ||
      url.username ||
      url.password ||
      !['GET', 'POST', 'PUT'].includes(request.method)
    ) {
      throw new Error('Projection HTTP request failed safely.');
    }
    try {
      const response = await this.#fetch(url, {
        method: request.method,
        headers: request.headers,
        ...(request.body === undefined
          ? {}
          : { body: JSON.stringify(request.body) }),
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
      const reader = response.body?.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      if (reader !== undefined) {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          const chunk: unknown = part.value;
          if (!(chunk instanceof Uint8Array)) throw new Error('response type');
          size += chunk.length;
          if (size > this.#maximumResponseBytes) {
            await reader.cancel().catch(() => undefined);
            throw new Error('response limit');
          }
          chunks.push(chunk);
        }
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      const text = new TextDecoder().decode(bytes);
      let body: unknown;
      if (text.length > 0) {
        const contentType = response.headers.get('content-type') ?? '';
        body = contentType.includes('json') ? JSON.parse(text) : text;
      }
      return {
        status: response.status,
        ...(body === undefined ? {} : { body }),
      };
    } catch {
      throw new Error('Projection HTTP request failed safely.');
    }
  }
}
