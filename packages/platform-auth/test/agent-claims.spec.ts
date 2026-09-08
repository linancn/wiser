import { describe, expect, it } from 'vitest';

import { createSupabaseAgentClaimsVerifier } from '../src/agent-claims.js';

const claims = {
  sub: 'd1000000-0000-4000-8000-000000000001',
  session_id: 'd1000000-0000-4000-8000-000000000002',
  client_id: 'd1000000-0000-4000-8000-000000000003',
  wiser_delegation_id: 'd1000000-0000-4000-8000-000000000004',
  iss: 'https://auth.example.test/auth/v1',
  aud: 'https://mcp.example.test/mcp',
  role: 'authenticated',
  exp: 1_800_000_000,
};

function verifier(value: unknown, error: unknown = null) {
  return createSupabaseAgentClaimsVerifier(
    { getClaims: () => Promise.resolve({ data: { claims: value }, error }) },
    {
      issuer: claims.iss,
      resource: claims.aud,
      now: () => new Date('2026-09-08T00:00:00Z'),
    },
  );
}

describe('Agent OAuth claims', () => {
  it('accepts only signed claims bound to the intended resource and delegation', async () => {
    await expect(verifier(claims)('signed-token')).resolves.toEqual({
      userId: claims.sub,
      sessionId: claims.session_id,
      clientId: claims.client_id,
      delegationId: claims.wiser_delegation_id,
      resource: claims.aud,
      expiresAt: '2027-01-15T08:00:00.000Z',
    });
  });

  it.each([
    { iss: 'https://attacker.example.test/auth/v1' },
    { aud: 'authenticated' },
    { aud: [claims.aud, 'authenticated'] },
    { client_id: undefined },
    { session_id: undefined },
    { wiser_delegation_id: undefined },
    { role: 'service_role' },
    { exp: 1 },
    { exp: 1.5 },
    { sub: 'not-a-user' },
  ])('rejects invalid authority facts: %j', async (change) => {
    await expect(
      verifier({ ...claims, ...change })('token'),
    ).resolves.toBeNull();
  });

  it('rejects signature failures and user-controlled delegation metadata', async () => {
    await expect(
      verifier(claims, new Error('signature invalid'))('token'),
    ).resolves.toBeNull();
    await expect(
      verifier({
        ...claims,
        wiser_delegation_id: undefined,
        user_metadata: { wiser_delegation_id: claims.wiser_delegation_id },
      })('token'),
    ).resolves.toBeNull();
  });
});
