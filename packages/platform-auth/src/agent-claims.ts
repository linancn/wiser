import { PlatformUuidSchema } from '@wiser/platform-contracts';

import type { SupabaseClaimsClient } from './supabase-claims.js';

export interface VerifiedSupabaseAgentClaims {
  readonly userId: string;
  readonly sessionId: string;
  readonly clientId: string;
  readonly delegationId: string;
  readonly resource: string;
  readonly expiresAt: string;
}

export type SupabaseAgentClaimsVerifier = (
  token: string,
) => Promise<VerifiedSupabaseAgentClaims | null>;

export function createSupabaseAgentClaimsVerifier(
  client: SupabaseClaimsClient,
  options: {
    readonly issuer: string;
    readonly resource: string;
    readonly now?: () => Date;
  },
): SupabaseAgentClaimsVerifier {
  const now = options.now ?? (() => new Date());
  return async (token) => {
    if (token.length === 0 || token.length > 16_384) return null;
    const result = await client.getClaims(token);
    const candidate = result.data?.claims;
    if (
      result.error !== null ||
      typeof candidate !== 'object' ||
      candidate === null ||
      Array.isArray(candidate)
    )
      return null;
    const claims = candidate as Record<string, unknown>;
    const userId = PlatformUuidSchema.safeParse(claims['sub']);
    const sessionId = PlatformUuidSchema.safeParse(claims['session_id']);
    const clientId = PlatformUuidSchema.safeParse(claims['client_id']);
    const delegationId = PlatformUuidSchema.safeParse(
      claims['wiser_delegation_id'],
    );
    const expires = claims['exp'];
    if (
      claims['iss'] !== options.issuer ||
      claims['aud'] !== options.resource ||
      claims['role'] !== 'authenticated' ||
      !userId.success ||
      !sessionId.success ||
      !clientId.success ||
      !delegationId.success ||
      typeof expires !== 'number' ||
      !Number.isSafeInteger(expires)
    )
      return null;
    const expiresAt = new Date(expires * 1_000);
    if (!Number.isFinite(expiresAt.valueOf()) || expiresAt <= now())
      return null;
    return {
      userId: userId.data,
      sessionId: sessionId.data,
      clientId: clientId.data,
      delegationId: delegationId.data,
      resource: options.resource,
      expiresAt: expiresAt.toISOString(),
    };
  };
}
