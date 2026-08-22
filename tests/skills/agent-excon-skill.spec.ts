import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { afterEach, describe, expect, it } from 'vitest';

import { loadYongdingStageFixture } from '@agent-excon/scenarios/testing';

const execute = promisify(execFile);
const temporaryDirectories: string[] = [];
const script = new URL(
  '../../skills/agent-excon/scripts/validate-allocation-plan.mjs',
  import.meta.url,
);
const stageOne = loadYongdingStageFixture(1);

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function tempJson(name: string, value: unknown): Promise<string> {
  let directory = temporaryDirectories.at(-1);
  if (directory === undefined) {
    directory = await mkdtemp(join(tmpdir(), 'agent-excon-skill-test-'));
    temporaryDirectories.push(directory);
  }
  const path = join(directory, name);
  await writeFile(path, JSON.stringify(value), 'utf8');
  return path;
}

describe('Agent EXCON Skill validator', () => {
  it('checks the canonical plan against the current released rules', async () => {
    const fixture = stageOne as {
      canonicalPlan: unknown;
      rules: unknown;
    };
    const planPath = await tempJson('plan.json', fixture.canonicalPlan);
    const rulesPath = await tempJson('rules.json', fixture.rules);

    const { stdout } = await execute(process.execPath, [
      script.pathname,
      planPath,
      rulesPath,
    ]);

    expect(JSON.parse(stdout)).toEqual({
      valid: true,
      checks: { structure: true, currentRules: true },
      warnings: [],
    });
  });

  it('rejects unsafe volumes before any API call', async () => {
    const invalidPath = await tempJson('invalid.json', {
      stage: 2,
      sourceReleases: [
        { sourceId: 'guanting', flowM3s: 999_999.9, evidenceRefs: ['obs-a'] },
        { sourceId: 'south-water', flowM3s: 0, evidenceRefs: ['obs-b'] },
        { sourceId: 'reclaimed-lower', flowM3s: 1, evidenceRefs: ['obs-c'] },
      ],
      expectedSectionFlows: [
        { sectionId: 'sanjiadian', flowM3s: 1 },
        { sectionId: 'lugouqiao', flowM3s: 1 },
        { sectionId: 'cuizhihuiying', flowM3s: 1 },
        { sectionId: 'qujiadian', flowM3s: 1 },
      ],
      isFinal: true,
    });

    let standardError = '';
    try {
      await execute(process.execPath, [script.pathname, invalidPath]);
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'stderr' in error &&
        typeof error.stderr === 'string'
      ) {
        standardError = error.stderr;
      }
    }
    expect(standardError).toContain('non-negative 0.1 increment');
  });

  it.each([
    {
      name: 'an incomplete source set',
      rules: {
        sources: [{ sourceId: 'guanting', maximumFlowM3s: 24 }],
        sectionTargets: [],
        transferModel: {},
        totalReleaseLimitM3s: 30,
      },
    },
    {
      name: 'missing transfer coefficients',
      rules: {
        sources: [
          { sourceId: 'guanting', maximumFlowM3s: 24 },
          { sourceId: 'south-water', maximumFlowM3s: 10 },
          { sourceId: 'reclaimed-lower', maximumFlowM3s: 6 },
        ],
        sectionTargets: [
          { sectionId: 'sanjiadian', minimumFlowM3s: 10 },
          { sectionId: 'lugouqiao', minimumFlowM3s: 16 },
          { sectionId: 'cuizhihuiying', minimumFlowM3s: 15 },
          { sectionId: 'qujiadian', minimumFlowM3s: 12 },
        ],
        transferModel: {},
        totalReleaseLimitM3s: 30,
      },
    },
  ])(
    'rejects $name instead of reporting currentRules=true',
    async ({ rules }) => {
      const fixture = stageOne as {
        canonicalPlan: unknown;
      };
      const planPath = await tempJson(
        'complete-plan.json',
        fixture.canonicalPlan,
      );
      const rulesPath = await tempJson('incomplete-rules.json', rules);
      let standardError = '';
      try {
        await execute(process.execPath, [script.pathname, planPath, rulesPath]);
      } catch (error) {
        if (
          typeof error === 'object' &&
          error !== null &&
          'stderr' in error &&
          typeof error.stderr === 'string'
        ) {
          standardError = error.stderr;
        }
      }
      expect(standardError).not.toBe('');
      expect(standardError).toContain('valid":false');
    },
  );
});
