import { createHash, randomUUID } from 'node:crypto';

import type {
  CreateEpisodeRequest,
  FeedbackDto,
  ObservationDto,
} from '@agent-excon/contracts';
import {
  advanceEpisode,
  completeEpisode,
  createEpisode,
  evaluateWaterAllocationPlan,
  publishFeedback,
  queueSubmission,
  recordObservation,
  releaseInformation,
  reopenEpisodeForRevision,
  startEvaluation,
  type Episode,
  type EvaluationResult,
} from '@agent-excon/core';

import {
  DEFAULT_SCENARIO,
  DEFAULT_SCENARIO_VERSION_ID,
  SCENARIO_INFORMATION,
  type ScenarioDocument,
  type ScenarioInformation,
} from './scenario.js';
import {
  ExerciseServiceError,
  type AdvanceEpisodeInput,
  type AdvanceEpisodeResult,
  type CreateEpisodeResult,
  type EpisodeEvent,
  type EpisodeLinks,
  type EpisodeView,
  type EvaluationQueryResult,
  type ExerciseService,
  type FeedbackQueryResult,
  type ObserveEpisodeInput,
  type ObserveEpisodeResult,
  type ParticipantPrincipal,
  type SubmissionLinks,
  type SubmissionView,
  type SubmitPlanInput,
  type SubmitPlanResult,
} from './types.js';

interface StoredEpisode {
  readonly participantId: string;
  episode: Episode;
  readonly observations: Map<string, ObservationDto>;
  readonly events: EpisodeEvent[];
  latestSubmissionId: string | undefined;
  nextRevisionNo: number;
}

interface StoredSubmission {
  readonly participantId: string;
  readonly view: SubmissionView;
  readonly evaluation: EvaluationResult;
  readonly feedback: FeedbackDto;
}

interface IdempotencyRecord {
  readonly requestHash: string;
  readonly response: unknown;
}

export interface InMemoryExerciseServiceOptions {
  readonly idFactory?: () => string;
  readonly now?: () => Date;
}

const STAGE_ONE_RULES = Object.freeze({
  sources: Object.freeze([
    Object.freeze({ sourceId: 'guanting', maximumFlowM3s: 24 }),
    Object.freeze({ sourceId: 'south-water', maximumFlowM3s: 10 }),
    Object.freeze({ sourceId: 'reclaimed-lower', maximumFlowM3s: 6 }),
  ]),
  sectionTargets: Object.freeze([
    Object.freeze({ sectionId: 'sanjiadian', minimumFlowM3s: 10 }),
    Object.freeze({ sectionId: 'lugouqiao', minimumFlowM3s: 16 }),
    Object.freeze({ sectionId: 'cuizhihuiying', minimumFlowM3s: 15 }),
    Object.freeze({ sectionId: 'qujiadian', minimumFlowM3s: 12 }),
  ]),
  transferModel: Object.freeze({
    guantingToSanjiadian: 0.9,
    sanjiadianToLugouqiao: 0.88,
    lugouqiaoToCuizhihuiying: 0.82,
    cuizhihuiyingToQujiadian: 0.9,
  }),
  totalReleaseLimitM3s: 30,
});

const STAGE_TWO_RULES = Object.freeze({
  sources: Object.freeze([
    Object.freeze({ sourceId: 'guanting', maximumFlowM3s: 24 }),
    Object.freeze({ sourceId: 'south-water', maximumFlowM3s: 3 }),
    Object.freeze({ sourceId: 'reclaimed-lower', maximumFlowM3s: 6 }),
  ]),
  sectionTargets: Object.freeze([
    Object.freeze({ sectionId: 'sanjiadian', minimumFlowM3s: 10 }),
    Object.freeze({ sectionId: 'lugouqiao', minimumFlowM3s: 16 }),
    Object.freeze({ sectionId: 'cuizhihuiying', minimumFlowM3s: 15 }),
    Object.freeze({ sectionId: 'qujiadian', minimumFlowM3s: 15 }),
  ]),
  transferModel: Object.freeze({
    guantingToSanjiadian: 0.9,
    sanjiadianToLugouqiao: 0.78,
    lugouqiaoToCuizhihuiying: 0.82,
    cuizhihuiyingToQujiadian: 0.9,
  }),
  totalReleaseLimitM3s: 30,
});

