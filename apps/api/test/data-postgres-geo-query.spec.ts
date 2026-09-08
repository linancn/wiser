import { randomUUID } from 'node:crypto';

import { Pool, type PoolClient } from 'pg';
import { describe, expect, it } from 'vitest';

import {
  PostgisGeoQueryPort,
  PostgresStructuredDataQueryPort,
  type QueryAdapterPgClient,
  type QueryAdapterPgPool,
} from '../src/data-foundation/query-adapters.js';
import type { ScopedSpecialQueryRequest } from '../src/data-foundation/special-query-executors.js';

const realPostgresTest =
  process.env['WISER_DATA_PG_INTEGRATION'] === '1' ? it : it.skip;

interface FixtureScope {
  readonly tenantId: string;
  readonly projectId: string;
}

interface VersionFixture extends FixtureScope {
  readonly dataItemId: string;
  readonly versionId: string;
  readonly versionNumber: number;
  readonly securityLevel: 'L1_INTERNAL' | 'L3_CONFIDENTIAL';
  readonly policyVersion: number;
}

class SavepointQueryPool implements QueryAdapterPgPool {
  #leased = false;

  constructor(
    private readonly client: PoolClient,
    private readonly roleName: string,
  ) {
    if (!/^wiser_geo_test_[a-z0-9_]+$/.test(roleName)) {
      throw new Error('invalid PostgreSQL integration-test role');
    }
  }

  async connect(): Promise<QueryAdapterPgClient> {
    if (this.#leased) {
      throw new Error('the PostgreSQL integration-test client is busy');
    }
    await this.client.query(`set local role ${this.roleName}`);
    this.#leased = true;
    let savepointOpen = false;
    const client = this.client;

    return {
      async query(text, values = []) {
        const command = text.trim().toLowerCase();
        if (command === 'begin') {
          if (savepointOpen) {
            throw new Error('the query adapter opened a nested transaction');
          }
          await client.query('savepoint geo_query_adapter');
          savepointOpen = true;
          return { rows: [] };
        }
        if (command === 'commit') {
          if (!savepointOpen) {
            throw new Error(
              'the query adapter committed without a transaction',
            );
          }
          await client.query('release savepoint geo_query_adapter');
          savepointOpen = false;
          return { rows: [] };
        }
        if (command === 'rollback') {
          if (savepointOpen) {
            await client.query('rollback to savepoint geo_query_adapter');
            await client.query('release savepoint geo_query_adapter');
            savepointOpen = false;
          }
          return { rows: [] };
        }
        const result = await client.query<Record<string, unknown>>(text, [
          ...values,
        ]);
        return { rows: result.rows };
      },
      release: () => {
        this.#leased = false;
      },
    };
  }
}

async function insertDataItem(
  client: PoolClient,
  fixture: FixtureScope & {
    readonly dataItemId: string;
    readonly name: string;
    readonly version: number;
    readonly securityLevel: 'L1_INTERNAL' | 'L3_CONFIDENTIAL';
    readonly policyVersion: number;
  },
): Promise<void> {
  await client.query(
    `insert into catalog.data_item (
       data_item_id, tenant_id, project_id, owner_project_id, name,
       business_domains, source_natures, source_channels, processing_stage,
       intended_uses, source_organization, authorization_scope,
       citation_requirements, unit_definitions, missing_value_rules,
       anomaly_rules, generation_method, quality_grade, acceptance_status,
       publication_status, security_level, version, update_mode,
       policy_version, row_version
     ) values (
       $1::uuid, $2::uuid, $3::uuid, $3::uuid, $4,
       array['integration'], array['observed'], array['test-fixture'], 'RAW',
       array['integration'], 'WISER integration test', 'data.catalog.read',
       '{}', '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, 'OBSERVED', 'C',
       'PASSED', 'UNPUBLISHED', $5, $6::bigint, 'SNAPSHOT', $7::bigint, 1
     )`,
    [
      fixture.dataItemId,
      fixture.tenantId,
      fixture.projectId,
      fixture.name,
      fixture.securityLevel,
      fixture.version,
      fixture.policyVersion,
    ],
  );
}

