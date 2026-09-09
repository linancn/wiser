import { isDirectExecution, runCommand } from './operations.mjs';

export async function prepareCiData({
  environment = process.env,
  command = runCommand,
} = {}) {
  if (
    environment.GITHUB_ACTIONS !== 'true' ||
    environment.RUNNER_ENVIRONMENT !== 'github-hosted'
  ) {
    throw new Error(
      'CI preparation requires a disposable GitHub-hosted runner.',
    );
  }
  const options = { environment, capture: false };
  const compose = ['compose', '--profile', 'data-foundation'];
  await command('docker', [...compose, 'config', '--quiet'], options);

  // Images are built and loaded by the preceding CI steps. Remote images can
  // be pulled while Auth initializes; runtime startup still waits for both.
  const results = await Promise.allSettled([
    (async () => {
      await command('pnpm', ['supabase:start'], options);
      await command('pnpm', ['supabase:reset'], options);
    })(),
    command(
      'docker',
      [...compose, 'pull', '--policy', 'missing', '--ignore-buildable'],
      options,
    ),
  ]);
  const errors = results
    .filter((result) => result.status === 'rejected')
    .map((result) => result.reason);
  if (errors.length)
    throw new AggregateError(errors, 'CI environment preparation failed.');
}

if (isDirectExecution(import.meta.url)) await prepareCiData();