function rulesForStage(stage: number) {
  return stage === 2 ? STAGE_TWO_RULES : STAGE_ONE_RULES;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalize(entry)]),
  );
}

function requestHash(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(value)))
    .digest('hex');
}

function episodeLinks(episodeId: string): EpisodeLinks {
  const episode = `/api/v1/episodes/${episodeId}`;
  return Object.freeze({
    episode,
    observations: `${episode}/observations`,
    feedback: `${episode}/feedback`,
    events: `${episode}/events`,
  });
}

function submissionLinks(
  episodeId: string,
  submissionId: string,
): SubmissionLinks {
  return Object.freeze({
    ...episodeLinks(episodeId),
    submission: `/api/v1/submissions/${submissionId}`,
    evaluation: `/api/v1/submissions/${submissionId}/evaluation`,
  });
}

function episodeView(episode: Episode): EpisodeView {
  return Object.freeze({
    ...episode,
    observedInformationIds: Object.freeze([...episode.observedInformationIds]),
  });
}

function feedbackCopy(
  verdict: EvaluationResult['verdict'],
): Pick<FeedbackDto, 'guidance' | 'summary'> {
  if (verdict === 'pass') {
    return {
      summary: {
        'zh-CN': '联合调度方案满足当前水源、生态流量、模型与证据约束。',
        en: 'The joint allocation plan satisfies the current source, ecological-flow, model, and evidence constraints.',
      },
      guidance: [
        {
          'zh-CN': '保持证据链，并在下一检查点重新观察已发布水情。',
          en: 'Preserve the evidence trail and observe newly released water-system information at the next checkpoint.',
        },
      ],
    };
  }
  if (verdict === 'partial') {
    return {
      summary: {
        'zh-CN': '联合调度方案基本可行，但仍有指标需要修订。',
        en: 'The joint allocation plan is broadly viable, but some metrics still require revision.',
      },
      guidance: [
        {
          'zh-CN': '复核生态断面覆盖与证据引用后再提交。',
          en: 'Review ecological-section coverage and evidence references before resubmitting.',
        },
      ],
    };
  }
  return {
    summary: {
      'zh-CN': '联合调度方案未满足当前确定性约束。',
      en: 'The joint allocation plan does not satisfy the current deterministic constraints.',
    },
    guidance: [
      {
        'zh-CN': '根据公开指标修订水源流量、断面预测与证据引用。',
        en: 'Revise source flows, section predictions, and evidence references using the published metrics.',
      },
    ],
  };
}

function feedbackIssues(result: EvaluationResult): FeedbackDto['issues'] {
  const issues: FeedbackDto['issues'][number][] = [];
  if (result.metrics.constraintCompliance < 1) {
    issues.push({
      type: 'constraint_violation',
      severity: 'high',
      message: {
        'zh-CN': '方案存在水源、总量、步长或断面模型约束冲突。',
        en: 'The plan conflicts with a source, total, increment, or section-model constraint.',
      },
    });
  }
  if (result.metrics.ecologicalCoverage < 1) {
    issues.push({
      type: 'ecological_target_gap',
      severity: 'high',
      message: {
        'zh-CN': '至少一个合成生态控制断面未达到当前目标。',
        en: 'At least one synthetic ecological control section misses its current target.',
      },
    });
  }
  if (result.metrics.evidenceCoverage < 1) {
    issues.push({
      type: 'evidence_gap',
      severity: 'medium',
      message: {
        'zh-CN': '至少一个水源决策缺少已观测证据引用。',
        en: 'At least one source decision lacks an observed evidence reference.',
      },
    });
  }
  if (result.metrics.timeTravelViolations > 0) {
    issues.push({
      type: 'time_travel',
      severity: 'high',
      message: {
        'zh-CN': '方案引用了提交虚拟时点之后才访问的信息。',
        en: 'The plan cites information accessed after its submission virtual time.',
      },
    });
  }
  return issues;
}

/**
 * Demo/test adapter for a complete Skill-driven walking slice. It deliberately
 * has no durability or cross-process guarantees. A PostgreSQL implementation
 * can replace it through ExerciseService without changing HTTP handlers.
 */
