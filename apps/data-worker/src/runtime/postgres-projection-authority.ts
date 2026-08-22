import type {
  DataPostgresClient,
  DataPostgresPool,
  ProjectionEvent,
} from '@wiser/data-infra';

import type { ProjectionPublicationGate } from '../runtime.js';
import type {
  ProjectionAuthorityIds,
  ProjectionAuthoritySnapshot,
  ProjectionHydrationAuthority,
} from './projection-hydrator.js';

const SET_SCOPE_SQL = `
select set_config('wiser.tenant_id', $1, true),
  set_config('wiser.project_id', $2, true),
  set_config('wiser.max_security_level', $3, true),
  set_config('wiser.policy_version', $4, true)
`;

const ITEM_VERSION_SQL = `
/* data-worker.projection-hydration.item-version */
select item.data_item_id, item.name, item.business_domains,
  item.security_level as item_security_level,
  item.policy_version as item_policy_version,
  version.version_id, encode(version.source_hash, 'hex') as version_source_hash,
  version.quality_grade, version.acceptance_status,
  version.publication_status, version.committed_at,
  version.security_level as version_security_level,
  version.policy_version as version_policy_version
from catalog.data_item as item
join catalog.data_item_version as version
  on version.tenant_id = item.tenant_id
 and version.project_id = item.project_id
 and version.data_item_id = item.data_item_id
where item.tenant_id = $1::uuid and item.project_id = $2::uuid
  and item.data_item_id = $3::uuid and version.version_id = $4::uuid
  and item.security_level = $5 and item.policy_version = $6::bigint
  and version.security_level = $5 and version.policy_version = $6::bigint
  and security.authorized_row(item.tenant_id, item.project_id,
    item.security_level, item.policy_version)
  and security.authorized_row(version.tenant_id, version.project_id,
    version.security_level, version.policy_version)
`;

const ASSETS_SQL = `
/* data-worker.projection-hydration.assets */
select asset.asset_id, asset.content_blob_id,
  encode(blob.content_hash, 'hex') as source_hash,
  asset.media_type, asset.byte_size, asset.storage_key, input.ordinal
from ingestion.input_asset as input
join catalog.asset as asset
  on asset.tenant_id = input.tenant_id
 and asset.project_id = input.project_id
 and asset.asset_id = input.asset_id
join catalog.content_blob as blob
  on blob.tenant_id = asset.tenant_id
 and blob.project_id = asset.project_id
 and blob.content_blob_id = asset.content_blob_id
where input.tenant_id = $1::uuid and input.project_id = $2::uuid
  and input.ingestion_id = $3::uuid
  and asset.version_id = $4::uuid
  and asset.asset_id = any($5::uuid[])
  and blob.content_blob_id = any($6::uuid[])
  and security.security_rank(input.security_level) <= security.security_rank($7)
  and input.policy_version <= $8::bigint
  and security.security_rank(asset.security_level) <= security.security_rank($7)
  and asset.policy_version <= $8::bigint
  and security.security_rank(blob.security_level) <= security.security_rank($7)
  and blob.policy_version <= $8::bigint
  and security.authorized_row(input.tenant_id, input.project_id,
    input.security_level, input.policy_version)
  and security.authorized_row(asset.tenant_id, asset.project_id,
    asset.security_level, asset.policy_version)
  and security.authorized_row(blob.tenant_id, blob.project_id,
    blob.security_level, blob.policy_version)
order by input.ordinal, asset.asset_id
`;

const EVIDENCE_SQL = `
/* data-worker.projection-hydration.evidence */
select evidence_fragment_id, asset_id, locator,
  encode(content_hash, 'hex') as source_hash, excerpt
from knowledge.evidence_fragment
where tenant_id = $1::uuid and project_id = $2::uuid
  and data_item_id = $3::uuid and version_id = $4::uuid
  and evidence_fragment_id = any($5::uuid[])
  and security_level = $6 and policy_version = $7::bigint
  and security.authorized_row(tenant_id, project_id,
    security_level, policy_version)
order by array_position($5::uuid[], evidence_fragment_id)
`;

