import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { PlatformAgentConnectionView } from '@wiser/platform-contracts';
import { disconnectAgentConnection } from './agent-connections';

function fixture() {
  const owned: PlatformAgentConnectionView = {
    connectionId: randomUUID(),
    clientId: randomUUID(),
    delegationId: randomUUID(),
    tenantId: randomUUID(),
    projectId: randomUUID(),
    scopes: ['data.catalog.read'],
    purpose: 'agent-data',
    maxSecurityLevel: 'L1_INTERNAL',
    expiresAt: '2026-09-26T12:00:00Z',
    status: 'active',
  };
  const order: string[] = [];
  const deps = {
    list: vi.fn().mockResolvedValue([owned]),
    revokeConnection: vi.fn().mockImplementation(() => {
      order.push('connection');
      return Promise.resolve();
    }),
    revokeGrant: vi.fn().mockImplementation(() => {
      order.push('provider');
      return Promise.resolve({ error: null });
    }),
  };
  return { owned, deps, order };
}

describe('owner disconnects a bounded MCP connection and prior provider consent', () => {
  it('derives the OAuth client from freshly owned server data and stops WISER access first', async () => {
    const { owned, deps, order } = fixture();
    await expect(
      disconnectAgentConnection(deps, owned.connectionId),
    ).resolves.toBe('disconnected');
    expect(deps.list).toHaveBeenCalledOnce();
    expect(deps.revokeConnection).toHaveBeenCalledWith(owned.connectionId);
    expect(deps.revokeGrant).toHaveBeenCalledWith(owned.clientId);
    expect(order).toEqual(['connection', 'provider']);
  });
  it.each(['invalid', randomUUID()])(
    'does not mutate either authority for an invalid or foreign connection: %s',
    async (id) => {
      const { deps } = fixture();
      await expect(disconnectAgentConnection(deps, id)).rejects.toThrow(
        'not-allowed',
      );
      expect(deps.revokeConnection).not.toHaveBeenCalled();
      expect(deps.revokeGrant).not.toHaveBeenCalled();
    },
  );
  it('never clears provider consent if WISER revocation failed', async () => {
    const { deps, owned } = fixture();
    deps.revokeConnection.mockRejectedValue(
      new Error('private upstream detail'),
    );
    await expect(
      disconnectAgentConnection(deps, owned.connectionId),
    ).rejects.toThrow('unavailable');
    expect(deps.revokeGrant).not.toHaveBeenCalled();
  });
  it.each([new Error('private provider detail'), { status: 503 }])(
    'reports partial completion and safely retries a previously revoked connection',
    async (failure) => {
      const { deps, owned } = fixture();
      deps.revokeGrant.mockResolvedValueOnce({ error: failure });
      await expect(
        disconnectAgentConnection(deps, owned.connectionId),
      ).resolves.toBe('provider-pending');
      owned.status = 'revoked';
      await expect(
        disconnectAgentConnection(deps, owned.connectionId),
      ).resolves.toBe('disconnected');
      expect(deps.revokeConnection).toHaveBeenCalledTimes(2);
    },
  );
  it('reports provider transport failure after access has already been stopped', async () => {
    const { deps, owned } = fixture();
    deps.revokeGrant.mockRejectedValue(new Error('private upstream detail'));
    await expect(
      disconnectAgentConnection(deps, owned.connectionId),
    ).resolves.toBe('provider-pending');
    expect(deps.revokeConnection).toHaveBeenCalledOnce();
  });
  it('treats an already absent provider grant as disconnected', async () => {
    const { deps, owned } = fixture();
    deps.revokeGrant.mockResolvedValue({ error: { status: 404 } });
    await expect(
      disconnectAgentConnection(deps, owned.connectionId),
    ).resolves.toBe('disconnected');
  });
});
