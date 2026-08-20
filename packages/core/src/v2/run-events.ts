import {
  canonicalJson,
  type CanonicalJsonValue,
  cloneAndFreezeCanonicalJson,
  fail,
  freezeArray,
  requireNonEmpty,
  toEpoch,
} from './shared.js';

export type RunEventAssertionClass =
  | 'platform_observed'
  | 'participant_reported'
  | 'evaluator_derived'
  | 'operator_asserted'
  | 'external_outcome';

export interface RunEventHead {
  readonly runId: string;
  readonly nextRunSeq: number;
  readonly headHash: string;
}

export interface RunEventDraft {
  readonly eventId: string;
  readonly streamType: string;
  readonly streamId: string;
  readonly eventType: string;
  readonly actorType: string;
  readonly actorId: string;
  readonly correlationId?: string;
  readonly causationId?: string;
  readonly virtualTime: string;
  readonly occurredAt: string;
  readonly recordedAt: string;
  readonly schemaVersion: number;
  readonly assertionClass: RunEventAssertionClass;
  readonly payload: CanonicalJsonValue;
  readonly traceId?: string;
  readonly spanId?: string;
}

export interface PreparedRunEvent extends RunEventDraft {
  readonly runId: string;
  readonly runSeq: number;
  readonly previousHash: string;
  readonly eventHash: string;
}

export interface RunEventAppendBatchRequest {
  readonly runId: string;
  readonly headPrecondition: RunEventHead;
  readonly events: readonly PreparedRunEvent[];
  readonly nextHead: RunEventHead;
}

function eventHashMaterial(input: {
  runId: string;
  runSeq: number;
  previousHash: string;
  draft: RunEventDraft;
}): CanonicalJsonValue {
  const optional = {
    ...(input.draft.correlationId === undefined
      ? {}
      : { correlationId: input.draft.correlationId }),
    ...(input.draft.causationId === undefined
      ? {}
      : { causationId: input.draft.causationId }),
    ...(input.draft.traceId === undefined
      ? {}
      : { traceId: input.draft.traceId }),
    ...(input.draft.spanId === undefined ? {} : { spanId: input.draft.spanId }),
  };
  return {
    runId: input.runId,
    runSeq: input.runSeq,
    eventId: input.draft.eventId,
    streamType: input.draft.streamType,
    streamId: input.draft.streamId,
    eventType: input.draft.eventType,
    actorType: input.draft.actorType,
    actorId: input.draft.actorId,
    virtualTime: input.draft.virtualTime,
    occurredAt: input.draft.occurredAt,
    recordedAt: input.draft.recordedAt,
    schemaVersion: input.draft.schemaVersion,
    assertionClass: input.draft.assertionClass,
    payload: input.draft.payload,
    previousHash: input.previousHash,
    ...optional,
  };
}

function validateDraft(draft: RunEventDraft): void {
  requireNonEmpty(draft.eventId, 'eventId');
  requireNonEmpty(draft.streamType, 'streamType');
  requireNonEmpty(draft.streamId, 'streamId');
  requireNonEmpty(draft.eventType, 'eventType');
  requireNonEmpty(draft.actorType, 'actorType');
  requireNonEmpty(draft.actorId, 'actorId');
  toEpoch(draft.virtualTime, 'virtualTime');
  toEpoch(draft.occurredAt, 'occurredAt');
  toEpoch(draft.recordedAt, 'recordedAt');
  if (!Number.isInteger(draft.schemaVersion) || draft.schemaVersion < 1) {
    fail('INVALID_EVENT_SCHEMA_VERSION', 'schemaVersion must be positive.');
  }
}

export function prepareRunEventAppendBatch(input: {
  head: RunEventHead;
  drafts: readonly RunEventDraft[];
  hashCanonical: (canonical: string) => string;
}): RunEventAppendBatchRequest {
  requireNonEmpty(input.head.runId, 'head.runId');
  requireNonEmpty(input.head.headHash, 'head.headHash');
  if (!Number.isInteger(input.head.nextRunSeq) || input.head.nextRunSeq < 1) {
    fail('INVALID_EVENT_HEAD', 'nextRunSeq must be a positive integer.');
  }
  if (input.drafts.length === 0) {
    fail('EMPTY_EVENT_BATCH', 'At least one RunEvent is required.');
  }

  const eventIds = new Set<string>();
  for (const draft of input.drafts) {
    validateDraft(draft);
    if (eventIds.has(draft.eventId)) {
      fail('DUPLICATE_EVENT_ID', `Event ${draft.eventId} is duplicated.`);
    }
    eventIds.add(draft.eventId);
  }

  let previousHash = input.head.headHash;
  const events: PreparedRunEvent[] = [];
  for (const [index, draft] of input.drafts.entries()) {
    const runSeq = input.head.nextRunSeq + index;
    const immutableDraft = Object.freeze({
      ...draft,
      payload: cloneAndFreezeCanonicalJson(draft.payload),
    });
    const eventHash = input.hashCanonical(
      canonicalJson(
        eventHashMaterial({
          runId: input.head.runId,
          runSeq,
          previousHash,
          draft: immutableDraft,
        }),
      ),
    );
    requireNonEmpty(eventHash, 'eventHash');
    const prepared = Object.freeze({
      ...immutableDraft,
      runId: input.head.runId,
      runSeq,
      previousHash,
      eventHash,
    });
    events.push(prepared);
    previousHash = eventHash;
  }

  const headPrecondition = Object.freeze({ ...input.head });
  const nextHead = Object.freeze({
    runId: input.head.runId,
    nextRunSeq: input.head.nextRunSeq + events.length,
    headHash: previousHash,
  });
  return Object.freeze({
    runId: input.head.runId,
    headPrecondition,
    events: freezeArray(events),
    nextHead,
  });
}