const SPATIAL_SQL = `
/* data-worker.projection-hydration.spatial */
select spatial_extent_id, source_crs,
  ST_AsGeoJSON(source_geometry)::jsonb as source_geojson,
  ST_AsGeoJSON(ST_Transform(canonical_geometry, 4326))::jsonb as wgs84_geojson,
  array[
    ST_XMin(ST_Extent(ST_Transform(canonical_geometry, 4326))),
    ST_YMin(ST_Extent(ST_Transform(canonical_geometry, 4326))),
    ST_XMax(ST_Extent(ST_Transform(canonical_geometry, 4326))),
    ST_YMax(ST_Extent(ST_Transform(canonical_geometry, 4326)))
  ]::double precision[] as bbox
from catalog.spatial_extent
where tenant_id = $1::uuid and project_id = $2::uuid
  and data_item_id = $3::uuid and version_id = $4::uuid
  and spatial_extent_id = any($5::uuid[])
  and security_level = $6 and policy_version = $7::bigint
  and security.authorized_row(tenant_id, project_id,
    security_level, policy_version)
group by spatial_extent_id, source_crs, source_geometry, canonical_geometry
order by array_position($5::uuid[], spatial_extent_id)
`;

const QUALITY_SQL = `
/* data-worker.projection-hydration.quality */
select check_run.check_run_id, scorecard.score, scorecard.quality_grade,
  scorecard.acceptance_status
from quality.check_run as check_run
join quality.scorecard as scorecard
  on scorecard.tenant_id = check_run.tenant_id
 and scorecard.project_id = check_run.project_id
 and scorecard.check_run_id = check_run.check_run_id
where check_run.tenant_id = $1::uuid and check_run.project_id = $2::uuid
  and check_run.check_run_id = $3::uuid
  and check_run.ingestion_id = $4::uuid
  and check_run.security_level = $5 and check_run.policy_version = $6::bigint
  and scorecard.security_level = $5 and scorecard.policy_version = $6::bigint
  and security.authorized_row(check_run.tenant_id, check_run.project_id,
    check_run.security_level, check_run.policy_version)
  and security.authorized_row(scorecard.tenant_id, scorecard.project_id,
    scorecard.security_level, scorecard.policy_version)
`;

const LINEAGE_SQL = `
/* data-worker.projection-hydration.lineage */
select process_run_id, process_type, implementation_version
from lineage.process_run
where tenant_id = $1::uuid and project_id = $2::uuid
  and process_run_id = $3::uuid and ingestion_id = $4::uuid
  and security_level = $5 and policy_version = $6::bigint
  and security.authorized_row(tenant_id, project_id,
    security_level, policy_version)
`;

const PUBLICATION_LOCK_SQL = `
/* data-worker.publication.lock */
select session.state, session.row_version as session_row_version,
  session.operation_id, item.publication_status,
  item.row_version as item_row_version, version.acceptance_status,
  version.publication_status as version_publication_status,
  version.published_at as version_published_at,
  operation.status as operation_status
from ingestion.session as session
join catalog.data_item as item
  on item.tenant_id = session.tenant_id
 and item.project_id = session.project_id
 and item.data_item_id = session.ingestion_id
join catalog.data_item_version as version
  on version.tenant_id = item.tenant_id
 and version.project_id = item.project_id
 and version.data_item_id = item.data_item_id
join service.operation as operation
  on operation.tenant_id = session.tenant_id
 and operation.project_id = session.project_id
 and operation.operation_id = session.operation_id
where session.tenant_id = $1::uuid and session.project_id = $2::uuid
  and item.data_item_id = $3::uuid and version.version_id = $4::uuid
  and session.security_level = $5 and session.policy_version = $6::bigint
  and item.security_level = $5 and item.policy_version = $6::bigint
  and version.security_level = $5 and version.policy_version = $6::bigint
  and operation.security_level = $5 and operation.policy_version = $6::bigint
  and security.authorized_row(session.tenant_id, session.project_id,
    session.security_level, session.policy_version)
for update of session, item, version, operation
`;

const PROJECTION_GATE_SQL = `
/* data-worker.publication.projection-gate */
select projection_kind, status
from service.projection_status
where tenant_id = $1::uuid and project_id = $2::uuid
  and data_item_id = $3::uuid and version_id = $4::uuid
  and security_level = $5 and policy_version = $6::bigint
  and security.authorized_row(tenant_id, project_id,
    security_level, policy_version)
order by projection_kind
for update
`;

