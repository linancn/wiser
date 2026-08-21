import { describe, expect, it } from 'vitest';

import {
  PostgisSpatialProjection,
  SpatialProjectionError,
  SpatialProjectionImmutableConflictError,
  deterministicSpatialExtentId,
  type SpatialProjectionClient,
  type SpatialProjectionPool,
} from '../../../src/projections/postgis/index.js';

const input = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  projectId: '22222222-2222-4222-8222-222222222222',
  dataItemId: '33333333-3333-4333-8333-333333333333',
  versionId: '44444444-4444-4444-8444-444444444444',
  sourceGeoJson: {
    type: 'Polygon',
    coordinates: [
      [
        [116.1, 39.7],
        [116.5, 39.7],
        [116.5, 40.1],
        [116.1, 40.1],
        [116.1, 39.7],
      ],
    ],
  },
  sourceCrs: 'EPSG:4326',
  securityLevel: 'L2_RESTRICTED',
  policyVersion: 7,
} as const;

class FakeClient implements SpatialProjectionClient {
  readonly queries: Array<{
    readonly text: string;
    readonly values?: readonly unknown[];
  }> = [];
  insertRows: readonly Record<string, unknown>[] = [
    { spatial_extent_id: deterministicSpatialExtentId(input) },
  ];
  replayMatches = true;
  databaseError?: unknown;
  released = false;

  query(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ readonly rows: readonly Record<string, unknown>[] }> {
    this.queries.push(values === undefined ? { text } : { text, values });
    if (
      this.databaseError !== undefined &&
      /insert into catalog\.spatial_extent/i.test(text)
    ) {
      return Promise.reject(
        this.databaseError instanceof Error
          ? this.databaseError
          : new Error('synthetic database error'),
      );
    }
    if (/insert into catalog\.spatial_extent/i.test(text)) {
      return Promise.resolve({ rows: this.insertRows });
    }
    if (/select[\s\S]*immutable_match/i.test(text)) {
      return Promise.resolve({
        rows: [{ immutable_match: this.replayMatches }],
      });
    }
    return Promise.resolve({ rows: [] });
  }

  release(): void {
    this.released = true;
  }
}

class FakePool implements SpatialProjectionPool {
  readonly client = new FakeClient();

  connect(): Promise<SpatialProjectionClient> {
    return Promise.resolve(this.client);
  }
}

describe('PostGIS spatial projection identity and validation', () => {
  it('derives one stable RFC UUID from tenant/project/data-item/version identity', () => {
    const first = deterministicSpatialExtentId(input);
    expect(first).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(deterministicSpatialExtentId({ ...input })).toBe(first);
    expect(
      deterministicSpatialExtentId({
        ...input,
        versionId: '55555555-5555-4555-8555-555555555555',
      }),
    ).not.toBe(first);
  });

  it.each([
    { ...input, sourceCrs: 'EPSG:4326; drop table catalog.spatial_extent' },
    {
      ...input,
      sourceGeoJson: { type: 'Feature', geometry: input.sourceGeoJson },
    },
    {
      ...input,
      sourceGeoJson: { type: 'Point', coordinates: [1, Number.NaN] },
    },
    { ...input, sourceGeoJson: { type: 'Polygon', coordinates: [[[0, 0]]] } },
    { ...input, policyVersion: 0 },
    { ...input, securityLevel: 'PUBLIC' },
    { ...input, sql: 'select * from catalog.spatial_extent' },
  ])(
    'rejects malformed, traversal, and unknown input %#',
    async (candidate) => {
      const pool = new FakePool();
      const projection = new PostgisSpatialProjection(pool);
      await expect(projection.put(candidate)).rejects.toBeInstanceOf(
        SpatialProjectionError,
      );
      expect(pool.client.queries).toHaveLength(0);
    },
  );
});

describe('PostGIS spatial projection transaction', () => {
  it('sets every RLS GUC and writes source, CGCS2000, and display geometries with fixed SQL parameters', async () => {
    const pool = new FakePool();
    const projection = new PostgisSpatialProjection(pool);

    await expect(projection.put(input)).resolves.toEqual({
      spatialExtentId: deterministicSpatialExtentId(input),
      replayed: false,
    });

    const statements = pool.client.queries.map(({ text }) => text.trim());
    expect(statements.at(0)).toBe('BEGIN');
    expect(statements.at(-1)).toBe('COMMIT');
    expect(
      statements.filter((statement) => /set_config/i.test(statement)),
    ).toHaveLength(1);
    const insert = pool.client.queries.find(({ text }) =>
      /insert into catalog\.spatial_extent/i.test(text),
    );
    expect(insert?.text).toMatch(/ST_GeomFromGeoJSON\(\$6::jsonb\)/i);
    expect(insert?.text).toMatch(/ST_SetSRID\([\s\S]*\$7::integer\)/i);
    expect(insert?.text).toMatch(/ST_Transform\([\s\S]*4490\)/i);
    expect(insert?.text).toMatch(/ST_Transform\([\s\S]*3857\)/i);
    expect(insert?.text).toMatch(
      /on conflict \(spatial_extent_id\) do nothing/i,
    );
    expect(insert?.values).toEqual([
      deterministicSpatialExtentId(input),
      input.tenantId,
      input.projectId,
      input.dataItemId,
      input.versionId,
      JSON.stringify(input.sourceGeoJson),
      4326,
      input.sourceCrs,
      input.securityLevel,
      input.policyVersion,
    ]);
    expect(pool.client.released).toBe(true);
  });

  it('treats an exact immutable replay as success without another row', async () => {
    const pool = new FakePool();
    pool.client.insertRows = [];
    const projection = new PostgisSpatialProjection(pool);

    await expect(projection.put(input)).resolves.toEqual({
      spatialExtentId: deterministicSpatialExtentId(input),
      replayed: true,
    });

    expect(
      pool.client.queries.some(({ text }) => /ST_AsEWKB/i.test(text)),
    ).toBe(true);
    expect(pool.client.queries.at(-1)?.text.trim()).toBe('COMMIT');
  });

  it('fails closed when the same deterministic identity has different immutable content', async () => {
    const pool = new FakePool();
    pool.client.insertRows = [];
    pool.client.replayMatches = false;
    const projection = new PostgisSpatialProjection(pool);

    await expect(projection.put(input)).rejects.toBeInstanceOf(
      SpatialProjectionImmutableConflictError,
    );

    expect(pool.client.queries.map(({ text }) => text.trim())).toContain(
      'ROLLBACK',
    );
    expect(pool.client.released).toBe(true);
  });

  it('redacts SQL, geometry, and database details from adapter errors', async () => {
    const pool = new FakePool();
    pool.client.databaseError = new Error(
      'password=secret; invalid geometry near select * from private.table',
    );
    const projection = new PostgisSpatialProjection(pool);

    const failure = await projection
      .put(input)
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(SpatialProjectionError);
    expect(String(failure)).not.toContain('secret');
    expect(String(failure)).not.toContain('private.table');
    expect(String(failure)).not.toContain(JSON.stringify(input.sourceGeoJson));
    expect(pool.client.queries.map(({ text }) => text.trim())).toContain(
      'ROLLBACK',
    );
  });

  it('redacts connection failures before a database client exists', async () => {
    const projection = new PostgisSpatialProjection({
      connect: () =>
        Promise.reject(new Error('password=connection-secret host=private-db')),
    });

    const failure = await projection
      .put(input)
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(SpatialProjectionError);
    expect(String(failure)).not.toContain('connection-secret');
    expect(String(failure)).not.toContain('private-db');
  });
});
