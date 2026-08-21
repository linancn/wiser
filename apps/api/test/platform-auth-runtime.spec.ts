import { Buffer } from 'node:buffer';

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

import type {
  AuthorizationQuery,
  SupabaseClaimsClient,
} from '@wiser/platform-auth';

import { buildApp } from '../src/app.js';
import {
  createPlatformAuthModuleFromEnvironment,
  loadPlatformAuthRuntimeConfig,
  type PlatformAuthRuntimeFactories,
} from '../src/platform/auth-runtime.js';

const USER_ID = 'f1000000-0000-4000-8000-000000000001';
const SESSION_ID = 'f1000000-0000-4000-8000-000000000002';
const TENANT_ID = 'f1000000-0000-4000-8000-000000000003';
const PROJECT_ID = 'f1000000-0000-4000-8000-000000000004';

const openApps: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(openApps.splice(0).map((app) => app.close()));
});

describe('WISER platform auth runtime', () => {
  it('requires the Supabase and database configuration in production', () => {
    expect(() =>
      loadPlatformAuthRuntimeConfig({ NODE_ENV: 'production' }),
    ).toThrow('SUPABASE_URL');
    expect(() =>
      loadPlatformAuthRuntimeConfig({
        NODE_ENV: 'production',
        WISER_AUTH_MODE: 'off',
      }),
    ).toThrow('WISER_AUTH_MODE=off is forbidden in production');
    expect(() =>
      loadPlatformAuthRuntimeConfig({
        NODE_ENV: 'production',
        SUPABASE_URL: 'http://127.0.0.1:56321',
        SUPABASE_PUBLISHABLE_KEY: 'publishable-test-key-long-enough',
        DATABASE_URL: 'postgresql://test:test@127.0.0.1:56322/postgres',
      }),
    ).toThrow('WISER_DELEGATED_CREDENTIAL_HMAC_KEYS');
  });

  it('keeps the platform identity module opt-in for local compatibility', () => {
    expect(
      createPlatformAuthModuleFromEnvironment({ NODE_ENV: 'development' }),
    ).toBeNull();
  });

  it('wires verified claims membership lookup and pool shutdown', async () => {
    const claimsClient: SupabaseClaimsClient = {
      getClaims: vi.fn(() =>
        Promise.resolve({
          data: {
            claims: {
              sub: USER_ID,
              session_id: SESSION_ID,
              role: 'authenticated',
              exp: 1_800_000_000,
            },
          },
          error: null,
        }),
      ),
    };
    const query: AuthorizationQuery = vi.fn(() =>
      Promise.resolve({
        rows: [
          {
            tenant_id: TENANT_ID,
            project_id: PROJECT_ID,
            roles: ['data-reader'],
            scopes: ['data.catalog.read'],
            max_security_level: 'L1_INTERNAL',
            authz_version: 2,
          },
        ],
      }),
    );
    const close = vi.fn(() => Promise.resolve());
    const factories: PlatformAuthRuntimeFactories = {
      createClaimsClient: vi.fn(() => claimsClient),
      createAuthorizationDatabase: vi.fn(() => ({ query, close })),
    };
    const module = createPlatformAuthModuleFromEnvironment(
      {
        NODE_ENV: 'test',
        WISER_AUTH_MODE: 'supabase',
        SUPABASE_URL: 'http://127.0.0.1:56321',
        SUPABASE_PUBLISHABLE_KEY: 'publishable-test-key-long-enough',
        DATABASE_URL: 'postgresql://test:test@127.0.0.1:56322/postgres',
        WISER_DELEGATED_CREDENTIAL_HMAC_KEYS: JSON.stringify({
          activeKeyId: 'primary-2026-08',
          keys: {
            'primary-2026-08': Buffer.alloc(32, 7).toString('base64url'),
          },
        }),
      },
      factories,
    );
    expect(module).not.toBeNull();
    const app = buildApp({ modules: module === null ? [] : [module] });
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
    expect(response.json()).toMatchObject({
      actorId: USER_ID,
      tenantId: TENANT_ID,
      projectId: PROJECT_ID,
      maxSecurityLevel: 'L1_INTERNAL',
    });

    await app.close();
    openApps.pop();
    expect(close).toHaveBeenCalledOnce();
  });
});
