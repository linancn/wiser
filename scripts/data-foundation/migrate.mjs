import {
  assertMigrationsApplied,
  assertPgStacMigrated,
  isDirectExecution,
  runCompose,
} from './operations.mjs';

export async function migrateDataFoundation() {
  await runCompose(['run', '--rm', 'data-migrate'], { capture: false });
  await runCompose(['run', '--rm', 'pgstac-migrate'], { capture: false });
  await runCompose(['run', '--rm', 'data-runtime-provision'], {
    capture: false,
  });
  const migrations = await assertMigrationsApplied();
  await assertPgStacMigrated();
  process.stdout.write(
    `${JSON.stringify({ status: 'migrated', migrations: migrations.map(({ filename }) => filename) })}\n`,
  );
}

if (isDirectExecution(import.meta.url)) {
  await migrateDataFoundation();
}
