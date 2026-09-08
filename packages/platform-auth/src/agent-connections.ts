import { createHash, randomUUID } from 'node:crypto';

import {
  PlatformAgentAuthorizationIdSchema,
  PlatformAgentAuthorizationViewSchema,
  PlatformAgentAuthorizeCommandSchema,
  PlatformAgentConnectionViewSchema,
  PlatformAgentResourceSchema,
  PlatformUuidSchema,
  type AuthorizedContext,
  type PlatformAgentAuthorizationView,
  type PlatformAgentAuthorizeCommand,
  type PlatformAgentConnectionView,
  type PlatformAgentExchangeView,
  type PlatformSecurityLevel,
} from '@wiser/platform-contracts';

import type { SupabaseAgentClaimsVerifier } from './agent-claims.js';
import {
  issueDelegatedCredential,
  type DelegatedCredentialHmacKeyRing,
} from './delegated-credential-token.js';
import { DelegatedCredentialPrincipalResolver } from './delegated-credential-principal-resolver.js';
import {
  createPostgresAuthorizationContextLoader,
  type AuthorizationRow,
} from './postgres-authorization.js';
import {
  createPostgresDelegatedCredentialRecordLoader,
  type DelegatedCredentialAuthorizationRow,
} from './postgres-delegated-credential.js';
import type {
  PlatformDelegationTransactionClient,
  PlatformDelegationTransactionPool,
} from './postgres-platform-delegation-service.js';
import type {
  SupabaseJwtClaimsVerifier,
  VerifiedSupabaseJwtClaims,
} from './index.js';

const QUERY_SCOPES = [
  'data.catalog.read',
  'data.query.execute',
  'data.search.execute',
  'data.knowledge.read',
  'data.graph.read',
  'data.geo.read',
  'data.operation.read',
] as const;
const SECURITY_RANK: Readonly<Record<PlatformSecurityLevel, number>> = {
  L0_PUBLIC: 0,
  L1_INTERNAL: 1,
  L2_RESTRICTED: 2,
  L3_CONFIDENTIAL: 3,
};

export type AgentConnectionErrorCode =
  | 'NOT_AUTHENTICATED'
  | 'NOT_AUTHORIZED'
  | 'VALIDATION_FAILED'
  | 'IDEMPOTENCY_CONFLICT'
  | 'SECRET_NOT_RECOVERABLE';
export class AgentConnectionError extends Error {
  constructor(readonly code: AgentConnectionErrorCode) {
    super(code);
    this.name = 'AgentConnectionError';
  }
}

interface IdentityInput {
  readonly token: string;
}
interface CommandInput extends IdentityInput {
  readonly idempotencyKey: string;
}
export interface AgentConnectionService {
  inspect(
    input: IdentityInput & { readonly authorizationId: string },
  ): Promise<PlatformAgentAuthorizationView>;
  authorize(
    input: CommandInput & { readonly command: PlatformAgentAuthorizeCommand },
  ): Promise<PlatformAgentConnectionView>;
  exchange(input: CommandInput): Promise<PlatformAgentExchangeView>;
  list(input: IdentityInput): Promise<readonly PlatformAgentConnectionView[]>;
  revoke(
    input: CommandInput & { readonly connectionId: string },
  ): Promise<void>;
}
export interface PostgresAgentConnectionServiceOptions {
  readonly pool: PlatformDelegationTransactionPool;
  readonly resource: string;
  readonly keyRing: DelegatedCredentialHmacKeyRing;
  readonly knownScopes: ReadonlySet<string>;
  readonly verifyHuman: SupabaseJwtClaimsVerifier;
  readonly verifyAgent: SupabaseAgentClaimsVerifier;
}

interface AuthorizationRequestRow {
  readonly client_id: string;
  readonly client_name: string;
  readonly redirect_uri: string;
  readonly user_id: string | null;
}
interface ConnectionRow {
  readonly connection_id: string;
  readonly oauth_client_id: string;
  readonly delegation_id: string;
  readonly tenant_id: string;
  readonly project_id: string;
  readonly scopes: string[];
  readonly max_security_level: string;
  readonly expires_at: Date;
  readonly status: string;
}
const CONNECTION_SELECT = `select c.id as connection_id, c.oauth_client_id, c.delegation_id,
  d.tenant_id, d.project_id, d.scopes, d.max_security_level, d.expires_at,
  case when d.status='active' and d.expires_at <= statement_timestamp() then 'expired' else d.status end as status
  from platform_private.agent_connections c join platform.delegations d on d.id=c.delegation_id`;

