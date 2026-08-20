import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createHttpClientFromEnvironment,
  resolveAgentExconProtocolVersion,
} from '../src/http-client.js';

afterEach(() => {
  vi.restoreAllMocks();
});

function requestUrl(
  input: Parameters<typeof globalThis.fetch>[0] | undefined,
): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  if (input instanceof Request) return input.url;
  throw new Error('Expected a recorded fetch request URL.');
}

describe('Agent EXCON MCP environment configuration', () => {
  it('uses /api/v2 as the default API base path', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const client = createHttpClientFromEnvironment({
      AGENT_EXCON_API_KEY: 'participant-token',
    });

    await client.request({ method: 'GET', path: '/runs/run-id/me' });

    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(requestUrl(fetchSpy.mock.calls[0]?.[0])).toBe(
      'http://127.0.0.1:3001/api/v2/runs/run-id/me',
    );
  });

  it('uses /api/v1 only when compatibility mode is explicit', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const environment = {
      AGENT_EXCON_API_KEY: 'participant-token',
      AGENT_EXCON_PROTOCOL_VERSION: 'v1',
    };
    const client = createHttpClientFromEnvironment(environment);

    expect(resolveAgentExconProtocolVersion(environment)).toBe('v1');
    await client.request({ method: 'GET', path: '/episodes/episode-id' });

    expect(requestUrl(fetchSpy.mock.calls[0]?.[0])).toBe(
      'http://127.0.0.1:3001/api/v1/episodes/episode-id',
    );
  });

  it('rejects unknown protocol modes instead of silently downgrading', () => {
    expect(() =>
      resolveAgentExconProtocolVersion({
        AGENT_EXCON_PROTOCOL_VERSION: 'legacy',
      }),
    ).toThrow(/v1.*v2|v2.*v1/);
  });

  it('rejects an API URL whose version conflicts with the selected mode', () => {
    expect(() =>
      createHttpClientFromEnvironment({
        AGENT_EXCON_API_KEY: 'participant-token',
        AGENT_EXCON_API_URL: 'http://127.0.0.1:3001/api/v1/',
      }),
    ).toThrow(/URL.*v1.*v2|v1.*v2.*URL/);
  });
});
