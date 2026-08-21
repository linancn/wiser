import { describe, expect, it, vi } from 'vitest';

import {
  DataFoundationApiError,
  FetchDataFoundationHttpClient,
  createDataFoundationMcpRuntimeFromEnvironment,
} from '../src/data-foundation/http-client.js';

const TOKEN = 'wdc1.local-locator.local-secret-material';

describe('Data Foundation MCP HTTP client', () => {
  it('sends credentials only as a header and encodes bounded query values', async () => {
    const fetcher = vi.fn(
      (_input: string | URL | Request, _init?: RequestInit) =>
        Promise.resolve(
          new Response('{"items":[]}', {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        ),
    );
    const client = new FetchDataFoundationHttpClient({
      baseUrl: 'http://127.0.0.1:3001/api/data/v1/',
      token: TOKEN,
      fetch: fetcher,
    });

    await client.request({
      method: 'GET',
      path: '/catalog/data-items',
      headers: {
        'X-Wiser-Tenant-Id': 'a1000000-0000-4000-8000-000000000001',
      },
      query: {
        query: '永定河',
        businessDomains: ['water-monitoring', 'ecology'],
        first: 10,
      },
    });

    const [url, init] = fetcher.mock.calls[0]!;
    const requestUrl = new URL(
      url instanceof Request ? url.url : url instanceof URL ? url.href : url,
    );
    expect(requestUrl.pathname).toBe('/api/data/v1/catalog/data-items');
    expect(requestUrl.searchParams.get('businessDomains')).toBe(
      'water-monitoring,ecology',
    );
    expect(requestUrl.href).not.toContain(TOKEN);
    const headers = new Headers(init?.headers);
    expect(headers.get('Authorization')).toBe(`Bearer ${TOKEN}`);
  });

  it('parses the bounded Operation SSE snapshot into JSON', async () => {
    const body = [
      'id: event-1',
      'event: PROGRESS_REPORTED',
      'data: {"sequence":1,"status":"RUNNING"}',
      '',
      'id: event-2',
      'event: SUCCEEDED',
      'data: {"sequence":2,"status":"SUCCEEDED"}',
      '',
    ].join('\n');
    const client = new FetchDataFoundationHttpClient({
      baseUrl: 'http://127.0.0.1:3001/api/data/v1/',
      token: TOKEN,
      fetch: () =>
        Promise.resolve(
          new Response(body, {
            status: 200,
            headers: {
              'Content-Type': 'text/event-stream; charset=utf-8',
              'X-Next-Cursor': 'cursor-2',
            },
          }),
        ),
    });

    await expect(
      client.request({
        method: 'GET',
        path: '/operations/a1000000-0000-4000-8000-000000000001/events',
        headers: {},
      }),
    ).resolves.toEqual({
      items: [
        { sequence: 1, status: 'RUNNING' },
        { sequence: 2, status: 'SUCCEEDED' },
      ],
      nextCursor: 'cursor-2',
    });
  });

  it('fails closed on partial environment configuration and creates one static module when complete', () => {
    expect(createDataFoundationMcpRuntimeFromEnvironment({})).toBeNull();
    expect(() =>
      createDataFoundationMcpRuntimeFromEnvironment({
        DATA_API_URL: 'http://api:3001/api/data/v1/',
      }),
    ).toThrow('DATA_API_BEARER_TOKEN');

    const runtime = createDataFoundationMcpRuntimeFromEnvironment({
      DATA_API_URL: 'http://api:3001/api/data/v1/',
      DATA_API_BEARER_TOKEN: TOKEN,
      DATA_TENANT_ID: 'a1000000-0000-4000-8000-000000000001',
      DATA_PROJECT_ID: 'a1000000-0000-4000-8000-000000000002',
      DATA_PURPOSE: 'analysis',
    });
    expect(runtime?.module.id).toBe('data.foundation');
  });

  it('keeps backend response bodies and credentials out of thrown messages', async () => {
    const client = new FetchDataFoundationHttpClient({
      baseUrl: 'http://127.0.0.1:3001/api/data/v1/',
      token: TOKEN,
      fetch: () =>
        Promise.resolve(
          new Response('{"error":{"details":"postgresql://admin:secret@db"}}', {
            status: 503,
          }),
        ),
    });
    const error = await client
      .request({ method: 'GET', path: '/catalog/data-items', headers: {} })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(DataFoundationApiError);
    expect(String(error)).not.toContain('postgresql');
    expect(String(error)).not.toContain('secret');
    expect(String(error)).not.toContain(TOKEN);
  });
});
