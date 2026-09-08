import { describe, expect, it } from 'vitest';

import {
  PostgresAgentConnectionService,
  type PlatformDelegationTransactionClient,
} from '../src/index.js';

const owner = '10000000-0000-4000-8000-000000000005';
const session = '10000000-0000-4000-8000-000000000006';
const connection = {
  connection_id: '10000000-0000-4000-8000-000000000007',
  oauth_client_id: '10000000-0000-4000-8000-000000000008',
  delegation_id: '10000000-0000-4000-8000-000000000009',
  tenant_id: 'b1000000-0000-4000-8000-000000000001',
  project_id: 'b2000000-0000-4000-8000-000000000001',
  scopes: ['data.catalog.read'],
  max_security_level: 'L1_INTERNAL',
  expires_at: new Date('2026-09-08T12:00:00.000Z'),
  status: 'active',
  token_hmac: 'private persistence material',
};

class QueryFixture implements PlatformDelegationTransactionClient {
  readonly results: unknown[][] = [];
  readonly bindings: (readonly unknown[])[] = [];
  readonly completedTransactions: string[] = [];
  released = false;

  query<Row>(sql: string, values: readonly unknown[] = []) {
    if (['begin', 'commit', 'rollback'].includes(sql)) {
      if (sql !== 'begin') this.completedTransactions.push(sql);
      return Promise.resolve({ rows: [] as Row[] });
    }
    this.bindings.push(values);
    const rows = this.results.shift();
    if (rows === undefined) throw new Error('Unexpected persistence access.');
    return Promise.resolve({ rows: rows as Row[] });
  }

  release() {
    this.released = true;
  }
}

function service(client: QueryFixture, authenticated = true) {
  return new PostgresAgentConnectionService({
    pool: { connect: () => Promise.resolve(client) },
    resource: 'https://mcp.example.test/mcp',
    keyRing: {
      activeKeyId: 'test',
      keys: new Map([['test', new Uint8Array(32).fill(9)]]),
    },
    knownScopes: new Set(['data.catalog.read']),
    verifyHuman: () =>
      Promise.resolve(
        authenticated ? { userId: owner, sessionId: session } : null,
      ),
    verifyAgent: () => Promise.resolve(null),
  });
}

describe('Agent connection identity and safe views', () => {
  it('lists connection metadata for the verified owner without persistence secrets', async () => {
    const client = new QueryFixture();
    client.results.push([{ id: owner }], [connection]);
    const result = await service(client).list({ token: 'human-fixture' });
    expect(result).toEqual([
      {
        connectionId: connection.connection_id,
        clientId: connection.oauth_client_id,
        delegationId: connection.delegation_id,
        tenantId: connection.tenant_id,
        projectId: connection.project_id,
        scopes: ['data.catalog.read'],
        purpose: 'agent-data',
        maxSecurityLevel: 'L1_INTERNAL',
        expiresAt: '2026-09-08T12:00:00.000Z',
        status: 'active',
      },
    ]);
    expect(client.bindings).toEqual([[owner, session], [owner]]);
    expect(JSON.stringify(result)).not.toContain(connection.token_hmac);
    expect(client.completedTransactions).toEqual(['commit']);
    expect(client.released).toBe(true);
  });

  it('rechecks the live Session even when the same JWT was valid for an earlier read', async () => {
    const client = new QueryFixture();
    const connections = service(client);
    client.results.push([{ id: owner }], [], []);
    await expect(connections.list({ token: 'human-fixture' })).resolves.toEqual(
      [],
    );
    await expect(
      connections.list({ token: 'human-fixture' }),
    ).rejects.toMatchObject({ code: 'NOT_AUTHENTICATED' });
    expect(client.completedTransactions).toEqual(['commit', 'rollback']);
    expect(client.released).toBe(true);
  });

  it('rejects an unverifiable human or Agent before accessing persistence', async () => {
    const client = new QueryFixture();
    const connections = service(client, false);
    await expect(connections.list({ token: 'invalid' })).rejects.toMatchObject({
      code: 'NOT_AUTHENTICATED',
    });
    await expect(
      connections.exchange({
        token: 'invalid',
        idempotencyKey: connection.connection_id,
      }),
    ).rejects.toMatchObject({ code: 'NOT_AUTHENTICATED' });
    expect(client.bindings).toEqual([]);
  });

  it('does not expose an unavailable or differently owned OAuth authorization', async () => {
    const client = new QueryFixture();
    client.results.push([{ id: owner }], []);
    await expect(
      service(client).inspect({
        token: 'human-fixture',
        authorizationId: connection.connection_id,
      }),
    ).rejects.toMatchObject({ code: 'NOT_AUTHORIZED' });
    expect(client.completedTransactions).toEqual(['rollback']);
    expect(client.released).toBe(true);
  });

  it('rolls back malformed persisted views instead of returning unchecked metadata', async () => {
    const client = new QueryFixture();
    client.results.push(
      [{ id: owner }],
      [{ ...connection, max_security_level: 'unknown' }],
    );
    await expect(
      service(client).list({ token: 'human-fixture' }),
    ).rejects.toThrow();
    expect(client.completedTransactions).toEqual(['rollback']);
    expect(client.released).toBe(true);
  });
});
