import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const specialistPayloads = {
  'water-evidence': {
    evidenceRegister: [{}, {}, {}],
    inflowSummary: {},
    evidenceRefs: ['stage-1-case-input'],
  },
  'hydraulic-constraints': {
    sectionResponse: [{}, {}, {}, {}],
    constraints: {},
    evidenceRefs: ['stage-1-case-input'],
  },
  'ecological-target': {
    targetRegister: [{}, {}, {}, {}],
    riskPriorities: [{}],
    evidenceRefs: ['stage-1-case-input'],
  },
};

const artifactKeys = {
  'water-evidence': 'water-evidence-register',
  'hydraulic-constraints': 'hydraulic-constraint-envelope',
  'ecological-target': 'ecological-priority-register',
};

function requiredEnvironment(name) {
  const value = process.env[name];
  if (typeof value !== 'string' || value === '') {
    throw new Error(`Missing required ${name}.`);
  }
  return value;
}

function commandArgument(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || typeof process.argv[index + 1] !== 'string') {
    throw new Error(`Missing ${name}.`);
  }
  return process.argv[index + 1];
}

function assertMcpConfiguration(value) {
  const entries =
    value !== null && typeof value === 'object'
      ? Object.entries(value.mcpServers ?? {})
      : [];
  if (entries.length !== 1 || entries[0][0] !== 'agent-excon') {
    throw new Error(
      'Scripted participant requires exactly one agent-excon MCP.',
    );
  }
  const server = entries[0][1];
  if (
    server === null ||
    typeof server !== 'object' ||
    server.type !== 'stdio' ||
    typeof server.command !== 'string' ||
    !isAbsolute(server.command) ||
    !Array.isArray(server.args) ||
    server.args.some((argument) => typeof argument !== 'string') ||
    server.env === null ||
    typeof server.env !== 'object'
  ) {
    throw new Error('agent-excon MCP configuration is invalid.');
  }
  return server;
}

async function connectMcp(repositoryRoot, configPath) {
  const configuration = JSON.parse(await readFile(configPath, 'utf8'));
  const server = assertMcpConfiguration(configuration);
  const requireFromMcp = createRequire(
    join(repositoryRoot, 'apps/mcp/package.json'),
  );
  const [{ Client }, { StdioClientTransport }] = await Promise.all([
    import(
      pathToFileURL(
        requireFromMcp.resolve('@modelcontextprotocol/sdk/client/index.js'),
      ).href
    ),
    import(
      pathToFileURL(
        requireFromMcp.resolve('@modelcontextprotocol/sdk/client/stdio.js'),
      ).href
    ),
  ]);
  const transport = new StdioClientTransport({
    command: server.command,
    args: server.args,
    env: {
      ...(typeof process.env.HOME === 'string'
        ? { HOME: process.env.HOME }
        : {}),
      ...(typeof process.env.PATH === 'string'
        ? { PATH: process.env.PATH }
        : {}),
      ...server.env,
    },
    cwd: repositoryRoot,
    stderr: 'pipe',
    maxBufferSize: 1_048_576,
  });
  transport.stderr?.resume();
  const client = new Client(
    { name: 'wiser-scripted-participant', version: '0.1.0' },
    { capabilities: {} },
  );
  await client.connect(transport);
  return { client, transport };
}

async function tool(client, name, args) {
  const result = await client.callTool({ name, arguments: args });
  const structured = result.structuredContent;
  if (
    structured === null ||
    typeof structured !== 'object' ||
    structured.ok !== true ||
    structured.data === undefined
  ) {
    const code =
      structured !== null &&
      typeof structured === 'object' &&
      structured.error !== null &&
      typeof structured.error === 'object' &&
      typeof structured.error.code === 'string'
        ? structured.error.code
        : 'MCP_TOOL_FAILED';
    throw new Error(`${name} failed with ${code}.`);
  }
  return structured.data;
}

async function sync(client, identity, cursor) {
  return tool(client, 'excon_sync', {
    ...identity,
    idempotencyKey: randomUUID(),
    afterReceiptSeq: cursor?.throughReceiptSeq ?? 0,
    ...(cursor === undefined || cursor.throughReceiptSeq === 0
      ? {}
      : {
          ack: {
            throughReceiptSeq: cursor.throughReceiptSeq,
            headHash: cursor.receiptHeadHash,
          },
        }),
    maxItems: 50,
  });
}

