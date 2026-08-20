import {
  assertAggregateVersion,
  fail,
  freezeArray,
  requireNonEmpty,
} from './shared.js';

export type RunBarrierState = 'CLOSED' | 'SATISFIED' | 'RELEASED';

export interface RunBarrierInput {
  readonly conditionKey: string;
  readonly sourceEventId: string;
}

export interface RunBarrier {
  readonly id: string;
  readonly runId: string;
  readonly state: RunBarrierState;
  readonly version: number;
  readonly requiredConditionKeys: readonly string[];
  readonly inputs: readonly RunBarrierInput[];
}

export interface RunBarrierReleaseDecision {
  readonly barrier: RunBarrier;
  readonly releasedNow: boolean;
}

function barrierInputKey(input: RunBarrierInput): string {
  return `${input.conditionKey}\u0000${input.sourceEventId}`;
}

export function createRunBarrier(input: {
  id: string;
  runId: string;
  requiredConditionKeys: readonly string[];
}): RunBarrier {
  requireNonEmpty(input.id, 'id');
  requireNonEmpty(input.runId, 'runId');
  if (input.requiredConditionKeys.length === 0) {
    fail(
      'INVALID_BARRIER_CONDITIONS',
      'A RunBarrier needs at least one required condition.',
    );
  }
  const requiredConditionKeys = new Set<string>();
  for (const key of input.requiredConditionKeys) {
    requireNonEmpty(key, 'requiredConditionKey');
    if (requiredConditionKeys.has(key)) {
      fail(
        'DUPLICATE_BARRIER_CONDITION',
        `Barrier condition ${key} is duplicated.`,
      );
    }
    requiredConditionKeys.add(key);
  }
  return Object.freeze({
    id: input.id,
    runId: input.runId,
    state: 'CLOSED',
    version: 1,
    requiredConditionKeys: freezeArray(input.requiredConditionKeys),
    inputs: freezeArray([]),
  });
}

export function recordRunBarrierInput(
  barrier: RunBarrier,
  input: {
    expectedVersion: number;
    conditionKey: string;
    sourceEventId: string;
  },
): RunBarrier {
  requireNonEmpty(input.conditionKey, 'conditionKey');
  requireNonEmpty(input.sourceEventId, 'sourceEventId');
  if (!barrier.requiredConditionKeys.includes(input.conditionKey)) {
    fail(
      'BARRIER_CONDITION_UNKNOWN',
      `Condition ${input.conditionKey} is not part of RunBarrier ${barrier.id}.`,
    );
  }
  const candidate = {
    conditionKey: input.conditionKey,
    sourceEventId: input.sourceEventId,
  } as const;
  if (
    barrier.inputs.some(
      (existing) => barrierInputKey(existing) === barrierInputKey(candidate),
    )
  ) {
    return barrier;
  }
  assertAggregateVersion({
    actual: barrier.version,
    expected: input.expectedVersion,
    code: 'BARRIER_VERSION_CONFLICT',
    aggregate: 'RunBarrier',
  });
  if (barrier.state === 'RELEASED') {
    fail(
      'BARRIER_ALREADY_RELEASED',
      `RunBarrier ${barrier.id} is immutable after release.`,
    );
  }

  const inputs = freezeArray([...barrier.inputs, Object.freeze(candidate)]);
  const observedConditions = new Set(
    inputs.map(({ conditionKey }) => conditionKey),
  );
  const satisfied = barrier.requiredConditionKeys.every((condition) =>
    observedConditions.has(condition),
  );
  return Object.freeze({
    ...barrier,
    state: satisfied ? 'SATISFIED' : 'CLOSED',
    version: barrier.version + 1,
    inputs,
  });
}

export function releaseRunBarrier(
  barrier: RunBarrier,
  expectedVersion: number,
): RunBarrierReleaseDecision {
  if (barrier.state === 'RELEASED') {
    return Object.freeze({ barrier, releasedNow: false });
  }
  assertAggregateVersion({
    actual: barrier.version,
    expected: expectedVersion,
    code: 'BARRIER_VERSION_CONFLICT',
    aggregate: 'RunBarrier',
  });
  if (barrier.state !== 'SATISFIED') {
    fail(
      'BARRIER_NOT_SATISFIED',
      `RunBarrier ${barrier.id} cannot be released before satisfaction.`,
    );
  }
  const released = Object.freeze({
    ...barrier,
    state: 'RELEASED' as const,
    version: barrier.version + 1,
  });
  return Object.freeze({ barrier: released, releasedNow: true });
}
