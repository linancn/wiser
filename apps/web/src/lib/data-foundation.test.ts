import { describe, expect, it } from 'vitest';

import * as dataFoundation from './data-foundation';
import {
  DATA_FOUNDATION_ROUTES,
  ingestionStepState,
  isMapDisplayableFeature,
  parseDataCatalogPage,
  parseDataItemVersionPage,
  parseDataRouteUuid,
  parseGeoQuery,
  parseIngestion,
  parseStacFeatureCollection,
  parseSearchQuery,
} from './data-foundation';

const UUID = '11111111-1111-4111-8111-111111111111';
const VERSION_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_VERSION_ID = '33333333-3333-4333-8333-333333333333';
const MISSING_TILE_AVAILABILITY = Symbol('missing-tile-availability');

function dataItemVersion(
  tileAvailability: unknown = MISSING_TILE_AVAILABILITY,
) {
  return {
    tenantId: UUID,
    dataItemId: UUID,
    versionId: VERSION_ID,
    version: 1,
    assetIds: ['44444444-4444-4444-8444-444444444444'],
    sourceHash: 'a'.repeat(64),
    metadataHash: 'b'.repeat(64),
    processingStage: 'STANDARDIZED',
    generationMethod: 'OBSERVED',
    qualityGrade: 'A',
    acceptanceStatus: 'PASSED',
    publicationStatus: 'PUBLISHED',
    securityLevel: 'L1_INTERNAL',
    createdAt: '2026-08-21T08:00:00.000Z',
    committedAt: '2026-08-21T08:01:00.000Z',
    publishedAt: '2026-08-21T08:02:00.000Z',
    ...(tileAvailability === MISSING_TILE_AVAILABILITY
      ? {}
      : { tileAvailability }),
  };
}

type ParseMapVersionSelection = (
  dataItem: string | string[] | undefined,
  version: string | string[] | undefined,
) =>
  | { readonly dataItemId: string; readonly versionId: string }
  | null
  | undefined;

type ResolveMapTileUrls = (
  selection:
    { readonly dataItemId: string; readonly versionId: string } | undefined,
  authoritativeVersion: unknown,
) => {
  readonly vectorTileUrl?: string;
  readonly rasterTileUrl?: string;
};

