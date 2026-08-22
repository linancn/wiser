import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import {
  access as accessPath,
  chmod,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { createServer } from 'node:net';
import { isAbsolute, join, resolve } from 'node:path';

import { runWorkBuddyCookbook } from '../../scripts/run-cookbook.mjs';

const SESSION_FILE = 'showcase-session.json';
const CONTROL_FILE = 'showcase-control.json';
const DEFAULT_TTL_MS = 15 * 60 * 1_000;
const DEFAULT_WORKBUDDY_CLI =
  '/Applications/WorkBuddy.app/Contents/Resources/app.asar.unpacked/cli/bin/codebuddy';
const ACTIVE_STATES = new Set(['STARTING', 'RUNNING', 'COMPLETED', 'STOPPING']);
const SAFE_CHILD_ENVIRONMENT = [
  'HOME',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'LOGNAME',
  'NODE_OPTIONS',
  'PATH',
  'SHELL',
  'TERM',
  'TMPDIR',
  'USER',
  'XDG_CACHE_HOME',
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
];

function pause(milliseconds) {
  return new Promise((resolvePause) => {
    globalThis.setTimeout(resolvePause, milliseconds);
  });
}

function requireAbsolute(name, value) {
  if (typeof value !== 'string' || !isAbsolute(value)) {
    throw new Error(`${name} must be an absolute path.`);
  }
  return value;
}

function profileToCookbook(profile) {
  if (profile === 'scripted') return { mode: 'scripted' };
  if (profile === 'rework') {
    return {
      mode: 'scripted',
      faultInjection: 'water-evidence-schema-once',
    };
  }
  if (profile === 'workbuddy') return { mode: 'workbuddy' };
  throw new Error('profile must be scripted, rework, or workbuddy.');
}

function statePath(stateDirectory) {
  return join(stateDirectory, SESSION_FILE);
}

function controlPath(stateDirectory) {
  return join(stateDirectory, CONTROL_FILE);
}

async function readSession(stateDirectory) {
  try {
    const value = JSON.parse(await readFile(statePath(stateDirectory), 'utf8'));
    if (
      value === null ||
      typeof value !== 'object' ||
      value.schemaVersion !== 1 ||
      typeof value.state !== 'string' ||
      !('cleanup' in value)
    ) {
      throw new Error('Showcase session file is invalid.');
    }
    return value;
  } catch (error) {
    if (
      error !== null &&
      typeof error === 'object' &&
      error.code === 'ENOENT'
    ) {
      return undefined;
    }
    throw error;
  }
}

async function readControl(stateDirectory) {
  try {
    const value = JSON.parse(
      await readFile(controlPath(stateDirectory), 'utf8'),
    );
    if (
      value === null ||
      typeof value !== 'object' ||
      value.schemaVersion !== 1 ||
      !Number.isInteger(value.supervisorPid) ||
      value.supervisorPid < 1
    ) {
      throw new Error('Showcase control file is invalid.');
    }
    return value;
  } catch (error) {
    if (
      error !== null &&
      typeof error === 'object' &&
      error.code === 'ENOENT'
    ) {
      return undefined;
    }
    throw error;
  }
}

function publicObservationSummary(value) {
  const interactions =
    value?.interactions !== null && typeof value?.interactions === 'object'
      ? value.interactions
      : {};
  const events =
    value?.events !== null && typeof value?.events === 'object'
      ? value.events
      : {};
  const participants = Array.isArray(value?.participantResults)
    ? value.participantResults
    : [];
  return {
    acknowledgedDeliveryCount: Number(
      interactions.acknowledgedDeliveryCount ?? 0,
    ),
    completedParticipantCount: participants.filter(
      ({ status }) => status === 'completed',
    ).length,
    eventCount: Number(events.eventCount ?? 0),
    handoffCount: Number(interactions.handoffCount ?? 0),
    interactionCount: Number(interactions.interactionCount ?? 0),
    openRequestCount: Number(interactions.openRequestCount ?? 0),
    requestCount: Number(interactions.requestCount ?? 0),
    responseCount: Number(interactions.responseCount ?? 0),
  };
}

function safeSession(value) {
  return {
    schemaVersion: 1,
    profile: String(value.profile),
    state: String(value.state),
    runId: value.runId === null ? null : String(value.runId),
    webUrl: value.webUrl === null ? null : String(value.webUrl),
    createdAt: String(value.createdAt),
    expiresAt: String(value.expiresAt),
    reportPath: value.reportPath === null ? null : String(value.reportPath),
    diagnosticCode:
      value.diagnosticCode === null ? null : String(value.diagnosticCode),
    cleanup: {
      childProcessesStopped: value.cleanup.childProcessesStopped === true,
      credentialsRemoved: value.cleanup.credentialsRemoved === true,
      mcpConfigsRemoved: value.cleanup.mcpConfigsRemoved === true,
    },
  };
}

async function writeSession(stateDirectory, value) {
  await mkdir(stateDirectory, { mode: 0o700, recursive: true });
  await chmod(stateDirectory, 0o700);
  const destination = statePath(stateDirectory);
  const temporary = join(
    stateDirectory,
    `.showcase-session-${process.pid}-${randomUUID()}.tmp`,
  );
  const serialized = `${JSON.stringify(safeSession(value), null, 2)}\n`;
  await writeFile(temporary, serialized, {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600,
  });
  await chmod(temporary, 0o600);
  await rename(temporary, destination);
  await chmod(destination, 0o600);
  return safeSession(value);
}

async function writeControl(stateDirectory, value) {
  await mkdir(stateDirectory, { mode: 0o700, recursive: true });
  await chmod(stateDirectory, 0o700);
  const destination = controlPath(stateDirectory);
  const temporary = join(
    stateDirectory,
    `.showcase-control-${process.pid}-${randomUUID()}.tmp`,
  );
  const control = {
    schemaVersion: 1,
    supervisorPid: Number(value.supervisorPid),
    webPid: value.webPid === null ? null : Number(value.webPid),
    outputDirectory: String(value.outputDirectory),
  };
  await writeFile(temporary, `${JSON.stringify(control, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600,
  });
  await chmod(temporary, 0o600);
  await rename(temporary, destination);
  await chmod(destination, 0o600);
  return control;
}

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid < 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function pathIsMissing(path) {
  if (typeof path !== 'string') return true;
  try {
    await accessPath(path);
    return false;
  } catch (error) {
    return (
      error !== null && typeof error === 'object' && error.code === 'ENOENT'
    );
  }
}

function cleanupComplete(cleanup) {
  return (
    cleanup.childProcessesStopped &&
    cleanup.credentialsRemoved &&
    cleanup.mcpConfigsRemoved
  );
}

async function cleanupRuntime(outputDirectory, childProcessesStopped = true) {
  if (typeof outputDirectory !== 'string') {
    return {
      childProcessesStopped,
      credentialsRemoved: true,
      mcpConfigsRemoved: true,
    };
  }
  const credentialsDirectory = join(outputDirectory, 'lab', 'credentials');
  const mcpDirectory = join(outputDirectory, 'workbuddy', 'mcp');
  await Promise.allSettled([
    rm(credentialsDirectory, { force: true, recursive: true }),
    rm(mcpDirectory, { force: true, recursive: true }),
  ]);
  const [credentialsRemoved, mcpConfigsRemoved] = await Promise.all([
    pathIsMissing(credentialsDirectory),
    pathIsMissing(mcpDirectory),
  ]);
  return {
    childProcessesStopped,
    credentialsRemoved,
    mcpConfigsRemoved,
  };
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

function childEnvironment(source, extra) {
  const environment = {};
  for (const name of SAFE_CHILD_ENVIRONMENT) {
    if (typeof source[name] === 'string') environment[name] = source[name];
  }
  return { ...environment, ...extra };
}

function collectChildOutput(child) {
  let output = '';
  const append = (chunk) => {
    if (Buffer.byteLength(output) >= 32_768) return;
    output += String(chunk).slice(0, 32_768 - Buffer.byteLength(output));
  };
  child.stdout?.on('data', append);
  child.stderr?.on('data', append);
  return () => output;
}

async function startNextWeb({ environment, port, repositoryRoot }) {
  const nextBinary = join(repositoryRoot, 'apps/web/node_modules/.bin/next');
  let nextCommand;
  try {
    await accessPath(join(repositoryRoot, 'apps/web/.next/BUILD_ID'));
    nextCommand = 'start';
  } catch {
    nextCommand = 'dev';
  }
  const child = spawn(
    nextBinary,
    [nextCommand, '--hostname', '127.0.0.1', '--port', String(port)],
    {
      cwd: join(repositoryRoot, 'apps/web'),
      env: childEnvironment(process.env, environment),
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  const output = collectChildOutput(child);
  const exited = new Promise((resolveExit) => {
    child.once('close', (exitCode, signal) =>
      resolveExit({ exitCode, signal }),
    );
  });
  await new Promise((resolveSpawn, rejectSpawn) => {
    child.once('spawn', resolveSpawn);
    child.once('error', rejectSpawn);
  });
  let stopped = false;
  return {
    pid: child.pid,
    url: `http://127.0.0.1:${port}`,
    async stop() {
      if (stopped) return;
      stopped = true;
      if (child.exitCode !== null || child.signalCode !== null) return;
      child.kill('SIGTERM');
      const outcome = await Promise.race([
        exited.then(() => 'exited'),
        pause(5_000).then(() => 'timeout'),
      ]);
      if (
        outcome === 'timeout' &&
        child.exitCode === null &&
        child.signalCode === null
      ) {
        child.kill('SIGKILL');
        await exited;
      }
    },
    exited,
    output,
  };
}

export async function waitForHttpReady(
  url,
  {
    attempts = 120,
    fetcher = globalThis.fetch,
    pause: wait = () => pause(250),
  } = {},
) {
  let lastFailure = 'unreachable';
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetcher(url, {
        redirect: 'manual',
        signal: globalThis.AbortSignal.timeout(5_000),
      });
      if (response.status === 429) {
        throw new Error(`Readiness probe received HTTP 429 from ${url}.`);
      }
      if (response.ok || (response.status >= 300 && response.status < 400)) {
        return;
      }
      lastFailure = `HTTP ${response.status}`;
    } catch (error) {
      if (error instanceof Error && error.message.includes('HTTP 429')) {
        throw error;
      }
      lastFailure = error instanceof Error ? error.message : String(error);
    }
    if (attempt + 1 < attempts) await wait();
  }
  throw new Error(`Readiness probe failed for ${url}: ${lastFailure}`);
}

