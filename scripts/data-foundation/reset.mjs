import {
  DATA_ALL_SERVICES,
  isDirectExecution,
  requireResetConfirmation,
  resolveDataVolumeNames,
  runCommand,
  runCompose,
} from './operations.mjs';

export async function resetDataFoundation() {
  requireResetConfirmation();
  if (!process.argv.includes('--volumes')) {
    throw new Error('data:reset requires the explicit --volumes flag.');
  }

  // Resolve and validate the exact targets before stopping or removing anything.
  const volumeNames = await resolveDataVolumeNames();
  await runCompose(['stop', ...DATA_ALL_SERVICES], { capture: false });
  await runCompose(
    ['rm', '--force', '--stop', '--volumes', ...DATA_ALL_SERVICES],
    { capture: false },
  );
  const existingOutput = await runCommand('docker', [
    'volume',
    'ls',
    '--format',
    '{{.Name}}',
  ]);
  const existing = new Set(
    existingOutput
      .split(/\r?\n/)
      .map((name) => name.trim())
      .filter((name) => name.length > 0),
  );
  const removableVolumes = volumeNames.filter((name) => existing.has(name));
  if (removableVolumes.length > 0) {
    await runCommand('docker', ['volume', 'rm', ...removableVolumes], {
      capture: false,
    });
  }
  process.stdout.write(
    `${JSON.stringify({ status: 'reset', removedVolumes: removableVolumes })}\n`,
  );
}

if (isDirectExecution(import.meta.url)) {
  await resetDataFoundation();
}
