import type { IngestionState } from '@wiser/data-contracts';

import { DataFoundationDomainError } from '../domain-error.js';

type IngestionTransitionPolicy = Readonly<
  Record<IngestionState, readonly IngestionState[]>
>;

export const INGESTION_TRANSITION_POLICY = Object.freeze({
  RECEIVED: Object.freeze(['QUARANTINED', 'FAILED', 'CANCELLED']),
  QUARANTINED: Object.freeze(['SECURITY_SCANNED', 'FAILED', 'CANCELLED']),
  SECURITY_SCANNED: Object.freeze([
    'FINGERPRINTED',
    'REJECTED',
    'FAILED',
    'CANCELLED',
  ]),
  FINGERPRINTED: Object.freeze(['PROFILED', 'FAILED', 'CANCELLED']),
  PROFILED: Object.freeze(['CLASSIFIED', 'FAILED', 'CANCELLED']),
  CLASSIFIED: Object.freeze(['SCHEMA_MAPPED', 'FAILED', 'CANCELLED']),
  SCHEMA_MAPPED: Object.freeze(['SEMANTIC_MAPPED', 'FAILED', 'CANCELLED']),
  SEMANTIC_MAPPED: Object.freeze(['VALIDATED', 'FAILED', 'CANCELLED']),
  VALIDATED: Object.freeze([
    'SPATIOTEMPORAL_ALIGNED',
    'REJECTED',
    'FAILED',
    'CANCELLED',
  ]),
  SPATIOTEMPORAL_ALIGNED: Object.freeze([
    'REVIEW_REQUIRED',
    'APPROVED',
    'FAILED',
    'CANCELLED',
  ]),
  REVIEW_REQUIRED: Object.freeze([
    'APPROVED',
    'REJECTED',
    'FAILED',
    'CANCELLED',
  ]),
  APPROVED: Object.freeze(['COMMITTED', 'FAILED', 'CANCELLED']),
  REJECTED: Object.freeze([]),
  COMMITTED: Object.freeze(['PROJECTING', 'FAILED']),
  PROJECTING: Object.freeze(['PUBLISHED', 'FAILED']),
  PUBLISHED: Object.freeze([]),
  FAILED: Object.freeze([]),
  CANCELLED: Object.freeze([]),
} satisfies IngestionTransitionPolicy);

export class InvalidIngestionTransitionError extends DataFoundationDomainError {
  constructor(
    readonly from: IngestionState,
    readonly to: IngestionState,
  ) {
    super(
      'INVALID_INGESTION_TRANSITION',
      `Ingestion cannot transition from ${from} to ${to}.`,
    );
    this.name = 'InvalidIngestionTransitionError';
  }
}

export function canTransitionIngestionState(
  from: IngestionState,
  to: IngestionState,
): boolean {
  const destinations: readonly IngestionState[] =
    INGESTION_TRANSITION_POLICY[from];
  return destinations.includes(to);
}

export function transitionIngestionState(
  from: IngestionState,
  to: IngestionState,
): IngestionState {
  if (!canTransitionIngestionState(from, to)) {
    throw new InvalidIngestionTransitionError(from, to);
  }

  return to;
}
