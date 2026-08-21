import { describe, expect, it, vi } from 'vitest';

import {
  PlatformCredentialPrincipalResolver,
  type ResolveSupabasePrincipalInput,
} from '../src/index.js';

const input: ResolveSupabasePrincipalInput = {
  token: 'header.payload.signature',
  tenantId: 'a1000000-0000-4000-8000-000000000001',
  projectId: 'a1000000-0000-4000-8000-000000000002',
  purpose: 'operate',
  traceId: 'a'.repeat(32),
};

describe('platform credential resolver routing', () => {
  it('routes JWT and delegated envelopes to exactly one verifier', async () => {
    const jwtResolve = vi.fn(() => Promise.resolve(null));
    const delegatedResolve = vi.fn(() => Promise.resolve(null));
    const resolver = new PlatformCredentialPrincipalResolver({
      jwt: { resolve: jwtResolve },
      delegated: { resolve: delegatedResolve },
    });

    await resolver.resolve(input);
    await resolver.resolve({
      ...input,
      token: `wdc1.wdc_${'A'.repeat(22)}.${'B'.repeat(43)}`,
    });

    expect(jwtResolve).toHaveBeenCalledTimes(1);
    expect(jwtResolve).toHaveBeenCalledWith(input);
    expect(delegatedResolve).toHaveBeenCalledTimes(1);
  });

  it('never falls back to JWT when a wdc1-prefixed token is malformed or rejected', async () => {
    const jwtResolve = vi.fn(() => Promise.resolve(null));
    const delegatedResolve = vi.fn(() => Promise.resolve(null));
    const resolver = new PlatformCredentialPrincipalResolver({
      jwt: { resolve: jwtResolve },
      delegated: { resolve: delegatedResolve },
    });

    await expect(
      resolver.resolve({ ...input, token: 'wdc1.malformed' }),
    ).resolves.toBeNull();

    expect(delegatedResolve).toHaveBeenCalledOnce();
    expect(jwtResolve).not.toHaveBeenCalled();
  });
});
