import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const roles = [
  'water-evidence',
  'hydraulic-constraints',
  'ecological-target',
  'dispatch-coordination',
];
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const cookbookRoot = resolve(scriptDirectory, '..');
const fakeWorkBuddyPath = join(scriptDirectory, 'fake-workbuddy.mjs');
const scriptedParticipantPath = join(
  scriptDirectory,
  'scripted-participant.mjs',
);
const roleResultSchemaPath = join(
  cookbookRoot,
  'schemas',
  'role-result.schema.json',
);
const safeEnvironmentNames = new Set([
  'HOME',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'LOGNAME',
  'PATH',
  'SHELL',
  'TERM',
  'TMPDIR',
  'USER',
  'XDG_CACHE_HOME',
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
]);
const sensitiveName =
  /(?:api[_-]?key|authorization|bearer|password|secret|token)/i;

function requireAbsolute(name, value) {
  if (typeof value !== 'string' || !isAbsolute(value)) {
    throw new Error(`${name} must be an absolute path.`);
  }
  return value;
}

function assertContained(name, parent, candidate) {
  const relation = relative(parent, candidate);
  if (relation === '' || relation.startsWith('..') || isAbsolute(relation)) {
    throw new Error(`${name} must be contained by the private runtime.`);
  }
}

function assertLaunchManifest(manifest, runtimeDirectory) {
  if (
    manifest === null ||
    typeof manifest !== 'object' ||
    manifest.schemaVersion !== 1 ||
    manifest.profile !== 'workbuddy-four-process' ||
    manifest.protocolVersion !== 'v2' ||
    typeof manifest.workBuddyCli !== 'string' ||
    !isAbsolute(manifest.workBuddyCli) ||
    typeof manifest.runId !== 'string' ||
    typeof manifest.scenarioVersionId !== 'string' ||
    !Array.isArray(manifest.roles) ||
    manifest.roles.length !== roles.length
  ) {
    throw new Error('Launch manifest does not match the WorkBuddy contract.');
  }
  for (const [index, role] of manifest.roles.entries()) {
    if (
      role === null ||
      typeof role !== 'object' ||
      role.roleSlotId !== roles[index] ||
      typeof role.runAgentId !== 'string'
    ) {
      throw new Error('Launch manifest role ordering or identity is invalid.');
    }
    for (const property of [
      'mcpConfigPath',
      'promptPath',
      'resultPath',
      'stderrPath',
    ]) {
      requireAbsolute(`roles[${index}].${property}`, role[property]);
      assertContained(
        `roles[${index}].${property}`,
        runtimeDirectory,
        role[property],
      );
    }
  }
}

function cleanEnvironment(source, role, repositoryRoot) {
  const environment = {};
  for (const name of safeEnvironmentNames) {
    if (typeof source[name] === 'string') environment[name] = source[name];
  }
  environment.CODEBUDDY_SESSION_SKILL_DIRS = join(
    repositoryRoot,
    'skills/agent-excon',
  );
  environment.MCP_TIMEOUT = source.MCP_TIMEOUT ?? '30000';
  environment.MCP_TOOL_TIMEOUT = source.MCP_TOOL_TIMEOUT ?? '120000';
  environment.WISER_ROLE_SLOT_ID = role.roleSlotId;
  environment.WISER_EXPECTED_RUN_ID = source.WISER_EXPECTED_RUN_ID;
  environment.WISER_EXPECTED_RUN_AGENT_ID = role.runAgentId;
  environment.WISER_REPOSITORY_ROOT = repositoryRoot;
  environment.WISER_TEAM_ROSTER_JSON = source.WISER_TEAM_ROSTER_JSON;
  if (typeof source.WISER_SCRIPTED_FAULT === 'string') {
    environment.WISER_SCRIPTED_FAULT = source.WISER_SCRIPTED_FAULT;
  }
  return environment;
}

function collectSensitiveValues(value, values = new Set()) {
  if (value === null || typeof value !== 'object') return values;
  for (const [name, child] of Object.entries(value)) {
    if (
      sensitiveName.test(name) &&
      typeof child === 'string' &&
      child.length > 3
    ) {
      values.add(child);
    } else {
      collectSensitiveValues(child, values);
    }
  }
  return values;
}

function redactText(source, sensitiveValues) {
  let result = source;
  for (const value of sensitiveValues) {
    result = result.split(value).join('[REDACTED]');
  }
  return result;
}

export function parseWorkBuddyJson(value) {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fenced !== null) {
      try {
        return JSON.parse(fenced[1]);
      } catch {
        return undefined;
      }
    }
    const objectStart = trimmed.indexOf('{');
    const objectEnd = trimmed.lastIndexOf('}');
    if (objectStart < 0 || objectEnd <= objectStart) return undefined;
    try {
      return JSON.parse(trimmed.slice(objectStart, objectEnd + 1));
    } catch {
      return undefined;
    }
  }
}

