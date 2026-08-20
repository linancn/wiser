import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import { AllocationPlanSubmissionSchema } from '../../packages/contracts/src/index.js';
import { evaluateWaterAllocationPlan } from '../../packages/core/src/index.js';

interface StageFixture {
  readonly simulationOnly: boolean;
  readonly notForOperationalUse: boolean;
  readonly rules: Parameters<
    typeof evaluateWaterAllocationPlan
  >[0] extends infer Input
    ? Omit<Input, 'submission' | 'evidenceTimestamps' | 'submittedVirtualTime'>
    : never;
  readonly canonicalPlan: unknown;
}

async function readFixture(stage: 1 | 2): Promise<StageFixture> {
  const url = new URL(
    `../../scenarios/jjj-yongding-replenishment-2023/fixture/stage-${String(stage)}.json`,
    import.meta.url,
  );
  return JSON.parse(await readFile(url, 'utf8')) as StageFixture;
}

describe('Yongding River scenario fixtures', () => {
  it.each([1, 2] as const)(
    'keeps stage %i synthetic, non-operational, valid, and reproducible',
    async (stage) => {
      const fixture = await readFixture(stage);
      const plan = AllocationPlanSubmissionSchema.parse(fixture.canonicalPlan);
      const evidenceTimestamps = plan.sourceReleases.flatMap(
        ({ evidenceRefs }) =>
          evidenceRefs.map((informationId) => ({
            informationId,
            accessedVirtualTime:
              stage === 1
                ? '2023-03-22T07:05:00.000Z'
                : '2023-03-23T03:09:30.000Z',
          })),
      );
      const result = evaluateWaterAllocationPlan({
        submission: plan,
        ...fixture.rules,
        evidenceTimestamps,
        submittedVirtualTime:
          stage === 1 ? '2023-03-22T07:10:00.000Z' : '2023-03-23T03:10:00.000Z',
      });

      expect(fixture.simulationOnly).toBe(true);
      expect(fixture.notForOperationalUse).toBe(true);
      expect(result).toMatchObject({
        verdict: 'pass',
        metrics: {
          constraintCompliance: 1,
          ecologicalCoverage: 1,
          modelAccuracy: 1,
          timeTravelViolations: 0,
          totalScore: 100,
        },
      });
    },
  );
});
