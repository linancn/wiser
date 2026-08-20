#!/usr/bin/env node

import { createServer } from 'node:net';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { startV2LocalLabServer } from '../../../apps/api/src/index.ts';

import { launchWorkBuddyRoles } from './launch-four-agents.mjs';
import { renderWorkBuddyRuntime } from './render-workbuddy-config.mjs';

const scriptPath = fileURLToPath(import.meta.url);
const cookbookRoot = resolve(dirname(scriptPath), '..');
const defaultWorkBuddyCli =
  '/Applications/WorkBuddy.app/Contents/Resources/app.asar.unpacked/cli/bin/codebuddy';

function requireAbsolute(name, value) {
  if (typeof value !== 'string' || !isAbsolute(value)) {
    throw new Error(`${name} must be an absolute path.`);
  }
  return value;
}

async function freeLoopbackPort() {
  const server = createServer();
  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Could not reserve a loopback port.');
  }
  await new Promise((resolveClose, reject) => {
    server.close((error) => (error ? reject(error) : resolveClose()));
  });
  return address.port;
}

function parseEnv(source) {
  const result = {};
  for (const line of source.split(/\r?\n/)) {
    if (line === '') continue;
    const separator = line.indexOf('=');
    if (separator < 1) throw new Error('Operator credential is invalid.');
    result[line.slice(0, separator)] = line.slice(separator + 1);
  }
  if (
    result.AGENT_EXCON_PROTOCOL_VERSION !== 'v2' ||
    typeof result.AGENT_EXCON_API_URL !== 'string' ||
    typeof result.AGENT_EXCON_OPERATOR_API_KEY !== 'string' ||
    typeof result.WISER_RUN_ID !== 'string'
  ) {
    throw new Error('Operator credential does not match the v2 lab contract.');
  }
  return result;
}