async function insertVersion(
  client: PoolClient,
  fixture: VersionFixture,
): Promise<void> {
  await client.query(
    `insert into catalog.data_item_version (
       version_id, tenant_id, project_id, data_item_id, version_number,
       asset_manifest, source_hash, metadata_hash, processing_stage,
       generation_method, quality_grade, acceptance_status,
       publication_status, security_level, policy_version, row_version,
       committed_at
     ) values (
       $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::bigint,
       '{}'::jsonb, decode(repeat('a', 64), 'hex'),
       decode(repeat('b', 64), 'hex'), 'RAW', 'OBSERVED', 'C', 'PASSED',
       'UNPUBLISHED', $6, $7::bigint, 1, '2026-08-23T00:00:00.000Z'
     )`,
    [
      fixture.versionId,
      fixture.tenantId,
      fixture.projectId,
      fixture.dataItemId,
      fixture.versionNumber,
      fixture.securityLevel,
      fixture.policyVersion,
    ],
  );
}

async function insertExtent(
  client: PoolClient,
  fixture: VersionFixture & {
    readonly spatialExtentId: string;
    readonly longitude: number;
    readonly latitude: number;
  },
): Promise<void> {
  await client.query(
    `insert into catalog.spatial_extent (
       spatial_extent_id, tenant_id, project_id, data_item_id, version_id,
       source_geometry, source_crs, canonical_geometry, canonical_crs,
       security_level, policy_version, row_version
     ) values (
       $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid,
       ST_SetSRID(ST_MakePoint($6::double precision, $7::double precision), 4490),
       'EPSG:4490',
       ST_SetSRID(ST_MakePoint($6::double precision, $7::double precision), 4490),
       'EPSG:4490', $8, $9::bigint, 1
     )`,
    [
      fixture.spatialExtentId,
      fixture.tenantId,
      fixture.projectId,
      fixture.dataItemId,
      fixture.versionId,
      fixture.longitude,
      fixture.latitude,
      fixture.securityLevel,
      fixture.policyVersion,
    ],
  );
}

function request(
  scope: FixtureScope,
  input: Record<string, unknown>,
): ScopedSpecialQueryRequest {
  return {
    scope: {
      ...scope,
      maxSecurityLevel: 'L1_INTERNAL',
      maximumPolicyVersion: 1,
    },
    input: {
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [115, 38],
            [118, 38],
            [118, 41],
            [115, 41],
            [115, 38],
          ],
        ],
        crs: 'EPSG:4490',
      },
      predicates: ['INTERSECTS'],
      first: 20,
      ...input,
    },
    signal: new AbortController().signal,
  };
}

function intersectRequest(
  scope: FixtureScope,
  input: Record<string, unknown>,
): ScopedSpecialQueryRequest {
  return {
    scope: {
      ...scope,
      maxSecurityLevel: 'L1_INTERNAL',
      maximumPolicyVersion: 1,
    },
    input: { first: 20, ...input },
    signal: new AbortController().signal,
  };
}

function featureIds(output: unknown): readonly string[] {
  const features = (output as { readonly features: readonly unknown[] })
    .features;
  return features
    .map((feature) => (feature as { readonly featureId: string }).featureId)
    .toSorted();
}

