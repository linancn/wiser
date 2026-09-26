import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  token: vi.fn(),
  request: vi.fn(),
  projects: vi.fn(),
  grants: vi.fn(),
  revoke: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('./supabase/server', () => ({
  createWiserServerSupabaseClient: mocks.createClient,
}));
vi.mock('./supabase/verified-session', () => ({
  verifiedSessionAccessToken: mocks.token,
}));
vi.mock('./agent-consent.server', () => ({
  agentPlatformRequest: mocks.request,
}));
vi.mock('./project-access.server', () => ({
  getProjectAccessClient: () => ({ projects: mocks.projects }),
}));
import { getAgentConnectionAccount } from './agent-connections.server';
const owned = {
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
beforeEach(() => {
  mocks.createClient.mockResolvedValue({
    auth: { oauth: { listGrants: mocks.grants, revokeGrant: mocks.revoke } },
  });
  mocks.token.mockResolvedValue('fresh-owner-session');
  mocks.request.mockResolvedValue({ connections: [owned] });
  mocks.grants.mockResolvedValue({
    data: [{ client: { id: owned.clientId, name: 'Client' } }],
    error: null,
  });
  mocks.revoke.mockResolvedValue({ error: null });
  mocks.projects.mockResolvedValue({
    items: [{ projectId: owned.projectId, nameZh: '河流', nameEn: 'River' }],
    hasMore: false,
  });
});
afterEach(() => vi.resetAllMocks());
it('never reads or revokes when the live user session cannot be verified', async () => {
  mocks.token.mockRejectedValue(new Error('invalid session'));
  await expect(getAgentConnectionAccount()).rejects.toThrow('invalid session');
  expect(mocks.request).not.toHaveBeenCalled();
  expect(mocks.revoke).not.toHaveBeenCalled();
});
it('allows disconnection after project visibility is lost and derives the provider client server-side', async () => {
  mocks.projects.mockRejectedValue(new Error('membership removed'));
  const account = await getAgentConnectionAccount();
  expect(await account.load()).toMatchObject([
    { clientName: 'Client', projectName: null, providerConsent: true },
  ]);
  expect(await account.disconnect(owned.connectionId)).toBe('disconnected');
  expect(mocks.request).toHaveBeenLastCalledWith(
    `/api/platform/v1/agent-connections/${owned.connectionId}/revoke`,
    'fresh-owner-session',
    'POST',
    {},
    expect.any(String),
  );
  expect(mocks.revoke).toHaveBeenCalledWith({ clientId: owned.clientId });
});
it('preserves project labels without returning auth tokens and does not hide provider failure', async () => {
  const account = await getAgentConnectionAccount();
  const view = await account.load();
  expect(view[0]?.projectName).toEqual({ 'zh-CN': '河流', en: 'River' });
  expect(JSON.stringify(view)).not.toContain('fresh-owner-session');
  mocks.grants.mockResolvedValue({ data: null, error: new Error('private') });
  await expect(account.load()).rejects.toThrow('unavailable');
});
