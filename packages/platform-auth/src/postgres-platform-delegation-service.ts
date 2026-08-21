import { createHash, randomUUID } from 'node:crypto';

import {
  PlatformPurposeSchema,
  PlatformRequestContextSchema,
  PlatformScopeSchema,
  PlatformSecurityLevelSchema,
  PlatformUuidSchema,
  type AuthorizedContext,
  type PlatformRequestContext,
  type PlatformSecurityLevel,
} from '@wiser/platform-contracts';

import {
  issueDelegatedCredential,
  type DelegatedCredentialHmacKeyRing,
  type DelegatedCredentialRandomBytes,
} from './delegated-credential-token.js';
import {
  createPostgresAuthorizationContextLoader,
  type AuthorizationRow,
} from './postgres-authorization.js';

const MANAGE_DELEGATION_SCOPE = 'platform.delegation.manage';
const MAX_DELEGATION_TTL_SECONDS = 3_600;
const MIN_DELEGATION_TTL_SECONDS = 60;

const SECURITY_RANK: Readonly<Record<PlatformSecurityLevel, number>> = {
  L0_PUBLIC: 0,
  L1_INTERNAL: 1,
  L2_RESTRICTED: 2,
  L3_CONFIDENTIAL: 3,
};

export type PlatformDelegationServiceErrorCode =
  | 'NOT_AUTHORIZED'
  | 'VALIDATION_FAILED'
  | 'DELEGATION_NOT_FOUND'
  | 'CREDENTIAL_NOT_FOUND'
  | 'DELEGATION_VERSION_CONFLICT'
  | 'DELEGATION_STATE_CONFLICT'
  | 'IDEMPOTENCY_CONFLICT'
  | 'SECRET_NOT_RECOVERABLE'
  | 'PERSISTENCE_CONTRACT_VIOLATION'
  | 'INVALID_CONFIGURATION';

const ERROR_MESSAGES: Readonly<
  Record<PlatformDelegationServiceErrorCode, string>
> = {
  NOT_AUTHORIZED: 'The current identity may not perform this operation.',
  VALIDATION_FAILED: 'The delegation command is invalid.',
  DELEGATION_NOT_FOUND: 'The delegation was not found.',
  CREDENTIAL_NOT_FOUND: 'The delegated credential was not found.',
  DELEGATION_VERSION_CONFLICT: 'The delegation version has changed.',
  DELEGATION_STATE_CONFLICT: 'The delegation cannot perform this operation.',
  IDEMPOTENCY_CONFLICT:
    'The idempotency key was already used for a different request.',
  SECRET_NOT_RECOVERABLE:
    'The credential was issued previously and its plaintext is not recoverable; rotate it.',
  PERSISTENCE_CONTRACT_VIOLATION:
    'The delegation persistence contract returned invalid data.',
  INVALID_CONFIGURATION: 'The delegation service configuration is invalid.',
};

export class PlatformDelegationServiceError extends Error {
  constructor(readonly code: PlatformDelegationServiceErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = 'PlatformDelegationServiceError';
  }
}

export interface PlatformDelegationQueryResult<Row> {
  readonly rows: readonly Row[];
  readonly rowCount?: number | null;
}

export interface PlatformDelegationTransactionClient {
  query<Row = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<PlatformDelegationQueryResult<Row>>;
  release(): void;
}

export interface PlatformDelegationTransactionPool {
  connect(): Promise<PlatformDelegationTransactionClient>;
}

export interface PlatformDelegationView {
  readonly delegationId: string;
  readonly delegatedByActorId: string;
  readonly delegateActorId: string;
  readonly tenantId: string;
  readonly projectId: string;
  readonly scopes: readonly string[];
  readonly purpose: string;
  readonly maxSecurityLevel: PlatformSecurityLevel;
  readonly status: 'active' | 'expired' | 'revoked';
  readonly version: number;
  readonly expiresAt: string;
  readonly createdAt: string;
  readonly revokedAt?: string;
}

export interface IssuedPlatformCredentialView {
  readonly credentialId: string;
  readonly delegationId: string;
  readonly token: string;
  readonly expiresAt: string;
}

export interface PlatformDelegationCommandContext {
  readonly context: PlatformRequestContext;
  readonly idempotencyKey: string;
}

export interface PlatformDelegationCommandService {
  createDelegation(
    input: PlatformDelegationCommandContext & {
      readonly delegateActorId: string;
      readonly scopes: readonly string[];
      readonly purpose: string;
      readonly maxSecurityLevel: PlatformSecurityLevel;
      readonly expiresInSeconds: number;
    },
  ): Promise<PlatformDelegationView>;
  getDelegation(input: {
    readonly context: PlatformRequestContext;
    readonly delegationId: string;
  }): Promise<PlatformDelegationView | null>;
  issueCredential(
    input: PlatformDelegationCommandContext & {
      readonly delegationId: string;
      readonly expectedDelegationVersion: number;
    },
  ): Promise<IssuedPlatformCredentialView>;
  rotateCredential(
    input: PlatformDelegationCommandContext & {
      readonly delegationId: string;
      readonly expectedDelegationVersion: number;
    },
  ): Promise<IssuedPlatformCredentialView>;
  revokeDelegation(
    input: PlatformDelegationCommandContext & {
      readonly delegationId: string;
      readonly expectedDelegationVersion: number;
    },
  ): Promise<void>;
  revokeCredential(
    input: PlatformDelegationCommandContext & {
      readonly credentialId: string;
    },
  ): Promise<void>;
}

