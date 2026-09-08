import { describe, expect, it } from 'vitest';
import { isSameOriginRequest } from './request-origin';

describe('browser request origin behind a port-mapped host', () => {
  it('compares the browser origin with the public Host rather than the internal listener', () => {
    expect(
      isSameOriginRequest(
        new Request('http://localhost:3000/api/data-foundation/explore', {
          headers: {
            host: '127.0.0.1:3100',
            origin: 'http://127.0.0.1:3100',
            'sec-fetch-site': 'same-origin',
          },
        }),
      ),
    ).toBe(true);
  });
  it.each([
    { host: 'wiser.test', origin: 'https://attacker.test' },
    {
      host: 'wiser.test',
      origin: 'https://wiser.test',
      'sec-fetch-site': 'cross-site',
    },
    { host: 'wiser.test', origin: 'null' },
    { host: 'wiser.test', origin: 'file://wiser.test' },
  ])('rejects cross-origin and invalid origins %#', (headers) => {
    expect(
      isSameOriginRequest(new Request('https://wiser.test/api', { headers })),
    ).toBe(false);
  });
});