async function operatorGet(operator, path) {
  const response = await fetch(new URL(path, operator.AGENT_EXCON_API_URL), {
    headers: {
      authorization: `Bearer ${operator.AGENT_EXCON_OPERATOR_API_KEY}`,
    },
    signal: globalThis.AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(`Operator query failed with HTTP ${response.status}.`);
  }
  return response.json();
}

function publicEvaluations(value) {
  if (
    value === null ||
    typeof value !== 'object' ||
    !Array.isArray(value.items)
  ) {
    throw new Error('Evaluation response is invalid.');
  }
  return value.items.map((evaluation) => ({
    evaluationId: evaluation.id,
    roleSlotId: evaluation.roleSlotId,
    targetScope: evaluation.targetScope,
    verdict: evaluation.verdict,
    issueCodes: Array.isArray(evaluation.issueCodes)
      ? evaluation.issueCodes
      : [],
    submissionId: evaluation.submissionId,
    deterministic: evaluation.deterministic === true,
    evaluatorVersion: evaluation.evaluatorVersion,
    createdRunSeq: evaluation.createdRunSeq,
    createdAt: evaluation.createdAt,
  }));
}

function eventSummary(value) {
  if (
    value === null ||
    typeof value !== 'object' ||
    !Array.isArray(value.items)
  ) {
    throw new Error('Event response is invalid.');
  }
  const releasedBarriers = value.items
    .filter(({ eventType }) => eventType === 'barrier.released')
    .map(({ payload }) => payload?.definitionKey)
    .filter((definitionKey) => typeof definitionKey === 'string');
  return {
    eventCount: value.items.length,
    lastRunSeq:
      value.items.length === 0 ? null : (value.items.at(-1)?.runSeq ?? null),
    releasedBarriers: [...new Set(releasedBarriers)],
  };
}

function authoritativePass(launch, evaluations, releasedBarriers) {
  const expected = new Map([
    ['water-evidence', 'role'],
    ['hydraulic-constraints', 'role'],
    ['ecological-target', 'role'],
    ['dispatch-coordination', 'team'],
  ]);
  return (
    launch.exitCode === 0 &&
    evaluations.length === expected.size &&
    evaluations.every(
      ({ roleSlotId, targetScope, verdict, deterministic }) =>
        expected.get(roleSlotId) === targetScope &&
        verdict === 'ACCEPTED' &&
        deterministic === true,
    ) &&
    ['analysis-ready', 'endorsement-ready'].every((barrier) =>
      releasedBarriers.includes(barrier),
    )
  );
}

export async function runWorkBuddyCookbook(options) {
  const repositoryRoot = requireAbsolute(
    'repositoryRoot',
    options.repositoryRoot,
  );
  const outputDirectory = requireAbsolute(
    'outputDirectory',
    options.outputDirectory,
  );
  const mode = options.mode;
  if (!['scripted', 'workbuddy'].includes(mode)) {
    throw new Error('Cookbook mode must be scripted or workbuddy.');
  }
  const environment = options.environment ?? process.env;
  const workBuddyCli = requireAbsolute(
    'workBuddyCli',
    options.workBuddyCli ?? defaultWorkBuddyCli,
  );
  await mkdir(dirname(outputDirectory), { mode: 0o700, recursive: true });
  await mkdir(outputDirectory, { mode: 0o700 });
  const labRuntimeDirectory = join(outputDirectory, 'lab');
  const workBuddyRuntimeDirectory = join(outputDirectory, 'workbuddy');
  const port = await freeLoopbackPort();
  let server;
  let launch;
  let evaluations = [];
  let events = { eventCount: 0, lastRunSeq: null, releasedBarriers: [] };
  let failure = null;
  try {
    server = await startV2LocalLabServer({
      config: {
        host: '127.0.0.1',
        port,
        apiBaseUrl: `http://127.0.0.1:${port}/api/v2/`,
        runtimeDirectory: labRuntimeDirectory,
      },
      environment,
    });
    const rendered = await renderWorkBuddyRuntime({
      labManifestPath: server.bundle.manifestPath,
      nodeExecutable: process.execPath,
      outputDirectory: workBuddyRuntimeDirectory,
      repositoryRoot,
      workBuddyCli,
      mcpCommand: join(repositoryRoot, 'node_modules/.bin/tsx'),
      mcpArguments: [join(repositoryRoot, 'apps/mcp/src/index.ts')],
    });
    launch = await launchWorkBuddyRoles({
      environment,
      launchManifestPath: rendered.launchManifestPath,
      mode,
      repositoryRoot,
      maxTurns: options.maxTurns,
      timeoutMs: options.timeoutMs,
    });
    const operator = parseEnv(
      await readFile(server.bundle.operatorCredentialFile, 'utf8'),
    );
    if (operator.WISER_RUN_ID !== server.lab.manifest.runId) {
      throw new Error('Operator credential Run identity mismatch.');
    }
    const [evaluationResponse, eventResponse] = await Promise.all([
      operatorGet(operator, `runs/${operator.WISER_RUN_ID}/evaluations`),
      operatorGet(
        operator,
        `runs/${operator.WISER_RUN_ID}/events?after=0&limit=200`,
      ),
    ]);
    evaluations = publicEvaluations(evaluationResponse);
    events = eventSummary(eventResponse);
  } catch (error) {
    failure =
      error instanceof Error
        ? error.message.replace(/wbl_[A-Za-z0-9_-]+/g, '[REDACTED]')
        : 'Unknown cookbook failure.';
  } finally {
    await Promise.allSettled([
      server?.close(),
      rm(join(workBuddyRuntimeDirectory, 'mcp'), {
        force: true,
        recursive: true,
      }),
    ]);
  }

  const passed =
    failure === null &&
    launch !== undefined &&
    authoritativePass(launch, evaluations, events.releasedBarriers);
  const report = {
    schemaVersion: 1,
    cookbookId: 'workbuddy-yongding-four-agent-tdd',
    profile: mode === 'scripted' ? 'scripted-ci' : 'workbuddy-live-tdd',
    protocolVersion: 'v2',
    status: passed ? 'passed' : 'failed',
    runId: server?.lab.manifest.runId ?? null,
    scenarioVersionId: server?.lab.manifest.scenarioVersionId ?? null,
    participantResults: launch?.report.results ?? [],
    authoritative: {
      evaluations,
      releasedBarriers: events.releasedBarriers,
      eventCount: events.eventCount,
      lastRunSeq: events.lastRunSeq,
    },
    artifacts: {
      participantReport:
        launch === undefined
          ? null
          : relative(outputDirectory, launch.reportPath),
      roleResultsDirectory: 'workbuddy/results',
      rolePromptsDirectory: 'workbuddy/prompts',
    },
    diagnostic: passed
      ? null
      : (failure ?? 'Authoritative WISER acceptance gates did not pass.'),
  };
  const reportPath = join(outputDirectory, 'cookbook-report.json');
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600,
  });
  return { exitCode: passed ? 0 : 1, report, reportPath };
}

function cliOptions(argv) {
  const modeIndex = argv.indexOf('--mode');
  const outputIndex = argv.indexOf('--output');
  const repositoryRoot = resolve(cookbookRoot, '../..');
  const mode = modeIndex < 0 ? 'scripted' : argv[modeIndex + 1];
  const stamp = new Date().toISOString().replaceAll(/[:.]/g, '-');
  const outputDirectory =
    outputIndex < 0
      ? join(repositoryRoot, '.wiser', 'runs', `${stamp}-${mode}`)
      : resolve(argv[outputIndex + 1]);
  return {
    environment: process.env,
    mode,
    outputDirectory,
    repositoryRoot,
    ...(process.env.WORKBUDDY_CLI === undefined
      ? {}
      : { workBuddyCli: resolve(process.env.WORKBUDDY_CLI) }),
  };
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === scriptPath) {
  void runWorkBuddyCookbook(cliOptions(process.argv.slice(2)))
    .then(({ exitCode, reportPath, report }) => {
      process.stdout.write(
        `${JSON.stringify({
          status: report.status,
          profile: report.profile,
          runId: report.runId,
          reportPath,
        })}\n`,
      );
      process.exitCode = exitCode;
    })
    .catch((error) => {
      process.stderr.write(
        `WISER cookbook failed before report creation: ${
          error instanceof Error ? error.message : String(error)
        }\n`,
      );
      process.exitCode = 1;
    });
}
