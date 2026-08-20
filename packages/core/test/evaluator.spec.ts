import { describe, expect, it } from 'vitest';

import {
  evaluateFloodPrediction,
  type PredictionSubmission,
} from '../src/index.js';

const submission: PredictionSubmission = {
  claims: [
    {
      id: 'claim-a',
      riskPointId: 'risk-point-a',
      horizonMinutes: 30,
      probability: 0.8,
      riskLevel: 'high',
      evidenceRefs: ['rainfall-t0'],
    },
    {
      id: 'claim-b',
      riskPointId: 'risk-point-b',
      horizonMinutes: 30,
      probability: 0.7,
      riskLevel: 'high',
      evidenceRefs: [],
    },
  ],
  isFinal: true,
};

describe('deterministic flood evaluator', () => {
  it('calculates stable metrics for the canonical imperfect prediction', () => {
    const evaluation = evaluateFloodPrediction({
      submission,
      outcomes: [
        { riskPointId: 'risk-point-a', occurred: true },
        { riskPointId: 'risk-point-b', occurred: false },
        { riskPointId: 'risk-point-c', occurred: true },
      ],
      evidenceTimestamps: [
        {
          informationId: 'rainfall-t0',
          accessedTime: '2021-07-20T07:59:00.000Z',
        },
      ],
      submittedAt: '2021-07-20T08:00:00.000Z',
    });

    expect(evaluation).toEqual({
      verdict: 'fail',
      metrics: {
        precision: 0.5,
        recall: 0.5,
        brierScore: 0.51,
        evidenceCoverage: 0.5,
        timeTravelViolations: 0,
      },
    });
  });

  it('counts evidence accessed after submission as a time-travel violation', () => {
    const evaluation = evaluateFloodPrediction({
      submission,
      outcomes: [{ riskPointId: 'risk-point-a', occurred: true }],
      evidenceTimestamps: [
        {
          informationId: 'rainfall-t0',
          accessedTime: '2021-07-20T08:01:00.000Z',
        },
      ],
      submittedAt: '2021-07-20T08:00:00.000Z',
    });

    expect(evaluation.metrics.timeTravelViolations).toBe(1);
    expect(evaluation.verdict).toBe('fail');
  });
});
