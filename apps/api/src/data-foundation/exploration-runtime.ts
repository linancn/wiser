import {
  loadExplorationReadiness,
  explorationReadinessSummary,
} from './exploration-readiness.js';
import { queryProvenanceGraph } from './exploration-graph.js';
import { randomUUID } from 'node:crypto';
import { queryAnalysisView } from './exploration-views.js';
import { z } from 'zod';
import {
  ExplorationQueryInputSchema,
  ExplorationResourceSchema,
  ExplorationResultSchema,
  ExplorationVersionRefSchema,
  QuerySpecSchema,
  type QuerySpec,
} from '@wiser/data-contracts';
import {
  DataCapabilityHandlerError,
  type DataCapabilityExecutionContext,
} from './capability-handler.js';
import type {
  QueryAdapterPgClient,
  QueryAdapterPgPool,
} from './query-adapters.js';

const SET_SCOPE = `select set_config('wiser.tenant_id',$1,true),set_config('wiser.project_id',$2,true),set_config('wiser.actor_id',$3,true),set_config('wiser.max_security_level',$4,true),set_config('wiser.policy_version',$5,true),set_config('wiser.purpose',$6,true),set_config('statement_timeout',$7,true)`;
const MATCH = `
select item.data_item_id, version.version_id,
  (select analysis.analysis_id from service.analysis_run analysis where analysis.version_id=version.version_id and analysis.completed_at is not null order by analysis.completed_at desc,analysis.analysis_id desc limit 1) analysis_id
from catalog.data_item item
join lateral (
  select v.version_id, v.quality_grade, v.asset_manifest from catalog.data_item_version v
  where v.tenant_id=item.tenant_id and v.project_id=item.project_id and v.data_item_id=item.data_item_id
    and v.publication_status='PUBLISHED' and v.acceptance_status in ('PASSED','CONDITIONALLY_PASSED')
    and ($5::jsonb is null or exists (select 1 from jsonb_array_elements($5) ref
      where ref->>'dataItemId'=v.data_item_id::text and ref->>'versionId'=v.version_id::text))
  order by v.version_number desc, v.version_id desc limit case when $5::jsonb is null then 1 else 256 end
) version on true
where item.publication_status='PUBLISHED' and item.acceptance_status in ('PASSED','CONDITIONALLY_PASSED')
  and ($1::text is null or item.name ilike '%' || $1 || '%' or item.source_organization ilike '%' || $1 || '%')
  and ($2::uuid[] is null or item.data_item_id=any($2))
  and ($3::text[] is null or item.business_domains && $3)
  and ($4::text[] is null or version.quality_grade=any($4))
  and ($6::text[] is null or coalesce(version.asset_manifest->'sourceRegistration'->>'providerName',item.source_organization)=any($6))
  and ($7::text[] is null or coalesce(version.asset_manifest->'sourceRegistration'->>'kind','DATASET')=any($7))
order by item.name collate "C", item.data_item_id, version.version_id
limit 10001`;
const AUTHORIZED = `with authorized as (
  select item.data_item_id, version.version_id, item.name, item.source_organization,
    version.asset_manifest, ref.ordinality, analysis.analysis_id, analysis.status analysis_status
  from jsonb_array_elements($1::jsonb) with ordinality ref(value,ordinality)
  join catalog.data_item_version version on version.version_id=(ref.value->>'versionId')::uuid
    and version.data_item_id=(ref.value->>'dataItemId')::uuid
  join catalog.data_item item on item.tenant_id=version.tenant_id and item.project_id=version.project_id and item.data_item_id=version.data_item_id
  left join service.analysis_run analysis on analysis.analysis_id=(ref.value->>'analysisId')::uuid and analysis.version_id=version.version_id and analysis.completed_at is not null
  where version.publication_status='PUBLISHED' and version.acceptance_status in ('PASSED','CONDITIONALLY_PASSED')
    and item.publication_status='PUBLISHED' and item.acceptance_status in ('PASSED','CONDITIONALLY_PASSED')
    and (ref.value->>'analysisId' is null or analysis.analysis_id is not null)
)`;
const RESOURCES = `${AUTHORIZED}
select authorized.*,
  (select sum(record_count)::float8 from service.analysis_asset where analysis_id=authorized.analysis_id) analysis_record_count,
  (select sum(feature_count)::float8 from service.analysis_asset where analysis_id=authorized.analysis_id) analysis_feature_count,
  (select count(*)::int from catalog.asset asset where asset.version_id=authorized.version_id) as asset_count,
  (select count(*)::int from knowledge.evidence_fragment fragment where fragment.version_id=authorized.version_id and jsonb_typeof(fragment.locator->'record')='object') as record_count,
  (select count(*)::int from catalog.spatial_extent extent where extent.version_id=authorized.version_id) as feature_count,
  exists(select 1 from service.projection_status projection where projection.version_id=authorized.version_id and projection.projection_kind='NEO4J' and projection.status='SUCCEEDED') as graph_ready
from authorized where ordinality > $2::int order by ordinality limit $3::int`;

