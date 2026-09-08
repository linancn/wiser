import { describe, expect, it } from 'vitest';
import {
  ExplorationQueryInputSchema,
  ExplorationResultSchema,
  QuerySpecSchema,
} from '../src/exploration/index.js';

const item = '10000000-0000-4000-8000-000000000001';
const version = '10000000-0000-4000-8000-000000000002';
const query = '10000000-0000-4000-8000-000000000003';

describe('unified exploration contracts', () => {
  it('retrieves one record by identity inside its fixed query version', () => {
    expect(
      ExplorationQueryInputSchema.safeParse({
        queryId: query,
        view: 'records',
        versionId: version,
        recordId: item,
      }).success,
    ).toBe(true);
    expect(
      ExplorationQueryInputSchema.safeParse({
        queryId: query,
        view: 'records',
        versionId: version,
        recordId: item,
        after: 'cursor',
      }).success,
    ).toBe(false);
    expect(
      ExplorationQueryInputSchema.safeParse({
        queryId: query,
        view: 'map',
        versionId: version,
        recordId: item,
      }).success,
    ).toBe(false);
  });
  it('accepts explicit provider, registration kind and analytical readiness filters', () => {
    expect(
      QuerySpecSchema.safeParse({
        providers: ['National water service'],
        kinds: ['DATASET_INTERFACE'],
        readiness: {
          records: ['METADATA_ONLY', 'EMPTY'],
          spatial: ['CRS_UNVERIFIED', 'NO_SPATIAL_DATA'],
        },
      }).success,
    ).toBe(true);
    expect(
      QuerySpecSchema.safeParse({ readiness: { spatial: ['INVENTED'] } })
        .success,
    ).toBe(false);
    expect(QuerySpecSchema.safeParse({ providers: [] }).success).toBe(false);
  });
  it('supports a bounded provenance graph with record focus pinned to a query and version', () => {
    expect(
      ExplorationQueryInputSchema.safeParse({
        queryId: query,
        view: 'graph',
        versionId: version,
        recordId: item,
      }).success,
    ).toBe(true);
    expect(
      ExplorationQueryInputSchema.safeParse({
        queryId: query,
        view: 'graph',
        recordId: item,
      }).success,
    ).toBe(false);
    expect(
      ExplorationQueryInputSchema.safeParse({
        queryId: query,
        view: 'resources',
        recordId: item,
      }).success,
    ).toBe(false);
    expect(
      ExplorationResultSchema.safeParse({
        queryId: query,
        spec: {},
        createdAt: '2026-09-08T10:00:00.000Z',
        expiresAt: '2026-09-08T10:30:00.000Z',
        view: 'graph',
        totalCount: 0,
        resources: [],
      }).success,
    ).toBe(false);
  });
  it('binds records and map views to an existing result set without accepting a foreign analysis identifier', () => {
    expect(
      ExplorationQueryInputSchema.safeParse({
        queryId: query,
        view: 'records',
        versionId: version,
      }).success,
    ).toBe(true);
    expect(
      ExplorationQueryInputSchema.safeParse({
        queryId: query,
        view: 'map',
        bbox: [-180, -90, 180, 90],
      }).success,
    ).toBe(true);
    for (const input of [
      { queryId: query, view: 'records' },
      { spec: {}, view: 'records', versionId: version },
      { queryId: query, view: 'map', bbox: [10, 20, -10, 30] },
      { queryId: query, view: 'map', analysisId: item },
      { queryId: query, view: 'resources', assetId: item },
    ])
      expect(ExplorationQueryInputSchema.safeParse(input).success).toBe(false);
  });
  it('accepts bounded declarative filters and immutable version references', () => {
    expect(
      QuerySpecSchema.parse({
        text: 'HydroATLAS',
        versions: [{ dataItemId: item, versionId: version }],
        qualityGrades: ['A'],
      }),
    ).toEqual({
      text: 'HydroATLAS',
      versions: [{ dataItemId: item, versionId: version }],
      qualityGrades: ['A'],
    });
    expect(QuerySpecSchema.parse({})).toEqual({});
  });

  it.each([
    { sql: 'select * from catalog.data_item' },
    { cypher: 'MATCH (n) RETURN n' },
    { tenantId: item },
    { actorId: item },
    { text: 'x'.repeat(513) },
    { versions: [{ dataItemId: item }] },
    { dataItemIds: [item, item] },
    {
      versions: [
        { dataItemId: item, versionId: version },
        { dataItemId: item, versionId: version },
      ],
    },
  ])('rejects unsafe, unbounded or ambiguous query criteria %#', (spec) => {
    expect(QuerySpecSchema.safeParse(spec).success).toBe(false);
  });

  it('requires either a new query or an existing result set, and binds continuation to the latter', () => {
    expect(
      ExplorationQueryInputSchema.safeParse({
        spec: {},
        view: 'resources',
        first: 20,
      }).success,
    ).toBe(true);
    expect(
      ExplorationQueryInputSchema.safeParse({
        queryId: query,
        view: 'resources',
        first: 20,
        after: 'opaque',
      }).success,
    ).toBe(true);
    for (const input of [
      { view: 'resources' },
      { queryId: query, spec: {}, view: 'resources' },
      { spec: {}, view: 'resources', after: 'opaque' },
      { spec: {}, view: 'resources', first: 10001 },
    ]) {
      expect(ExplorationQueryInputSchema.safeParse(input).success).toBe(false);
    }
  });

  it('keeps registration readiness distinct from analytical counts and unknown values', () => {
    const result = {
      queryId: query,
      spec: {},
      createdAt: '2026-09-08T10:00:00.000Z',
      expiresAt: '2026-09-08T10:30:00.000Z',
      view: 'resources',
      totalCount: 1,
      resources: [
        {
          dataItemId: item,
          versionId: version,
          name: 'HydroATLAS',
          provider: 'HydroSHEDS',
          kind: 'CATALOG_ENTRY',
          assetCount: 2,
          readiness: {
            records: 'NOT_PARSED',
            spatial: 'NOT_PARSED',
            graph: 'READY',
          },
          recordCount: null,
          featureCount: null,
          limitations: ['Source registration only.'],
        },
      ],
    };
    expect(ExplorationResultSchema.parse(result)).toEqual(result);
    expect(
      ExplorationResultSchema.safeParse({ ...result, totalCount: -1 }).success,
    ).toBe(false);
    expect(
      ExplorationResultSchema.safeParse({
        ...result,
        resources: [{ ...result.resources[0], featureCount: -1 }],
      }).success,
    ).toBe(false);
    expect(
      ExplorationResultSchema.safeParse({
        ...result,
        expiresAt: result.createdAt,
      }).success,
    ).toBe(false);
  });
});
