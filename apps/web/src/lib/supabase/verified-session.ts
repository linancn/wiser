import 'server-only';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_ACCESS_TOKEN_BYTES = 16_384;

export interface VerifiedSessionClient {
  readonly auth: {
    getClaims(): Promise<{
      readonly data: { readonly claims?: unknown } | null;
      readonly error: unknown;
    }>;
    getSession(): Promise<{
      readonly data: {
        readonly session: { readonly access_token?: unknown } | null;
      } | null;
      readonly error: unknown;
    }>;
  };
}

export class VerifiedSessionError extends Error {
  constructor(
    readonly kind: 'configuration' | 'authentication',
    readonly status: number,
  ) {
    super('The current session could not be verified.');
    this.name = 'VerifiedSessionError';
  }
}

interface VerifiedClaims {
  readonly sub: string;
  readonly sessionId: string;
  readonly exp: number;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function verifiedClaims(value: unknown, now: Date): VerifiedClaims | null {
  const claims = record(value);
  if (
    claims === null ||
    claims.role !== 'authenticated' ||
    typeof claims.sub !== 'string' ||
    !UUID_PATTERN.test(claims.sub) ||
    typeof claims.session_id !== 'string' ||
    !UUID_PATTERN.test(claims.session_id) ||
    typeof claims.exp !== 'number' ||
    !Number.isSafeInteger(claims.exp) ||
    claims.exp * 1_000 <= now.valueOf()
  ) {
    return null;
  }
  return {
    sub: claims.sub,
    sessionId: claims.session_id,
    exp: claims.exp,
  };
}

function decodeAccessTokenClaims(
  token: string,
): Record<string, unknown> | null {
  const parts = token.split('.');
  const payload = parts[1];
  if (parts.length !== 3 || payload === undefined) return null;
  try {
    const decoded = Buffer.from(payload, 'base64url').toString('utf8');
    if (Buffer.from(decoded).toString('base64url') !== payload) return null;
    return record(JSON.parse(decoded) as unknown);
  } catch {
    return null;
  }
}

export async function verifiedSessionAccessToken(
  createAuthClient: () => Promise<VerifiedSessionClient | null>,
  now: () => Date,
): Promise<string> {
  let client: VerifiedSessionClient | null;
  try {
    client = await createAuthClient();
  } catch {
    throw new VerifiedSessionError('configuration', 503);
  }
  if (client === null) {
    throw new VerifiedSessionError('configuration', 503);
  }
  let claimsResult: Awaited<
    ReturnType<VerifiedSessionClient['auth']['getClaims']>
  >;
  try {
    claimsResult = await client.auth.getClaims();
  } catch {
    throw new VerifiedSessionError('authentication', 401);
  }
  const claims =
    claimsResult.error === null
      ? verifiedClaims(claimsResult.data?.claims, now())
      : null;
  if (claims === null) {
    throw new VerifiedSessionError('authentication', 401);
  }
  let sessionResult: Awaited<
    ReturnType<VerifiedSessionClient['auth']['getSession']>
  >;
  try {
    sessionResult = await client.auth.getSession();
  } catch {
    throw new VerifiedSessionError('authentication', 401);
  }
  const token = sessionResult.data?.session?.access_token;
  if (
    sessionResult.error !== null ||
    typeof token !== 'string' ||
    token.length === 0 ||
    Buffer.byteLength(token) > MAX_ACCESS_TOKEN_BYTES
  ) {
    throw new VerifiedSessionError('authentication', 401);
  }
  const payload = decodeAccessTokenClaims(token);
  if (
    payload?.sub !== claims.sub ||
    payload.session_id !== claims.sessionId ||
    payload.exp !== claims.exp ||
    payload.role !== 'authenticated'
  ) {
    throw new VerifiedSessionError('authentication', 401);
  }
  return token;
}
