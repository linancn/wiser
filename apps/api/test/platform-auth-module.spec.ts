import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

import type { PlatformRequestContext } from '@wiser/platform-contracts';
import type { ResolveSupabasePrincipalInput } from '@wiser/platform-auth';

import { buildApp } from '../src/app.js';
import { createPlatformIdentityModule } from '../src/platform/identity-module.js';

const TENANT_ID = 'e1000000-0000-4000-8000-000000000001';
const PROJECT_ID = 'e1000000-0000-4000-8000-000000000002';
const USER_ID = 'e1000000-0000-4000-8000-000000000003';
const SESSION_ID = 'e1000000-0000-4000-8000-000000000004';

const context: PlatformRequestContext = {
  principal: {
    actorType: 'human',
    actorId: USER_ID,
    authUserId: USER_ID,
    sessionId: SESSION_ID,
    authenticationMethod: 'supabase_jwt',
  },
  authorization: {
    tenantId: TENANT_ID,
    projectId: PROJECT_ID,
    roles: ['data-reader'],
    scopes: ['data.catalog.read'],
    purpose: 'operate',
    maxSecurityLevel: 'L1_INTERNAL',
    authzVersion: 2,
  },
  traceId: 'e'.repeat(32),
};

const openApps: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(openApps.splice(0).map((app) => app.close()));
});

describe('WISER platform identity HTTP module', () => {
  it('returns the safe unified principal resolved from bearer and project context', async () => {
    const resolve = vi.fn((_input: ResolveSupabasePrincipalInput) =>
      Promise.resolve(context),
    );
    const app = buildApp({
      modules: [createPlatformIdentityModule({ resolve })],
    });
    openApps.push(app);

    const response = await app.inject({
      method: 'GET',
      url: '/api/platform/v1/me',
      headers: {
        authorization: 'Bearer verified-token',
        'x-wiser-tenant-id': TENANT_ID,
        'x-wiser-project-id': PROJECT_ID,
        'x-wiser-purpose': 'operate',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      actorType: 'human',
      actorId: USER_ID,
      tenantId: TENANT_ID,
      projectId: PROJECT_ID,
      roles: ['data-reader'],
      scopes: ['data.catalog.read'],
      purpose: 'operate',
      maxSecurityLevel: 'L1_INTERNAL',
      authzVersion: 2,
    });
    const resolveInput = resolve.mock.calls[0]?.[0];
    expect(resolveInput).toMatchObject({
      token: 'verified-token',
      tenantId: TENANT_ID,
      projectId: PROJECT_ID,
      purpose: 'operate',
    });
    expect(resolveInput?.traceId).toMatch(/^[a-f0-9]{32}$/);
  });

  it('fails closed when credentials or authorization context are absent', async () => {
    const resolve = vi.fn(() => Promise.resolve(null));
    const app = buildApp({
      modules: [createPlatformIdentityModule({ resolve })],
    });
    openApps.push(app);

    const missing = await app.inject({
      method: 'GET',
      url: '/api/platform/v1/me',
    });
    const denied = await app.inject({
      method: 'GET',
      url: '/api/platform/v1/me',
      headers: {
        authorization: 'Bearer revoked-token',
        'x-wiser-tenant-id': TENANT_ID,
        'x-wiser-project-id': PROJECT_ID,
        'x-wiser-purpose': 'operate',
      },
    });

    expect(missing.statusCode).toBe(401);
    expect(denied.statusCode).toBe(403);
    expect(resolve).toHaveBeenCalledTimes(1);
  });
});
