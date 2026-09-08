import { randomUUID } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import { describe, expect, it } from 'vitest';
import { ExplorationResultSchema } from '@wiser/data-contracts';
import { PostgresExplorationExecutor } from '../src/data-foundation/exploration-runtime.js';
import type { DataCapabilityExecutionContext } from '../src/data-foundation/capability-handler.js';
import type { QueryAdapterPgPool } from '../src/data-foundation/query-adapters.js';

function scopedPool(client: PoolClient, role: string): QueryAdapterPgPool {
  return {
    async connect() {
      await client.query(`set local role ${role}`);
      return {
        async query(sql, values = []) {
          if (sql.toLowerCase().startsWith('begin')) {
            await client.query('savepoint exploration');
            return { rows: [] };
          }
          if (sql === 'commit') {
            await client.query('release savepoint exploration');
            return { rows: [] };
          }
          if (sql === 'rollback') {
            await client.query('rollback to savepoint exploration');
            await client.query('release savepoint exploration');
            return { rows: [] };
          }
          try {
            return await client.query(sql, [...values]);
          } catch (error) {
            // The fixture contains synthetic data only; surface PostgreSQL diagnostics.
            console.error(error);
            throw error;
          }
        },
        release() {},
      };
    },
  };
}

describe('authorized exploration result sets in PostgreSQL', () => {
  it.skipIf(process.env['WISER_DATA_PG_INTEGRATION'] !== '1')(
    'pins versions and totals across pages, rejects foreign, expired and stale-policy result sets',
    async () => {
      const pool = new Pool({
        connectionString: process.env['DATA_TEST_DATABASE_URL'],
        max: 1,
      });
      const client = await pool.connect();
      const tenant = randomUUID();
      const project = randomUUID();
      const actor = randomUUID();
      const item = randomUUID();
      const secondItem = randomUUID();
      const version = randomUUID();
      const secondVersion = randomUUID();
      const role = `wiser_explore_test_${actor.replaceAll('-', '')}`;
      const context: DataCapabilityExecutionContext = {
        principal: {
          actorId: actor,
          actorType: 'human',
          authenticationMethod: 'supabase_jwt',
          authUserId: actor,
          sessionId: randomUUID(),
          expiresAt: '2099-01-01T00:00:00.000Z',
        },
        authorization: {
          tenantId: tenant,
          projectId: project,
          roles: ['data-steward'],
          scopes: ['data.query.execute', 'data.catalog.read'],
          purpose: 'integration-test',
          maxSecurityLevel: 'L1_INTERNAL',
          authzVersion: 1,
        },
        effectiveMaxSecurityLevel: 'L1_INTERNAL',
        traceId: 'a'.repeat(32),
        auditLevel: 'DETAILED',
        timeoutMs: 30000,
        signal: new AbortController().signal,
      };
      const insertVersion = async (
        dataItemId: string,
        versionId: string,
        number: number,
      ) => {
        await client.query(
          `insert into catalog.data_item_version (version_id,tenant_id,project_id,data_item_id,version_number,asset_manifest,source_hash,metadata_hash,processing_stage,generation_method,quality_grade,acceptance_status,publication_status,security_level,committed_at,published_at) values ($1,$2,$3,$4,$5,$6,decode(repeat('a',64),'hex'),decode(repeat('b',64),'hex'),'RAW','OBSERVED','C','PASSED','PUBLISHED','L1_INTERNAL',now(),now())`,
          [
            versionId,
            tenant,
            project,
            dataItemId,
            number,
            JSON.stringify({
              sourceRegistration: {
                kind: 'CATALOG_ENTRY',
                providerName: 'Fixture provider',
                limitations: ['Source registration only.'],
              },
            }),
          ],
        );
      };
      try {
        await client.query('begin');
        await client.query(
          `create role ${role} nologin nosuperuser nobypassrls`,
        );
        await client.query(
          `grant usage on schema catalog, knowledge, security, service to ${role}`,
        );
        await client.query(
          `grant execute on all functions in schema security to ${role}`,
        );
        await client.query(
          `grant select on all tables in schema catalog, knowledge, service to ${role}`,
        );
        await client.query(
          `grant insert, delete on service.exploration_snapshot to ${role}`,
        );
        for (const [id, name] of [
          [item, 'Alpha water'],
          [secondItem, 'Beta water'],
        ]) {
          await client.query(
            `insert into catalog.data_item (data_item_id,tenant_id,project_id,owner_project_id,name,business_domains,source_natures,source_channels,processing_stage,intended_uses,source_organization,authorization_scope,citation_requirements,unit_definitions,missing_value_rules,anomaly_rules,generation_method,quality_grade,acceptance_status,publication_status,security_level,version,update_mode) values ($1,$2,$3,$3,$4,array['water'],array['observed'],array['file-upload'],'RAW',array['analysis'],'Fixture provider','data.catalog.read','{}','[]','[]','[]','OBSERVED','C','PASSED','PUBLISHED','L1_INTERNAL',1,'SNAPSHOT')`,
            [id, tenant, project, name],
          );
        }
        await insertVersion(item, version, 1);
        await insertVersion(secondItem, secondVersion, 1);
        const executor = new PostgresExplorationExecutor(
          scopedPool(client, role),
        );
        const first = ExplorationResultSchema.parse(
          await executor.execute(
            { spec: { text: 'water' }, view: 'resources', first: 1 },
            context,
          ),
        );
        expect(first.totalCount).toBe(2);
        expect(first.resources).toHaveLength(1);
        expect(first.resources[0]).toMatchObject({
          dataItemId: item,
          versionId: version,
          recordCount: null,
          featureCount: null,
          readiness: { records: 'NOT_PARSED', spatial: 'NOT_PARSED' },
        });
        expect(first.nextCursor).toBeTypeOf('string');
        const next = ExplorationResultSchema.parse(
          await executor.execute(
            {
              queryId: first.queryId,
              view: 'resources',
              first: 1,
              after: first.nextCursor,
            },
            context,
          ),
        );
        expect(next.resources.map((resource) => resource.dataItemId)).toEqual([
          secondItem,
        ]);
        expect(next.totalCount).toBe(2);
        expect(next.nextCursor).toBeUndefined();
        await client.query('reset role');
        const newer = randomUUID();
        await insertVersion(item, newer, 2);
        const pinned = ExplorationResultSchema.parse(
          await executor.execute(
            { queryId: first.queryId, view: 'resources' },
            context,
          ),
        );
        expect(pinned.resources[0]?.versionId).toBe(version);
        const fresh = ExplorationResultSchema.parse(
          await executor.execute(
            { spec: { dataItemIds: [item] }, view: 'resources' },
            context,
          ),
        );
        expect(fresh.resources[0]?.versionId).toBe(newer);
        const historical = ExplorationResultSchema.parse(
          await executor.execute(
            {
              spec: { versions: [{ dataItemId: item, versionId: version }] },
              view: 'resources',
            },
            context,
          ),
        );
        expect(historical.resources[0]?.versionId).toBe(version);
        await expect(
          executor.execute(
            { queryId: first.queryId, view: 'resources', after: fresh.queryId },
            context,
          ),
        ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
        for (const forbidden of [
          {
            ...context,
            principal: { ...context.principal, actorId: randomUUID() },
          },
          {
            ...context,
            authorization: {
              ...context.authorization,
              projectId: randomUUID(),
            },
          },
          {
            ...context,
            authorization: { ...context.authorization, tenantId: randomUUID() },
          },
          {
            ...context,
            authorization: { ...context.authorization, authzVersion: 2 },
          },
          {
            ...context,
            authorization: {
              ...context.authorization,
              purpose: 'different-purpose',
            },
          },
          { ...context, effectiveMaxSecurityLevel: 'L0_PUBLIC' as const },
        ])
          await expect(
            executor.execute(
              { queryId: first.queryId, view: 'resources' },
              forbidden,
            ),
          ).rejects.toMatchObject({ code: 'NOT_FOUND' });
        const empty = ExplorationResultSchema.parse(
          await executor.execute(
            { spec: { text: 'not-present' }, view: 'resources' },
            context,
          ),
        );
        expect(empty.totalCount).toBe(0);
        expect(empty.resources).toEqual([]);
        await client.query('reset role');
        const expired = randomUUID();
        await client.query(
          `insert into service.exploration_snapshot(query_id,tenant_id,project_id,actor_id,purpose,security_level,policy_version,spec,version_refs,created_at,expires_at) values ($1,$2,$3,$4,'integration-test','L1_INTERNAL',1,'{}','[]',now()-interval '2 hours',now()-interval '90 minutes')`,
          [expired, tenant, project, actor],
        );
        await expect(
          executor.execute({ queryId: expired, view: 'resources' }, context),
        ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      } finally {
        await client.query('rollback');
        client.release();
        await pool.end();
      }
    },
  );
});