function connectionView(row: ConnectionRow): PlatformAgentConnectionView {
  return PlatformAgentConnectionViewSchema.parse({
    connectionId: row.connection_id,
    clientId: row.oauth_client_id,
    delegationId: row.delegation_id,
    tenantId: row.tenant_id,
    projectId: row.project_id,
    scopes: row.scopes,
    purpose: 'agent-data',
    maxSecurityLevel: row.max_security_level,
    expiresAt: row.expires_at.toISOString(),
    status: row.status,
  });
}

export class PostgresAgentConnectionService implements AgentConnectionService {
  readonly #options: PostgresAgentConnectionServiceOptions;

  constructor(options: PostgresAgentConnectionServiceOptions) {
    if (!PlatformAgentResourceSchema.safeParse(options.resource).success)
      throw new Error('Invalid Agent resource configuration.');
    this.#options = options;
  }

  async #transaction<T>(
    work: (client: PlatformDelegationTransactionClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.#options.pool.connect();
    try {
      await client.query('begin');
      const result = await work(client);
      await client.query('commit');
      return result;
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async #human(token: string): Promise<VerifiedSupabaseJwtClaims> {
    const claims = await this.#options.verifyHuman(token);
    if (claims === null) throw new AgentConnectionError('NOT_AUTHENTICATED');
    return claims;
  }

  async #liveHuman(
    client: PlatformDelegationTransactionClient,
    human: VerifiedSupabaseJwtClaims,
  ): Promise<void> {
    const { rows } = await client.query(
      `select a.id from platform.actors a
      join auth.sessions s on s.user_id=a.auth_user_id and s.id=$2
      where a.id=$1 and a.actor_type='human' and a.status='active'
        and s.oauth_client_id is null and (s.not_after is null or s.not_after>statement_timestamp())
      for share of a,s`,
      [human.userId, human.sessionId],
    );
    if (rows.length !== 1) throw new AgentConnectionError('NOT_AUTHENTICATED');
  }

