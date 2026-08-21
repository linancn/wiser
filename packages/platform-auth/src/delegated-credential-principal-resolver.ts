import {
  AuthorizedContextSchema,
  PlatformPurposeSchema,
  PlatformRequestContextSchema,
  PlatformScopeSchema,
  PlatformSecurityLevelSchema,
  PlatformTraceIdSchema,
  PlatformUuidSchema,
  type PlatformRequestContext,
  type PlatformSecurityLevel,
} from '@wiser/platform-contracts';

import {
  parseDelegatedCredentialToken,
  verifyDelegatedCredentialToken,
  type DelegatedCredentialHmacKeyRing,
} from './delegated-credential-token.js';

export interface DelegatedCredentialAuthorizationRecord {
  readonly credentialId: string;
  readonly delegationId: string;
  readonly keyId: string;
  readonly hmacKeyId: string;
  readonly tokenHmac: Uint8Array;
  readonly credentialExpiresAt: string;
  readonly credentialRevokedAt: string | null;
  readonly rotatedToCredentialId: string | null;
  readonly delegatedByActorId: string;
  readonly delegatedByActorStatus: string;
  readonly delegateActorId: string;
  readonly delegateActorType: string;
  readonly delegateActorStatus: string;
  readonly tenantId: string;
  readonly tenantStatus: string;
  readonly projectId: string;
  readonly projectStatus: string;
  readonly purpose: string;
  readonly delegationScopes: readonly string[];
  readonly delegationMaxSecurityLevel: string;
  readonly delegationStatus: string;
  readonly delegationExpiresAt: string;
  readonly delegationRevokedAt: string | null;
  readonly delegatorScopes: readonly string[];
  readonly delegatorMaxSecurityLevel: string;
  readonly delegatorTenantMembershipActive: boolean;
  readonly delegatorProjectMembershipActive: boolean;
  readonly delegateTenantMembershipActive: boolean;
  readonly delegateProjectMembershipActive: boolean;
  readonly authzVersion: number | string;
}

export type DelegatedCredentialAuthorizationRecordLoader = (
  keyId: string,
) => Promise<DelegatedCredentialAuthorizationRecord | null>;

export interface ResolveDelegatedCredentialInput {
  readonly token: string;
  readonly tenantId: string;
  readonly projectId: string;
  readonly purpose: string;
  readonly traceId: string;
}

export interface DelegatedCredentialPrincipalResolverOptions {
  readonly keyRing: DelegatedCredentialHmacKeyRing;
  readonly knownScopes: ReadonlySet<string>;
  readonly loadRecord: DelegatedCredentialAuthorizationRecordLoader;
  readonly now?: () => Date;
}

const SECURITY_RANK: Readonly<Record<PlatformSecurityLevel, number>> = {
  L0_PUBLIC: 0,
  L1_INTERNAL: 1,
  L2_RESTRICTED: 2,
  L3_CONFIDENTIAL: 3,
};

function validInput(input: ResolveDelegatedCredentialInput): boolean {
  return (
    input.token.length > 0 &&
    PlatformUuidSchema.safeParse(input.tenantId).success &&
    PlatformUuidSchema.safeParse(input.projectId).success &&
    PlatformPurposeSchema.safeParse(input.purpose).success &&
    PlatformTraceIdSchema.safeParse(input.traceId).success
  );
}