async function probeOnce(url) {
  const response = await fetch(url, {
    redirect: 'manual',
    signal: globalThis.AbortSignal.timeout(5_000),
  });
  return { ok: response.ok, status: response.status };
}

export async function runShowcasePreflight(options, dependencies = {}) {
  const repositoryRoot = requireAbsolute(
    'repositoryRoot',
    options.repositoryRoot,
  );
  const stateDirectory = requireAbsolute(
    'stateDirectory',
    options.stateDirectory,
  );
  const profile = options.profile;
  profileToCookbook(profile);
  const environment = options.environment ?? process.env;
  const access = dependencies.access ?? accessPath;
  const isProcessAlive = dependencies.isProcessAlive ?? processIsAlive;
  const workBuddyCli = dependencies.workBuddyCli ?? DEFAULT_WORKBUDDY_CLI;
  const checks = [];
  checks.push({
    id: 'node',
    ok: Number(process.versions.node.split('.')[0]) >= 24,
    detail: `Node ${process.versions.node}`,
  });
  try {
    await access(
      join(repositoryRoot, 'apps/web/node_modules/.bin/next'),
      constants.X_OK,
    );
    checks.push({
      id: 'next',
      ok: true,
      detail: 'Next executable is available.',
    });
  } catch {
    checks.push({
      id: 'next',
      ok: false,
      detail: 'Next executable is missing.',
    });
  }
  try {
    await mkdir(stateDirectory, { mode: 0o700, recursive: true });
    await chmod(stateDirectory, 0o700);
    await access(
      stateDirectory,
      constants.R_OK | constants.W_OK | constants.X_OK,
    );
    checks.push({
      id: 'state-directory',
      ok: true,
      detail: 'Private state directory is writable.',
    });
  } catch {
    checks.push({
      id: 'state-directory',
      ok: false,
      detail: 'Private state directory is unavailable.',
    });
  }
  const [existing, control] = await Promise.all([
    readSession(stateDirectory).catch(() => undefined),
    readControl(stateDirectory).catch(() => undefined),
  ]);
  const active =
    existing !== undefined &&
    ACTIVE_STATES.has(existing.state) &&
    control !== undefined &&
    isProcessAlive(control.supervisorPid);
  const stale =
    existing !== undefined && ACTIVE_STATES.has(existing.state) && !active;
  checks.push({
    id: 'session',
    ok: !active,
    detail: active
      ? 'Another showcase supervisor is active.'
      : 'No active showcase supervisor was found.',
  });
  checks.push({
    id: 'stale-session',
    ok: !stale,
    detail: stale
      ? 'A stale showcase session requires stop/cleanup.'
      : 'No stale active session was found.',
  });
  const leftoverPrivateRuntime =
    control?.outputDirectory !== undefined &&
    (!(await pathIsMissing(
      join(control.outputDirectory, 'lab', 'credentials'),
    )) ||
      !(await pathIsMissing(
        join(control.outputDirectory, 'workbuddy', 'mcp'),
      )));
  checks.push({
    id: 'leftover-private-runtime',
    ok: !leftoverPrivateRuntime,
    detail: leftoverPrivateRuntime
      ? 'A prior private runtime requires cleanup.'
      : 'No prior credential or MCP runtime remains.',
  });
  checks.push({
    id: 'environment',
    ok: environment.NODE_ENV !== 'production',
    detail:
      environment.NODE_ENV === 'production'
        ? 'Showcase is disabled in production.'
        : 'Development-only Lab is allowed.',
  });
  if (profile === 'workbuddy') {
    let cliAvailable;
    try {
      await access(workBuddyCli, constants.X_OK);
      cliAvailable = true;
    } catch {
      cliAvailable = false;
    }
    checks.push({
      id: 'workbuddy-cli',
      ok: cliAvailable,
      detail: cliAvailable
        ? 'WorkBuddy CLI is executable.'
        : 'WorkBuddy CLI is unavailable.',
    });
    checks.push({
      id: 'workbuddy-opt-in',
      ok: environment.WORKBUDDY_LIVE === '1',
      detail:
        environment.WORKBUDDY_LIVE === '1'
          ? 'Live WorkBuddy opt-in is present.'
          : 'Live WorkBuddy requires WORKBUDDY_LIVE=1.',
    });
  }
  return {
    ok: checks.every(({ ok }) => ok),
    profile,
    checks,
  };
}

