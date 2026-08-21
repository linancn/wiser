import { describe, expect, it, vi } from 'vitest';

import {
  DelegatedCredentialPrincipalResolver,
  issueDelegatedCredential,
  type DelegatedCredentialAuthorizationRecord,
  type DelegatedCredentialAuthorizationRecordLoader,
  type DelegatedCredentialHmacKeyRing,
} from '../src/index.js';

const CREDENTIAL_ID = 'a1000000-0000-4000-8000-000000000001';
const DELEGATION_ID = 'a1000000-0000-4000-8000-000000000002';
const DELEGATOR_ID = 'a1000000-0000-4000-8000-000000000003';
const DELEGATE_ID = 'a1000000-0000-4000-8000-000000000004';
const TENANT_ID = 'a1000000-0000-4000-8000-000000000005';
const PROJECT_ID = 'a1000000-0000-4000-8000-000000000006';
const TRACE_ID = 'a'.repeat(32);
const NOW = new Date('2026-08-22T02:00:00.000Z');

const keyRing: DelegatedCredentialHmacKeyRing = {
  activeKeyId: 'primary-2026-08',
  keys: new Map([
    [
      'primary-2026-08',
      Uint8Array.from({ length: 32 }, (_, index) => index + 1),
    ],
  ]),
};

const issued = issueDelegatedCredential(keyRing, (size) =>
  Uint8Array.from({ length: size }, (_, index) => index + size),
);

const baseRecord: DelegatedCredentialAuthorizationRecord = {
  credentialId: CREDENTIAL_ID,
  delegationId: DELEGATION_ID,
  keyId: issued.keyId,
  hmacKeyId: issued.hmacKeyId,
  tokenHmac: issued.tokenHmac,
  credentialExpiresAt: '2026-08-22T02:45:00.000Z',
  credentialRevokedAt: null,
  rotatedToCredentialId: null,
  delegatedByActorId: DELEGATOR_ID,
  delegatedByActorStatus: 'active',
  delegateActorId: DELEGATE_ID,
  delegateActorType: 'agent',
  delegateActorStatus: 'active',
  tenantId: TENANT_ID,
  tenantStatus: 'active',
  projectId: PROJECT_ID,
  projectStatus: 'active',
  purpose: 'operate',
  delegationScopes: [
    'data.catalog.read',
    'data.query.execute',
    'data.query.execute',
    'data.publish',
  ],
  delegationMaxSecurityLevel: 'L2_RESTRICTED',
  delegationStatus: 'active',
  delegationExpiresAt: '2026-08-22T02:30:00.000Z',
  delegationRevokedAt: null,
  delegatorScopes: ['data.catalog.read', 'data.query.execute', 'data.geo.read'],
  delegatorMaxSecurityLevel: 'L1_INTERNAL',
  delegatorTenantMembershipActive: true,
  delegatorProjectMembershipActive: true,
  delegateTenantMembershipActive: true,
  delegateProjectMembershipActive: true,
  authzVersion: 12,
};

function input(
  overrides: Partial<{
    readonly token: string;
    readonly tenantId: string;
    readonly projectId: string;
    readonly purpose: string;
  }> = {},
) {
  return {
    token: issued.token,
    tenantId: TENANT_ID,
    projectId: PROJECT_ID,
    purpose: 'operate',
    traceId: TRACE_ID,
    ...overrides,
  };
}

function resolverWith(
  record: DelegatedCredentialAuthorizationRecord | null = baseRecord,
) {
  const loadRecord: DelegatedCredentialAuthorizationRecordLoader = vi.fn(() =>
    Promise.resolve(record),
  );
  const resolver = new DelegatedCredentialPrincipalResolver({
    keyRing,
    knownScopes: new Set([
      'data.catalog.read',
      'data.query.execute',
      'data.geo.read',
    ]),
    loadRecord,
    now: () => NOW,
  });
  return { loadRecord, resolver };
}

