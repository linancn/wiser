import type { OperationStatus } from '@wiser/data-contracts';

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
  WAITING_INPUT: Object.freeze(['RUNNING', 'FAILED', 'CANCELLED']),
  WAITING_REVIEW: Object.freeze([
    'RUNNING',
    'SUCCEEDED',
    'FAILED',
    'CANCELLED',
  ]),
  SUCCEEDED: Object.freeze([]),
  FAILED: Object.freeze([]),
  CANCELLED: Object.freeze([]),
} satisfies OperationTransitionPolicy);

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
): boolean {
  const destinations: readonly OperationStatus[] =
    OPERATION_TRANSITION_POLICY[from];
  return destinations.includes(to);
}

export function transitionOperationStatus(
  from: OperationStatus,
  to: OperationStatus,
): OperationStatus {
  if (!canTransitionOperationStatus(from, to)) {
    throw new InvalidOperationTransitionError(from, to);
  }

  return to;
}
