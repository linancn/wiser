import { describe, expect, it } from 'vitest';

import {
  DomainError,
  advanceEpisode,
  completeEpisode,
  createEpisode,
  publishFeedback,
  queueSubmission,
  recordObservation,
  releaseInformation,
  startEvaluation,
  type InformationItem,
  type PredictionSubmission,
} from '../src/index.js';

const replayStartAt = '2021-07-20T08:00:00.000Z';
const secondCheckpoint = '2021-07-20T08:30:00.000Z';

function episode() {
  return createEpisode({
    id: 'episode-001',
    participantVersionId: 'participant-version-001',
    replayStartAt,
    scenarioVersionId: 'flood-replay-v1',
  });
}

const information: readonly InformationItem[] = [
  {
    id: 'rainfall-t0',
    eventTime: '2021-07-20T07:45:00.000Z',
    observedTime: '2021-07-20T07:50:00.000Z',
    ingestedTime: '2021-07-20T07:55:00.000Z',
    releasedTime: replayStartAt,
  },
  {
    id: 'waterlogging-t30',
    eventTime: '2021-07-20T08:15:00.000Z',
    observedTime: '2021-07-20T08:20:00.000Z',
    ingestedTime: '2021-07-20T08:25:00.000Z',
    releasedTime: secondCheckpoint,
  },
];

const firstSubmission: PredictionSubmission = {
  claims: [
    {
      id: 'claim-001',
      riskPointId: 'risk-point-a',
      horizonMinutes: 30,
      probability: 0.8,
      riskLevel: 'high',
      evidenceRefs: ['rainfall-t0'],
    },
  ],
  isFinal: false,
};

describe('episode exercise loop', () => {
  it('starts at the first checkpoint awaiting a submission', () => {
    expect(episode()).toEqual({
      id: 'episode-001',
      participantVersionId: 'participant-version-001',
      scenarioVersionId: 'flood-replay-v1',
      state: 'awaiting_submission',
      stageIndex: 0,
      virtualTime: replayStartAt,
      version: 1,
      observedInformationIds: [],
    });
  });

  it('releases only information available at the current virtual time', () => {
    expect(
      releaseInformation(episode(), information).map(({ id }) => id),
    ).toEqual(['rainfall-t0']);
  });

  it('rejects evidence that the participant did not actually observe', () => {
    expect(() => queueSubmission(episode(), firstSubmission, 1)).toThrowError(
      expect.objectContaining<Partial<DomainError>>({
        code: 'EVIDENCE_NOT_OBSERVED',
      }),
    );
  });

  it('queues an immutable submission after observation', () => {
    const observed = recordObservation(episode(), ['rainfall-t0']);
    const queued = queueSubmission(observed, firstSubmission, observed.version);

    expect(queued).toMatchObject({
      state: 'evaluation_queued',
      version: 3,
      observedInformationIds: ['rainfall-t0'],
    });
    expect(observed).toMatchObject({
      state: 'awaiting_submission',
      version: 2,
    });
  });

  it('detects stale concurrent commands before changing state', () => {
    const observed = recordObservation(episode(), ['rainfall-t0']);

    expect(() => queueSubmission(observed, firstSubmission, 1)).toThrowError(
      expect.objectContaining<Partial<DomainError>>({
        code: 'EPISODE_VERSION_CONFLICT',
      }),
    );
  });

  it('publishes feedback and advances exactly one configured checkpoint', () => {
    const observed = recordObservation(episode(), ['rainfall-t0']);
    const queued = queueSubmission(observed, firstSubmission, observed.version);
    const evaluating = startEvaluation(queued, queued.version);
    const feedback = publishFeedback(evaluating, evaluating.version);
    const advanced = advanceEpisode(feedback, {
      expectedVersion: feedback.version,
      nextCheckpoint: secondCheckpoint,
    });

    expect(advanced).toMatchObject({
      state: 'awaiting_submission',
      stageIndex: 1,
      virtualTime: secondCheckpoint,
      version: 6,
    });
  });

  it('completes only after final feedback is ready', () => {
    const observed = recordObservation(episode(), ['rainfall-t0']);
    const finalSubmission = { ...firstSubmission, isFinal: true };
    const queued = queueSubmission(observed, finalSubmission, observed.version);
    const evaluating = startEvaluation(queued, queued.version);
    const feedback = publishFeedback(evaluating, evaluating.version);

    expect(completeEpisode(feedback, feedback.version)).toMatchObject({
      state: 'completed',
      version: 6,
    });
  });
});