function resultEnvelope(stdout) {
  const parsed = parseWorkBuddyJson(stdout.trim());
  if (parsed === undefined) {
    throw new Error('WorkBuddy stdout is not valid JSON.');
  }
  const history = Array.isArray(parsed) ? parsed : [parsed];
  const envelope = [...history]
    .reverse()
    .find(
      (entry) =>
        entry !== null && typeof entry === 'object' && entry.type === 'result',
    );
  if (!envelope) throw new Error('WorkBuddy did not emit a result envelope.');
  return envelope;
}

function structuredResult(envelope) {
  const candidates = [
    envelope.structured_output,
    envelope.structuredOutput,
    envelope.result,
  ];
  for (const candidate of candidates) {
    const parsed = parseWorkBuddyJson(candidate);
    if (parsed !== undefined && parsed !== null && typeof parsed === 'object') {
      return parsed;
    }
  }
  throw new Error('WorkBuddy result does not contain structured output.');
}

function validateStructuredResult(value, manifest, role) {
  if (
    value.schemaVersion !== 1 ||
    value.roleSlotId !== role.roleSlotId ||
    value.runId !== manifest.runId ||
    value.runAgentId !== role.runAgentId ||
    !['completed', 'blocked', 'failed'].includes(value.status) ||
    !(
      value.lastReceiptSeq === null ||
      (Number.isInteger(value.lastReceiptSeq) && value.lastReceiptSeq > 0)
    ) ||
    !(value.submissionId === null || typeof value.submissionId === 'string') ||
    typeof value.summary !== 'string' ||
    value.summary.length < 1 ||
    value.summary.length > 240
  ) {
    throw new Error(`Structured result is invalid for ${role.roleSlotId}.`);
  }
  return {
    roleSlotId: value.roleSlotId,
    runAgentId: value.runAgentId,
    status: value.status,
    lastReceiptSeq: value.lastReceiptSeq,
    submissionId: value.submissionId,
    summary: value.summary,
  };
}

function collectProcess(child, limits) {
  return new Promise((resolveProcess) => {
    let stdout = '';
    let stderr = '';
    let limitExceeded = false;
    let timedOut = false;
    let spawnError;
    const timer = globalThis.setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, limits.timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      if (Buffer.byteLength(stdout) > limits.maxOutputBytes) {
        limitExceeded = true;
        child.kill('SIGKILL');
      }
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
      if (Buffer.byteLength(stderr) > limits.maxOutputBytes) {
        limitExceeded = true;
        child.kill('SIGKILL');
      }
    });
    child.on('error', (error) => {
      spawnError = error;
    });
    child.on('close', (exitCode, signal) => {
      globalThis.clearTimeout(timer);
      resolveProcess({
        exitCode,
        signal,
        stdout,
        stderr,
        limitExceeded,
        timedOut,
        spawnError,
      });
    });
  });
}

function standardArguments({ mcpConfigPath, prompt, schema, maxTurns }) {
  const finalPrompt = `${prompt.trim()}\n\n# Final response contract\n\nAfter all WISER work is complete, return exactly one JSON object and no prose or Markdown. The launcher validates this schema locally; never call or search for a StructuredOutput tool.\n\n${JSON.stringify(schema, null, 2)}\n`;
  return [
    '-p',
    '--output-format',
    'json',
    '--permission-mode',
    'default',
    '--subagent-permission-mode',
    'default',
    '--tools',
    'ToolSearch,DeferExecuteTool,Skill,ListMcpResources,ReadMcpResource',
    '--allowedTools',
    'DeferExecuteTool',
    '--strict-mcp-config',
    '--mcp-config',
    mcpConfigPath,
    '--no-session-persistence',
    '--max-turns',
    String(maxTurns),
    '--effort',
    'high',
    finalPrompt,
  ];
}

