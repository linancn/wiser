import { describe, expect, it } from 'vitest';

import {
  AuthorizedContextSchema,
  PlatformPrincipalSchema,
  PlatformRequestContextSchema,
} from '../src/index.js';

const ACTOR_ID = '10000000-0000-4000-8000-000000000001';
const USER_ID = '10000000-0000-4000-8000-000000000002';
const SESSION_ID = '10000000-0000-4000-8000-000000000003';
const TENANT_ID = '10000000-0000-4000-8000-000000000004';
const PROJECT_ID = '10000000-0000-4000-8000-000000000005';
const TRACE_ID = '10000000000000000000000000000006';

describe('WISER platform principal contracts', () => {
  it('accepts one verified Supabase human principal and authorization context', () => {
    const principal = PlatformPrincipalSchema.parse({
      actorType: 'human',
      actorId: ACTOR_ID,
      authUserId: USER_ID,
      sessionId: SESSION_ID,
      authenticationMethod: 'supabase_jwt',
    });
    const authorization = AuthorizedContextSchema.parse({
      tenantId: TENANT_ID,
      projectId: PROJECT_ID,
      roles: ['project-operator'],
      scopes: ['data.catalog.read', 'excon.run.read'],
      purpose: 'operate',
      authzVersion: 3,
    });

    expect(
      PlatformRequestContextSchema.parse({
        principal,
        authorization,
        traceId: TRACE_ID,
      }),
    ).toMatchObject({
      principal: { actorType: 'human', actorId: ACTOR_ID },
      authorization: { tenantId: TENANT_ID, projectId: PROJECT_ID },
    });
  });

  it('requires Supabase human principals to carry trusted user and session ids', () => {
    expect(() =>
      PlatformPrincipalSchema.parse({
        actorType: 'human',
        actorId: ACTOR_ID,
        authenticationMethod: 'supabase_jwt',
      }),
    ).toThrow();
  });

  it('requires delegated principals to carry their credential and delegation chain', () => {
    expect(() =>
      PlatformPrincipalSchema.parse({
        actorType: 'agent',
        actorId: ACTOR_ID,
        authenticationMethod: 'delegated_credential',
      }),
    ).toThrow();
  });

  it('rejects unnamespaced scopes and unknown authorization input', () => {
    expect(() =>
      AuthorizedContextSchema.parse({
        tenantId: TENANT_ID,
        projectId: PROJECT_ID,
        roles: [],
        scopes: ['read'],
        purpose: 'operate',
        authzVersion: 0,
        bypassAuthorization: true,
      }),
    ).toThrow();
  });
});
