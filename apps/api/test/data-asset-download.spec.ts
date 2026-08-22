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
