import {
  assertAggregateVersion,
  fail,
  requireNonEmpty,
  toEpoch,
} from './shared.js';

export type FeedbackAction =
  'revise_task' | 'resubmit' | 'endorse' | 'request_clarification';

export interface FeedbackActionGrant {
  readonly id: string;
  readonly targetRunAgentId: string;
  readonly targetTaskId: string;
  readonly action: FeedbackAction;
  readonly predecessorSubmissionId?: string;
  readonly evaluationId: string;
  readonly issuedRunSeq: number;
  readonly issuedAt: string;
  readonly expiresVirtualAt?: string;
  readonly expiresAt?: string;
  readonly maxUses: number;
  readonly usedCount: number;
  readonly revokedRunSeq?: number;
  readonly scopeHash: string;
  readonly version: number;
}

export function createFeedbackActionGrant(input: {
  id: string;
  targetRunAgentId: string;
  targetTaskId: string;
  action: FeedbackAction;
  predecessorSubmissionId?: string;
  evaluationId: string;
  issuedRunSeq: number;
  issuedAt: string;
  expiresVirtualAt?: string;
  expiresAt?: string;
  maxUses: number;
  scopeHash: string;
}): FeedbackActionGrant {
  requireNonEmpty(input.id, 'id');
  requireNonEmpty(input.targetRunAgentId, 'targetRunAgentId');
  requireNonEmpty(input.targetTaskId, 'targetTaskId');
  requireNonEmpty(input.evaluationId, 'evaluationId');
  requireNonEmpty(input.scopeHash, 'scopeHash');
  toEpoch(input.issuedAt, 'issuedAt');
  if (!Number.isInteger(input.issuedRunSeq) || input.issuedRunSeq < 1) {
    fail('INVALID_GRANT_RUN_SEQ', 'issuedRunSeq must be positive.');
  }
  if (!Number.isInteger(input.maxUses) || input.maxUses < 1) {
    fail('INVALID_GRANT_MAX_USES', 'maxUses must be a positive integer.');
  }
  if (input.expiresAt !== undefined) {
    toEpoch(input.expiresAt, 'expiresAt');
  }
  if (input.expiresVirtualAt !== undefined) {
    toEpoch(input.expiresVirtualAt, 'expiresVirtualAt');
  }
  return Object.freeze({
    id: input.id,
    targetRunAgentId: input.targetRunAgentId,
    targetTaskId: input.targetTaskId,
    action: input.action,
    ...(input.predecessorSubmissionId === undefined
      ? {}
      : { predecessorSubmissionId: input.predecessorSubmissionId }),
    evaluationId: input.evaluationId,
    issuedRunSeq: input.issuedRunSeq,
    issuedAt: input.issuedAt,
    ...(input.expiresVirtualAt === undefined
      ? {}
      : { expiresVirtualAt: input.expiresVirtualAt }),
    ...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt }),
    maxUses: input.maxUses,
    usedCount: 0,
    scopeHash: input.scopeHash,
    version: 1,
  });
}

export function consumeFeedbackActionGrant(
  grant: FeedbackActionGrant,
  input: {
    expectedVersion: number;
    runAgentId: string;
    taskId: string;
    action: FeedbackAction;
    predecessorSubmissionId?: string;
    evaluationId: string;
    scopeHash: string;
    now: string;
    virtualTime: string;
  },
): FeedbackActionGrant {
  assertAggregateVersion({
    actual: grant.version,
    expected: input.expectedVersion,
    code: 'FEEDBACK_GRANT_VERSION_CONFLICT',
    aggregate: 'FeedbackActionGrant',
  });
  if (grant.revokedRunSeq !== undefined) {
    fail(
      'FEEDBACK_GRANT_REVOKED',
      `Feedback action grant ${grant.id} was revoked.`,
    );
  }
  if (
    grant.targetRunAgentId !== input.runAgentId ||
    grant.targetTaskId !== input.taskId ||
    grant.action !== input.action ||
    grant.predecessorSubmissionId !== input.predecessorSubmissionId ||
    grant.evaluationId !== input.evaluationId ||
    grant.scopeHash !== input.scopeHash
  ) {
    fail(
      'FEEDBACK_GRANT_SCOPE_MISMATCH',
      `Feedback action grant ${grant.id} cannot be transferred or used outside its signed scope.`,
    );
  }
  const now = toEpoch(input.now, 'now');
  const virtualTime = toEpoch(input.virtualTime, 'virtualTime');
  if (
    (grant.expiresAt !== undefined &&
      now >= toEpoch(grant.expiresAt, 'expiresAt')) ||
    (grant.expiresVirtualAt !== undefined &&
      virtualTime >= toEpoch(grant.expiresVirtualAt, 'expiresVirtualAt'))
  ) {
    fail(
      'FEEDBACK_GRANT_EXPIRED',
      `Feedback action grant ${grant.id} has expired.`,
    );
  }
  if (grant.usedCount >= grant.maxUses) {
    fail(
      'FEEDBACK_GRANT_EXHAUSTED',
      `Feedback action grant ${grant.id} has no remaining uses.`,
    );
  }
  return Object.freeze({
    ...grant,
    usedCount: grant.usedCount + 1,
    version: grant.version + 1,
  });
}

export function revokeFeedbackActionGrant(
  grant: FeedbackActionGrant,
  input: { readonly expectedVersion: number; readonly revokedRunSeq: number },
): FeedbackActionGrant {
  if (grant.revokedRunSeq !== undefined) {
    return grant;
  }
  assertAggregateVersion({
    actual: grant.version,
    expected: input.expectedVersion,
    code: 'FEEDBACK_GRANT_VERSION_CONFLICT',
    aggregate: 'FeedbackActionGrant',
  });
  if (
    !Number.isInteger(input.revokedRunSeq) ||
    input.revokedRunSeq <= grant.issuedRunSeq
  ) {
    fail(
      'INVALID_GRANT_REVOCATION_SEQ',
      'Grant revocation must be a later RunEvent.',
    );
  }
  return Object.freeze({
    ...grant,
    revokedRunSeq: input.revokedRunSeq,
    version: grant.version + 1,
  });
}
