import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

import {
  isPublicWiserPath,
  loadWebSupabaseConfig,
  updateSupabaseSession,
  type SupabaseServerClientFactory,
} from './proxy';

describe('WISER Web Supabase SSR proxy', () => {
  it('keeps only locale portals and authentication transports public', () => {
    for (const path of [
      '/',
      '/zh-CN',
      '/en',
      '/zh-CN/login',
      '/en/auth/callback',
      '/zh-CN/auth/login',
    ]) {
      expect(isPublicWiserPath(path), path).toBe(true);
    }
    for (const path of [
      '/zh-CN/scenarios',
      '/en/runs/run-1',
      '/zh-CN/data-foundation/catalog',
    ]) {
      expect(isPublicWiserPath(path), path).toBe(false);
    }
  });

  it('requires browser-safe Supabase configuration in production', () => {
    expect(() => loadWebSupabaseConfig({ NODE_ENV: 'production' })).toThrow(
      'NEXT_PUBLIC_SUPABASE_URL',
    );
  });

  it('uses the server-only internal Supabase origin without changing the browser origin', () => {
    expect(
      loadWebSupabaseConfig({
        NODE_ENV: 'development',
        WISER_AUTH_MODE: 'supabase',
        SUPABASE_URL: 'http://host.docker.internal:56321',
        NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:56321',
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
          'publishable-test-key-long-enough',
      }),
    ).toEqual({
      supabaseUrl: 'http://host.docker.internal:56321',
      supabasePublishableKey: 'publishable-test-key-long-enough',
    });
  });

  it('refreshes verified claims and propagates updated cookies', async () => {
    const getClaims = vi.fn(() =>
      Promise.resolve({
        data: {
          claims: {
            exp: 4_102_444_800,
            role: 'authenticated',
            session_id: '22222222-2222-4222-8222-222222222222',
            sub: '11111111-1111-4111-8111-111111111111',
          },
        },
        error: null,
      }),
    );
    const createClientImplementation: SupabaseServerClientFactory = (
      _url,
      _key,
      options,
    ) => ({
      auth: {
        async getClaims() {
          await options.cookies.setAll(
            [
              {
                name: 'sb-wiser-auth-token',
                value: 'refreshed-cookie',
                options: { httpOnly: true, sameSite: 'lax' },
              },
            ],
            {
              'Cache-Control':
                'private, no-cache, no-store, must-revalidate, max-age=0',
              Expires: '0',
              Pragma: 'no-cache',
            },
          );
          return getClaims();
        },
      },
    });
    const createClient = vi.fn(createClientImplementation);
    const request = new NextRequest('http://localhost/zh-CN/data-foundation', {
      headers: { cookie: 'sb-wiser-auth-token=old-cookie' },
    });

    const response = await updateSupabaseSession(request, {
      config: {
        supabaseUrl: 'http://127.0.0.1:56321',
        supabasePublishableKey: 'publishable-test-key-long-enough',
      },
      createClient,
    });

    expect(getClaims).toHaveBeenCalledOnce();
    expect(response.cookies.get('sb-wiser-auth-token')?.value).toBe(
      'refreshed-cookie',
    );
    expect(request.cookies.get('sb-wiser-auth-token')?.value).toBe(
      'refreshed-cookie',
    );
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(response.headers.get('pragma')).toBe('no-cache');
  });

  it('redirects an anonymous protected route to localized sign-in without losing refreshed cookies', async () => {
    const createClient: SupabaseServerClientFactory = (
      _url,
      _key,
      options,
    ) => ({
      auth: {
        async getClaims() {
          await options.cookies.setAll(
            [
              {
                name: 'sb-wiser-auth-token',
                value: 'anonymous-refresh',
                options: { httpOnly: true, sameSite: 'lax' },
              },
            ],
            {},
          );
          return { data: { claims: null }, error: null };
        },
      },
    });
    const request = new NextRequest('http://localhost/en/runs');

    const response = await updateSupabaseSession(request, {
      config: {
        supabaseUrl: 'http://127.0.0.1:56321',
        supabasePublishableKey: 'publishable-test-key-long-enough',
      },
      createClient,
    });

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(
      'http://localhost/en/login?next=%2Fen%2Fruns',
    );
    expect(response.cookies.get('sb-wiser-auth-token')?.value).toBe(
      'anonymous-refresh',
    );
    expect(response.headers.get('cache-control')).toContain('no-store');
  });

  it('returns an unchanged response when local compatibility leaves Auth off', async () => {
    const request = new NextRequest('http://localhost/zh-CN/scenarios');
    const createClient: SupabaseServerClientFactory = vi.fn();

    const response = await updateSupabaseSession(request, {
      config: null,
      createClient,
    });

    expect(response.status).toBe(200);
    expect(createClient).not.toHaveBeenCalled();
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(response.headers.get('pragma')).toBe('no-cache');
  });
});
