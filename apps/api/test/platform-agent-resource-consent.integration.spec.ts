import { randomUUID } from 'node:crypto';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import { Pool, type PoolClient } from 'pg';
import {
  DelegatedCredentialPrincipalResolver,
  PostgresAgentConnectionService,
  ResourceScopedPrincipalResolver,
  createPostgresDelegatedCredentialRecordLoader,
  createPostgresResourceAuthorityLoader,
  type PlatformDelegationTransactionPool,
  type VerifiedSupabaseAgentClaims,
} from '@wiser/platform-auth';

const databaseUrl = process.env['WISER_AGENT_TEST_DATABASE_URL'];
const owner = '10000000-0000-4000-8000-000000000005';
const approver = '10000000-0000-4000-8000-000000000002';
const tenant = 'b1000000-0000-4000-8000-000000000001';
const project = 'b2000000-0000-4000-8000-000000000001';
const resource = 'https://mcp.example.test/mcp';
const humanSession = randomUUID();
const keyRing = {
  activeKeyId: 'test',
  keys: new Map([['test', new Uint8Array(32).fill(9)]]),
};
const knownScopes = new Set(['data.catalog.read', 'data.query.execute']);
const refs = [0, 1].map(() => ({
  kind: 'version' as const,
  dataItemId: randomUUID(),
  versionId: randomUUID(),
}));
const packages = [randomUUID(), randomUUID()];
const preset = randomUUID();

