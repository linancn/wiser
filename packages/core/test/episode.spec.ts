import { describe, expect, it } from 'vitest';

import {
  type DomainError,
  advanceEpisode,
  completeEpisode,
  createEpisode,
  publishFeedback,
  queueSubmission,
  recordObservation,
  reopenEpisodeForRevision,
  releaseInformation,
  startEvaluation,
  type AllocationPlanSubmission,
  type InformationItem,
} from '../src/index.js';

const exerciseStartAt = '2023-03-22T07:00:00.000Z';
const secondCheckpoint = '2023-03-23T03:10:00.000Z';

function episode() {
  return createEpisode({
    id: 'episode-001',
    participantVersionId: 'participant-version-001',
    replayStartAt: exerciseStartAt,
    scenarioVersionId: 'jjj-yongding-replenishment-2023-v1',
  });
}

const information: readonly InformationItem[] = [
  {
    id: 'official-flow-20230322-guanting',
    eventTime: '2023-03-22T00:00:00.000Z',
    observedTime: '2023-03-22T00:00:00.000Z',
    ingestedTime: '2023-03-22T06:56:00.000Z',
    releasedTime: exerciseStartAt,
  },
  {
    id: 'official-flow-20230323-sanjiadian',
    eventTime: '2023-03-23T00:00:00.000Z',
    observedTime: '2023-03-23T00:00:00.000Z',
    ingestedTime: '2023-03-23T03:09:00.000Z',
    releasedTime: secondCheckpoint,
  },
];

const firstPlan: AllocationPlanSubmission = {
  stage: 1,
  sourceReleases: [
    {
      sourceId: 'guanting',
      flowM3s: 20,
      evidenceRefs: ['official-flow-20230322-guanting'],
    },
  ],
  expectedSectionFlows: [
    { sectionId: 'sanjiadian', flowM3s: 18 },
    { sectionId: 'lugouqiao', flowM3s: 15.84 },
    { sectionId: 'cuizhihuiying', flowM3s: 12.9888 },
    { sectionId: 'qujiadian', flowM3s: 11.68992 },
  ],
  isFinal: false,
};

describe('Jing-Jin-Ji water-system exercise loop', () => {
  it('starts at the first checkpoint awaiting an allocation plan', () => {
    expect(episode()).toEqual({
      id: 'episode-001',
      participantVersionId: 'participant-version-001',
      scenarioVersionId: 'jjj-yongding-replenishment-2023-v1',
      state: 'waiting_for_submission',
      stageIndex: 0,
      virtualTime: exerciseStartAt,
      version: 1,
      observedInformationIds: [],
    });
  });

  it('releases only water-system information available at virtual time', () => {
    expect(
      releaseInformation(episode(), information).map(({ id }) => id),
    ).toEqual(['official-flow-20230322-guanting']);
  });

  it('rejects an allocation backed by evidence not actually observed', () => {
    expect(() => queueSubmission(episode(), firstPlan, 1)).toThrowError(
      expect.objectContaining<Partial<DomainError>>({
        code: 'EVIDENCE_NOT_OBSERVED',
      }),
    );
  });

  it('queues an immutable allocation plan after observation', () => {
    const observed = recordObservation(episode(), [
      'official-flow-20230322-guanting',
    ]);
    const queued = queueSubmission(observed, firstPlan, observed.version);

    expect(queued).toMatchObject({
      state: 'evaluation_queued',
      version: 3,
      observedInformationIds: ['official-flow-20230322-guanting'],
    });
    expect(observed).toMatchObject({
      state: 'waiting_for_submission',
      version: 2,
    });
  });

  it('detects stale concurrent commands before changing state', () => {
    const observed = recordObservation(episode(), [
      'official-flow-20230322-guanting',
    ]);

    expect(() => queueSubmission(observed, firstPlan, 1)).toThrowError(
      expect.objectContaining<Partial<DomainError>>({
        code: 'EPISODE_VERSION_CONFLICT',
      }),
    );
  });

  it('publishes feedback and advances exactly one configured checkpoint', () => {
    const observed = recordObservation(episode(), [
      'official-flow-20230322-guanting',
    ]);
    const queued = queueSubmission(observed, firstPlan, observed.version);
    const evaluating = startEvaluation(queued, queued.version);
    const feedback = publishFeedback(evaluating, evaluating.version);
    const advanced = advanceEpisode(feedback, {
      expectedVersion: feedback.version,
      nextCheckpoint: secondCheckpoint,
    });

    expect(advanced).toMatchObject({
      state: 'waiting_for_submission',
      stageIndex: 1,
      virtualTime: secondCheckpoint,
      version: 6,
    });
  });

  it('reopens the same checkpoint for an immutable feedback-driven revision', () => {
    const observed = recordObservation(episode(), [
      'official-flow-20230322-guanting',
    ]);
    const queued = queueSubmission(observed, firstPlan, observed.version);
    const evaluating = startEvaluation(queued, queued.version);
    const feedback = publishFeedback(evaluating, evaluating.version);
    const reopened = reopenEpisodeForRevision(feedback, feedback.version);
    const revised = queueSubmission(reopened, firstPlan, reopened.version);

    expect(reopened).toMatchObject({
      state: 'waiting_for_submission',
      stageIndex: 0,
      version: 6,
    });
    expect(revised).toMatchObject({ state: 'evaluation_queued', version: 7 });
  });

  it('completes only after final feedback is ready', () => {
    const observed = recordObservation(episode(), [
      'official-flow-20230322-guanting',
    ]);
    const finalPlan = { ...firstPlan, isFinal: true };
    const queued = queueSubmission(observed, finalPlan, observed.version);
    const evaluating = startEvaluation(queued, queued.version);
    const feedback = publishFeedback(evaluating, evaluating.version);

    expect(completeEpisode(feedback, feedback.version)).toMatchObject({
      state: 'completed',
      version: 6,
    });
  });
});
