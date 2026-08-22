import { describe, expect, it, vi } from 'vitest';

import {
  createAuthRouteService,
  readVerifiedAuthViewer,
  safeLocalizedRedirect,
  type WiserWebAuthClient,
} from './auth';

const USER_ID = 'd1000000-0000-4000-8000-000000000001';
const SESSION_ID = 'd1000000-0000-4000-8000-000000000002';
const FUTURE_EXPIRY = 1_800_000_000;
const NOW = () => new Date('2026-08-22T00:00:00.000Z');

function verifiedClaims(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    data: {
      claims: {
        sub: USER_ID,
        session_id: SESSION_ID,
        role: 'authenticated',
        exp: FUTURE_EXPIRY,
        email: 'operator@wiser.test',
        user_metadata: { display_name: 'Untrusted administrator' },
        ...overrides,
      },
    },
    error: null,
  };
}

function authClient(
  overrides: Partial<WiserWebAuthClient['auth']> = {},
): WiserWebAuthClient {
  return {
    auth: {
      signInWithPassword: vi.fn(() =>
        Promise.resolve({ data: {}, error: null }),
      ),
      exchangeCodeForSession: vi.fn(() =>
        Promise.resolve({ data: {}, error: null }),
      ),
      getClaims: vi.fn(() => Promise.resolve(verifiedClaims())),
      signOut: vi.fn(() => Promise.resolve({ error: null })),
      ...overrides,
    },
  };
}

function formRequest(path: string, values: Readonly<Record<string, string>>) {
  const body = new FormData();
  for (const [name, value] of Object.entries(values)) body.set(name, value);
  return new Request(`http://wiser.test${path}`, {
    method: 'POST',
    body,
  });
}

describe('WISER Web auth boundary', () => {
  it('allows only normalized same-locale application redirects', () => {
    expect(safeLocalizedRedirect(undefined, 'zh-CN')).toBe('/zh-CN');
    expect(
      safeLocalizedRedirect('/zh-CN/runs/run-42?panel=trace#latest', 'zh-CN'),
    ).toBe('/zh-CN/runs/run-42?panel=trace#latest');
    expect(safeLocalizedRedirect('/en/data-foundation', 'en')).toBe(
      '/en/data-foundation',
    );

    for (const unsafe of [
      'https://attacker.test/zh-CN/runs',
      '//attacker.test/zh-CN/runs',
      '/\\attacker.test/zh-CN/runs',
      '/en/runs',
      '/zh-CN/auth/callback?code=secret',
      '/zh-CN/auth/sign-out',
      '/zh-CN/login',
      '/zh-CN/%2e%2e/en/runs',
    ]) {
      expect(safeLocalizedRedirect(unsafe, 'zh-CN')).toBe('/zh-CN');
    }
  });

  it('projects only verified authenticated claims into shell state', async () => {
    const viewer = await readVerifiedAuthViewer(authClient(), { now: NOW });

    expect(viewer).toEqual({
      userId: USER_ID,
      sessionId: SESSION_ID,
      email: 'operator@wiser.test',
    });
    expect(JSON.stringify(viewer)).not.toContain('Untrusted administrator');
  });

  it('fails closed for expired, privileged, malformed, or rejected claims', async () => {
    for (const result of [
      verifiedClaims({ exp: 1 }),
      verifiedClaims({ role: 'service_role' }),
      verifiedClaims({ session_id: 'not-a-uuid' }),
      { data: null, error: new Error('invalid JWT') },
    ]) {
      const client = authClient({
        getClaims: vi.fn(() => Promise.resolve(result)),
      });
      await expect(
        readVerifiedAuthViewer(client, { now: NOW }),
      ).resolves.toBeNull();
    }

    const unavailable = authClient({
      getClaims: vi.fn(() => Promise.reject(new Error('auth unavailable'))),
    });
    await expect(
      readVerifiedAuthViewer(unavailable, { now: NOW }),
    ).resolves.toBeNull();
  });
});

