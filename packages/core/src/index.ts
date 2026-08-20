export type EpisodeState =
  | 'awaiting_submission'
  | 'evaluation_queued'
  | 'evaluating'
  | 'feedback_ready'
  | 'completed';

export interface Episode {
  readonly id: string;
  readonly scenarioVersionId: string;
  readonly participantVersionId: string;
  readonly state: EpisodeState;
  readonly stageIndex: number;
  readonly virtualTime: string;
  readonly version: number;
  readonly observedInformationIds: readonly string[];
}

export interface InformationItem {
  readonly id: string;
  readonly eventTime: string;
  readonly observedTime: string;
  readonly ingestedTime: string;
  readonly releasedTime: string;
}

export interface PredictionClaim {
  readonly id: string;
  readonly riskPointId: string;
  readonly horizonMinutes: 30 | 60;
  readonly probability: number;
  readonly riskLevel: 'low' | 'medium' | 'high' | 'critical';
  readonly evidenceRefs: readonly string[];
}

export interface PredictionSubmission {
  readonly claims: readonly PredictionClaim[];
  readonly isFinal: boolean;
}

export interface FloodOutcome {
  readonly riskPointId: string;
  readonly occurred: boolean;
}

export interface EvidenceTimestamp {
  readonly informationId: string;
  readonly accessedTime: string;
}

export interface EvaluationResult {
  readonly verdict: 'pass' | 'partial' | 'fail';
  readonly metrics: {
    readonly precision: number;
    readonly recall: number;
    readonly brierScore: number;
    readonly evidenceCoverage: number;
    readonly timeTravelViolations: number;
  };
}

export class DomainError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

function notImplemented(): never {
  throw new Error('NOT_IMPLEMENTED');
}

export function createEpisode(_input: {
  id: string;
  scenarioVersionId: string;
  participantVersionId: string;
  replayStartAt: string;
}): Episode {
  return notImplemented();
}

export function releaseInformation(
  _episode: Episode,
  _items: readonly InformationItem[],
): readonly InformationItem[] {
  return notImplemented();
}

export function recordObservation(
  _episode: Episode,
  _informationIds: readonly string[],
): Episode {
  return notImplemented();
}

export function queueSubmission(
  _episode: Episode,
  _submission: PredictionSubmission,
  _expectedVersion: number,
): Episode {
  return notImplemented();
}

export function startEvaluation(
  _episode: Episode,
  _expectedVersion: number,
): Episode {
  return notImplemented();
}

export function publishFeedback(
  _episode: Episode,
  _expectedVersion: number,
): Episode {
  return notImplemented();
}

export function advanceEpisode(
  _episode: Episode,
  _input: { expectedVersion: number; nextCheckpoint: string },
): Episode {
  return notImplemented();
}

export function completeEpisode(
  _episode: Episode,
  _expectedVersion: number,
): Episode {
  return notImplemented();
}

export function evaluateFloodPrediction(_input: {
  submission: PredictionSubmission;
  outcomes: readonly FloodOutcome[];
  evidenceTimestamps: readonly EvidenceTimestamp[];
  submittedAt: string;
}): EvaluationResult {
  return notImplemented();
}
