import { Buffer } from 'node:buffer';

import { describe, expect, it } from 'vitest';

import type { PlatformRequestContext } from '@wiser/platform-contracts';

import {
  PlatformDelegationServiceError,
  PostgresPlatformDelegationService,
  type DelegatedCredentialHmacKeyRing,
  type PlatformDelegationTransactionClient,
  type PlatformDelegationTransactionPool,
} from '../src/index.js';

const USER_ID = '92000000-0000-4000-8000-000000000001';
const SESSION_ID = '92000000-0000-4000-8000-000000000002';
const TENANT_ID = '92000000-0000-4000-8000-000000000003';
const PROJECT_ID = '92000000-0000-4000-8000-000000000004';
const DELEGATE_ID = '92000000-0000-4000-8000-000000000005';
const DELEGATION_ID = '92000000-0000-4000-8000-000000000006';
const CREDENTIAL_ID = '92000000-0000-4000-8000-000000000007';
const ROTATED_CREDENTIAL_ID = '92000000-0000-4000-8000-000000000008';
const IDEMPOTENCY_KEY = '92000000-0000-4000-8000-000000000009';
const SECOND_IDEMPOTENCY_KEY = '92000000-0000-4000-8000-000000000010';

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
    roles: ['platform-owner'],
    scopes: [
      'platform.delegation.manage',
      'data.catalog.read',
      'data.query.execute',
    ],
    purpose: 'operate',
    maxSecurityLevel: 'L3_CONFIDENTIAL',
    authzVersion: 5,
  },
  traceId: '9'.repeat(32),
};

const keyRing: DelegatedCredentialHmacKeyRing = {
  activeKeyId: 'primary-2026-08',
  keys: new Map([
    [
      'primary-2026-08',
      Uint8Array.from({ length: 32 }, (_, index) => index + 1),
    ],
  ]),
};

interface QueryCall {
  readonly text: string;
  readonly values: readonly unknown[];
}

interface FakeDatabaseOptions {
  readonly authorizationRows?: readonly Record<string, unknown>[];
  readonly delegateLive?: boolean;
  readonly delegationOwnerId?: string;
  readonly delegationExpiresAt?: string;
  readonly credentialExpiresAt?: string;
  readonly activeCredentialId?: string | null;
  readonly failMarker?: string;
}

class FakePlatformDatabase implements PlatformDelegationTransactionClient {
  readonly calls: QueryCall[] = [];
  readonly outbox = new Map<string, Readonly<Record<string, unknown>>>();
  readonly authorizationRows: readonly Record<string, unknown>[];
  readonly delegateLive: boolean;
  readonly failMarker: string | undefined;
  readonly delegation: Record<string, unknown>;
  readonly credentialExpiresAt: string;
  activeCredentialId: string | null;
  released = false;

  constructor(options: FakeDatabaseOptions = {}) {
    this.authorizationRows = options.authorizationRows ?? [authorizationRow()];
    this.delegateLive = options.delegateLive ?? true;
    this.failMarker = options.failMarker;
    this.credentialExpiresAt =
      options.credentialExpiresAt ?? '2026-08-22T02:15:00.000Z';
    this.activeCredentialId = options.activeCredentialId ?? null;
    this.delegation = {
      delegation_id: DELEGATION_ID,
      delegated_by_actor_id: options.delegationOwnerId ?? USER_ID,
      delegate_actor_id: DELEGATE_ID,
      tenant_id: TENANT_ID,
      project_id: PROJECT_ID,
      scopes: ['data.catalog.read'],
      purpose: 'operate',
      max_security_level: 'L1_INTERNAL',
      status: 'active',
      version: 1,
      expires_at: options.delegationExpiresAt ?? '2026-08-22T03:00:00.000Z',
      created_at: '2026-08-22T02:00:00.000Z',
      revoked_at: null,
    };
  }

