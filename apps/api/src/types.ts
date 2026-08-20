import type {
  AllocationPlanSubmission,
  CreateEpisodeRequest,
  FeedbackDto,
  ObservationDto,
} from '@agent-excon/contracts';
import type { Episode, EvaluationResult } from '@agent-excon/core';

import type { ScenarioDocument } from './scenario.js';

export type ApiErrorCode =
  | 'VALIDATION_FAILED'
  | 'EPISODE_NOT_FOUND'
  | 'EPISODE_VERSION_CONFLICT'
  | 'EPISODE_STATE_CONFLICT'
  | 'EVIDENCE_NOT_OBSERVED'
  | 'EVIDENCE_NOT_RELEVANT'
  | 'IDEMPOTENCY_CONFLICT'
  | 'NOT_AUTHORIZED'
  | 'INTERNAL_ERROR';

export class ExerciseServiceError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
    readonly details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = 'ExerciseServiceError';
  }
}

export interface ParticipantPrincipal {
  readonly id: string;
  readonly participantVersionIds: readonly string[];
}

export interface ParticipantAuthenticator {
  authenticate(token: string): Promise<ParticipantPrincipal | null>;
}

export interface EpisodeView extends Episode {
  readonly observedInformationIds: readonly string[];
}

export interface EpisodeEvent {
  readonly id: string;
  readonly episodeId: string;
  readonly sequence: number;
  readonly type:
    | 'episode.created'
    | 'observations.recorded'
    | 'submission.created'
    | 'evaluation.completed'
    | 'episode.advanced'
    | 'episode.completed';
  readonly episodeVersion: number;
  readonly virtualTime: string;
  readonly recordedAt: string;
  readonly data: Readonly<Record<string, unknown>>;
}

export interface SubmissionView {
  readonly id: string;
  readonly episodeId: string;
  readonly revisionNo: number;
  readonly revisionOf?: string;
  readonly episodeVersion: number;
  readonly submittedAt: string;
  readonly plan: AllocationPlanSubmission;
}

export interface EpisodeLinks {
  readonly episode: string;
  readonly observations: string;
  readonly feedback: string;
  readonly events: string;
}

export interface SubmissionLinks extends EpisodeLinks {
  readonly submission: string;
  readonly evaluation: string;
}

export interface CreateEpisodeResult {
  readonly episode: EpisodeView;
  readonly links: EpisodeLinks;
}

export interface ObserveEpisodeInput {
  readonly episodeVersion: number;
  readonly informationIds?: readonly string[];
}

export interface ObserveEpisodeResult {
  readonly episode: EpisodeView;
  readonly observations: readonly ObservationDto[];
  readonly links: EpisodeLinks;
}

export interface SubmitPlanInput {
  readonly episodeVersion: number;
  readonly plan: AllocationPlanSubmission;
}

export interface SubmitPlanResult {
  readonly submissionId: string;
  readonly submission: SubmissionView;
  readonly episode: EpisodeView;
  readonly evaluation: EvaluationResult;
  readonly feedback: FeedbackDto;
  readonly links: SubmissionLinks;
}

export interface AdvanceEpisodeInput {
  readonly episodeVersion: number;
}

export interface AdvanceEpisodeResult {
  readonly episode: EpisodeView;
  readonly links: EpisodeLinks;
}

export interface ReadyEvaluation {
  readonly status: 'ready';
  readonly submissionId: string;
  readonly evaluation: EvaluationResult;
  readonly feedback: FeedbackDto;
  readonly links: SubmissionLinks;
}

export interface PendingEvaluation {
  readonly status: 'pending';
  readonly submissionId: string;
  readonly links: SubmissionLinks;
}

export type EvaluationQueryResult = ReadyEvaluation | PendingEvaluation;

export interface ReadyFeedback {
  readonly status: 'ready';
  readonly feedback: FeedbackDto;
  readonly links: EpisodeLinks;
}

export interface PendingFeedback {
  readonly status: 'pending';
  readonly links: EpisodeLinks;
}

export type FeedbackQueryResult = ReadyFeedback | PendingFeedback;

export interface ExerciseService {
  isReady(): Promise<boolean>;
  getScenario(participant: ParticipantPrincipal): Promise<ScenarioDocument>;
  createEpisode(
    participant: ParticipantPrincipal,
    idempotencyKey: string,
    input: CreateEpisodeRequest,
  ): Promise<CreateEpisodeResult>;
  getEpisode(
    participant: ParticipantPrincipal,
    episodeId: string,
  ): Promise<CreateEpisodeResult>;
  observe(
    participant: ParticipantPrincipal,
    episodeId: string,
    idempotencyKey: string,
    input: ObserveEpisodeInput,
  ): Promise<ObserveEpisodeResult>;
  listObservations(
    participant: ParticipantPrincipal,
    episodeId: string,
    limit: number,
  ): Promise<readonly ObservationDto[]>;
  submitPlan(
    participant: ParticipantPrincipal,
    episodeId: string,
    idempotencyKey: string,
    input: SubmitPlanInput,
  ): Promise<SubmitPlanResult>;
  getSubmission(
    participant: ParticipantPrincipal,
    submissionId: string,
  ): Promise<SubmissionView>;
  getSubmissionEvaluation(
    participant: ParticipantPrincipal,
    submissionId: string,
  ): Promise<EvaluationQueryResult>;
  getFeedback(
    participant: ParticipantPrincipal,
    episodeId: string,
  ): Promise<FeedbackQueryResult>;
  advance(
    participant: ParticipantPrincipal,
    episodeId: string,
    idempotencyKey: string,
    input: AdvanceEpisodeInput,
  ): Promise<AdvanceEpisodeResult>;
  listEvents(
    participant: ParticipantPrincipal,
    episodeId: string,
    after: number,
    limit: number,
  ): Promise<readonly EpisodeEvent[]>;
  close(): Promise<void>;
}