const StoredRef = ExplorationVersionRefSchema.extend({
  analysisId: z.uuid().nullable().optional(),
});
const StoredSnapshot = z.object({
  query_id: z.string().uuid(),
  spec: QuerySpecSchema,
  version_refs: z.array(StoredRef).max(10000),
  created_at: z.coerce.date(),
  expires_at: z.coerce.date(),
});

function offset(after: string | undefined, queryId: string): number {
  if (after === undefined) return 0;
  try {
    const cursor = z
      .strictObject({
        queryId: z.literal(queryId),
        offset: z.number().int().min(1).max(10000),
      })
      .parse(JSON.parse(Buffer.from(after, 'base64url').toString('utf8')));
    return cursor.offset;
  } catch {
    throw new DataCapabilityHandlerError('VALIDATION_FAILED');
  }
}

class RetryableExplorationTransaction extends Error {}

/** PostgreSQL owns the manifest; projections can become ready independently. */
export class PostgresExplorationExecutor {
  readonly id = 'data.explore.query' as const;
  constructor(private readonly pool: QueryAdapterPgPool) {}

  async execute(
    raw: unknown,
    context: DataCapabilityExecutionContext,
  ): Promise<unknown> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.executeAttempt(raw, context);
      } catch (error) {
        if (!(error instanceof RetryableExplorationTransaction)) throw error;
        if (context.signal.aborted)
          throw new DataCapabilityHandlerError('CAPABILITY_TIMEOUT');
      }
    }
    throw new DataCapabilityHandlerError('EXECUTION_FAILED');
  }

  private async executeAttempt(
    raw: unknown,
    context: DataCapabilityExecutionContext,
  ): Promise<unknown> {
    const parsed = ExplorationQueryInputSchema.safeParse(raw);
    if (!parsed.success)
      throw new DataCapabilityHandlerError('VALIDATION_FAILED');
    const input = parsed.data;
    if (context.signal.aborted)
      throw new DataCapabilityHandlerError('CAPABILITY_TIMEOUT');
    const client = await this.pool.connect();
    try {
      await client.query('begin isolation level repeatable read');
      await client.query(SET_SCOPE, [
        context.authorization.tenantId,
        context.authorization.projectId,
        context.principal.actorId,
        context.effectiveMaxSecurityLevel,
        String(context.authorization.authzVersion),
        context.authorization.purpose,
        String(context.timeoutMs),
      ]);
      const queryId =
        input.queryId ?? (await this.create(client, input.spec!, context));
      const selected = await client.query(
        'select * from service.exploration_snapshot where query_id=$1 and expires_at > clock_timestamp()',
        [queryId],
      );
      if (selected.rows[0] === undefined)
        throw new DataCapabilityHandlerError('NOT_FOUND');
      const snapshot = StoredSnapshot.parse(selected.rows[0]);
      const refs = JSON.stringify(snapshot.version_refs);
      const count = await client.query(
        `${AUTHORIZED} select count(*)::int as total from authorized`,
        [refs],
      );
      if (count.rows[0]?.['total'] !== snapshot.version_refs.length)
        throw new DataCapabilityHandlerError('CONFLICT');
      if (input.view !== 'resources') {
        const result = ExplorationResultSchema.parse({
          queryId,
          spec: snapshot.spec,
          createdAt: snapshot.created_at.toISOString(),
          expiresAt: snapshot.expires_at.toISOString(),
          ...(await (
            input.view === 'graph' ? queryProvenanceGraph : queryAnalysisView
          )(client, snapshot.version_refs, queryId, input)),
        });
        if (context.signal.aborted)
          throw new DataCapabilityHandlerError('CAPABILITY_TIMEOUT');
        await client.query('commit');
        return result;
      }
      const start = offset(input.after, queryId);
      if (start > snapshot.version_refs.length)
        throw new DataCapabilityHandlerError('VALIDATION_FAILED');
      const page = await client.query(RESOURCES, [
        refs,
        start,
        input.first + 1,
      ]);
      const readiness = await loadExplorationReadiness(
        client,
        snapshot.version_refs,
      );
      const resources = page.rows.slice(0, input.first).map((row) => {
        const manifest = z
          .record(z.string(), z.unknown())
          .parse(row['asset_manifest']);
        const source = z
          .object({
            kind: z.string().optional(),
            providerName: z.string().optional(),
            limitations: z.array(z.string()).optional(),
          })
          .parse(manifest['sourceRegistration'] ?? {});
        const analyzed = typeof row['analysis_id'] === 'string';
        const availability = readiness.get(z.uuid().parse(row['version_id']));
        if (availability === undefined)
          throw new DataCapabilityHandlerError('EXECUTION_FAILED');
        return ExplorationResourceSchema.parse({
          dataItemId: row['data_item_id'],
          versionId: row['version_id'],
          name: row['name'],
          provider: source.providerName ?? row['source_organization'],
          kind: source.kind ?? 'DATASET',
          assetCount: row['asset_count'],
          recordCount: availability.recordCount,
          featureCount: availability.featureCount,
          ...(analyzed
            ? {
                analysis: {
                  analysisId: row['analysis_id'],
                  status: row['analysis_status'],
                },
              }
            : {}),
          readiness: {
            records: availability.records,
            spatial: availability.spatial,
            graph: row['graph_ready'] === true ? 'READY' : 'NOT_PARSED',
          },
          limitations: source.limitations ?? [],
        });
      });
      const result = ExplorationResultSchema.parse({
        queryId,
        spec: snapshot.spec,
        createdAt: snapshot.created_at.toISOString(),
        expiresAt: snapshot.expires_at.toISOString(),
        view: 'resources',
        summary: explorationReadinessSummary(snapshot.version_refs, readiness),
        totalCount: snapshot.version_refs.length,
        resources,
        ...(page.rows.length > input.first
          ? {
              nextCursor: Buffer.from(
                JSON.stringify({ queryId, offset: start + input.first }),
              ).toString('base64url'),
            }
          : {}),
      });
      if (context.signal.aborted)
        throw new DataCapabilityHandlerError('CAPABILITY_TIMEOUT');
      await client.query('commit');
      return result;
    } catch (error) {
      await client.query('rollback').catch(() => undefined);
      if (error instanceof DataCapabilityHandlerError) throw error;
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        (error.code === '40001' || error.code === '40P01')
      )
        throw new RetryableExplorationTransaction();
      throw new DataCapabilityHandlerError('EXECUTION_FAILED');
    } finally {
      client.release();
    }
  }

  private async create(
    client: QueryAdapterPgClient,
    spec: QuerySpec,
    context: DataCapabilityExecutionContext,
  ): Promise<string> {
    const scope = [
      context.authorization.tenantId,
      context.authorization.projectId,
      context.principal.actorId,
    ];
    await client.query('select pg_advisory_xact_lock(hashtextextended($1,0))', [
      scope.join(':'),
    ]);
    await client.query(
      `delete from service.exploration_snapshot where expires_at <= clock_timestamp() or query_id in (select query_id from service.exploration_snapshot order by created_at desc offset 31)`,
    );
    const matched = await client.query(MATCH, [
      spec.text ?? null,
      spec.dataItemIds ?? null,
      spec.businessDomains ?? null,
      spec.qualityGrades ?? null,
      spec.versions === undefined ? null : JSON.stringify(spec.versions),
      spec.providers ?? null,
      spec.kinds ?? null,
    ]);
    if (matched.rows.length > 10000)
      throw new DataCapabilityHandlerError('VALIDATION_FAILED');
    let refs = matched.rows.map((row) =>
      StoredRef.parse({
        dataItemId: row['data_item_id'],
        versionId: row['version_id'],
        analysisId: row['analysis_id'] ?? null,
      }),
    );
    if (spec.readiness !== undefined) {
      const readiness = await loadExplorationReadiness(client, refs);
      refs = refs.filter((ref) => {
        const facts = readiness.get(ref.versionId);
        return (
          facts !== undefined &&
          (spec.readiness?.records === undefined ||
            spec.readiness.records.includes(facts.records)) &&
          (spec.readiness?.spatial === undefined ||
            spec.readiness.spatial.includes(facts.spatial))
        );
      });
    }
    const id = randomUUID();
    await client.query(
      `insert into service.exploration_snapshot(query_id,tenant_id,project_id,actor_id,purpose,security_level,policy_version,spec,version_refs,created_at,expires_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,statement_timestamp(),statement_timestamp()+interval '30 minutes')`,
      [
        id,
        ...scope,
        context.authorization.purpose,
        context.effectiveMaxSecurityLevel,
        context.authorization.authzVersion,
        JSON.stringify(spec),
        JSON.stringify(refs),
      ],
    );
    return id;
  }
}