describe('Data Foundation browser-safe contracts', () => {
  it('declares every required localized management route', () => {
    expect(DATA_FOUNDATION_ROUTES.map((route) => route.path)).toEqual([
      '',
      '/catalog',
      '/ingestions',
      '/quality',
      '/search',
      '/knowledge',
      '/graph',
      '/geo',
      '/map',
      '/capabilities',
    ]);
  });

  it('accepts only canonical UUID route parameters and bounded searches', () => {
    expect(parseDataRouteUuid(UUID)).toBe(UUID);
    expect(parseDataRouteUuid('../operations')).toBeNull();
    expect(parseDataRouteUuid(['duplicate', UUID])).toBeNull();
    expect(parseSearchQuery('  water level  ')).toBe('water level');
    expect(parseSearchQuery('x'.repeat(2_049))).toBeNull();
    expect(parseSearchQuery(['water', 'level'])).toBeNull();
  });

  it('projects an API catalog response into a minimal safe DTO', () => {
    const page = parseDataCatalogPage({
      items: [
        {
          tenantId: UUID,
          dataItemId: UUID,
          name: 'Station observations',
          businessDomains: ['hydrology'],
          sourceNatures: ['observed'],
          sourceChannels: ['sensor'],
          processingStage: 'STANDARDIZED',
          intendedUses: ['operations'],
          ownerProjectId: '22222222-2222-4222-8222-222222222222',
          sourceOrganization: 'WISER Lab',
          authorizationScope: 'data.catalog.read',
          citationRequirements: [],
          unitDefinitions: [],
          missingValueRules: [],
          anomalyRules: [],
          generationMethod: 'OBSERVED',
          qualityGrade: 'A',
          acceptanceStatus: 'PASSED',
          publicationStatus: 'PUBLISHED',
          securityLevel: 'L1_INTERNAL',
          version: 3,
          updateMode: 'APPEND',
          createdAt: '2026-08-21T08:00:00.000Z',
          updatedAt: '2026-08-22T08:00:00.000Z',
          privateInternalField: 'must-not-cross-the-DAL',
        },
      ],
    });

    expect(page).toEqual({
      items: [
        {
          dataItemId: UUID,
          name: 'Station observations',
          businessDomains: ['hydrology'],
          processingStage: 'STANDARDIZED',
          ownerProjectId: '22222222-2222-4222-8222-222222222222',
          sourceOrganization: 'WISER Lab',
          authorizationScope: 'data.catalog.read',
          generationMethod: 'OBSERVED',
          qualityGrade: 'A',
          acceptanceStatus: 'PASSED',
          publicationStatus: 'PUBLISHED',
          securityLevel: 'L1_INTERNAL',
          version: 3,
          updatedAt: '2026-08-22T08:00:00.000Z',
        },
      ],
    });
  });

  it('rejects malformed API catalog responses instead of inventing fields', () => {
    expect(() =>
      parseDataCatalogPage({
        items: [{ dataItemId: UUID, name: 'Missing authority fields' }],
      }),
    ).toThrow(/catalog response/i);
  });

  it('projects explicit version-level tile availability without leaking internal fields', () => {
    const page = parseDataItemVersionPage({
      items: [
        dataItemVersion({
          vector: true,
          raster: false,
          internalProjectionState: 'must-not-cross-the-DAL',
        }),
      ],
    });

    expect(page.items[0]).toMatchObject({
      dataItemId: UUID,
      versionId: VERSION_ID,
      tileAvailability: { vector: true, raster: false },
    });
    expect(page.items[0]).not.toHaveProperty(
      'tileAvailability.internalProjectionState',
    );
  });

  it('rejects versions whose tile availability is absent or malformed', () => {
    expect(() =>
      parseDataItemVersionPage({ items: [dataItemVersion()] }),
    ).toThrow(/data item version page response/i);
    expect(() =>
      parseDataItemVersionPage({
        items: [dataItemVersion({ vector: 'yes', raster: false })],
      }),
    ).toThrow(/data item version page response/i);
    expect(() =>
      parseDataItemVersionPage({
        items: [dataItemVersion({ vector: true })],
      }),
    ).toThrow(/data item version page response/i);
  });

  it('accepts a map version only as a complete canonical DataItem/version pair', () => {
    const parse = Reflect.get(dataFoundation, 'parseMapVersionSelection') as
      ParseMapVersionSelection | undefined;
    expect(parse).toBeTypeOf('function');
    if (parse === undefined) return;

    expect(parse(undefined, undefined)).toBeUndefined();
    expect(parse('', '')).toBeUndefined();
    expect(parse(UUID, VERSION_ID)).toEqual({
      dataItemId: UUID,
      versionId: VERSION_ID,
    });
    expect(parse(UUID, undefined)).toBeNull();
    expect(parse(undefined, VERSION_ID)).toBeNull();
    expect(parse('not-a-uuid', VERSION_ID)).toBeNull();
    expect(parse(UUID, ['duplicate', VERSION_ID])).toBeNull();
  });

  it('emits same-origin tile URLs only for the matching authoritative version and available layer', () => {
    const resolve = Reflect.get(dataFoundation, 'resolveMapTileUrls') as
      ResolveMapTileUrls | undefined;
    expect(resolve).toBeTypeOf('function');
    if (resolve === undefined) return;

    const selection = { dataItemId: UUID, versionId: VERSION_ID };
    const authoritativeVersion = parseDataItemVersionPage({
      items: [dataItemVersion({ vector: true, raster: false })],
    }).items[0];
    const vectorOnly = resolve(selection, authoritativeVersion);
    expect(vectorOnly.vectorTileUrl).toBe(
      `/api/data-foundation/geo/tiles/vector/versions/${VERSION_ID}/{z}/{x}/{y}.pbf`,
    );
    expect(vectorOnly.rasterTileUrl).toBeUndefined();

    const rasterOnly = resolve(
      selection,
      parseDataItemVersionPage({
        items: [dataItemVersion({ vector: false, raster: true })],
      }).items[0],
    );
    expect(rasterOnly.vectorTileUrl).toBeUndefined();
    expect(rasterOnly.rasterTileUrl).toBe(
      `/api/data-foundation/geo/tiles/raster/versions/${VERSION_ID}/WebMercatorQuad/{z}/{x}/{y}.png`,
    );

    for (const unavailable of [
      resolve(undefined, authoritativeVersion),
      resolve(selection, undefined),
      resolve(selection, {
        ...authoritativeVersion,
        versionId: OTHER_VERSION_ID,
      }),
      resolve(selection, {
        ...authoritativeVersion,
        dataItemId: '55555555-5555-4555-8555-555555555555',
      }),
    ]) {
      expect(unavailable.vectorTileUrl).toBeUndefined();
      expect(unavailable.rasterTileUrl).toBeUndefined();
    }
  });

  it('accepts only structurally valid, display-safe GeoJSON for MapLibre', () => {
    const result = parseGeoQuery({
      features: [
        {
          featureId: 'station-1',
          dataItemId: UUID,
          versionId: '22222222-2222-4222-8222-222222222222',
          geometry: {
            type: 'Point',
            coordinates: [116.4, 39.9],
            crs: 'EPSG:4326',
          },
          properties: { name: 'station' },
        },
      ],
    });
    const feature = result.features[0];
    expect(
      feature === undefined ? false : isMapDisplayableFeature(feature),
    ).toBe(true);

    expect(() =>
      parseGeoQuery({
        features: [
          {
            featureId: 'bad-point',
            dataItemId: UUID,
            versionId: '22222222-2222-4222-8222-222222222222',
            geometry: {
              type: 'Point',
              coordinates: [[[116.4, 39.9]]],
              crs: 'EPSG:4326',
            },
            properties: {},
          },
        ],
      }),
    ).toThrow(/geo response/i);
  });

  it('projects only bounded STAC extents and immutable version anchors', () => {
    expect(
      parseStacFeatureCollection({
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            id: `wiser-${'a'.repeat(48)}`,
            collection: `wiser-${'b'.repeat(32)}`,
            bbox: [116.1, 39.7, 116.7, 40.1],
            geometry: { type: 'Point', coordinates: [116.4, 39.9] },
            properties: {
              versionId: '22222222-2222-4222-8222-222222222222',
              dataItemId: UUID,
            },
          },
        ],
      }),
    ).toEqual({
      extents: [
        {
          itemId: `wiser-${'a'.repeat(48)}`,
          versionId: '22222222-2222-4222-8222-222222222222',
          dataItemId: UUID,
          bbox: [116.1, 39.7, 116.7, 40.1],
        },
      ],
    });
    expect(() =>
      parseStacFeatureCollection({
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            id: 'not-governed',
            bbox: [116.1, 39.7, Number.POSITIVE_INFINITY, 40.1],
            properties: { versionId: UUID, databasePassword: 'leak' },
          },
        ],
      }),
    ).toThrow(/stac/i);
  });

  it('does not invent a linear history across ingestion terminal branches', () => {
    expect(ingestionStepState('REJECTED', 'REJECTED')).toBe('current');
    expect(ingestionStepState('REJECTED', 'APPROVED')).toBe('future');
    expect(ingestionStepState('COMMITTED', 'REJECTED')).toBe('future');
    expect(ingestionStepState('COMMITTED', 'APPROVED')).toBe('complete');
    expect(ingestionStepState('FAILED', 'VALIDATED')).toBe('future');
    expect(ingestionStepState('CANCELLED', 'RECEIVED')).toBe('future');
  });

  it('projects real ingestion detail summaries and rejects malformed hashes', () => {
    const response = {
      ingestion: {
        ingestionId: UUID,
        tenantId: '22222222-2222-4222-8222-222222222222',
        projectId: '33333333-3333-4333-8333-333333333333',
        assetIds: ['44444444-4444-4444-8444-444444444444'],
        intendedUses: ['operations'],
        requestedSecurityLevel: 'L1_INTERNAL',
        state: 'PUBLISHED',
        operationId: '55555555-5555-4555-8555-555555555555',
        version: 4,
        createdAt: '2026-08-22T01:00:00.000Z',
        updatedAt: '2026-08-22T01:05:00.000Z',
      },
      qualityIssues: [],
      agentRuns: [
        {
          agentRunId: '66666666-6666-4666-8666-666666666666',
          agentKind: 'semantic-mapper',
          provider: 'deterministic-fake',
          model: 'wiser-fake-embedding-v1',
          deterministic: true,
          inputHash: 'a'.repeat(64),
          outputHash: 'b'.repeat(64),
          status: 'SUCCEEDED',
          createdAt: '2026-08-22T01:01:00.000Z',
          updatedAt: '2026-08-22T01:02:00.000Z',
          internalPrompt: 'must-not-cross-the-DAL',
        },
      ],
      projectionStatuses: [
        {
          dataItemId: '77777777-7777-4777-8777-777777777777',
          versionId: '88888888-8888-4888-8888-888888888888',
          projectionKind: 'opensearch',
          status: 'SUCCEEDED',
          attemptCount: 1,
          projectedAt: '2026-08-22T01:04:00.000Z',
          updatedAt: '2026-08-22T01:04:00.000Z',
        },
      ],
    };

    expect(parseIngestion(response)).toMatchObject({
      ingestionId: UUID,
      qualityIssues: [],
      agentRuns: [
        {
          agentRunId: '66666666-6666-4666-8666-666666666666',
          inputHash: 'a'.repeat(64),
        },
      ],
      projectionStatuses: [
        {
          dataItemId: '77777777-7777-4777-8777-777777777777',
          projectionKind: 'opensearch',
        },
      ],
    });
    expect(parseIngestion(response).agentRuns?.[0]).not.toHaveProperty(
      'internalPrompt',
    );
    expect(() =>
      parseIngestion({
        ...response,
        agentRuns: [{ ...response.agentRuns[0], inputHash: 'not-sha256' }],
      }),
    ).toThrow(/ingestion response/i);
  });
});
