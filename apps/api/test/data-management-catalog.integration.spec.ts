import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { expect, it } from 'vitest';
import { assertResourceManagementPolicy } from '@wiser/platform-auth';
import { createDataManagementCatalogReader } from '../src/data-foundation/management-catalog.js';

it.skipIf(process.env['WISER_DATA_PG_INTEGRATION'] !== '1')(
  'lists only appointed project metadata with provisioned column grants and current RLS helpers',
  async () => {
    const url = process.env['DATA_TEST_DATABASE_URL'];
    if (!url) throw Error('DATA_TEST_DATABASE_URL is required');
    const pool = new Pool({ connectionString: url, max: 1 });
    const client = await pool.connect();
    const tenantId = randomUUID(),
      projectId = randomUUID(),
      actorId = randomUUID();
    const runner = `management_api_${randomUUID().replaceAll('-', '')}`;
    const source = Array.from({ length: 6 }, () => ({
      dataItemId: randomUUID(),
      versionId: randomUUID(),
      assetId: randomUUID(),
    }));
    const context = {
      principal: {
        actorType: 'human' as const,
        actorId,
        authUserId: actorId,
        sessionId: randomUUID(),
        authenticationMethod: 'supabase_jwt' as const,
      },
      traceId: 'a'.repeat(32),
      authorization: {
        tenantId,
        projectId,
        purpose: 'web-console',
        maxSecurityLevel: 'L1_INTERNAL' as const,
        roles: ['source-steward'],
        scopes: ['platform.membership.manage'],
        authzVersion: 1,
      },
    };
    try {
      await client.query('begin');
      await client.query(
        `create role ${runner} nologin nosuperuser nobypassrls`,
      );
      await client.query(
        `grant ${runner} to current_user with inherit false, set true`,
      );
      await client.query(
        `do $$ begin if not exists(select 1 from pg_roles where rolname='wiser_data_metadata') then
          create role wiser_data_metadata nologin noinherit nosuperuser nobypassrls;
        end if; end $$`,
      );
      await client.query(
        `grant wiser_data_metadata to ${runner} with inherit false, set true`,
      );
      // Use deployment's grants, not a second list that can diverge from the
      // installed RLS policies. The fixture and all grants roll back together.
      const provisioning = await readFile(
        new URL(
          '../../../infrastructure/data-foundation/postgres/provision-runtime.sql',
          import.meta.url,
        ),
        'utf8',
      );
      const metadataStart = provisioning.indexOf('-- Only these columns');
      expect(metadataStart).toBeGreaterThan(0);
      await client.query(
        provisioning.slice(metadataStart).replace(/commit;\s*$/, ''),
      );
      for (const [index, s] of source.entries()) {
        const otherProject = index === 1 ? randomUUID() : projectId;
        const security = index === 2 ? 'L2_RESTRICTED' : 'L1_INTERNAL';
        const published = index === 3 ? 'WITHDRAWN' : 'PUBLISHED';
        const accepted = index === 4 ? 'REJECTED' : 'PASSED';
        const authorizationScope = index === 5 ? '' : 'test';
        await client.query(
          `insert into catalog.data_item(data_item_id,tenant_id,project_id,owner_project_id,name,
          business_domains,source_natures,source_channels,processing_stage,intended_uses,
          source_organization,authorization_scope,generation_method,quality_grade,
          acceptance_status,publication_status,security_level,update_mode,source_contact)
          values($1,$2,$3,$3,$4,array['water-quality'],array['observed'],array['official'],
          'RAW',array['research'],'Synthetic provider',$8,'SYNTHETIC','A',$7,$5,$6,
          'SNAPSHOT','{"private":"never return"}')`,
          [
            s.dataItemId,
            tenantId,
            otherProject,
            `Synthetic ${index}`,
            published,
            security,
            accepted,
            authorizationScope,
          ],
        );
        await client.query(
          `insert into catalog.data_item_version(version_id,tenant_id,project_id,data_item_id,
          version_number,asset_manifest,source_hash,metadata_hash,processing_stage,
          generation_method,quality_grade,acceptance_status,publication_status,security_level,
          committed_at) values($1,$2,$3,$4,1,'{"private":"manifest"}',
          decode(repeat('ab',32),'hex'),decode(repeat('cd',32),'hex'),
          'RAW','SYNTHETIC','A',$7,$5,$6,now())`,
          [
            s.versionId,
            tenantId,
            otherProject,
            s.dataItemId,
            published,
            security,
            accepted,
          ],
        );
      }
      await client.query(`set local role ${runner}`);
      const runtimePool = {
        connect: () =>
          Promise.resolve({
            query: async (sql: string, values?: readonly unknown[]) => {
              if (/^begin read only$/i.test(sql)) {
                await client.query('savepoint management_catalog');
                return { rows: [] };
              }
              if (/^commit$/i.test(sql) || /^rollback$/i.test(sql)) {
                await client.query('rollback to savepoint management_catalog');
                await client.query('release savepoint management_catalog');
                return { rows: [] };
              }
              return client.query<Record<string, unknown>>(
                sql,
                values ? [...values] : undefined,
              );
            },
            release() {},
          }),
      };
      const permit = async () =>
        assertResourceManagementPolicy(
          {
            context,
            client: {
              release() {},
              query: <Row>() =>
                Promise.resolve({
                  rows: [
                    {
                      snapshot: {
                        mode: 'managed',
                        tenantId,
                        projectId,
                        actorId,
                        purpose: 'web-console',
                        now: new Date().toISOString(),
                        revision: 1,
                        grants: [],
                        limits: [],
                      },
                    },
                  ] as Row[],
                  rowCount: 1,
                }),
            },
          },
          [],
          [],
        );
      const read = createDataManagementCatalogReader(runtimePool);
      const page = await read({
        context,
        page: { offset: 0, limit: 20, search: 'Synthetic' },
        signal: new AbortController().signal,
        managementPermit: await permit(),
      });
      expect(page.items.map((r) => r.dataItemId)).toEqual([
        source[0]!.dataItemId,
      ]);
      expect(page.items[0]).not.toHaveProperty('sourceContact');
      expect(page.items[0]).not.toHaveProperty('assetManifest');
      expect(
        (await client.query<{ role: string }>('select current_user role'))
          .rows[0]?.role,
      ).toBe(runner);

      await client.query('savepoint metadata_denial');
      await client.query('set local role wiser_data_metadata');
      for (const sql of [
        'select source_contact from catalog.data_item',
        'select asset_manifest from catalog.data_item_version',
        'select * from catalog.asset',
        'select * from knowledge.evidence_fragment',
      ]) {
        await client.query('savepoint denied_read');
        await expect(client.query(sql)).rejects.toThrow();
        await client.query('rollback to savepoint denied_read');
      }
      await client.query('rollback to savepoint metadata_denial');
      const wrongProject = structuredClone(context);
      wrongProject.authorization.projectId = randomUUID();
      await expect(
        read({
          context: wrongProject,
          page: { offset: 0, limit: 20, search: '' },
          signal: new AbortController().signal,
          managementPermit: await permit(),
        }),
      ).rejects.toThrow();
    } finally {
      await client.query('rollback');
      client.release();
      await pool.end();
    }
  },
  30000,
);
