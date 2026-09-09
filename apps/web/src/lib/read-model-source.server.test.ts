import { afterEach, describe, expect, it, vi } from 'vitest';

const { connection, createClient } = vi.hoisted(() => ({
  connection: vi.fn(() => Promise.resolve()),
  createClient: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('next/server', () => ({ connection }));
vi.mock('./supabase/server', () => ({
  createWiserServerSupabaseClient: createClient,
}));

const originalMode = process.env.AGENT_EXCON_WEB_DATA_MODE;
const originalOrigin = process.env.AGENT_EXCON_API_INTERNAL_URL;
const originalToken = process.env.WISER_WEB_OPERATOR_TOKEN;

function restoreEnvironment(
  key:
    | 'AGENT_EXCON_WEB_DATA_MODE'
    | 'AGENT_EXCON_API_INTERNAL_URL'
    | 'WISER_WEB_OPERATOR_TOKEN',
  value: string | undefined,
) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

afterEach(() => {
  restoreEnvironment('AGENT_EXCON_WEB_DATA_MODE', originalMode);
  restoreEnvironment('AGENT_EXCON_API_INTERNAL_URL', originalOrigin);
  restoreEnvironment('WISER_WEB_OPERATOR_TOKEN', originalToken);
  connection.mockClear();
  createClient.mockReset();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('server read-model selection', () => {
  const claims = {
    sub: '33333333-3333-4333-8333-333333333333',
    session_id: '44444444-4444-4444-8444-444444444444',
    role: 'authenticated',
    exp: 4_102_444_800,
  };
  const tokenFor = (value: object) =>
    `header.${Buffer.from(JSON.stringify(value)).toString('base64url')}.signature`;

  function liveSession(verified: unknown, token: string) {
    vi.stubEnv('WISER_AUTH_MODE', 'supabase');
    vi.stubEnv('AGENT_EXCON_WEB_DATA_MODE', 'live');
    vi.stubEnv('AGENT_EXCON_API_INTERNAL_URL', 'http://api:3001');
    vi.stubEnv('WISER_WEB_OPERATOR_TOKEN', 'obsolete-service-identity');
    createClient.mockResolvedValue({
      auth: {
        getClaims: vi
          .fn()
          .mockResolvedValue({ data: { claims: verified }, error: null }),
        getSession: vi.fn().mockResolvedValue({
          data: { session: { access_token: token } },
          error: null,
        }),
      },
    });
  }

  it('forwards the verified current user to protected EXCON reads', async () => {
    liveSession(claims, tokenFor(claims));
    const fetcher = vi.fn((_url: unknown, init?: RequestInit) => {
      if (new Headers(init?.headers).has('authorization')) {
        expect(new Headers(init?.headers).get('authorization')).toBe(
          `Bearer ${tokenFor(claims)}`,
        );
      }
      return Promise.resolve(Response.json({ items: [] }));
    });
    vi.stubGlobal('fetch', fetcher);
    const { getWebReadModelSource } =
      await import('./read-model-source.server');
    await expect(
      (await getWebReadModelSource()).readRunCatalog(),
    ).resolves.toMatchObject({ status: 'ready' });
    expect(createClient).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledWith(
      'http://api:3001/api/v2/runs',
      expect.objectContaining({
        headers: { authorization: `Bearer ${tokenFor(claims)}` },
      }),
    );
  });

  it.each([
    ['expired claims', { ...claims, exp: 1 }, tokenFor(claims)],
    [
      'privileged claims',
      { ...claims, role: 'service_role' },
      tokenFor(claims),
    ],
    [
      'different session',
      claims,
      tokenFor({ ...claims, session_id: claims.sub }),
    ],
    ['unverified claims', null, tokenFor(claims)],
  ])(
    'rejects %s without falling back to the operator credential',
    async (_name, verified, token) => {
      liveSession(verified, token);
      const fetcher = vi.fn().mockResolvedValue(Response.json({ items: [] }));
      vi.stubGlobal('fetch', fetcher);
      const { getWebReadModelSource } =
        await import('./read-model-source.server');
      await expect(
        (await getWebReadModelSource()).readRunCatalog(),
      ).resolves.toMatchObject({ status: 'unavailable' });
      expect(fetcher).not.toHaveBeenCalled();
    },
  );

  it('waits for a request before reading runtime live-mode configuration', async () => {
    process.env.AGENT_EXCON_WEB_DATA_MODE = 'reference';
    vi.resetModules();
    const module = await import('./read-model-source.server');

    process.env.AGENT_EXCON_WEB_DATA_MODE = 'live';
    process.env.AGENT_EXCON_API_INTERNAL_URL = 'http://api:3001';
    process.env.WISER_WEB_OPERATOR_TOKEN = 'operator-secret';

    await expect(module.getWebDataMode()).resolves.toBe('live');
    await expect(module.getWebReadModelSource()).resolves.toMatchObject({
      mode: 'live',
    });
    expect(connection).toHaveBeenCalledTimes(2);
  });
});
