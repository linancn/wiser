import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  DATA_SERVICES,
  REQUIRED_CAPABILITY_IDS,
  assertComposeServicesHealthy,
  assertDataHealth,
  buildSeedSql,
  parseComposePsOutput,
  requireResetConfirmation,
  validateCapabilities,
  verifyFixtureBundle,
} from './operations.mjs';

test('parses Docker Compose JSON arrays and line-delimited records', () => {
  const services = [
    { Service: 'data-postgres', State: 'running', Health: 'healthy' },
    { Service: 'seaweedfs', State: 'running', Health: 'healthy' },
  ];

  assert.deepEqual(parseComposePsOutput(JSON.stringify(services)), services);
  assert.deepEqual(
    parseComposePsOutput(
      services.map((entry) => JSON.stringify(entry)).join('\n'),
    ),
    services,
  );
});

test('requires every long-running Data Foundation service to be healthy', () => {
  const healthy = DATA_SERVICES.map((Service) => ({
    Service,
    State: 'running',
    Health: 'healthy',
  }));
  assert.doesNotThrow(() => assertComposeServicesHealthy(healthy));
  assert.throws(
    () =>
      assertComposeServicesHealthy(
        healthy.map((service) =>
          service.Service === 'opensearch'
            ? { ...service, Health: 'unhealthy' }
            : service,
        ),
      ),
    /opensearch/,
  );
});

test('validates truthful API health and the complete Capability registry', () => {
  assert.doesNotThrow(() =>
    assertDataHealth({
      status: 'ready',
      system: 'data-foundation',
      authority: { database: true, objectStore: true },
      worker: true,
      projections: 'rebuildable',
    }),
  );
  assert.throws(
    () =>
      assertDataHealth({
        status: 'degraded',
        system: 'data-foundation',
        authority: { database: true, objectStore: false },
        worker: true,
      }),
    /not ready/,
  );

  assert.doesNotThrow(() =>
    validateCapabilities({
      registryVersion: '1.0.0',
      capabilities: REQUIRED_CAPABILITY_IDS.map((id) => ({ id })),
    }),
  );
  assert.throws(
    () =>
      validateCapabilities({
        registryVersion: '1.0.0',
        capabilities: [{ id: 'data.catalog.search' }],
      }),
    /missing required capability/,
  );
});

test('verifies immutable fixtures and builds an idempotent, drift-detecting seed', async () => {
  const fixture = await verifyFixtureBundle();
  assert.deepEqual(fixture, {
    geojsonSha256:
      '35361986ce6b364c99dbcefc56ac266c07dac5dbdff2a95dfe392c3eac9bc975',
    evidenceSha256:
      '123afced4bc8e32ced1065c9d3d28d3118387f0a36b84e146cbbbbee861db930',
    stationCount: 2,
  });
  const sql = buildSeedSql(fixture);
  assert.match(sql, /insert into catalog\.data_item/i);
  assert.match(sql, /on conflict \(data_item_id\) do nothing/i);
  assert.match(
    sql,
    /raise exception 'deterministic Data Foundation seed conflicts/i,
  );
  assert.match(sql, new RegExp(fixture.geojsonSha256));
  assert.match(sql, new RegExp(fixture.evidenceSha256));
});

test('requires an exact destructive reset confirmation', () => {
  assert.throws(() => requireResetConfirmation({}), /WISER_DATA_RESET_CONFIRM/);
  assert.doesNotThrow(() =>
    requireResetConfirmation({
      WISER_DATA_RESET_CONFIRM: 'reset-wiser-data-foundation',
    }),
  );
});