export interface PostgresPlatformDelegationServiceOptions {
  readonly pool: PlatformDelegationTransactionPool;
  readonly keyRing: DelegatedCredentialHmacKeyRing;
  readonly knownScopes: ReadonlySet<string>;
  readonly idFactory?: () => string;
  readonly randomBytes?: DelegatedCredentialRandomBytes;
}

interface DelegationRow {
  readonly delegation_id: string;
  readonly delegated_by_actor_id: string;
  readonly delegate_actor_id: string;
  readonly tenant_id: string;
  readonly project_id: string;
  readonly scopes: readonly string[] | null;
  readonly purpose: string;
  readonly max_security_level: string;
  readonly status: string;
  readonly version: number | string;
  readonly expires_at: Date | string;
  readonly created_at: Date | string;
  readonly revoked_at: Date | string | null;
}

interface DelegateRow {
  readonly actor_id: string;
  readonly actor_type: string;
  readonly actor_status: string;
  readonly tenant_membership_active: boolean | null;
  readonly project_membership_active: boolean | null;
}

interface CredentialIdRow {
  readonly credential_id: string;
}

interface CredentialInsertRow extends CredentialIdRow {
  readonly delegation_id: string;
  readonly expires_at: Date | string;
}

interface CredentialLockRow extends CredentialIdRow {
  readonly delegation_id: string;
  readonly credential_revoked_at: Date | string | null;
  readonly delegated_by_actor_id: string;
  readonly tenant_id: string;
  readonly project_id: string;
}

interface IdempotencyRow {
  readonly payload: unknown;
}

type CommandName =
  | 'createDelegation'
  | 'issueCredential'
  | 'rotateCredential'
  | 'revokeDelegation'
  | 'revokeCredential';

interface StoredCommandPayload {
  readonly schemaVersion: 1;
  readonly command: CommandName;
  readonly requestHash: string;
  readonly result?: unknown;
}

interface HumanCommandIdentity {
  readonly actorId: string;
  readonly sessionId: string;
  readonly tenantId: string;
  readonly projectId: string;
  readonly purpose: string;
  readonly traceId: string;
}

interface MutationEventInput {
  readonly command: CommandName;
  readonly requestHash: string;
  readonly idempotencyKey: string;
  readonly aggregateType: 'platform.delegation' | 'platform.credential';
  readonly aggregateId: string;
  readonly eventType: string;
  readonly reasonCode: string;
  readonly resourceType: 'delegation' | 'credential';
  readonly securityLevel: PlatformSecurityLevel;
  readonly result?: unknown;
}

const DELEGATE_READ_SQL = `
/* platform-delegation:delegate-read */
select
  actor.id as actor_id,
  actor.actor_type,
  actor.status as actor_status,
  exists (
    select 1
    from platform.tenant_memberships as membership
    where membership.tenant_id = $2::uuid
      and membership.actor_id = actor.id
      and membership.status = 'active'
      and membership.effective_at <= statement_timestamp()
      and (membership.expires_at is null or membership.expires_at > statement_timestamp())
  ) as tenant_membership_active,
  exists (
    select 1
    from platform.project_memberships as membership
    where membership.tenant_id = $2::uuid
      and membership.project_id = $3::uuid
      and membership.actor_id = actor.id
      and membership.status = 'active'
      and membership.effective_at <= statement_timestamp()
      and (membership.expires_at is null or membership.expires_at > statement_timestamp())
  ) as project_membership_active
from platform.actors as actor
where actor.id = $1::uuid
for key share
`;

const IDEMPOTENCY_LOCK_SQL = `
/* platform-delegation:idempotency-lock */
select pg_advisory_xact_lock(hashtextextended($1::text, 0))
`;

const IDEMPOTENCY_READ_SQL = `
/* platform-delegation:idempotency-read */
select payload
from platform_private.control_outbox
where idempotency_key = $1
for update
`;

const CREATE_DELEGATION_SQL = `
/* platform-delegation:create */
insert into platform.delegations (
  id,
  delegated_by_actor_id,
  delegate_actor_id,
  tenant_id,
  project_id,
  scopes,
  purpose,
  max_security_level,
  status,
  version,
  expires_at
) values (
  $1::uuid,
  $2::uuid,
  $3::uuid,
  $4::uuid,
  $5::uuid,
  $6::text[],
  $7,
  $8,
  'active',
  1,
  statement_timestamp() + ($9::integer * interval '1 second')
)
returning
  id as delegation_id,
  delegated_by_actor_id,
  delegate_actor_id,
  tenant_id,
  project_id,
  scopes,
  purpose,
  max_security_level,
  status,
  version,
  expires_at,
  created_at,
  revoked_at
`;

