import { describe, expect, it, vi } from 'vitest';

import { BoundedProjectionHttpClient } from '../src/runtime/http-client.js';

describe('bounded internal projection HTTP client', () => {
  it('allows only configured origins and parses a bounded JSON response', async () => {
    const fetch = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ accepted: true }), {
          status: 201,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    const client = new BoundedProjectionHttpClient({
      allowedOrigins: ['http://weaviate:8080'],
      timeoutMs: 1_000,
      maximumResponseBytes: 1_024,
      fetch,
    });
    await expect(
      client.request({
        method: 'PUT',
        url: 'http://weaviate:8080/v1/objects/fixed-id',
        headers: { Authorization: 'Bearer internal-secret' },
        body: { fixture: true },
      }),
    ).resolves.toEqual({ status: 201, body: { accepted: true } });
    expect(fetch).toHaveBeenCalledOnce();

    await expect(
      client.request({
        method: 'GET',
        url: 'http://attacker.invalid/exfiltrate',
        headers: {},
      }),
    ).rejects.toThrow('failed safely');
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('cancels oversized responses and never exposes backend secrets', async () => {
    let cancelled = false;
    const client = new BoundedProjectionHttpClient({
      allowedOrigins: ['https://opensearch:9200'],
      timeoutMs: 1_000,
      maximumResponseBytes: 16,
      fetch: () =>
        Promise.resolve(
          new Response(
            new ReadableStream<Uint8Array>({
              pull(controller) {
                controller.enqueue(new Uint8Array(32));
              },
              cancel() {
                cancelled = true;
              },
            }),
            { status: 500 },
          ),
        ),
    });
    const error = await client
      .request({
        method: 'GET',
        url: 'https://opensearch:9200/_cluster/health',
        headers: { Authorization: 'Basic password=must-not-leak' },
      })
      .catch((failure: unknown) => failure);
    expect(String(error)).toContain('failed safely');
    expect(String(error)).not.toContain('password');
    expect(cancelled).toBe(true);
  });
});
