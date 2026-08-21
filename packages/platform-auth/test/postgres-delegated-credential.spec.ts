import { Buffer } from 'node:buffer';

import { describe, expect, it, vi } from 'vitest';

import {
  createPostgresDelegatedCredentialRecordLoader,
  type DelegatedCredentialAuthorizationQuery,
} from '../src/index.js';

const KEY_ID = `wdc_${'A'.repeat(22)}`;

describe('PostgreSQL delegated credential adapter', () => {
  it('loads HMAC plus live control facts by public key id without comparing secrets in SQL', async () => {
    const tokenHmac = Buffer.from('ab'.repeat(32), 'hex');
    const query: DelegatedCredentialAuthorizationQuery = vi.fn(() =>
      Promise.resolve({
        rows: [
          {
            credential_id: 'b1000000-0000-4000-8000-000000000001',
            delegation_id: 'b1000000-0000-4000-8000-000000000002',
            key_id: KEY_ID,
            hmac_key_id: 'primary-2026-08',
            token_hmac: tokenHmac,
            credential_expires_at: new Date('2026-08-22T03:00:00Z'),
            credential_revoked_at: null,
            rotated_to_credential_id: null,
            delegated_by_actor_id: 'b1000000-0000-4000-8000-000000000003',
            delegated_by_actor_status: 'active',
            delegate_actor_id: 'b1000000-0000-4000-8000-000000000004',
            delegate_actor_type: 'agent',
            delegate_actor_status: 'active',
            tenant_id: 'b1000000-0000-4000-8000-000000000005',
            tenant_status: 'active',
            project_id: 'b1000000-0000-4000-8000-000000000006',
            project_status: 'active',
            purpose: 'operate',
            delegation_scopes: ['data.catalog.read'],
            delegation_max_security_level: 'L2_RESTRICTED',
            delegation_status: 'active',
            delegation_expires_at: '2026-08-22T02:45:00Z',
            delegation_revoked_at: null,
            delegator_scopes: ['data.catalog.read', 'data.query.execute'],
            delegator_max_security_level: 'L1_INTERNAL',
            delegator_tenant_membership_active: true,
            delegator_project_membership_active: true,
            delegate_tenant_membership_active: true,
            delegate_project_membership_active: true,
            authz_version: '14',
          },
        ],
      }),
    );
    const load = createPostgresDelegatedCredentialRecordLoader(query);

    const record = await load(KEY_ID);

    expect(record).toMatchObject({
      keyId: KEY_ID,
      hmacKeyId: 'primary-2026-08',
      credentialExpiresAt: '2026-08-22T03:00:00.000Z',
      delegationExpiresAt: '2026-08-22T02:45:00.000Z',
      tokenHmac,
      authzVersion: '14',
    });
    const [sql, values] = vi.mocked(query).mock.calls[0] ?? [];
    expect(values).toEqual([KEY_ID]);
    expect(sql).toContain('platform_private.delegated_credentials');
    expect(sql).toContain('platform.delegations');
    expect(sql).toContain('platform.tenant_memberships');
    expect(sql).toContain('platform.project_memberships');
    expect(sql).toContain('platform.role_bindings');
    expect(sql).toContain('platform.role_scopes');
    expect(sql).toContain('credential.key_id = $1');
    expect(sql).not.toMatch(/token_hmac\s*=/i);
  });

  it('returns no record for an unknown locator', async () => {
    const query: DelegatedCredentialAuthorizationQuery = vi.fn(() =>
      Promise.resolve({ rows: [] }),
    );
    const load = createPostgresDelegatedCredentialRecordLoader(query);

    await expect(load(KEY_ID)).resolves.toBeNull();
  });
});
