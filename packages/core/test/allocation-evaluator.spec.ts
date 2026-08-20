import { describe, expect, it } from 'vitest';

import {
  evaluateWaterAllocationPlan,
  type AllocationPlanSubmission,
} from '../src/index.js';

const canonicalStageOnePlan: AllocationPlanSubmission = {
  stage: 1,
  sourceReleases: [
    {
      sourceId: 'guanting',
      flowM3s: 20,
      evidenceRefs: [
        'official-flow-20230322-guanting',
        'simulated-rules-20230322-stage-1',
      ],
    },
    {
      sourceId: 'south-water',
      flowM3s: 1,
      evidenceRefs: [
        'simulated-source-limit-20230322-south-water',
        'simulated-rules-20230322-stage-1',
      ],
    },
    {
      sourceId: 'reclaimed-lower',
      flowM3s: 2.5,
      evidenceRefs: [
        'simulated-source-limit-20230322-reclaimed-lower',
        'simulated-rules-20230322-stage-1',
      ],
    },
  ],
  expectedSectionFlows: [
    { sectionId: 'sanjiadian', flowM3s: 18 },
    { sectionId: 'lugouqiao', flowM3s: 16.72 },
    { sectionId: 'cuizhihuiying', flowM3s: 15.7604 },
    { sectionId: 'qujiadian', flowM3s: 14.18436 },
  ],
  isFinal: false,
};

const stageOneRules = {
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
  transferModel: {
    guantingToSanjiadian: 0.9,
    sanjiadianToLugouqiao: 0.88,
    lugouqiaoToCuizhihuiying: 0.82,
    cuizhihuiyingToQujiadian: 0.9,
  },
  totalReleaseLimitM3s: 30,
} as const;

const onTimeEvidence = [
  {
    informationId: 'official-flow-20230322-guanting',
    accessedVirtualTime: '2023-03-22T07:01:00.000Z',
  },
  {
    informationId: 'simulated-source-limit-20230322-south-water',
    accessedVirtualTime: '2023-03-22T07:02:00.000Z',
  },
  {
    informationId: 'simulated-source-limit-20230322-reclaimed-lower',
    accessedVirtualTime: '2023-03-22T07:03:00.000Z',
  },
] as const;

describe('deterministic Jing-Jin-Ji allocation evaluator', () => {
  it('accepts the canonical stage-one replenishment plan', () => {
    const evaluation = evaluateWaterAllocationPlan({
      submission: canonicalStageOnePlan,
      ...stageOneRules,
      evidenceTimestamps: onTimeEvidence,
      submittedVirtualTime: '2023-03-22T07:10:00.000Z',
    });

    expect(evaluation).toEqual({
      verdict: 'pass',
      metrics: {
        constraintCompliance: 1,
        ecologicalCoverage: 1,
        modelAccuracy: 1,
        evidenceCoverage: 1,
        timeTravelViolations: 0,
        totalScore: 100,
      },
    });
  });

  it('fails a plan that exceeds a source limit or misstates section flows', () => {
    const invalidPlan: AllocationPlanSubmission = {
      ...canonicalStageOnePlan,
      sourceReleases: canonicalStageOnePlan.sourceReleases.map((release) =>
        release.sourceId === 'guanting' ? { ...release, flowM3s: 25 } : release,
      ),
    };
    const evaluation = evaluateWaterAllocationPlan({
      submission: invalidPlan,
      ...stageOneRules,
      evidenceTimestamps: onTimeEvidence,
      submittedVirtualTime: '2023-03-22T07:10:00.000Z',
    });

    expect(evaluation.verdict).toBe('fail');
    expect(evaluation.metrics.constraintCompliance).toBe(0.5);
    expect(evaluation.metrics.modelAccuracy).toBe(0);
  });

  it('counts evidence obtained after submission as a time-travel violation', () => {
    const evaluation = evaluateWaterAllocationPlan({
      submission: canonicalStageOnePlan,
      ...stageOneRules,
      evidenceTimestamps: [
        {
          informationId: 'official-flow-20230322-guanting',
          accessedVirtualTime: '2023-03-22T07:11:00.000Z',
        },
      ],
      submittedVirtualTime: '2023-03-22T07:10:00.000Z',
    });

    expect(evaluation.metrics.timeTravelViolations).toBe(1);
    expect(evaluation.verdict).toBe('fail');
  });
});
