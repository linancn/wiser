import { createHash } from 'node:crypto';
import { RelationProjectionBatchSchema } from '@wiser/data-contracts';
import type { DataPostgresPool } from '../postgres/pool.js';
import type { GraphStacHttpClient } from './graph-stac/types.js';
import type { ProjectionScope } from './outbox/types.js';

const WRITE = `UNWIND $rows AS row
OPTIONAL MATCH ()-[prior:WISER_BUSINESS_RELATION {projectionId: row.id}]->()
FOREACH (old IN CASE WHEN prior IS NULL THEN [] ELSE [prior] END | DELETE old)
WITH DISTINCT row
FOREACH (ignored IN CASE WHEN row.active THEN [1] ELSE [] END |
 MERGE (s:WiserBusinessEntity {projectionId:row.subjectId}) SET s.name=row.subjectName,s.entityKey=row.subjectKey,s.tenantId=row.tenantId,s.projectId=row.projectId,s.versionId=row.versionId,s.mappingVersion=row.mappingVersion
 MERGE (o:WiserBusinessEntity {projectionId:row.objectId}) SET o.name=row.objectName,o.entityKey=row.objectKey,o.externalId=row.externalId,o.tenantId=row.tenantId,o.projectId=row.projectId,o.versionId=row.versionId,o.mappingVersion=row.mappingVersion
 MERGE (s)-[r:WISER_BUSINESS_RELATION {projectionId:row.id}]->(o) SET r += row.properties
)
RETURN count(row) AS processed`;
export class Neo4jBusinessProjection {
  readonly targetKey: string;
  private readonly url: string;
  private readonly authorization: string;
  private readonly http: GraphStacHttpClient;
  constructor(options: {
    baseUrl: string;
    database: string;
    username: string;
    password: string;
    http: GraphStacHttpClient;
  }) {
    const origin = new URL(options.baseUrl);
    if (
      !['http:', 'https:'].includes(origin.protocol) ||
      origin.username ||
      origin.password ||
      origin.pathname !== '/' ||
      origin.search ||
      origin.hash ||
      !/^[a-zA-Z][a-zA-Z0-9._-]{0,62}$/.test(options.database)
    )
      throw Error('Invalid business projection target');
    this.url = `${origin.origin}/db/${encodeURIComponent(options.database)}/query/v2`;
    this.targetKey = createHash('sha256').update(this.url).digest('hex');
    this.authorization = `Basic ${Buffer.from(`${options.username}:${options.password}`).toString('base64')}`;
    this.http = options.http;
  }
  private async execute(
    statement: string,
    parameters: Record<string, unknown> = {},
  ) {
    const response = await this.http.request({
      method: 'POST',
      url: this.url,
      headers: {
        Authorization: this.authorization,
        'Content-Type': 'application/json',
      },
      body: { statement, parameters },
    });
    const body = response.body as { errors?: unknown[] } | undefined;
    if (response.status < 200 || response.status >= 300 || body?.errors?.length)
      throw Error('Business projection unavailable');
  }
  async ensureIndexes() {
    await this.execute(
      'CREATE CONSTRAINT wiser_business_entity_v1 IF NOT EXISTS FOR (n:WiserBusinessEntity) REQUIRE n.projectionId IS UNIQUE',
    );
    await this.execute(
      'CREATE INDEX wiser_business_relation_v1 IF NOT EXISTS FOR ()-[r:WISER_BUSINESS_RELATION]-() ON (r.projectionId)',
    );
  }
  async putBatch(input: readonly unknown[]) {
    const rows = RelationProjectionBatchSchema.parse(input).map((row) => {
      const prefix = JSON.stringify([
        row.tenantId,
        row.projectId,
        row.versionId,
        row.mappingVersion,
      ]);
      const c = row.candidate;
      return {
        id: row.assertionId,
        active: row.active,
        subjectId: `${prefix}:${c.subject.key}`,
        objectId: `${prefix}:${c.object.key}`,
        subjectName: c.subject.label,
        subjectKey: c.subject.key,
        objectName: c.object.label,
        objectKey: c.object.key,
        externalId: c.object.externalId,
        tenantId: row.tenantId,
        projectId: row.projectId,
        versionId: row.versionId,
        mappingVersion: row.mappingVersion,
        properties: {
          assertionId: row.assertionId,
          tenantId: row.tenantId,
          projectId: row.projectId,
          dataItemId: row.dataItemId,
          versionId: row.versionId,
          mappingVersion: row.mappingVersion,
          securityLevel: row.securityLevel,
          policyVersion: row.policyVersion,
          predicate: c.predicate,
          reviewStatus: 'APPROVED',
          evidence: JSON.stringify(c.evidence),
          qualifiers: JSON.stringify(c.qualifiers),
        },
      };
    });
    if (!rows.length) return;
    await this.execute(WRITE, { rows });
    await this.execute(
      'MATCH (n:WiserBusinessEntity) WHERE n.projectionId IN $ids AND NOT (n)--() DELETE n',
      { ids: [...new Set(rows.flatMap((r) => [r.subjectId, r.objectId]))] },
    );
  }
}