export async function getShowcaseStatus(options, dependencies = {}) {
  const stateDirectory = requireAbsolute(
    'stateDirectory',
    options.stateDirectory,
  );
  const session = await readSession(stateDirectory);
  if (session === undefined) {
    return {
      active: false,
      state: 'absent',
      webReachable: false,
    };
  }
  const control = await readControl(stateDirectory).catch(() => undefined);
  const isProcessAlive = dependencies.isProcessAlive ?? processIsAlive;
  const probe = dependencies.probe ?? probeOnce;
  const active =
    ACTIVE_STATES.has(session.state) &&
    control !== undefined &&
    isProcessAlive(control.supervisorPid);
  let webReachable = false;
  let webStatus = null;
  if (active && typeof session.webUrl === 'string') {
    try {
      const response = await probe(session.webUrl);
      webReachable =
        response.ok || (response.status >= 300 && response.status < 400);
      webStatus = response.status;
    } catch {
      webReachable = false;
    }
  }
  return { ...session, active, webReachable, webStatus };
}

export async function requestShowcaseStop(options, dependencies = {}) {
  const stateDirectory = requireAbsolute(
    'stateDirectory',
    options.stateDirectory,
  );
  const session = await readSession(stateDirectory);
  if (session === undefined) {
    return { state: 'absent', signalled: false };
  }
  if (!ACTIVE_STATES.has(session.state) && cleanupComplete(session.cleanup)) {
    return { ...session, signalled: false };
  }
  const control = await readControl(stateDirectory).catch(() => undefined);
  const isProcessAlive = dependencies.isProcessAlive ?? processIsAlive;
  const killProcess =
    dependencies.killProcess ?? ((pid, signal) => process.kill(pid, signal));
  if (control === undefined || !isProcessAlive(control.supervisorPid)) {
    if (
      control?.webPid !== null &&
      control?.webPid !== undefined &&
      isProcessAlive(control.webPid)
    ) {
      killProcess(control.webPid, 'SIGTERM');
      await (dependencies.pause ?? (() => pause(100)))();
    }
    const outputDirectory = control?.outputDirectory;
    const cleanup = await cleanupRuntime(
      outputDirectory,
      control?.webPid === null ||
        control?.webPid === undefined ||
        !isProcessAlive(control.webPid),
    );
    const stopped = await writeSession(stateDirectory, {
      ...session,
      state: cleanupComplete(cleanup) ? 'STOPPED' : 'FAILED',
      diagnosticCode: cleanupComplete(cleanup)
        ? session.diagnosticCode
        : 'SHOWCASE_CLEANUP_FAILED',
      cleanup,
    });
    await rm(controlPath(stateDirectory), { force: true });
    return { ...stopped, signalled: false };
  }
  const stopping = await writeSession(stateDirectory, {
    ...session,
    state: 'STOPPING',
  });
  killProcess(control.supervisorPid, 'SIGTERM');
  const wait = dependencies.pause ?? (() => pause(100));
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (!isProcessAlive(control.supervisorPid)) {
      const finalSession = (await readSession(stateDirectory)) ?? stopping;
      return { ...finalSession, signalled: true };
    }
    await wait();
  }
  const timedOut = await writeSession(stateDirectory, {
    ...session,
    state: 'FAILED',
    diagnosticCode: 'SHOWCASE_STOP_TIMEOUT',
  });
  return { ...timedOut, signalled: true };
}

