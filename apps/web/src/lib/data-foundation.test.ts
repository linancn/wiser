import { describe, expect, it } from 'vitest';

import {
  DATA_FOUNDATION_ROUTES,
  ingestionStepState,
  isMapDisplayableFeature,
  parseDataCatalogPage,
  parseDataRouteUuid,
  parseGeoQuery,
  parseIngestion,
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
