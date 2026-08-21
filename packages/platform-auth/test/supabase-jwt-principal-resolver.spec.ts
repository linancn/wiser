import { describe, expect, it, vi } from 'vitest';

import type { AuthorizedContext } from '@wiser/platform-contracts';

import {
  SupabaseJwtPrincipalResolver,
  type AuthorizationContextLoader,
  type SupabaseJwtClaimsVerifier,
} from '../src/index.js';

const USER_ID = 'c1000000-0000-4000-8000-000000000001';
const SESSION_ID = 'c1000000-0000-4000-8000-000000000002';
const TENANT_ID = 'c1000000-0000-4000-8000-000000000003';
const PROJECT_ID = 'c1000000-0000-4000-8000-000000000004';
const TRACE_ID = 'c10000000000000000000000000000005';

const authorization: AuthorizedContext = {
  tenantId: TENANT_ID,
  projectId: PROJECT_ID,
  roles: ['data-reader'],
  scopes: ['data.catalog.read'],
  purpose: 'operate',
  authzVersion: 4,
};

describe('Supabase JWT principal resolution', () => {
  it('combines verified Supabase claims with authoritative membership context', async () => {
    const verifyClaims: SupabaseJwtClaimsVerifier = vi.fn(() =>
      Promise.resolve({
        userId: USER_ID,
        sessionId: SESSION_ID,
        expiresAt: '2026-08-22T02:00:00.000Z',
      }),
    );
    const loadAuthorization: AuthorizationContextLoader = vi.fn(() =>
      Promise.resolve(authorization),
    );
    const resolver = new SupabaseJwtPrincipalResolver({
      verifyClaims,
      loadAuthorization,
    });

    await expect(
      resolver.resolve({
        token: 'verified-access-token',
        tenantId: TENANT_ID,
        projectId: PROJECT_ID,
        purpose: 'operate',
        traceId: TRACE_ID,
      }),
    ).resolves.toEqual({
      principal: {
        actorType: 'human',
        actorId: USER_ID,
        authUserId: USER_ID,
        sessionId: SESSION_ID,
        authenticationMethod: 'supabase_jwt',
        expiresAt: '2026-08-22T02:00:00.000Z',
      },
      authorization,
      traceId: TRACE_ID,
    });
    expect(loadAuthorization).toHaveBeenCalledWith({
      actorId: USER_ID,
      sessionId: SESSION_ID,
      tenantId: TENANT_ID,
      projectId: PROJECT_ID,
      purpose: 'operate',
    });
  });

  it('fails closed before authorization lookup when JWT verification fails', async () => {
    const verifyClaims: SupabaseJwtClaimsVerifier = vi.fn(() =>
      Promise.resolve(null),
    );
    const loadAuthorization: AuthorizationContextLoader = vi.fn(() =>
      Promise.resolve(authorization),
    );
    const resolver = new SupabaseJwtPrincipalResolver({
      verifyClaims,
      loadAuthorization,
    });

    await expect(
      resolver.resolve({
        token: 'invalid-token',
        tenantId: TENANT_ID,
        projectId: PROJECT_ID,
        purpose: 'operate',
        traceId: TRACE_ID,
      }),
    ).resolves.toBeNull();
    expect(loadAuthorization).not.toHaveBeenCalled();
  });

  it('fails closed when the session or membership no longer authorizes the project', async () => {
    const verifyClaims: SupabaseJwtClaimsVerifier = vi.fn(() =>
      Promise.resolve({ userId: USER_ID, sessionId: SESSION_ID }),
    );
    const loadAuthorization: AuthorizationContextLoader = vi.fn(() =>
      Promise.resolve(null),
    );
    const resolver = new SupabaseJwtPrincipalResolver({
      verifyClaims,
      loadAuthorization,
    });

    await expect(
      resolver.resolve({
        token: 'revoked-membership-token',
        tenantId: TENANT_ID,
        projectId: PROJECT_ID,
        purpose: 'operate',
        traceId: TRACE_ID,
      }),
    ).resolves.toBeNull();
  });
});
