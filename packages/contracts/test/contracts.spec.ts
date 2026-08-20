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
      evidenceRefs: ['official-flow-20230322-guanting'],
    },
    {
      sourceId: 'south-water',
      flowM3s: 1,
      evidenceRefs: ['official-flow-20230322-lugouqiao'],
    },
    {
      sourceId: 'reclaimed-lower',
      flowM3s: 2.5,
      evidenceRefs: ['official-flow-20230322-cuizhihuiying'],
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
