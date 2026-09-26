import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ account: vi.fn(), disconnect: vi.fn() }));
vi.mock('@/lib/agent-connections.server', () => ({
  getAgentConnectionAccount: mocks.account,
}));
import { POST } from '../app/[locale]/account/agents/disconnect/route';
const origin = 'https://wiser.test:7100';
const context = { params: Promise.resolve({ locale: 'zh-CN' }) };
function request(body: string, source: string | null = origin) {
  return new Request(origin + '/zh-CN/account/agents/disconnect', {
    method: 'POST',
    headers: {
      ...(source === null ? {} : { Origin: source }),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });
}
beforeEach(() => {
  vi.stubEnv('WISER_PUBLIC_WEB_ORIGIN', origin);
  mocks.account.mockResolvedValue({ disconnect: mocks.disconnect });
  mocks.disconnect.mockResolvedValue('disconnected');
});
afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllEnvs();
});
it('rejects an invalid connection before looking up a session or making a mutation', async () => {
  const response = await POST(request('connectionId=bad'), context);
  expect(response.headers.get('Location')).toBe(
    '/zh-CN/account/agents?result=unavailable',
  );
  expect(mocks.account).not.toHaveBeenCalled();
});
it.each([null, 'null', 'https://outside.test'])(
  'rejects a missing or foreign Origin: %s',
  async (source) => {
    expect(
      (await POST(request('connectionId=' + randomUUID(), source), context))
        .status,
    ).toBe(403);
    expect(mocks.account).not.toHaveBeenCalled();
  },
);
it.each(['connectionId=x&connectionId=y', 'connectionId=x&clientId=spoofed'])(
  'does not accept duplicate identifiers or a browser-supplied client: %s',
  async (body) => {
    expect(
      (await POST(request(body), context)).headers.get('Location'),
    ).toContain('result=unavailable');
    expect(mocks.account).not.toHaveBeenCalled();
  },
);
it('bounds an actual body even without Content-Length', async () => {
  expect(
    (await POST(request('connectionId=' + 'x'.repeat(1024)), context)).status,
  ).toBe(413);
  expect(mocks.account).not.toHaveBeenCalled();
});
it('returns the partial outcome without leaking credentials or provider errors', async () => {
  const id = randomUUID();
  mocks.disconnect.mockResolvedValue('provider-pending');
  const response = await POST(request('connectionId=' + id), context);
  expect(response.status).toBe(303);
  expect(response.headers.get('Location')).toBe(
    '/zh-CN/account/agents?result=provider-pending',
  );
  expect(response.headers.get('Cache-Control')).toContain('no-store');
  expect(mocks.disconnect).toHaveBeenCalledWith(id);
});
