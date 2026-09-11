import {
  BusinessProjectionConsumer,
  Neo4jBusinessProjection,
} from '@wiser/data-infra';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { expect, it } from 'vitest';
import {
  ImportRelationsOutputSchema,
  RelationOutputSchema,
  RelationListOutputSchema,
} from '@wiser/data-contracts';
import { createKnowledgeRelationExecutors } from '../src/data-foundation/knowledge-relations-runtime.js';
import type { DataCapabilityExecutionContext } from '../src/data-foundation/capability-handler.js';

it.skipIf(process.env['WISER_DATA_PG_INTEGRATION'] !== '1')(
  'imports source-scoped candidates, reviews separately, and reauthorizes withdrawn evidence',
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
    const transactionalPool = {
      async connect() {
        await client.query(`set local role ${role}`);
        return {
          async query(sql: string, values: readonly unknown[] = []) {
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
    };
    const executors = createKnowledgeRelationExecutors(transactionalPool);
    const call = (id: string, input: unknown, ctx = context) => {
      const executor = executors.find(
        (e) => e.id === `data.knowledge.relations.${id}`,
      );
      if (!executor) throw Error('Missing executor');
      return executor.execute(input, ctx);
    };
    const command = () => ({ ...context, idempotencyKey: randomUUID() });
    try {
      await client.query('begin');
      await client.query(`create role ${role} nologin nosuperuser nobypassrls`);
      await client.query(
        `grant usage on schema catalog,service,knowledge,security,event to ${role}`,
      );
      await client.query(
        `grant execute on all functions in schema security to ${role}`,
      );
      await client.query(
        `grant select on all tables in schema catalog,service,knowledge to ${role}`,
      );
      await client.query(
        `grant select,insert,update on security.audit_event,event.outbox_event,knowledge.assertion,knowledge.evidence_fragment,knowledge.review_record,knowledge.assertion_binding to ${role}`,
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

      await client.query(
        `grant insert,update on service.relation_projection_checkpoint to ${role}`,
      );
      const asset = randomUUID();
      await client.query(
        `insert into catalog.content_blob(content_blob_id,tenant_id,project_id,content_hash,byte_size,raw_storage_key,lifecycle_state,security_level) values($1,$2,$3,decode(repeat('a',64),'hex'),20,$4,'RAW','L1_INTERNAL')`,
        [asset, tenant, project, `synthetic/${asset}`],
      );
      await client.query(
        `insert into catalog.asset(asset_id,tenant_id,project_id,version_id,storage_key,content_hash,media_type,byte_size,lifecycle_state,security_level,content_blob_id) values($1,$2,$3,$4,$5,decode(repeat('a',64),'hex'),'application/pdf',20,'RAW','L1_INTERNAL',$1)`,
        [asset, tenant, project, version, `synthetic/${asset}`],
      );
      const entity = (key: string, kind = 'MONITORING_POINT') => ({
        key,
        label: key,
        kind,
        externalId: null,
      });
      const relation = (
        subject: string,
        predicate: string,
        object: string,
      ) => ({
        subject: entity(subject),
        predicate,
        object: entity(object),
        qualifiers: {
          measure: null,
          unit: null,
          observedAt: '2025-06-01',
          missing: true,
          spatialScope: null,
          limitations: ['Source-local identity'],
          reportedConclusion: null,
        },
        generation: { method: 'SOURCE_TABLE', model: null },
        evidence: [
          {
            assetId: asset,
            sourceHash: 'a'.repeat(64),
            locator: 'PDF page 1, table row 1',
            excerpt: null,
            polarity: 'SUPPORTS',
          },
        ],
        supersedesId: null,
      });
      const input = {
        dataItemId: item,
        versionId: version,
        mappingVersion: 'test.v1',
        candidates: [
          relation('enterprise:1', 'HAS_DECLARED_MONITORING_POINT', 'point:1'),
          relation('point:1', 'HAS_REPORTED_INDICATOR', 'measurement:1'),
          relation('point:1', 'HAS_REPORTED_INDICATOR', 'measurement:2'),
        ],
      };
      const ctx = command();
      const imported = ImportRelationsOutputSchema.parse(
        await call('import', input, ctx),
      );
      expect(imported.createdCount).toBe(3);
      expect(imported.items.every((x) => x.status === 'PENDING_REVIEW')).toBe(
        true,
      );
      expect(
        ImportRelationsOutputSchema.parse(await call('import', input, ctx))
          .items,
      ).toEqual(imported.items);
      const retried = ImportRelationsOutputSchema.parse(
        await call('import', input, command()),
      );
      expect(retried).toMatchObject({ createdCount: 0, reusedCount: 3 });
      expect(
        RelationListOutputSchema.parse(
          await call('list', { dataItemId: item, versionId: version }),
        ).totalCount,
      ).toBe(0);
      const neo4jUrl = process.env['DATA_TEST_NEO4J_URL'];
      let failProjection = false;
      const http = {
        async request(request: {
          url: string;
          headers: Readonly<Record<string, string>>;
          body: unknown;
        }) {
          if (failProjection) throw Error('Synthetic projection interruption');
          const response = await fetch(request.url, {
            method: 'POST',
            headers: request.headers,
            body: JSON.stringify(request.body),
          });
          return { status: response.status, body: await response.json() };
        },
      };
      const target = neo4jUrl
        ? new Neo4jBusinessProjection({
            baseUrl: neo4jUrl,
            database: 'neo4j',
            username: 'neo4j',
            password:
              process.env['DATA_TEST_NEO4J_PASSWORD'] ?? 'isolated-test-only',
            http,
          })
        : null;
      const consumer = target
        ? new BusinessProjectionConsumer(transactionalPool, target)
        : null;
      const projected = async (statement: string) => {
        const result = await http.request({
          url: `${neo4jUrl}/db/neo4j/query/v2`,
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Basic ${Buffer.from(`neo4j:${process.env['DATA_TEST_NEO4J_PASSWORD'] ?? 'isolated-test-only'}`).toString('base64')}`,
          },
          body: { statement, parameters: { tenant, project } },
        });
        expect(result.status).toBe(202);
        const body = result.body as {
          errors?: unknown[];
          data: { values: unknown[][] };
        };
        expect(body.errors ?? []).toEqual([]);
        return body.data;
      };
      const candidate = imported.items[0]!;
      await expect(
        call(
          'review',
          {
            assertionId: candidate.assertionId,
            expectedVersion: 1,
            decision: 'APPROVED',
            rationale: 'Checked source location',
          },
          {
            ...command(),
            principal: { ...context.principal, actorType: 'agent' },
          },
        ),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      const approved = RelationOutputSchema.parse(
        await call(
          'review',
          {
            assertionId: candidate.assertionId,
            expectedVersion: 1,
            decision: 'APPROVED',
            rationale: 'Checked source location',
          },
          command(),
        ),
      );
      expect(approved.assertion).toMatchObject({
        status: 'APPROVED',
        version: 2,
        confidence: null,
      });
      expect(approved.assertion.reviews).toHaveLength(1);
      await expect(
        call(
          'review',
          {
            assertionId: candidate.assertionId,
            expectedVersion: 1,
            decision: 'REJECTED',
            rationale: 'Stale review',
          },
          command(),
        ),
      ).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
      expect(
        RelationListOutputSchema.parse(
          await call('list', { dataItemId: item, versionId: version }),
        ).totalCount,
      ).toBe(1);
      if (consumer) {
        await consumer.processBatch(
          {
            tenantId: tenant,
            projectId: project,
            maxSecurityLevel: 'L1_INTERNAL',
            policyVersion: 1,
          },
          100,
        );
        expect(
          (
            await projected(
              'MATCH ()-[r:WISER_BUSINESS_RELATION]->() WHERE r.tenantId=$tenant AND r.projectId=$project RETURN count(r)',
            )
          ).values,
        ).toEqual([[1]]);
        await projected(
          'MATCH (n:WiserBusinessEntity) WHERE n.tenantId=$tenant AND n.projectId=$project DETACH DELETE n',
        );
        failProjection = true;
        await expect(
          consumer.processBatch(
            {
              tenantId: tenant,
              projectId: project,
              maxSecurityLevel: 'L1_INTERNAL',
              policyVersion: 1,
            },
            100,
          ),
        ).rejects.toThrow('Synthetic projection interruption');
        failProjection = false;
        await consumer.processBatch(
          {
            tenantId: tenant,
            projectId: project,
            maxSecurityLevel: 'L1_INTERNAL',
            policyVersion: 1,
          },
          100,
        );
        expect(
          (
            await projected(
              'MATCH ()-[r:WISER_BUSINESS_RELATION]->() WHERE r.tenantId=$tenant AND r.projectId=$project RETURN count(r)',
            )
          ).values,
        ).toEqual([[1]]);
      }
      for (const [i, decision] of [
        [1, 'CORRECTION_REQUIRED'],
        [2, 'REJECTED'],
      ] as const) {
        await call(
          'review',
          {
            assertionId: imported.items[i]!.assertionId,
            expectedVersion: 1,
            decision,
            rationale: 'Synthetic review outcome',
          },
          command(),
        );
        expect(
          RelationListOutputSchema.parse(
            await call('list', {
              dataItemId: item,
              versionId: version,
              status: decision,
            }),
          ).totalCount,
        ).toBe(1);
      }
      await expect(
        call(
          'get',
          { assertionId: candidate.assertionId },
          {
            ...context,
            authorization: {
              ...context.authorization,
              projectId: randomUUID(),
            },
          },
        ),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      // Restore the authorized scope after the foreign-project read.
      await call('get', { assertionId: candidate.assertionId });
      for (const [sql, message] of [
        [
          "update knowledge.assertion set subject='{}' where assertion_id=$1",
          'matching versioned review',
        ],
        [
          "update knowledge.assertion_binding set candidate='{}' where assertion_id=$1",
          'append-only',
        ],
        [
          "update knowledge.evidence_fragment set excerpt='changed' where evidence_fragment_id=(select evidence_fragment_id from knowledge.assertion where assertion_id=$1)",
          'Relation source evidence is immutable',
        ],
        [
          "update knowledge.review_record set rationale='changed' where assertion_id=$1",
          'Relation review history is immutable',
        ],
      ]) {
        await client.query('savepoint immutable');
        await expect(
          client.query(sql!, [candidate.assertionId]),
        ).rejects.toThrow(message);
        await client.query('rollback to savepoint immutable');
      }
      const wrong = {
        ...input,
        candidates: [
          {
            ...input.candidates[0]!,
            evidence: [
              {
                ...input.candidates[0]!.evidence[0]!,
                sourceHash: 'b'.repeat(64),
              },
            ],
          },
        ],
      };
      await expect(call('import', wrong, command())).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      const changed = {
        ...input,
        candidates: [
          {
            ...input.candidates[0]!,
            qualifiers: { ...input.candidates[0]!.qualifiers, unit: 'mg/L' },
          },
        ],
      };
      await expect(call('import', changed, command())).rejects.toMatchObject({
        code: 'IDEMPOTENCY_CONFLICT',
      });
      const revised = ImportRelationsOutputSchema.parse(
        await call(
          'import',
          {
            ...changed,
            mappingVersion: 'test.v2',
            candidates: [
              {
                ...changed.candidates[0]!,
                supersedesId: candidate.assertionId,
              },
            ],
          },
          command(),
        ),
      );
      expect(revised.items[0]).toMatchObject({
        status: 'PENDING_REVIEW',
        candidate: { supersedesId: candidate.assertionId },
      });
      expect(
        RelationListOutputSchema.parse(
          await call('list', {
            dataItemId: item,
            versionId: version,
            mappingVersion: 'test.v2',
            status: 'PENDING_REVIEW',
          }),
        ).totalCount,
      ).toBe(1);
      expect(
        RelationListOutputSchema.parse(
          await call('list', {
            dataItemId: item,
            versionId: version,
            mappingVersion: 'test.v2',
          }),
        ).totalCount,
      ).toBe(0);
      await expect(
        call(
          'import',
          {
            ...input,
            candidates: [
              {
                ...input.candidates[0]!,
                subject: {
                  ...input.candidates[0]!.subject,
                  label: 'Conflicting name',
                },
                object: entity('point:another'),
              },
            ],
          },
          command(),
        ),
      ).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
      await client.query('reset role');
      await client.query(
        `update catalog.data_item set publication_status='WITHDRAWN' where data_item_id=$1`,
        [item],
      );
      if (consumer) {
        await consumer.processBatch(
          {
            tenantId: tenant,
            projectId: project,
            maxSecurityLevel: 'L1_INTERNAL',
            policyVersion: 1,
          },
          100,
        );
        expect(
          (
            await projected(
              'MATCH ()-[r:WISER_BUSINESS_RELATION]->() WHERE r.tenantId=$tenant AND r.projectId=$project RETURN count(r)',
            )
          ).values,
        ).toEqual([[0]]);
      }
      await expect(
        call('get', { assertionId: candidate.assertionId }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(call('import', input, ctx)).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      await expect(
        call('list', { dataItemId: item, versionId: version }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    } finally {
      await client.query('rollback');
      client.release();
      await pool.end();
    }
  },
  30000,
);
