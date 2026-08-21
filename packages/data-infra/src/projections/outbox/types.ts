export const PROJECTION_KINDS = [
  'POSTGIS',
  'WEAVIATE',
  'OPENSEARCH',
  'NEO4J',
  'STAC',
] as const;

export type ProjectionKind = (typeof PROJECTION_KINDS)[number];
export type ProjectionState = 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';

export type ProjectionSecurityLevel =
  'L0_PUBLIC' | 'L1_INTERNAL' | 'L2_RESTRICTED' | 'L3_CONFIDENTIAL';

export interface ProjectionScope {
  readonly tenantId: string;
  readonly projectId: string;
  readonly maxSecurityLevel: ProjectionSecurityLevel;
  readonly policyVersion: number;
}

export interface ProjectionEvent {
  readonly outboxEventId: string;
  readonly eventId: string;
  readonly tenantId: string;
  readonly projectId: string;
  readonly dataItemId: string;
  readonly versionId: string;
  readonly eventType: 'data.version.committed';
  readonly idempotencyKey: string;
  readonly securityLevel: ProjectionSecurityLevel;
  readonly policyVersion: number;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly createdAt: string;
}

export interface ProjectionTarget {
  readonly kind: ProjectionKind;
  project(event: ProjectionEvent): Promise<void>;
}

export interface ProjectionOutboxRepository {
  readBatch(
    scope: ProjectionScope,
    consumerName: string,
    limit: number,
  ): Promise<readonly ProjectionEvent[]>;
  prepare(
    event: ProjectionEvent,
    kinds: readonly ProjectionKind[],
  ): Promise<ReadonlyMap<ProjectionKind, ProjectionState>>;
  markRunning(event: ProjectionEvent, kind: ProjectionKind): Promise<void>;
  markSucceeded(event: ProjectionEvent, kind: ProjectionKind): Promise<void>;
  markFailed(
    event: ProjectionEvent,
    kind: ProjectionKind,
    category: string,
  ): Promise<void>;
  advanceCheckpoint(
    scope: ProjectionScope,
    consumerName: string,
    event: ProjectionEvent,
  ): Promise<void>;
  close(): Promise<void>;
}

export interface ProjectionBatchResult {
  readonly readEvents: number;
  readonly checkpointedEvents: number;
  readonly attemptedTargets: number;
  readonly skippedTargets: number;
}