function receipt(batch, resourceType, predicate = () => true) {
  return batch.receipts?.find(
    (entry) => entry.resourceType === resourceType && predicate(entry),
  );
}

function receiptSnapshots(batches, resourceType) {
  return batches.flatMap((batch) =>
    (batch.receipts ?? [])
      .filter((entry) => entry.resourceType === resourceType)
      .map((entry) => entry.contentSnapshot),
  );
}

async function pause(milliseconds) {
  await new Promise((resolvePause) =>
    globalThis.setTimeout(resolvePause, milliseconds),
  );
}

async function waitForSync(client, identity, initialCursor, predicate) {
  let cursor = initialCursor;
  const batches = [];
  for (let attempt = 0; attempt < 240; attempt += 1) {
    cursor = await sync(client, identity, cursor);
    batches.push(cursor);
    if (await predicate({ cursor, batches })) return { cursor, batches };
    await pause(100);
  }
  throw new Error('Scripted participant exhausted its sync retry budget.');
}

async function claimAndBegin(client, identity, task) {
  const claim = await tool(client, 'excon_claim_task', {
    taskId: task.id,
    runAgentId: identity.runAgentId,
    idempotencyKey: randomUUID(),
    expectedVersion: task.lockVersion,
    leaseSeconds: 120,
  });
  const begun = await tool(client, 'excon_begin_task', {
    taskId: task.id,
    runAgentId: identity.runAgentId,
    idempotencyKey: randomUUID(),
    expectedVersion: claim.task.lockVersion,
    claimEpoch: claim.lease.claimEpoch,
    leaseToken: claim.lease.leaseToken,
  });
  return { claim, begunTask: begun.task };
}

async function runSpecialist(client, context) {
  const { identity, roleSlotId, roster } = context;
  const coordinator = roster.find(
    (entry) => entry.roleSlotId === 'dispatch-coordination',
  );
  if (coordinator === undefined) throw new Error('Coordinator is missing.');
  const initial = await sync(client, identity);
  await Promise.all([
    tool(client, 'excon_list_tasks', identity),
    tool(client, 'excon_list_artifacts', identity),
  ]);
  const taskReceipt = receipt(initial, 'task');
  const caseInputReceipt = receipt(
    initial,
    'artifact',
    (entry) => entry.contentSnapshot.artifactType === 'case-input',
  );
  if (taskReceipt === undefined || caseInputReceipt === undefined) {
    throw new Error('Initial specialist resources are incomplete.');
  }
  const task = taskReceipt.contentSnapshot;
  const { claim, begunTask } = await claimAndBegin(client, identity, task);
  const payload = specialistPayloads[roleSlotId];
  const artifactKey = artifactKeys[roleSlotId];
  const published = await tool(client, 'excon_publish_artifact', {
    ...identity,
    idempotencyKey: randomUUID(),
    artifactKey,
    artifactType: 'role-analysis',
    title: {
      'zh-CN': `${roleSlotId} 脚本输出`,
      en: `${roleSlotId} scripted output`,
    },
    content: payload,
    recipientRunAgentIds: [identity.runAgentId, coordinator.runAgentId],
  });
  let cursor = await sync(client, identity, initial);
  const submitted = await tool(client, 'excon_submit_task_result', {
    taskId: task.id,
    runAgentId: identity.runAgentId,
    idempotencyKey: randomUUID(),
    expectedVersion: begunTask.lockVersion,
    claimEpoch: claim.lease.claimEpoch,
    leaseToken: claim.lease.leaseToken,
    submissionType: artifactKey,
    targetScope: 'role',
    payload,
    receiptRefs: [
      {
        receiptId: caseInputReceipt.id,
        receiptHash: caseInputReceipt.receiptHash,
      },
    ],
    artifactVersionRefs: [
      {
        artifactId: published.artifact.id,
        artifactVersionId: published.artifact.versionId,
        contentHash: published.artifact.contentHash,
      },
    ],
    endorsementRecipientRunAgentIds: [],
  });
  if (submitted.task.state !== 'ACCEPTED') {
    throw new Error('Specialist deterministic evaluation did not accept.');
  }

  const review = await waitForSync(
    client,
    identity,
    cursor,
    async ({ batches }) => {
      const submissions = receiptSnapshots(batches, 'submission');
      const feedback = receiptSnapshots(batches, 'feedback');
      return (
        submissions.some((entry) => entry.targetScope === 'team') &&
        feedback.some((entry) => entry.allowedActions?.includes('endorse'))
      );
    },
  );
  cursor = review.cursor;
  const [submissionList, feedbackList] = await Promise.all([
    tool(client, 'excon_list_submissions', identity),
    tool(client, 'excon_get_feedback', identity),
  ]);
  const teamSubmission = submissionList.items.find(
    (entry) => entry.targetScope === 'team',
  );
  const feedback = feedbackList.items.find(
    (entry) =>
      entry.subjectSubmissionId === teamSubmission?.id &&
      entry.allowedActions?.includes('endorse'),
  );
  const grant = feedback?.actionGrants?.find(
    (entry) => entry.action === 'endorse',
  );
  if (teamSubmission === undefined || grant === undefined) {
    throw new Error('Exact team submission endorsement grant is unavailable.');
  }
  await tool(client, 'excon_endorse_submission', {
    submissionId: teamSubmission.id,
    runAgentId: identity.runAgentId,
    idempotencyKey: randomUUID(),
    feedbackActionGrantId: grant.id,
  });
  return {
    lastReceiptSeq: cursor.throughReceiptSeq,
    submissionId: submitted.submission.id,
  };
}

