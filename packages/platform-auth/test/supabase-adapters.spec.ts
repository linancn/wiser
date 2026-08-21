import { describe, expect, it, vi } from 'vitest';

import {
  createPostgresAuthorizationContextLoader,
  createSupabaseJwtClaimsVerifier,
  type AuthorizationQuery,
  type SupabaseClaimsClient,
} from '../src/index.js';

const USER_ID = 'd1000000-0000-4000-8000-000000000001';
const SESSION_ID = 'd1000000-0000-4000-8000-000000000002';
const TENANT_ID = 'd1000000-0000-4000-8000-000000000003';
const PROJECT_ID = 'd1000000-0000-4000-8000-000000000004';

describe('Supabase Auth adapters', () => {
  it('accepts verified authenticated claims with an active session id', async () => {
    const client: SupabaseClaimsClient = {
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
    const verify = createSupabaseJwtClaimsVerifier(client, {
      now: () => new Date('2026-08-22T00:00:00.000Z'),
    });

    await expect(verify('access-token')).resolves.toEqual({
      userId: USER_ID,
      sessionId: SESSION_ID,
      expiresAt: '2027-01-15T08:00:00.000Z',
    });
  });

  it('rejects service-role or expired claims even after signature verification', async () => {
    const client: SupabaseClaimsClient = {
      getClaims: vi.fn(() =>
        Promise.resolve({
          data: {
            claims: {
              sub: USER_ID,
              session_id: SESSION_ID,
              role: 'service_role',
              exp: 1,
            },
          },
          error: null,
        }),
      ),
    };
    const verify = createSupabaseJwtClaimsVerifier(client, {
      now: () => new Date('2026-08-22T00:00:00.000Z'),
    });

    await expect(verify('service-role-token')).resolves.toBeNull();
  });

  it('loads active session membership roles and scopes from the control plane', async () => {
    const query: AuthorizationQuery = vi.fn(() =>
      Promise.resolve({
        rows: [
          {
            tenant_id: TENANT_ID,
            project_id: PROJECT_ID,
            roles: ['data-reader'],
            scopes: ['data.catalog.read', 'data.query'],
            max_security_level: 'L1_INTERNAL',
            authz_version: 7,
          },
        ],
      }),
    );
    const load = createPostgresAuthorizationContextLoader(query);

    await expect(
      load({
        actorId: USER_ID,
        sessionId: SESSION_ID,
        tenantId: TENANT_ID,
        projectId: PROJECT_ID,
        purpose: 'operate',
      }),
    ).resolves.toEqual({
      tenantId: TENANT_ID,
      projectId: PROJECT_ID,
      roles: ['data-reader'],
      scopes: ['data.catalog.read', 'data.query'],
      purpose: 'operate',
      maxSecurityLevel: 'L1_INTERNAL',
      authzVersion: 7,
    });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('auth.sessions'),
      [USER_ID, SESSION_ID, TENANT_ID, PROJECT_ID],
    );
  });

  it('returns no context when the session or membership query has no row', async () => {
    const query: AuthorizationQuery = vi.fn(() =>
      Promise.resolve({ rows: [] }),
    );
    const load = createPostgresAuthorizationContextLoader(query);

    await expect(
      load({
        actorId: USER_ID,
        sessionId: SESSION_ID,
        tenantId: TENANT_ID,
        projectId: PROJECT_ID,
        purpose: 'operate',
      }),
    ).resolves.toBeNull();
  });
});
