import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

import type { PlatformRequestContext } from '@wiser/platform-contracts';

import { buildApp } from '../src/app.js';
import {
  DataFoundationGeoProxyError,
  createDataFoundationGeoProxyModule,
  type DataFoundationGeoAuditRecord,
  type DataFoundationGeoProxyRequest,
} from '../src/data-foundation/geo-proxy-module.js';

const TENANT_ID = 'ae000000-0000-4000-8000-000000000001';
const PROJECT_ID = 'ae000000-0000-4000-8000-000000000002';
const ACTOR_ID = 'ae000000-0000-4000-8000-000000000003';
const SESSION_ID = 'ae000000-0000-4000-8000-000000000004';
const VERSION_ID = 'ae000000-0000-4000-8000-000000000005';

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
  traceId: 'a'.repeat(32),
};

const headers = {
  authorization: 'Bearer verified-supabase-token',
  'x-wiser-tenant-id': TENANT_ID,
  'x-wiser-project-id': PROJECT_ID,
  'x-wiser-purpose': 'map-review',
};

const openApps: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(openApps.splice(0).map((app) => app.close()));
});

function appWith(options: {
  readonly resolved?: PlatformRequestContext | null;
  readonly response?: {
    readonly status: number;
    readonly contentType: string;
    readonly body: Uint8Array;
  };
  readonly requestError?: DataFoundationGeoProxyError;
}) {
  const requests: DataFoundationGeoProxyRequest[] = [];
  const audits: DataFoundationGeoAuditRecord[] = [];
  const authority = {
    authorizeVectorVersion: vi.fn(() => Promise.resolve()),
    resolveRasterVersion: vi.fn(() =>
      Promise.resolve({
        sourceUrl:
          `s3://wiser-authority/tenants/${TENANT_ID}/projects/${PROJECT_ID}` +
          `/versions/${VERSION_ID}/sha256/${'a'.repeat(64)}`,
      }),
    ),
  };
  const proxy = {
    request: vi.fn((request: DataFoundationGeoProxyRequest) => {
      requests.push(request);
      if (options.requestError !== undefined) {
        return Promise.reject(options.requestError);
      }
      return Promise.resolve(
        options.response ?? {
          status: 200,
          contentType: 'application/json; charset=utf-8',
          body: new TextEncoder().encode('{"ok":true}'),
        },
      );
    }),
  };
  const audit = {
    record: vi.fn((record: DataFoundationGeoAuditRecord) => {
      audits.push(record);
      return Promise.resolve();
    }),
  };
  const app = buildApp({
    logger: false,
    modules: [
      createDataFoundationGeoProxyModule({
        resolver: {
          resolve: () => Promise.resolve(options.resolved ?? context),
        },
        authority,
        proxy,
        audit,
      }),
    ],
  });
  openApps.push(app);
  return { app, audit, audits, authority, proxy, requests };
}

