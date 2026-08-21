import {
  SpatialProjectionError,
  SpatialProjectionImmutableConflictError,
} from './errors.js';
import { deterministicSpatialExtentId } from './identity.js';
import type {
  SpatialProjectionClient,
  SpatialProjectionPool,
  SpatialProjectionResult,
} from './types.js';
import { validateSpatialProjectionInput } from './validation.js';

const SET_SCOPE_SQL = `
select
  set_config('wiser.tenant_id', $1, true),
  set_config('wiser.project_id', $2, true),
  set_config('wiser.max_security_level', $3, true),
  set_config('wiser.policy_version', $4, true)
`;

const INSERT_SQL = `
with proposed as (
  select ST_SetSRID(ST_GeomFromGeoJSON($6::jsonb), $7::integer) as source_geometry
)
insert into catalog.spatial_extent (
  spatial_extent_id,
  tenant_id,
  project_id,
  data_item_id,
  version_id,
  source_geometry,
  source_crs,
  canonical_geometry,
  canonical_crs,
  display_geometry,
  security_level,
  policy_version,
  row_version
)
select
  $1::uuid,
  $2::uuid,
  $3::uuid,
  $4::uuid,
  $5::uuid,
  proposed.source_geometry,
  $8,
  ST_Transform(proposed.source_geometry, 4490),
  'EPSG:4490',
  ST_Transform(proposed.source_geometry, 3857),
  $9,
  $10::bigint,
  1
from proposed
on conflict (spatial_extent_id) do nothing
returning spatial_extent_id::text
`;

const VERIFY_REPLAY_SQL = `
with proposed as (
  select ST_SetSRID(ST_GeomFromGeoJSON($6::jsonb), $7::integer) as source_geometry
)
select (
  existing.tenant_id = $2::uuid
  and existing.project_id = $3::uuid
  and existing.data_item_id = $4::uuid
  and existing.version_id = $5::uuid
  and existing.source_crs = $8
  and existing.security_level = $9
  and existing.policy_version = $10::bigint
  and existing.canonical_crs = 'EPSG:4490'
  and ST_AsEWKB(existing.source_geometry, 'XDR') = ST_AsEWKB(proposed.source_geometry, 'XDR')
  and ST_AsEWKB(existing.canonical_geometry, 'XDR') = ST_AsEWKB(ST_Transform(proposed.source_geometry, 4490), 'XDR')
  and ST_AsEWKB(existing.display_geometry, 'XDR') = ST_AsEWKB(ST_Transform(proposed.source_geometry, 3857), 'XDR')
) as immutable_match
from catalog.spatial_extent as existing
cross join proposed
where existing.spatial_extent_id = $1::uuid
for update of existing
`;

function boolean(row: Readonly<Record<string, unknown>> | undefined): boolean {
  return row?.immutable_match === true;
}

async function rollback(client: SpatialProjectionClient): Promise<void> {
  try {
    await client.query('ROLLBACK');
  } catch {
    // The original sanitized adapter error remains authoritative.
  }
}

export class PostgisSpatialProjection {
  constructor(private readonly pool: SpatialProjectionPool) {
    if (pool === null || typeof pool?.connect !== 'function') {
      throw new SpatialProjectionError(
        'INVALID_SPATIAL_PROJECTION_CONFIG',
        'PostGIS projection pool is invalid.',
      );
    }
  }

  async put(value: unknown): Promise<SpatialProjectionResult> {
    const input = validateSpatialProjectionInput(value);
    const spatialExtentId = deterministicSpatialExtentId(value);
    const geometry = JSON.stringify(input.sourceGeoJson);
    const values = [
      spatialExtentId,
      input.tenantId,
      input.projectId,
      input.dataItemId,
      input.versionId,
      geometry,
      input.sourceSrid,
      input.sourceCrs,
      input.securityLevel,
      input.policyVersion,
    ] as const;
    let client: SpatialProjectionClient;
    try {
      client = await this.pool.connect();
    } catch {
      throw new SpatialProjectionError(
        'SPATIAL_PROJECTION_DATABASE_ERROR',
        'The PostGIS spatial projection transaction failed.',
      );
    }

    try {
      await client.query('BEGIN');
      await client.query(SET_SCOPE_SQL, [
        input.tenantId,
        input.projectId,
        input.securityLevel,
        input.policyVersion.toString(),
      ]);
      const inserted = await client.query(INSERT_SQL, values);
      if (inserted.rows.length > 0) {
        await client.query('COMMIT');
        return Object.freeze({ spatialExtentId, replayed: false });
      }

      const replay = await client.query(VERIFY_REPLAY_SQL, values);
      if (!boolean(replay.rows[0])) {
        throw new SpatialProjectionImmutableConflictError();
      }
      await client.query('COMMIT');
      return Object.freeze({ spatialExtentId, replayed: true });
    } catch (error) {
      await rollback(client);
      if (error instanceof SpatialProjectionImmutableConflictError) throw error;
      throw new SpatialProjectionError(
        'SPATIAL_PROJECTION_DATABASE_ERROR',
        'The PostGIS spatial projection transaction failed.',
      );
    } finally {
      client.release();
    }
  }
}
