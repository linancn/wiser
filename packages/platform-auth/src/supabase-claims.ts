import { PlatformUuidSchema } from '@wiser/platform-contracts';

import type { SupabaseJwtClaimsVerifier } from './index.js';

export interface SupabaseClaimsResult {
  readonly data: { readonly claims?: unknown } | null;
  readonly error: unknown;
}

export interface SupabaseClaimsClient {
  getClaims(token: string): Promise<SupabaseClaimsResult>;
}

export interface SupabaseClaimsVerifierOptions {
  readonly now?: () => Date;
}

interface ClaimsRecord {
  readonly sub?: unknown;
  readonly session_id?: unknown;
  readonly role?: unknown;
  readonly exp?: unknown;
}

function claimsRecord(value: unknown): ClaimsRecord | null {
  return typeof value === 'object' && value !== null ? value : null;
}

export function createSupabaseJwtClaimsVerifier(
  client: SupabaseClaimsClient,
  options: SupabaseClaimsVerifierOptions = {},
): SupabaseJwtClaimsVerifier {
  const now = options.now ?? (() => new Date());
  return async (token) => {
    if (token.length === 0) return null;
    const result = await client.getClaims(token);
    if (result.error !== null) return null;
    const claims = claimsRecord(result.data?.claims);
    const userId = PlatformUuidSchema.safeParse(claims?.sub);
    const sessionId = PlatformUuidSchema.safeParse(claims?.session_id);
    if (
      claims === null ||
      claims.role !== 'authenticated' ||
      !userId.success ||
      !sessionId.success ||
      typeof claims.exp !== 'number' ||
      !Number.isSafeInteger(claims.exp)
    ) {
      return null;
    }

    const expiresAt = new Date(claims.exp * 1_000);
    if (!Number.isFinite(expiresAt.valueOf()) || expiresAt <= now())
      return null;
    return {
      userId: userId.data,
      sessionId: sessionId.data,
      expiresAt: expiresAt.toISOString(),
    };
  };
}
