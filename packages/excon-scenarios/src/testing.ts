import { readFileSync } from 'node:fs';

import {
  AllocationPlanSubmissionSchema,
  WaterSectionIdSchema,
  WaterSourceIdSchema,
} from '@agent-excon/contracts';
import { z } from 'zod';

const YongdingStageSchema = z.union([z.literal(1), z.literal(2)]);

const YongdingRulesSchema = z.strictObject({
  sources: z
    .array(
      z.strictObject({
        sourceId: WaterSourceIdSchema,
        maximumFlowM3s: z.number().finite().nonnegative(),
      }),
    )
    .length(3),
  sectionTargets: z
    .array(
      z.strictObject({
        sectionId: WaterSectionIdSchema,
        minimumFlowM3s: z.number().finite().nonnegative(),
      }),
    )
    .length(4),
  transferModel: z.strictObject({
    guantingToSanjiadian: z.number().finite().min(0).max(1),
    sanjiadianToLugouqiao: z.number().finite().min(0).max(1),
    lugouqiaoToCuizhihuiying: z.number().finite().min(0).max(1),
    cuizhihuiyingToQujiadian: z.number().finite().min(0).max(1),
  }),
  totalReleaseLimitM3s: z.number().finite().nonnegative(),
});

const SimulatedConstraintUpdateSchema = z.strictObject({
  type: z.literal('SIMULATED_CONSTRAINT_UPDATE'),
  southWaterMaximumFlowM3s: z.number().finite().nonnegative(),
  sanjiadianToLugouqiao: z.number().finite().min(0).max(1),
  qujiadianMinimumFlowM3s: z.number().finite().nonnegative(),
});

export const YongdingStageFixtureSchema = z
  .strictObject({
    license: z.literal('CC0-1.0'),
    simulationOnly: z.literal(true),
    notForOperationalUse: z.literal(true),
    stage: YongdingStageSchema,
    releasedAt: z.string().datetime({ offset: true }),
    officialObservationRefs: z.array(z.string().min(1)).min(1),
    simulatedConstraintUpdate: SimulatedConstraintUpdateSchema.optional(),
    rules: YongdingRulesSchema,
    canonicalPlan: AllocationPlanSubmissionSchema,
  })
  .superRefine((fixture, context) => {
    if (fixture.canonicalPlan.stage !== fixture.stage) {
      context.addIssue({
        code: 'custom',
        path: ['canonicalPlan', 'stage'],
        message: 'canonical plan stage must match fixture stage',
      });
    }
    if (
      (fixture.stage === 1 &&
        fixture.simulatedConstraintUpdate !== undefined) ||
      (fixture.stage === 2 && fixture.simulatedConstraintUpdate === undefined)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['simulatedConstraintUpdate'],
        message: 'only stage 2 must contain the simulated constraint update',
      });
    }
  });

export type YongdingStageFixture = z.infer<typeof YongdingStageFixtureSchema>;

const fixtureUrls = Object.freeze({
  1: new URL(
    '../scenarios/jjj-yongding-replenishment-2023/fixture/stage-1.json',
    import.meta.url,
  ),
  2: new URL(
    '../scenarios/jjj-yongding-replenishment-2023/fixture/stage-2.json',
    import.meta.url,
  ),
});

export function loadYongdingStageFixture(
  requestedStage: 1 | 2,
): YongdingStageFixture {
  const stage = YongdingStageSchema.parse(requestedStage);
  const source = readFileSync(fixtureUrls[stage], 'utf8');
  const fixture = YongdingStageFixtureSchema.parse(
    JSON.parse(source) as unknown,
  );
  if (fixture.stage !== stage) {
    throw new Error(
      `Yongding stage ${String(stage)} asset declares stage ${String(fixture.stage)}.`,
    );
  }
  return fixture;
}
