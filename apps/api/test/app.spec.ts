import {
  AllocationPlanSubmissionSchema,
  ApiErrorSchema,
  EpisodeSchema,
  EvaluationResultSchema,
  FeedbackSchema,
  ObservationSchema,
} from '@agent-excon/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  DEFAULT_SCENARIO_VERSION_ID,
  InMemoryExerciseService,
  StaticParticipantAuthenticator,
  buildApp,
  type BuildAppOptions,
} from '../src/index.js';

const participantVersionId = '22222222-2222-4222-8222-222222222222';
const participantToken = 'participant-a-token';
const secondParticipantToken = 'participant-b-token';

const headers = {
  authorization: `Bearer ${participantToken}`,
};

function json(response: { readonly body: string }): unknown {
  return JSON.parse(response.body) as unknown;
}

const EpisodeViewSchema = EpisodeSchema.extend({
  observedInformationIds: z.array(z.string()),
});
const EpisodeEnvelopeSchema = z.looseObject({ episode: EpisodeViewSchema });
const ObserveResponseSchema = z.looseObject({
  episode: EpisodeViewSchema,
  observations: z.array(ObservationSchema),
});
const ObservationListSchema = z.looseObject({
  items: z.array(ObservationSchema),
});
const SubmissionResponseSchema = z.looseObject({
  submissionId: z.string().uuid(),
  episode: EpisodeViewSchema,
  submission: z.looseObject({ plan: AllocationPlanSubmissionSchema }),
  evaluation: EvaluationResultSchema,
  feedback: FeedbackSchema,
  links: z.looseObject({
    episode: z.string(),
    feedback: z.string(),
    evaluation: z.string(),
  }),
});
const EvaluationResponseSchema = z.looseObject({
  status: z.literal('ready'),
  submissionId: z.string().uuid(),
  evaluation: EvaluationResultSchema,
  links: z.looseObject({ feedback: z.string() }),
});
const EventListSchema = z.looseObject({
  items: z.array(z.looseObject({ type: z.string() })),
});
const OpenApiResponseSchema = z.looseObject({
  openapi: z.string(),
  info: z.looseObject({ title: z.string(), version: z.string() }),
  paths: z.record(z.string(), z.unknown()),
});
const ScenarioResponseSchema = z.looseObject({
  versionId: z.string(),
  defaultLocale: z.literal('zh-CN'),
  simulationOnly: z.literal(true),
  title: z.object({ 'zh-CN': z.string(), en: z.string() }),
});

const closeCallbacks: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(closeCallbacks.splice(0).map((close) => close()));
});

function app(options: Partial<BuildAppOptions> = {}) {
  let sequence = 0;
  const service =
    options.service ??
    new InMemoryExerciseService({
      idFactory: () => {
        sequence += 1;
        return `00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`;
      },
      now: () => new Date('2026-08-20T08:00:00.000Z'),
    });
  const instance = buildApp({
    logger: false,
    service,
    authenticator:
      options.authenticator ??
      new StaticParticipantAuthenticator({
        [participantToken]: 'participant-a',
        [secondParticipantToken]: 'participant-b',
      }),
  });
  closeCallbacks.push(() => instance.close());
  return instance;
}

async function startEpisode(instance: ReturnType<typeof app>, key: string) {
  return instance.inject({
    method: 'POST',
    url: '/api/v1/episodes',
    headers: { ...headers, 'idempotency-key': key },
    payload: {
      scenarioVersionId: DEFAULT_SCENARIO_VERSION_ID,
      participantVersionId,
    },
  });
}