const INGESTION_PROJECTING_SQL = `
update ingestion.session set state = 'PROJECTING',
  row_version = row_version + 1, updated_at = clock_timestamp()
where tenant_id = $1::uuid and project_id = $2::uuid
  and ingestion_id = $3::uuid and state = 'COMMITTED'
  and row_version = $4::bigint and security_level = $5
  and policy_version = $6::bigint
returning row_version
`;

const INGESTION_PUBLISHED_SQL = `
update ingestion.session set state = 'PUBLISHED',
  row_version = row_version + 1, updated_at = clock_timestamp()
where tenant_id = $1::uuid and project_id = $2::uuid
  and ingestion_id = $3::uuid and state = 'PROJECTING'
  and row_version = $4::bigint and security_level = $5
  and policy_version = $6::bigint
returning row_version
`;

const DATA_ITEM_PUBLISHED_SQL = `
update catalog.data_item set publication_status = 'PUBLISHED',
  row_version = row_version + 1, updated_at = clock_timestamp()
where tenant_id = $1::uuid and project_id = $2::uuid
  and data_item_id = $3::uuid
  and publication_status in ('UNPUBLISHED', 'PUBLISHING')
  and row_version = $4::bigint and security_level = $5
  and policy_version = $6::bigint
returning row_version
`;

const DATA_ITEM_VERSION_PUBLISHED_SQL = `
update catalog.data_item_version set publication_status = 'PUBLISHED',
  published_at = clock_timestamp(), updated_at = clock_timestamp()
where tenant_id = $1::uuid and project_id = $2::uuid
  and data_item_id = $3::uuid and version_id = $4::uuid
  and publication_status = 'UNPUBLISHED' and published_at is null
  and security_level = $5 and policy_version = $6::bigint
returning version_id
`;

const PUBLICATION_OPERATION_EVENTS_SQL = `
with next_sequence as (
  select coalesce(max(sequence_number), 0) as sequence_number
  from service.operation_event
  where tenant_id = $1::uuid and project_id = $2::uuid
    and operation_id = $3::uuid
)
insert into service.operation_event (
  tenant_id, project_id, operation_id, sequence_number, from_status,
  to_status, event_type, payload, security_level, policy_version, row_version
)
select $1::uuid, $2::uuid, $3::uuid,
  next_sequence.sequence_number + sequence_offset,
  $4, $4, event_type,
  jsonb_build_object('dataItemId', $5::uuid, 'versionId', $6::uuid),
  $7, $8::bigint, 1
from next_sequence
cross join (values (1, 'PROJECTION_COMPLETED'), (2, 'PUBLISHED'))
  as publication(sequence_offset, event_type)
`;

const PUBLICATION_AUDIT_SQL = `
insert into security.audit_event (
  tenant_id, project_id, actor_id, action, resource_type, resource_id,
  decision, context, security_level, policy_version, row_version
) values ($1::uuid, $2::uuid, $3::uuid, 'data.version.publish',
  'data-item-version', $4, 'SUCCEEDED',
  jsonb_build_object('dataItemId', $5::uuid, 'versionId', $4::uuid),
  $6, $7::bigint, 1)
`;

const IS_PUBLISHED_SQL = `
select exists (
  select 1
  from ingestion.session as session
  join catalog.data_item as item
    on item.tenant_id = session.tenant_id
   and item.project_id = session.project_id
   and item.data_item_id = session.ingestion_id
  join catalog.data_item_version as version
    on version.tenant_id = item.tenant_id
   and version.project_id = item.project_id
   and version.data_item_id = item.data_item_id
  where session.tenant_id = $1::uuid and session.project_id = $2::uuid
    and version.version_id = $3::uuid and session.state = 'PUBLISHED'
    and item.publication_status = 'PUBLISHED'
    and version.publication_status = 'PUBLISHED'
    and version.published_at is not null
    and session.security_level = $4 and session.policy_version = $5::bigint
    and item.security_level = $4 and item.policy_version = $5::bigint
) as published
`;

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROJECTION_KINDS = new Set([
  'POSTGIS',
  'WEAVIATE',
  'OPENSEARCH',
  'NEO4J',
  'STAC',
]);

function text(row: Readonly<Record<string, unknown>>, key: string): string {
  const value = row[key];
  if (typeof value !== 'string' || value.length < 1) {
    if (value instanceof Date) return value.toISOString();
    throw new Error('Projection authority returned invalid text.');
  }
  return value;
}

