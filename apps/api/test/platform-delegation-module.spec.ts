import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

import type { PlatformRequestContext } from '@wiser/platform-contracts';
import { PlatformDelegationServiceError } from '@wiser/platform-auth';

import { buildApp } from '../src/app.js';
import {
  createPlatformDelegationModule,
  type IssuedPlatformCredentialView,
  type PlatformDelegationCommandService,
  type PlatformDelegationView,
} from '../src/platform/delegation-module.js';

const USER_ID = '91000000-0000-4000-8000-000000000001';
const SESSION_ID = '91000000-0000-4000-8000-000000000002';
const TENANT_ID = '91000000-0000-4000-8000-000000000003';
const PROJECT_ID = '91000000-0000-4000-8000-000000000004';
const DELEGATE_ID = '91000000-0000-4000-8000-000000000005';
const DELEGATION_ID = '91000000-0000-4000-8000-000000000006';
const CREDENTIAL_ID = '91000000-0000-4000-8000-000000000007';
const IDEMPOTENCY_KEY = '91000000-0000-4000-8000-000000000008';

const humanContext: PlatformRequestContext = {
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
    roles: ['platform-owner'],
    scopes: ['platform.delegation.manage', 'data.catalog.read'],
    purpose: 'operate',
    maxSecurityLevel: 'L3_CONFIDENTIAL',
    authzVersion: 8,
  },
  traceId: '9'.repeat(32),
};

const delegation: PlatformDelegationView = {
  delegationId: DELEGATION_ID,
  delegatedByActorId: USER_ID,
  delegateActorId: DELEGATE_ID,
  tenantId: TENANT_ID,
  projectId: PROJECT_ID,
  scopes: ['data.catalog.read'],
  purpose: 'operate',
  maxSecurityLevel: 'L1_INTERNAL',
  status: 'active',
  version: 1,
  expiresAt: '2026-08-22T02:15:00.000Z',
  createdAt: '2026-08-22T02:00:00.000Z',
};

function requestHeaders() {
  return {
    authorization: 'Bearer verified-human-token',
    'x-wiser-tenant-id': TENANT_ID,
    'x-wiser-project-id': PROJECT_ID,
    'x-wiser-purpose': 'operate',
    'idempotency-key': IDEMPOTENCY_KEY,
  };
}

function commandService(
  overrides: Partial<PlatformDelegationCommandService> = {},
): PlatformDelegationCommandService {
  return {
    createDelegation: vi.fn(() => Promise.resolve(delegation)),
    getDelegation: vi.fn(() => Promise.resolve(delegation)),
    issueCredential: vi.fn(() =>
      Promise.resolve({
        credentialId: CREDENTIAL_ID,
        delegationId: DELEGATION_ID,
        token: `wdc1.wdc_${'A'.repeat(22)}.${'B'.repeat(43)}`,
        expiresAt: '2026-08-22T02:15:00.000Z',
      }),
    ),
    rotateCredential: vi.fn(() =>
      Promise.resolve({
        credentialId: CREDENTIAL_ID,
        delegationId: DELEGATION_ID,
        token: `wdc1.wdc_${'C'.repeat(22)}.${'D'.repeat(43)}`,
        expiresAt: '2026-08-22T02:15:00.000Z',
      }),
    ),
    revokeDelegation: vi.fn(() => Promise.resolve()),
    revokeCredential: vi.fn(() => Promise.resolve()),
    ...overrides,
  };
}

const openApps: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(openApps.splice(0).map((app) => app.close()));
});

function appWith(
  context: PlatformRequestContext | null,
  service = commandService(),
) {
  const resolve = vi.fn(() => Promise.resolve(context));
  const app = buildApp({
    modules: [
      createPlatformDelegationModule({
        resolver: { resolve },
        service,
        knownScopes: new Set([
          'platform.delegation.manage',
          'data.catalog.read',
        ]),
      }),
    ],
  });
  openApps.push(app);
  return { app, resolve, service };
}

