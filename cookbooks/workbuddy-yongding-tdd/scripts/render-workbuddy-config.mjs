import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const roles = [
  'water-evidence',
  'hydraulic-constraints',
  'ecological-target',
  'dispatch-coordination',
];
const cookbookRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function requireAbsolute(name, value) {
  if (typeof value !== 'string' || !isAbsolute(value)) {
    throw new Error(`${name} must be an absolute path.`);
  }
  return value;
}

function parseEnv(source) {
  const values = {};
  for (const line of source.split(/\r?\n/)) {
    if (line === '') continue;
    const separator = line.indexOf('=');
    if (separator < 1)
      throw new Error('Credential env contains an invalid line.');
    const name = line.slice(0, separator);
    const value = line.slice(separator + 1);
    if (values[name] !== undefined) {
      throw new Error(`Credential env duplicates ${name}.`);
    }
    values[name] = value;
  }
  const expected = [
    'AGENT_EXCON_PROTOCOL_VERSION',
    'AGENT_EXCON_API_URL',
    'AGENT_EXCON_API_KEY',
    'WISER_RUN_ID',
    'WISER_RUN_AGENT_ID',
    'WISER_ROLE_SLOT_ID',
  ];
  if (
    Object.keys(values).some((name) => !expected.includes(name)) ||
    expected.some((name) => typeof values[name] !== 'string')
  ) {
    throw new Error('Credential env does not match the local lab contract.');
  }
  return values;
}

function assertManifest(value) {
  if (
    value === null ||
    typeof value !== 'object' ||
    value.schemaVersion !== 1 ||
    value.profile !== 'ephemeral-local-tdd' ||
    value.protocolVersion !== 'v2' ||
    value.runState !== 'RUNNING' ||
    !Array.isArray(value.roster) ||
    value.roster.length !== 4 ||
    value.roster.some(
      (entry, index) =>
        entry === null ||
        typeof entry !== 'object' ||
        entry.roleSlotId !== roles[index] ||
        typeof entry.runAgentId !== 'string' ||
        typeof entry.credentialEnvFile !== 'string',
    )
  ) {
    throw new Error('Lab manifest does not match the four-agent v2 contract.');
  }
}

function credentialPath(manifestPath, relativePath) {
  const runtimeDirectory = dirname(manifestPath);
  const credentialsDirectory = resolve(runtimeDirectory, 'credentials');
  const candidate = resolve(runtimeDirectory, relativePath);
  const relation = relative(credentialsDirectory, candidate);
  if (relation.startsWith('..') || isAbsolute(relation)) {
    throw new Error(
      'Credential path escapes the private credentials directory.',
    );
  }
  return candidate;
}

