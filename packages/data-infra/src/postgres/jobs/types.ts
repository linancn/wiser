export type DataJobStatus =
  | 'PENDING'
  | 'RUNNING'
  | 'WAITING_INPUT'
  | 'WAITING_REVIEW'
  | 'RETRY_SCHEDULED'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'CANCELLED'
  | 'DEAD_LETTER';

export type DataSecurityLevel =
  'L0_PUBLIC' | 'L1_INTERNAL' | 'L2_RESTRICTED' | 'L3_CONFIDENTIAL';

export interface DataJobScope {
  readonly tenantId: string;
  readonly projectId: string;
  readonly maxSecurityLevel: DataSecurityLevel;
  readonly policyVersion: number;
}

export interface DataJobLease {
  readonly jobId: string;
  readonly workerId: string;
  readonly rowVersion: number;
}

export interface ClaimedDataJob {
  readonly jobId: string;
  readonly operationId: string;
  readonly jobType: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly attemptCount: number;
  readonly maxAttempts: number;
  readonly leaseOwner: string;
  readonly leaseExpiresAt: string;
  readonly rowVersion: number;
  readonly cancelRequested: boolean;
}

export type DataJobSettlementStatus =
  'SUCCEEDED' | 'WAITING_INPUT' | 'WAITING_REVIEW' | 'CANCELLED';

export interface DataJobSettlement {
  readonly status: DataJobSettlementStatus;
  readonly result?: Readonly<Record<string, unknown>>;
}

export interface DataJobFailure {
  readonly category: string;
  readonly retryable: boolean;
  readonly detail?: Readonly<Record<string, unknown>>;
}

export interface DataJobLifecycleResult {
  readonly jobId: string;
  readonly status: DataJobStatus;
  readonly rowVersion: number;
  readonly nextAttemptAt?: string;
}

export interface DataJobRepository {
  recoverTimedOut(
    scope: DataJobScope,
    observedAt: string,
    limit?: number,
  ): Promise<readonly DataJobLifecycleResult[]>;
  claim(
    scope: DataJobScope,
    workerId: string,
    limit: number,
    leaseMs: number,
    observedAt: string,
  ): Promise<readonly ClaimedDataJob[]>;
  heartbeat(
    scope: DataJobScope,
    lease: DataJobLease,
    leaseMs: number,
    observedAt: string,
  ): Promise<ClaimedDataJob>;
  settle(
    scope: DataJobScope,
    lease: DataJobLease,
    settlement: DataJobSettlement,
    observedAt: string,
  ): Promise<DataJobLifecycleResult>;
  fail(
    scope: DataJobScope,
    lease: DataJobLease,
    failure: DataJobFailure,
    observedAt: string,
  ): Promise<DataJobLifecycleResult>;
  close(): Promise<void>;
}

export interface DataJobQueryResult {
  readonly rows: readonly Record<string, unknown>[];
}

export interface DataJobDatabaseClient {
  query(text: string, values?: readonly unknown[]): Promise<DataJobQueryResult>;
  release(): void;
}

export interface DataJobDatabasePool {
  connect(): Promise<DataJobDatabaseClient>;
  end(): Promise<void>;
}
