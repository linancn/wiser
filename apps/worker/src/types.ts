import type {
  EvaluationResult,
  evaluateWaterAllocationPlan,
} from '@agent-excon/core';

export type EvaluationInput = Parameters<typeof evaluateWaterAllocationPlan>[0];

export interface ClaimedEvaluationJob {
  readonly id: string;
  readonly episodeId: string;
  readonly submissionId: string;
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly leaseExpiresAt: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface EvaluationWorkItem extends ClaimedEvaluationJob {
  readonly recipientUserId: string;
  readonly episodeVirtualTime: string;
  readonly isFinal: boolean;
  readonly feedbackLevel: number;
  readonly rulesVersion: string;
  readonly outcomeVersion: string;
  readonly input: EvaluationInput;
}

export type FailureDisposition = 'retry_scheduled' | 'dead' | 'lease_lost';

export interface EvaluationRepository {
  recoverExpiredLeases(): Promise<number>;
  claim(
    workerId: string,
    limit: number,
    leaseMs: number,
  ): Promise<readonly ClaimedEvaluationJob[]>;
  load(job: ClaimedEvaluationJob): Promise<EvaluationWorkItem>;
  complete(
    workerId: string,
    item: EvaluationWorkItem,
    result: EvaluationResult,
  ): Promise<void>;
  fail(
    workerId: string,
    job: ClaimedEvaluationJob,
    errorCode: string,
  ): Promise<FailureDisposition>;
  close(): Promise<void>;
}

export interface StructuredLogger {
  info(event: string, fields?: Readonly<Record<string, unknown>>): void;
  warn(event: string, fields?: Readonly<Record<string, unknown>>): void;
  error(event: string, fields?: Readonly<Record<string, unknown>>): void;
}

export type WorkerPhase = 'idle' | 'running' | 'draining' | 'stopped';

export interface WorkerHealth {
  readonly live: boolean;
  readonly ready: boolean;
  readonly phase: WorkerPhase;
  readonly workerId: string;
  readonly startedAt: string | null;
  readonly lastPollAt: string | null;
  readonly lastSuccessfulPollAt: string | null;
  readonly lastCompletedAt: string | null;
  readonly lastErrorAt: string | null;
  readonly lastErrorCode: string | null;
  readonly consecutivePollFailures: number;
  readonly inFlightJobs: number;
  readonly claimedJobs: number;
  readonly completedJobs: number;
  readonly failedJobs: number;
  readonly recoveredLeases: number;
}

export class WorkerError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'WorkerError';
  }
}