function rolePrompt({ manifest, role, roleInstructions }) {
  const publicRoster = manifest.roster.map(({ roleSlotId, runAgentId }) => ({
    roleSlotId,
    runAgentId,
  }));
  const finalTemplate = {
    schemaVersion: 1,
    roleSlotId: role.roleSlotId,
    runId: manifest.runId,
    runAgentId: role.runAgentId,
    status: 'completed',
    lastReceiptSeq: null,
    submissionId: null,
    summary: `${role.roleSlotId} completed the WISER role obligation.`,
  };
  return `# WISER WorkBuddy participant assignment

Act as exactly one external RunAgent. The \`agent-excon\` Skill directory is already injected into this session and the complete live execution order is repeated below. Do not call \`Read\`, Bash, a browser, or any repository tool to load instructions. Before the first use of every named \`excon_*\` tool, call \`ToolSearch\` with that exact tool name, then invoke the returned \`agent-excon\` tool through the approved deferred executor. Keep a discovered tool available for later repeated calls; one broad search is not a substitute for exact first-use discovery.

Trusted bootstrap:

\`\`\`json
${JSON.stringify(
  {
    protocolVersion: 'v2',
    scenarioVersionId: manifest.scenarioVersionId,
    runId: manifest.runId,
    runAgentId: role.runAgentId,
    roleSlotId: role.roleSlotId,
    teamRoster: publicRoster,
  },
  null,
  2,
)}
\`\`\`

## Non-negotiable execution order

Do not reorder or skip these phases. Machine fields come from the latest structured MCP result, never from prose.

1. **Identity gate.** Call \`excon_get_assignment\` with the trusted \`runId\` and \`runAgentId\`. Stop unless \`runAgent.id\`, \`runAgent.runId\`, and \`roleAssignment.roleSlotId\` exactly match the bootstrap.
2. **Delivery gate.** Call \`excon_sync\` with \`afterReceiptSeq=0\`, a fresh UUID idempotency key, and \`maxItems=8\` so Message/Artifact snapshots remain below the MCP response limit. Persist the returned \`throughReceiptSeq\` and \`receiptHeadHash\`; while \`hasMore=true\`, continue with the returned cursor and exact prior ack before doing work. Then call \`excon_list_tasks\` and \`excon_list_artifacts\`; recovery reads alone never issue content.
3. **Lease gate.** Select only this role's issued Task. If it is \`BLOCKED\`, call \`excon_wait_and_sync\` with \`waitSeconds=15\` and the exact prior ack until a new Receipt shows it \`READY\`; do not claim a blocked Task. Once \`READY\`, call \`excon_claim_task\` with its numeric \`lockVersion\` and \`leaseSeconds=300\`, then \`excon_begin_task\` with the returned Task version, \`claimEpoch\`, and opaque \`leaseToken\`. You must not publish a Message or Artifact before \`excon_begin_task\` succeeds.
4. **Evidence and explicit handoff.** Use only the issued case-input Receipt and authorized ArtifactVersions. Validate the issued Task output schema. Call \`excon_publish_artifact\` with explicit recipients. A specialist must then call \`excon_post_message\` with \`kind=handoff\`, the coordinator as recipient, and the exact new \`artifactVersionRefs\`; a coordinator must wait until all three such handoffs are receipted before using their artifacts. Call \`excon_sync\` with the exact previous ack so your own ArtifactVersion is receipted. Before submission, call \`excon_heartbeat_task\` with the current Task version, the same \`claimEpoch\`/\`leaseToken\`, and \`extendBySeconds=300\`; use the heartbeat response's new Task \`lockVersion\`.
5. **Immutable submission.** Call \`excon_submit_task_result\` with the heartbeat response's latest \`lockVersion\`, the live \`claimEpoch\`/\`leaseToken\`, exact case-input \`receiptRefs\`, exact ArtifactVersion references, the assigned target scope, and the required endorsement recipients. Do not continue to the team-wait phase until the returned Task is \`ACCEPTED\` or you have processed a scoped rework grant.
6. **Scoped rework.** On \`REWORK_REQUIRED\`, sync Feedback, recover it with \`excon_get_feedback\`, append a corrected immutable ArtifactVersion, post a new \`handoff\` Message for that successor version, re-claim/re-begin the READY Task, and submit a successor carrying both \`revisionOfId\` and the matching \`feedbackActionGrantId\`. Never overwrite revision 1 or leave the coordinator pointing at a superseded version.
7. **Bidirectional team review.** After the three specialist handoffs converge, the coordinator publishes the pinned team ArtifactVersion and posts one \`kind=request\` Message to all three specialists with that exact ArtifactVersion reference. Each specialist must receive the request through its own \`excon_sync\`, then post one \`kind=response\` with \`replyToMessageId\` equal to that request and the coordinator in the recipient snapshot. A response never substitutes for endorsement. The specialist must still receive the exact team Submission and endorsement Feedback, recover the revision, and call \`excon_endorse_submission\` only with its matching grant. The coordinator must receive all three responses, authoritative team Feedback, and an \`ACCEPTED\` Task Receipt. Use at most 24 bounded \`excon_wait_and_sync\` calls and never release a Barrier yourself.
8. **Final response.** Return the launcher JSON only after the role obligation above is complete. Use the latest Receipt sequence, your accepted Submission ID, and \`status=completed\`. If a stable error or the bounded wait budget is exhausted, return \`blocked\` or \`failed\`; do not claim success.

${roleInstructions.trim()}

## Exact final JSON template

Copy this exact object shape for the final answer. Preserve the four identity fields exactly. Replace each \`null\` only when the corresponding positive Receipt sequence or accepted Submission UUID is known; otherwise leave it \`null\`. Keep the summary under 240 characters. Return the object without a code fence.

\`\`\`json
${JSON.stringify(finalTemplate, null, 2)}
\`\`\`

Hard boundaries:

- Reconcile \`/me\` against the trusted bootstrap before processing content.
- New content arrives only through \`excon_sync\`; recovery GETs never issue eligible content.
- Do not use a browser, operator API, PostgreSQL, repository fixtures, another role's MCP, or v1 fallback.
- Share business content only through WISER Message and immutable ArtifactVersion. Do not use WorkBuddy side channels for case facts.
- Keep credentials and lease tokens out of final output. Return only the structured result required by the launcher.
- Stop on identity mismatch, Receipt-chain conflict, exhausted recovery, or a stable operator-action error.
`;
}