describe('Data authority query PostgreSQL integration', () => {
  realPostgresTest(
    'selects the latest immutable version before extents and fails closed across authority boundaries',
    async () => {
      const connectionString = process.env['DATA_TEST_DATABASE_URL'];
      if (connectionString === undefined) {
        throw new Error(
          'DATA_TEST_DATABASE_URL is required when WISER_DATA_PG_INTEGRATION=1.',
        );
      }

      const admin = new Pool({
        connectionString,
        max: 2,
        connectionTimeoutMillis: 5_000,
        query_timeout: 30_000,
        statement_timeout: 30_000,
      });
      const suffix = `${process.pid}_${Date.now().toString(36)}`;
      const roleName = `wiser_geo_test_${suffix}`;
      const visibleScope = { tenantId: randomUUID(), projectId: randomUUID() };
      const crossTenantScope = {
        tenantId: randomUUID(),
        projectId: randomUUID(),
      };
      const primaryDataItemId = randomUUID();
      const primaryVersionOneId = randomUUID();
      const primaryVersionTwoId = randomUUID();
      const primaryExtentIds = [randomUUID(), randomUUID()] as const;
      const secondaryDataItemId = randomUUID();
      const secondaryVersionId = randomUUID();
      const secondaryExtentId = randomUUID();
      const candidateDataItemId = randomUUID();
      const candidateVersionId = randomUUID();
      const candidateExtentIds = [randomUUID(), randomUUID()] as const;
      const crossTenantDataItemId = randomUUID();
      const crossTenantVersionId = randomUUID();
      const highSecurityDataItemId = randomUUID();
      const highSecurityVersionId = randomUUID();
      const futurePolicyDataItemId = randomUUID();
      const futurePolicyVersionId = randomUUID();
      const absentVersionId = randomUUID();
      let fixtureClient: PoolClient | null = null;

      try {
        await admin.query(
          `create role ${roleName} nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls`,
        );
        await admin.query(
          `grant usage on schema catalog, knowledge, security to ${roleName}`,
        );
        await admin.query(
          `grant select on catalog.data_item, catalog.data_item_version, catalog.spatial_extent, knowledge.evidence_fragment to ${roleName}`,
        );
        await admin.query(
          `grant execute on all functions in schema security to ${roleName}`,
        );
        const role = await admin.query<{
          readonly rolbypassrls: boolean;
          readonly rolsuper: boolean;
        }>(`select rolbypassrls, rolsuper from pg_roles where rolname = $1`, [
          roleName,
        ]);
        expect(role.rows).toEqual([{ rolbypassrls: false, rolsuper: false }]);

        fixtureClient = await admin.connect();
        await fixtureClient.query('begin');

        const primaryVersionOne: VersionFixture = {
          ...visibleScope,
          dataItemId: primaryDataItemId,
          versionId: primaryVersionOneId,
          versionNumber: 1,
          securityLevel: 'L1_INTERNAL',
          policyVersion: 1,
        };
        const primaryVersionTwo: VersionFixture = {
          ...primaryVersionOne,
          versionId: primaryVersionTwoId,
          versionNumber: 2,
        };
        const secondaryVersion: VersionFixture = {
          ...visibleScope,
          dataItemId: secondaryDataItemId,
          versionId: secondaryVersionId,
          versionNumber: 1,
          securityLevel: 'L1_INTERNAL',
          policyVersion: 1,
        };
        const candidateVersion: VersionFixture = {
          ...visibleScope,
          dataItemId: candidateDataItemId,
          versionId: candidateVersionId,
          versionNumber: 1,
          securityLevel: 'L1_INTERNAL',
          policyVersion: 1,
        };
        const crossTenantVersion: VersionFixture = {
          ...crossTenantScope,
          dataItemId: crossTenantDataItemId,
          versionId: crossTenantVersionId,
          versionNumber: 1,
          securityLevel: 'L1_INTERNAL',
          policyVersion: 1,
        };
        const highSecurityVersion: VersionFixture = {
          ...visibleScope,
          dataItemId: highSecurityDataItemId,
          versionId: highSecurityVersionId,
          versionNumber: 1,
          securityLevel: 'L3_CONFIDENTIAL',
          policyVersion: 1,
        };
        const futurePolicyVersion: VersionFixture = {
          ...visibleScope,
          dataItemId: futurePolicyDataItemId,
          versionId: futurePolicyVersionId,
          versionNumber: 1,
          securityLevel: 'L1_INTERNAL',
          policyVersion: 2,
        };

        await insertDataItem(fixtureClient, {
          ...visibleScope,
          dataItemId: primaryDataItemId,
          name: 'Geo integration primary',
          version: 2,
          securityLevel: 'L1_INTERNAL',
          policyVersion: 1,
        });
        await insertDataItem(fixtureClient, {
          ...visibleScope,
          dataItemId: secondaryDataItemId,
          name: 'Geo integration secondary',
          version: 1,
          securityLevel: 'L1_INTERNAL',
          policyVersion: 1,
        });
        await insertDataItem(fixtureClient, {
          ...visibleScope,
          dataItemId: candidateDataItemId,
          name: 'Geo integration intersection candidate',
          version: 1,
          securityLevel: 'L1_INTERNAL',
          policyVersion: 1,
        });
        await insertDataItem(fixtureClient, {
          ...crossTenantScope,
          dataItemId: crossTenantDataItemId,
          name: 'Geo integration cross tenant',
          version: 1,
          securityLevel: 'L1_INTERNAL',
          policyVersion: 1,
        });
        await insertDataItem(fixtureClient, {
          ...visibleScope,
          dataItemId: highSecurityDataItemId,
          name: 'Geo integration high security',
          version: 1,
          securityLevel: 'L3_CONFIDENTIAL',
          policyVersion: 1,
        });
        await insertDataItem(fixtureClient, {
          ...visibleScope,
          dataItemId: futurePolicyDataItemId,
          name: 'Geo integration future policy',
          version: 1,
          securityLevel: 'L1_INTERNAL',
          policyVersion: 2,
        });

        for (const version of [
          primaryVersionOne,
          primaryVersionTwo,
          secondaryVersion,
          candidateVersion,
          crossTenantVersion,
          highSecurityVersion,
          futurePolicyVersion,
        ]) {
          await insertVersion(fixtureClient, version);
        }
        await insertExtent(fixtureClient, {
          ...primaryVersionOne,
          spatialExtentId: primaryExtentIds[0],
          longitude: 116.1,
          latitude: 39.8,
        });
        await insertExtent(fixtureClient, {
          ...primaryVersionOne,
          spatialExtentId: primaryExtentIds[1],
          longitude: 116.3,
          latitude: 39.9,
        });
        await insertExtent(fixtureClient, {
          ...secondaryVersion,
          spatialExtentId: secondaryExtentId,
          longitude: 116.5,
          latitude: 39.7,
        });
        await insertExtent(fixtureClient, {
          ...candidateVersion,
          spatialExtentId: candidateExtentIds[0],
          longitude: 116.1,
          latitude: 39.8,
        });
        await insertExtent(fixtureClient, {
          ...candidateVersion,
          spatialExtentId: candidateExtentIds[1],
          longitude: 116.3,
          latitude: 39.9,
        });
        await insertExtent(fixtureClient, {
          ...crossTenantVersion,
          spatialExtentId: randomUUID(),
          longitude: 116.6,
          latitude: 39.7,
        });
        await insertExtent(fixtureClient, {
          ...highSecurityVersion,
          spatialExtentId: randomUUID(),
          longitude: 116.7,
          latitude: 39.7,
        });
        await insertExtent(fixtureClient, {
          ...futurePolicyVersion,
          spatialExtentId: randomUUID(),
          longitude: 116.8,
          latitude: 39.7,
        });

        for (const [station, flow, tags, securityLevel, policyVersion] of [
          ['A', 16.7, ['water', 'daily'], 'L1_INTERNAL', 1],
          ['B', 5, ['water'], 'L1_INTERNAL', 1],
          ['hidden-security', 100, ['daily'], 'L3_CONFIDENTIAL', 1],
          ['hidden-policy', 100, ['daily'], 'L1_INTERNAL', 2],
        ] as const) {
          await fixtureClient.query(
            `insert into knowledge.evidence_fragment (
              tenant_id, project_id, data_item_id, version_id,
              locator, content_hash, security_level, policy_version
            ) values ($1, $2, $3, $4, $5::jsonb, decode(repeat('a', 64), 'hex'), $6, $7)`,
            [
              visibleScope.tenantId,
              visibleScope.projectId,
              primaryDataItemId,
              primaryVersionOneId,
              JSON.stringify({ record: { station, flow, tags } }),
              securityLevel,
              policyVersion,
            ],
          );
        }
        const structured = new PostgresStructuredDataQueryPort({
          pool: new SavepointQueryPool(fixtureClient, roleName),
        });
        const structuredInput = {
          dataItemId: primaryDataItemId,
          versionId: primaryVersionOneId,
          fields: ['station', 'flow'],
        };
        // Registration-only versions have no analytical records. Even an
        // empty filter must execute valid PostgreSQL and return an empty page.
        await expect(
          structured.query(
            intersectRequest(visibleScope, {
              ...structuredInput,
              versionId: primaryVersionTwoId,
            }),
          ),
        ).resolves.toMatchObject({ versionId: primaryVersionTwoId, rows: [] });
        for (const [field, operator, value, stations] of [
          ['station', 'EQ', 'A', ['A']],
          ['station', 'NE', 'A', ['B']],
          ['station', 'IN', ['A', 'C'], ['A']],
          ['tags', 'CONTAINS', ['daily'], ['A']],
          ['flow', 'GT', 10, ['A']],
          ['flow', 'GTE', 16.7, ['A']],
          ['flow', 'LT', 6, ['B']],
          ['flow', 'LTE', 5, ['B']],
        ] as const) {
          const output = (await structured.query(
            intersectRequest(visibleScope, {
              ...structuredInput,
              filters: [{ field, operator, value }],
            }),
          )) as { rows: { station: string }[] };
          expect(output.rows.map(({ station }) => station).toSorted()).toEqual(
            stations,
          );
        }
        const unfiltered = (await structured.query(
          intersectRequest(visibleScope, structuredInput),
        )) as { rows: { station: string }[] };
        expect(
          unfiltered.rows.map(({ station }) => station).toSorted(),
        ).toEqual(['A', 'B']);

        const port = new PostgisGeoQueryPort({
          pool: new SavepointQueryPool(fixtureClient, roleName),
          maximumFeatures: 20,
        });

        const latest = await port.query(
          request(visibleScope, { dataItemIds: [primaryDataItemId] }),
        );
        expect(latest).toEqual({ features: [] });

        const exactVersion = await port.query(
          request(visibleScope, { versionId: primaryVersionOneId }),
        );
        expect(featureIds(exactVersion)).toEqual(
          [...primaryExtentIds].toSorted(),
        );

        const firstExactPage = (await port.query(
          request(visibleScope, {
            versionId: primaryVersionOneId,
            first: 1,
          }),
        )) as {
          readonly features: readonly { readonly featureId: string }[];
          readonly nextCursor?: string;
        };
        expect(firstExactPage.features).toHaveLength(1);
        expect(firstExactPage.nextCursor).toEqual(expect.any(String));
        const secondExactPage = (await port.query(
          request(visibleScope, {
            versionId: primaryVersionOneId,
            first: 1,
            after: firstExactPage.nextCursor,
          }),
        )) as {
          readonly features: readonly { readonly featureId: string }[];
          readonly nextCursor?: string;
        };
        expect(secondExactPage.features).toHaveLength(1);
        expect(secondExactPage).not.toHaveProperty('nextCursor');
        expect(
          [...firstExactPage.features, ...secondExactPage.features]
            .map(({ featureId }) => featureId)
            .toSorted(),
        ).toEqual([...primaryExtentIds].toSorted());

        const matchingIntersection = await port.query(
          request(visibleScope, {
            dataItemIds: [primaryDataItemId],
            versionId: primaryVersionOneId,
          }),
        );
        expect(featureIds(matchingIntersection)).toEqual(
          [...primaryExtentIds].toSorted(),
        );
        const disjointIntersection = await port.query(
          request(visibleScope, {
            dataItemIds: [secondaryDataItemId],
            versionId: primaryVersionOneId,
          }),
        );
        expect(disjointIntersection).toEqual({ features: [] });
        const secondaryLatest = await port.query(
          request(visibleScope, { dataItemIds: [secondaryDataItemId] }),
        );
        expect(featureIds(secondaryLatest)).toEqual([secondaryExtentId]);

        const coveringGeometry = {
          type: 'Polygon',
          coordinates: [
            [
              [115, 38],
              [118, 38],
              [118, 41],
              [115, 41],
              [115, 38],
            ],
          ],
          crs: 'EPSG:4490',
        } as const;
        const latestTargetWithoutExtent = await port.intersect(
          intersectRequest(visibleScope, {
            left: { dataItemId: primaryDataItemId },
            right: { geometry: coveringGeometry },
          }),
        );
        expect(latestTargetWithoutExtent).toEqual({ features: [] });

        const collectedSiblingTarget = await port.intersect(
          intersectRequest(visibleScope, {
            left: {
              dataItemId: primaryDataItemId,
              versionId: primaryVersionOneId,
            },
            right: { geometry: coveringGeometry },
          }),
        );
        expect(featureIds(collectedSiblingTarget)).toEqual(
          [...candidateExtentIds].toSorted(),
        );

        const absent = await port.query(
          request(visibleScope, { versionId: absentVersionId }),
        );
        expect(absent).toEqual({ features: [] });
        for (const hiddenVersionId of [
          crossTenantVersionId,
          highSecurityVersionId,
          futurePolicyVersionId,
        ]) {
          await expect(
            port.query(request(visibleScope, { versionId: hiddenVersionId })),
          ).resolves.toEqual(absent);
        }
      } finally {
        if (fixtureClient !== null) {
          await fixtureClient.query('rollback').catch(() => undefined);
          fixtureClient.release();
        }
        await admin.query(`drop owned by ${roleName}`).catch(() => undefined);
        await admin
          .query(`drop role if exists ${roleName}`)
          .catch(() => undefined);
        await admin.end();
      }
    },
    60_000,
  );
});
