#!/usr/bin/env node

import { createServer } from 'node:net';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { startV2LocalLabServer } from '../../../apps/api/src/index.ts';
import {
  BestEffortTelemetryOverlaySchema,
  RunInteractionListSchema,
} from '../../../packages/contracts/src/index.ts';

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

export async function collectOperatorEvents(readPage) {
  const items = [];
  let after = 0;
  const limit = 200;
  for (let page = 0; page < 100; page += 1) {
    const response = await readPage(after, limit);
    if (
      response === null ||
      typeof response !== 'object' ||
      !Array.isArray(response.items)
    ) {
      throw new Error('Event page is invalid.');
    }
    if (response.items.length === 0) return { items };
    let priorRunSeq = after;
    for (const event of response.items) {
      if (
        event === null ||
        typeof event !== 'object' ||
        !Number.isInteger(event.runSeq) ||
        event.runSeq <= priorRunSeq
      ) {
        throw new Error('Event page does not advance a contiguous cursor.');
      }
      priorRunSeq = event.runSeq;
      items.push(event);
    }
    after = priorRunSeq;
    if (response.items.length < limit) return { items };
  }
  throw new Error('Event pagination exceeded the safety limit.');
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

function interactionSummary(value) {
  const interactions = RunInteractionListSchema.parse(value).items;
  const handoffs = interactions.filter(({ kind }) => kind === 'handoff');
  const requests = interactions.filter(({ kind }) => kind === 'request');
  const responses = interactions.filter(({ kind }) => kind === 'response');
  return {
    interactionCount: interactions.length,
    handoffCount: handoffs.length,
    closedHandoffCount: handoffs.filter(({ deliveries }) =>
      deliveries.every(({ state }) => state === 'acknowledged'),
    ).length,
    distinctHandoffSenderCount: new Set(
      handoffs.map(({ senderId }) => senderId),
    ).size,
    requestCount: requests.length,
    respondedRequestCount: requests.filter(
      ({ status }) => status === 'responded',
    ).length,
    responseCount: responses.length,
    distinctResponseSenderCount: new Set(
      responses.map(({ senderId }) => senderId),
    ).size,
    openRequestCount: requests.filter(({ status }) => status === 'open').length,
    acknowledgedDeliveryCount: interactions.reduce(
      (count, { deliveries }) =>
        count +
        deliveries.filter(({ state }) => state === 'acknowledged').length,
      0,
    ),
  };
}

function observabilitySummary(value) {
  const overlay = BestEffortTelemetryOverlaySchema.parse(value);
  return {
    bestEffort: true,
    gap: overlay.gap,
    boundaryCoverage: overlay.coverage.boundaryCoverage,
    participantTelemetryMode: overlay.coverage.participantTelemetryMode,
    platformObservedSpanCount: overlay.trust.platformObservedSpanCount,
    participantReportedSpanCount: overlay.trust.participantReportedSpanCount,
    droppedSpanCount: overlay.coverage.droppedSpanCount,
    lateSpanCount: overlay.coverage.lateSpanCount,
    traceCount: overlay.traces.length,
  };
}

function authoritativePass(
  launch,
  evaluations,
  releasedBarriers,
  interactions,
  faultInjection,
) {
  const expected = new Map([
    ['water-evidence', 'role'],
    ['hydraulic-constraints', 'role'],
    ['ecological-target', 'role'],
    ['dispatch-coordination', 'team'],
  ]);
  return (
    launch.exitCode === 0 &&
    [...expected].every(([roleSlotId, targetScope]) => {
      const roleEvaluations = evaluations.filter(
        (evaluation) => evaluation.roleSlotId === roleSlotId,
      );
      const latest = roleEvaluations.at(-1);
      return (
        latest?.targetScope === targetScope &&
        latest.verdict === 'ACCEPTED' &&
        latest.deterministic === true
      );
    }) &&
    (faultInjection === null ||
      evaluations.some(
        ({ roleSlotId, verdict }) =>
          roleSlotId === 'water-evidence' && verdict === 'REWORK_REQUIRED',
      )) &&
    ['analysis-ready', 'endorsement-ready'].every((barrier) =>
      releasedBarriers.includes(barrier),
    ) &&
    interactions.closedHandoffCount >= 3 &&
    interactions.distinctHandoffSenderCount >= 3 &&
    interactions.requestCount >= 1 &&
    interactions.respondedRequestCount >= 1 &&
    interactions.openRequestCount === 0 &&
    interactions.distinctResponseSenderCount >= 3
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
  const faultInjection = options.faultInjection ?? null;
  if (
    ![null, 'water-evidence-schema-once'].includes(faultInjection) ||
    (faultInjection !== null && mode !== 'scripted')
  ) {
    throw new Error(
      'faultInjection is supported only by scripted mode and must use a published fault key.',
    );
  }
  const workBuddyCli = requireAbsolute(
    'workBuddyCli',
    options.workBuddyCli ?? defaultWorkBuddyCli,
  );
  await mkdir(dirname(outputDirectory), { mode: 0o700, recursive: true });
  await mkdir(outputDirectory, { mode: 0o700 });
  const labRuntimeDirectory = join(outputDirectory, 'lab');
  const workBuddyRuntimeDirectory = join(outputDirectory, 'workbuddy');
  const port = await freeLoopbackPort();
  const apiBaseUrl = `http://127.0.0.1:${port}/api/v2/`;
  let server;
  let launch;
  let evaluations = [];
  let events = { eventCount: 0, lastRunSeq: null, releasedBarriers: [] };
  let interactions = {
    interactionCount: 0,
    handoffCount: 0,
    closedHandoffCount: 0,
    distinctHandoffSenderCount: 0,
    requestCount: 0,
    respondedRequestCount: 0,
    responseCount: 0,
    distinctResponseSenderCount: 0,
    openRequestCount: 0,
    acknowledgedDeliveryCount: 0,
  };
  let observability = {
    bestEffort: true,
    gap: true,
    boundaryCoverage: 0,
    participantTelemetryMode: 'none',
    platformObservedSpanCount: 0,
    participantReportedSpanCount: 0,
    droppedSpanCount: 0,
    lateSpanCount: 0,
    traceCount: 0,
  };
  let failure = null;
  try {
    server = await startV2LocalLabServer({
      config: {
        host: '127.0.0.1',
        port,
        apiBaseUrl,
        runtimeDirectory: labRuntimeDirectory,
      },
      environment,
    });
    await options.onLabReady?.({
      apiBaseUrl,
      operatorToken: server.lab.operatorToken,
      runId: server.lab.manifest.runId,
      scenarioVersionId: server.lab.manifest.scenarioVersionId,
      roster: server.lab.manifest.roster,
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
      environment: {
        ...environment,
        ...(faultInjection === null
          ? {}
          : { WISER_SCRIPTED_FAULT: faultInjection }),
      },
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
    const [
      evaluationResponse,
      eventResponse,
      interactionResponse,
      telemetryResponse,
    ] = await Promise.all([
      operatorGet(operator, `runs/${operator.WISER_RUN_ID}/evaluations`),
      collectOperatorEvents((after, limit) =>
        operatorGet(
          operator,
          `runs/${operator.WISER_RUN_ID}/events?after=${after}&limit=${limit}`,
        ),
      ),
      operatorGet(operator, `runs/${operator.WISER_RUN_ID}/interactions`),
      operatorGet(operator, `runs/${operator.WISER_RUN_ID}/traces`),
    ]);
    evaluations = publicEvaluations(evaluationResponse);
    events = eventSummary(eventResponse);
    interactions = interactionSummary(interactionResponse);
    observability = observabilitySummary(telemetryResponse);
    await options.onObservationReady?.({
      evaluations,
      events,
      interactions,
      observability,
      participantResults: launch.report.results,
      runId: server.lab.manifest.runId,
    });
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
    authoritativePass(
      launch,
      evaluations,
      events.releasedBarriers,
      interactions,
      faultInjection,
    );
  const waterEvaluations = evaluations.filter(
    ({ roleSlotId }) => roleSlotId === 'water-evidence',
  );
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
      interactions,
    },
    observability,
    tddCycle: {
      injectedFault: faultInjection,
      reworkObserved: waterEvaluations.some(
        ({ verdict }) => verdict === 'REWORK_REQUIRED',
      ),
      greenAccepted: waterEvaluations.at(-1)?.verdict === 'ACCEPTED' && passed,
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
  const faultIndex = argv.indexOf('--fault');
  const stamp = new Date().toISOString().replaceAll(/[:.]/g, '-');
  const outputDirectory =
    outputIndex < 0
      ? join(repositoryRoot, '.wiser', 'runs', `${stamp}-${mode}`)
      : resolve(argv[outputIndex + 1]);
  return {
    environment: process.env,
    mode,
    ...(faultIndex < 0 ? {} : { faultInjection: argv[faultIndex + 1] }),
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