/** Bounded, resumable authority reconciliation also observes withdrawal without relying on projection freshness. */
export class BusinessProjectionConsumer {
  private indexed = false;
  constructor(
    private readonly pool: DataPostgresPool,
    private readonly target: Neo4jBusinessProjection,
  ) {}
  async processBatch(
    scope: ProjectionScope,
    limit: number,
  ): Promise<{
    readEvents: number;
    projected: number;
    sweepComplete: boolean;
  }> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      throw Error('Invalid business projection batch');
    const c = await this.pool.connect();
    try {
      await c.query('begin');
      await c.query(
        "select set_config('wiser.tenant_id',$1,true),set_config('wiser.project_id',$2,true),set_config('wiser.max_security_level',$3,true),set_config('wiser.policy_version',$4,true),set_config('statement_timeout','30000',true)",
        [
          scope.tenantId,
          scope.projectId,
          scope.maxSecurityLevel,
          String(scope.policyVersion),
        ],
      );
      const key = `${this.target.targetKey}:${scope.maxSecurityLevel}:${scope.policyVersion}`;
      await c.query('select pg_advisory_xact_lock(hashtextextended($1,0))', [
        `${scope.tenantId}:${scope.projectId}:${this.target.targetKey}`,
      ]);
      await c.query(
        `insert into service.relation_projection_checkpoint(tenant_id,project_id,target_key,security_level,policy_version) values($1,$2,$3,$4,$5) on conflict(tenant_id,project_id,target_key) do nothing`,
        [
          scope.tenantId,
          scope.projectId,
          key,
          scope.maxSecurityLevel,
          scope.policyVersion,
        ],
      );
      const checkpoint = await c.query(
        'select last_assertion_id from service.relation_projection_checkpoint where tenant_id=$1 and project_id=$2 and target_key=$3 for update',
        [scope.tenantId, scope.projectId, key],
      );
      const rows = await c.query(
        `select b.assertion_id,b.tenant_id,b.project_id,b.data_item_id,b.version_id,b.mapping_version,b.security_level,b.policy_version,b.candidate,
    (a.status='APPROVED' and exists(select 1 from catalog.data_item_version v join catalog.data_item i using(tenant_id,project_id,data_item_id) where v.version_id=b.version_id and i.data_item_id=b.data_item_id and v.publication_status='PUBLISHED' and i.publication_status='PUBLISHED' and v.acceptance_status in ('PASSED','CONDITIONALLY_PASSED') and i.acceptance_status in ('PASSED','CONDITIONALLY_PASSED'))
     and not exists(select 1 from jsonb_array_elements(b.candidate->'evidence') e where not exists(select 1 from catalog.asset s where s.asset_id=(e->>'assetId')::uuid and s.version_id=b.version_id and s.content_hash=decode(e->>'sourceHash','hex') and s.lifecycle_state='RAW'))) active
    from knowledge.assertion_binding b join knowledge.assertion a using(tenant_id,project_id,assertion_id)
    where b.tenant_id=$1 and b.project_id=$2 and ($3::uuid is null or b.assertion_id>$3::uuid) order by b.assertion_id limit $4`,
        [
          scope.tenantId,
          scope.projectId,
          checkpoint.rows[0]?.['last_assertion_id'] ?? null,
          limit,
        ],
      );
      if (!this.indexed) {
        await this.target.ensureIndexes();
        this.indexed = true;
      }
      await this.target.putBatch(
        rows.rows.map((r) => ({
          assertionId: r['assertion_id'],
          tenantId: r['tenant_id'],
          projectId: r['project_id'],
          dataItemId: r['data_item_id'],
          versionId: r['version_id'],
          mappingVersion: r['mapping_version'],
          securityLevel: r['security_level'],
          policyVersion: Number(r['policy_version']),
          candidate: r['candidate'],
          active: r['active'],
        })),
      );
      const complete = rows.rows.length < limit;
      await c.query(
        `update service.relation_projection_checkpoint set last_assertion_id=$4::uuid,sweeps=sweeps+case when $5 then 1 else 0 end,updated_at=clock_timestamp() where tenant_id=$1 and project_id=$2 and target_key=$3`,
        [
          scope.tenantId,
          scope.projectId,
          key,
          complete ? null : rows.rows.at(-1)?.['assertion_id'],
          complete,
        ],
      );
      await c.query('commit');
      return {
        readEvents: complete ? 0 : rows.rows.length,
        projected: rows.rows.length,
        sweepComplete: complete,
      };
    } catch (e) {
      await c.query('rollback').catch(() => undefined);
      throw e;
    } finally {
      c.release();
    }
  }
  close() {
    return this.pool.end();
  }
}