async function runCoordinator(client, context) {
  const { identity, roster } = context;
  const initial = await sync(client, identity);
  const caseInputReceipt = receipt(
    initial,
    'artifact',
    (entry) => entry.contentSnapshot.artifactType === 'case-input',
  );
  if (caseInputReceipt === undefined) {
    throw new Error('Coordinator case input is unavailable.');
  }
  const released = await waitForSync(
    client,
    identity,
    initial,
    async ({ batches }) => {
      const tasks = receiptSnapshots(batches, 'task');
      const artifacts = receiptSnapshots(batches, 'artifact');
      return (
        tasks.some((entry) => entry.state === 'READY') &&
        artifacts.filter((entry) => entry.artifactType === 'role-analysis')
          .length >= 3
      );
    },
  );
  let cursor = released.cursor;
  const [taskList, artifactList] = await Promise.all([
    tool(client, 'excon_list_tasks', identity),
    tool(client, 'excon_list_artifacts', identity),
  ]);
  const task = taskList.items.find((entry) => entry.state === 'READY');
  const specialistArtifacts = artifactList.items.filter(
    (entry) => entry.artifactType === 'role-analysis',
  );
  if (task === undefined || specialistArtifacts.length !== 3) {
    throw new Error('Coordinator release resources are incomplete.');
  }
  const { claim, begunTask } = await claimAndBegin(client, identity, task);
  const teamPayload = {
    candidatePlan: { stage: 1, simulationOnly: true },
    artifactVersionRefs: specialistArtifacts.map((entry) =>
      String(entry.versionId),
    ),
    evidenceRefs: [caseInputReceipt.id],
  };
  const teamArtifact = await tool(client, 'excon_publish_artifact', {
    ...identity,
    idempotencyKey: randomUUID(),
    artifactKey: 'candidate-joint-plan',
    artifactType: 'team-plan',
    title: { 'zh-CN': 'Stage 1 团队方案', en: 'Stage 1 team plan' },
    content: teamPayload,
    recipientRunAgentIds: roster.map(({ runAgentId }) => runAgentId),
  });
  cursor = await sync(client, identity, cursor);
  const submission = await tool(client, 'excon_submit_task_result', {
    taskId: task.id,
    runAgentId: identity.runAgentId,
    idempotencyKey: randomUUID(),
    expectedVersion: begunTask.lockVersion,
    claimEpoch: claim.lease.claimEpoch,
    leaseToken: claim.lease.leaseToken,
    submissionType: 'candidate-joint-plan',
    targetScope: 'team',
    payload: teamPayload,
    receiptRefs: [
      {
        receiptId: caseInputReceipt.id,
        receiptHash: caseInputReceipt.receiptHash,
      },
    ],
    artifactVersionRefs: [
      ...specialistArtifacts.map((artifact) => ({
        artifactId: artifact.id,
        artifactVersionId: artifact.versionId,
        contentHash: artifact.contentHash,
      })),
      {
        artifactId: teamArtifact.artifact.id,
        artifactVersionId: teamArtifact.artifact.versionId,
        contentHash: teamArtifact.artifact.contentHash,
      },
    ],
    endorsementRecipientRunAgentIds: roster
      .filter(({ roleSlotId }) => roleSlotId !== 'dispatch-coordination')
      .map(({ runAgentId }) => runAgentId),
  });
  const final = await waitForSync(
    client,
    identity,
    cursor,
    async ({ batches }) => {
      const tasks = receiptSnapshots(batches, 'task');
      const feedback = receiptSnapshots(batches, 'feedback');
      return (
        tasks.some((entry) => entry.state === 'ACCEPTED') &&
        feedback.some((entry) => entry.targetScope === 'team')
      );
    },
  );
  return {
    lastReceiptSeq: final.cursor.throughReceiptSeq,
    submissionId: submission.submission.id,
  };
}

