#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const skillRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function read(relativePath) {
  return readFile(resolve(skillRoot, relativePath), 'utf8');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function includesAll(source, values, label) {
  for (const value of values) {
    assert(
      source.includes(value),
      `${label} is missing ${JSON.stringify(value)}`,
    );
  }
}

try {
  const [
    skill,
    interaction,
    evidence,
    feedback,
    yongding,
    compatibility,
    openai,
    validator,
    evalSource,
  ] = await Promise.all([
    read('SKILL.md'),
    read('references/interaction-protocol.md'),
    read('references/evidence-rules.md'),
    read('references/feedback-and-errors.md'),
    read('references/yongding-allocation.md'),
    read('references/v1-compatibility.md'),
    read('agents/openai.yaml'),
    read('scripts/validate-allocation-plan.mjs'),
    read('evals/evals.json'),
  ]);

  assert(skill.split('\n').length < 500, 'SKILL.md must stay below 500 lines');
  const frontmatter = /^---\nname: ([^\n]+)\ndescription: ([^\n]+)\n---\n/.exec(
    skill,
  );
  assert(
    frontmatter !== null,
    'SKILL.md frontmatter must contain name and description',
  );
  assert(
    frontmatter[1] === 'agent-excon',
    'frontmatter name must match the folder',
  );
  assert(
    frontmatter[2].length > 0 &&
      frontmatter[2].length <= 1_024 &&
      !/[<>]/.test(frontmatter[2]),
    'frontmatter description must be non-empty, <=1024 chars, and contain no angle brackets',
  );
  includesAll(
    skill,
    [
      'protocolVersion',
      'runAgentId',
      'afterReceiptSeq',
      'ArtifactVersion',
      'excon_list_submissions',
      'feedbackActionGrantId',
      'Barrier',
      'v1-compatibility.md',
    ],
    'SKILL.md',
  );

  includesAll(
    interaction,
    [
      'GET /api/v2/runs/{runId}/me',
      'POST /api/v2/runs/{runId}/sync',
      'GET /api/v2/runs/{runId}/tasks',
      'POST /api/v2/tasks/{taskId}:claim',
      'POST /api/v2/tasks/{taskId}:begin',
      'POST /api/v2/tasks/{taskId}:heartbeat',
      'POST /api/v2/runs/{runId}/messages',
      'POST /api/v2/runs/{runId}/artifacts',
      'POST /api/v2/tasks/{taskId}/submissions',
      'GET /api/v2/runs/{runId}/submissions',
      'excon_list_submissions',
      'POST /api/v2/submissions/{submissionId}/endorsements',
      'GET /api/v2/runs/{runId}/feedback',
      'GET /api/v2/runs/{runId}/replay',
      'recipientRunAgentIds',
      'baseVersionId',
      'receiptRefs',
      'artifactVersionRefs',
      'revisionOfId',
      'feedbackActionGrantId',
      'X-Run-Agent-Id',
      'Idempotency-Key',
    ],
    'interaction protocol',
  );
  assert(
    /only[^\n]*new[^\n]*(content|resource)|唯一[^\n]*新内容/i.test(interaction),
    'interaction protocol must identify /sync as the only new-content entry',
  );

  includesAll(
    evidence,
    [
      'AgentViewReceipt',
      'ArtifactVersion',
      'contentHash',
      'agentReceiptSeq',
      'issued',
      'acknowledged',
      'resourceType: submission',
      'excon_list_submissions',
    ],
    'evidence rules',
  );
  includesAll(
    feedback,
    [
      'individual',
      'role',
      'team',
      'feedbackActionGrantId',
      'RECEIPT_CURSOR_CONFLICT',
      'RECEIPT_CHAIN_CONFLICT',
      'RESOURCE_NOT_ISSUED',
      'TASK_LEASE_STALE',
      'ARTIFACT_BASE_CONFLICT',
      'FEEDBACK_GRANT_SCOPE_MISMATCH',
      'excon_list_submissions',
      'IDEMPOTENCY_CONFLICT',
      'FORBIDDEN',
    ],
    'feedback and errors',
  );
  includesAll(
    yongding,
    [
      '水情与证据智能体',
      '水动力约束智能体',
      '生态目标智能体',
      '调度协调智能体',
    ],
    'Yongding progressive reference',
  );
  includesAll(
    compatibility,
    ['/api/v1/', 'Episode', 'Observation', 'excon_start_episode'],
    'v1 compatibility fallback',
  );

  const genericV2Docs = [skill, interaction, evidence, feedback].join('\n');
  const v2EvidenceDocs = [genericV2Docs, yongding, openai].join('\n');
  assert(
    !/\bepisode\b|\bobservation(?:s)?\b/i.test(v2EvidenceDocs),
    'Episode/Observation vocabulary must remain isolated in v1-compatibility.md',
  );
  assert(
    !interaction.includes('/api/v2/runs/{runId}:advance'),
    'the RunAgent protocol must not expose a global clock-advance command',
  );
  assert(
    !/otherwise cross-check|if the negotiated contract exposes/i.test(
      interaction,
    ),
    'Submission review must not retain the missing-endpoint fallback',
  );
  for (const role of [
    '水情与证据智能体',
    '水动力约束智能体',
    '生态目标智能体',
    '调度协调智能体',
  ]) {
    assert(
      !genericV2Docs.includes(role),
      `scenario role ${role} must not be hard-coded in the generic Skill`,
    );
  }

  includesAll(
    validator,
    ['Receipt', 'ArtifactVersion'],
    'allocation role validator',
  );
  includesAll(
    openai,
    ['multi-agent', 'sync', 'Receipt'],
    'OpenAI interface metadata',
  );

  const evals = JSON.parse(evalSource);
  assert(evals.skill_name === 'agent-excon', 'eval skill_name must match');
  assert(
    Array.isArray(evals.evals) &&
      evals.evals.length >= 3 &&
      evals.evals.length <= 4,
    'evals.json must contain 3-4 realistic evals',
  );
  const ids = new Set();
  for (const evaluation of evals.evals) {
    assert(Number.isInteger(evaluation.id), 'each eval needs an integer id');
    assert(!ids.has(evaluation.id), `duplicate eval id ${evaluation.id}`);
    ids.add(evaluation.id);
    assert(
      typeof evaluation.prompt === 'string' && evaluation.prompt.length >= 80,
      `eval ${evaluation.id} prompt is not realistic enough`,
    );
    assert(
      typeof evaluation.expected_output === 'string' &&
        evaluation.expected_output.length >= 30,
      `eval ${evaluation.id} needs an expected output`,
    );
    assert(
      Array.isArray(evaluation.files),
      `eval ${evaluation.id} needs files`,
    );
    assert(
      Array.isArray(evaluation.expectations) &&
        evaluation.expectations.length >= 4 &&
        evaluation.expectations.every(
          (expectation) =>
            typeof expectation === 'string' && expectation.length >= 20,
        ),
      `eval ${evaluation.id} needs objective expectations`,
    );
  }
  const endorsementEvaluation = evals.evals.find(
    (evaluation) => evaluation.id === 3,
  );
  assert(
    endorsementEvaluation?.expectations.some((expectation) =>
      expectation.includes('excon_list_submissions'),
    ),
    'endorsement eval must require receipt-gated Submission recovery',
  );

  process.stdout.write(
    `${JSON.stringify({ valid: true, checks: 9, evals: evals.evals.length })}\n`,
  );
} catch (error) {
  process.stderr.write(
    `${JSON.stringify({
      valid: false,
      error: error instanceof Error ? error.message : String(error),
    })}\n`,
  );
  process.exitCode = 1;
}
