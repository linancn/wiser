import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import type { PoolClient } from 'pg';
import { expect } from 'vitest';

/** Runs inside the caller's rolled-back transaction; never persists stress data. */
export async function verifyExplorationTiles(
  client: PoolClient,
  scope: {
    tenant: string;
    project: string;
    actor: string;
    item: string;
    version: string;
    asset: string;
    analysis: string;
    queryId: string;
    record: string;
    filteredQueryId: string;
    filteredRecord: string;
  },
  display: 'authority' | 'amap' = 'authority',
) {
  await client.query('reset role');
  const migration = await readFile(
    new URL(
      '../../../../infrastructure/data-foundation/postgres/migrations/0014_exploration_tiles.sql',
      import.meta.url,
    ),
    'utf8',
  ).catch((error: unknown) => {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'ENOENT'
    )
      return '';
    throw error;
  });
  if (migration) await client.query(migration);
  const boundaryMigration = await readFile(
    new URL(
      '../../../../infrastructure/data-foundation/postgres/migrations/0015_exploration_tile_boundaries.sql',
      import.meta.url,
    ),
    'utf8',
  ).catch(() => '');
  if (boundaryMigration) await client.query(boundaryMigration);
  const recordMigration = await readFile(
    new URL(
      '../../../../infrastructure/data-foundation/postgres/migrations/0016_exploration_record_queries.sql',
      import.meta.url,
    ),
    'utf8',
  );
  await client.query(recordMigration);
  await client.query(
    await readFile(
      new URL(
        '../../../../infrastructure/data-foundation/postgres/migrations/0017_exploration_predicate_compilation.sql',
        import.meta.url,
      ),
      'utf8',
    ),
  );
  await client.query(
    await readFile(
      'infrastructure/data-foundation/postgres/migrations/0018_exploration_time.sql',
      'utf8',
    ),
  );
  await client.query(
    await readFile(
      'infrastructure/data-foundation/postgres/migrations/0019_exploration_spatial_filters.sql',
      'utf8',
    ),
  );
  const tileFunction =
    display === 'amap' ? 'wiser_exploration_amap_mvt' : 'wiser_exploration_mvt';
  if (display === 'amap') {
    const existing = await client.query<{ present: string | null }>(
      "select to_regclass('service.analysis_amap_geometry') present",
    );
    if (!existing.rows[0]?.present)
      await client.query(
        await readFile(
          'infrastructure/data-foundation/postgres/migrations/0021_amap_display.sql',
          'utf8',
        ),
      );
    const converted = await client.query<{ lng: number; lat: number }>(
      'select st_x(p) lng, st_y(p) lat from (select service.amap_display_point(st_setsrid(st_makepoint(116.3913,39.9075),4326)) p) coords',
    );
    expect(converted.rows[0]!.lng).toBeCloseTo(116.39754, 5);
    expect(converted.rows[0]!.lat).toBeCloseTo(39.908901, 5);
  }
  const tileRole = `wiser_tile_test_${randomUUID().replaceAll('-', '')}`;
  await client.query(`create role ${tileRole} nologin nosuperuser nobypassrls`);
  await client.query(`grant usage on schema service to ${tileRole}`);
  await client.query(
    `grant execute on function service.${tileFunction}(integer,integer,integer,json) to ${tileRole}`,
  );
  if (display === 'amap') {
    await client.query(
      `grant execute on function service.wiser_spatial_extent_amap_mvt(integer,integer,integer,json) to ${tileRole}`,
    );
    const extentId = randomUUID();
    await client.query(
      `insert into catalog.spatial_extent(spatial_extent_id,tenant_id,project_id,data_item_id,version_id,source_geometry,source_crs,canonical_geometry,security_level) values($1,$2,$3,$4,$5,st_setsrid(st_makepoint(116.3913,39.9075),4326),'EPSG:4326',st_setsrid(st_makepoint(116.3913,39.9075),4490),'L1_INTERNAL')`,
      [extentId, scope.tenant, scope.project, scope.item, scope.version],
    );
    const z = 18;
    const x = Math.floor(((116.39754 + 180) / 360) * 2 ** z);
    const latitude = (39.908901 * Math.PI) / 180;
    const y = Math.floor(
      ((1 - Math.log(Math.tan(latitude) + 1 / Math.cos(latitude)) / Math.PI) /
        2) *
        2 ** z,
    );
    await client.query(`set local role ${tileRole}`);
    const result = await client.query<{ tile: Buffer }>(
      'select service.wiser_spatial_extent_amap_mvt($1,$2,$3,$4::json) tile',
      [
        z,
        x,
        y,
        JSON.stringify({
          tenantId: scope.tenant,
          projectId: scope.project,
          versionId: scope.version,
          maxSecurityLevel: 'L1_INTERNAL',
          policyVersion: '1',
        }),
      ],
    );
    await client.query('reset role');
    const point = new VectorTile(new PbfReader(result.rows[0]!.tile)).layers[
      'authority'
    ]!.feature(0).toGeoJSON(x, y, z).geometry;
    expect(point.type).toBe('Point');
    if (point.type === 'Point') {
      expect(point.coordinates[0]).toBeCloseTo(116.39754, 5);
      expect(point.coordinates[1]).toBeCloseTo(39.908901, 5);
    }
    const authority = await client.query<{ lng: number; lat: number }>(
      'select st_x(source_geometry) lng,st_y(source_geometry) lat from catalog.spatial_extent where spatial_extent_id=$1',
      [extentId],
    );
    expect(authority.rows[0]).toEqual({ lng: 116.3913, lat: 39.9075 });
  }
  const params = {
    tenantId: scope.tenant,
    projectId: scope.project,
    actorId: scope.actor,
    queryId: scope.queryId,
    purpose: 'integration-test',
    maxSecurityLevel: 'L1_INTERNAL',
    policyVersion: '1',
  };
  const tile = async (supplied: typeof params, z = 0, x = 0, y = 0) => {
    await client.query(`set local role ${tileRole}`);
    const result = await client.query<{ tile: Buffer }>(
      `select service.${tileFunction}($1,$2,$3,$4::json) tile`,
      [z, x, y, JSON.stringify(supplied)],
    );
    await client.query('reset role');
    return result.rows[0]!.tile;
  };
  const layer = new VectorTile(new PbfReader(await tile(params))).layers[
    'exploration'
  ]!;
  const filteredLayer = new VectorTile(
    new PbfReader(await tile({ ...params, queryId: scope.filteredQueryId })),
  ).layers['exploration']!;
  expect(filteredLayer.length).toBe(1);
  expect(filteredLayer.feature(0).properties).toMatchObject({
    recordId: scope.filteredRecord,
    count: 1,
  });
  expect(layer.length).toBe(2);
  expect(
    Array.from({ length: layer.length }, (_, i) => layer.feature(i).properties),
  ).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        recordId: scope.record,
        versionId: scope.version,
        assetId: scope.asset,
        count: 1,
      }),
    ]),
  );
  let adjacentCount = 0;
  for (const x of [0, 1])
    for (const y of [0, 1]) {
      const part = new VectorTile(new PbfReader(await tile(params, 1, x, y)))
        .layers['exploration'];
      if (part)
        for (let i = 0; i < part.length; i++)
          adjacentCount += Number(part.feature(i).properties['count']);
    }
  expect(adjacentCount).toBe(2);
  for (const bad of [
    { ...params, actorId: randomUUID() },
    { ...params, projectId: randomUUID() },
    { ...params, tenantId: randomUUID() },
    { ...params, purpose: 'foreign' },
    { ...params, policyVersion: '2' },
    { ...params, maxSecurityLevel: 'L0_PUBLIC' },
  ]) {
    await client.query('savepoint tile_denied');
    await expect(tile(bad)).rejects.toMatchObject({ code: '42501' });
    await client.query('rollback to savepoint tile_denied');
    await client.query('release savepoint tile_denied');
  }
  await client.query('savepoint tile_invalid');
  await expect(tile(params, 1, 2, 0)).rejects.toMatchObject({ code: '22023' });
  await client.query('rollback to savepoint tile_invalid');
  await client.query('release savepoint tile_invalid');
  const expired = randomUUID();
  await client.query(
    `insert into service.exploration_snapshot select $1,tenant_id,project_id,actor_id,purpose,security_level,policy_version,spec,version_refs,now()-interval '2 hours',now()-interval '90 minutes' from service.exploration_snapshot where query_id=$2`,
    [expired, scope.queryId],
  );
  await client.query('savepoint tile_expired');
  await expect(tile({ ...params, queryId: expired })).rejects.toMatchObject({
    code: '42501',
  });
  await client.query('rollback to savepoint tile_expired');
  await client.query('release savepoint tile_expired');
  // A missing member invalidates the whole result, including an otherwise visible point.
  const missing = randomUUID();
  await client.query(
    `insert into service.exploration_snapshot select $1,tenant_id,project_id,actor_id,purpose,security_level,policy_version,spec,version_refs || $3::jsonb,created_at,expires_at from service.exploration_snapshot where query_id=$2`,
    [
      missing,
      scope.queryId,
      JSON.stringify([{ dataItemId: randomUUID(), versionId: randomUUID() }]),
    ],
  );
  await client.query('savepoint tile_revoked');
  await expect(tile({ ...params, queryId: missing })).rejects.toMatchObject({
    code: '42501',
  });
  await client.query('rollback to savepoint tile_revoked');
  await client.query('release savepoint tile_revoked');

  const analysis = randomUUID(),
    operation = randomUUID(),
    query = randomUUID();
  await client.query(
    `insert into service.operation(operation_id,tenant_id,project_id,capability_id,actor_id,status,progress_percent,idempotency_key,request_payload,security_level) values($1::uuid,$2,$3,'data.analysis.create',$4,'RUNNING',0,$1::text,'{}','L1_INTERNAL')`,
    [operation, scope.tenant, scope.project, scope.actor],
  );
  await client.query(
    `insert into service.analysis_run(analysis_id,tenant_id,project_id,version_id,operation_id,parser_version,security_level,policy_version) values($1,$2,$3,$4,$5,'stress','L1_INTERNAL',1)`,
    [analysis, scope.tenant, scope.project, scope.version, operation],
  );
  await client.query(
    `insert into service.analysis_asset(analysis_id,asset_id,tenant_id,project_id,source_hash,status,record_count,feature_count,columns,security_level,policy_version) select $1,asset_id,tenant_id,project_id,source_hash,'READY',100002,100002,columns,security_level,policy_version from service.analysis_asset where analysis_id=$2 and asset_id=$3`,
    [analysis, scope.analysis, scope.asset],
  );
  await client.query(
    `insert into catalog.analysis_record(analysis_id,record_id,asset_id,tenant_id,project_id,record_index,record_values,geom,security_level,policy_version) select $1,gen_random_uuid(),$2,$3,$4,n,jsonb_build_object('time',case when n%2=0 then '29/2/2024 23:59:59' else '1/3/2024 00:00:00' end),st_setsrid(st_makepoint(-170+(n%1000)*0.34,-70+(n/1000)*1.4),4326),'L1_INTERNAL',1 from generate_series(1,100000) n`,
    [analysis, scope.asset, scope.tenant, scope.project],
  );
  const line = randomUUID(),
    polygon = randomUUID();
  await client.query(
    `insert into catalog.analysis_record(analysis_id,record_id,asset_id,tenant_id,project_id,record_index,record_values,geom,security_level,policy_version)
     values($1,$5,$2,$3,$4,100001,'{}',st_geomfromtext('LINESTRING(116.3 39.9,116.5 39.9)',4326),'L1_INTERNAL',1),
           ($1,$6,$2,$3,$4,100002,'{}',st_geomfromtext('POLYGON((116.2 39.8,116.6 39.8,116.6 40,116.2 40,116.2 39.8))',4326),'L1_INTERNAL',1)`,
    [analysis, scope.asset, scope.tenant, scope.project, line, polygon],
  );
  await client.query(
    `update service.analysis_run set status='READY',completed_at=clock_timestamp() where analysis_id=$1`,
    [analysis],
  );
  await client.query(
    `insert into service.exploration_snapshot select $1,tenant_id,project_id,actor_id,purpose,security_level,policy_version,spec,$3::jsonb,created_at,expires_at from service.exploration_snapshot where query_id=$2`,
    [
      query,
      scope.queryId,
      JSON.stringify([
        {
          dataItemId: scope.item,
          versionId: scope.version,
          analysisId: analysis,
        },
      ]),
    ],
  );
  const started = performance.now();
  const bytes = await tile({ ...params, queryId: query });
  const stress = new VectorTile(new PbfReader(bytes)).layers['exploration']!;
  const counts = Array.from({ length: stress.length }, (_, i) =>
    Number(stress.feature(i).properties['count']),
  );
  expect(counts.reduce((a, b) => a + b, 0)).toBe(100002);
  expect(stress.length).toBeLessThanOrEqual(4098);
  expect(bytes.byteLength).toBeLessThan(1024 * 1024);
  // WHERE order is not guaranteed: exercise a legal plan that delays type checks.
  // Both the planner cost and all fixture records are restored by rollback.
  await client.query('savepoint mixed_geometry_plan');
  try {
    await client.query(
      'alter function public.geometrytype(geometry) cost 10000',
    );
    const mixed = new VectorTile(
      new PbfReader(await tile({ ...params, queryId: query }, 6, 52, 24)),
    ).layers['exploration']!;
    const mixedRecords = Array.from({ length: mixed.length }, (_, index) => ({
      recordId: mixed.feature(index).properties['recordId'],
      type: mixed.feature(index).type,
    }));
    expect(mixedRecords).toEqual(
      expect.arrayContaining([
        { recordId: line, type: 2 },
        { recordId: polygon, type: 3 },
      ]),
    );
  } finally {
    await client.query('rollback to savepoint mixed_geometry_plan');
    await client.query('release savepoint mixed_geometry_plan');
  }
  const temporalQuery = randomUUID();
  await client.query(
    `insert into service.exploration_snapshot select $1,tenant_id,project_id,actor_id,purpose,security_level,policy_version,jsonb_set(spec,'{recordQuery}',$3::jsonb),version_refs,created_at,expires_at from service.exploration_snapshot where query_id=$2`,
    [
      temporalQuery,
      query,
      JSON.stringify({
        assetId: scope.asset,
        filters: [
          {
            field: 'time',
            type: 'time',
            format: 'dmy-local',
            utcOffsetMinutes: 480,
            operator: 'lt',
            value: '2024-02-29T16:00:00Z',
          },
        ],
      }),
    ],
  );
  const temporalTile = new VectorTile(
    new PbfReader(await tile({ ...params, queryId: temporalQuery })),
  ).layers['exploration']!;
  expect(
    Array.from({ length: temporalTile.length }, (_, index) =>
      Number(temporalTile.feature(index).properties['count']),
    ).reduce((a, b) => a + b, 0),
  ).toBe(50000);
  const spatialQuery = randomUUID();
  await client.query(
    `insert into service.exploration_snapshot select $1,tenant_id,project_id,actor_id,purpose,security_level,policy_version,jsonb_set(spec,'{spatialBounds}','[-180,-90,-0.1,90]'::jsonb),version_refs,created_at,expires_at from service.exploration_snapshot where query_id=$2`,
    [spatialQuery, temporalQuery],
  );
  const spatialTile = new VectorTile(
    new PbfReader(await tile({ ...params, queryId: spatialQuery })),
  ).layers['exploration']!;
  expect(
    Array.from({ length: spatialTile.length }, (_, index) =>
      Number(spatialTile.feature(index).properties['count']),
    ).reduce((a, b) => a + b, 0),
  ).toBe(25000);
  console.info(
    'Authorized MVT stress',
    JSON.stringify({
      display,
      records: 100002,
      features: stress.length,
      bytes: bytes.byteLength,
      milliseconds: Math.round(performance.now() - started),
    }),
  );
}