export async function runScriptedParticipant() {
  const repositoryRoot = requiredEnvironment('WISER_REPOSITORY_ROOT');
  const roleSlotId = requiredEnvironment('WISER_ROLE_SLOT_ID');
  const runId = requiredEnvironment('WISER_EXPECTED_RUN_ID');
  const runAgentId = requiredEnvironment('WISER_EXPECTED_RUN_AGENT_ID');
  const roster = JSON.parse(requiredEnvironment('WISER_TEAM_ROSTER_JSON'));
  if (
    !isAbsolute(repositoryRoot) ||
    !Array.isArray(roster) ||
    roster.length !== 4 ||
    !roster.some(
      (entry) =>
        entry.roleSlotId === roleSlotId && entry.runAgentId === runAgentId,
    )
  ) {
    throw new Error('Scripted participant bootstrap is invalid.');
  }
  const identity = { runId, runAgentId };
  const { client, transport } = await connectMcp(
    repositoryRoot,
    commandArgument('--mcp-config'),
  );
  try {
    const assignment = await tool(client, 'excon_get_assignment', identity);
    if (
      assignment.runAgent?.id !== runAgentId ||
      assignment.roleAssignment?.roleSlotId !== roleSlotId
    ) {
      throw new Error('MCP assignment does not match trusted bootstrap.');
    }
    const result =
      roleSlotId === 'dispatch-coordination'
        ? await runCoordinator(client, { identity, roleSlotId, roster })
        : await runSpecialist(client, { identity, roleSlotId, roster });
    return {
      schemaVersion: 1,
      roleSlotId,
      runId,
      runAgentId,
      status: 'completed',
      ...result,
      summary: `Scripted ${roleSlotId} completed the authoritative WISER flow.`,
    };
  } finally {
    await Promise.allSettled([client.close(), transport.close()]);
  }
}

async function main() {
  const roleSlotId = process.env.WISER_ROLE_SLOT_ID ?? 'unknown-role';
  const runId = process.env.WISER_EXPECTED_RUN_ID ?? randomUUID();
  const runAgentId = process.env.WISER_EXPECTED_RUN_AGENT_ID ?? randomUUID();
  let structured;
  let success = false;
  try {
    structured = await runScriptedParticipant();
    success = true;
  } catch {
    structured = {
      schemaVersion: 1,
      roleSlotId,
      runId,
      runAgentId,
      status: 'failed',
      lastReceiptSeq: null,
      submissionId: null,
      summary:
        'Scripted participant failed; inspect the sanitized runner diagnostic.',
    };
    process.stderr.write(`Scripted ${roleSlotId} participant failed.\n`);
    process.exitCode = 1;
  }
  process.stdout.write(
    `${JSON.stringify([
      {
        type: 'result',
        subtype: success ? 'success' : 'error_during_execution',
        is_error: !success,
        session_id: `scripted-${roleSlotId}`,
        result: JSON.stringify(structured),
      },
    ])}\n`,
  );
}

void main();
