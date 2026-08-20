import type { TelemetryForwarder, TelemetrySignal } from './types.js';

export class OtlpHttpForwarder implements TelemetryForwarder {
  readonly #endpoint: URL;
  readonly #fetch: typeof globalThis.fetch;
  readonly #timeoutMs: number;

  constructor(options: {
    endpoint: string;
    fetch?: typeof globalThis.fetch;
    timeoutMs?: number;
  }) {
    this.#endpoint = new URL(
      options.endpoint.endsWith('/')
        ? options.endpoint
        : `${options.endpoint}/`,
    );
    if (!['http:', 'https:'].includes(this.#endpoint.protocol)) {
      throw new Error('OTLP Collector endpoint must use HTTP(S).');
    }
    if (this.#endpoint.username !== '' || this.#endpoint.password !== '') {
      throw new Error('OTLP Collector endpoint must not contain credentials.');
    }
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#timeoutMs = options.timeoutMs ?? 10_000;
  }

  async forward(signal: TelemetrySignal, body: unknown): Promise<void> {
    const response = await this.#fetch(
      new URL(`v1/${signal}`, this.#endpoint),
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.#timeoutMs),
      },
    );
    if (!response.ok) {
      throw new Error(
        `Collector rejected ${signal} with HTTP ${response.status}.`,
      );
    }
  }
}
