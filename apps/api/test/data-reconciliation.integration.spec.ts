import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { expect, it } from 'vitest';
import {
  CreateReconciliationOutputSchema,
  GetReconciliationOutputSchema,
  type CreateReconciliationInput,
} from '@wiser/data-contracts';
import { createReconciliationExecutors } from '../src/data-foundation/reconciliation-runtime.js';
import type { DataCapabilityExecutionContext } from '../src/data-foundation/capability-handler.js';

it.skipIf(process.env['WISER_DATA_PG_INTEGRATION'] !== '1')(
  'persists complete reconciliations, guards review, and reauthorizes every replay and page',
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
    const executors = createReconciliationExecutors({
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
      const executor = executors.find(
        (e) => e.id === `data.reconciliation.${id}`,
      );
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
        `grant select,insert,update on security.audit_event,event.outbox_event,service.observation_reconciliation to ${role}`,
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
      const left = await source(
        1,
        [
          { station: '001', value: 1 },
          { station: '002', value: 0 },
        ],
        'csv',
      );
      const right = await source(2, [
        { station: '001', value: '1.00' },
        { station: '002', value: '0' },
      ]);
      const revised = await source(3, [
        { station: '001', value: 2 },
        { station: '003', value: 3 },
      ]);
      const incomplete = await source(4, [{ station: '001', value: null }]);
      const document = await source(5, [{ station: '001', value: 1 }], 'pdf');
      const truncated = await source(
        6,
        [{ station: '001', value: 1 }],
        'csv',
        2,
      );
      const input: CreateReconciliationInput = {
        title: 'CSV/XLSX pair',
        left: left.ref,
        right: right.ref,
        plan: {
          keys: [
            {
              name: 'station',
              leftField: 'station',
              rightField: 'station',
              type: 'text',
              trim: false,
            },
          ],
          left: {
            valueField: 'value',
            measure: { literal: 'level' },
            unit: { literal: 'm' },
          },
          right: {
            valueField: 'value',
            measure: { literal: 'level' },
            unit: { literal: 'm' },
          },
          unitConversions: [],
          conflictPolicy: 'preserve',
        },
      };
      const createContext = command();
      const created = CreateReconciliationOutputSchema.parse(
        await call('create', input, createContext),
      );
      expect(created.batch).toMatchObject({
        status: 'CANDIDATE',
        independentObservationCount: null,
        summary: {
          fileCount: 2,
          parsedRecordCount: 4,
          candidateObservationCount: 2,
          relation: 'FORMAT_COPY_CANDIDATE',
        },
      });
      expect(await call('create', input, createContext)).toEqual(created);
      await expect(
        call('create', { ...input, title: 'Changed' }, createContext),
      ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
      const page = GetReconciliationOutputSchema.parse(
        await call('get', { batchId: created.batch.batchId, first: 1 }),
      );
      expect(page.groups).toHaveLength(1);
      expect(page.nextCursor).toBeTruthy();
      const members = GetReconciliationOutputSchema.parse(
        await call('get', {
          batchId: created.batch.batchId,
          groupIndex: 0,
          first: 1,
        }),
      );
      expect(members.members[0]?.recordId).toBe(left.recordIds[0]);
      expect(members.nextCursor).toBeTruthy();
      const secondMember = GetReconciliationOutputSchema.parse(
        await call('get', {
          batchId: created.batch.batchId,
          groupIndex: 0,
          first: 1,
          after: members.nextCursor,
        }),
      );
      expect(secondMember.members[0]?.recordId).toBe(right.recordIds[0]);
      await expect(
        call('get', {
          batchId: created.batch.batchId,
          groupIndex: 1,
          after: members.nextCursor,
        }),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
      for (const foreign of [
        {
          ...context,
          principal: { ...context.principal, actorId: randomUUID() },
        },
        {
          ...context,
          authorization: { ...context.authorization, projectId: randomUUID() },
        },
        {
          ...context,
          authorization: { ...context.authorization, tenantId: randomUUID() },
        },
        {
          ...context,
          authorization: {
            ...context.authorization,
            purpose: 'another-purpose',
          },
        },
        { ...context, effectiveMaxSecurityLevel: 'L0_PUBLIC' as const },
      ])
        await expect(
          call('get', { batchId: created.batch.batchId }, foreign),
        ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(
        call(
          'get',
          { batchId: created.batch.batchId },
          {
            ...context,
            authorization: { ...context.authorization, authzVersion: 2 },
          },
        ),
      ).resolves.toBeTruthy();
      const review = {
        batchId: created.batch.batchId,
        expectedVersion: 1,
        decision: 'verify',
        note: 'Verified the full business key and measure scope',
      };
      await expect(
        call('review', review, {
          ...command(),
          principal: { ...context.principal, actorType: 'agent' },
        }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      const reviewContext = command();
      const verified = CreateReconciliationOutputSchema.parse(
        await call('review', review, reviewContext),
      );
      expect(verified.batch).toMatchObject({
        status: 'VERIFIED',
        version: 2,
        independentObservationCount: 2,
      });
      expect(await call('review', review, reviewContext)).toEqual(verified);
      await expect(call('review', review, command())).rejects.toMatchObject({
        code: 'STATE_CONFLICT',
      });
      await expect(
        call('get', { batchId: created.batch.batchId, after: page.nextCursor }),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
      const conflict = CreateReconciliationOutputSchema.parse(
        await call('create', { ...input, right: revised.ref }, command()),
      );
      expect(conflict.batch.summary).toMatchObject({
        conflictCount: 1,
        addedCount: 1,
        leftOnlyCount: 1,
        candidateObservationCount: null,
      });
      await expect(
        call(
          'review',
          { ...review, batchId: conflict.batch.batchId },
          command(),
        ),
      ).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
      const revision = CreateReconciliationOutputSchema.parse(
        await call(
          'create',
          {
            ...input,
            right: revised.ref,
            plan: { ...input.plan, conflictPolicy: 'right-revises-left' },
          },
          command(),
        ),
      );
      expect(revision.batch.summary).toMatchObject({
        revisedCount: 1,
        addedCount: 1,
        leftOnlyCount: 1,
        candidateObservationCount: 3,
      });
      const unknown = CreateReconciliationOutputSchema.parse(
        await call('create', { ...input, right: incomplete.ref }, command()),
      );
      expect(unknown.batch.summary.candidateObservationCount).toBeNull();
      for (const ref of [document.ref, truncated.ref])
        await expect(
          call('create', { ...input, right: ref }, command()),
        ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
      await client.query('reset role');
      const before = (
        await client.query<{ n: number }>(
          'select count(*)::int n from catalog.analysis_record where tenant_id=$1',
          [tenant],
        )
      ).rows[0]?.n;
      expect(before).toBe(9);
      await client.query('savepoint immutable');
      await expect(
        client.query(
          "update service.observation_reconciliation set summary='{}' where batch_id=$1",
          [created.batch.batchId],
        ),
      ).rejects.toBeTruthy();
      await client.query('rollback to savepoint immutable');
      const audit = await client.query<{ n: number }>(
        "select count(*)::int n from security.audit_event where tenant_id=$1 and action='data.reconciliation.review'",
        [tenant],
      );
      expect(audit.rows[0]?.n).toBe(1);
      await client.query(
        "update catalog.data_item set security_level='L2_RESTRICTED' where data_item_id=$1",
        [item],
      );
      await expect(
        call('get', { batchId: created.batch.batchId }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(call('create', input, createContext)).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    } finally {
      try {
        await client.query('rollback');
      } finally {
        client.release();
        await pool.end();
      }
    }
  },
  30000,
);
