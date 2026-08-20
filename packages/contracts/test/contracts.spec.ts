import { describe, expect, it } from 'vitest';

import {
  AllocationPlanSubmissionSchema,
  LocalizedTextSchema,
} from '../src/index.js';

const validPlan = {
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
} as const;

describe('shared protocol contracts', () => {
  it('accepts the canonical Jing-Jin-Ji allocation plan', () => {
    expect(AllocationPlanSubmissionSchema.parse(validPlan)).toEqual(validPlan);
  });

  it('rejects duplicate sources and non-tenth flow increments', () => {
    const invalid = {
      ...validPlan,
      sourceReleases: [
        ...validPlan.sourceReleases,
        {
          sourceId: 'guanting',
          flowM3s: 0.25,
          evidenceRefs: [],
        },
      ],
    };

    expect(AllocationPlanSubmissionSchema.safeParse(invalid).success).toBe(
      false,
    );
  });

  it('keeps stage one revisable and stage two final', () => {
    expect(
      AllocationPlanSubmissionSchema.safeParse({
        ...validPlan,
        isFinal: true,
      }).success,
    ).toBe(false);
    expect(
      AllocationPlanSubmissionSchema.safeParse({
        ...validPlan,
        stage: 2,
        isFinal: false,
      }).success,
    ).toBe(false);
  });

  it('requires observed evidence for every source release', () => {
    const noEvidence = {
      ...validPlan,
      sourceReleases: validPlan.sourceReleases.map((release) =>
        release.sourceId === 'reclaimed-lower'
          ? { ...release, evidenceRefs: [] }
          : release,
      ),
    };

    expect(AllocationPlanSubmissionSchema.safeParse(noEvidence).success).toBe(
      false,
    );
  });

  it('requires matching Chinese and English display text', () => {
    expect(LocalizedTextSchema.safeParse({ 'zh-CN': '联合调度' }).success).toBe(
      false,
    );
    expect(
      LocalizedTextSchema.parse({
        'zh-CN': '联合调度',
        en: 'Coordinated allocation',
      }),
    ).toEqual({
      'zh-CN': '联合调度',
      en: 'Coordinated allocation',
    });
  });
});
