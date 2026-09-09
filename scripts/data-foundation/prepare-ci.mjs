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
  const configuration = JSON.parse(
    await command('docker', [...compose, 'config', '--format', 'json'], {
      ...options,
      capture: true,
    }),
  );
  const services = Object.entries(configuration.services);
  const builds = services.filter(([, service]) => service.build);
  const builtImages = new Set(builds.map(([, service]) => service.image));
  const remoteServices = services
    .filter(([, service]) => !service.build && !builtImages.has(service.image))
    .map(([name]) => name);
  if (!builds.length || !remoteServices.length) {
    throw new Error(
      'CI Data preparation requires buildable and remote services.',
    );
  }

  // Resolve the merged configuration without logging its runtime credentials.
  // Skip local image aliases during pulls: their build runs concurrently.
  // Runtime startup waits for all preparation, including every failed branch.
  const results = await Promise.allSettled([
    (async () => {
      await command('pnpm', ['supabase:start'], options);
      await command('pnpm', ['supabase:reset'], options);
    })(),
    command(
      'docker',
      [...compose, 'build', ...builds.map(([name]) => name)],
      options,
    ),
    command(
      'docker',
      [...compose, 'pull', '--policy', 'missing', ...remoteServices],
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
