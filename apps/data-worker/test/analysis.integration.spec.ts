import { randomUUID, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { expect, it } from 'vitest';
import type { DataPostgresPool } from '@wiser/data-infra';
import { createAnalysisHandler } from '../src/handlers/analysis.js';

it.skipIf(process.env['WISER_DATA_PG_INTEGRATION'] !== '1')(
  'stores immutable source geometry with PostgreSQL scope isolation and exact counts',
  async () => {
    const pool = new Pool({
      connectionString: process.env['DATA_TEST_DATABASE_URL'],
      max: 1,
    });
    const client = await pool.connect();
    const tenant = randomUUID(),
      project = randomUUID(),
      item = randomUUID(),
      version = randomUUID(),
      asset = randomUUID(),
      operation = randomUUID(),
      analysis = randomUUID(),
      jobId = randomUUID();
    const role = `wiser_analysis_${randomUUID().replaceAll('-', '')}`;
    const bytes = new TextEncoder().encode(
      JSON.stringify({
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: { station: '01646500', value: 0 },
            geometry: {
              type: 'Point',
              coordinates: [-77.12763889, 38.94977778],
            },
          },
        ],
      }),
    );
    const hash = createHash('sha256').update(bytes).digest('hex');
    try {
      await client.query('begin');
      if (
        (
          await client.query<{ name: string | null }>(
            "select to_regclass('service.analysis_run') name",
          )
        ).rows[0]?.name === null
      ) {
        await client.query(
          await readFile(
            new URL(
              '../../../infrastructure/data-foundation/postgres/migrations/0012_analysis.sql',
              import.meta.url,
            ),
            'utf8',
          ),
        );
      }
      await client.query(
        await readFile(
          new URL(
            '../../../infrastructure/data-foundation/postgres/migrations/0013_analysis_query_scope.sql',
            import.meta.url,
          ),
          'utf8',
        ),
      );
      await client.query(`create role ${role} nologin nosuperuser nobypassrls`);
      await client.query(
        `grant usage on schema catalog,service,ingestion,security,event,public to ${role}`,
      );
      await client.query(
        `grant select,insert,update,delete on all tables in schema catalog,service,ingestion,event to ${role}`,
      );
      await client.query(
        `grant execute on all functions in schema security,ingestion,event to ${role}`,
      );
      await client.query(
        `insert into catalog.data_item (data_item_id,tenant_id,project_id,owner_project_id,name,business_domains,source_natures,source_channels,processing_stage,intended_uses,source_organization,authorization_scope,citation_requirements,unit_definitions,missing_value_rules,anomaly_rules,generation_method,quality_grade,acceptance_status,publication_status,security_level,version,update_mode) values ($1,$2,$3,$3,'Analysis fixture',array['water'],array['observed'],array['file-upload'],'RAW',array['analysis'],'Fixture','data.catalog.read','{}','[]','[]','[]','OBSERVED','C','PASSED','PUBLISHED','L1_INTERNAL',1,'SNAPSHOT')`,
        [item, tenant, project],
      );
      await client.query(
        `insert into catalog.data_item_version (version_id,tenant_id,project_id,data_item_id,version_number,asset_manifest,source_hash,metadata_hash,processing_stage,generation_method,quality_grade,acceptance_status,publication_status,security_level,committed_at,published_at) values ($1,$2,$3,$4,1,$5::jsonb,decode($6,'hex'),decode($6,'hex'),'RAW','OBSERVED','C','PASSED','PUBLISHED','L1_INTERNAL',now(),now())`,
        [
          version,
          tenant,
          project,
          item,
          JSON.stringify({ assetIds: [asset] }),
          hash,
        ],
      );
      await client.query(
        `insert into catalog.content_blob (content_blob_id,tenant_id,project_id,content_hash,byte_size,raw_storage_key,lifecycle_state,security_level) values ($1,$2,$3,decode($4,'hex'),$5,'fixture/raw','RAW','L1_INTERNAL')`,
        [asset, tenant, project, hash, bytes.length],
      );
      await client.query(
        `insert into catalog.asset (asset_id,tenant_id,project_id,version_id,storage_key,content_hash,media_type,byte_size,lifecycle_state,security_level,content_blob_id) values ($1,$2,$3,$4,'fixture/version',decode($5,'hex'),'application/geo+json',$6,'RAW','L1_INTERNAL',$1)`,
        [asset, tenant, project, version, hash, bytes.length],
      );
      await client.query(
        `insert into service.operation (operation_id,tenant_id,project_id,capability_id,actor_id,status,progress_percent,idempotency_key,request_payload,security_level) values ($1::uuid,$2::uuid,$3::uuid,'data.analysis.create',$1::uuid,'RUNNING',0,$1::text,'{}','L1_INTERNAL')`,
        [operation, tenant, project],
      );
      await client.query(
        `insert into service.analysis_run (analysis_id,tenant_id,project_id,version_id,operation_id,parser_version,security_level,policy_version) values ($1,$2,$3,$4,$5,'1.0.0','L1_INTERNAL',1)`,
        [analysis, tenant, project, version, operation],
      );
      await client.query(
        `insert into ingestion.job (job_id,tenant_id,project_id,operation_id,job_type,status,idempotency_key,payload,lease_owner,lease_expires_at,attempt_count,timeout_at,security_level) values ($1::uuid,$2::uuid,$3::uuid,$4::uuid,'data.analysis.process','RUNNING',$1::text,$5::jsonb,'analysis-integration',now()+interval '5 minutes',1,now()+interval '1 hour','L1_INTERNAL')`,
        [
          jobId,
          tenant,
          project,
          operation,
          JSON.stringify({ analysisId: analysis }),
        ],
      );
      const scoped: DataPostgresPool = {
        async connect() {
          await client.query(`set local role ${role}`);
          return {
            async query(sql, values = []) {
              if (sql === 'begin')
                return client.query('savepoint worker_analysis');
              if (sql === 'commit')
                return client.query('release savepoint worker_analysis');
              if (sql === 'rollback')
                return client.query('rollback to savepoint worker_analysis');
              try {
                return await client.query(sql, [...values]);
              } catch (error) {
                console.error(error);
                throw error;
              }
            },
            release() {},
          };
        },
        async end() {},
      };
      const handler = createAnalysisHandler({
        pool: scoped,
        read: () => Promise.resolve(bytes),
      });
      const claimed = {
        jobId,
        tenantId: tenant,
        projectId: project,
        operationId: operation,
        jobType: 'data.analysis.process',
        payload: { analysisId: analysis },
        attemptCount: 1,
        maxAttempts: 3,
        leaseOwner: 'analysis-integration',
        leaseExpiresAt: '2099-01-01T00:00:00Z',
        rowVersion: 1,
        cancelRequested: false,
        securityLevel: 'L1_INTERNAL' as const,
        policyVersion: 1,
      };
      expect(await handler(claimed)).toMatchObject({
        status: 'SUCCEEDED',
        result: { recordCount: 1, featureCount: 1 },
      });
      const rows = await client.query(
        `select record_values,st_asgeojson(geom)::jsonb geometry from catalog.analysis_record where analysis_id=$1`,
        [analysis],
      );
      expect(rows.rows).toEqual([
        {
          record_values: { c1: '01646500', c2: 0 },
          geometry: { type: 'Point', coordinates: [-77.12763889, 38.94977778] },
        },
      ]);
      expect(await handler(claimed)).toMatchObject({
        result: { recordCount: 1, featureCount: 1 },
      });
      expect(
        (
          await client.query<{ count: number }>(
            'select count(*)::integer count from catalog.analysis_record',
          )
        ).rows[0]?.count,
      ).toBe(1);
      await client.query('savepoint immutable_analysis');
      await expect(
        client.query(
          "update catalog.analysis_record set record_values='{}' where analysis_id=$1",
          [analysis],
        ),
      ).rejects.toMatchObject({ code: '55000' });
      await client.query('rollback to savepoint immutable_analysis');
      await expect(
        client.query(
          "update service.analysis_run set status='PENDING',completed_at=null where analysis_id=$1",
          [analysis],
        ),
      ).rejects.toMatchObject({ code: '55000' });
      await client.query('rollback to savepoint immutable_analysis');
      for (const [key, forbidden, restored] of [
        ['wiser.max_security_level', 'L0_PUBLIC', 'L1_INTERNAL'],
        ['wiser.policy_version', '0', '1'],
        ['wiser.tenant_id', randomUUID(), tenant],
      ]) {
        await client.query('select set_config($1,$2,true)', [key, forbidden]);
        expect(
          (await client.query('select * from catalog.analysis_record')).rows,
        ).toHaveLength(0);
        await client.query('select set_config($1,$2,true)', [key, restored]);
        expect(
          (await client.query('select * from catalog.analysis_record')).rows,
        ).toHaveLength(1);
      }
      await client.query("select set_config('wiser.project_id',$1,true)", [
        randomUUID(),
      ]);
      expect(
        (await client.query('select * from catalog.analysis_record')).rows,
      ).toHaveLength(0);
      expect(
        (await client.query('select * from service.analysis_run')).rows,
      ).toHaveLength(0);
    } finally {
      await client.query('rollback');
      client.release();
      await pool.end();
    }
  },
);