const GET_DELEGATION_SQL = `
/* platform-delegation:get */
select
  id as delegation_id,
  delegated_by_actor_id,
  delegate_actor_id,
  tenant_id,
  project_id,
  scopes,
  purpose,
  max_security_level,
  case
    when status = 'active' and expires_at <= statement_timestamp() then 'expired'
    else status
  end as status,
  version,
  expires_at,
  created_at,
  revoked_at
from platform.delegations
where id = $1::uuid
  and delegated_by_actor_id = $2::uuid
  and tenant_id = $3::uuid
  and project_id = $4::uuid
limit 1
`;

const LOCK_DELEGATION_SQL = `
/* platform-delegation:lock */
select
  id as delegation_id,
  delegated_by_actor_id,
  delegate_actor_id,
  tenant_id,
  project_id,
  scopes,
  purpose,
  max_security_level,
  case
    when status = 'active' and expires_at <= statement_timestamp() then 'expired'
    else status
  end as status,
  version,
  expires_at,
  created_at,
  revoked_at
from platform.delegations
where id = $1::uuid
  and delegated_by_actor_id = $2::uuid
  and tenant_id = $3::uuid
  and project_id = $4::uuid
for update
`;

const REVOKE_ACTIVE_CREDENTIALS_SQL = `
/* platform-delegation:revoke-active-credentials */
update platform_private.delegated_credentials
set revoked_at = statement_timestamp()
where delegation_id = $1::uuid
  and revoked_at is null
returning id as credential_id
`;

const INSERT_CREDENTIAL_SQL = `
/* platform-delegation:credential-insert */
insert into platform_private.delegated_credentials (
  id,
  delegation_id,
  key_id,
  hmac_key_id,
  token_hmac,
  expires_at
)
select
  $1::uuid,
  delegation.id,
  $3,
  $4,
  $5::bytea,
  least(
    delegation.expires_at,
    statement_timestamp() + interval '15 minutes'
  )
from platform.delegations as delegation
where delegation.id = $2::uuid
returning
  id as credential_id,
  delegation_id,
  expires_at
`;

const LINK_ROTATION_SQL = `
/* platform-delegation:rotation-link */
update platform_private.delegated_credentials
set rotated_to_credential_id = $2::uuid
where id = $1::uuid
  and revoked_at is not null
  and rotated_to_credential_id is null
`;

const REVOKE_DELEGATION_SQL = `
/* platform-delegation:delegation-revoke */
update platform.delegations
set
  status = 'revoked',
  revoked_at = statement_timestamp(),
  version = version + 1
where id = $1::uuid
  and status <> 'revoked'
returning
  id as delegation_id,
  delegated_by_actor_id,
  delegate_actor_id,
  tenant_id,
  project_id,
  scopes,
  purpose,
  max_security_level,
  status,
  version,
  expires_at,
  created_at,
  revoked_at
`;

const LOCK_CREDENTIAL_SQL = `
/* platform-delegation:credential-lock */
select
  credential.id as credential_id,
  credential.delegation_id,
  credential.revoked_at as credential_revoked_at,
  delegation.delegated_by_actor_id,
  delegation.tenant_id,
  delegation.project_id
from platform_private.delegated_credentials as credential
join platform.delegations as delegation
  on delegation.id = credential.delegation_id
where credential.id = $1::uuid
  and delegation.delegated_by_actor_id = $2::uuid
  and delegation.tenant_id = $3::uuid
  and delegation.project_id = $4::uuid
for update of credential, delegation
`;

const REVOKE_CREDENTIAL_SQL = `
/* platform-delegation:credential-revoke */
update platform_private.delegated_credentials
set revoked_at = statement_timestamp()
where id = $1::uuid
  and revoked_at is null
`;

const INSERT_AUDIT_SQL = `
/* platform-delegation:audit-insert */
insert into platform_private.authorization_audit_events (
  actor_id,
  tenant_id,
  project_id,
  capability,
  purpose,
  decision,
  reason_code,
  resource_type,
  resource_id,
  security_level,
  authz_version,
  trace_id,
  context
) values (
  $1::uuid,
  $2::uuid,
  $3::uuid,
  $4,
  $5,
  'allowed',
  $6,
  $7,
  $8,
  $9,
  $10::bigint,
  $11,
  $12::jsonb
)
`;

const INSERT_OUTBOX_SQL = `
/* platform-delegation:outbox-insert */
insert into platform_private.control_outbox (
  aggregate_type,
  aggregate_id,
  event_type,
  payload,
  idempotency_key
) values ($1, $2::uuid, $3, $4::jsonb, $5)
`;