  query<Row = Record<string, unknown>>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<{ readonly rows: readonly Row[]; readonly rowCount: number }> {
    this.calls.push({ text, values });
    if (this.failMarker !== undefined && text.includes(this.failMarker)) {
      return Promise.reject(new Error('simulated persistence failure'));
    }

    let rows: readonly unknown[] = [];
    if (text.includes('join auth.sessions as session')) {
      rows = this.authorizationRows;
    } else if (text.includes('platform-delegation:idempotency-read')) {
      const payload = this.outbox.get(String(values[0]));
      rows = payload === undefined ? [] : [{ payload }];
    } else if (text.includes('platform-delegation:delegate-read')) {
      rows = this.delegateLive
        ? [
            {
              actor_id: DELEGATE_ID,
              actor_type: 'agent',
              actor_status: 'active',
              tenant_membership_active: true,
              project_membership_active: true,
            },
          ]
        : [];
    } else if (text.includes('platform-delegation:create')) {
      Object.assign(this.delegation, {
        delegation_id: values[0],
        delegated_by_actor_id: values[1],
        delegate_actor_id: values[2],
        tenant_id: values[3],
        project_id: values[4],
        scopes: values[5],
        purpose: values[6],
        max_security_level: values[7],
        expires_at: '2026-08-22T02:30:00.000Z',
      });
      rows = [this.delegation];
    } else if (
      text.includes('platform-delegation:get') ||
      text.includes('platform-delegation:lock')
    ) {
      const ownerMatches = this.delegation.delegated_by_actor_id === values[1];
      rows =
        this.delegation.delegation_id === values[0] &&
        ownerMatches &&
        this.delegation.tenant_id === values[2] &&
        this.delegation.project_id === values[3]
          ? [this.delegation]
          : [];
    } else if (text.includes('platform-delegation:revoke-active-credentials')) {
      if (this.activeCredentialId !== null) {
        rows = [{ credential_id: this.activeCredentialId }];
        this.activeCredentialId = null;
      }
    } else if (text.includes('platform-delegation:credential-insert')) {
      this.activeCredentialId = String(values[0]);
      rows = [
        {
          credential_id: values[0],
          delegation_id: values[1],
          expires_at: this.credentialExpiresAt,
        },
      ];
    } else if (text.includes('platform-delegation:delegation-revoke')) {
      Object.assign(this.delegation, {
        status: 'revoked',
        revoked_at: '2026-08-22T02:05:00.000Z',
        version: Number(this.delegation.version) + 1,
      });
      rows = [this.delegation];
    } else if (text.includes('platform-delegation:credential-lock')) {
      rows =
        values[0] === CREDENTIAL_ID && values[1] === USER_ID
          ? [
              {
                credential_id: CREDENTIAL_ID,
                delegation_id: DELEGATION_ID,
                credential_revoked_at:
                  this.activeCredentialId === null
                    ? '2026-08-22T02:05:00.000Z'
                    : null,
                delegated_by_actor_id: USER_ID,
                tenant_id: TENANT_ID,
                project_id: PROJECT_ID,
              },
            ]
          : [];
    } else if (text.includes('platform-delegation:credential-revoke')) {
      this.activeCredentialId = null;
    } else if (text.includes('platform-delegation:outbox-insert')) {
      const payload = JSON.parse(String(values[3])) as Readonly<
        Record<string, unknown>
      >;
      this.outbox.set(String(values[4]), payload);
    }

    return Promise.resolve({
      rows: rows as readonly Row[],
      rowCount: rows.length,
    });
  }

  release(): void {
    this.released = true;
  }
}

class FakePool implements PlatformDelegationTransactionPool {
  constructor(readonly client: FakePlatformDatabase) {}

  connect(): Promise<PlatformDelegationTransactionClient> {
    return Promise.resolve(this.client);
  }
}

function authorizationRow(
  overrides: Readonly<Record<string, unknown>> = {},
): Readonly<Record<string, unknown>> {
  return {
    tenant_id: TENANT_ID,
    project_id: PROJECT_ID,
    roles: ['platform-owner'],
    scopes: [
      'platform.delegation.manage',
      'data.catalog.read',
      'data.query.execute',
    ],
    max_security_level: 'L3_CONFIDENTIAL',
    authz_version: 8,
    ...overrides,
  };
}

