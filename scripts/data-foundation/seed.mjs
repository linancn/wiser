import {
  assertMigrationsApplied,
  assertPgStacMigrated,
  assertSeedFixture,
  buildSeedSql,
  isDirectExecution,
  runPostgresSql,
  verifyFixtureBundle,
} from './operations.mjs';

export async function seedDataFoundation() {
  await Promise.all([assertMigrationsApplied(), assertPgStacMigrated()]);
  const fixture = await verifyFixtureBundle();
  await runPostgresSql(buildSeedSql(fixture));
  const projection = await assertSeedFixture(fixture);
  process.stdout.write(
    `${JSON.stringify({ status: 'seeded', fixture, projection })}\n`,
  );
}

if (isDirectExecution(import.meta.url)) {
  await seedDataFoundation();
}
