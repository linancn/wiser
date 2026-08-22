import { describe, expect, it, vi } from 'vitest';

import type { PlatformRequestContext } from '@wiser/platform-contracts';

import { buildApp } from '../src/app.js';
import {
  FixedOriginDataFoundationGeoProxyPort,
  PostgresDataFoundationGeoAuthorityPort,
} from '../src/data-foundation/geo-proxy-ports.js';
import {
  DataFoundationGeoProxyError,
  createDataFoundationGeoProxyModule,
  type DataFoundationGeoAuditRecord,
  type DataFoundationGeoProxyRequest,
} from '../src/data-foundation/geo-proxy-module.js';

const TENANT_ID = 'af000000-0000-4000-8000-000000000001';
const PROJECT_ID = 'af000000-0000-4000-8000-000000000002';
const ACTOR_ID = 'af000000-0000-4000-8000-000000000003';
const SESSION_ID = 'af000000-0000-4000-8000-000000000004';
const VERSION_ID = 'af000000-0000-4000-8000-000000000005';
const HASH = 'a'.repeat(64);

const context: PlatformRequestContext = {
  principal: {
    actorType: 'human',
    actorId: ACTOR_ID,
    authUserId: ACTOR_ID,
    sessionId: SESSION_ID,
    authenticationMethod: 'supabase_jwt',
  },
  authorization: {
    tenantId: TENANT_ID,
    projectId: PROJECT_ID,
    roles: ['data-steward'],
    scopes: ['data.geo.read'],
    purpose: 'map-review',
    maxSecurityLevel: 'L2_RESTRICTED',
    authzVersion: 7,
  },
  traceId: 'f'.repeat(32),
};

function proxyRequest(
  overrides: Partial<DataFoundationGeoProxyRequest> = {},
): DataFoundationGeoProxyRequest {
  return {
    target: 'STAC',
    path: '/conformance',
    method: 'GET',
    query: [],
    context,
    signal: new AbortController().signal,
    ...overrides,
  };
}

