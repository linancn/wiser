import {
  apiContractCheck,
  assertMigrationsApplied,
  assertPgStacMigrated,
  assertSeedFixture,
  composeHealthCheck,
  isDirectExecution,
  verifyFixtureBundle,
} from './operations.mjs';

export async function smokeDataFoundation() {
  const fixture = await verifyFixtureBundle();
  const [migrations, , services, api, seed] = await Promise.all([
    assertMigrationsApplied(),
    assertPgStacMigrated(),
    composeHealthCheck(),
    apiContractCheck(),
    assertSeedFixture(fixture),
  ]);
  process.stdout.write(
    `${JSON.stringify({
      status: 'ok',
      migrationCount: migrations.length,
      healthyServiceCount: services.length,
      capabilityCount: api.capabilityCount,
      fixture,
      seed,
    })}\n`,
  );
}

if (isDirectExecution(import.meta.url)) {
  await smokeDataFoundation();
}
