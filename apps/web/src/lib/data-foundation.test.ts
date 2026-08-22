import { describe, expect, it } from 'vitest';

import {
  DATA_FOUNDATION_ROUTES,
  isMapDisplayableFeature,
  parseDataCatalogPage,
  parseDataRouteUuid,
  parseGeoQuery,
  parseSearchQuery,
} from './data-foundation';

const UUID = '11111111-1111-4111-8111-111111111111';

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
});
