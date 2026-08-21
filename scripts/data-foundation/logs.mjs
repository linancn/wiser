import {
  DATA_ALL_SERVICES,
  isDirectExecution,
  runCompose,
} from './operations.mjs';

export async function followDataFoundationLogs() {
  await runCompose(
    ['logs', '--follow', '--tail', '200', ...DATA_ALL_SERVICES],
    { capture: false },
  );
}

if (isDirectExecution(import.meta.url)) {
  await followDataFoundationLogs();
}
