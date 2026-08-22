import { isDirectExecution, runCommand } from './operations.mjs';
import { startDataFoundation } from './up.mjs';

export async function startFullWiserStack() {
  await runCommand('pnpm', ['supabase:start'], { capture: false });
  await startDataFoundation();
  await runCommand('node', ['scripts/data-foundation/migrate.mjs'], {
    capture: false,
  });
  await runCommand('node', ['scripts/data-foundation/seed.mjs'], {
    capture: false,
  });
  await runCommand('node', ['scripts/data-foundation/smoke.mjs'], {
    capture: false,
  });
}

if (isDirectExecution(import.meta.url)) {
  await startFullWiserStack();
}
