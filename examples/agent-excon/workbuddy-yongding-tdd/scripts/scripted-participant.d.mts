export interface ScriptedSyncReceipt {
  readonly resourceType: string;
  readonly contentSnapshot: Readonly<Record<string, unknown>>;
}

export interface ScriptedSyncBatch {
  readonly receipts?: readonly ScriptedSyncReceipt[];
}

export function hasCoordinatorFinalEvidence(
  batches: readonly ScriptedSyncBatch[],
  reviewRequestId: string,
): boolean;

export function hasCoordinatorReleaseEvidence(
  batches: readonly ScriptedSyncBatch[],
): boolean;