function serviceWith(
  database: FakePlatformDatabase,
  ids: readonly string[] = [DELEGATION_ID, CREDENTIAL_ID],
) {
  let idIndex = 0;
  let randomValue = 1;
  return new PostgresPlatformDelegationService({
    pool: new FakePool(database),
    keyRing,
    knownScopes: new Set([
      'platform.delegation.manage',
      'data.catalog.read',
      'data.query.execute',
    ]),
    idFactory: () => ids[idIndex++] ?? ROTATED_CREDENTIAL_ID,
    randomBytes: (size) => {
      const result = Uint8Array.from({ length: size }, () => randomValue);
      randomValue += 1;
      return result;
    },
  });
}

function createInput(
  overrides: Readonly<Record<string, unknown>> = {},
): Parameters<PostgresPlatformDelegationService['createDelegation']>[0] {
  return {
    context,
    idempotencyKey: IDEMPOTENCY_KEY,
    delegateActorId: DELEGATE_ID,
    scopes: ['data.catalog.read'],
    purpose: 'operate',
    maxSecurityLevel: 'L1_INTERNAL',
    expiresInSeconds: 1_800,
    ...overrides,
  };
}

function expectErrorCode(error: unknown, code: string): void {
  expect(error).toBeInstanceOf(PlatformDelegationServiceError);
  expect((error as PlatformDelegationServiceError).code).toBe(code);
}

