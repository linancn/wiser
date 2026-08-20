#!/usr/bin/env node

import {
  resolveV2LocalLabServerConfig,
  startV2LocalLabServer,
} from './v2-local-lab-server.js';

async function main(): Promise<void> {
  const config = resolveV2LocalLabServerConfig(process.env);
  const server = await startV2LocalLabServer({
    config,
    environment: process.env,
  });
  process.stdout.write(
    `${JSON.stringify({
      status: 'ready',
      profile: server.lab.manifest.profile,
      apiBaseUrl: config.apiBaseUrl,
      runId: server.lab.manifest.runId,
      manifestPath: server.bundle.manifestPath,
    })}\n`,
  );

  let closing = false;
  const close = async (signal: string): Promise<void> => {
    if (closing) return;
    closing = true;
    process.stderr.write(`WISER local lab stopping after ${signal}.\n`);
    await server.close();
  };
  process.once('SIGINT', () => void close('SIGINT'));
  process.once('SIGTERM', () => void close('SIGTERM'));
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`WISER local lab failed: ${message}\n`);
  process.exitCode = 1;
});
