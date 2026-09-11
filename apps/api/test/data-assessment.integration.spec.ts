import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { expect, it } from 'vitest';
import {
  AssessmentOutputSchema,
  ListAssessmentsOutputSchema,
} from '@wiser/data-contracts';
import { createAssessmentExecutors } from '../src/data-foundation/assessment-runtime.js';
import type { DataCapabilityExecutionContext } from '../src/data-foundation/capability-handler.js';

it.skipIf(process.env['WISER_DATA_PG_INTEGRATION'] !== '1')(
  'binds checks to saved content, persists immutable reports, and reauthorizes retries and pages',
  async () => {
    const pool = new Pool({
      connectionString: process.env['DATA_TEST_DATABASE_URL'],
      max: 1,
      connectionTimeoutMillis: 5000,
    });
    const client = await pool.connect();
    const tenant = randomUUID(),
      project = randomUUID(),
      actor = randomUUID(),
      item = randomUUID(),
      version = randomUUID();
    const role = `reconciliation_test_${actor.replaceAll('-', '')}`;
    const context: DataCapabilityExecutionContext = {
      principal: {
        actorId: actor,
        actorType: 'human',
        authenticationMethod: 'supabase_jwt',
        authUserId: actor,
        sessionId: randomUUID(),
      },
      authorization: {
        tenantId: tenant,
        projectId: project,
        roles: ['data-steward'],
        scopes: [
          'data.catalog.read',
          'data.query.execute',
          'data.ingestion.write',
          'data.publish',
        ],
        purpose: 'reconciliation-test',
        maxSecurityLevel: 'L1_INTERNAL',
        authzVersion: 1,
      },
      effectiveMaxSecurityLevel: 'L1_INTERNAL',
      traceId: 'a'.repeat(32),
      auditLevel: 'FULL',
      timeoutMs: 30000,
      signal: new AbortController().signal,
    };
    const executors = createAssessmentExecutors({
      async connect() {
        await client.query(`set local role ${role}`);
        return {
          async query(sql, values = []) {
            if (sql.startsWith('begin'))
              return client.query('savepoint reconciliation');
            if (sql === 'commit')
              return client.query('release savepoint reconciliation');
            if (sql === 'rollback') {
              await client.query('rollback to savepoint reconciliation');
              return client.query('release savepoint reconciliation');
            }
            return client.query(sql, [...values]);
          },
          release() {},
        };
      },
      async end() {},
    });
    const call = (id: string, input: unknown, ctx = context) => {
      const executor = executors.find((e) => e.id === `data.assessment.${id}`);
      if (!executor) throw Error('Missing executor');
      return executor.execute(input, ctx);
    };
    const command = () => ({ ...context, idempotencyKey: randomUUID() });
    try {
      await client.query('begin');
      await client.query(`create role ${role} nologin nosuperuser nobypassrls`);
      await client.query(
        `grant usage on schema catalog,service,security,event to ${role}`,
      );
      await client.query(
        `grant execute on all functions in schema security to ${role}`,
      );
      await client.query(
        `grant select on all tables in schema catalog,service to ${role}`,
      );
      await client.query(
        `grant select,insert,update on security.audit_event,event.outbox_event,service.intake_assessment to ${role}`,
      );
      await client.query(
        `grant usage on all sequences in schema event to ${role}`,
      );
      await client.query(
        `insert into catalog.data_item(data_item_id,tenant_id,project_id,owner_project_id,name,business_domains,source_natures,source_channels,processing_stage,intended_uses,source_organization,authorization_scope,citation_requirements,unit_definitions,missing_value_rules,anomaly_rules,generation_method,quality_grade,acceptance_status,publication_status,security_level,version,update_mode) values($1,$2,$3,$3,'Synthetic observations',array['water'],array['observed'],array['file-upload'],'RAW',array['analysis'],'Synthetic source','data.catalog.read','{}','[]','[]','[]','OBSERVED','C','PASSED','PUBLISHED','L1_INTERNAL',1,'SNAPSHOT')`,
        [item, tenant, project],
      );
      await client.query(
        `insert into catalog.data_item_version(version_id,tenant_id,project_id,data_item_id,version_number,asset_manifest,source_hash,metadata_hash,processing_stage,generation_method,quality_grade,acceptance_status,publication_status,security_level,committed_at,published_at) values($1,$2,$3,$4,1,'{}',decode(repeat('a',64),'hex'),decode(repeat('b',64),'hex'),'RAW','OBSERVED','C','PASSED','PUBLISHED','L1_INTERNAL',now(),now())`,
        [version, tenant, project, item],
      );
      async function source(
        n: number,
        values: readonly unknown[],
        extension = 'xlsx',
        declaredCount = values.length,
      ) {
        await client.query('reset role');
        const assetId = randomUUID(),
          analysisId = randomUUID(),
          operationId = randomUUID();
        const hash = n.toString(16).repeat(64);
        await client.query(
          `insert into catalog.content_blob(content_blob_id,tenant_id,project_id,content_hash,byte_size,raw_storage_key,lifecycle_state,security_level) values($1,$2,$3,decode($4,'hex'),20,$5,'RAW','L1_INTERNAL')`,
          [assetId, tenant, project, hash, `synthetic/${assetId}`],
        );
        await client.query(
          `insert into catalog.asset(asset_id,tenant_id,project_id,version_id,storage_key,content_hash,media_type,byte_size,lifecycle_state,security_level,content_blob_id) values($1,$2,$3,$4,$5,decode($6,'hex'),'text/csv',20,'RAW','L1_INTERNAL',$1)`,
          [assetId, tenant, project, version, `synthetic/${assetId}`, hash],
        );
        await client.query(
          `insert into service.operation(operation_id,tenant_id,project_id,capability_id,actor_id,status,progress_percent,idempotency_key,request_payload,security_level) values($1::uuid,$2,$3,'data.analysis.create',$4,'RUNNING',0,$1::text,'{}','L1_INTERNAL')`,
          [operationId, tenant, project, actor],
        );
        await client.query(
          `insert into service.analysis_run(analysis_id,tenant_id,project_id,version_id,operation_id,parser_version,security_level,policy_version) values($1,$2,$3,$4,$5,'1.0.0','L1_INTERNAL',1)`,
          [analysisId, tenant, project, version, operationId],
        );
        await client.query(
          `insert into service.analysis_asset(analysis_id,asset_id,tenant_id,project_id,source_hash,status,record_count,feature_count,columns,source_paths,security_level,policy_version) values($1,$2,$3,$4,decode($5,'hex'),'READY',$6,0,'[{"key":"station","label":"Station"},{"key":"value","label":"Value"}]',$7::jsonb,'L1_INTERNAL',1)`,
          [
            analysisId,
            assetId,
            tenant,
            project,
            hash,
            declaredCount,
            JSON.stringify([`observations.${extension}`]),
          ],
        );
        const recordIds = [];
        for (const [index, value] of values.entries()) {
          const recordId = randomUUID();
          recordIds.push(recordId);
          await client.query(
            `insert into catalog.analysis_record(analysis_id,record_id,asset_id,tenant_id,project_id,record_index,record_values,security_level,policy_version) values($1,$2,$3,$4,$5,$6,$7::jsonb,'L1_INTERNAL',1)`,
            [
              analysisId,
              recordId,
              assetId,
              tenant,
              project,
              index + 1,
              JSON.stringify(value),
            ],
          );
        }
        await client.query(
          "update service.analysis_run set status='READY',completed_at=clock_timestamp() where analysis_id=$1",
          [analysisId],
        );
        return {
          ref: { dataItemId: item, versionId: version, analysisId, assetId },
          recordIds,
        };
      }
      const saved = await source(1, [{ station: 'A', value: 2 }]);
      const input = {
        dataItemId: item,
        versionId: version,
        assetId: saved.ref.assetId,
        declaration: {
          kind: 'TABLE',
          target: 'DATASET',
          expectedSourceHash: '1'.repeat(64),
          entry: 'UNCHECKED',
          access: 'UNKNOWN',
          acquisition: 'ORIGINAL_ACQUIRED',
          coverage: 'SAMPLE',
          evidence: 'Original row 1',
          metadata: {
            source: 'Synthetic report',
            authorization: 'Test only',
            businessKeys: ['station'],
            measures: [
              { field: 'value', unit: null, evidence: 'Original header' },
            ],
          },
        },
      };
      const ctx = command();
      const first = AssessmentOutputSchema.parse(
        await call('create', input, ctx),
      );
      expect(first.assessment.facts.sourceHash).toBe('1'.repeat(64));
      expect(first.assessment.analysisId).toBe(saved.ref.analysisId);
      expect(first.assessment.result.acquisition).toBe('PARTIAL_ACQUIRED');
      expect(first.assessment.result.uses.calculation).toBe(
        'NEEDS_INFORMATION',
      );
      expect(
        AssessmentOutputSchema.parse(await call('create', input, ctx)),
      ).toEqual(first);
      await expect(
        call(
          'create',
          {
            ...input,
            declaration: { ...input.declaration, evidence: 'Different' },
          },
          ctx,
        ),
      ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
      const second = AssessmentOutputSchema.parse(
        await call(
          'create',
          {
            ...input,
            declaration: {
              ...input.declaration,
              expectedSourceHash: 'f'.repeat(64),
            },
          },
          command(),
        ),
      );
      expect(second.assessment.result.findings.map((f) => f.code)).toContain(
        'SOURCE_CHANGED',
      );
      const overview = await call('overview', { target: 'DATASET', first: 25 });
      expect(overview).toMatchObject({
        totalCount: 1,
        checkedCount: 1,
        uncheckedCount: 0,
        selectedCount: 1,
        items: [
          {
            dataItemId: item,
            versionId: version,
            nextAction: 'COMPLETE_METADATA',
          },
        ],
      });
      expect(
        await call('overview', { target: 'DESCRIPTION_PAGE', first: 25 }),
      ).toMatchObject({
        totalCount: 1,
        checkedCount: 0,
        uncheckedCount: 1,
        items: [{ nextAction: 'UNCHECKED' }],
      });
      const page = ListAssessmentsOutputSchema.parse(
        await call('list', { dataItemId: item, versionId: version, first: 1 }),
      );
      expect(page.items).toHaveLength(1);
      expect(page.nextCursor).toBeDefined();
      const next = ListAssessmentsOutputSchema.parse(
        await call('list', {
          dataItemId: item,
          versionId: version,
          first: 1,
          after: page.nextCursor,
        }),
      );
      expect(next.items).toHaveLength(1);
      expect(next.items[0]?.assessmentId).not.toBe(page.items[0]?.assessmentId);
      await client.query('savepoint immutable');
      await expect(
        client.query(
          "update service.intake_assessment set declaration='{}' where assessment_id=$1",
          [first.assessment.assessmentId],
        ),
      ).rejects.toThrow();
      await client.query('rollback to savepoint immutable');
      await expect(
        call(
          'get',
          { assessmentId: first.assessment.assessmentId },
          {
            ...context,
            authorization: {
              ...context.authorization,
              projectId: randomUUID(),
            },
          },
        ),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await client.query('reset role');
      await client.query(
        "update catalog.data_item set publication_status='WITHDRAWN' where data_item_id=$1",
        [item],
      );
      expect(
        await call('overview', { target: 'DATASET', first: 25 }),
      ).toMatchObject({ totalCount: 0, checkedCount: 0, items: [] });
      await expect(
        call('get', { assessmentId: first.assessment.assessmentId }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(call('create', input, ctx)).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    } finally {
      await client.query('rollback');
      client.release();
      await pool.end();
    }
  },
  30000,
);