export async function renderWorkBuddyRuntime(options) {
  const labManifestPath = requireAbsolute(
    'labManifestPath',
    options.labManifestPath,
  );
  const nodeExecutable = requireAbsolute(
    'nodeExecutable',
    options.nodeExecutable,
  );
  const outputDirectory = requireAbsolute(
    'outputDirectory',
    options.outputDirectory,
  );
  const repositoryRoot = requireAbsolute(
    'repositoryRoot',
    options.repositoryRoot,
  );
  const workBuddyCli = requireAbsolute('workBuddyCli', options.workBuddyCli);
  const mcpCommand =
    options.mcpCommand === undefined
      ? nodeExecutable
      : requireAbsolute('mcpCommand', options.mcpCommand);
  const mcpArguments =
    options.mcpArguments === undefined
      ? [join(repositoryRoot, 'apps/mcp/dist/index.js')]
      : [...options.mcpArguments];
  if (
    mcpArguments.length === 0 ||
    mcpArguments.some((argument) => typeof argument !== 'string')
  ) {
    throw new Error('mcpArguments must contain at least one string.');
  }
  const manifest = JSON.parse(await readFile(labManifestPath, 'utf8'));
  assertManifest(manifest);

  try {
    await mkdir(outputDirectory, { mode: 0o700 });
  } catch (error) {
    if (error?.code === 'EEXIST') {
      throw new Error('outputDirectory must not already exist.', {
        cause: error,
      });
    }
    throw error;
  }

  try {
    const mcpDirectory = join(outputDirectory, 'mcp');
    const promptsDirectory = join(outputDirectory, 'prompts');
    const resultsDirectory = join(outputDirectory, 'results');
    await Promise.all([
      mkdir(mcpDirectory, { mode: 0o700 }),
      mkdir(promptsDirectory, { mode: 0o700 }),
      mkdir(resultsDirectory, { mode: 0o700 }),
    ]);
    const renderedRoles = [];
    for (const role of manifest.roster) {
      const envPath = credentialPath(labManifestPath, role.credentialEnvFile);
      const env = parseEnv(await readFile(envPath, 'utf8'));
      if (
        env.AGENT_EXCON_PROTOCOL_VERSION !== 'v2' ||
        env.WISER_RUN_ID !== manifest.runId ||
        env.WISER_RUN_AGENT_ID !== role.runAgentId ||
        env.WISER_ROLE_SLOT_ID !== role.roleSlotId
      ) {
        throw new Error(`Credential identity mismatch for ${role.roleSlotId}.`);
      }
      const mcpConfigPath = join(mcpDirectory, `${role.roleSlotId}.json`);
      const mcpConfig = {
        mcpServers: {
          'agent-excon': {
            type: 'stdio',
            command: mcpCommand,
            args: mcpArguments,
            env: {
              AGENT_EXCON_PROTOCOL_VERSION: env.AGENT_EXCON_PROTOCOL_VERSION,
              AGENT_EXCON_API_URL: env.AGENT_EXCON_API_URL,
              AGENT_EXCON_API_KEY: env.AGENT_EXCON_API_KEY,
            },
          },
        },
      };
      await writeFile(
        mcpConfigPath,
        `${JSON.stringify(mcpConfig, null, 2)}\n`,
        {
          encoding: 'utf8',
          flag: 'wx',
          mode: 0o600,
        },
      );
      const roleInstructions = await readFile(
        join(cookbookRoot, 'roles', `${role.roleSlotId}.md`),
        'utf8',
      );
      const promptPath = join(promptsDirectory, `${role.roleSlotId}.md`);
      await writeFile(
        promptPath,
        rolePrompt({ manifest, role, roleInstructions }),
        { encoding: 'utf8', flag: 'wx', mode: 0o600 },
      );
      renderedRoles.push({
        roleSlotId: role.roleSlotId,
        runAgentId: role.runAgentId,
        mcpConfigPath,
        promptPath,
        resultPath: join(resultsDirectory, `${role.roleSlotId}.json`),
        stderrPath: join(resultsDirectory, `${role.roleSlotId}.stderr.log`),
      });
    }
    const publicManifest = {
      schemaVersion: 1,
      profile: 'workbuddy-four-process',
      protocolVersion: 'v2',
      workBuddyCli,
      runId: manifest.runId,
      scenarioVersionId: manifest.scenarioVersionId,
      roles: renderedRoles,
    };
    const launchManifestPath = join(outputDirectory, 'launch-manifest.json');
    await writeFile(
      launchManifestPath,
      `${JSON.stringify(publicManifest, null, 2)}\n`,
      { encoding: 'utf8', flag: 'wx', mode: 0o600 },
    );
    return {
      ...publicManifest,
      outputDirectory,
      launchManifestPath,
    };
  } catch (error) {
    await rm(outputDirectory, { force: true, recursive: true });
    throw error;
  }
}