function integer(row: Readonly<Record<string, unknown>>, key: string): number {
  const value = Number(row[key]);
  if (!Number.isSafeInteger(value)) {
    throw new Error('Projection authority returned invalid integer.');
  }
  return value;
}

function record(
  row: Readonly<Record<string, unknown>>,
  key: string,
): Readonly<Record<string, unknown>> {
  const value = row[key];
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Projection authority returned invalid object.');
  }
  return value as Readonly<Record<string, unknown>>;
}

function stringArray(
  row: Readonly<Record<string, unknown>>,
  key: string,
): readonly string[] {
  const value = row[key];
  if (!Array.isArray(value)) {
    throw new Error('Projection authority returned invalid array.');
  }
  const result: string[] = [];
  for (const item of value as unknown[]) {
    if (typeof item !== 'string') {
      throw new Error('Projection authority returned invalid array.');
    }
    result.push(item);
  }
  return Object.freeze(result);
}

function numberArray(
  row: Readonly<Record<string, unknown>>,
  key: string,
): readonly number[] {
  const value = row[key];
  if (!Array.isArray(value)) {
    throw new Error('Projection authority returned invalid coordinates.');
  }
  const result: number[] = [];
  for (const item of value as unknown[]) {
    if (typeof item !== 'number' || !Number.isFinite(item)) {
      throw new Error('Projection authority returned invalid coordinates.');
    }
    result.push(item);
  }
  return Object.freeze(result);
}

async function rollback(client: DataPostgresClient): Promise<void> {
  try {
    await client.query('ROLLBACK');
  } catch {
    // The sanitized authority failure remains authoritative.
  }
}

