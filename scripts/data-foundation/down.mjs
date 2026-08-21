import {
  DATA_ALL_SERVICES,
  isDirectExecution,
  runCompose,
} from './operations.mjs';

export async function stopDataFoundation() {
  await runCompose(['stop', ...DATA_ALL_SERVICES], { capture: false });
  await runCompose(['rm', '--force', '--stop', ...DATA_ALL_SERVICES], {
    capture: false,
  });
}

if (isDirectExecution(import.meta.url)) {
  await stopDataFoundation();
}