export async function startShowcaseSupervisor(options, dependencies = {}) {
  const repositoryRoot = requireAbsolute(
    'repositoryRoot',
    options.repositoryRoot,
  );
  const stateDirectory = requireAbsolute(
    'stateDirectory',
    options.stateDirectory,
  );
  const profile = options.profile;
  const cookbookProfile = profileToCookbook(profile);
  const environment = options.environment ?? process.env;
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  if (!Number.isInteger(ttlMs) || ttlMs < 1 || ttlMs > DEFAULT_TTL_MS) {
    throw new Error('ttlMs must be an integer from 1 through 900000.');
  }
  const preflight = await runShowcasePreflight(
    { environment, profile, repositoryRoot, stateDirectory },
    dependencies.preflight,
  );
  if (!preflight.ok) {
    throw new Error(
      `Showcase preflight failed: ${preflight.checks
        .filter(({ ok }) => !ok)
        .map(({ id }) => id)
        .join(', ')}`,
    );
  }

  const now = dependencies.now ?? (() => new Date());
  const startedAt = now();
  const expiresAt = new Date(startedAt.getTime() + ttlMs);
  const outputDirectory = join(
    stateDirectory,
    'showcase-runs',
    `${startedAt.toISOString().replaceAll(/[:.]/g, '-')}-${profile}`,
  );
  let session = await writeSession(stateDirectory, {
    schemaVersion: 1,
    profile,
    state: 'STARTING',
    runId: null,
    webUrl: null,
    createdAt: startedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    reportPath: null,
    diagnosticCode: null,
    cleanup: {
      childProcessesStopped: false,
      credentialsRemoved: false,
      mcpConfigsRemoved: false,
    },
  });
  let control = await writeControl(stateDirectory, {
    supervisorPid: process.pid,
    webPid: null,
    outputDirectory,
  });

  let stopRequest;
  let resolveStop;
  const stopPromise = new Promise((resolveRequested) => {
    resolveStop = resolveRequested;
  });
  const requestStop = (reason) => {
    if (stopRequest !== undefined) return;
    stopRequest = reason;
    resolveStop(reason);
  };
  const signalHandlers = new Map();
  for (const signal of ['SIGINT', 'SIGTERM']) {
    const handler = () => requestStop(signal.toLowerCase());
    signalHandlers.set(signal, handler);
    process.once(signal, handler);
  }
  const ttlTimer = globalThis.setTimeout(() => requestStop('ttl'), ttlMs);
  const runCookbook = dependencies.runCookbook ?? runWorkBuddyCookbook;
  const startWeb = dependencies.startWeb ?? startNextWeb;
  const waitForWeb = dependencies.waitForWeb ?? waitForHttpReady;
  const allocatePort = dependencies.allocatePort ?? freeLoopbackPort;
  const emit =
    dependencies.emit ??
    ((value) => process.stdout.write(`${JSON.stringify(value)}\n`));
  let web;
  let cookbookResult;
  let failure;
  try {
    cookbookResult = await runCookbook({
      ...cookbookProfile,
      environment,
      outputDirectory,
      repositoryRoot,
      ...(options.maxTurns === undefined ? {} : { maxTurns: options.maxTurns }),
      ...(options.timeoutMs === undefined
        ? {}
        : { timeoutMs: options.timeoutMs }),
      ...(options.workBuddyCli === undefined
        ? {}
        : { workBuddyCli: options.workBuddyCli }),
      onLabReady: async (context) => {
        if (stopRequest !== undefined) {
          throw new Error('Showcase stopped before Web startup.');
        }
        const webPort = await allocatePort();
        web = await startWeb({
          environment: {
            AGENT_EXCON_WEB_DATA_MODE: 'live',
            AGENT_EXCON_API_INTERNAL_URL: context.apiBaseUrl,
            WISER_WEB_OPERATOR_TOKEN: context.operatorToken,
            NEXT_TELEMETRY_DISABLED: '1',
          },
          port: webPort,
          repositoryRoot,
        });
        const runUrl = `${web.url}/zh-CN/runs/${encodeURIComponent(context.runId)}`;
        const collaborationUrl = `${runUrl}/collaboration`;
        const webExit =
          web.exited === undefined
            ? new Promise(() => {})
            : web.exited.then(({ exitCode, signal }) => {
                throw new Error(
                  `Next Web exited before readiness (exit=${String(exitCode)}, signal=${String(signal)}).`,
                );
              });
        await Promise.race([
          waitForWeb(collaborationUrl),
          webExit,
          stopPromise.then((reason) => {
            throw new Error(
              `Showcase stopped during Web readiness: ${reason}.`,
            );
          }),
        ]);
        session = await writeSession(stateDirectory, {
          ...session,
          state: 'RUNNING',
          runId: context.runId,
          webUrl: collaborationUrl,
        });
        control = await writeControl(stateDirectory, {
          ...control,
          webPid: web.pid,
          outputDirectory,
        });
        emit({
          state: session.state,
          profile: session.profile,
          runId: session.runId,
          url: session.webUrl,
          expiresAt: session.expiresAt,
        });
      },
      onObservationReady: async (context) => {
        session = await writeSession(stateDirectory, {
          ...session,
          state: stopRequest === undefined ? 'COMPLETED' : 'STOPPING',
        });
        emit({
          state: session.state,
          profile: session.profile,
          runId: session.runId,
          url: session.webUrl,
          observation: publicObservationSummary(context),
        });
        if (stopRequest === undefined) await stopPromise;
      },
    });
    if (
      stopRequest === undefined &&
      (cookbookResult.exitCode !== 0 ||
        cookbookResult.report?.status === 'failed')
    ) {
      throw new Error(
        'Showcase cookbook did not pass its authoritative gates.',
      );
    }
    if (stopRequest === undefined) requestStop('completed');
  } catch (error) {
    failure = error;
    if (stopRequest === undefined) requestStop('error');
  } finally {
    globalThis.clearTimeout(ttlTimer);
    for (const [signal, handler] of signalHandlers) {
      process.removeListener(signal, handler);
    }
    const reason = stopRequest ?? 'error';
    let childProcessesStopped = true;
    try {
      await web?.stop(reason);
    } catch {
      childProcessesStopped = false;
    }
    const cleanup = await cleanupRuntime(
      outputDirectory,
      childProcessesStopped,
    );
    const cleanupFailed = !cleanupComplete(cleanup);
    if (cleanupFailed && failure === undefined) {
      failure = new Error('Showcase cleanup verification failed.');
    }
    const failed = failure !== undefined || cleanupFailed;
    const reportedDiagnostic = cookbookResult?.report?.diagnostic;
    const executionDiagnosticCode =
      typeof reportedDiagnostic === 'string' &&
      reportedDiagnostic.includes('429')
        ? 'WORKBUDDY_QUOTA_429'
        : 'SHOWCASE_EXECUTION_FAILED';
    const finalState = failed
      ? 'FAILED'
      : reason === 'ttl'
        ? 'EXPIRED'
        : 'STOPPED';
    session = await writeSession(stateDirectory, {
      ...session,
      state: finalState,
      reportPath: cookbookResult?.reportPath ?? null,
      diagnosticCode: cleanupFailed
        ? 'SHOWCASE_CLEANUP_FAILED'
        : failure === undefined
          ? null
          : executionDiagnosticCode,
      cleanup,
    });
    if (cleanupComplete(cleanup)) {
      await rm(controlPath(stateDirectory), { force: true });
    }
  }
  if (failure !== undefined) throw failure;
  return {
    reason: stopRequest,
    report: cookbookResult?.report,
    reportPath: cookbookResult?.reportPath,
    session,
  };
}

export function defaultShowcaseStateDirectory(repositoryRoot) {
  return join(resolve(repositoryRoot), '.wiser');
}
