// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  document.head.innerHTML = '';
});

it('loads one official SDK script with the server proxy and retries a failed load', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve(
        Response.json({
          key: 'public-key',
          serviceHost: '/_AMapService',
          version: '2.0',
        }),
      ),
    ),
  );
  const { loadAmap } = await import('./amap-loader');
  const first = loadAmap();
  const failure = expect(first).rejects.toThrow();
  await vi.waitFor(() => expect(document.querySelector('script')).toBeTruthy());
  const script = document.querySelector('script')!;
  expect(new URL(script.src).origin).toBe('https://webapi.amap.com');
  expect(window._AMapSecurityConfig).toEqual({
    serviceHost: `${window.location.origin}/_AMapService`,
  });
  expect(script.src).not.toContain('security');
  expect(loadAmap()).toBe(first);
  script.dispatchEvent(new Event('error'));
  await failure;
  expect(document.querySelector('script')).toBeNull();
  const retry = loadAmap();
  const retryFailure = expect(retry).rejects.toThrow();
  await vi.waitFor(() => expect(document.querySelector('script')).toBeTruthy());
  document.querySelector('script')!.dispatchEvent(new Event('error'));
  await retryFailure;
});