describe('Data Foundation governed GIS proxy', () => {
  it('authenticates OGC reads and maps only a fixed service endpoint', async () => {
    const fixture = appWith({
      response: {
        status: 200,
        contentType: 'application/xml',
        body: new TextEncoder().encode('<WMS_Capabilities/>'),
      },
    });

    const response = await fixture.app.inject({
      method: 'GET',
      url: '/api/data/v1/geo/ogc/wms?request=GetCapabilities&version=1.3.0',
      headers,
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('application/xml');
    expect(fixture.requests).toHaveLength(1);
    expect(fixture.requests[0]).toMatchObject({
      target: 'GEOSERVER',
      path: '/geoserver/wms',
      method: 'GET',
      context,
    });
    expect(Object.fromEntries(fixture.requests[0]!.query)).toEqual({
      request: 'GetCapabilities',
      service: 'WMS',
      version: '1.3.0',
    });
    expect(fixture.audits.at(-1)).toMatchObject({
      action: 'data.geo.read',
      decision: 'ALLOWED',
      target: 'GEOSERVER',
    });
  });

  it('fails closed and audits missing credentials, scopes, methods, and SSRF-shaped queries', async () => {
    const restricted: PlatformRequestContext = {
      ...context,
      authorization: { ...context.authorization, scopes: [] },
    };
    const fixture = appWith({ resolved: restricted });

    const missing = await fixture.app.inject({
      method: 'GET',
      url: '/api/data/v1/geo/stac/conformance',
    });
    expect(missing.statusCode).toBe(401);

    const forbidden = await fixture.app.inject({
      method: 'GET',
      url: '/api/data/v1/geo/stac/conformance',
      headers,
    });
    expect(forbidden.statusCode).toBe(403);

    const method = await fixture.app.inject({
      method: 'POST',
      url: '/api/data/v1/geo/ogc/wms',
      headers,
    });
    expect(method.statusCode).toBe(405);

    const ssrf = await fixture.app.inject({
      method: 'GET',
      url:
        '/api/data/v1/geo/tiles/raster/versions/' +
        `${VERSION_ID}/WebMercatorQuad/1/1/1.png` +
        '?url=http%3A%2F%2F169.254.169.254%2Flatest%2Fmeta-data',
      headers,
    });
    expect(ssrf.statusCode).toBe(422);

    const admin = await fixture.app.inject({
      method: 'GET',
      url: '/api/data/v1/geo/stac/..%2F_mgmt%2Fhealth',
      headers,
    });
    expect(admin.statusCode).toBe(422);
    expect(fixture.proxy.request).not.toHaveBeenCalled();
    expect(fixture.audits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ decision: 'DENIED' }),
      ]),
    );
  });

  it('scopes STAC collection reads to the authenticated tenant and project', async () => {
    const fixture = appWith({});

    const response = await fixture.app.inject({
      method: 'GET',
      url: '/api/data/v1/geo/stac/collections/current/items?limit=10',
      headers,
    });

    expect(response.statusCode).toBe(200);
    const request = fixture.requests[0]!;
    expect(request.target).toBe('STAC');
    expect(request.path).toMatch(
      /^\/collections\/wiser-[a-f0-9]{32}\/items$/,
    );
    expect(Object.fromEntries(request.query)).toEqual({ limit: '10' });

    const unscoped = await fixture.app.inject({
      method: 'GET',
      url: `/api/data/v1/geo/stac/collections/wiser-${'f'.repeat(32)}/items`,
      headers,
    });
    expect(unscoped.statusCode).toBe(404);
    expect(fixture.requests).toHaveLength(1);
  });

  it('authorizes vector versions and resolves raster authority URLs server-side', async () => {
    const fixture = appWith({
      response: {
        status: 200,
        contentType: 'application/vnd.mapbox-vector-tile',
        body: Uint8Array.from([26, 0]),
      },
    });

    const vector = await fixture.app.inject({
      method: 'GET',
      url: `/api/data/v1/geo/tiles/vector/versions/${VERSION_ID}/3/4/2.pbf`,
      headers,
    });
    expect(vector.statusCode).toBe(200);
    expect(fixture.authority.authorizeVectorVersion).toHaveBeenCalledWith({
      context,
      versionId: VERSION_ID,
    });
    expect(fixture.requests[0]).toMatchObject({
      target: 'MARTIN',
      path: '/wiser_spatial_extent_mvt/3/4/2',
    });
    expect(Object.fromEntries(fixture.requests[0]!.query)).toMatchObject({
      tenantId: TENANT_ID,
      projectId: PROJECT_ID,
      versionId: VERSION_ID,
      maxSecurityLevel: 'L2_RESTRICTED',
      policyVersion: '7',
    });

    fixture.proxy.request.mockResolvedValueOnce({
      status: 200,
      contentType: 'image/png',
      body: Uint8Array.from([137, 80, 78, 71]),
    });
    const raster = await fixture.app.inject({
      method: 'GET',
      url:
        `/api/data/v1/geo/tiles/raster/versions/${VERSION_ID}` +
        '/WebMercatorQuad/3/4/2.png?resampling=nearest',
      headers,
    });
    expect(raster.statusCode).toBe(200);
    expect(fixture.authority.resolveRasterVersion).toHaveBeenCalledWith({
      context,
      versionId: VERSION_ID,
    });
    expect(fixture.requests[1]).toMatchObject({
      target: 'TITILER',
      path: '/cog/tiles/WebMercatorQuad/3/4/2.png',
    });
    expect(Object.fromEntries(fixture.requests[1]!.query)).toMatchObject({
      resampling: 'nearest',
      url: expect.stringMatching(/^s3:\/\/wiser-authority\/tenants\//),
    });
  });

  it('bounds content types, response sizes, errors, and credential disclosure', async () => {
    const oversized = appWith({
      response: {
        status: 200,
        contentType: 'application/json',
        body: new Uint8Array(8 * 1024 * 1024 + 1),
      },
    });
    const tooLarge = await oversized.app.inject({
      method: 'GET',
      url: '/api/data/v1/geo/stac/conformance',
      headers,
    });
    expect(tooLarge.statusCode).toBe(413);

    const invalidType = appWith({
      response: {
        status: 200,
        contentType: 'text/html',
        body: new TextEncoder().encode('<form>admin</form>'),
      },
    });
    const badType = await invalidType.app.inject({
      method: 'GET',
      url: '/api/data/v1/geo/stac/conformance',
      headers,
    });
    expect(badType.statusCode).toBe(502);

    const secret = 'postgresql://admin:password@data-postgres/wiser_data';
    const failed = appWith({
      requestError: new DataFoundationGeoProxyError(
        'UPSTREAM_UNAVAILABLE',
        new Error(secret),
      ),
    });
    const unavailable = await failed.app.inject({
      method: 'GET',
      url: '/api/data/v1/geo/stac/conformance',
      headers,
    });
    expect(unavailable.statusCode).toBe(503);
    expect(unavailable.body).not.toContain('postgresql');
    expect(unavailable.body).not.toContain('password');
  });
});
