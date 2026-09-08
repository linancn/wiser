import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { describe, expect, it } from 'vitest';

describe('source registration persistence', () => {
  it.skipIf(process.env['WISER_DATA_PG_INTEGRATION'] !== '1')(
    'keeps scoped source descriptors immutable across ingestion transitions',
    async () => {
      const pool = new Pool({
        connectionString: process.env['DATA_TEST_DATABASE_URL'],
        max: 1,
      });
      const client = await pool.connect();
      const id = randomUUID();
      const tenant = randomUUID();
      const project = randomUUID();
      const role = `wiser_source_test_${id.replaceAll('-', '')}`;
      const source = {
        sourceId: 'DS-0409',
        kind: 'DATASET_INTERFACE',
        name: 'HydroATLAS partial sample',
        bundleId: 'water-research-20260908',
        providerName: 'HydroSHEDS',
        accessStatus: 'bounded_sample_only',
        completeness: 'PARTIAL',
        manifestAssetId: randomUUID(),
        manifestSha256: 'a'.repeat(64),
        limitations: ['Source registration only.'],
      };
      try {
        await client.query('begin');
        await client.query(
          `create role ${role} nologin nosuperuser nobypassrls`,
        );
        await client.query(
          `grant usage on schema ingestion, security to ${role}`,
        );
        await client.query(
          `grant select, update on ingestion.session to ${role}`,
        );
        await client.query(
          `grant execute on all functions in schema security to ${role}`,
        );
        await client.query(
          `insert into service.operation (operation_id,tenant_id,project_id,capability_id,actor_id,status,security_level,request_payload) values ($1,$2,$3,'data.ingestion.create',$1,'PENDING','L1_INTERNAL','{}')`,
          [id, tenant, project],
        );
        await client.query(
          `insert into ingestion.session (ingestion_id,tenant_id,project_id,operation_id,owner_project_id,state,intended_uses,expected_version,requested_security_level,security_level,source_registration) values ($1,$2,$3,$1,$3,'RECEIVED',array['source-registration'],1,'L1_INTERNAL','L1_INTERNAL',$4)`,
          [id, tenant, project, JSON.stringify(source)],
        );
        await client.query(`set local role ${role}`);
        await client.query(
          `select set_config('wiser.tenant_id',$1,true),set_config('wiser.project_id',$2,true),set_config('wiser.max_security_level','L1_INTERNAL',true),set_config('wiser.policy_version','1',true)`,
          [tenant, project],
        );
        const before = await client.query<{ source_registration: unknown }>(
          'select source_registration from ingestion.session where ingestion_id=$1',
          [id],
        );
        expect(before.rows[0]?.source_registration).toEqual(source);
        await client.query('savepoint immutable_source');
        await expect(
          client.query(
            `update ingestion.session set state='QUARANTINED',row_version=row_version+1,source_registration=jsonb_set(source_registration,'{completeness}','"UNKNOWN"') where ingestion_id=$1`,
            [id],
          ),
        ).rejects.toMatchObject({ code: '42501' });
        await client.query('rollback to savepoint immutable_source');
        await client.query(
          `update ingestion.session set state='QUARANTINED',row_version=row_version+1 where ingestion_id=$1`,
          [id],
        );
        await client.query(`select set_config('wiser.project_id',$1,true)`, [
          randomUUID(),
        ]);
        expect(
          (
            await client.query(
              'select source_registration from ingestion.session where ingestion_id=$1',
              [id],
            )
          ).rows,
        ).toHaveLength(0);
      } finally {
        await client.query('rollback');
        client.release();
        await pool.end();
      }
    },
  );
});
