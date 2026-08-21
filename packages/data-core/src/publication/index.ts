import type { AcceptanceStatus, IngestionState } from '@wiser/data-contracts';

export type ProjectionStatus = 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';

export interface ProjectionResult {
  readonly projectionId: string;
  readonly status: ProjectionStatus;
}

export type PublicationBlockReason =
  | 'INGESTION_NOT_PROJECTING'
  | 'AUTHORITATIVE_VERSION_NOT_COMMITTED'
  | 'QUALITY_GATE_FAILED'
  | 'ACCEPTANCE_NOT_ELIGIBLE'
  | 'PROJECTIONS_MISSING'
  | 'DUPLICATE_PROJECTION'
  | 'PROJECTIONS_INCOMPLETE';

export interface PublicationEligibilityInput {
  readonly ingestionState: IngestionState;
  readonly authoritativeVersionCommitted: boolean;
  readonly qualityGatePassed: boolean;
  readonly acceptanceStatus: AcceptanceStatus;
  readonly projections: readonly ProjectionResult[];
}

export interface PublicationEligibilityDecision {
  readonly eligible: boolean;
  readonly reasons: readonly PublicationBlockReason[];
}

const ELIGIBLE_ACCEPTANCE_STATUSES = new Set<AcceptanceStatus>([
  'PASSED',
  'CONDITIONALLY_PASSED',
]);

export function evaluatePublicationEligibility(
  input: PublicationEligibilityInput,
): PublicationEligibilityDecision {
  const reasons: PublicationBlockReason[] = [];

  if (input.ingestionState !== 'PROJECTING') {
    reasons.push('INGESTION_NOT_PROJECTING');
  }
  if (!input.authoritativeVersionCommitted) {
    reasons.push('AUTHORITATIVE_VERSION_NOT_COMMITTED');
  }
  if (!input.qualityGatePassed) {
    reasons.push('QUALITY_GATE_FAILED');
  }
  if (!ELIGIBLE_ACCEPTANCE_STATUSES.has(input.acceptanceStatus)) {
    reasons.push('ACCEPTANCE_NOT_ELIGIBLE');
  }

  if (input.projections.length === 0) {
    reasons.push('PROJECTIONS_MISSING');
  } else {
    const projectionIds = new Set<string>();
    let duplicate = false;
    for (const projection of input.projections) {
      if (projectionIds.has(projection.projectionId)) {
        duplicate = true;
      }
      projectionIds.add(projection.projectionId);
    }
    if (duplicate) {
      reasons.push('DUPLICATE_PROJECTION');
    }
    if (
      input.projections.some((projection) => projection.status !== 'SUCCEEDED')
    ) {
      reasons.push('PROJECTIONS_INCOMPLETE');
    }
  }

  return Object.freeze({
    eligible: reasons.length === 0,
    reasons: Object.freeze(reasons),
  });
}