function timestamp(value: string): number | null {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function authorizationVersion(value: number | string): number | null {
  if (typeof value === 'string' && !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function liveRecord(
  record: DelegatedCredentialAuthorizationRecord,
  input: ResolveDelegatedCredentialInput,
  now: number,
): {
  readonly credentialExpiry: number;
  readonly delegationExpiry: number;
} | null {
  const credentialExpiry = timestamp(record.credentialExpiresAt);
  const delegationExpiry = timestamp(record.delegationExpiresAt);
  if (
    record.credentialRevokedAt !== null ||
    record.rotatedToCredentialId !== null ||
    credentialExpiry === null ||
    credentialExpiry <= now ||
    record.delegationStatus !== 'active' ||
    record.delegationRevokedAt !== null ||
    delegationExpiry === null ||
    delegationExpiry <= now ||
    (record.delegateActorType !== 'agent' &&
      record.delegateActorType !== 'service') ||
    record.delegateActorStatus !== 'active' ||
    record.delegatedByActorStatus !== 'active' ||
    record.tenantStatus !== 'active' ||
    record.projectStatus !== 'active' ||
    !record.delegatorTenantMembershipActive ||
    !record.delegatorProjectMembershipActive ||
    !record.delegateTenantMembershipActive ||
    !record.delegateProjectMembershipActive ||
    record.tenantId !== input.tenantId ||
    record.projectId !== input.projectId ||
    record.purpose !== input.purpose
  ) {
    return null;
  }
  return { credentialExpiry, delegationExpiry };
}

function effectiveScopes(
  record: DelegatedCredentialAuthorizationRecord,
  knownScopes: ReadonlySet<string>,
): readonly string[] {
  const currentScopes = new Set(record.delegatorScopes);
  return [...new Set(record.delegationScopes)]
    .filter(
      (scope) =>
        PlatformScopeSchema.safeParse(scope).success &&
        currentScopes.has(scope) &&
        knownScopes.has(scope),
    )
    .sort();
}

function effectiveSecurityLevel(
  record: DelegatedCredentialAuthorizationRecord,
): PlatformSecurityLevel | null {
  const delegated = PlatformSecurityLevelSchema.safeParse(
    record.delegationMaxSecurityLevel,
  );
  const current = PlatformSecurityLevelSchema.safeParse(
    record.delegatorMaxSecurityLevel,
  );
  if (!delegated.success || !current.success) return null;
  return SECURITY_RANK[delegated.data] <= SECURITY_RANK[current.data]
    ? delegated.data
    : current.data;
}

export class DelegatedCredentialPrincipalResolver {
  readonly #keyRing: DelegatedCredentialHmacKeyRing;
  readonly #knownScopes: ReadonlySet<string>;
  readonly #loadRecord: DelegatedCredentialAuthorizationRecordLoader;
  readonly #now: () => Date;

  constructor(options: DelegatedCredentialPrincipalResolverOptions) {
    this.#keyRing = options.keyRing;
    this.#knownScopes = options.knownScopes;
    this.#loadRecord = options.loadRecord;
    this.#now = options.now ?? (() => new Date());
  }

  async resolve(
    input: ResolveDelegatedCredentialInput,
  ): Promise<PlatformRequestContext | null> {
    if (!validInput(input)) return null;
    const tokenParts = parseDelegatedCredentialToken(input.token);
    if (tokenParts === null) return null;

    const record = await this.#loadRecord(tokenParts.keyId);
    if (
      record === null ||
      record.keyId !== tokenParts.keyId ||
      !verifyDelegatedCredentialToken(input.token, record, this.#keyRing)
    ) {
      return null;
    }

    const now = this.#now().valueOf();
    if (!Number.isFinite(now)) return null;
    const live = liveRecord(record, input, now);
    const scopes = effectiveScopes(record, this.#knownScopes);
    const maxSecurityLevel = effectiveSecurityLevel(record);
    const authzVersion = authorizationVersion(record.authzVersion);
    if (
      live === null ||
      scopes.length === 0 ||
      maxSecurityLevel === null ||
      authzVersion === null ||
      !PlatformUuidSchema.safeParse(record.credentialId).success ||
      !PlatformUuidSchema.safeParse(record.delegationId).success ||
      !PlatformUuidSchema.safeParse(record.delegateActorId).success ||
      !PlatformUuidSchema.safeParse(record.delegatedByActorId).success
    ) {
      return null;
    }

    const authorization = AuthorizedContextSchema.safeParse({
      tenantId: record.tenantId,
      projectId: record.projectId,
      roles: [],
      scopes,
      purpose: record.purpose,
      maxSecurityLevel,
      authzVersion,
    });
    if (!authorization.success) return null;

    const requestContext = PlatformRequestContextSchema.safeParse({
      principal: {
        actorType: record.delegateActorType,
        actorId: record.delegateActorId,
        credentialId: record.credentialId,
        delegationId: record.delegationId,
        delegatedBy: record.delegatedByActorId,
        authenticationMethod: 'delegated_credential',
        expiresAt: new Date(
          Math.min(live.credentialExpiry, live.delegationExpiry),
        ).toISOString(),
      },
      authorization: authorization.data,
      traceId: input.traceId,
    });
    return requestContext.success ? requestContext.data : null;
  }
}