describe('PostgresPlatformDelegationService', () => {
  it('creates a bounded delegation after live session, membership, scope, and delegate checks', async () => {
    const database = new FakePlatformDatabase();
    const service = serviceWith(database);

    await expect(
      service.createDelegation(createInput()),
    ).resolves.toMatchObject({
      delegationId: DELEGATION_ID,
      delegatedByActorId: USER_ID,
      delegateActorId: DELEGATE_ID,
      scopes: ['data.catalog.read'],
      status: 'active',
      version: 1,
    });

    const sql = database.calls.map(({ text }) => text).join('\n');
    expect(sql).toContain('join auth.sessions as session');
    expect(sql).toContain('platform-delegation:idempotency-lock');
    expect(sql).toContain('pg_advisory_xact_lock');
    expect(sql).toContain('platform-delegation:delegate-read');
    expect(sql).toContain('platform.tenant_memberships');
    expect(sql).toContain('platform.project_memberships');
    expect(sql).toContain('platform-delegation:audit-insert');
    expect(sql).toContain('platform-delegation:outbox-insert');
    expect(database.calls[0]?.text.toLowerCase()).toBe('begin');
    expect(database.calls.at(-1)?.text.toLowerCase()).toBe('commit');
    expect(database.released).toBe(true);
  });

  it('replays safe delegation metadata and rejects a changed request hash', async () => {
    const database = new FakePlatformDatabase();
    const service = serviceWith(database);

    const first = await service.createDelegation(createInput());
    await expect(service.createDelegation(createInput())).resolves.toEqual(
      first,
    );
    expect(
      database.calls.filter(({ text }) =>
        text.includes('platform-delegation:create'),
      ),
    ).toHaveLength(1);

    await expect(
      service.createDelegation(createInput({ scopes: ['data.query.execute'] })),
    ).rejects.toSatisfy((error: unknown) => {
      expectErrorCode(error, 'IDEMPOTENCY_CONFLICT');
      return true;
    });
  });

  it.each([
    ['revoked session', []],
    ['missing manage scope', [authorizationRow({ scopes: [] })]],
    [
      'revoked current data scope',
      [authorizationRow({ scopes: ['platform.delegation.manage'] })],
    ],
    [
      'reduced current security ceiling',
      [authorizationRow({ max_security_level: 'L0_PUBLIC' })],
    ],
  ])('fails closed for %s', async (_, authorizationRows) => {
    const database = new FakePlatformDatabase({ authorizationRows });
    const service = serviceWith(database);

    await expect(service.createDelegation(createInput())).rejects.toSatisfy(
      (error: unknown) => {
        expectErrorCode(error, 'NOT_AUTHORIZED');
        return true;
      },
    );
    expect(
      database.calls.some(({ text }) => text.toLowerCase() === 'rollback'),
    ).toBe(true);
  });

  it('rejects excessive TTL and a delegate without live project membership', async () => {
    const invalidTtlDatabase = new FakePlatformDatabase();
    await expect(
      serviceWith(invalidTtlDatabase).createDelegation(
        createInput({ expiresInSeconds: 3_601 }),
      ),
    ).rejects.toSatisfy((error: unknown) => {
      expectErrorCode(error, 'VALIDATION_FAILED');
      return true;
    });

    const missingDelegateDatabase = new FakePlatformDatabase({
      delegateLive: false,
    });
    await expect(
      serviceWith(missingDelegateDatabase).createDelegation(createInput()),
    ).rejects.toSatisfy((error: unknown) => {
      expectErrorCode(error, 'NOT_AUTHORIZED');
      return true;
    });
  });

  it('issues a plaintext credential once, clips expiry in SQL, and locks concurrent writers', async () => {
    const database = new FakePlatformDatabase({
      activeCredentialId: CREDENTIAL_ID,
      credentialExpiresAt: '2026-08-22T02:15:00.000Z',
    });
    const service = serviceWith(database, [ROTATED_CREDENTIAL_ID]);
    const input = {
      context,
      idempotencyKey: IDEMPOTENCY_KEY,
      delegationId: DELEGATION_ID,
      expectedDelegationVersion: 1,
    };

    const issued = await service.issueCredential(input);

    expect(issued).toMatchObject({
      credentialId: ROTATED_CREDENTIAL_ID,
      delegationId: DELEGATION_ID,
      expiresAt: '2026-08-22T02:15:00.000Z',
    });
    expect(issued.token).toMatch(
      /^wdc1\.wdc_[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}$/,
    );
    const lockCall = database.calls.find(({ text }) =>
      text.includes('platform-delegation:lock'),
    );
    const insertCall = database.calls.find(({ text }) =>
      text.includes('platform-delegation:credential-insert'),
    );
    expect(lockCall?.text.toLowerCase()).toContain('for update');
    expect(insertCall?.text.toLowerCase()).toContain('least(');
    expect(insertCall?.text).toContain("interval '15 minutes'");
    expect(
      database.calls.some(({ text }) =>
        text.includes('platform-delegation:revoke-active-credentials'),
      ),
    ).toBe(true);

    const safeMutationCalls = database.calls.filter(
      ({ text }) =>
        text.includes('platform-delegation:audit-insert') ||
        text.includes('platform-delegation:outbox-insert'),
    );
    const serialized = JSON.stringify(safeMutationCalls);
    expect(serialized).not.toContain(issued.token);
    expect(serialized).not.toContain(
      Buffer.from(insertCall?.values[4] as Uint8Array).toString('hex'),
    );
  });

  it('returns SECRET_NOT_RECOVERABLE on issue replay and conflict on changed input', async () => {
    const database = new FakePlatformDatabase();
    const service = serviceWith(database, [CREDENTIAL_ID]);
    const input = {
      context,
      idempotencyKey: IDEMPOTENCY_KEY,
      delegationId: DELEGATION_ID,
      expectedDelegationVersion: 1,
    };
    await service.issueCredential(input);

    await expect(service.issueCredential(input)).rejects.toSatisfy(
      (error: unknown) => {
        expectErrorCode(error, 'SECRET_NOT_RECOVERABLE');
        return true;
      },
    );
    await expect(
      service.issueCredential({ ...input, expectedDelegationVersion: 2 }),
    ).rejects.toSatisfy((error: unknown) => {
      expectErrorCode(error, 'IDEMPOTENCY_CONFLICT');
      return true;
    });
  });

  it('rejects a stale expected delegation version before issuing a secret', async () => {
    const database = new FakePlatformDatabase();
    const service = serviceWith(database, [CREDENTIAL_ID]);

    await expect(
      service.issueCredential({
        context,
        idempotencyKey: SECOND_IDEMPOTENCY_KEY,
        delegationId: DELEGATION_ID,
        expectedDelegationVersion: 2,
      }),
    ).rejects.toSatisfy((error: unknown) => {
      expectErrorCode(error, 'DELEGATION_VERSION_CONFLICT');
      return true;
    });
    expect(
      database.calls.some(({ text }) =>
        text.includes('platform-delegation:credential-insert'),
      ),
    ).toBe(false);
  });

  it('clips credential expiry to an earlier delegation boundary', async () => {
    const database = new FakePlatformDatabase({
      delegationExpiresAt: '2026-08-22T02:10:00.000Z',
      credentialExpiresAt: '2026-08-22T02:10:00.000Z',
    });
    const service = serviceWith(database, [CREDENTIAL_ID]);

    await expect(
      service.issueCredential({
        context,
        idempotencyKey: SECOND_IDEMPOTENCY_KEY,
        delegationId: DELEGATION_ID,
        expectedDelegationVersion: 1,
      }),
    ).resolves.toMatchObject({
      expiresAt: '2026-08-22T02:10:00.000Z',
    });
  });

  it('rotates atomically by revoking and linking the previous credential', async () => {
    const database = new FakePlatformDatabase({
      activeCredentialId: CREDENTIAL_ID,
    });
    const service = serviceWith(database, [ROTATED_CREDENTIAL_ID]);

    await service.rotateCredential({
      context,
      idempotencyKey: IDEMPOTENCY_KEY,
      delegationId: DELEGATION_ID,
      expectedDelegationVersion: 1,
    });

    const markers = database.calls.map(
      ({ text }) => /platform-delegation:([a-z-]+)/.exec(text)?.[1],
    );
    expect(markers).toContain('revoke-active-credentials');
    expect(markers).toContain('credential-insert');
    expect(markers).toContain('rotation-link');
    expect(markers.indexOf('revoke-active-credentials')).toBeLessThan(
      markers.indexOf('credential-insert'),
    );
    expect(markers.indexOf('credential-insert')).toBeLessThan(
      markers.indexOf('rotation-link'),
    );
  });

  it('revokes delegation and credential facts idempotently without deletes', async () => {
    const database = new FakePlatformDatabase({
      activeCredentialId: CREDENTIAL_ID,
    });
    const service = serviceWith(database);

    await service.revokeDelegation({
      context,
      idempotencyKey: IDEMPOTENCY_KEY,
      delegationId: DELEGATION_ID,
      expectedDelegationVersion: 1,
    });
    await service.revokeDelegation({
      context,
      idempotencyKey: IDEMPOTENCY_KEY,
      delegationId: DELEGATION_ID,
      expectedDelegationVersion: 1,
    });
    await service.revokeCredential({
      context,
      idempotencyKey: SECOND_IDEMPOTENCY_KEY,
      credentialId: CREDENTIAL_ID,
    });

    const sql = database.calls.map(({ text }) => text).join('\n');
    expect(sql).toContain('platform-delegation:delegation-revoke');
    expect(sql).toContain('platform-delegation:credential-revoke');
    expect(sql).not.toMatch(/delete\s+from\s+platform/i);
  });

  it('rolls back credential, audit, and outbox work as one transaction', async () => {
    const database = new FakePlatformDatabase({
      failMarker: 'platform-delegation:outbox-insert',
    });
    const service = serviceWith(database, [CREDENTIAL_ID]);

    await expect(
      service.issueCredential({
        context,
        idempotencyKey: IDEMPOTENCY_KEY,
        delegationId: DELEGATION_ID,
        expectedDelegationVersion: 1,
      }),
    ).rejects.toThrow('simulated persistence failure');

    expect(
      database.calls.some(({ text }) => text.toLowerCase() === 'rollback'),
    ).toBe(true);
    expect(
      database.calls.some(({ text }) => text.toLowerCase() === 'commit'),
    ).toBe(false);
    expect(database.released).toBe(true);
  });

  it('returns no metadata when the delegation belongs to another actor', async () => {
    const database = new FakePlatformDatabase({
      delegationOwnerId: '93000000-0000-4000-8000-000000000001',
    });
    const service = serviceWith(database);

    await expect(
      service.getDelegation({ context, delegationId: DELEGATION_ID }),
    ).resolves.toBeNull();
    const getCall = database.calls.find(({ text }) =>
      text.includes('platform-delegation:get'),
    );
    expect(getCall?.values).toEqual([
      DELEGATION_ID,
      USER_ID,
      TENANT_ID,
      PROJECT_ID,
    ]);
  });
});