async function transaction<Result>(
  pool: DataPostgresPool,
  scope: {
    readonly tenantId: string;
    readonly projectId: string;
    readonly securityLevel: ProjectionEvent['securityLevel'];
    readonly policyVersion: number;
  },
  readOnly: boolean,
  operation: (client: DataPostgresClient) => Promise<Result>,
): Promise<Result> {
  const client = await pool.connect();
  try {
    await client.query(readOnly ? 'BEGIN READ ONLY' : 'BEGIN');
    await client.query(SET_SCOPE_SQL, [
      scope.tenantId,
      scope.projectId,
      scope.securityLevel,
      String(scope.policyVersion),
    ]);
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch {
    await rollback(client);
    throw new Error('Projection authority transaction failed safely.');
  } finally {
    client.release();
  }
}

export class PostgresProjectionHydrationAuthority implements ProjectionHydrationAuthority {
  constructor(private readonly pool: DataPostgresPool) {}

  load(
    event: ProjectionEvent,
    ids: ProjectionAuthorityIds,
  ): Promise<ProjectionAuthoritySnapshot> {
    return transaction(this.pool, event, true, async (client) => {
      const [itemVersion, assets, evidence, spatial, quality, lineage] =
        await Promise.all([
          client.query(ITEM_VERSION_SQL, [
            event.tenantId,
            event.projectId,
            ids.dataItemId,
            ids.versionId,
            event.securityLevel,
            event.policyVersion,
          ]),
          client.query(ASSETS_SQL, [
            event.tenantId,
            event.projectId,
            ids.dataItemId,
            ids.versionId,
            ids.assetIds,
            ids.contentBlobIds,
            event.securityLevel,
            event.policyVersion,
          ]),
          client.query(EVIDENCE_SQL, [
            event.tenantId,
            event.projectId,
            ids.dataItemId,
            ids.versionId,
            ids.evidenceFragmentIds,
            event.securityLevel,
            event.policyVersion,
          ]),
          client.query(SPATIAL_SQL, [
            event.tenantId,
            event.projectId,
            ids.dataItemId,
            ids.versionId,
            ids.spatialExtentIds,
            event.securityLevel,
            event.policyVersion,
          ]),
          client.query(QUALITY_SQL, [
            event.tenantId,
            event.projectId,
            ids.checkRunId,
            ids.dataItemId,
            event.securityLevel,
            event.policyVersion,
          ]),
          client.query(LINEAGE_SQL, [
            event.tenantId,
            event.projectId,
            ids.processRunId,
            ids.dataItemId,
            event.securityLevel,
            event.policyVersion,
          ]),
        ]);
      const row = itemVersion.rows[0];
      const qualityRow = quality.rows[0];
      const lineageRow = lineage.rows[0];
      if (
        row === undefined ||
        qualityRow === undefined ||
        lineageRow === undefined ||
        itemVersion.rows.length !== 1 ||
        assets.rows.length !== ids.assetIds.length ||
        evidence.rows.length !== ids.evidenceFragmentIds.length ||
        spatial.rows.length !== ids.spatialExtentIds.length ||
        quality.rows.length !== 1 ||
        lineage.rows.length !== 1
      ) {
        throw new Error('Projection authority rows are incomplete.');
      }
      return {
        tenantId: event.tenantId,
        projectId: event.projectId,
        dataItem: {
          dataItemId: text(row, 'data_item_id'),
          name: text(row, 'name'),
          businessDomains: stringArray(row, 'business_domains'),
          securityLevel: text(
            row,
            'item_security_level',
          ) as ProjectionEvent['securityLevel'],
          policyVersion: integer(row, 'item_policy_version'),
        },
        version: {
          versionId: text(row, 'version_id'),
          sourceHash: text(row, 'version_source_hash'),
          qualityGrade: text(
            row,
            'quality_grade',
          ) as ProjectionAuthoritySnapshot['version']['qualityGrade'],
          acceptanceStatus: text(
            row,
            'acceptance_status',
          ) as ProjectionAuthoritySnapshot['version']['acceptanceStatus'],
          publicationStatus: text(
            row,
            'publication_status',
          ) as ProjectionAuthoritySnapshot['version']['publicationStatus'],
          committedAt: text(row, 'committed_at'),
          securityLevel: text(
            row,
            'version_security_level',
          ) as ProjectionEvent['securityLevel'],
          policyVersion: integer(row, 'version_policy_version'),
        },
        assets: assets.rows.map((asset) => ({
          assetId: text(asset, 'asset_id'),
          contentBlobId: text(asset, 'content_blob_id'),
          sourceHash: text(asset, 'source_hash'),
          mediaType: text(asset, 'media_type'),
          sizeBytes: integer(asset, 'byte_size'),
          versionStorageKey: text(asset, 'storage_key'),
          ordinal: integer(asset, 'ordinal'),
        })),
        evidence: evidence.rows.map((fragment) => ({
          evidenceId: text(fragment, 'evidence_fragment_id'),
          assetId: text(fragment, 'asset_id'),
          sourceHash: text(fragment, 'source_hash'),
          locator: record(fragment, 'locator'),
          excerpt: fragment.excerpt === null ? null : text(fragment, 'excerpt'),
        })),
        spatial: spatial.rows.map((extent) => ({
          spatialExtentId: text(extent, 'spatial_extent_id'),
          sourceCrs: text(extent, 'source_crs'),
          sourceGeoJson: record(
            extent,
            'source_geojson',
          ) as ProjectionAuthoritySnapshot['spatial'][number]['sourceGeoJson'],
          wgs84GeoJson: record(
            extent,
            'wgs84_geojson',
          ) as ProjectionAuthoritySnapshot['spatial'][number]['wgs84GeoJson'],
          bbox: numberArray(extent, 'bbox'),
        })),
        quality: {
          checkRunId: text(qualityRow, 'check_run_id'),
          score: Number(qualityRow.score),
          qualityGrade: text(
            qualityRow,
            'quality_grade',
          ) as ProjectionAuthoritySnapshot['quality']['qualityGrade'],
          acceptanceStatus: text(
            qualityRow,
            'acceptance_status',
          ) as ProjectionAuthoritySnapshot['quality']['acceptanceStatus'],
        },
        lineage: {
          processRunId: text(lineageRow, 'process_run_id'),
          processType: text(lineageRow, 'process_type'),
          implementationVersion: text(lineageRow, 'implementation_version'),
        },
      };
    });
  }

  close(): Promise<void> {
    return this.pool.end();
  }
}

export class PostgresProjectionPublicationGate implements ProjectionPublicationGate {
  constructor(
    private readonly pool: DataPostgresPool,
    private readonly actorId: string,
  ) {
    if (!UUID.test(actorId)) {
      throw new Error('Projection publication actor is invalid.');
    }
  }

  publish(event: ProjectionEvent): Promise<void> {
    return transaction(this.pool, event, false, async (client) => {
      const locked = await client.query(PUBLICATION_LOCK_SQL, [
        event.tenantId,
        event.projectId,
        event.dataItemId,
        event.versionId,
        event.securityLevel,
        event.policyVersion,
      ]);
      const row = locked.rows[0];
      if (row === undefined || locked.rows.length !== 1) {
        throw new Error('Publication authority row is missing.');
      }
      const states = await client.query(PROJECTION_GATE_SQL, [
        event.tenantId,
        event.projectId,
        event.dataItemId,
        event.versionId,
        event.securityLevel,
        event.policyVersion,
      ]);
      if (
        states.rows.length !== PROJECTION_KINDS.size ||
        states.rows.some(
          (state) =>
            !PROJECTION_KINDS.has(text(state, 'projection_kind')) ||
            text(state, 'status') !== 'SUCCEEDED',
        ) ||
        !['PASSED', 'CONDITIONALLY_PASSED'].includes(
          text(row, 'acceptance_status'),
        )
      ) {
        throw new Error('Publication gate is not satisfied.');
      }
      const state = text(row, 'state');
      if (state === 'PUBLISHED') {
        if (
          text(row, 'publication_status') !== 'PUBLISHED' ||
          text(row, 'version_publication_status') !== 'PUBLISHED' ||
          row['version_published_at'] === null
        ) {
          throw new Error('Publication authority is inconsistent.');
        }
        return;
      }
      if (state !== 'COMMITTED' && state !== 'PROJECTING') {
        throw new Error('Publication state is invalid.');
      }
      let sessionVersion = integer(row, 'session_row_version');
      if (state === 'COMMITTED') {
        const projecting = await client.query(INGESTION_PROJECTING_SQL, [
          event.tenantId,
          event.projectId,
          event.dataItemId,
          sessionVersion,
          event.securityLevel,
          event.policyVersion,
        ]);
        const projected = projecting.rows[0];
        if (projected === undefined) throw new Error('Publication conflict.');
        sessionVersion = integer(projected, 'row_version');
      }
      const published = await client.query(INGESTION_PUBLISHED_SQL, [
        event.tenantId,
        event.projectId,
        event.dataItemId,
        sessionVersion,
        event.securityLevel,
        event.policyVersion,
      ]);
      if (published.rows.length !== 1) throw new Error('Publication conflict.');
      if (text(row, 'publication_status') !== 'PUBLISHED') {
        const item = await client.query(DATA_ITEM_PUBLISHED_SQL, [
          event.tenantId,
          event.projectId,
          event.dataItemId,
          integer(row, 'item_row_version'),
          event.securityLevel,
          event.policyVersion,
        ]);
        if (item.rows.length !== 1) throw new Error('Publication conflict.');
      }
      if (text(row, 'version_publication_status') !== 'PUBLISHED') {
        const version = await client.query(DATA_ITEM_VERSION_PUBLISHED_SQL, [
          event.tenantId,
          event.projectId,
          event.dataItemId,
          event.versionId,
          event.securityLevel,
          event.policyVersion,
        ]);
        if (version.rows.length !== 1) throw new Error('Publication conflict.');
      }
      const operationStatus = text(row, 'operation_status');
      if (operationStatus !== 'RUNNING') {
        throw new Error('Publication Operation is not running.');
      }
      await client.query(PUBLICATION_OPERATION_EVENTS_SQL, [
        event.tenantId,
        event.projectId,
        text(row, 'operation_id'),
        operationStatus,
        event.dataItemId,
        event.versionId,
        event.securityLevel,
        event.policyVersion,
      ]);
      await client.query(PUBLICATION_AUDIT_SQL, [
        event.tenantId,
        event.projectId,
        this.actorId,
        event.versionId,
        event.dataItemId,
        event.securityLevel,
        event.policyVersion,
      ]);
    });
  }

  isPublished(input: {
    readonly tenantId: string;
    readonly projectId: string;
    readonly versionId: string;
    readonly securityLevel: ProjectionEvent['securityLevel'];
    readonly policyVersion: number;
  }): Promise<boolean> {
    return transaction(this.pool, input, true, async (client) => {
      const result = await client.query(IS_PUBLISHED_SQL, [
        input.tenantId,
        input.projectId,
        input.versionId,
        input.securityLevel,
        input.policyVersion,
      ]);
      return result.rows[0]?.published === true;
    });
  }

  close(): Promise<void> {
    return this.pool.end();
  }
}