describe('WISER platform delegation HTTP module', () => {
  it('creates a bounded delegation from the verified human context', async () => {
    const createDelegation = vi.fn(() => Promise.resolve(delegation));
    const { app } = appWith(humanContext, commandService({ createDelegation }));
    const response = await app.inject({
      method: 'POST',
      url: '/api/platform/v1/delegations',
      headers: requestHeaders(),
      payload: {
        delegateActorId: DELEGATE_ID,
        scopes: ['data.catalog.read'],
        purpose: 'operate',
        maxSecurityLevel: 'L1_INTERNAL',
        expiresInSeconds: 900,
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.headers.location).toBe(
      `/api/platform/v1/delegations/${DELEGATION_ID}`,
    );
    expect(response.headers['cache-control']).toContain('no-store');
    expect(response.json()).toEqual(delegation);
    expect(createDelegation).toHaveBeenCalledWith({
      context: humanContext,
      delegateActorId: DELEGATE_ID,
      scopes: ['data.catalog.read'],
      purpose: 'operate',
      maxSecurityLevel: 'L1_INTERNAL',
      expiresInSeconds: 900,
      idempotencyKey: IDEMPOTENCY_KEY,
    });
  });

  it('returns a plaintext credential only from issue and rotate commands', async () => {
    const { app } = appWith(humanContext);
    const issue = await app.inject({
      method: 'POST',
      url: `/api/platform/v1/delegations/${DELEGATION_ID}/credentials`,
      headers: requestHeaders(),
      payload: { expectedDelegationVersion: 1 },
    });
    const rotate = await app.inject({
      method: 'POST',
      url: `/api/platform/v1/delegations/${DELEGATION_ID}/credentials:rotate`,
      headers: {
        ...requestHeaders(),
        'idempotency-key': '91000000-0000-4000-8000-000000000009',
      },
      payload: { expectedDelegationVersion: 1 },
    });

    expect(issue.statusCode).toBe(201);
    expect(issue.json<IssuedPlatformCredentialView>().token).toMatch(/^wdc1\./);
    expect(rotate.statusCode).toBe(201);
    expect(rotate.json<IssuedPlatformCredentialView>().token).toMatch(
      /^wdc1\./,
    );
    for (const response of [issue, rotate]) {
      expect(response.headers['cache-control']).toContain('no-store');
      expect(response.headers.pragma).toBe('no-cache');
    }
  });

  it('reads metadata and revokes delegations or credentials without returning secrets', async () => {
    const revokeDelegation = vi.fn(() => Promise.resolve());
    const revokeCredential = vi.fn(() => Promise.resolve());
    const { app } = appWith(
      humanContext,
      commandService({ revokeDelegation, revokeCredential }),
    );
    const read = await app.inject({
      method: 'GET',
      url: `/api/platform/v1/delegations/${DELEGATION_ID}`,
      headers: requestHeaders(),
    });
    const revokedDelegationResponse = await app.inject({
      method: 'POST',
      url: `/api/platform/v1/delegations/${DELEGATION_ID}:revoke`,
      headers: requestHeaders(),
      payload: { expectedDelegationVersion: 1 },
    });
    const revokedCredentialResponse = await app.inject({
      method: 'POST',
      url: `/api/platform/v1/credentials/${CREDENTIAL_ID}:revoke`,
      headers: {
        ...requestHeaders(),
        'idempotency-key': '91000000-0000-4000-8000-000000000010',
      },
      payload: {},
    });

    expect(read.statusCode).toBe(200);
    expect(read.json()).toEqual(delegation);
    expect(JSON.stringify(read.json())).not.toContain('wdc1.');
    expect(revokedDelegationResponse.statusCode).toBe(204);
    expect(revokedCredentialResponse.statusCode).toBe(204);
    expect(revokeDelegation).toHaveBeenCalledOnce();
    expect(revokeCredential).toHaveBeenCalledOnce();
  });

  it('rejects absent, delegated, or unscoped principals before command dispatch', async () => {
    const createDelegation = vi.fn(() => Promise.resolve(delegation));
    const service = commandService({ createDelegation });
    const missing = appWith(null, service).app;
    const delegated = appWith(
      {
        ...humanContext,
        principal: {
          actorType: 'agent',
          actorId: DELEGATE_ID,
          credentialId: CREDENTIAL_ID,
          delegationId: DELEGATION_ID,
          delegatedBy: USER_ID,
          authenticationMethod: 'delegated_credential',
        },
      },
      service,
    ).app;
    const unscoped = appWith(
      {
        ...humanContext,
        authorization: { ...humanContext.authorization, scopes: [] },
      },
      service,
    ).app;

    for (const [app, expectedStatus] of [
      [missing, 403],
      [delegated, 403],
      [unscoped, 403],
    ] as const) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/platform/v1/delegations',
        headers: requestHeaders(),
        payload: {
          delegateActorId: DELEGATE_ID,
          scopes: ['data.catalog.read'],
          purpose: 'operate',
          maxSecurityLevel: 'L1_INTERNAL',
          expiresInSeconds: 900,
        },
      });
      expect(response.statusCode).toBe(expectedStatus);
    }
    expect(createDelegation).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: 'duplicate scopes',
      payload: {
        delegateActorId: DELEGATE_ID,
        scopes: ['data.catalog.read', 'data.catalog.read'],
        purpose: 'operate',
        maxSecurityLevel: 'L1_INTERNAL',
        expiresInSeconds: 900,
      },
    },
    {
      name: 'unknown scope',
      payload: {
        delegateActorId: DELEGATE_ID,
        scopes: ['data.export'],
        purpose: 'operate',
        maxSecurityLevel: 'L1_INTERNAL',
        expiresInSeconds: 900,
      },
    },
    {
      name: 'excess security ceiling',
      context: {
        ...humanContext,
        authorization: {
          ...humanContext.authorization,
          maxSecurityLevel: 'L0_PUBLIC' as const,
        },
      },
      payload: {
        delegateActorId: DELEGATE_ID,
        scopes: ['data.catalog.read'],
        purpose: 'operate',
        maxSecurityLevel: 'L1_INTERNAL',
        expiresInSeconds: 900,
      },
    },
    {
      name: 'excess TTL',
      payload: {
        delegateActorId: DELEGATE_ID,
        scopes: ['data.catalog.read'],
        purpose: 'operate',
        maxSecurityLevel: 'L1_INTERNAL',
        expiresInSeconds: 3_601,
      },
    },
  ])('rejects $name', async ({ context = humanContext, payload }) => {
    const createDelegation = vi.fn(() => Promise.resolve(delegation));
    const service = commandService({ createDelegation });
    const { app } = appWith(context, service);
    const response = await app.inject({
      method: 'POST',
      url: '/api/platform/v1/delegations',
      headers: requestHeaders(),
      payload,
    });

    expect(response.statusCode).toBe(422);
    expect(createDelegation).not.toHaveBeenCalled();
  });

  it('requires a UUID idempotency key for every command', async () => {
    const createDelegation = vi.fn(() => Promise.resolve(delegation));
    const service = commandService({ createDelegation });
    const { app } = appWith(humanContext, service);
    const headers = requestHeaders();
    const response = await app.inject({
      method: 'POST',
      url: '/api/platform/v1/delegations',
      headers: { ...headers, 'idempotency-key': 'retry-me' },
      payload: {
        delegateActorId: DELEGATE_ID,
        scopes: ['data.catalog.read'],
        purpose: 'operate',
        maxSecurityLevel: 'L1_INTERNAL',
        expiresInSeconds: 900,
      },
    });

    expect(response.statusCode).toBe(422);
    expect(createDelegation).not.toHaveBeenCalled();
  });

  it('maps transactional conflicts and unrecoverable secret replays to stable no-store errors', async () => {
    for (const [code, expectedStatus] of [
      ['IDEMPOTENCY_CONFLICT', 409],
      ['DELEGATION_VERSION_CONFLICT', 409],
      ['SECRET_NOT_RECOVERABLE', 409],
      ['NOT_AUTHORIZED', 403],
    ] as const) {
      const service = commandService({
        createDelegation: vi.fn(() =>
          Promise.reject(new PlatformDelegationServiceError(code)),
        ),
      });
      const { app } = appWith(humanContext, service);
      const response = await app.inject({
        method: 'POST',
        url: '/api/platform/v1/delegations',
        headers: requestHeaders(),
        payload: {
          delegateActorId: DELEGATE_ID,
          scopes: ['data.catalog.read'],
          purpose: 'operate',
          maxSecurityLevel: 'L1_INTERNAL',
          expiresInSeconds: 900,
        },
      });

      expect(response.statusCode).toBe(expectedStatus);
      expect(response.headers['cache-control']).toContain('no-store');
      expect(response.json()).toMatchObject({ code });
      expect(response.body).not.toContain('wdc1.');
    }
  });
});
