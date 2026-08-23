import type { DataCapabilityId, OperationStatus } from '@wiser/data-contracts';

import { DataFoundationDomainError } from '../domain-error.js';

type OperationTransitionPolicy = Readonly<
  Record<OperationStatus, readonly OperationStatus[]>
>;

export const OPERATION_TRANSITION_POLICY = Object.freeze({
  PENDING: Object.freeze([
    'RUNNING',
    'WAITING_INPUT',
    'WAITING_REVIEW',
    'FAILED',
    'CANCELLED',
  ]),
  RUNNING: Object.freeze([
    'WAITING_INPUT',
    'WAITING_REVIEW',
    'SUCCEEDED',
    'FAILED',
    'CANCELLED',
  ]),
  WAITING_INPUT: Object.freeze([
    'RUNNING',
    'WAITING_REVIEW',
    'FAILED',
    'CANCELLED',
  ]),
  WAITING_REVIEW: Object.freeze([
    'RUNNING',
    'WAITING_INPUT',
    'SUCCEEDED',
    'FAILED',
    'CANCELLED',
  ]),
  SUCCEEDED: Object.freeze([]),
  FAILED: Object.freeze([]),
  CANCELLED: Object.freeze([]),
} satisfies OperationTransitionPolicy);

export interface OperationTransitionContext {
  readonly capabilityId?: DataCapabilityId;
}

function isUploadCompletionTransition(
  from: OperationStatus,
  to: OperationStatus,
  context: OperationTransitionContext,
): boolean {
  return (
    context.capabilityId === 'data.uploadSession.create' &&
    from === 'WAITING_INPUT' &&
    to === 'SUCCEEDED'
  );
}

export class InvalidOperationTransitionError extends DataFoundationDomainError {
  constructor(
    readonly from: OperationStatus,
    readonly to: OperationStatus,
  ) {
    super(
      'INVALID_OPERATION_TRANSITION',
      `Operation cannot transition from ${from} to ${to}.`,
    );
    this.name = 'InvalidOperationTransitionError';
  }
}

export function canTransitionOperationStatus(
  from: OperationStatus,
  to: OperationStatus,
  context: OperationTransitionContext = {},
): boolean {
  const destinations: readonly OperationStatus[] =
    OPERATION_TRANSITION_POLICY[from];
  return (
    destinations.includes(to) || isUploadCompletionTransition(from, to, context)
  );
}

export function transitionOperationStatus(
  from: OperationStatus,
  to: OperationStatus,
  context: OperationTransitionContext = {},
): OperationStatus {
  if (!canTransitionOperationStatus(from, to, context)) {
    throw new InvalidOperationTransitionError(from, to);
  }

  return to;
}
