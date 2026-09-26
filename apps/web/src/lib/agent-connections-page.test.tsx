// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
const mocks = vi.hoisted(() => ({
  viewer: vi.fn(),
  account: vi.fn(),
  load: vi.fn(),
}));
vi.mock('next/server', () => ({ connection: () => Promise.resolve() }));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NOT_FOUND');
  },
  redirect: (url: string) => {
    throw new Error(url);
  },
}));
vi.mock('@/lib/auth', () => ({ readVerifiedAuthViewer: mocks.viewer }));
vi.mock('@/lib/supabase/server', () => ({
  createWiserServerSupabaseClient: () => Promise.resolve({}),
}));
vi.mock('@/lib/agent-connections.server', () => ({
  getAgentConnectionAccount: mocks.account,
}));
import Page, { metadata } from '../app/[locale]/account/agents/page';
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
function props(locale = 'zh-CN', result?: string) {
  return {
    params: Promise.resolve({ locale }),
    searchParams: Promise.resolve({ result }),
  };
}
it('requires a verified login before reading owned connections', async () => {
  mocks.viewer.mockResolvedValue(null);
  await expect(Page(props())).rejects.toThrow(
    '/zh-CN/login?next=%2Fzh-CN%2Faccount%2Fagents',
  );
  expect(mocks.account).not.toHaveBeenCalled();
});
it('does not turn an unavailable ownership service into an empty list', async () => {
  mocks.viewer.mockResolvedValue({ userId: 'owner' });
  mocks.account.mockRejectedValue(new Error('private-token-upstream'));
  render(await Page(props()));
  expect(screen.getByRole('alert').textContent).toContain('暂时无法');
  expect(screen.queryByText('private-token-upstream')).toBeNull();
  expect(screen.queryByRole('button')).toBeNull();
});
it('retains a retry for partial provider revocation and treats client names as text', async () => {
  mocks.viewer.mockResolvedValue({ userId: 'owner' });
  mocks.account.mockResolvedValue({ load: mocks.load });
  mocks.load.mockResolvedValue([
    {
      connectionId: 'owned',
      clientName: '<a href="https://outside.test">client</a>',
      projectName: null,
      expiresAt: '2026-09-26T10:00:00Z',
      status: 'revoked',
      providerConsent: true,
    },
  ]);
  render(await Page(props('en', 'provider-pending')));
  expect(screen.getByRole('alert').textContent).toContain('Access has stopped');
  expect(
    screen.getByRole('button', { name: 'Finish disconnecting' }),
  ).toBeDefined();
  expect(screen.getByRole('heading', { level: 2 }).textContent).toContain(
    '<a href=',
  );
  expect(document.querySelector('a[href="https://outside.test"]')).toBeNull();
  expect(document.querySelector('input[name="clientId"]')).toBeNull();
  expect(metadata.referrer).toBe('same-origin');
});
it('shows the disconnect action only while either access or saved consent remains', async () => {
  mocks.viewer.mockResolvedValue({ userId: 'owner' });
  mocks.account.mockResolvedValue({ load: mocks.load });
  const base = {
    clientName: null,
    projectName: { 'zh-CN': '河流项目', en: 'River project' },
    expiresAt: '2026-09-26T10:00:00Z',
    providerConsent: false,
  };
  mocks.load.mockResolvedValue([
    { ...base, connectionId: 'active', status: 'active' },
    { ...base, connectionId: 'revoked', status: 'revoked' },
  ]);
  render(await Page(props('zh-CN', 'disconnected')));
  expect(screen.getAllByRole('button', { name: '断开连接' })).toHaveLength(1);
  expect(screen.getByRole('status').textContent).toContain('连接已断开');
});