export class InMemoryExerciseService implements ExerciseService {
  readonly #episodes = new Map<string, StoredEpisode>();
  readonly #submissions = new Map<string, StoredSubmission>();
  readonly #idempotency = new Map<string, IdempotencyRecord>();
  readonly #idFactory: () => string;
  readonly #now: () => Date;
  #closed = false;

  constructor(options: InMemoryExerciseServiceOptions = {}) {
    this.#idFactory = options.idFactory ?? randomUUID;
    this.#now = options.now ?? (() => new Date());
  }

  isReady(): Promise<boolean> {
    return Promise.resolve(!this.#closed);
  }

  getScenario(participant: ParticipantPrincipal): Promise<ScenarioDocument> {
    void participant;
    return Promise.resolve(DEFAULT_SCENARIO);
  }

  createEpisode(
    participant: ParticipantPrincipal,
    idempotencyKey: string,
    input: CreateEpisodeRequest,
  ): Promise<CreateEpisodeResult> {
    return Promise.resolve(
      this.idempotent(
        participant,
        'create-episode',
        idempotencyKey,
        input,
        () => {
          if (input.scenarioVersionId !== DEFAULT_SCENARIO_VERSION_ID) {
            throw new ExerciseServiceError(
              'VALIDATION_FAILED',
              '场景版本不存在。 / The scenario version does not exist.',
              { field: 'scenarioVersionId' },
            );
          }
          if (
            !participant.participantVersionIds.includes(
              input.participantVersionId,
            )
          ) {
            throw new ExerciseServiceError(
              'NOT_AUTHORIZED',
              '参与者版本不属于当前身份。 / The participant version does not belong to the current identity.',
            );
          }
          const episode = createEpisode({
            id: this.#idFactory(),
            scenarioVersionId: input.scenarioVersionId,
            participantVersionId: input.participantVersionId,
            replayStartAt: DEFAULT_SCENARIO.replayStartAt,
          });
          const stored: StoredEpisode = {
            participantId: participant.id,
            episode,
            observations: new Map(),
            events: [],
            latestSubmissionId: undefined,
            nextRevisionNo: 1,
          };
          this.#episodes.set(episode.id, stored);
          this.appendEvent(stored, 'episode.created', episode, {
            scenarioVersionId: episode.scenarioVersionId,
          });
          return {
            episode: episodeView(episode),
            links: episodeLinks(episode.id),
          };
        },
      ),
    );
  }

  getEpisode(
    participant: ParticipantPrincipal,
    episodeId: string,
  ): Promise<CreateEpisodeResult> {
    const stored = this.ownedEpisode(participant, episodeId);
    return Promise.resolve({
      episode: episodeView(stored.episode),
      links: episodeLinks(episodeId),
    });
  }

  observe(
    participant: ParticipantPrincipal,
    episodeId: string,
    idempotencyKey: string,
    input: ObserveEpisodeInput,
  ): Promise<ObserveEpisodeResult> {
    return Promise.resolve(
      this.idempotent(
        participant,
        `observe:${episodeId}`,
        idempotencyKey,
        input,
        () => {
          const stored = this.ownedEpisode(participant, episodeId);
          this.assertVersion(stored.episode, input.episodeVersion);
          const releasedIds = new Set(
            releaseInformation(stored.episode, SCENARIO_INFORMATION).map(
              ({ id }) => id,
            ),
          );
          const released = SCENARIO_INFORMATION.filter(({ id }) =>
            releasedIds.has(id),
          );
          const byId = new Map(
            released.map((information) => [information.id, information]),
          );
          const selected =
            input.informationIds === undefined
              ? released
              : input.informationIds.map((id) => {
                  const information = byId.get(id);
                  if (information === undefined) {
                    throw new ExerciseServiceError(
                      'VALIDATION_FAILED',
                      '请求的信息尚未发布。 / Requested information has not been released.',
                      { informationId: id },
                    );
                  }
                  return information;
                });
          const previouslyObserved = new Set(
            stored.episode.observedInformationIds,
          );
          const nextEpisode = recordObservation(
            stored.episode,
            selected.map(({ id }) => id),
          );
          const accessedAt = this.timestamp();
          for (const information of selected) {
            if (!stored.observations.has(information.id)) {
              stored.observations.set(
                information.id,
                this.toObservation(
                  episodeId,
                  information,
                  accessedAt,
                  stored.episode.virtualTime,
                ),
              );
            }
          }
          stored.episode = nextEpisode;
          const newIds = selected
            .map(({ id }) => id)
            .filter((id) => !previouslyObserved.has(id));
          if (newIds.length > 0) {
            this.appendEvent(stored, 'observations.recorded', nextEpisode, {
              informationIds: newIds,
            });
          }
          return {
            episode: episodeView(nextEpisode),
            observations: selected.map(({ id }) =>
              stored.observations.get(id)!,
            ),
            links: episodeLinks(episodeId),
          };
        },
      ),
    );
  }

  listObservations(
    participant: ParticipantPrincipal,
    episodeId: string,
    limit: number,
  ): Promise<readonly ObservationDto[]> {
    const stored = this.ownedEpisode(participant, episodeId);
    return Promise.resolve([...stored.observations.values()].slice(0, limit));
  }

  submitPlan(
    participant: ParticipantPrincipal,
    episodeId: string,
    idempotencyKey: string,
    input: SubmitPlanInput,
  ): Promise<SubmitPlanResult> {
    return Promise.resolve(
      this.idempotent(
        participant,
        `submit-plan:${episodeId}`,
        idempotencyKey,
        input,
        () => {
          const stored = this.ownedEpisode(participant, episodeId);
          if (input.plan.stage !== stored.episode.stageIndex + 1) {
            throw new ExerciseServiceError(
              'VALIDATION_FAILED',
              '方案阶段与当前 Episode 不一致。 / The plan stage does not match the current episode stage.',
              { expectedStage: stored.episode.stageIndex + 1 },
            );
          }
          const previousSubmissionId = stored.latestSubmissionId;
          let submissionBase = stored.episode;
          let queueExpectedVersion = input.episodeVersion;
          if (submissionBase.state === 'feedback_available') {
            if (previousSubmissionId === undefined) {
              throw new ExerciseServiceError(
                'EPISODE_STATE_CONFLICT',
                '反馈状态缺少前一提交。 / Feedback state is missing its prior submission.',
              );
            }
            const previous = this.ownedSubmission(
              participant,
              previousSubmissionId,
            );
            if (previous.evaluation.verdict === 'pass') {
              throw new ExerciseServiceError(
                'EPISODE_STATE_CONFLICT',
                '已通过的方案应按 allowedActions 推进。 / A passing plan must follow its allowedActions and advance.',
              );
            }
            submissionBase = reopenEpisodeForRevision(
              submissionBase,
              input.episodeVersion,
            );
            queueExpectedVersion = submissionBase.version;
          }
          const queued = queueSubmission(
            submissionBase,
            input.plan,
            queueExpectedVersion,
          );
          const evaluating = startEvaluation(queued, queued.version);
          const submittedAt = this.timestamp();
          const evaluation = evaluateWaterAllocationPlan({
            submission: input.plan,
            ...rulesForStage(input.plan.stage),
            evidenceTimestamps: [...stored.observations.values()].map(
              ({ informationId, accessedVirtualTime }) => ({
                informationId,
                accessedVirtualTime,
              }),
            ),
            submittedVirtualTime: stored.episode.virtualTime,
          });
          const published = publishFeedback(evaluating, evaluating.version);
          const submissionId = this.#idFactory();
          const feedbackCopyValue = feedbackCopy(evaluation.verdict);
          const allowedActions: FeedbackDto['allowedActions'] =
            evaluation.verdict === 'pass'
              ? input.plan.isFinal
                ? ['finalize']
                : ['advance']
              : ['revise_submission'];
          const feedback: FeedbackDto = Object.freeze({
            id: this.#idFactory(),
            submissionId,
            level: 2,
            evaluation,
            ...feedbackCopyValue,
            issues: feedbackIssues(evaluation),
            allowedActions,
          });
          const submission: SubmissionView = Object.freeze({
            id: submissionId,
            episodeId,
            revisionNo: stored.nextRevisionNo,
            ...(previousSubmissionId === undefined
              ? {}
              : { revisionOf: previousSubmissionId }),
            episodeVersion: input.episodeVersion,
            submittedAt,
            plan: input.plan,
          });
          const storedSubmission: StoredSubmission = {
            participantId: participant.id,
            view: submission,
            evaluation,
            feedback,
          };
          this.#submissions.set(submissionId, storedSubmission);
          stored.latestSubmissionId = submissionId;
          stored.nextRevisionNo += 1;
          stored.episode = published;
          this.appendEvent(stored, 'submission.created', queued, {
            submissionId,
            revisionNo: submission.revisionNo,
            ...(submission.revisionOf === undefined
              ? {}
              : { revisionOf: submission.revisionOf }),
            stage: input.plan.stage,
            isFinal: input.plan.isFinal,
          });
          this.appendEvent(stored, 'evaluation.completed', published, {
            submissionId,
            verdict: evaluation.verdict,
            totalScore: evaluation.metrics.totalScore,
          });
          return {
            submissionId,
            submission,
            episode: episodeView(published),
            evaluation,
            feedback,
            links: submissionLinks(episodeId, submissionId),
          };
        },
      ),
    );
  }

  getSubmissionEvaluation(
    participant: ParticipantPrincipal,
    submissionId: string,
  ): Promise<EvaluationQueryResult> {
    const submission = this.ownedSubmission(participant, submissionId);
    return Promise.resolve({
      status: 'ready',
      submissionId,
      evaluation: submission.evaluation,
      feedback: submission.feedback,
      links: submissionLinks(submission.view.episodeId, submissionId),
    });
  }

  getSubmission(
    participant: ParticipantPrincipal,
    submissionId: string,
  ): Promise<SubmissionView> {
    return Promise.resolve(
      this.ownedSubmission(participant, submissionId).view,
    );
  }

  getFeedback(
    participant: ParticipantPrincipal,
    episodeId: string,
  ): Promise<FeedbackQueryResult> {
    const stored = this.ownedEpisode(participant, episodeId);
    if (stored.latestSubmissionId === undefined) {
      throw new ExerciseServiceError(
        'EPISODE_STATE_CONFLICT',
        '当前尚无可用反馈。 / Feedback is not available for the current episode.',
      );
    }
    const submission = this.ownedSubmission(
      participant,
      stored.latestSubmissionId,
    );
    return Promise.resolve({
      status: 'ready',
      feedback: submission.feedback,
      links: episodeLinks(episodeId),
    });
  }

  advance(
    participant: ParticipantPrincipal,
    episodeId: string,
    idempotencyKey: string,
    input: AdvanceEpisodeInput,
  ): Promise<AdvanceEpisodeResult> {
    return Promise.resolve(
      this.idempotent(
        participant,
        `advance:${episodeId}`,
        idempotencyKey,
        input,
        () => {
          const stored = this.ownedEpisode(participant, episodeId);
          const submissionId = stored.latestSubmissionId;
          if (submissionId === undefined) {
            throw new ExerciseServiceError(
              'EPISODE_STATE_CONFLICT',
              '推进前必须先获得反馈。 / Feedback is required before advancing.',
            );
          }
          const submission = this.ownedSubmission(participant, submissionId);
          if (submission.evaluation.verdict !== 'pass') {
            throw new ExerciseServiceError(
              'EPISODE_STATE_CONFLICT',
              '未通过的方案必须先修订，不能推进。 / A non-passing plan must be revised before advancing.',
            );
          }
          let next: Episode;
          let eventType: 'episode.advanced' | 'episode.completed';
          if (submission.view.plan.isFinal) {
            next = completeEpisode(stored.episode, input.episodeVersion);
            eventType = 'episode.completed';
          } else {
            const checkpoint =
              DEFAULT_SCENARIO.checkpoints[stored.episode.stageIndex + 1];
            if (checkpoint === undefined) {
              throw new ExerciseServiceError(
                'EPISODE_STATE_CONFLICT',
                '最后阶段需要提交最终方案。 / A final plan is required at the last stage.',
              );
            }
            next = advanceEpisode(stored.episode, {
              expectedVersion: input.episodeVersion,
              nextCheckpoint: checkpoint.virtualTime,
            });
            eventType = 'episode.advanced';
          }
          stored.episode = next;
          this.appendEvent(stored, eventType, next, {
            fromSubmissionId: submissionId,
          });
          return {
            episode: episodeView(next),
            links: episodeLinks(episodeId),
          };
        },
      ),
    );
  }

  listEvents(
    participant: ParticipantPrincipal,
    episodeId: string,
    after: number,
    limit: number,
  ): Promise<readonly EpisodeEvent[]> {
    const stored = this.ownedEpisode(participant, episodeId);
    return Promise.resolve(
      stored.events.filter(({ sequence }) => sequence > after).slice(0, limit),
    );
  }

  close(): Promise<void> {
    this.#closed = true;
    return Promise.resolve();
  }

  private assertVersion(episode: Episode, expectedVersion: number): void {
    if (episode.version !== expectedVersion) {
      throw new ExerciseServiceError(
        'EPISODE_VERSION_CONFLICT',
        `Episode 版本冲突；当前版本为 ${episode.version}。 / Episode version conflict; the current version is ${episode.version}.`,
        { currentVersion: episode.version },
      );
    }
  }

  private ownedEpisode(
    participant: ParticipantPrincipal,
    episodeId: string,
  ): StoredEpisode {
    const stored = this.#episodes.get(episodeId);
    if (stored === undefined || stored.participantId !== participant.id) {
      throw new ExerciseServiceError(
        'EPISODE_NOT_FOUND',
        'Episode 不存在或当前参与者无权访问。 / The episode does not exist or is not accessible to this participant.',
      );
    }
    return stored;
  }

  private ownedSubmission(
    participant: ParticipantPrincipal,
    submissionId: string,
  ): StoredSubmission {
    const stored = this.#submissions.get(submissionId);
    if (stored === undefined || stored.participantId !== participant.id) {
      throw new ExerciseServiceError(
        'EPISODE_NOT_FOUND',
        'Submission 不存在或当前参与者无权访问。 / The submission does not exist or is not accessible to this participant.',
      );
    }
    return stored;
  }

  private idempotent<T>(
    participant: ParticipantPrincipal,
    scope: string,
    key: string,
    request: unknown,
    operation: () => T,
  ): T {
    const cacheKey = `${participant.id}:${scope}:${key}`;
    const hash = requestHash(request);
    const previous = this.#idempotency.get(cacheKey);
    if (previous !== undefined) {
      if (previous.requestHash !== hash) {
        throw new ExerciseServiceError(
          'IDEMPOTENCY_CONFLICT',
          '幂等键已用于不同请求。 / The idempotency key was already used for a different request.',
        );
      }
      return previous.response as T;
    }
    const response = operation();
    this.#idempotency.set(cacheKey, { requestHash: hash, response });
    return response;
  }

  private appendEvent(
    stored: StoredEpisode,
    type: EpisodeEvent['type'],
    episode: Episode,
    data: Readonly<Record<string, unknown>>,
  ): void {
    stored.events.push(
      Object.freeze({
        id: this.#idFactory(),
        episodeId: episode.id,
        sequence: stored.events.length + 1,
        type,
        episodeVersion: episode.version,
        virtualTime: episode.virtualTime,
        recordedAt: this.timestamp(),
        data,
      }),
    );
  }

  private timestamp(): string {
    return this.#now().toISOString();
  }

  private toObservation(
    episodeId: string,
    information: ScenarioInformation,
    accessedTime: string,
    accessedVirtualTime: string,
  ): ObservationDto {
    return Object.freeze({
      id: this.#idFactory(),
      episodeId,
      informationId: information.informationId,
      informationType: information.informationType,
      eventTime: information.eventTime,
      observedTime: information.observedTime,
      ingestedTime: information.ingestedTime,
      releasedTime: information.releasedTime,
      accessedTime,
      accessedVirtualTime,
      ...(information.supersedesInformationId === undefined
        ? {}
        : { supersedesInformationId: information.supersedesInformationId }),
      payload: information.payload,
      ...(information.sourceUrl === undefined
        ? {}
        : { sourceUrl: information.sourceUrl }),
      isSynthetic: information.isSynthetic,
    });
  }
}