describe('WISER auth HTTP workflows', () => {
  it('signs in with validated credentials, verifies claims, and never caches the redirect', async () => {
    const signInWithPassword = vi.fn(() =>
      Promise.resolve({ data: {}, error: null }),
    );
    const getClaims = vi.fn(() => Promise.resolve(verifiedClaims()));
    const client = authClient({ signInWithPassword, getClaims });
    const service = createAuthRouteService({
      createClient: () => Promise.resolve(client),
      now: NOW,
    });
    const response = await service.login(
      formRequest('/zh-CN/auth/login', {
        email: ' operator@wiser.test ',
        password: 'correct horse battery staple',
        next: '/zh-CN/data-foundation?view=catalog',
      }),
      'zh-CN',
    );

    expect(signInWithPassword).toHaveBeenCalledWith({
      email: 'operator@wiser.test',
      password: 'correct horse battery staple',
    });
    expect(getClaims).toHaveBeenCalledOnce();
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(
      'http://wiser.test/zh-CN/data-foundation?view=catalog',
    );
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(response.headers.get('pragma')).toBe('no-cache');
    expect(response.headers.get('expires')).toBe('0');
  });

  it('clears an unverifiable password session and returns a stable localized error', async () => {
    const signOut = vi.fn(() => Promise.resolve({ error: null }));
    const client = authClient({
      getClaims: vi.fn(() =>
        Promise.resolve(verifiedClaims({ role: 'service_role' })),
      ),
      signOut,
    });
    const service = createAuthRouteService({
      createClient: () => Promise.resolve(client),
      now: NOW,
    });
    const response = await service.login(
      formRequest('/zh-CN/auth/login', {
        email: 'operator@wiser.test',
        password: 'correct horse battery staple',
        next: 'https://attacker.test/steal',
      }),
      'zh-CN',
    );

    expect(signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(
      'http://wiser.test/zh-CN/login?reason=session',
    );
  });

  it('exchanges a callback code and rejects external continuation targets', async () => {
    const exchangeCodeForSession = vi.fn(() =>
      Promise.resolve({ data: {}, error: null }),
    );
    const getClaims = vi.fn(() => Promise.resolve(verifiedClaims()));
    const client = authClient({ exchangeCodeForSession, getClaims });
    const service = createAuthRouteService({
      createClient: () => Promise.resolve(client),
      now: NOW,
    });
    const response = await service.callback(
      new Request(
        'http://wiser.test/en/auth/callback?code=pkce-code&next=https%3A%2F%2Fattacker.test%2Fsteal',
      ),
      'en',
    );

    expect(exchangeCodeForSession).toHaveBeenCalledWith('pkce-code');
    expect(getClaims).toHaveBeenCalledOnce();
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('http://wiser.test/en');
    expect(response.headers.get('cache-control')).toContain('no-store');
  });

  it('fails closed when Auth is unavailable and signs out locally through POST', async () => {
    const disabled = createAuthRouteService({
      createClient: () => Promise.resolve(null),
      now: NOW,
    });
    const unavailable = await disabled.login(
      formRequest('/en/auth/login', {
        email: 'operator@wiser.test',
        password: 'correct horse battery staple',
      }),
      'en',
    );
    expect(unavailable.headers.get('location')).toBe(
      'http://wiser.test/en/login?reason=configuration',
    );

    const signOut = vi.fn(() => Promise.resolve({ error: null }));
    const client = authClient({ signOut });
    const enabled = createAuthRouteService({
      createClient: () => Promise.resolve(client),
      now: NOW,
    });
    const signedOut = await enabled.signOut(
      formRequest('/en/auth/sign-out', { next: '/en/login?signedOut=1' }),
      'en',
    );
    expect(signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(signedOut.status).toBe(303);
    expect(signedOut.headers.get('location')).toBe(
      'http://wiser.test/en/login?signedOut=1',
    );
    expect(signedOut.headers.get('cache-control')).toContain('no-store');
  });
});
