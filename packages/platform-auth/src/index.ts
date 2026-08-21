import {
  AuthorizedContextSchema,
  PlatformPurposeSchema,
  PlatformRequestContextSchema,
  PlatformTraceIdSchema,
  PlatformUuidSchema,
  type AuthorizedContext,
  type PlatformRequestContext,
} from '@wiser/platform-contracts';

export interface VerifiedSupabaseJwtClaims {
  readonly userId: string;
  readonly sessionId: string;
  readonly expiresAt?: string;
}

export type SupabaseJwtClaimsVerifier = (
  token: string,
) => Promise<VerifiedSupabaseJwtClaims | null>;

export interface AuthorizationContextLoadInput {
  readonly actorId: string;
  readonly sessionId: string;
  readonly tenantId: string;
  readonly projectId: string;
  readonly purpose: string;
}

export type AuthorizationContextLoader = (
  input: AuthorizationContextLoadInput,
) => Promise<AuthorizedContext | null>;

export interface ResolveSupabasePrincipalInput {
  readonly token: string;
  readonly tenantId: string;
  readonly projectId: string;
  readonly purpose: string;
  readonly traceId: string;
}

export interface SupabaseJwtPrincipalResolverOptions {
  readonly verifyClaims: SupabaseJwtClaimsVerifier;
  readonly loadAuthorization: AuthorizationContextLoader;
}

function validResolveInput(input: ResolveSupabasePrincipalInput): boolean {
  return (
    input.token.length > 0 &&
    PlatformUuidSchema.safeParse(input.tenantId).success &&
    PlatformUuidSchema.safeParse(input.projectId).success &&
    PlatformPurposeSchema.safeParse(input.purpose).success &&
    PlatformTraceIdSchema.safeParse(input.traceId).success
  );
}

export class SupabaseJwtPrincipalResolver {
  readonly #verifyClaims: SupabaseJwtClaimsVerifier;
  readonly #loadAuthorization: AuthorizationContextLoader;

  constructor(options: SupabaseJwtPrincipalResolverOptions) {
    this.#verifyClaims = options.verifyClaims;
    this.#loadAuthorization = options.loadAuthorization;
  }

  async resolve(
    input: ResolveSupabasePrincipalInput,
  ): Promise<PlatformRequestContext | null> {
    if (!validResolveInput(input)) return null;

    const claims = await this.#verifyClaims(input.token);
    if (
      claims === null ||
      !PlatformUuidSchema.safeParse(claims.userId).success ||
      !PlatformUuidSchema.safeParse(claims.sessionId).success
    ) {
      return null;
    }

    const authorization = await this.#loadAuthorization({
      actorId: claims.userId,
      sessionId: claims.sessionId,
      tenantId: input.tenantId,
      projectId: input.projectId,
      purpose: input.purpose,
    });
    const parsedAuthorization =
      AuthorizedContextSchema.safeParse(authorization);
    if (
      !parsedAuthorization.success ||
      parsedAuthorization.data.tenantId !== input.tenantId ||
      parsedAuthorization.data.projectId !== input.projectId ||
      parsedAuthorization.data.purpose !== input.purpose
    ) {
      return null;
    }

    const requestContext = PlatformRequestContextSchema.safeParse({
      principal: {
        actorType: 'human',
        actorId: claims.userId,
        authUserId: claims.userId,
        sessionId: claims.sessionId,
        authenticationMethod: 'supabase_jwt',
        ...(claims.expiresAt === undefined
          ? {}
          : { expiresAt: claims.expiresAt }),
      },
      authorization: parsedAuthorization.data,
      traceId: input.traceId,
    });
    return requestContext.success ? requestContext.data : null;
  }
}

export {
  createPostgresAuthorizationContextLoader,
  type AuthorizationRow,
  type AuthorizationQuery,
} from './postgres-authorization.js';
export {
  createSupabaseJwtClaimsVerifier,
  type SupabaseClaimsClient,
  type SupabaseClaimsResult,
  type SupabaseClaimsVerifierOptions,
} from './supabase-claims.js';
export {
  issueDelegatedCredential,
  parseDelegatedCredentialHmacKeyRing,
  parseDelegatedCredentialToken,
  verifyDelegatedCredentialToken,
  type DelegatedCredentialHmacKeyRing,
  type DelegatedCredentialRandomBytes,
  type DelegatedCredentialTokenParts,
  type IssuedDelegatedCredential,
  type StoredDelegatedCredentialHmac,
} from './delegated-credential-token.js';
export {
  DelegatedCredentialPrincipalResolver,
  type DelegatedCredentialAuthorizationRecord,
  type DelegatedCredentialAuthorizationRecordLoader,
  type DelegatedCredentialPrincipalResolverOptions,
  type ResolveDelegatedCredentialInput,
} from './delegated-credential-principal-resolver.js';
export {
  createPostgresDelegatedCredentialRecordLoader,
  type DelegatedCredentialAuthorizationQuery,
  type DelegatedCredentialAuthorizationRow,
} from './postgres-delegated-credential.js';