  async #authorizationRequest(
    client: PlatformDelegationTransactionClient,
    authorizationId: string,
    human: VerifiedSupabaseJwtClaims,
  ): Promise<AuthorizationRequestRow> {
    if (!PlatformAgentAuthorizationIdSchema.safeParse(authorizationId).success)
      throw new AgentConnectionError('VALIDATION_FAILED');
    const { rows } = await client.query<AuthorizationRequestRow>(
      `select a.client_id, coalesce(nullif(c.client_name,''),'Agent') as client_name, a.redirect_uri, a.user_id
      from auth.oauth_authorizations a join auth.oauth_clients c on c.id=a.client_id
      where a.authorization_id=$1 and (a.user_id is null or a.user_id=$2)
        and a.resource=$3 and a.status in ('pending','approved')
        and a.expires_at>statement_timestamp() and c.deleted_at is null
        and a.code_challenge_method='s256' and length(a.code_challenge)=43
      for share of a,c`,
      [authorizationId, human.userId, this.#options.resource],
    );
    if (!rows[0]) throw new AgentConnectionError('NOT_AUTHORIZED');
    return rows[0];
  }

  #context(
    client: PlatformDelegationTransactionClient,
    human: VerifiedSupabaseJwtClaims,
    tenantId: string,
    projectId: string,
  ) {
    return createPostgresAuthorizationContextLoader((text, values) =>
      client.query<AuthorizationRow>(text, values),
    )({
      actorId: human.userId,
      sessionId: human.sessionId,
      tenantId,
      projectId,
      purpose: 'agent-data',
    });
  }

  #modes(context: AuthorizedContext): ('query' | 'ingest')[] {
    if (
      !context.scopes.includes('platform.delegation.manage') ||
      !context.scopes.includes('data.catalog.read')
    )
      return [];
    return context.scopes.includes('data.ingestion.write')
      ? ['query', 'ingest']
      : ['query'];
  }

  async inspect(
    input: IdentityInput & { readonly authorizationId: string },
  ): Promise<PlatformAgentAuthorizationView> {
    const human = await this.#human(input.token);
    return this.#transaction(async (client) => {
      await this.#liveHuman(client, human);
      const request = await this.#authorizationRequest(
        client,
        input.authorizationId,
        human,
      );
      const { rows } = await client.query<{
        tenant_id: string;
        project_id: string;
        tenant_name_zh_cn: string;
        tenant_name_en: string;
        project_name_zh_cn: string;
        project_name_en: string;
      }>(
        `select t.id as tenant_id,p.id as project_id,t.name_zh_cn as tenant_name_zh_cn,t.name_en as tenant_name_en,p.name_zh_cn as project_name_zh_cn,p.name_en as project_name_en
        from platform.project_memberships m join platform.projects p on p.id=m.project_id
        join platform.tenants t on t.id=p.tenant_id where m.actor_id=$1 and m.status='active'
        order by t.name_zh_cn,p.name_zh_cn,p.id limit 100`,
        [human.userId],
      );
      const projects: PlatformAgentAuthorizationView['projects'] = [];
      for (const row of rows) {
        const context = await this.#context(
          client,
          human,
          row.tenant_id,
          row.project_id,
        );
        const modes = context === null ? [] : this.#modes(context);
        if (context !== null && modes.length > 0)
          projects.push({
            tenantId: row.tenant_id,
            projectId: row.project_id,
            tenantName: {
              'zh-CN': row.tenant_name_zh_cn,
              en: row.tenant_name_en,
            },
            projectName: {
              'zh-CN': row.project_name_zh_cn,
              en: row.project_name_en,
            },
            modes,
            maxSecurityLevel: context.maxSecurityLevel,
          });
      }
      return PlatformAgentAuthorizationViewSchema.parse({
        authorizationId: input.authorizationId,
        clientId: request.client_id,
        clientName: request.client_name,
        redirectUri: request.redirect_uri,
        resource: this.#options.resource,
        projects,
      });
    });
  }

  async #replay(
    client: PlatformDelegationTransactionClient,
    owner: string,
    key: string,
    command: string,
    payload: unknown,
  ) {
    if (!PlatformUuidSchema.safeParse(key).success)
      throw new AgentConnectionError('VALIDATION_FAILED');
    const idempotencyKey = `agent:${owner}:${key}`;
    const hash = createHash('sha256')
      .update(JSON.stringify({ command, payload }))
      .digest('hex');
    await client.query('select pg_advisory_xact_lock(hashtextextended($1,0))', [
      idempotencyKey,
    ]);
    const result = await client.query<{
      payload: { hash: string; result?: unknown };
    }>(
      'select payload from platform_private.control_outbox where idempotency_key=$1',
      [idempotencyKey],
    );
    const replay = result.rows[0]?.payload;
    if (replay !== undefined && replay.hash !== hash)
      throw new AgentConnectionError('IDEMPOTENCY_CONFLICT');
    return { idempotencyKey, hash, replay };
  }

  async #record(
    client: PlatformDelegationTransactionClient,
    owner: string,
    connection: PlatformAgentConnectionView,
    command: string,
    state: { idempotencyKey: string; hash: string },
    result?: unknown,
  ) {
    await client.query(
      `insert into platform_private.authorization_audit_events
      (actor_id,tenant_id,project_id,capability,purpose,decision,reason_code,resource_type,resource_id,security_level,context)
      values ($1,$2,$3,$4,'agent-data','allowed','AGENT_CONNECTION_AUTHORIZED','agent-connection',$5,$6,$7)`,
      [
        owner,
        connection.tenantId,
        connection.projectId,
        `platform.agent.${command}`,
        connection.connectionId,
        connection.maxSecurityLevel,
        JSON.stringify({ delegationId: connection.delegationId }),
      ],
    );
    await client.query(
      `insert into platform_private.control_outbox(aggregate_type,aggregate_id,event_type,payload,idempotency_key)
      values ('agent-connection',$1,$2,$3,$4)`,
      [
        connection.connectionId,
        `agent.${command}`,
        JSON.stringify({
          hash: state.hash,
          ...(result === undefined ? {} : { result }),
        }),
        state.idempotencyKey,
      ],
    );
  }

  async authorize(
    input: CommandInput & { readonly command: PlatformAgentAuthorizeCommand },
  ): Promise<PlatformAgentConnectionView> {
    const parsed = PlatformAgentAuthorizeCommandSchema.safeParse(input.command);
    if (!parsed.success) throw new AgentConnectionError('VALIDATION_FAILED');
    const command = parsed.data;
    const human = await this.#human(input.token);
    return this.#transaction(async (client) => {
      await this.#liveHuman(client, human);
      const context = await this.#context(
        client,
        human,
        command.tenantId,
        command.projectId,
      );
      if (
        context === null ||
        !this.#modes(context).includes(command.mode) ||
        SECURITY_RANK[command.maxSecurityLevel] >
          SECURITY_RANK[context.maxSecurityLevel]
      )
        throw new AgentConnectionError('NOT_AUTHORIZED');
      const state = await this.#replay(
        client,
        human.userId,
        input.idempotencyKey,
        'authorize',
        command,
      );
      if (state.replay !== undefined)
        return PlatformAgentConnectionViewSchema.parse(state.replay.result);
      const request = await this.#authorizationRequest(
        client,
        command.authorizationId,
        human,
      );
      if (request.user_id !== human.userId)
        throw new AgentConnectionError('NOT_AUTHORIZED');
      await client.query(
        'select pg_advisory_xact_lock(hashtextextended($1,0))',
        [`agent-client:${human.userId}:${request.client_id}`],
      );
      const previous = (
        await client.query<{ id: string; delegation_id: string }>(
          'select id,delegation_id from platform_private.agent_connections where owner_actor_id=$1 and oauth_client_id=$2 for update',
          [human.userId, request.client_id],
        )
      ).rows[0];
      const connectionId = previous?.id ?? randomUUID();
      const actorId = randomUUID();
      const delegationId = randomUUID();
      const scopes = [
        ...QUERY_SCOPES,
        ...(command.mode === 'ingest' ? ['data.ingestion.write'] : []),
      ]
        .filter(
          (scope) =>
            context.scopes.includes(scope) &&
            this.#options.knownScopes.has(scope),
        )
        .sort();
      if (!scopes.includes('data.catalog.read'))
        throw new AgentConnectionError('NOT_AUTHORIZED');
      const { rows: times } = await client.query<{ expires_at: Date }>(
        `select statement_timestamp()+make_interval(secs=>$1) as expires_at`,
        [command.expiresInSeconds],
      );
      const expiresAt = times[0]?.expires_at;
      if (expiresAt === undefined) throw new Error('Agent expiry unavailable.');
      await client.query(
        `insert into platform.actors(id,actor_type) values ($1,'agent')`,
        [actorId],
      );
      await client.query(
        'insert into platform.tenant_memberships(tenant_id,actor_id,expires_at) values ($1,$2,$3)',
        [command.tenantId, actorId, expiresAt],
      );
      await client.query(
        'insert into platform.project_memberships(project_id,tenant_id,actor_id,expires_at) values ($1,$2,$3,$4)',
        [command.projectId, command.tenantId, actorId, expiresAt],
      );
      await client.query(
        `insert into platform.delegations(id,delegated_by_actor_id,delegate_actor_id,tenant_id,project_id,scopes,purpose,max_security_level,expires_at)
        values ($1,$2,$3,$4,$5,$6,'agent-data',$7,$8)`,
        [
          delegationId,
          human.userId,
          actorId,
          command.tenantId,
          command.projectId,
          scopes,
          command.maxSecurityLevel,
          expiresAt,
        ],
      );
      if (previous) {
        await client.query(
          `update platform.delegations set status='revoked',revoked_at=statement_timestamp(),version=version+1 where id=$1 and status<>'revoked'`,
          [previous.delegation_id],
        );
        await client.query(
          'update platform_private.agent_connections set delegation_id=$2,resource=$3,version=version+1,updated_at=statement_timestamp() where id=$1',
          [connectionId, delegationId, this.#options.resource],
        );
      } else {
        await client.query(
          'insert into platform_private.agent_connections(id,owner_actor_id,oauth_client_id,delegation_id,resource) values ($1,$2,$3,$4,$5)',
          [
            connectionId,
            human.userId,
            request.client_id,
            delegationId,
            this.#options.resource,
          ],
        );
      }
      const connection: PlatformAgentConnectionView = {
        connectionId,
        clientId: request.client_id,
        delegationId,
        tenantId: command.tenantId,
        projectId: command.projectId,
        scopes,
        purpose: 'agent-data',
        maxSecurityLevel: command.maxSecurityLevel,
        expiresAt: expiresAt.toISOString(),
        status: 'active',
      };
      await this.#record(
        client,
        human.userId,
        connection,
        'authorize',
        state,
        connection,
      );
      return connection;
    });
  }

  async exchange(input: CommandInput): Promise<PlatformAgentExchangeView> {
    const claims = await this.#options.verifyAgent(input.token);
    if (claims === null) throw new AgentConnectionError('NOT_AUTHENTICATED');
    return this.#transaction(async (client) => {
      const { rows } = await client.query<ConnectionRow>(
        `${CONNECTION_SELECT}
        join auth.sessions s on s.id=$2 and s.user_id=c.owner_actor_id and s.oauth_client_id=c.oauth_client_id
        join auth.oauth_clients oauth on oauth.id=c.oauth_client_id and oauth.deleted_at is null
        join auth.oauth_consents consent on consent.user_id=c.owner_actor_id and consent.client_id=c.oauth_client_id and consent.revoked_at is null
        where c.owner_actor_id=$1 and c.oauth_client_id=$3 and c.delegation_id=$4 and c.resource=$5
          and d.status='active' and d.revoked_at is null and d.expires_at>statement_timestamp()
          and (s.not_after is null or s.not_after>statement_timestamp()) and $6::timestamptz>statement_timestamp()
        for share of c,d,s,oauth,consent`,
        [
          claims.userId,
          claims.sessionId,
          claims.clientId,
          claims.delegationId,
          this.#options.resource,
          claims.expiresAt,
        ],
      );
      if (!rows[0] || claims.resource !== this.#options.resource)
        throw new AgentConnectionError('NOT_AUTHORIZED');
      const connection = connectionView(rows[0]);
      const state = await this.#replay(
        client,
        claims.userId,
        input.idempotencyKey,
        'exchange',
        claims,
      );
      if (state.replay !== undefined)
        throw new AgentConnectionError('SECRET_NOT_RECOVERABLE');
      const issued = issueDelegatedCredential(this.#options.keyRing);
      const credentialId = randomUUID();
      const inserted = await client.query<{ expires_at: Date }>(
        `insert into platform_private.delegated_credentials(id,delegation_id,key_id,hmac_key_id,token_hmac,expires_at,credential_kind)
        values ($1,$2,$3,$4,$5,least(statement_timestamp()+interval '60 seconds',$6::timestamptz,$7::timestamptz),'agent_exchange') returning expires_at`,
        [
          credentialId,
          connection.delegationId,
          issued.keyId,
          issued.hmacKeyId,
          Buffer.from(issued.tokenHmac),
          claims.expiresAt,
          connection.expiresAt,
        ],
      );
      await client.query(
        'insert into platform_private.agent_exchange_credentials(credential_id,connection_id,oauth_session_id,oauth_token_expires_at) values ($1,$2,$3,$4)',
        [
          credentialId,
          connection.connectionId,
          claims.sessionId,
          claims.expiresAt,
        ],
      );
      const resolver = new DelegatedCredentialPrincipalResolver({
        keyRing: this.#options.keyRing,
        knownScopes: this.#options.knownScopes,
        loadRecord: createPostgresDelegatedCredentialRecordLoader(
          (text, values) =>
            client.query<DelegatedCredentialAuthorizationRow>(text, values),
        ),
      });
      const context = await resolver.resolve({
        token: issued.token,
        tenantId: connection.tenantId,
        projectId: connection.projectId,
        purpose: connection.purpose,
        traceId: randomUUID().replaceAll('-', ''),
      });
      if (context === null) throw new AgentConnectionError('NOT_AUTHORIZED');
      const expiresAt = inserted.rows[0]?.expires_at.toISOString();
      if (expiresAt === undefined)
        throw new Error('Agent credential expiry unavailable.');
      await this.#record(client, claims.userId, connection, 'exchange', state);
      return {
        connection: {
          ...connection,
          scopes: [...context.authorization.scopes],
          maxSecurityLevel: context.authorization.maxSecurityLevel,
        },
        token: issued.token,
        expiresAt,
      };
    });
  }

  async list(
    input: IdentityInput,
  ): Promise<readonly PlatformAgentConnectionView[]> {
    const human = await this.#human(input.token);
    return this.#transaction(async (client) => {
      await this.#liveHuman(client, human);
      const result = await client.query<ConnectionRow>(
        `${CONNECTION_SELECT} where c.owner_actor_id=$1 order by c.updated_at desc,c.id limit 100`,
        [human.userId],
      );
      return result.rows.map(connectionView);
    });
  }

  async revoke(
    input: CommandInput & { readonly connectionId: string },
  ): Promise<void> {
    if (!PlatformUuidSchema.safeParse(input.connectionId).success)
      throw new AgentConnectionError('VALIDATION_FAILED');
    const human = await this.#human(input.token);
    await this.#transaction(async (client) => {
      await this.#liveHuman(client, human);
      const state = await this.#replay(
        client,
        human.userId,
        input.idempotencyKey,
        'revoke',
        { connectionId: input.connectionId },
      );
      if (state.replay !== undefined) return;
      const { rows } = await client.query<ConnectionRow>(
        `${CONNECTION_SELECT} where c.owner_actor_id=$1 and c.id=$2 for update of c,d`,
        [human.userId, input.connectionId],
      );
      if (!rows[0]) throw new AgentConnectionError('NOT_AUTHORIZED');
      const connection = connectionView(rows[0]);
      await client.query(
        `update platform.delegations set status='revoked',revoked_at=statement_timestamp(),version=version+1 where id=$1 and status<>'revoked'`,
        [connection.delegationId],
      );
      await this.#record(client, human.userId, connection, 'revoke', state);
    });
  }
}
