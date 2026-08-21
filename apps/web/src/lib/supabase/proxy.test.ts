import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

import {
  loadWebSupabaseConfig,
  updateSupabaseSession,
  type SupabaseServerClientFactory,
} from './proxy';

describe('WISER Web Supabase SSR proxy', () => {
  it('requires browser-safe Supabase configuration in production', () => {
    expect(() => loadWebSupabaseConfig({ NODE_ENV: 'production' })).toThrow(
      'NEXT_PUBLIC_SUPABASE_URL',
    );
  });

  it('refreshes verified claims and propagates updated cookies', async () => {
    const getClaims = vi.fn(() => Promise.resolve({ data: {}, error: null }));
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

  it('returns an unchanged response when local compatibility leaves Auth off', async () => {
    const request = new NextRequest('http://localhost/zh-CN/scenarios');
    const createClient: SupabaseServerClientFactory = vi.fn();

    const response = await updateSupabaseSession(request, {
      config: null,
      createClient,
    });

    expect(response.status).toBe(200);
    expect(createClient).not.toHaveBeenCalled();
  });
});
