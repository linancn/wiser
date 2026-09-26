import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

import type { PlatformRequestContext } from '@wiser/platform-contracts';

import { buildApp } from '../src/app.js';
import { PostgresDataAssetDownloadPort } from '../src/data-foundation/postgres-asset-download.js';
import { createDataFoundationRestModule } from '../src/data-foundation/rest-module.js';

const TENANT_ID = 'ca000000-0000-4000-8000-000000000001';
const PROJECT_ID = 'ca000000-0000-4000-8000-000000000002';
const ACTOR_ID = 'ca000000-0000-4000-8000-000000000003';
const SESSION_ID = 'ca000000-0000-4000-8000-000000000004';
const VERSION_ID = 'ca000000-0000-4000-8000-000000000005';
const ASSET_ID = 'ca000000-0000-4000-8000-000000000006';
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
    scopes: ['data.catalog.read'],
    purpose: 'operate',
    maxSecurityLevel: 'L3_CONFIDENTIAL',
    authzVersion: 7,
  },
  traceId: 'c'.repeat(32),
};

const apps: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('governed version asset download', () => {
  function downloadApp(requestContext: PlatformRequestContext = context) {
    const assetContentFetch = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) =>
      Promise.resolve(
        new Response('source bytes', {
          headers: { 'content-type': 'text/plain', 'content-length': '12' },
        }),
      ),
    );
    const assetDownload = {
      createDownload: vi.fn(() =>
        Promise.resolve({
          url: 'http://127.0.0.1:18333/selected-asset',
          expiresAt: '2026-09-08T05:00:00.000Z',
        }),
      ),
    };
    const app = buildApp({
      logger: false,
      modules: [
        createDataFoundationRestModule({
          resolver: { resolve: () => Promise.resolve(requestContext) },
          handler: { execute: () => Promise.resolve({}) },
          assetDownload,
          assetContentFetch,
        }),
      ],
    });
    apps.push(app);
    return { app, assetDownload, assetContentFetch };
  }

  it('streams exact authorized source bytes without disclosing a signed storage URL', async () => {
    const { app, assetDownload, assetContentFetch } = downloadApp();
    const response = await app.inject({
      method: 'GET',
      url: `/api/data/v1/tenants/${TENANT_ID}/projects/${PROJECT_ID}/versions/${VERSION_ID}/assets/${ASSET_ID}/content`,
      headers: {
        authorization: 'Bearer verified-token',
        'x-wiser-tenant-id': TENANT_ID,
        'x-wiser-project-id': PROJECT_ID,
        'x-wiser-purpose': 'operate',
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe('source bytes');
    expect(response.headers.location).toBeUndefined();
    expect(response.headers['cache-control']).toContain('no-store');
    expect(assetDownload.createDownload).toHaveBeenCalledWith({
      context,
      versionId: VERSION_ID,
      assetId: ASSET_ID,
      internal: true,
    });
    expect(assetContentFetch).toHaveBeenCalledOnce();
  });

  it('answers HEAD from a bounded GET probe when storage signed only GET', async () => {
    const { app, assetContentFetch } = downloadApp();
    assetContentFetch.mockImplementationOnce((_input, init) => {
      if (
        init?.method !== 'GET' ||
        new Headers(init.headers).get('range') !== 'bytes=0-0'
      )
        return Promise.resolve(new Response('signature mismatch', { status: 403 }));
      return Promise.resolve(
        new Response('s', {
          status: 206,
          headers: {
            'content-type': 'text/plain',
            'content-length': '1',
            'content-range': 'bytes 0-0/12',
            'accept-ranges': 'bytes',
          },
        }),
      );
    });
    const response = await app.inject({
      method: 'HEAD',
      url: `/api/data/v1/tenants/${TENANT_ID}/projects/${PROJECT_ID}/versions/${VERSION_ID}/assets/${ASSET_ID}/content`,
      headers: {
        authorization: 'Bearer verified-token',
        'x-wiser-tenant-id': TENANT_ID,
        'x-wiser-project-id': PROJECT_ID,
        'x-wiser-purpose': 'operate',
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe('');
    expect(response.headers['content-type']).toBe('text/plain');
    expect(response.headers['content-length']).toBe('12');
    expect(response.headers['content-range']).toBeUndefined();
    expect(response.headers.location).toBeUndefined();
    expect(assetContentFetch).toHaveBeenCalledOnce();
  });

  it('preserves an explicit partial HEAD range through the signed GET method', async () => {
    const { app, assetContentFetch } = downloadApp();
    assetContentFetch.mockImplementationOnce((_input, init) => {
      if (
        init?.method !== 'GET' ||
        new Headers(init.headers).get('range') !== 'bytes=5-6'
      )
        return Promise.resolve(new Response('signature mismatch', { status: 403 }));
      return Promise.resolve(
        new Response('ce', {
          status: 206,
          headers: {
            'content-type': 'text/plain',
            'content-length': '2',
            'content-range': 'bytes 5-6/12',
          },
        }),
      );
    });
    const response = await app.inject({
      method: 'HEAD',
      url: `/api/data/v1/tenants/${TENANT_ID}/projects/${PROJECT_ID}/versions/${VERSION_ID}/assets/${ASSET_ID}/content`,
      headers: {
        authorization: 'Bearer verified-token',
        'x-wiser-tenant-id': TENANT_ID,
        'x-wiser-project-id': PROJECT_ID,
        'x-wiser-purpose': 'operate',
        range: 'bytes=5-6',
      },
    });
    expect(response.statusCode).toBe(206);
    expect(response.body).toBe('');
    expect(response.headers['content-range']).toBe('bytes 5-6/12');
    expect(response.headers['content-length']).toBe('2');
    expect(assetContentFetch).toHaveBeenCalledOnce();
  });

  it('reports an empty original with its actual type after an unsatisfiable probe', async () => {
    const { app, assetContentFetch } = downloadApp();
    assetContentFetch
      .mockResolvedValueOnce(
        new Response(null, {
          status: 416,
          headers: { 'content-range': 'bytes */0', 'content-type': 'application/xml' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(null, {
          status: 200,
          headers: { 'content-type': 'text/plain', 'content-length': '0' },
        }),
      );
    const response = await app.inject({
      method: 'HEAD',
      url: `/api/data/v1/tenants/${TENANT_ID}/projects/${PROJECT_ID}/versions/${VERSION_ID}/assets/${ASSET_ID}/content`,
      headers: {
        authorization: 'Bearer verified-token',
        'x-wiser-tenant-id': TENANT_ID,
        'x-wiser-project-id': PROJECT_ID,
        'x-wiser-purpose': 'operate',
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe('');
    expect(response.headers['content-type']).toBe('text/plain');
    expect(response.headers['content-length']).toBe('0');
    expect(assetContentFetch).toHaveBeenCalledTimes(2);
  });

  it('proxies managed downloads on the original route without a storage redirect', async () => {
    const managed = structuredClone(context);
    managed.authorization.resourceAccess = {
      revision: 1,
      fingerprint: 'a'.repeat(64),
      scope: {
        mode: 'managed',
        validUntil: '2099-01-01T00:00:00Z',
        permissions: {
          'source.discover': [],
          'content.read': [],
          'result.export': [],
          'external.directory': [],
          'original.read': [
            { kind: 'version', dataItemId: ACTOR_ID, versionId: VERSION_ID },
          ],
        },
      },
    };
    const { app, assetDownload } = downloadApp(managed);
    const response = await app.inject({
      method: 'GET',
      url: `/api/data/v1/tenants/${TENANT_ID}/projects/${PROJECT_ID}/versions/${VERSION_ID}/assets/${ASSET_ID}`,
      headers: {
        authorization: 'Bearer verified-token',
        'x-wiser-tenant-id': TENANT_ID,
        'x-wiser-project-id': PROJECT_ID,
        'x-wiser-purpose': 'operate',
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe('source bytes');
    expect(response.headers.location).toBeUndefined();
    expect(assetDownload.createDownload).toHaveBeenCalledWith({
      context: managed,
      versionId: VERSION_ID,
      assetId: ASSET_ID,
      internal: true,
    });
  });

  it('returns an empty unsatisfiable range response with a truthful content length', async () => {
    const { app, assetContentFetch } = downloadApp();
    assetContentFetch.mockResolvedValueOnce(
      new Response('error', {
        status: 416,
        headers: {
          'content-type': 'text/plain',
          'content-length': '5',
          'content-range': 'bytes */12',
        },
      }),
    );
    const response = await app.inject({
      method: 'GET',
      url: `/api/data/v1/tenants/${TENANT_ID}/projects/${PROJECT_ID}/versions/${VERSION_ID}/assets/${ASSET_ID}/content`,
      headers: {
        authorization: 'Bearer verified-token',
        'x-wiser-tenant-id': TENANT_ID,
        'x-wiser-project-id': PROJECT_ID,
        'x-wiser-purpose': 'operate',
        range: 'bytes=20-30',
      },
    });
    expect(response.statusCode).toBe(416);
    expect(response.body).toBe('');
    expect(response.headers['content-length']).toBe('0');
    expect(response.headers['content-range']).toBe('bytes */12');
  });

  it('rejects a cross-project content request before accessing storage', async () => {
    const { app, assetContentFetch } = downloadApp();
    const response = await app.inject({
      method: 'GET',
      url: `/api/data/v1/tenants/${TENANT_ID}/projects/${ACTOR_ID}/versions/${VERSION_ID}/assets/${ASSET_ID}/content`,
      headers: {
        authorization: 'Bearer verified-token',
        'x-wiser-tenant-id': TENANT_ID,
        'x-wiser-project-id': PROJECT_ID,
        'x-wiser-purpose': 'operate',
      },
    });
    expect(response.statusCode).toBe(403);
    expect(assetContentFetch).not.toHaveBeenCalled();
  });

  it('downloads a specified asset from a source registration containing several files', async () => {
    const { app, assetDownload } = downloadApp();
    const response = await app.inject({
      method: 'GET',
      url: `/api/data/v1/tenants/${TENANT_ID}/projects/${PROJECT_ID}/versions/${VERSION_ID}/assets/${ASSET_ID}`,
      headers: {
        authorization: 'Bearer verified-token',
        'x-wiser-tenant-id': TENANT_ID,
        'x-wiser-project-id': PROJECT_ID,
        'x-wiser-purpose': 'operate',
      },
    });
    expect(response.statusCode).toBe(303);
    expect(response.headers['cache-control']).toContain('no-store');
    expect(assetDownload.createDownload).toHaveBeenCalledWith({
      context,
      versionId: VERSION_ID,
      assetId: ASSET_ID,
    });
  });

  it('rejects path scope mismatches before resolving or signing an asset', async () => {
    const { app, assetDownload } = downloadApp();
    for (const asset of ['source', ASSET_ID]) {
      const response = await app.inject({
        method: 'GET',
        url: `/api/data/v1/tenants/${ACTOR_ID}/projects/${PROJECT_ID}/versions/${VERSION_ID}/assets/${asset}`,
        headers: {
          authorization: 'Bearer verified-token',
          'x-wiser-tenant-id': TENANT_ID,
          'x-wiser-project-id': PROJECT_ID,
          'x-wiser-purpose': 'operate',
        },
      });
      expect(response.statusCode).toBe(403);
    }
    expect(assetDownload.createDownload).not.toHaveBeenCalled();
  });
  it('resolves unified Auth and returns only a short-lived signed redirect', async () => {
    const assetDownload = {
      createDownload: vi.fn(() =>
        Promise.resolve({
          url: 'http://127.0.0.1:18333/wiser-authority/signed-source',
          expiresAt: '2026-08-22T08:01:00.000Z',
        }),
      ),
    };
    const app = buildApp({
      logger: false,
      modules: [
        createDataFoundationRestModule({
          resolver: { resolve: () => Promise.resolve(context) },
          handler: { execute: () => Promise.resolve({}) },
          assetDownload,
        }),
      ],
    });
    apps.push(app);
    const response = await app.inject({
      method: 'GET',
      url: `/api/data/v1/tenants/${TENANT_ID}/projects/${PROJECT_ID}/versions/${VERSION_ID}/assets/source`,
      headers: {
        authorization: 'Bearer verified-token',
        'x-wiser-tenant-id': TENANT_ID,
        'x-wiser-project-id': PROJECT_ID,
        'x-wiser-purpose': 'operate',
      },
    });
    expect(response.statusCode).toBe(303);
    expect(response.headers.location).toBe(
      'http://127.0.0.1:18333/wiser-authority/signed-source',
    );
    expect(response.headers['cache-control']).toContain('no-store');
    expect(assetDownload.createDownload).toHaveBeenCalledWith({
      context,
      versionId: VERSION_ID,
    });
  });

  it('reads one authority object under RLS, audits, and signs without exposing storage keys', async () => {
    const queries: Array<{ text: string; values?: readonly unknown[] }> = [];
    const client = {
      query(text: string, values?: readonly unknown[]) {
        queries.push(values === undefined ? { text } : { text, values });
        if (/data\.asset-download\.lookup/.test(text)) {
          return Promise.resolve({
            rows: [
              {
                content_hash: HASH,
                security_level: 'L2_RESTRICTED',
                policy_version: '7',
              },
            ],
          });
        }
        return Promise.resolve({ rows: [] });
      },
      release: vi.fn(),
    };
    const planVersionDownload = vi.fn(() =>
      Promise.resolve({
        bucket: 'wiser-authority',
        key: 'private/version/key',
        url: 'http://127.0.0.1:18333/signed',
        expiresAt: '2026-08-22T08:01:00.000Z',
      }),
    );
    const port = new PostgresDataAssetDownloadPort({
      pool: {
        connect: () => Promise.resolve(client),
        end: () => Promise.resolve(),
      },
      objectStore: { planVersionDownload },
      ttlSeconds: 60,
    });

    await expect(
      port.createDownload({ context, versionId: VERSION_ID }),
    ).resolves.toEqual({
      url: 'http://127.0.0.1:18333/signed',
      expiresAt: '2026-08-22T08:01:00.000Z',
    });
    const sql = queries.map(({ text }) => text).join('\n');
    expect(sql).toContain("set_config('wiser.tenant_id'");
    expect(sql).toContain('security.audit_event');
    expect(sql).toContain('data.asset.download');
    expect(planVersionDownload).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      projectId: PROJECT_ID,
      versionId: VERSION_ID,
      sha256: HASH,
      ttlSeconds: 60,
    });
  });
});

it.each(['', '/content'])(
  'withholds asset %s delivery when permission is revoked during signing',
  async (suffix) => {
    let current = structuredClone(context);
    const app = buildApp({
      logger: false,
      modules: [
        createDataFoundationRestModule({
          resolver: { resolve: () => Promise.resolve(current) },
          handler: { execute: () => Promise.resolve({}) },
          assetDownload: {
            createDownload: () => {
              current = {
                ...current,
                authorization: { ...current.authorization, authzVersion: 8 },
              };
              return Promise.resolve({
                url: 'http://127.0.0.1:18333/never-release',
                expiresAt: '2099-01-01T00:00:00Z',
              });
            },
          },
          assetContentFetch: () =>
            Promise.resolve(new Response('not-to-release')),
        }),
      ],
    });
    apps.push(app);
    const response = await app.inject({
      method: 'GET',
      url: `/api/data/v1/tenants/${TENANT_ID}/projects/${PROJECT_ID}/versions/${VERSION_ID}/assets/${ASSET_ID}${suffix}`,
      headers: {
        authorization: 'Bearer test',
        'x-wiser-tenant-id': TENANT_ID,
        'x-wiser-project-id': PROJECT_ID,
        'x-wiser-purpose': 'operate',
      },
    });
    expect(response.statusCode).toBe(403);
    expect(response.headers.location).toBeUndefined();
    expect(response.body).not.toContain('not-to-release');
  },
);
