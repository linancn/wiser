import {
  DATA_ALL_SERVICES,
  apiContractCheck,
  assertMigrationsApplied,
  assertPgStacMigrated,
  assertRuntimeRoles,
  assertSeedFixture,
  composeHealthCheck,
  isDirectExecution,
  runCompose,
  verifyFixtureBundle,
} from './operations.mjs';
import {
  VerticalSmokeError,
  runDataFoundationVerticalSmoke,
} from './vertical-smoke.mjs';

const FAILURE_LOG_SERVICES = Object.freeze([
  ...new Set([...DATA_ALL_SERVICES, 'api', 'web']),
]);

export async function printDataFoundationSmokeFailureLogs() {
  try {
    await runCompose(
      ['logs', '--no-color', '--tail', '200', ...FAILURE_LOG_SERVICES],
      { capture: false },
    );
  } catch {
    process.stderr.write(
      'Data Foundation smoke logs could not be collected safely.\n',
    );
  }
}

export async function smokeDataFoundation(options = {}) {
  try {
    const fixture = await verifyFixtureBundle();
    const [migrations, , roles, services, api, seed] = await Promise.all([
      assertMigrationsApplied(),
      assertPgStacMigrated(),
      assertRuntimeRoles(),
      composeHealthCheck(),
      apiContractCheck(),
      assertSeedFixture(fixture),
    ]);
    const vertical = await runDataFoundationVerticalSmoke(
      options.vertical ?? {},
    );
    const report = {
      status: 'ok',
      migrationCount: migrations.length,
      healthyServiceCount: services.length,
      capabilityCount: api.capabilityCount,
      roles,
      fixture,
      seed,
      vertical,
    };
    process.stdout.write(`${JSON.stringify(report)}\n`);
    return report;
  } catch (error) {
    const printFailureLogs =
      options.printFailureLogs ?? printDataFoundationSmokeFailureLogs;
    await printFailureLogs();
    if (error instanceof VerticalSmokeError) throw error;
    const sanitized = new Error('Data Foundation smoke failed safely.', {
      cause: error instanceof Error ? error.name : 'unknown',
    });
    throw sanitized;
  }
}

if (isDirectExecution(import.meta.url)) {
  await smokeDataFoundation();
}
