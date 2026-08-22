import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  createDataFoundationDal,
  DataFoundationApiError,
  loadDataFoundationWebConfig,
  proxyDataFoundationGeoRequest,
  type DataFoundationAuthClient,
} from './data-foundation-dal.server';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const PROJECT_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '33333333-3333-4333-8333-333333333333';
const SESSION_ID = '44444444-4444-4444-8444-444444444444';

function accessToken(): string {
  const encode = (value: object) =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({
    sub: USER_ID,
    session_id: SESSION_ID,
    role: 'authenticated',
    exp: 4_102_444_800,
  })}.signature`;
}

function authClient(order: string[]): DataFoundationAuthClient {
  return {
    auth: {
      getClaims() {
        order.push('claims');
        return Promise.resolve({
          data: {
            claims: {
              sub: USER_ID,
              session_id: SESSION_ID,
              role: 'authenticated',
              exp: 4_102_444_800,
            },
          },
          error: null,
        });
      },
      getSession() {
        order.push('session');
        return Promise.resolve({
          data: { session: { access_token: accessToken() } },
          error: null,
        });
      },
    },
  };
}

afterEach(() => vi.restoreAllMocks());

describe('Data Foundation server-only HTTP DAL', () => {
  it('fails closed when the server API scope is incomplete', () => {
    expect(
      loadDataFoundationWebConfig({
        NODE_ENV: 'test',
        WISER_DATA_API_INTERNAL_URL: 'http://api:3001',
        WISER_DATA_TENANT_ID: TENANT_ID,
      }),
    ).toBeNull();
  });

  it('verifies Supabase claims before forwarding the raw access token', async () => {
    const order: string[] = [];
    const fetch = vi.fn((_url: string | URL | Request, init?: RequestInit) => {
      order.push('fetch');
      expect(init?.cache).toBe('no-store');
      expect(new Headers(init?.headers).get('authorization')).toBe(
        `Bearer ${accessToken()}`,
      );
      expect(new Headers(init?.headers).get('x-wiser-tenant-id')).toBe(
        TENANT_ID,
      );
      expect(new Headers(init?.headers).get('x-wiser-project-id')).toBe(
        PROJECT_ID,
      );
      expect(new Headers(init?.headers).get('x-wiser-purpose')).toBe(
        'data-steward-console',
      );
      return Promise.resolve(
        new Response(JSON.stringify({ items: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    });
    const dal = createDataFoundationDal({
      config: {
        apiOrigin: 'http://api:3001',
        tenantId: TENANT_ID,
        projectId: PROJECT_ID,
        purpose: 'data-steward-console',
        requestTimeoutMs: 5_000,
        responseLimitBytes: 32_768,
      },
      createAuthClient: () => Promise.resolve(authClient(order)),
      fetch,
      now: () => new Date('2026-08-22T00:00:00.000Z'),
    });

    await expect(dal.catalog({ first: 25 })).resolves.toEqual({ items: [] });
    expect(order).toEqual(['claims', 'session', 'fetch']);
  });

  it('classifies API authorization and availability failures without returning bodies', async () => {
    for (const [status, kind] of [
      [401, 'authentication'],
      [403, 'authorization'],
      [404, 'not-found'],
      [503, 'unavailable'],
    ] as const) {
      const dal = createDataFoundationDal({
        config: {
          apiOrigin: 'http://api:3001',
          tenantId: TENANT_ID,
          projectId: PROJECT_ID,
          purpose: 'data-steward-console',
          requestTimeoutMs: 5_000,
          responseLimitBytes: 32_768,
        },
        createAuthClient: () => Promise.resolve(authClient([])),
        fetch: () =>
          Promise.resolve(
            new Response('sensitive upstream details', { status }),
          ),
      });

      await expect(dal.catalog({ first: 25 })).rejects.toMatchObject({
        kind,
        status,
      });
      await expect(dal.catalog({ first: 25 })).rejects.not.toThrow(
        /sensitive upstream details/,
      );
    }
  });

  it('rejects oversized responses before parsing them', async () => {
    const dal = createDataFoundationDal({
      config: {
        apiOrigin: 'http://api:3001',
        tenantId: TENANT_ID,
        projectId: PROJECT_ID,
        purpose: 'data-steward-console',
        requestTimeoutMs: 5_000,
        responseLimitBytes: 32,
      },
      createAuthClient: () => Promise.resolve(authClient([])),
      fetch: () =>
        Promise.resolve(
          new Response(
            JSON.stringify({ items: [], padding: 'x'.repeat(100) }),
            {
              headers: { 'content-type': 'application/json' },
            },
          ),
        ),
    });

    await expect(dal.catalog({ first: 25 })).rejects.toBeInstanceOf(
      DataFoundationApiError,
    );
    await expect(dal.catalog({ first: 25 })).rejects.toMatchObject({
      kind: 'contract',
    });
  });

  it('parses an authenticated degraded health document returned with HTTP 503', async () => {
    const dal = createDataFoundationDal({
      config: {
        apiOrigin: 'http://api:3001',
        tenantId: TENANT_ID,
        projectId: PROJECT_ID,
        purpose: 'data-steward-console',
        requestTimeoutMs: 5_000,
        responseLimitBytes: 32_768,
      },
      createAuthClient: () => Promise.resolve(authClient([])),
      fetch: () =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              status: 'degraded',
              authority: { database: true, objectStore: false },
              worker: false,
              projections: 'rebuildable',
            }),
            {
              status: 503,
              headers: { 'content-type': 'application/json' },
            },
          ),
        ),
    });

    await expect(dal.health()).resolves.toEqual({
      status: 'degraded',
      database: true,
      objectStore: false,
      worker: false,
      projections: 'rebuildable',
    });
  });

  it('keeps browser tile requests same-origin while forwarding Supabase credentials only server-side', async () => {
    const fetch = vi.fn((url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe(
        'http://api:3001/api/data/v1/geo/tiles/vector/versions/' +
          '55555555-5555-4555-8555-555555555555/3/4/2.pbf',
      );
      expect(new Headers(init?.headers).get('authorization')).toBe(
        `Bearer ${accessToken()}`,
      );
      return Promise.resolve(
        new Response(Uint8Array.from([26, 0]), {
          headers: {
            'content-type': 'application/vnd.mapbox-vector-tile',
            'set-cookie': 'upstream-secret=must-not-cross',
          },
        }),
      );
    });
    const response = await proxyDataFoundationGeoRequest({
      request: new Request(
        'http://web.local/api/data-foundation/geo/tiles/vector/versions/' +
          '55555555-5555-4555-8555-555555555555/3/4/2.pbf',
      ),
      path: [
        'tiles',
        'vector',
        'versions',
        '55555555-5555-4555-8555-555555555555',
        '3',
        '4',
        '2.pbf',
      ],
      config: {
        apiOrigin: 'http://api:3001',
        tenantId: TENANT_ID,
        projectId: PROJECT_ID,
        purpose: 'data-steward-console',
        requestTimeoutMs: 5_000,
        responseLimitBytes: 32_768,
      },
      createAuthClient: () => Promise.resolve(authClient([])),
      fetch,
      now: () => new Date('2026-08-22T00:00:00.000Z'),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe(
      'application/vnd.mapbox-vector-tile',
    );
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(await response.arrayBuffer()).toEqual(
      Uint8Array.from([26, 0]).buffer,
    );
  });

  it('rejects arbitrary origins, traversal, and client-supplied raster sources before fetch', async () => {
    const fetch = vi.fn();
    const base = {
      config: {
        apiOrigin: 'http://api:3001',
        tenantId: TENANT_ID,
        projectId: PROJECT_ID,
        purpose: 'data-steward-console',
        requestTimeoutMs: 5_000,
        responseLimitBytes: 32_768,
      },
      createAuthClient: () => Promise.resolve(authClient([])),
      fetch,
      now: () => new Date('2026-08-22T00:00:00.000Z'),
    } as const;
    await expect(
      proxyDataFoundationGeoRequest({
        ...base,
        request: new Request('http://web.local/api/data-foundation/geo/x'),
        path: ['..', 'http://169.254.169.254/latest/meta-data'],
      }),
    ).rejects.toMatchObject({ kind: 'invalid-request' });
    await expect(
      proxyDataFoundationGeoRequest({
        ...base,
        request: new Request(
          'http://web.local/api/data-foundation/geo/tiles/raster/versions/' +
            `${USER_ID}/WebMercatorQuad/1/1/1.png?url=http://evil`,
        ),
        path: [
          'tiles',
          'raster',
          'versions',
          USER_ID,
          'WebMercatorQuad',
          '1',
          '1',
          '1.png',
        ],
      }),
    ).rejects.toMatchObject({ kind: 'invalid-request' });
    expect(fetch).not.toHaveBeenCalled();
  });
});