describe('delegated credential principal resolution', () => {
  it('authenticates the delegate while intersecting live scopes and security ceilings', async () => {
    const { resolver, loadRecord } = resolverWith();

    await expect(resolver.resolve(input())).resolves.toEqual({
      principal: {
        actorType: 'agent',
        actorId: DELEGATE_ID,
        credentialId: CREDENTIAL_ID,
        delegationId: DELEGATION_ID,
        delegatedBy: DELEGATOR_ID,
        authenticationMethod: 'delegated_credential',
        expiresAt: '2026-08-22T02:30:00.000Z',
      },
      authorization: {
        tenantId: TENANT_ID,
        projectId: PROJECT_ID,
        roles: [],
        scopes: ['data.catalog.read', 'data.query.execute'],
        purpose: 'operate',
        maxSecurityLevel: 'L1_INTERNAL',
        authzVersion: 12,
      },
      traceId: TRACE_ID,
    });
    expect(loadRecord).toHaveBeenCalledWith(issued.keyId);
  });

  it.each([
    '',
    'legacy-local-token',
    'header.payload.signature',
    'wdc1.invalid',
    `wdc1.wdc_${'A'.repeat(22)}.${'B'.repeat(42)}`,
  ])('rejects malformed token %j before any database lookup', async (token) => {
    const { resolver, loadRecord } = resolverWith();

    await expect(resolver.resolve(input({ token }))).resolves.toBeNull();
    expect(loadRecord).not.toHaveBeenCalled();
  });

  it('rejects an unknown key id or wrong secret after one locator lookup', async () => {
    const { resolver, loadRecord } = resolverWith();
    const wrongSecret = `${issued.token.slice(0, -1)}${issued.token.endsWith('A') ? 'B' : 'A'}`;

    await expect(
      resolver.resolve(input({ token: wrongSecret })),
    ).resolves.toBeNull();
    expect(loadRecord).toHaveBeenCalledOnce();

    const missing = resolverWith(null);
    await expect(missing.resolver.resolve(input())).resolves.toBeNull();
  });

  it.each([
    ['credential revoked', { credentialRevokedAt: '2026-08-22T02:01:00Z' }],
    ['credential rotated', { rotatedToCredentialId: CREDENTIAL_ID }],
    ['credential expired', { credentialExpiresAt: '2026-08-22T02:00:00Z' }],
    ['delegation revoked', { delegationRevokedAt: '2026-08-22T02:01:00Z' }],
    ['delegation status', { delegationStatus: 'expired' }],
    ['delegation expired', { delegationExpiresAt: '2026-08-22T01:59:59Z' }],
    ['delegate suspended', { delegateActorStatus: 'suspended' }],
    ['delegator revoked', { delegatedByActorStatus: 'revoked' }],
    ['tenant suspended', { tenantStatus: 'suspended' }],
    ['project archived', { projectStatus: 'archived' }],
    ['delegator tenant membership', { delegatorTenantMembershipActive: false }],
    [
      'delegator project membership',
      { delegatorProjectMembershipActive: false },
    ],
    ['delegate tenant membership', { delegateTenantMembershipActive: false }],
    ['delegate project membership', { delegateProjectMembershipActive: false }],
    ['human delegate', { delegateActorType: 'human' }],
  ] as const)(
    'fails closed when %s is no longer live',
    async (_, overrides) => {
      const { resolver } = resolverWith({ ...baseRecord, ...overrides });
      await expect(resolver.resolve(input())).resolves.toBeNull();
    },
  );

  it.each([
    ['tenant', { tenantId: 'b1000000-0000-4000-8000-000000000001' }],
    ['project', { projectId: 'b1000000-0000-4000-8000-000000000002' }],
    ['purpose', { purpose: 'export' }],
  ])('rejects %s substitution', async (_, overrides) => {
    const { resolver } = resolverWith();
    await expect(resolver.resolve(input(overrides))).resolves.toBeNull();
  });

  it('rejects empty effective scopes or an invalid authorization version', async () => {
    const noScopes = resolverWith({
      ...baseRecord,
      delegatorScopes: ['data.geo.read'],
      delegationScopes: ['data.catalog.read'],
    });
    await expect(noScopes.resolver.resolve(input())).resolves.toBeNull();

    const invalidVersion = resolverWith({
      ...baseRecord,
      authzVersion: Number.MAX_SAFE_INTEGER + 1,
    });
    await expect(invalidVersion.resolver.resolve(input())).resolves.toBeNull();
  });
});
