export type EvidenceProjectionErrorCode =
  | 'INVALID_EVIDENCE_PROJECTION_CONFIG'
  | 'INVALID_EVIDENCE_PROJECTION_INPUT'
  | 'EVIDENCE_PROJECTION_BACKEND_REJECTED';

export class EvidenceProjectionError extends Error {
  constructor(
    readonly code: EvidenceProjectionErrorCode,
    message: string,
    readonly status?: number,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'EvidenceProjectionError';
  }
}