describe('fixed-origin GIS upstream port', () => {
  it('uses only configured service origins, injects internal credentials, and bounds the body', async () => {
    const requested: { readonly url: string; readonly init: RequestInit }[] =
      [];
    const port = new FixedOriginDataFoundationGeoProxyPort({
      origins: {
        GEOSERVER: 'http://geoserver:8080',
        STAC: 'http://stac-api:8080',
        TITILER: 'http://titiler:80',
        MARTIN: 'http://martin:3000',
      },
      stacBearerToken: 'internal-stac-token-value',
      fetch: vi.fn((url: string | URL | Request, init?: RequestInit) => {
        requested.push({ url: String(url), init: init ?? {} });
        return Promise.resolve(
          new Response('{"conformsTo":[]}', {
            status: 200,
            headers: {
              'content-type': 'application/json',
              etag: '"safe-etag"',
              'set-cookie': 'credential=must-not-forward',
            },
          }),
        );
      }) as typeof fetch,
    });

    const response = await port.request(
      proxyRequest({ query: [['limit', '10']] }),
    );

    expect(requested[0]?.url).toBe('http://stac-api:8080/conformance?limit=10');
    expect(new Headers(requested[0]?.init.headers).get('authorization')).toBe(
      'Bearer internal-stac-token-value',
    );
    expect(response).toMatchObject({
      status: 200,
      contentType: 'application/json',
      etag: '"safe-etag"',
    });
    expect(new TextDecoder().decode(response.body)).toBe('{"conformsTo":[]}');
    expect(response).not.toHaveProperty('setCookie');
  });

  it('rejects unapproved upstream paths, parameters, redirects, and oversized streams', async () => {
    const port = new FixedOriginDataFoundationGeoProxyPort({
      origins: {
        GEOSERVER: 'http://geoserver:8080',
        STAC: 'http://stac-api:8080',
        TITILER: 'http://titiler:80',
        MARTIN: 'http://martin:3000',
      },
      stacBearerToken: 'internal-stac-token-value',
      maximumResponseBytes: 1_024,
      fetch: vi.fn(() =>
        Promise.resolve(
          new Response(new Uint8Array(1_025), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        ),
      ) as typeof fetch,
    });

    await expect(
      port.request(
        proxyRequest({ target: 'GEOSERVER', path: '/geoserver/rest/about' }),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_CONFIGURATION' });
    await expect(
      port.request(proxyRequest({ target: 'STAC', path: '/_mgmt/health' })),
    ).rejects.toMatchObject({ code: 'INVALID_CONFIGURATION' });
    await expect(port.request(proxyRequest())).rejects.toMatchObject({
      code: 'RESPONSE_TOO_LARGE',
    });
  });
});

interface RecordedQuery {
  readonly text: string;
  readonly values?: readonly unknown[];
}

class FakeClient {
  readonly queries: RecordedQuery[] = [];
  released = false;

  constructor(
    readonly vectorRows: readonly Record<string, unknown>[],
    readonly rasterRows: readonly Record<string, unknown>[],
  ) {}

  query(text: string, values?: readonly unknown[]) {
    this.queries.push(values === undefined ? { text } : { text, values });
    if (/data\.geo-authority\.vector/i.test(text)) {
      return Promise.resolve({ rows: this.vectorRows });
    }
    if (/data\.geo-authority\.raster/i.test(text)) {
      return Promise.resolve({ rows: this.rasterRows });
    }
    return Promise.resolve({ rows: [] });
  }

  release() {
    this.released = true;
  }
}

describe('Postgres GIS authority and audit port', () => {
  it('keeps contextless authentication denials at 401/403 while recording only a safe structured log', async () => {
    const connect = vi.fn(() => Promise.reject(new Error('must not connect')));
    const authority = new PostgresDataFoundationGeoAuthorityPort({
      pool: { connect },
      bucket: 'wiser-authority',
    });
    const app = buildApp({
      logger: false,
      modules: [
        createDataFoundationGeoProxyModule({
          resolver: { resolve: () => Promise.resolve(null) },
          authority,
          audit: authority,
          proxy: {
            request: () => Promise.reject(new Error('must not reach upstream')),
          },
        }),
      ],
    });

    const missing = await app.inject({
      method: 'GET',
      url: '/api/data/v1/geo/stac/conformance',
    });
    const invalid = await app.inject({
      method: 'GET',
      url: '/api/data/v1/geo/stac/conformance',
      headers: {
        authorization: 'Bearer invalid',
        'x-wiser-tenant-id': TENANT_ID,
        'x-wiser-project-id': PROJECT_ID,
        'x-wiser-purpose': 'map-review',
      },
    });

    expect(missing.statusCode).toBe(401);
    expect(invalid.statusCode).toBe(403);
    expect(connect).not.toHaveBeenCalled();
    await app.close();
  });

  it('reauthorizes an immutable version through RLS before deriving a raster S3 URL', async () => {
    const storageKey =
      `tenants/${TENANT_ID}/projects/${PROJECT_ID}` +
      `/versions/${VERSION_ID}/sha256/${HASH}`;
    const client = new FakeClient(
      [{ version_id: VERSION_ID }],
      [
        {
          version_id: VERSION_ID,
          storage_key: storageKey,
          content_hash: HASH,
          media_type: 'image/tiff; application=geotiff',
        },
      ],
    );
    const port = new PostgresDataFoundationGeoAuthorityPort({
      pool: { connect: () => Promise.resolve(client) },
      bucket: 'wiser-authority',
    });

    await expect(
      port.authorizeVectorVersion({ context, versionId: VERSION_ID }),
    ).resolves.toBeUndefined();
    await expect(
      port.resolveRasterVersion({ context, versionId: VERSION_ID }),
    ).resolves.toEqual({
      sourceUrl: `s3://wiser-authority/${storageKey}`,
    });

    expect(client.queries.map(({ text }) => text.trim())).toEqual(
      expect.arrayContaining(['BEGIN', 'COMMIT']),
    );
    expect(
      client.queries.filter(({ text }) =>
        /data\.geo-authority\.scope/i.test(text),
      ),
    ).toHaveLength(2);
    expect(client.released).toBe(true);
  });

  it('rejects absent, non-COG, or storage-key-conflicting versions without returning backend details', async () => {
    const client = new FakeClient(
      [],
      [
        {
          version_id: VERSION_ID,
          storage_key: 'tenants/another/project/object',
          content_hash: HASH,
          media_type: 'application/geo+json',
        },
      ],
    );
    const port = new PostgresDataFoundationGeoAuthorityPort({
      pool: { connect: () => Promise.resolve(client) },
      bucket: 'wiser-authority',
    });

    await expect(
      port.authorizeVectorVersion({ context, versionId: VERSION_ID }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      port.resolveRasterVersion({ context, versionId: VERSION_ID }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('selects an authorized COG even when an earlier version asset is non-raster', async () => {
    const validStorageKey =
      `tenants/${TENANT_ID}/projects/${PROJECT_ID}` +
      `/versions/${VERSION_ID}/sha256/${HASH}`;
    const client = new FakeClient(
      [],
      [
        {
          version_id: VERSION_ID,
          storage_key: validStorageKey.replace(HASH, 'b'.repeat(64)),
          content_hash: 'b'.repeat(64),
          media_type: 'application/geo+json',
        },
        {
          version_id: VERSION_ID,
          storage_key: validStorageKey,
          content_hash: HASH,
          media_type: 'image/tiff; application=geotiff',
        },
      ],
    );
    const port = new PostgresDataFoundationGeoAuthorityPort({
      pool: { connect: () => Promise.resolve(client) },
      bucket: 'wiser-authority',
    });

    await expect(
      port.resolveRasterVersion({ context, versionId: VERSION_ID }),
    ).resolves.toEqual({
      sourceUrl: `s3://wiser-authority/${validStorageKey}`,
    });
    expect(
      client.queries.find(({ text }) =>
        /data\.geo-authority\.raster/i.test(text),
      )?.text,
    ).toMatch(/split_part\(asset\.media_type/i);
  });

  it('writes authenticated read and denial audit facts without raw paths or credentials', async () => {
    const client = new FakeClient([{ version_id: VERSION_ID }], []);
    const port = new PostgresDataFoundationGeoAuthorityPort({
      pool: { connect: () => Promise.resolve(client) },
      bucket: 'wiser-authority',
    });
    const record: DataFoundationGeoAuditRecord = {
      action: 'data.geo.read',
      decision: 'DENIED',
      target: 'MARTIN',
      reason: 'FORBIDDEN',
      routeHash: HASH,
      traceId: 'f'.repeat(32),
      occurredAt: '2026-08-22T08:00:00.000Z',
      context,
    };

    await expect(port.record(record)).resolves.toBeUndefined();
    const audit = client.queries.find(({ text }) =>
      /data\.geo-authority\.audit/i.test(text),
    );
    expect(audit?.values).toContain('DENIED');
    expect(JSON.stringify(audit?.values)).not.toContain('postgresql://');
    expect(JSON.stringify(audit?.values)).not.toContain('/geoserver/rest');
  });
});
