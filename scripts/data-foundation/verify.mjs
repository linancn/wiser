import {
  isDirectExecution,
  runCommand,
  runCompose,
  verifyFixtureBundle,
} from './operations.mjs';

const DATA_WORKSPACES = [
  '@wiser/data-contracts',
  '@wiser/data-core',
  '@wiser/data-infra',
  '@wiser/data-worker',
];

function filteredArgs(command) {
  return [
    ...DATA_WORKSPACES.flatMap((workspace) => ['--filter', workspace]),
    command,
  ];
}

export async function verifyDataFoundation() {
  const fixture = await verifyFixtureBundle();
  await runCommand(
    'node',
    [
      '--test',
      'scripts/data-foundation/operations.test.mjs',
      'scripts/data-foundation/runtime-role.test.mjs',
      'scripts/data-foundation/supabase-runtime.test.mjs',
      'scripts/data-foundation/vertical-smoke.test.mjs',
    ],
    { capture: false },
  );
  await runCommand('pnpm', filteredArgs('test'), { capture: false });
  await runCommand('pnpm', filteredArgs('typecheck'), { capture: false });
  await runCommand('pnpm', filteredArgs('build'), { capture: false });
  await runCompose(['config', '--quiet'], { capture: false });
  process.stdout.write(`${JSON.stringify({ status: 'verified', fixture })}\n`);
}

if (isDirectExecution(import.meta.url)) {
  await verifyDataFoundation();
}