const canonicalPlan = {
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

describe('Agent EXCON HTTP walking slice', () => {
  it('serves unauthenticated health checks and generated OpenAPI JSON', async () => {
    const instance = app();

    const [live, ready, openapi] = await Promise.all([
      instance.inject({ method: 'GET', url: '/health/live' }),
      instance.inject({ method: 'GET', url: '/health/ready' }),
      instance.inject({ method: 'GET', url: '/openapi.json' }),
    ]);

    expect(live.statusCode).toBe(200);
    expect(json(live)).toMatchObject({ status: 'ok', live: true });
    expect(ready.statusCode).toBe(200);
    expect(json(ready)).toMatchObject({ status: 'ready', ready: true });
    expect(openapi.statusCode).toBe(200);
    const openapiBody = OpenApiResponseSchema.parse(json(openapi));
    expect(openapiBody).toMatchObject({
      openapi: '3.1.0',
      info: { title: 'Agent EXCON API', version: '0.1.0' },
    });
    expect(openapiBody.paths).toHaveProperty('/api/v1/episodes');
  });

  it('requires a participant bearer token for exercise routes', async () => {
    const response = await app().inject({
      method: 'GET',
      url: '/api/v1/scenario',
    });

    expect(response.statusCode).toBe(401);
    const problem = ApiErrorSchema.parse(json(response));
    expect(problem).toMatchObject({
      error: { code: 'NOT_AUTHORIZED' },
    });
    expect(problem.error.traceId.length).toBeGreaterThanOrEqual(8);
  });

  it('publishes the Chinese-first, bilingual 2023 Yongding River scenario', async () => {
    const response = await app().inject({
      method: 'GET',
      url: '/api/v1/scenario',
      headers,
    });

    expect(response.statusCode).toBe(200);
    const scenario = ScenarioResponseSchema.parse(json(response));
    expect(scenario).toMatchObject({
      versionId: DEFAULT_SCENARIO_VERSION_ID,
      defaultLocale: 'zh-CN',
      simulationOnly: true,
    });
    expect(scenario.title['zh-CN']).toContain('京津冀');
    expect(scenario.title.en).toContain('Jing-Jin-Ji');
    expect(response.body).not.toContain(['防', '汛'].join(''));
  });

  it('runs start, observe, submit, feedback, advance, and event trace via HTTP', async () => {
    const instance = app();
    const created = await startEpisode(
      instance,
      '10000000-0000-4000-8000-000000000001',
    );
    expect(created.statusCode).toBe(201);
    const createdBody = EpisodeEnvelopeSchema.parse(json(created));
    expect(createdBody.episode).toMatchObject({
      state: 'waiting_for_submission',
      version: 1,
      observedInformationIds: [],
    });
    const episodeId = createdBody.episode.id;

    const observed = await instance.inject({
      method: 'POST',
      url: `/api/v1/episodes/${episodeId}/observe`,
      headers: {
        ...headers,
        'idempotency-key': '10000000-0000-4000-8000-000000000002',
      },
      payload: { episodeVersion: 1 },
    });
    expect(observed.statusCode).toBe(200);
    const observedBody = ObserveResponseSchema.parse(json(observed));
    expect(observedBody.episode.version).toBe(2);
    expect(observedBody.observations).toHaveLength(3);

    const listed = await instance.inject({
      method: 'GET',
      url: `/api/v1/episodes/${episodeId}/observations`,
      headers,
    });
    expect(listed.statusCode).toBe(200);
    const listedBody = ObservationListSchema.parse(json(listed));
    expect(listedBody.items).toContainEqual(
      expect.objectContaining({
        informationId: 'official-flow-20230322-guanting',
        accessedTime: '2026-08-20T08:00:00.000Z',
      }),
    );

    const submitted = await instance.inject({
      method: 'POST',
      url: `/api/v1/episodes/${episodeId}/submissions`,
      headers: {
        ...headers,
        'idempotency-key': '10000000-0000-4000-8000-000000000003',
      },
      payload: { episodeVersion: 2, plan: canonicalPlan },
    });
    expect(submitted.statusCode).toBe(201);
    const submittedBody = SubmissionResponseSchema.parse(json(submitted));
    expect(submittedBody).toMatchObject({
      episode: { state: 'feedback_available', version: 5 },
      submission: { plan: canonicalPlan },
      evaluation: { verdict: 'pass' },
      feedback: { allowedActions: ['advance'] },
      links: {
        episode: `/api/v1/episodes/${episodeId}`,
        feedback: `/api/v1/episodes/${episodeId}/feedback`,
      },
    });
    expect(submittedBody.links.evaluation).toContain('/evaluation');
    const submissionId = submittedBody.submissionId;

    const evaluation = await instance.inject({
      method: 'GET',
      url: `/api/v1/submissions/${submissionId}/evaluation`,
      headers,
    });
    expect(evaluation.statusCode).toBe(200);
    expect(EvaluationResponseSchema.parse(json(evaluation))).toMatchObject({
      status: 'ready',
      submissionId,
      evaluation: { verdict: 'pass', metrics: { totalScore: 100 } },
      links: {
        feedback: `/api/v1/episodes/${episodeId}/feedback`,
      },
    });

    const feedback = await instance.inject({
      method: 'GET',
      url: `/api/v1/episodes/${episodeId}/feedback`,
      headers,
    });
    expect(feedback.statusCode).toBe(200);
    expect(FeedbackSchema.parse(json(feedback))).toMatchObject({
      evaluation: { verdict: 'pass', metrics: { totalScore: 100 } },
      allowedActions: ['advance'],
    });

    const advanced = await instance.inject({
      method: 'POST',
      url: `/api/v1/episodes/${episodeId}/advance`,
      headers: {
        ...headers,
        'idempotency-key': '10000000-0000-4000-8000-000000000004',
      },
      payload: { episodeVersion: 5 },
    });
    expect(advanced.statusCode).toBe(200);
    expect(EpisodeEnvelopeSchema.parse(json(advanced)).episode).toMatchObject({
      state: 'waiting_for_submission',
      stageIndex: 1,
      version: 6,
    });

    const episode = await instance.inject({
      method: 'GET',
      url: `/api/v1/episodes/${episodeId}`,
      headers,
    });
    expect(EpisodeEnvelopeSchema.parse(json(episode)).episode.version).toBe(6);

    const events = await instance.inject({
      method: 'GET',
      url: `/api/v1/episodes/${episodeId}/events`,
      headers,
    });
    expect(events.statusCode).toBe(200);
    expect(
      EventListSchema.parse(json(events)).items.map(({ type }) => type),
    ).toEqual([
      'episode.created',
      'observations.recorded',
      'submission.created',
      'evaluation.completed',
      'episode.advanced',
    ]);
  });
});

describe('validation, ownership, versions, and idempotency', () => {
  it('validates payloads with Zod and requires idempotency on writes', async () => {
    const instance = app();
    const missingKey = await instance.inject({
      method: 'POST',
      url: '/api/v1/episodes',
      headers,
      payload: { participantVersionId: 'not-a-uuid' },
    });

    expect(missingKey.statusCode).toBe(422);
    expect(ApiErrorSchema.parse(json(missingKey))).toMatchObject({
      error: { code: 'VALIDATION_FAILED' },
    });
  });

  it('returns the original response for the same key and rejects changed bodies', async () => {
    const instance = app();
    const key = '10000000-0000-4000-8000-000000000010';
    const first = await startEpisode(instance, key);
    const replay = await startEpisode(instance, key);
    expect(replay.statusCode).toBe(201);
    expect(json(replay)).toEqual(json(first));

    const conflict = await instance.inject({
      method: 'POST',
      url: '/api/v1/episodes',
      headers: { ...headers, 'idempotency-key': key },
      payload: {
        scenarioVersionId: DEFAULT_SCENARIO_VERSION_ID,
        participantVersionId: '33333333-3333-4333-8333-333333333333',
      },
    });
    expect(conflict.statusCode).toBe(409);
    expect(ApiErrorSchema.parse(json(conflict))).toMatchObject({
      error: { code: 'IDEMPOTENCY_CONFLICT' },
    });
  });

  it('does not expose an episode owned by another bearer identity', async () => {
    const instance = app();
    const created = await startEpisode(
      instance,
      '10000000-0000-4000-8000-000000000020',
    );
    const createdBody = EpisodeEnvelopeSchema.parse(json(created));
    const response = await instance.inject({
      method: 'GET',
      url: `/api/v1/episodes/${createdBody.episode.id}`,
      headers: { authorization: `Bearer ${secondParticipantToken}` },
    });

    expect(response.statusCode).toBe(404);
    expect(ApiErrorSchema.parse(json(response))).toMatchObject({
      error: { code: 'EPISODE_NOT_FOUND' },
    });
  });

  it('returns stable conflict codes for stale versions and unseen evidence', async () => {
    const instance = app();
    const created = await startEpisode(
      instance,
      '10000000-0000-4000-8000-000000000030',
    );
    const episodeId = EpisodeEnvelopeSchema.parse(json(created)).episode.id;
    const unseen = await instance.inject({
      method: 'POST',
      url: `/api/v1/episodes/${episodeId}/submissions`,
      headers: {
        ...headers,
        'idempotency-key': '10000000-0000-4000-8000-000000000031',
      },
      payload: { episodeVersion: 1, plan: canonicalPlan },
    });
    expect(unseen.statusCode).toBe(409);
    expect(ApiErrorSchema.parse(json(unseen))).toMatchObject({
      error: { code: 'EVIDENCE_NOT_OBSERVED' },
    });

    await instance.inject({
      method: 'POST',
      url: `/api/v1/episodes/${episodeId}/observe`,
      headers: {
        ...headers,
        'idempotency-key': '10000000-0000-4000-8000-000000000032',
      },
      payload: { episodeVersion: 1 },
    });
    const stale = await instance.inject({
      method: 'POST',
      url: `/api/v1/episodes/${episodeId}/submissions`,
      headers: {
        ...headers,
        'idempotency-key': '10000000-0000-4000-8000-000000000033',
      },
      payload: { episodeVersion: 1, plan: canonicalPlan },
    });
    expect(stale.statusCode).toBe(409);
    expect(ApiErrorSchema.parse(json(stale))).toMatchObject({
      error: { code: 'EPISODE_VERSION_CONFLICT' },
    });
  });
});
