import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';

import {
  DelegatedCredentialPrincipalResolver,
  PostgresAgentConnectionService,
  createPostgresDelegatedCredentialRecordLoader,
  type PlatformDelegationTransactionPool,
  type VerifiedSupabaseAgentClaims,
} from '@wiser/platform-auth';

const databaseUrl = process.env['WISER_AGENT_TEST_DATABASE_URL'];
const owner = '10000000-0000-4000-8000-000000000005';
const tenant = 'b1000000-0000-4000-8000-000000000001';
const project = 'b2000000-0000-4000-8000-000000000001';
const resource = 'https://mcp.example.test/mcp';
const humanSession = randomUUID();
const keyRing = {
  activeKeyId: 'test',
  keys: new Map([['test', new Uint8Array(32).fill(9)]]),
};
const knownScopes = new Set([
  'data.catalog.read',
  'data.query.execute',
  'data.search.execute',
  'data.knowledge.read',
  'data.graph.read',
  'data.geo.read',
  'data.operation.read',
  'data.ingestion.write',
  'data.publish',
]);

describe.skipIf(databaseUrl === undefined)(
  'Agent connections against isolated Supabase',
  () => {
    const pool = new Pool({ connectionString: databaseUrl, max: 5 });
    const tokens = new Map<string, VerifiedSupabaseAgentClaims>();
    const transactionPool: PlatformDelegationTransactionPool = {
      async connect() {
        const client = await pool.connect();
        return {
          async query<Row>(text: string, values: readonly unknown[] = []) {
            const result = await client.query(text, [...values]);
            return { rows: result.rows as Row[], rowCount: result.rowCount };
          },
          release() {
            client.release();
          },
        };
      },
    };
    const service = new PostgresAgentConnectionService({
      pool: transactionPool,
      resource,
      keyRing,
      knownScopes,
      verifyHuman: (token) =>
        Promise.resolve(
          token === 'human'
            ? {
                userId: owner,
                sessionId: humanSession,
              }
            : null,
        ),
      verifyAgent: (token) => Promise.resolve(tokens.get(token) ?? null),
    });
    const resolver = new DelegatedCredentialPrincipalResolver({
      keyRing,
      knownScopes,
      loadRecord: createPostgresDelegatedCredentialRecordLoader(
        async (text, values) => {
          const result = await pool.query(text, [...values]);
          return { rows: result.rows };
        },
      ),
    });

    beforeAll(async () => {
      await pool.query('insert into auth.sessions(id,user_id) values ($1,$2)', [
        humanSession,
        owner,
      ]);
    });
    afterAll(async () => {
      await pool.end();
    });

    async function requestFixture(targetResource = resource) {
      const clientId = randomUUID();
      const authorizationId = randomUUID();
      const sessionId = randomUUID();
      await pool.query(
        `insert into auth.oauth_clients
      (id,registration_type,redirect_uris,grant_types,client_name,client_type,token_endpoint_auth_method)
      values ($1,'dynamic','http://127.0.0.1:49555/callback','authorization_code,refresh_token','Test Agent','public','none')`,
        [clientId],
      );
      await pool.query(
        `insert into auth.oauth_authorizations
      (id,authorization_id,client_id,user_id,redirect_uri,scope,resource,code_challenge,code_challenge_method)
      values ($1::uuid,$1::text,$2,$3,'http://127.0.0.1:49555/callback','openid',$4,$5,'s256')`,
        [authorizationId, clientId, owner, targetResource, 'a'.repeat(43)],
      );
      await pool.query(
        'insert into auth.sessions(id,user_id,oauth_client_id) values ($1,$2,$3)',
        [sessionId, owner, clientId],
      );
      await pool.query(
        `insert into auth.oauth_consents(id,user_id,client_id,scopes) values ($1,$2,$3,'openid')`,
        [randomUUID(), owner, clientId],
      );
      return { clientId, authorizationId, sessionId };
    }

    async function connect(mode: 'query' | 'ingest' = 'query') {
      const fixture = await requestFixture();
      const input = {
        token: 'human',
        idempotencyKey: randomUUID(),
        command: {
          authorizationId: fixture.authorizationId,
          tenantId: tenant,
          projectId: project,
          mode,
          expiresInSeconds: 900,
        },
      };
      const connection = await service.authorize(input);
      const token = randomUUID();
      tokens.set(token, {
        userId: owner,
        sessionId: fixture.sessionId,
        clientId: fixture.clientId,
        delegationId: connection.delegationId,
        resource,
        expiresAt: new Date(Date.now() + 300_000).toISOString(),
      });
      return { ...fixture, input, connection, token };
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

    it('requires a live direct session and shows only authorized project choices', async () => {
      const fixture = await requestFixture();
      await expect(
        service.inspect({
          token: 'not-human',
          authorizationId: fixture.authorizationId,
        }),
      ).rejects.toMatchObject({ code: 'NOT_AUTHENTICATED' });
      const view = await service.inspect({
        token: 'human',
        authorizationId: fixture.authorizationId,
      });
      expect(view.clientId).toBe(fixture.clientId);
      expect(view.projects).toContainEqual(
        expect.objectContaining({
          tenantId: tenant,
          projectId: project,
          modes: ['query', 'ingest'],
        }),
      );
      const wrongResource = await requestFixture(
        'https://other.example.test/mcp',
      );
      await expect(
        service.inspect({
          token: 'human',
          authorizationId: wrongResource.authorizationId,
        }),
      ).rejects.toMatchObject({ code: 'NOT_AUTHORIZED' });
    });

    it('binds issuance, replay, scope, project and parallel exchanges to the approved connection', async () => {
      const setup = await connect();
      await expect(service.authorize(setup.input)).resolves.toEqual(
        setup.connection,
      );
      await expect(
        service.authorize({
          ...setup.input,
          command: { ...setup.input.command, mode: 'ingest' },
        }),
      ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
      const exchanges = await Promise.all(
        [0, 1].map(() =>
          service.exchange({
            token: setup.token,
            idempotencyKey: randomUUID(),
          }),
        ),
      );
      for (const exchange of exchanges) {
        const context = await resolve(exchange.token);
        expect(context?.authorization.scopes).toContain('data.catalog.read');
        expect(context?.authorization.scopes).not.toContain(
          'data.ingestion.write',
        );
        expect(context?.authorization.scopes).not.toContain('data.publish');
        expect(context?.authorization.projectId).toBe(project);
        expect(context?.principal.actorType).toBe('agent');
        expect(Date.parse(exchange.expiresAt) - Date.now()).toBeLessThanOrEqual(
          60_000,
        );
        await expect(resolve(exchange.token, randomUUID())).resolves.toBeNull();
      }
      expect(exchanges[0]?.token).not.toBe(exchanges[1]?.token);
      const stored = await pool.query(
        `select token_hmac from platform_private.delegated_credentials where delegation_id=$1`,
        [setup.connection.delegationId],
      );
      expect(stored.rows).toHaveLength(2);
      expect(JSON.stringify(stored.rows)).not.toContain(exchanges[0]?.token);
    });

    it('rejects unowned projects and excess duration before changing the control plane', async () => {
      const fixture = await requestFixture();
      const command = {
        authorizationId: fixture.authorizationId,
        tenantId: tenant,
        projectId: randomUUID(),
        mode: 'query',
        expiresInSeconds: 900,
      } as const;
      await expect(
        service.authorize({
          token: 'human',
          idempotencyKey: randomUUID(),
          command,
        }),
      ).rejects.toMatchObject({ code: 'NOT_AUTHORIZED' });
      await expect(
        service.authorize({
          token: 'human',
          idempotencyKey: randomUUID(),
          command: { ...command, projectId: project, expiresInSeconds: 86_400 },
        }),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    });

    it('allows ingestion only when explicitly approved and immediately honors OAuth consent revocation', async () => {
      const setup = await connect('ingest');
      const exchange = await service.exchange({
        token: setup.token,
        idempotencyKey: randomUUID(),
      });
      expect((await resolve(exchange.token))?.authorization.scopes).toContain(
        'data.ingestion.write',
      );
      await pool.query(
        'update auth.oauth_consents set revoked_at=statement_timestamp() where client_id=$1',
        [setup.clientId],
      );
      await expect(
        service.exchange({ token: setup.token, idempotencyKey: randomUUID() }),
      ).rejects.toMatchObject({ code: 'NOT_AUTHORIZED' });
      await expect(resolve(exchange.token)).resolves.toBeNull();
    });

    it('invalidates an exchanged credential on session deletion or connection revocation', async () => {
      const setup = await connect();
      const exchange = await service.exchange({
        token: setup.token,
        idempotencyKey: randomUUID(),
      });
      await pool.query('delete from auth.sessions where id=$1', [
        setup.sessionId,
      ]);
      await expect(resolve(exchange.token)).resolves.toBeNull();
      const another = await connect();
      const issued = await service.exchange({
        token: another.token,
        idempotencyKey: randomUUID(),
      });
      await service.revoke({
        token: 'human',
        connectionId: another.connection.connectionId,
        idempotencyKey: randomUUID(),
      });
      await expect(resolve(issued.token)).resolves.toBeNull();
      await expect(
        service.exchange({
          token: another.token,
          idempotencyKey: randomUUID(),
        }),
      ).rejects.toMatchObject({ code: 'NOT_AUTHORIZED' });
    });

    it('records mutations without credentials in audit and outbox', async () => {
      const setup = await connect();
      const idempotencyKey = randomUUID();
      const exchange = await service.exchange({
        token: setup.token,
        idempotencyKey,
      });
      await expect(
        service.exchange({ token: setup.token, idempotencyKey }),
      ).rejects.toMatchObject({ code: 'SECRET_NOT_RECOVERABLE' });
      const audit = await pool.query(
        'select context from platform_private.authorization_audit_events where resource_id=$1',
        [setup.connection.connectionId],
      );
      const outbox = await pool.query(
        'select payload from platform_private.control_outbox where aggregate_id=$1',
        [setup.connection.connectionId],
      );
      expect(audit.rows.length).toBeGreaterThanOrEqual(2);
      expect(outbox.rows.length).toBeGreaterThanOrEqual(2);
      expect(JSON.stringify([audit.rows, outbox.rows])).not.toContain(
        exchange.token,
      );
      expect(JSON.stringify([audit.rows, outbox.rows])).not.toContain(
        setup.token,
      );
    });

    it('prevents removing the OAuth binding by changing credential kind', async () => {
      const setup = await connect();
      await service.exchange({
        token: setup.token,
        idempotencyKey: randomUUID(),
      });
      await expect(
        pool.query(
          `update platform_private.delegated_credentials set credential_kind='delegated' where delegation_id=$1`,
          [setup.connection.delegationId],
        ),
      ).rejects.toMatchObject({ code: '23514' });
    });
  },
);
