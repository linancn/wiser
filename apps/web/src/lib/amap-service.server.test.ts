import { expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { amapService } from './amap-service.server';

const options = {
  key: 'public-key',
  securityCode: 'server-secret',
  verifySession: () => Promise.resolve(true),
};

it('serves validated SDK JSONP as executable JavaScript under nosniff', async () => {
  const response = await amapService(
    new Request(
      'https://wiser.test/api/maps/amap/v3/assistant/coordinate/convert?callback=jsonp_123',
    ),
    ['v3', 'assistant', 'coordinate', 'convert'],
    {
      ...options,
      fetch: () =>
        Promise.resolve(
          new Response('jsonp_123({"status":"1"})', {
            headers: { 'content-type': 'application/json' },
          }),
        ),
    },
  );
  expect(response.headers.get('content-type')).toBe(
    'application/javascript; charset=utf-8',
  );
  expect(await response.text()).toBe('jsonp_123({"status":"1"});');
});

it('requires a verified session and never returns the security code in configuration', async () => {
  const request = new Request('https://wiser.test/api/maps/amap/config');
  const response = await amapService(request, ['config'], options);
  expect(await response.json()).toEqual({
    key: 'public-key',
    serviceHost: '/api/maps/amap',
    version: '2.0',
  });
  const denied = await amapService(request, ['config'], {
    ...options,
    verifySession: () => Promise.resolve(false),
  });
  expect(denied.status).toBe(401);
  expect(response.headers.get('cache-control')).toContain('no-store');
});

it('allows only official map endpoints, injects credentials on the server and strips upstream cookies', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(() =>
    Promise.resolve(
      new Response('{"status":"1"}', {
        headers: {
          'content-type': 'application/json',
          'set-cookie': 'upstream=private',
        },
      }),
    ),
  );
  const request = new Request(
    'https://wiser.test/api/maps/amap/v3/assistant/coordinate/convert?locations=116,40&coordsys=gps&jscode=attacker&key=attacker',
  );
  const response = await amapService(
    request,
    ['v3', 'assistant', 'coordinate', 'convert'],
    { ...options, fetch },
  );
  expect(response.status).toBe(200);
  expect(response.headers.get('set-cookie')).toBeNull();
  const target = fetch.mock.calls[0][0] as URL;
  expect(target.origin).toBe('https://restapi.amap.com');
  expect(target.searchParams.get('jscode')).toBe('server-secret');
  expect(target.searchParams.get('key')).toBe('public-key');
  for (const path of [
    ['v3', 'place', 'text'],
    ['..', 'secret'],
    ['https:', 'evil.test'],
  ]) {
    expect(
      (await amapService(request, path, { ...options, fetch })).status,
    ).toBe(404);
  }
  expect(fetch).toHaveBeenCalledOnce();
});
