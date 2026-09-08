import { verifyExplorationTiles } from './fixtures/exploration-tiles.js';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
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
          await readFile(
            new URL(
              '../../../infrastructure/data-foundation/postgres/migrations/0013_analysis_query_scope.sql',
              import.meta.url,
            ),
            'utf8',
          ),
        );
        await client.query(
          await readFile(
            new URL(
              '../../../infrastructure/data-foundation/postgres/migrations/0016_exploration_record_queries.sql',
              import.meta.url,
            ),
            'utf8',
          ),
        );
        for (const [value, expected] of [
          [null, null],
          ['NaN', null],
          ['Infinity', null],
          ['1e9999', null],
          ['0001', '1'],
          [' 2.5 ', '2.5'],
          [0, '0'],
          [{ value: 2 }, null],
        ] as const) {
          const parsed = await client.query<{ value: string | null }>(
            'select service.exploration_number($1::jsonb)::text value',
            [JSON.stringify(value)],
          );
          expect(parsed.rows[0]?.['value']).toBe(expected);
        }
        const scalarCases = [
          null,
          0,
          2,
          '0001',
          '2.5',
          ' 20 ',
          '.5',
          '1.',
          '1e10',
          'NaN',
          'Infinity',
          '1e9999',
          '1_000',
          '1 2',
          true,
          [2],
          { v: 2 },
        ];
        const predicateCases = [
          ...['eq', 'ne', 'gt', 'gte', 'lt', 'lte'].map((operator) => ({
            type: 'number',
            field: 'v',
            operator,
            value: 2,
          })),
          ...['eq', 'ne', 'contains'].map((operator) => ({
            type: 'text',
            field: 'v',
            operator,
            value: '2',
          })),
          ...['isNull', 'isNotNull'].map((operator) => ({
            type: 'presence',
            field: 'v',
            operator,
          })),
        ];
        const evaluate = () =>
          client.query<{ value: boolean[] }>(
            "select array_agg(service.exploration_record_matches(jsonb_build_object('v',s.value),jsonb_build_array(f.value)) order by s.ordinality,f.ordinality) value from jsonb_array_elements($1::jsonb) with ordinality s cross join jsonb_array_elements($2::jsonb) with ordinality f",
            [JSON.stringify(scalarCases), JSON.stringify(predicateCases)],
          );
        const previousPredicates = await evaluate();
        await client.query(
          await readFile(
            new URL(
              '../../../infrastructure/data-foundation/postgres/migrations/0017_exploration_predicate_compilation.sql',
              import.meta.url,
            ),
            'utf8',
          ),
        );
        expect((await evaluate()).rows).toEqual(previousPredicates.rows);
        await client.query(
          await readFile(
            'infrastructure/data-foundation/postgres/migrations/0018_exploration_time.sql',
            'utf8',
          ),
        );
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
        const missingProvider = ExplorationResultSchema.parse(
          await executor.execute(
            { spec: { providers: ['Absent provider'] }, view: 'resources' },
            context,
          ),
        );
        expect(missingProvider.totalCount).toBe(0);
        const registered = ExplorationResultSchema.parse(
          await executor.execute(
            {
              spec: {
                providers: ['Fixture provider'],
                kinds: ['CATALOG_ENTRY'],
                readiness: { records: ['NOT_PARSED'] },
              },
              view: 'resources',
            },
            context,
          ),
        );
        expect(registered.totalCount).toBe(2);
        expect(registered.summary).toMatchObject({
          resourceCount: 2,
          analyzedResourceCount: 0,
          records: [{ status: 'NOT_PARSED', count: 2 }],
        });
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
        const asset = randomUUID(),
          analysis = randomUUID(),
          operation = randomUUID();
        const record = randomUUID(),
          secondRecord = randomUUID();
        await client.query(
          `insert into catalog.content_blob(content_blob_id,tenant_id,project_id,content_hash,byte_size,raw_storage_key,lifecycle_state,security_level) values($1,$2,$3,decode(repeat('a',64),'hex'),20,'fixture/raw','RAW','L1_INTERNAL')`,
          [asset, tenant, project],
        );
        await client.query(
          `insert into catalog.asset(asset_id,tenant_id,project_id,version_id,storage_key,content_hash,media_type,byte_size,lifecycle_state,security_level,content_blob_id) values($1,$2,$3,$4,'fixture/version',decode(repeat('a',64),'hex'),'application/geo+json',20,'RAW','L1_INTERNAL',$1)`,
          [asset, tenant, project, version],
        );
        await client.query(
          `insert into service.operation(operation_id,tenant_id,project_id,capability_id,actor_id,status,progress_percent,idempotency_key,request_payload,security_level) values($1::uuid,$2,$3,'data.analysis.create',$4,'RUNNING',0,$1::text,'{}','L1_INTERNAL')`,
          [operation, tenant, project, actor],
        );
        await client.query(
          `insert into service.analysis_run(analysis_id,tenant_id,project_id,version_id,operation_id,parser_version,security_level,policy_version) values($1,$2,$3,$4,$5,'1.0.0','L1_INTERNAL',1)`,
          [analysis, tenant, project, version, operation],
        );
        await client.query(
          `insert into service.analysis_asset(analysis_id,asset_id,tenant_id,project_id,source_hash,status,record_count,feature_count,columns,security_level,policy_version) values($1,$2,$3,$4,decode(repeat('a',64),'hex'),'READY',2,2,'[{"key":"c1","label":"Station"},{"key":"c2","label":"Value"}]','L1_INTERNAL',1)`,
          [analysis, asset, tenant, project],
        );
        await client.query(
          `insert into catalog.analysis_record(analysis_id,record_id,asset_id,tenant_id,project_id,record_index,record_values,geom,security_level,policy_version) values($1,$2,$3,$4,$5,1,'{"c1":"01646500","c2":0}',st_setsrid(st_makepoint(-77.12763889,38.94977778),4326),'L1_INTERNAL',1),($1,$6,$3,$4,$5,2,'{"c1":"00000001","c2":2}',st_setsrid(st_makepoint(0,0),4326),'L1_INTERNAL',1)`,
          [analysis, record, asset, tenant, project, secondRecord],
        );
        await client.query(
          "update service.analysis_run set status='READY',completed_at=clock_timestamp() where analysis_id=$1",
          [analysis],
        );
        const stillUnparsed = ExplorationResultSchema.parse(
          await executor.execute(
            { queryId: historical.queryId, view: 'resources' },
            context,
          ),
        );
        expect(stillUnparsed.resources[0]?.readiness.records).toBe(
          'NOT_PARSED',
        );
        const analyzed = ExplorationResultSchema.parse(
          await executor.execute(
            {
              spec: { versions: [{ dataItemId: item, versionId: version }] },
              view: 'resources',
            },
            context,
          ),
        );
        expect(analyzed.resources[0]).toMatchObject({
          recordCount: 2,
          featureCount: 2,
          analysis: { analysisId: analysis },
          readiness: { records: 'READY', spatial: 'READY' },
        });
        const spatialQuery = ExplorationResultSchema.parse(
          await executor.execute(
            {
              baseQueryId: analyzed.queryId,
              spec: { spatialBounds: [-78, 38, -77, 39] },
              view: 'resources',
            },
            context,
          ),
        );
        expect(spatialQuery.totalCount).toBe(1);
        for (const view of ['records', 'map'] as const) {
          const spatialRows = ExplorationResultSchema.parse(
            await executor.execute(
              { queryId: spatialQuery.queryId, view, versionId: version },
              context,
            ),
          );
          expect(spatialRows.totalCount).toBe(1);
          if (view === 'records')
            expect(spatialRows.records?.[0]?.recordId).toBe(record);
          else expect(spatialRows.features?.[0]?.id).toBe(record);
        }
        const spatialAggregate = ExplorationResultSchema.parse(
          await executor.execute(
            {
              queryId: spatialQuery.queryId,
              versionId: version,
              view: 'aggregate',
              aggregate: { assetId: asset, measure: { operation: 'count' } },
            },
            context,
          ),
        );
        expect(spatialAggregate.totalCount).toBe(1);
        await expect(
          executor.execute(
            {
              queryId: spatialQuery.queryId,
              versionId: version,
              view: 'graph',
              recordId: secondRecord,
            },
            context,
          ),
        ).rejects.toMatchObject({ code: 'NOT_FOUND' });
        const emptySpatial = ExplorationResultSchema.parse(
          await executor.execute(
            {
              baseQueryId: spatialQuery.queryId,
              spec: { spatialBounds: [100, 10, 101, 11] },
              view: 'resources',
            },
            context,
          ),
        );
        expect(emptySpatial.totalCount).toBe(0);
        const restoredSpatial = ExplorationResultSchema.parse(
          await executor.execute(
            { baseQueryId: emptySpatial.queryId, spec: {}, view: 'resources' },
            context,
          ),
        );
        expect(restoredSpatial.totalCount).toBe(1);
        expect(restoredSpatial.resources[0]?.analysis?.analysisId).toBe(
          analysis,
        );
        const readyOnly = ExplorationResultSchema.parse(
          await executor.execute(
            {
              spec: {
                versions: [{ dataItemId: item, versionId: version }],
                readiness: { records: ['READY'], spatial: ['READY'] },
              },
              view: 'resources',
            },
            context,
          ),
        );
        expect(readyOnly.totalCount).toBe(1);
        expect(readyOnly.resources[0]?.versionId).toBe(version);
        expect(readyOnly.summary).toMatchObject({
          resourceCount: 1,
          analyzedResourceCount: 1,
          indexedRecordCount: 2,
          indexedFeatureCount: 2,
        });
        const filtered = ExplorationResultSchema.parse(
          await executor.execute(
            {
              spec: {
                versions: [{ dataItemId: item, versionId: version }],
                recordQuery: {
                  assetId: asset,
                  filters: [
                    { field: 'c2', type: 'number', operator: 'gte', value: 1 },
                  ],
                  sort: { field: 'c2', type: 'number', direction: 'desc' },
                  columns: ['c1'],
                },
              },
              view: 'resources',
            },
            context,
          ),
        );
        const filteredRecords = ExplorationResultSchema.parse(
          await executor.execute(
            { queryId: filtered.queryId, view: 'records', versionId: version },
            context,
          ),
        );
        expect(filteredRecords.totalCount).toBe(1);
        expect(filteredRecords.records?.map((row) => row.recordId)).toEqual([
          secondRecord,
        ]);
        expect(filteredRecords.records?.[0]?.values).toEqual({
          c1: '00000001',
        });
        const aggregateResult = ExplorationResultSchema.parse(
          await executor.execute(
            {
              queryId: filtered.queryId,
              versionId: version,
              view: 'aggregate',
              aggregate: {
                assetId: asset,
                groupBy: { field: 'c1', type: 'text' },
                measure: { operation: 'mean', field: 'c2' },
              },
            },
            context,
          ),
        );
        expect(aggregateResult.totalCount).toBe(1);
        expect(aggregateResult.aggregate).toMatchObject({
          groupCount: 1,
          truncated: false,
          groups: [
            {
              key: '00000001',
              unit: null,
              count: 1,
              validCount: 1,
              missingCount: 0,
              invalidCount: 0,
            },
          ],
        });
        expect(Number(aggregateResult.aggregate?.groups[0]?.value)).toBe(2);
        await expect(
          executor.execute(
            {
              queryId: filtered.queryId,
              versionId: version,
              view: 'aggregate',
              aggregate: {
                assetId: asset,
                measure: { operation: 'sum', field: 'not-a-column' },
              },
            },
            context,
          ),
        ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
        const sortedQuery = ExplorationResultSchema.parse(
          await executor.execute(
            {
              spec: {
                versions: [{ dataItemId: item, versionId: version }],
                recordQuery: {
                  assetId: asset,
                  sort: { field: 'c2', type: 'number', direction: 'desc' },
                },
              },
              view: 'resources',
            },
            context,
          ),
        );
        const sorted = ExplorationResultSchema.parse(
          await executor.execute(
            {
              queryId: sortedQuery.queryId,
              view: 'records',
              versionId: version,
              first: 1,
            },
            context,
          ),
        );
        expect(sorted.records?.[0]?.recordId).toBe(secondRecord);
        const sortedNext = ExplorationResultSchema.parse(
          await executor.execute(
            {
              queryId: sorted.queryId,
              view: 'records',
              versionId: version,
              first: 1,
              after: sorted.nextCursor,
            },
            context,
          ),
        );
        expect(sortedNext.records?.[0]?.recordId).toBe(record);
        await expect(
          executor.execute(
            {
              queryId: filtered.queryId,
              view: 'graph',
              versionId: version,
              recordId: record,
            },
            context,
          ),
        ).rejects.toMatchObject({ code: 'NOT_FOUND' });
        const filteredMap = ExplorationResultSchema.parse(
          await executor.execute(
            { queryId: filtered.queryId, view: 'map' },
            context,
          ),
        );
        expect(filteredMap.totalCount).toBe(1);
        expect(filteredMap.features?.[0]?.id).toBe(secondRecord);
        await expect(
          executor.execute(
            {
              queryId: filtered.queryId,
              view: 'records',
              versionId: version,
              recordId: record,
            },
            context,
          ),
        ).rejects.toMatchObject({ code: 'NOT_FOUND' });
        await expect(
          executor.execute(
            {
              spec: {
                versions: [{ dataItemId: item, versionId: version }],
                recordQuery: {
                  assetId: asset,
                  filters: [
                    {
                      field: 'not-a-source-field',
                      type: 'text',
                      operator: 'eq',
                      value: 'x',
                    },
                  ],
                },
              },
              view: 'resources',
            },
            context,
          ),
        ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
        await verifyExplorationTiles(client, {
          tenant,
          project,
          actor,
          item,
          version,
          asset,
          analysis,
          queryId: analyzed.queryId,
          record,
          filteredQueryId: filtered.queryId,
          filteredRecord: secondRecord,
        });
        const records = ExplorationResultSchema.parse(
          await executor.execute(
            {
              queryId: analyzed.queryId,
              view: 'records',
              versionId: version,
              first: 1,
            },
            context,
          ),
        );
        expect(records.totalCount).toBe(2);
        expect(records.records?.[0]).toMatchObject({
          recordId: record,
          featureId: record,
          values: { c1: '01646500', c2: 0 },
        });
        expect(records.assets?.[0]?.columns).toEqual([
          { key: 'c1', label: 'Station' },
          { key: 'c2', label: 'Value' },
        ]);
        const recordLookup = ExplorationResultSchema.parse(
          await executor.execute(
            {
              queryId: analyzed.queryId,
              view: 'records',
              versionId: version,
              recordId: secondRecord,
            },
            context,
          ),
        );
        expect(recordLookup.totalCount).toBe(1);
        expect(recordLookup.records).toHaveLength(1);
        expect(recordLookup.records?.[0]?.recordId).toBe(secondRecord);
        expect(recordLookup.nextCursor).toBeUndefined();
        await expect(
          executor.execute(
            {
              queryId: analyzed.queryId,
              view: 'records',
              versionId: version,
              recordId: randomUUID(),
            },
            context,
          ),
        ).rejects.toMatchObject({ code: 'NOT_FOUND' });
        const second = ExplorationResultSchema.parse(
          await executor.execute(
            {
              queryId: analyzed.queryId,
              view: 'records',
              versionId: version,
              first: 1,
              after: records.nextCursor,
            },
            context,
          ),
        );
        expect(second.records?.[0]?.recordId).toBe(secondRecord);
        const map = ExplorationResultSchema.parse(
          await executor.execute(
            {
              queryId: analyzed.queryId,
              view: 'map',
              bbox: [-78, 38, -77, 40],
            },
            context,
          ),
        );
        const graph = ExplorationResultSchema.parse(
          await executor.execute(
            {
              queryId: analyzed.queryId,
              view: 'graph',
              versionId: version,
              recordId: record,
            },
            context,
          ),
        );
        expect(graph.graph?.nodes).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              id: `version:${version}`,
              kind: 'VERSION',
              versionId: version,
            }),
            expect.objectContaining({
              id: `asset:${version}:${asset}`,
              kind: 'ASSET',
              assetId: asset,
              sourceHash: 'a'.repeat(64),
            }),
            expect.objectContaining({
              id: `record:${analysis}:${record}`,
              kind: 'RECORD',
            }),
          ]),
        );
        expect(
          graph.graph?.nodes.find((node) => node.kind === 'RECORD')?.record,
        ).toMatchObject({
          recordId: record,
          featureId: record,
          values: { c1: '01646500', c2: 0 },
        });
        expect(graph.graph?.edges).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              source: `version:${version}`,
              target: `asset:${version}:${asset}`,
              relation: 'HAS_ASSET',
            }),
            expect.objectContaining({
              source: `asset:${version}:${asset}`,
              target: `record:${analysis}:${record}`,
              relation: 'HAS_RECORD',
            }),
          ]),
        );
        await expect(
          executor.execute(
            {
              queryId: historical.queryId,
              view: 'graph',
              versionId: version,
              recordId: record,
            },
            context,
          ),
        ).rejects.toMatchObject({ code: 'NOT_FOUND' });
        await expect(
          executor.execute(
            {
              queryId: analyzed.queryId,
              view: 'graph',
              versionId: secondVersion,
            },
            context,
          ),
        ).rejects.toMatchObject({ code: 'NOT_FOUND' });
        expect(map.spatial).toMatchObject({
          bounds: [-77.12763889, 38.94977778, -77.12763889, 38.94977778],
          mercatorFeatureCount: 1,
        });
        expect(map.totalCount).toBe(1);
        expect(map.features?.[0]).toMatchObject({
          id: record,
          properties: { recordId: record, versionId: version },
          geometry: { type: 'Point', coordinates: [-77.12763889, 38.94977778] },
        });
        await expect(
          executor.execute(
            {
              queryId: analyzed.queryId,
              view: 'map',
              after: records.nextCursor,
            },
            context,
          ),
        ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
        await expect(
          executor.execute(
            {
              queryId: analyzed.queryId,
              view: 'records',
              versionId: secondVersion,
            },
            context,
          ),
        ).rejects.toMatchObject({ code: 'NOT_FOUND' });
        await client.query('reset role');
        await client.query(
          `insert into service.exploration_snapshot(query_id,tenant_id,project_id,actor_id,purpose,security_level,policy_version,spec,version_refs,created_at,expires_at) values ($1,$2,$3,$4,'integration-test','L1_INTERNAL',1,'{}','[]',now()-interval '2 hours',now()-interval '90 minutes')`,
          [expired, tenant, project, actor],
        );
        await expect(
          executor.execute({ queryId: expired, view: 'resources' }, context),
        ).rejects.toMatchObject({ code: 'NOT_FOUND' });
        await client.query('reset role');
        const aggregateAnalysis = randomUUID(),
          aggregateOperation = randomUUID();
        await client.query(
          `insert into service.operation(operation_id,tenant_id,project_id,capability_id,actor_id,status,progress_percent,idempotency_key,request_payload,security_level) values($1::uuid,$2,$3,'data.analysis.create',$4,'RUNNING',0,$1::text,'{}','L1_INTERNAL')`,
          [aggregateOperation, tenant, project, actor],
        );
        await client.query(
          `insert into service.analysis_run(analysis_id,tenant_id,project_id,version_id,operation_id,parser_version,security_level,policy_version) values($1,$2,$3,$4,$5,'1.0.0','L1_INTERNAL',1)`,
          [aggregateAnalysis, tenant, project, version, aggregateOperation],
        );
        await client.query(
          `insert into service.analysis_asset(analysis_id,asset_id,tenant_id,project_id,source_hash,status,record_count,feature_count,columns,security_level,policy_version) values($1,$2,$3,$4,decode(repeat('a',64),'hex'),'READY',209,0,'[{"key":"c1","label":"Unit"},{"key":"c2","label":"Value"},{"key":"c3","label":"Time"}]','L1_INTERNAL',1)`,
          [aggregateAnalysis, asset, tenant, project],
        );
        const aggregateValues = [
          { c1: 'aggregate-m', c2: 1, c3: '29/2/2024 23:59:59.123456' },
          { c1: 'aggregate-m', c2: '3', c3: '1/3/2024 00:00:00' },
          { c1: 'aggregate-m', c2: null, c3: '31/2/2024 00:00:00' },
          { c1: 'aggregate-m', c2: 'invalid' },
          { c1: 'aggregate-cm', c2: 100 },
          { c1: 'aggregate-cm', c2: 200 },
          ...Array.from({ length: 201 }, (_, index) => ({
            c1: `group-${index}`,
            c2: index,
          })),
          { c1: 'large-records', c2: 'x'.repeat(1700000) },
          { c1: 'large-records', c2: 'y'.repeat(1700000) },
        ];
        await client.query(
          `insert into catalog.analysis_record(analysis_id,record_id,asset_id,tenant_id,project_id,record_index,record_values,security_level,policy_version)
          select $1,gen_random_uuid(),$2,$3,$4,ordinality,value,'L1_INTERNAL',1 from jsonb_array_elements($5::jsonb) with ordinality`,
          [
            aggregateAnalysis,
            asset,
            tenant,
            project,
            JSON.stringify(aggregateValues),
          ],
        );
        await client.query(
          "update service.analysis_run set status='READY',completed_at=clock_timestamp() where analysis_id=$1",
          [aggregateAnalysis],
        );
        const sameBase = ExplorationResultSchema.parse(
          await executor.execute(
            { baseQueryId: analyzed.queryId, spec: {}, view: 'resources' },
            context,
          ),
        );
        expect(sameBase.resources).toHaveLength(1);
        expect(sameBase.resources[0]?.analysis?.analysisId).toBe(analysis);
        const refined = ExplorationResultSchema.parse(
          await executor.execute(
            {
              baseQueryId: analyzed.queryId,
              spec: {
                versions: [{ dataItemId: item, versionId: version }],
                recordQuery: {
                  assetId: asset,
                  filters: [
                    {
                      field: 'c1',
                      type: 'text',
                      operator: 'eq',
                      value: '01646500',
                    },
                  ],
                },
              },
              view: 'resources',
            },
            context,
          ),
        );
        expect(refined.resources[0]?.analysis?.analysisId).toBe(analysis);
        const refinedRecords = ExplorationResultSchema.parse(
          await executor.execute(
            { queryId: refined.queryId, versionId: version, view: 'records' },
            context,
          ),
        );
        expect(refinedRecords.totalCount).toBe(1);
        expect(refinedRecords.records?.[0]?.recordId).toBe(record);
        await expect(
          executor.execute(
            { baseQueryId: expired, spec: {}, view: 'resources' },
            context,
          ),
        ).rejects.toMatchObject({ code: 'NOT_FOUND' });
        const aggregateQuery = ExplorationResultSchema.parse(
          await executor.execute(
            {
              spec: {
                versions: [{ dataItemId: item, versionId: version }],
                recordQuery: {
                  assetId: asset,
                  filters: [
                    {
                      field: 'c1',
                      type: 'text',
                      operator: 'contains',
                      value: 'aggregate-',
                    },
                  ],
                },
              },
              view: 'resources',
            },
            context,
          ),
        );
        const aggregateInput = {
          queryId: aggregateQuery.queryId,
          versionId: version,
          view: 'aggregate',
          aggregate: {
            assetId: asset,
            measure: { operation: 'mean', field: 'c2', unitField: 'c1' },
          },
        };
        const temporal = ExplorationResultSchema.parse(
          await executor.execute(
            {
              ...aggregateInput,
              aggregate: {
                assetId: asset,
                groupBy: {
                  field: 'c3',
                  type: 'time',
                  format: 'dmy-local',
                  utcOffsetMinutes: 480,
                  bucket: 'month',
                },
                measure: { operation: 'count' },
              },
            },
            context,
          ),
        );
        expect(
          temporal.aggregate?.groups.map((group) => [
            group.key,
            group.upperBound,
            group.count,
          ]),
        ).toEqual([
          ['2024-01-31T16:00:00.000000Z', '2024-02-29T16:00:00.000000Z', 1],
          ['2024-02-29T16:00:00.000000Z', '2024-03-31T16:00:00.000000Z', 1],
          [null, null, 4],
        ]);
        const byUnit = ExplorationResultSchema.parse(
          await executor.execute(aggregateInput, context),
        );
        expect(byUnit.totalCount).toBe(6);
        expect(
          byUnit.aggregate?.groups.map((group) => ({
            ...group,
            value: Number(group.value),
          })),
        ).toEqual([
          {
            key: null,
            unit: 'aggregate-cm',
            upperBound: null,
            count: 2,
            validCount: 2,
            missingCount: 0,
            invalidCount: 0,
            value: 150,
          },
          {
            key: null,
            unit: 'aggregate-m',
            upperBound: null,
            count: 4,
            validCount: 2,
            missingCount: 1,
            invalidCount: 1,
            value: 2,
          },
        ]);
        for (const [operation, expected] of [
          ['sum', [300, 4]],
          ['min', [100, 1]],
          ['max', [200, 3]],
        ] as const) {
          const output = ExplorationResultSchema.parse(
            await executor.execute(
              {
                ...aggregateInput,
                aggregate: {
                  ...aggregateInput.aggregate,
                  measure: { ...aggregateInput.aggregate.measure, operation },
                },
              },
              context,
            ),
          );
          expect(
            output.aggregate?.groups.map((group) => Number(group.value)),
          ).toEqual(expected);
        }
        const histogram = ExplorationResultSchema.parse(
          await executor.execute(
            {
              ...aggregateInput,
              aggregate: {
                assetId: asset,
                groupBy: { field: 'c2', type: 'number', interval: 100 },
                measure: { operation: 'count' },
              },
            },
            context,
          ),
        );
        expect(
          histogram.aggregate?.groups.map((group) => [group.key, group.count]),
        ).toEqual([
          ['0', 2],
          ['100', 1],
          ['200', 1],
          [null, 2],
        ]);
        await expect(
          executor.execute(aggregateInput, {
            ...context,
            principal: { ...context.principal, actorId: randomUUID() },
          }),
        ).rejects.toMatchObject({ code: 'NOT_FOUND' });

        const boundedQuery = ExplorationResultSchema.parse(
          await executor.execute(
            {
              spec: {
                versions: [{ dataItemId: item, versionId: version }],
                recordQuery: {
                  assetId: asset,
                  filters: [
                    {
                      field: 'c1',
                      type: 'text',
                      operator: 'contains',
                      value: 'group-',
                    },
                  ],
                },
              },
              view: 'resources',
            },
            context,
          ),
        );
        const bounded = ExplorationResultSchema.parse(
          await executor.execute(
            {
              ...aggregateInput,
              queryId: boundedQuery.queryId,
              aggregate: {
                assetId: asset,
                groupBy: { field: 'c1', type: 'text' },
                measure: { operation: 'count' },
              },
            },
            context,
          ),
        );
        expect(bounded.totalCount).toBe(201);
        expect(bounded.aggregate).toMatchObject({
          groupCount: 201,
          truncated: true,
        });
        expect(bounded.aggregate?.groups).toHaveLength(200);

        const largeQuery = ExplorationResultSchema.parse(
          await executor.execute(
            {
              spec: {
                versions: [{ dataItemId: item, versionId: version }],
                recordQuery: {
                  assetId: asset,
                  filters: [
                    {
                      field: 'c1',
                      type: 'text',
                      operator: 'eq',
                      value: 'large-records',
                    },
                  ],
                },
              },
              view: 'resources',
            },
            context,
          ),
        );
        const largeInput = {
          queryId: largeQuery.queryId,
          versionId: version,
          view: 'records',
          first: 200,
        };
        const largeFirst = ExplorationResultSchema.parse(
          await executor.execute(largeInput, context),
        );
        expect(
          Buffer.byteLength(JSON.stringify(largeFirst)),
        ).toBeLessThanOrEqual(3 * 1024 * 1024);
        expect(largeFirst.totalCount).toBe(2);
        expect(largeFirst.records).toHaveLength(1);
        expect(largeFirst.records?.[0]?.values['c2']).toBe('x'.repeat(1700000));
        expect(largeFirst.nextCursor).toBeTruthy();
        const largeLast = ExplorationResultSchema.parse(
          await executor.execute(
            { ...largeInput, after: largeFirst.nextCursor },
            context,
          ),
        );
        expect(largeLast.records).toHaveLength(1);
        expect(largeLast.records?.[0]?.values['c2']).toBe('y'.repeat(1700000));
        expect(largeLast.nextCursor).toBeUndefined();
        const projectedQuery = ExplorationResultSchema.parse(
          await executor.execute(
            {
              spec: {
                ...largeQuery.spec,
                recordQuery: {
                  ...largeQuery.spec.recordQuery,
                  columns: ['c1'],
                },
              },
              view: 'resources',
            },
            context,
          ),
        );
        const projected = ExplorationResultSchema.parse(
          await executor.execute(
            { ...largeInput, queryId: projectedQuery.queryId },
            context,
          ),
        );
        expect(projected.records).toHaveLength(2);
        expect(projected.records?.map((record) => record.values)).toEqual([
          { c1: 'large-records' },
          { c1: 'large-records' },
        ]);
      } finally {
        await client.query('rollback');
        client.release();
        await pool.end();
      }
    },
    30000,
  );
});