describe.skipIf(databaseUrl === undefined)(
  'managed MCP consent against isolated Supabase',
  () => {
    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    let client: PoolClient;
    let failAudit = false;
    const tokens = new Map<string, VerifiedSupabaseAgentClaims>();
    const txPool: PlatformDelegationTransactionPool = {
      connect: () =>
        Promise.resolve({
          async query<Row>(sql: string, values: readonly unknown[] = []) {
            if (
              failAudit &&
              sql.includes(
                'insert into platform_private.resource_access_events',
              )
            )
              throw new Error('Synthetic audit outage');
            const text =
              sql === 'begin'
                ? 'savepoint consent_service'
                : sql === 'commit'
                  ? 'release savepoint consent_service'
                  : sql === 'rollback'
                    ? 'rollback to savepoint consent_service'
                    : sql;
            const result = await client.query(text, [...values]);
            return { rows: result.rows as Row[], rowCount: result.rowCount };
          },
          release() {},
        }),
    };
    const service = new PostgresAgentConnectionService({
      pool: txPool,
      resource,
      keyRing,
      knownScopes,
      verifyHuman: () =>
        Promise.resolve({ userId: owner, sessionId: humanSession }),
      verifyAgent: (token) => Promise.resolve(tokens.get(token) ?? null),
    });
    const query = async (sql: string, values: readonly unknown[]) => {
      const result = await client.query(sql, [...values]);
      return { rows: result.rows };
    };
    const resolver = new ResourceScopedPrincipalResolver({
      base: new DelegatedCredentialPrincipalResolver({
        keyRing,
        knownScopes,
        loadRecord: createPostgresDelegatedCredentialRecordLoader(query),
      }),
      load: createPostgresResourceAuthorityLoader(query),
    });
    beforeAll(async () => {
      client = await pool.connect();
      await client.query('begin');
      await client.query(
        'insert into auth.sessions(id,user_id) values($1,$2)',
        [humanSession, owner],
      );
      await client.query(
        'insert into platform_private.resource_access_settings(project_id,tenant_id,enabled_by) values($1,$2,$3)',
        [project, tenant, owner],
      );
      await client.query(
        "insert into platform_private.resource_preset_versions(project_id,preset_id,version,name,actions,max_days,approval_level,created_by) values($1,$2,1,'Synthetic read',array['content.read'],1,'ordinary',$3)",
        [project, preset, owner],
      );
      for (const [index, ref] of refs.entries()) {
        await client.query(
          "insert into platform_private.resource_package_versions(project_id,package_id,version,name,resources,allowed_actions,license_basis,created_by) values($1,$2,1,'Synthetic immutable resource',$3,array['content.read'],'Synthetic permission test',$4)",
          [project, packages[index], JSON.stringify([ref]), owner],
        );
        await client.query(
          "insert into platform_private.resource_policy_versions(project_id,policy_id,version,resource,allowed_actions,management_roles,license_basis,starts_at,expires_at,max_grant_days,created_by,approved_by) values($1,$2,1,$3,array['content.read'],array['platform-owner'],'Synthetic independent source license',now()-interval '1 day',now()+interval '1 day',1,$4,$5)",
          [project, randomUUID(), JSON.stringify(ref), owner, approver],
        );
      }
    });
    beforeEach(async () => {
      failAudit = false;
      await client.query('savepoint scenario');
    });
    afterEach(async () => {
      await client.query('rollback to savepoint scenario');
    });
    afterAll(async () => {
      if (client) {
        await client.query('rollback');
        client.release();
      }
      await pool.end();
    });

    async function grant(
      index = 0,
      purpose = 'agent-data',
      starts = -60,
      expires = 3600,
    ) {
      const id = randomUUID();
      await client.query(
        "insert into platform_private.resource_grants(id,project_id,actor_id,package_id,package_version,preset_id,preset_version,purpose,starts_at,expires_at,created_by,approved_by,reason) values($1,$2,$3,$4,1,$5,1,$6,statement_timestamp()+make_interval(secs=>$7),statement_timestamp()+make_interval(secs=>$8),$9,$9,'Synthetic independent approval')",
        [
          id,
          project,
          owner,
          packages[index],
          preset,
          purpose,
          starts,
          expires,
          approver,
        ],
      );
      return id;
    }
    async function revoke(grantId: string) {
      await client.query(
        "insert into platform_private.resource_revocations(grant_id,project_id,revoked_by,reason) values($1,$2,$3,'Synthetic owner access removal')",
        [grantId, project, approver],
      );
    }
    async function oauth(clientId = randomUUID()) {
      const authorizationId = randomUUID(),
        sessionId = randomUUID();
      await client.query(
        "insert into auth.oauth_clients(id,registration_type,redirect_uris,grant_types,client_name,client_type,token_endpoint_auth_method) values($1,'dynamic','http://127.0.0.1:49555/callback','authorization_code,refresh_token','Test managed client','public','none') on conflict(id) do nothing",
        [clientId],
      );
      await client.query(
        "insert into auth.oauth_authorizations(id,authorization_id,client_id,user_id,redirect_uri,scope,resource,code_challenge,code_challenge_method) values($1::uuid,$1::text,$2,$3,'http://127.0.0.1:49555/callback','openid',$4,$5,'s256')",
        [authorizationId, clientId, owner, resource, 'a'.repeat(43)],
      );
      await client.query(
        'insert into auth.sessions(id,user_id,oauth_client_id) values($1,$2,$3)',
        [sessionId, owner, clientId],
      );
      await client.query(
        "insert into auth.oauth_consents(id,user_id,client_id,scopes) values($1,$2,$3,'openid') on conflict(user_id,client_id) do nothing",
        [randomUUID(), owner, clientId],
      );
      return {
        clientId,
        sessionId,
        input: {
          token: 'human',
          idempotencyKey: randomUUID(),
          command: {
            authorizationId,
            tenantId: tenant,
            projectId: project,
            mode: 'query' as const,
            expiresInSeconds: 900,
          },
        },
      };
    }
    async function connect(clientId?: string) {
      const request = await oauth(clientId);
      const connection = await service.authorize(request.input);
      const token = randomUUID();
      tokens.set(token, {
        userId: owner,
        sessionId: request.sessionId,
        clientId: request.clientId,
        delegationId: connection.delegationId,
        resource,
        expiresAt: new Date(Date.now() + 300_000).toISOString(),
      });
      const exchanged = await service.exchange({
        token,
        idempotencyKey: randomUUID(),
      });
      return { ...request, connection, token: exchanged.token };
    }
    function resolve(token: string, projectId = project) {
      return resolver.resolve({
        token,
        tenantId: tenant,
        projectId,
        purpose: 'agent-data',
        traceId: 'a'.repeat(32),
      });
    }
    async function allowed(token: string) {
      return (await resolve(token))?.authorization.resourceAccess?.scope;
    }
    async function copies(delegationId: string) {
      return (
        await client.query(
          'select g.* from platform_private.resource_grants g join platform.delegations d on d.delegate_actor_id=g.actor_id where d.id=$1 order by g.id',
          [delegationId],
        )
      ).rows;
    }

    it('binds explicit consent to fixed live MCP grants, with traceable expiry and idempotent issuance', async () => {
      const parent = await grant(0, 'agent-data', -60, 300);
      await grant(1, 'web-console');
      await grant(1, 'agent-data', 60, 600);
      await grant(1, 'agent-data', -600, -30);
      await revoke(await grant(1));
      const setup = await connect();
      expect(await allowed(setup.token)).toMatchObject({
        mode: 'managed',
        permissions: { 'content.read': [refs[0]], 'original.read': [] },
      });
      expect(await resolve(setup.token, randomUUID())).toBeNull();
      await expect(service.authorize(setup.input)).resolves.toEqual(
        setup.connection,
      );
      const records = await copies(setup.connection.delegationId);
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({
        package_id: packages[0],
        package_version: 1,
        preset_version: 1,
        purpose: 'agent-data',
        created_by: owner,
        approved_by: owner,
      });
      const parentRow = (
        await client.query(
          'select expires_at from platform_private.resource_grants where id=$1',
          [parent],
        )
      ).rows[0];
      expect(records[0].expires_at).toEqual(parentRow.expires_at);
      const audits = (
        await client.query(
          "select before_state,after_state from platform_private.resource_access_events where subject_id=$1 and action='grant'",
          [records[0].id],
        )
      ).rows;
      expect(audits).toEqual([
        {
          before_state: { parentGrantId: parent, parentApprovedBy: approver },
          after_state: {
            grantId: records[0].id,
            connectionId: setup.connection.connectionId,
            delegationId: setup.connection.delegationId,
            actorId: records[0].actor_id,
            purpose: 'agent-data',
          },
        },
      ]);
    });
    it('caps long grants at the connection expiry and never grants resource access from project roles alone', async () => {
      const empty = await connect();
      expect(await allowed(empty.token)).toMatchObject({
        mode: 'managed',
        permissions: { 'content.read': [] },
      });
      await grant();
      expect(await allowed(empty.token)).toMatchObject({
        permissions: { 'content.read': [] },
      });
      const setup = await connect();
      expect(
        (
          await copies(setup.connection.delegationId)
        )[0]?.expires_at.toISOString(),
      ).toBe(setup.connection.expiresAt);
    });
    it('requires reconsent for new resources and invalidates the preceding connection token', async () => {
      await grant();
      const first = await connect();
      await grant(1);
      expect(await allowed(first.token)).toMatchObject({
        permissions: { 'content.read': [refs[0]] },
      });
      const second = await connect(first.clientId);
      expect(await resolve(first.token)).toBeNull();
      const current = await allowed(second.token);
      expect(current?.mode).toBe('managed');
      if (current?.mode !== 'managed') throw Error('Expected managed scope');
      expect(current.permissions['content.read']).toEqual(
        expect.arrayContaining(refs),
      );
      expect(current.permissions['content.read']).toHaveLength(2);
    });
    it('intersects the fixed grant with current owner and source permissions on every request', async () => {
      const parent = await grant();
      const setup = await connect();
      expect(await allowed(setup.token)).toMatchObject({
        permissions: { 'content.read': [refs[0]] },
      });
      await revoke(parent);
      expect(await allowed(setup.token)).toMatchObject({
        permissions: { 'content.read': [] },
      });
      await grant();
      expect(await allowed(setup.token)).toMatchObject({
        permissions: { 'content.read': [refs[0]] },
      });
      await client.query(
        "insert into platform_private.resource_policy_revocations(project_id,policy_id,version,revoked_by,reason) select project_id,policy_id,version,$2,'Synthetic permission removal' from platform_private.resource_policy_versions where project_id=$1",
        [project, approver],
      );
      expect(await allowed(setup.token)).toMatchObject({
        permissions: { 'content.read': [] },
      });
    });
    it('rolls back the identity, connection and grants if their required audit cannot be committed', async () => {
      await grant();
      const request = await oauth();
      const before = (
        await client.query('select count(*)::int n from platform.actors')
      ).rows[0].n;
      failAudit = true;
      await expect(service.authorize(request.input)).rejects.toThrow(
        'Synthetic audit outage',
      );
      expect(
        (await client.query('select count(*)::int n from platform.actors'))
          .rows[0].n,
      ).toBe(before);
      expect(
        (
          await client.query(
            'select id from platform_private.agent_connections where oauth_client_id=$1',
            [request.clientId],
          )
        ).rows,
      ).toEqual([]);
    });
    it('fails closed on an oversized consent scope instead of silently granting a partial set', async () => {
      await client.query(
        "insert into platform_private.resource_grants(project_id,actor_id,package_id,package_version,preset_id,preset_version,purpose,starts_at,expires_at,created_by,approved_by,reason) select $1,$2,$3,1,$4,1,'agent-data',statement_timestamp()-interval '1 minute',statement_timestamp()+interval '1 hour',$5,$5,'Synthetic bound acceptance' from generate_series(1,1001)",
        [project, owner, packages[0], preset, approver],
      );
      const request = await oauth();
      await expect(service.authorize(request.input)).rejects.toMatchObject({
        code: 'NOT_AUTHORIZED',
      });
      expect(
        (
          await client.query(
            'select id from platform_private.agent_connections where oauth_client_id=$1',
            [request.clientId],
          )
        ).rows,
      ).toEqual([]);
    });
  },
);