function serviceError(
  code: PlatformDelegationServiceErrorCode,
): PlatformDelegationServiceError {
  return new PlatformDelegationServiceError(code);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isoTimestamp(value: Date | string): string | null {
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isFinite(parsed.valueOf()) ? parsed.toISOString() : null;
}

function positiveVersion(value: number | string): number | null {
  if (typeof value === 'string' && !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseDelegationView(
  row: DelegationRow,
): PlatformDelegationView | null {
  const maxSecurityLevel = PlatformSecurityLevelSchema.safeParse(
    row.max_security_level,
  );
  const expiresAt = isoTimestamp(row.expires_at);
  const createdAt = isoTimestamp(row.created_at);
  const revokedAt =
    row.revoked_at === null ? undefined : isoTimestamp(row.revoked_at);
  const version = positiveVersion(row.version);
  const scopes = [...(row.scopes ?? [])];
  if (
    !PlatformUuidSchema.safeParse(row.delegation_id).success ||
    !PlatformUuidSchema.safeParse(row.delegated_by_actor_id).success ||
    !PlatformUuidSchema.safeParse(row.delegate_actor_id).success ||
    !PlatformUuidSchema.safeParse(row.tenant_id).success ||
    !PlatformUuidSchema.safeParse(row.project_id).success ||
    !PlatformPurposeSchema.safeParse(row.purpose).success ||
    !maxSecurityLevel.success ||
    !['active', 'expired', 'revoked'].includes(row.status) ||
    !scopes.every((scope) => PlatformScopeSchema.safeParse(scope).success) ||
    expiresAt === null ||
    createdAt === null ||
    version === null ||
    revokedAt === null
  ) {
    return null;
  }
  return {
    delegationId: row.delegation_id,
    delegatedByActorId: row.delegated_by_actor_id,
    delegateActorId: row.delegate_actor_id,
    tenantId: row.tenant_id,
    projectId: row.project_id,
    scopes,
    purpose: row.purpose,
    maxSecurityLevel: maxSecurityLevel.data,
    status: row.status as PlatformDelegationView['status'],
    version,
    expiresAt,
    createdAt,
    ...(revokedAt === undefined ? {} : { revokedAt }),
  };
}

function parseStoredDelegationView(
  value: unknown,
): PlatformDelegationView | null {
  if (!isRecord(value)) return null;
  const scopes = Array.isArray(value.scopes) ? value.scopes : null;
  const maxSecurityLevel = PlatformSecurityLevelSchema.safeParse(
    value.maxSecurityLevel,
  );
  if (
    !PlatformUuidSchema.safeParse(value.delegationId).success ||
    !PlatformUuidSchema.safeParse(value.delegatedByActorId).success ||
    !PlatformUuidSchema.safeParse(value.delegateActorId).success ||
    !PlatformUuidSchema.safeParse(value.tenantId).success ||
    !PlatformUuidSchema.safeParse(value.projectId).success ||
    !PlatformPurposeSchema.safeParse(value.purpose).success ||
    !maxSecurityLevel.success ||
    scopes === null ||
    !scopes.every(
      (scope) =>
        typeof scope === 'string' &&
        PlatformScopeSchema.safeParse(scope).success,
    ) ||
    (value.status !== 'active' &&
      value.status !== 'expired' &&
      value.status !== 'revoked') ||
    typeof value.version !== 'number' ||
    !Number.isSafeInteger(value.version) ||
    value.version <= 0 ||
    typeof value.expiresAt !== 'string' ||
    isoTimestamp(value.expiresAt) === null ||
    typeof value.createdAt !== 'string' ||
    isoTimestamp(value.createdAt) === null ||
    (value.revokedAt !== undefined &&
      (typeof value.revokedAt !== 'string' ||
        isoTimestamp(value.revokedAt) === null))
  ) {
    return null;
  }
  return {
    delegationId: value.delegationId as string,
    delegatedByActorId: value.delegatedByActorId as string,
    delegateActorId: value.delegateActorId as string,
    tenantId: value.tenantId as string,
    projectId: value.projectId as string,
    scopes: scopes as string[],
    purpose: value.purpose as string,
    maxSecurityLevel: maxSecurityLevel.data,
    status: value.status,
    version: value.version,
    expiresAt: value.expiresAt,
    createdAt: value.createdAt,
    ...(value.revokedAt === undefined ? {} : { revokedAt: value.revokedAt }),
  };
}

function humanIdentity(context: PlatformRequestContext): HumanCommandIdentity {
  const parsed = PlatformRequestContextSchema.safeParse(context);
  if (
    !parsed.success ||
    parsed.data.principal.actorType !== 'human' ||
    parsed.data.principal.authenticationMethod !== 'supabase_jwt' ||
    parsed.data.principal.authUserId !== parsed.data.principal.actorId ||
    parsed.data.principal.sessionId === undefined
  ) {
    throw serviceError('NOT_AUTHORIZED');
  }
  return {
    actorId: parsed.data.principal.actorId,
    sessionId: parsed.data.principal.sessionId,
    tenantId: parsed.data.authorization.tenantId,
    projectId: parsed.data.authorization.projectId,
    purpose: parsed.data.authorization.purpose,
    traceId: parsed.data.traceId,
  };
}

function canonicalJson(value: unknown): string {
  if (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'string'
  ) {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw serviceError('VALIDATION_FAILED');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  }
  throw serviceError('VALIDATION_FAILED');
}

export function canonicalPlatformDelegationRequestHash(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function parseStoredCommandPayload(
  value: unknown,
): StoredCommandPayload | null {
  let candidate = value;
  if (typeof value === 'string') {
    try {
      candidate = JSON.parse(value) as unknown;
    } catch {
      return null;
    }
  }
  if (
    !isRecord(candidate) ||
    candidate.schemaVersion !== 1 ||
    typeof candidate.command !== 'string' ||
    ![
      'createDelegation',
      'issueCredential',
      'rotateCredential',
      'revokeDelegation',
      'revokeCredential',
    ].includes(candidate.command) ||
    typeof candidate.requestHash !== 'string' ||
    !/^[a-f0-9]{64}$/.test(candidate.requestHash)
  ) {
    return null;
  }
  return {
    schemaVersion: 1,
    command: candidate.command as CommandName,
    requestHash: candidate.requestHash,
    ...(candidate.result === undefined ? {} : { result: candidate.result }),
  };
}

export class PostgresPlatformDelegationService implements PlatformDelegationCommandService {
  readonly #pool: PlatformDelegationTransactionPool;
  readonly #keyRing: DelegatedCredentialHmacKeyRing;
  readonly #knownScopes: ReadonlySet<string>;
  readonly #idFactory: () => string;
  readonly #randomBytes: DelegatedCredentialRandomBytes | undefined;

  constructor(options: PostgresPlatformDelegationServiceOptions) {
    this.#pool = options.pool;
    this.#keyRing = options.keyRing;
    this.#knownScopes = options.knownScopes;
    this.#idFactory = options.idFactory ?? randomUUID;
    this.#randomBytes = options.randomBytes;
  }

  async createDelegation(
    input: Parameters<PlatformDelegationCommandService['createDelegation']>[0],
  ): Promise<PlatformDelegationView> {
    const identity = humanIdentity(input.context);
    this.#validateIdempotencyKey(input.idempotencyKey);
    const scopes = this.#canonicalScopes(input.scopes);
    this.#validateCreateInput(input, identity, scopes);

    return this.#transaction(async (client) => {
      const authorization = await this.#loadLiveAuthorization(client, identity);
      this.#assertDelegableBoundary(
        authorization,
        scopes,
        input.maxSecurityLevel,
      );
      await this.#assertLiveDelegate(client, input.delegateActorId, identity);
      const requestHash = canonicalPlatformDelegationRequestHash({
        command: 'createDelegation',
        actorId: identity.actorId,
        tenantId: identity.tenantId,
        projectId: identity.projectId,
        delegateActorId: input.delegateActorId,
        scopes,
        purpose: input.purpose,
        maxSecurityLevel: input.maxSecurityLevel,
        expiresInSeconds: input.expiresInSeconds,
      });
      const replay = await this.#readReplay(
        client,
        input.idempotencyKey,
        requestHash,
        'createDelegation',
      );
      if (replay !== null) {
        const view = parseStoredDelegationView(replay.result);
        if (view === null) {
          throw serviceError('PERSISTENCE_CONTRACT_VIOLATION');
        }
        return view;
      }

      const delegationId = this.#nextId();
      const result = await client.query<DelegationRow>(CREATE_DELEGATION_SQL, [
        delegationId,
        identity.actorId,
        input.delegateActorId,
        identity.tenantId,
        identity.projectId,
        scopes,
        input.purpose,
        input.maxSecurityLevel,
        input.expiresInSeconds,
      ]);
      const row = result.rows[0];
      const view = row === undefined ? null : parseDelegationView(row);
      if (view === null) {
        throw serviceError('PERSISTENCE_CONTRACT_VIOLATION');
      }
      await this.#recordMutation(client, identity, authorization, {
        command: 'createDelegation',
        requestHash,
        idempotencyKey: input.idempotencyKey,
        aggregateType: 'platform.delegation',
        aggregateId: view.delegationId,
        eventType: 'platform.delegation.created',
        reasonCode: 'DELEGATION_CREATED',
        resourceType: 'delegation',
        securityLevel: view.maxSecurityLevel,
        result: view,
      });
      return view;
    });
  }

  async getDelegation(input: {
    readonly context: PlatformRequestContext;
    readonly delegationId: string;
  }): Promise<PlatformDelegationView | null> {
    const identity = humanIdentity(input.context);
    this.#validateUuid(input.delegationId);
    return this.#transaction(async (client) => {
      await this.#loadLiveAuthorization(client, identity);
      const result = await client.query<DelegationRow>(GET_DELEGATION_SQL, [
        input.delegationId,
        identity.actorId,
        identity.tenantId,
        identity.projectId,
      ]);
      const row = result.rows[0];
      if (row === undefined) return null;
      const view = parseDelegationView(row);
      if (view === null) {
        throw serviceError('PERSISTENCE_CONTRACT_VIOLATION');
      }
      return view;
    });
  }

  issueCredential(
    input: Parameters<PlatformDelegationCommandService['issueCredential']>[0],
  ): Promise<IssuedPlatformCredentialView> {
    return this.#issueCredential(input, false);
  }

  rotateCredential(
    input: Parameters<PlatformDelegationCommandService['rotateCredential']>[0],
  ): Promise<IssuedPlatformCredentialView> {
    return this.#issueCredential(input, true);
  }

  async revokeDelegation(
    input: Parameters<PlatformDelegationCommandService['revokeDelegation']>[0],
  ): Promise<void> {
    const identity = humanIdentity(input.context);
    this.#validateIdempotencyKey(input.idempotencyKey);
    this.#validateUuid(input.delegationId);
    this.#validateExpectedVersion(input.expectedDelegationVersion);

    await this.#transaction(async (client) => {
      const authorization = await this.#loadLiveAuthorization(client, identity);
      const requestHash = canonicalPlatformDelegationRequestHash({
        command: 'revokeDelegation',
        actorId: identity.actorId,
        tenantId: identity.tenantId,
        projectId: identity.projectId,
        delegationId: input.delegationId,
        expectedDelegationVersion: input.expectedDelegationVersion,
      });
      const replay = await this.#readReplay(
        client,
        input.idempotencyKey,
        requestHash,
        'revokeDelegation',
      );
      if (replay !== null) return;

      const row = await this.#lockDelegation(
        client,
        input.delegationId,
        identity,
      );
      const view = parseDelegationView(row);
      if (view === null) {
        throw serviceError('PERSISTENCE_CONTRACT_VIOLATION');
      }
      let revokedView = view;
      if (view.status !== 'revoked') {
        if (view.version !== input.expectedDelegationVersion) {
          throw serviceError('DELEGATION_VERSION_CONFLICT');
        }
        const updated = await client.query<DelegationRow>(
          REVOKE_DELEGATION_SQL,
          [view.delegationId],
        );
        const updatedRow = updated.rows[0];
        const parsed =
          updatedRow === undefined ? null : parseDelegationView(updatedRow);
        if (parsed === null) {
          throw serviceError('PERSISTENCE_CONTRACT_VIOLATION');
        }
        revokedView = parsed;
      }
      await client.query<CredentialIdRow>(REVOKE_ACTIVE_CREDENTIALS_SQL, [
        view.delegationId,
      ]);
      await this.#recordMutation(client, identity, authorization, {
        command: 'revokeDelegation',
        requestHash,
        idempotencyKey: input.idempotencyKey,
        aggregateType: 'platform.delegation',
        aggregateId: view.delegationId,
        eventType: 'platform.delegation.revoked',
        reasonCode: 'DELEGATION_REVOKED',
        resourceType: 'delegation',
        securityLevel: revokedView.maxSecurityLevel,
        result: {
          delegationId: revokedView.delegationId,
          status: 'revoked',
          version: revokedView.version,
        },
      });
    });
  }

  async revokeCredential(
    input: Parameters<PlatformDelegationCommandService['revokeCredential']>[0],
  ): Promise<void> {
    const identity = humanIdentity(input.context);
    this.#validateIdempotencyKey(input.idempotencyKey);
    this.#validateUuid(input.credentialId);

    await this.#transaction(async (client) => {
      const authorization = await this.#loadLiveAuthorization(client, identity);
      const requestHash = canonicalPlatformDelegationRequestHash({
        command: 'revokeCredential',
        actorId: identity.actorId,
        tenantId: identity.tenantId,
        projectId: identity.projectId,
        credentialId: input.credentialId,
      });
      const replay = await this.#readReplay(
        client,
        input.idempotencyKey,
        requestHash,
        'revokeCredential',
      );
      if (replay !== null) return;

      const locked = await client.query<CredentialLockRow>(
        LOCK_CREDENTIAL_SQL,
        [
          input.credentialId,
          identity.actorId,
          identity.tenantId,
          identity.projectId,
        ],
      );
      const row = locked.rows[0];
      if (row === undefined) throw serviceError('CREDENTIAL_NOT_FOUND');
      if (
        !PlatformUuidSchema.safeParse(row.credential_id).success ||
        !PlatformUuidSchema.safeParse(row.delegation_id).success
      ) {
        throw serviceError('PERSISTENCE_CONTRACT_VIOLATION');
      }
      await client.query(REVOKE_CREDENTIAL_SQL, [row.credential_id]);
      await this.#recordMutation(client, identity, authorization, {
        command: 'revokeCredential',
        requestHash,
        idempotencyKey: input.idempotencyKey,
        aggregateType: 'platform.credential',
        aggregateId: row.credential_id,
        eventType: 'platform.credential.revoked',
        reasonCode: 'DELEGATED_CREDENTIAL_REVOKED',
        resourceType: 'credential',
        securityLevel: authorization.maxSecurityLevel,
        result: {
          credentialId: row.credential_id,
          delegationId: row.delegation_id,
          status: 'revoked',
        },
      });
    });
  }

  async #issueCredential(
    input:
      | Parameters<PlatformDelegationCommandService['issueCredential']>[0]
      | Parameters<PlatformDelegationCommandService['rotateCredential']>[0],
    rotate: boolean,
  ): Promise<IssuedPlatformCredentialView> {
    const identity = humanIdentity(input.context);
    this.#validateIdempotencyKey(input.idempotencyKey);
    this.#validateUuid(input.delegationId);
    this.#validateExpectedVersion(input.expectedDelegationVersion);
    const command: CommandName = rotate
      ? 'rotateCredential'
      : 'issueCredential';

    return this.#transaction(async (client) => {
      const authorization = await this.#loadLiveAuthorization(client, identity);
      const requestHash = canonicalPlatformDelegationRequestHash({
        command,
        actorId: identity.actorId,
        tenantId: identity.tenantId,
        projectId: identity.projectId,
        delegationId: input.delegationId,
        expectedDelegationVersion: input.expectedDelegationVersion,
      });
      const replay = await this.#readReplay(
        client,
        input.idempotencyKey,
        requestHash,
        command,
      );
      if (replay !== null) {
        throw serviceError('SECRET_NOT_RECOVERABLE');
      }

      const row = await this.#lockDelegation(
        client,
        input.delegationId,
        identity,
      );
      const view = parseDelegationView(row);
      if (view === null) {
        throw serviceError('PERSISTENCE_CONTRACT_VIOLATION');
      }
      if (view.version !== input.expectedDelegationVersion) {
        throw serviceError('DELEGATION_VERSION_CONFLICT');
      }
      if (view.status !== 'active' || row.revoked_at !== null) {
        throw serviceError('DELEGATION_STATE_CONFLICT');
      }
      if (view.purpose !== identity.purpose) {
        throw serviceError('NOT_AUTHORIZED');
      }
      this.#assertDelegableBoundary(
        authorization,
        view.scopes,
        view.maxSecurityLevel,
      );
      await this.#assertLiveDelegate(client, view.delegateActorId, identity);

      const previous = await client.query<CredentialIdRow>(
        REVOKE_ACTIVE_CREDENTIALS_SQL,
        [view.delegationId],
      );
      if (rotate && previous.rows.length === 0) {
        throw serviceError('DELEGATION_STATE_CONFLICT');
      }

      const issued = issueDelegatedCredential(this.#keyRing, this.#randomBytes);
      const credentialId = this.#nextId();
      const inserted = await client.query<CredentialInsertRow>(
        INSERT_CREDENTIAL_SQL,
        [
          credentialId,
          view.delegationId,
          issued.keyId,
          issued.hmacKeyId,
          issued.tokenHmac,
        ],
      );
      const credentialRow = inserted.rows[0];
      const expiresAt =
        credentialRow === undefined
          ? null
          : isoTimestamp(credentialRow.expires_at);
      if (
        credentialRow === undefined ||
        credentialRow.credential_id !== credentialId ||
        credentialRow.delegation_id !== view.delegationId ||
        expiresAt === null
      ) {
        throw serviceError('PERSISTENCE_CONTRACT_VIOLATION');
      }
      if (rotate) {
        const previousId = previous.rows[0]?.credential_id;
        if (previousId === undefined) {
          throw serviceError('DELEGATION_STATE_CONFLICT');
        }
        await client.query(LINK_ROTATION_SQL, [previousId, credentialId]);
      }

      const safeResult = {
        credentialId,
        delegationId: view.delegationId,
        expiresAt,
      };
      await this.#recordMutation(client, identity, authorization, {
        command,
        requestHash,
        idempotencyKey: input.idempotencyKey,
        aggregateType: 'platform.credential',
        aggregateId: credentialId,
        eventType: rotate
          ? 'platform.credential.rotated'
          : 'platform.credential.issued',
        reasonCode: rotate
          ? 'DELEGATED_CREDENTIAL_ROTATED'
          : 'DELEGATED_CREDENTIAL_ISSUED',
        resourceType: 'credential',
        securityLevel: view.maxSecurityLevel,
        result: safeResult,
      });
      return { ...safeResult, token: issued.token };
    });
  }

  async #transaction<T>(
    operation: (client: PlatformDelegationTransactionClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.#pool.connect();
    let began = false;
    try {
      await client.query('begin');
      began = true;
      const result = await operation(client);
      await client.query('commit');
      return result;
    } catch (error) {
      if (began) {
        try {
          await client.query('rollback');
        } catch {
          // Preserve the original failure; callers must never receive query values.
        }
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async #loadLiveAuthorization(
    client: PlatformDelegationTransactionClient,
    identity: HumanCommandIdentity,
  ): Promise<AuthorizedContext> {
    const load = createPostgresAuthorizationContextLoader((text, values) =>
      client.query<AuthorizationRow>(text, values),
    );
    const authorization = await load({
      actorId: identity.actorId,
      sessionId: identity.sessionId,
      tenantId: identity.tenantId,
      projectId: identity.projectId,
      purpose: identity.purpose,
    });
    if (
      authorization === null ||
      authorization.tenantId !== identity.tenantId ||
      authorization.projectId !== identity.projectId ||
      authorization.purpose !== identity.purpose ||
      !authorization.scopes.includes(MANAGE_DELEGATION_SCOPE)
    ) {
      throw serviceError('NOT_AUTHORIZED');
    }
    return authorization;
  }

  async #assertLiveDelegate(
    client: PlatformDelegationTransactionClient,
    delegateActorId: string,
    identity: HumanCommandIdentity,
  ): Promise<void> {
    const result = await client.query<DelegateRow>(DELEGATE_READ_SQL, [
      delegateActorId,
      identity.tenantId,
      identity.projectId,
    ]);
    const delegate = result.rows[0];
    if (
      delegate === undefined ||
      delegate.actor_id !== delegateActorId ||
      (delegate.actor_type !== 'agent' && delegate.actor_type !== 'service') ||
      delegate.actor_status !== 'active' ||
      delegate.tenant_membership_active !== true ||
      delegate.project_membership_active !== true ||
      delegateActorId === identity.actorId
    ) {
      throw serviceError('NOT_AUTHORIZED');
    }
  }

  async #readReplay(
    client: PlatformDelegationTransactionClient,
    idempotencyKey: string,
    requestHash: string,
    command: CommandName,
  ): Promise<StoredCommandPayload | null> {
    await client.query(IDEMPOTENCY_LOCK_SQL, [idempotencyKey]);
    const existing = await client.query<IdempotencyRow>(IDEMPOTENCY_READ_SQL, [
      idempotencyKey,
    ]);
    const row = existing.rows[0];
    if (row === undefined) return null;
    const payload = parseStoredCommandPayload(row.payload);
    if (payload === null) {
      throw serviceError('PERSISTENCE_CONTRACT_VIOLATION');
    }
    if (payload.requestHash !== requestHash || payload.command !== command) {
      throw serviceError('IDEMPOTENCY_CONFLICT');
    }
    if (command === 'issueCredential' || command === 'rotateCredential') {
      throw serviceError('SECRET_NOT_RECOVERABLE');
    }
    return payload;
  }

  async #lockDelegation(
    client: PlatformDelegationTransactionClient,
    delegationId: string,
    identity: HumanCommandIdentity,
  ): Promise<DelegationRow> {
    const locked = await client.query<DelegationRow>(LOCK_DELEGATION_SQL, [
      delegationId,
      identity.actorId,
      identity.tenantId,
      identity.projectId,
    ]);
    const row = locked.rows[0];
    if (row === undefined) throw serviceError('DELEGATION_NOT_FOUND');
    return row;
  }

  async #recordMutation(
    client: PlatformDelegationTransactionClient,
    identity: HumanCommandIdentity,
    authorization: AuthorizedContext,
    event: MutationEventInput,
  ): Promise<void> {
    const safeContext = JSON.stringify({ command: event.command });
    await client.query(INSERT_AUDIT_SQL, [
      identity.actorId,
      identity.tenantId,
      identity.projectId,
      MANAGE_DELEGATION_SCOPE,
      identity.purpose,
      event.reasonCode,
      event.resourceType,
      event.aggregateId,
      event.securityLevel,
      authorization.authzVersion,
      identity.traceId,
      safeContext,
    ]);
    const payload: StoredCommandPayload = {
      schemaVersion: 1,
      command: event.command,
      requestHash: event.requestHash,
      ...(event.result === undefined ? {} : { result: event.result }),
    };
    await client.query(INSERT_OUTBOX_SQL, [
      event.aggregateType,
      event.aggregateId,
      event.eventType,
      JSON.stringify(payload),
      event.idempotencyKey,
    ]);
  }

  #canonicalScopes(scopes: unknown): readonly string[] {
    const parsed = PlatformScopeSchema.array()
      .min(1)
      .max(128)
      .safeParse(scopes);
    if (!parsed.success || new Set(parsed.data).size !== parsed.data.length) {
      throw serviceError('VALIDATION_FAILED');
    }
    return [...parsed.data].sort();
  }

  #validateCreateInput(
    input: Parameters<PlatformDelegationCommandService['createDelegation']>[0],
    identity: HumanCommandIdentity,
    scopes: readonly string[],
  ): void {
    if (
      !PlatformUuidSchema.safeParse(input.delegateActorId).success ||
      input.delegateActorId === identity.actorId ||
      !PlatformPurposeSchema.safeParse(input.purpose).success ||
      input.purpose !== identity.purpose ||
      !PlatformSecurityLevelSchema.safeParse(input.maxSecurityLevel).success ||
      !Number.isInteger(input.expiresInSeconds) ||
      input.expiresInSeconds < MIN_DELEGATION_TTL_SECONDS ||
      input.expiresInSeconds > MAX_DELEGATION_TTL_SECONDS ||
      scopes.includes(MANAGE_DELEGATION_SCOPE)
    ) {
      throw serviceError('VALIDATION_FAILED');
    }
  }

  #assertDelegableBoundary(
    authorization: AuthorizedContext,
    scopes: readonly string[],
    requestedSecurityLevel: PlatformSecurityLevel,
  ): void {
    if (
      !scopes.every(
        (scope) =>
          this.#knownScopes.has(scope) && authorization.scopes.includes(scope),
      ) ||
      SECURITY_RANK[requestedSecurityLevel] >
        SECURITY_RANK[authorization.maxSecurityLevel]
    ) {
      throw serviceError('NOT_AUTHORIZED');
    }
  }

  #validateIdempotencyKey(value: string): void {
    if (!PlatformUuidSchema.safeParse(value).success) {
      throw serviceError('VALIDATION_FAILED');
    }
  }

  #validateExpectedVersion(value: number): void {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw serviceError('VALIDATION_FAILED');
    }
  }

  #validateUuid(value: string): void {
    if (!PlatformUuidSchema.safeParse(value).success) {
      throw serviceError('VALIDATION_FAILED');
    }
  }

  #nextId(): string {
    const id = this.#idFactory();
    if (!PlatformUuidSchema.safeParse(id).success) {
      throw serviceError('INVALID_CONFIGURATION');
    }
    return id;
  }
}
