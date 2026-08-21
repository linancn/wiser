#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const skillRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

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

async function read(relativePath) {
  return readFile(resolve(skillRoot, relativePath), 'utf8');
}

try {
  const [skill, protocol, governance, examples, evalSource] = await Promise.all(
    [
      read('SKILL.md'),
      read('references/capability-protocol.md'),
      read('references/governance-and-security.md'),
      read('references/examples.md'),
      read('evals/evals.json'),
    ],
  );

  assert(skill.split('\n').length < 500, 'SKILL.md must stay below 500 lines');
  const frontmatter = /^---\nname: ([^\n]+)\ndescription: ([^\n]+)\n---\n/.exec(
    skill,
  );
  assert(frontmatter !== null, 'SKILL.md frontmatter is invalid');
  assert(
    frontmatter[1] === 'wiser-data-foundation',
    'frontmatter name must match the folder',
  );
  assert(
    frontmatter[2].length >= 80 && frontmatter[2].length <= 1_024,
    'description must be specific and bounded',
  );

  includesAll(
    skill,
    [
      'Capability Registry',
      'data.catalog.search',
      'data.search.federated',
      'data.geo.intersect',
      'data.ingestion.create',
      'data.operation.get',
      'quality grade',
      'acceptance status',
      'security level',
      'Idempotency-Key',
      'capability-protocol.md',
      'governance-and-security.md',
      'examples.md',
    ],
    'SKILL.md',
  );

  includesAll(
    protocol,
    [
      '/api/data/v1/capabilities',
      'data_catalog_search',
      'data_catalog_get',
      'data_query',
      'data_search_federated',
      'data_knowledge_search',
      'data_graph_expand',
      'data_graph_find_path',
      'data_geo_query',
      'data_geo_intersect',
      'data_ingestion_create',
      'data_ingestion_submit',
      'data_ingestion_get',
      'data_operation_get',
      'data_operation_cancel',
      'operationId',
      'If-Match',
      'Idempotency-Key',
    ],
    'capability protocol',
  );

  includesAll(
    governance,
    [
      'L0_PUBLIC',
      'L1_INTERNAL',
      'L2_RESTRICTED',
      'L3_CONFIDENTIAL',
      'PASSED',
      'CONDITIONALLY_PASSED',
      'CORRECTION_REQUIRED',
      'quality grade',
      'acceptance status',
      'publication status',
      'security level',
      'Supabase',
    ],
    'governance reference',
  );

  includesAll(
    examples,
    [
      '目录搜索',
      '知识检索',
      '空间相交',
      '创建上传会话',
      '创建入库会话',
      '提交入库',
      '等待审核',
      '查询 Operation',
    ],
    'examples reference',
  );

  const combined = [skill, protocol, governance, examples].join('\n');
  for (const forbidden of [
    'service_role',
    'S3_SECRET_ACCESS_KEY',
    'sql_execute',
    'cypher_execute',
    'opensearch_execute',
    '~/.codex/auth.json',
  ]) {
    assert(
      !combined.includes(forbidden),
      `Skill contains forbidden ${forbidden}`,
    );
  }

  const evals = JSON.parse(evalSource);
  assert(
    evals.skill_name === 'wiser-data-foundation',
    'eval skill_name mismatch',
  );
  assert(
    Array.isArray(evals.evals) &&
      evals.evals.length >= 3 &&
      evals.evals.length <= 4,
    'evals must contain 3-4 realistic cases',
  );
  for (const evaluation of evals.evals) {
    assert(Number.isInteger(evaluation.id), 'every eval needs an integer id');
    assert(
      typeof evaluation.prompt === 'string' && evaluation.prompt.length >= 80,
      `eval ${evaluation.id} prompt is too small`,
    );
    assert(
      typeof evaluation.expected_output === 'string' &&
        evaluation.expected_output.length >= 30,
      `eval ${evaluation.id} expected output is too small`,
    );
    assert(
      Array.isArray(evaluation.files),
      `eval ${evaluation.id} needs files`,
    );
    assert(
      Array.isArray(evaluation.expectations) &&
        evaluation.expectations.length >= 4,
      `eval ${evaluation.id} needs objective expectations`,
    );
  }

  process.stdout.write(
    `${JSON.stringify({ valid: true, checks: 7, evals: evals.evals.length })}\n`,
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