async function runRole({
  manifest,
  role,
  command,
  args,
  environment,
  runtimeDirectory,
  limits,
}) {
  const mcpConfig = JSON.parse(await readFile(role.mcpConfigPath, 'utf8'));
  const sensitiveValues = collectSensitiveValues(mcpConfig);
  const child = spawn(command, args, {
    cwd: runtimeDirectory,
    env: environment,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const processResult = await collectProcess(child, limits);
  const safeStderr = redactText(processResult.stderr, sensitiveValues);
  await writeFile(role.stderrPath, safeStderr, {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600,
  });
  let record;
  try {
    if (processResult.spawnError) throw processResult.spawnError;
    if (processResult.timedOut) throw new Error('WorkBuddy timed out.');
    if (processResult.limitExceeded) {
      throw new Error('WorkBuddy output exceeded the configured limit.');
    }
    const envelope = resultEnvelope(
      redactText(processResult.stdout, sensitiveValues),
    );
    const structured = validateStructuredResult(
      structuredResult(envelope),
      manifest,
      role,
    );
    const semanticSuccess =
      envelope.subtype === 'success' &&
      envelope.is_error !== true &&
      structured.status === 'completed';
    record = {
      ...structured,
      processExitCode: processResult.exitCode,
      processSignal: processResult.signal,
      semanticSuccess,
      sessionId:
        typeof envelope.session_id === 'string' ? envelope.session_id : null,
      diagnostic:
        semanticSuccess && processResult.exitCode === 0
          ? null
          : 'WorkBuddy did not complete the participant contract.',
    };
  } catch (error) {
    record = {
      roleSlotId: role.roleSlotId,
      runAgentId: role.runAgentId,
      status: 'failed',
      lastReceiptSeq: null,
      submissionId: null,
      summary: 'No valid structured participant result was produced.',
      processExitCode: processResult.exitCode,
      processSignal: processResult.signal,
      semanticSuccess: false,
      sessionId: null,
      diagnostic: redactText(
        error instanceof Error ? error.message : 'Unknown WorkBuddy error.',
        sensitiveValues,
      ),
    };
  }
  await writeFile(role.resultPath, `${JSON.stringify(record, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600,
  });
  return record;
}

export async function launchWorkBuddyRoles(options) {
  const launchManifestPath = requireAbsolute(
    'launchManifestPath',
    options.launchManifestPath,
  );
  const repositoryRoot = requireAbsolute(
    'repositoryRoot',
    options.repositoryRoot,
  );
  const mode = options.mode;
  if (!['fake', 'scripted', 'workbuddy'].includes(mode)) {
    throw new Error('mode must be fake, scripted, or workbuddy.');
  }
  if (mode === 'workbuddy' && options.environment?.WORKBUDDY_LIVE !== '1') {
    throw new Error('Real WorkBuddy execution requires WORKBUDDY_LIVE=1.');
  }
  const runtimeDirectory = dirname(launchManifestPath);
  const manifest = JSON.parse(await readFile(launchManifestPath, 'utf8'));
  assertLaunchManifest(manifest, runtimeDirectory);
  const schema = JSON.parse(await readFile(roleResultSchemaPath, 'utf8'));
  const limits = {
    maxOutputBytes: options.maxOutputBytes ?? 1_048_576,
    timeoutMs: options.timeoutMs ?? 900_000,
  };
  const maxTurns = options.maxTurns ?? 64;
  const sourceEnvironment = options.environment ?? {};
  const commands = [];
  const executions = [];
  for (const role of manifest.roles) {
    const prompt = await readFile(role.promptPath, 'utf8');
    const commonArgs = standardArguments({
      mcpConfigPath: role.mcpConfigPath,
      prompt,
      schema,
      maxTurns,
    });
    const localDriver =
      mode === 'fake'
        ? fakeWorkBuddyPath
        : mode === 'scripted'
          ? scriptedParticipantPath
          : undefined;
    const command =
      localDriver === undefined ? manifest.workBuddyCli : process.execPath;
    const args =
      localDriver === undefined ? commonArgs : [localDriver, ...commonArgs];
    const environment = cleanEnvironment(
      {
        ...sourceEnvironment,
        WISER_EXPECTED_RUN_ID: manifest.runId,
        WISER_TEAM_ROSTER_JSON: JSON.stringify(
          manifest.roles.map(({ roleSlotId, runAgentId }) => ({
            roleSlotId,
            runAgentId,
          })),
        ),
      },
      role,
      repositoryRoot,
    );
    commands.push({
      roleSlotId: role.roleSlotId,
      command,
      args,
      cwd: runtimeDirectory,
    });
    executions.push(
      runRole({
        manifest,
        role,
        command,
        args,
        environment,
        runtimeDirectory,
        limits,
      }),
    );
  }
  const results = await Promise.all(executions);
  const report = {
    schemaVersion: 1,
    profile: mode === 'workbuddy' ? 'workbuddy-live-tdd' : 'scripted-ci',
    protocolVersion: 'v2',
    runId: manifest.runId,
    scenarioVersionId: manifest.scenarioVersionId,
    status: results.every(
      (result) => result.semanticSuccess && result.processExitCode === 0,
    )
      ? 'passed'
      : 'failed',
    results,
  };
  const reportPath = join(runtimeDirectory, 'results', 'run-report.json');
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600,
  });
  return {
    exitCode: report.status === 'passed' ? 0 : 1,
    report,
    reportPath,
    commands,
  };
}
