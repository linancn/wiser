#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  defaultShowcaseStateDirectory,
  getShowcaseStatus,
  requestShowcaseStop,
  runShowcasePreflight,
  startShowcaseSupervisor,
} from './supervisor.mjs';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = resolve(scriptDirectory, '../../../../');

function pause(milliseconds) {
  return new Promise((resolvePause) => {
    globalThis.setTimeout(resolvePause, milliseconds);
  });
}

function option(argv, name) {
  const index = argv.indexOf(name);
  return index < 0 ? undefined : argv[index + 1];
}

function commandOptions(argv) {
  const profile = option(argv, '--profile') ?? 'scripted';
  const ttlMinutes = Number(option(argv, '--ttl-minutes') ?? '15');
  if (!Number.isFinite(ttlMinutes) || ttlMinutes <= 0 || ttlMinutes > 15) {
    throw new Error('--ttl-minutes must be greater than zero and at most 15.');
  }
  const configuredStateDirectory = option(argv, '--state-directory');
  const stateDirectory =
    configuredStateDirectory === undefined
      ? defaultShowcaseStateDirectory(repositoryRoot)
      : resolve(configuredStateDirectory);
  return {
    environment: process.env,
    profile,
    repositoryRoot,
    stateDirectory,
    ttlMs: Math.round(ttlMinutes * 60_000),
  };
}

async function main(argv) {
  const command = argv[0];
  const options = commandOptions(argv.slice(1));
  if (command === 'preflight') {
    const result = await runShowcasePreflight(options);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.exitCode = result.ok ? 0 : 1;
    return;
  }
  if (command === 'start') {
    const preflight = await runShowcasePreflight(options);
    if (!preflight.ok) {
      process.stdout.write(`${JSON.stringify(preflight)}\n`);
      process.exitCode = 1;
      return;
    }
    const tsx = resolve(repositoryRoot, 'node_modules/.bin/tsx');
    const dispatchedAt = Date.now();
    const child = spawn(tsx, [scriptPath, '_supervise', ...argv.slice(1)], {
      cwd: repositoryRoot,
      detached: true,
      env: process.env,
      shell: false,
      stdio: 'ignore',
    });
    child.unref();
    let result;
    for (let attempt = 0; attempt < 600; attempt += 1) {
      try {
        result = await getShowcaseStatus(options);
      } catch {
        await pause(100);
        continue;
      }
      const currentSession =
        'createdAt' in result &&
        Date.parse(result.createdAt) >= dispatchedAt - 1_000;
      if (
        currentSession &&
        (result.state === 'RUNNING' || result.state === 'COMPLETED')
      ) {
        break;
      }
      if (
        (currentSession && result.state === 'FAILED') ||
        (currentSession && result.state === 'STOPPED') ||
        (currentSession && result.state === 'EXPIRED')
      ) {
        break;
      }
      await pause(100);
    }
    if (result?.state !== 'RUNNING' && result?.state !== 'COMPLETED') {
      throw new Error(
        `Detached showcase did not become ready (state=${String(result?.state ?? 'unknown')}).`,
      );
    }
    process.stdout.write(
      `${JSON.stringify({
        state: result.state,
        runId: result.runId,
        webUrl: result.webUrl,
        reportPath: result.reportPath,
        expiresAt: result.expiresAt,
      })}\n`,
    );
    return;
  }
  if (command === '_supervise') {
    const result = await startShowcaseSupervisor(options);
    process.exitCode = result.report?.status === 'failed' ? 1 : 0;
    return;
  }
  if (command === 'status') {
    const result = await getShowcaseStatus(options);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.exitCode = result.state === 'absent' ? 1 : 0;
    return;
  }
  if (command === 'stop') {
    const result = await requestShowcaseStop(options);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  throw new Error(
    'Usage: showcase.mjs preflight|start|status|stop [--profile scripted|rework|workbuddy]',
  );
}

void main(process.argv.slice(2)).catch((error) => {
  process.stderr.write(
    `${JSON.stringify({
      state: 'FAILED',
      error: error instanceof Error ? error.message : String(error),
    })}\n`,
  );
  process.exitCode = 1;
});
