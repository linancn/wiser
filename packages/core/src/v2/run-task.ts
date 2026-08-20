import {
  assertAggregateVersion,
  fail,
  requireNonEmpty,
  toEpoch,
} from './shared.js';

export type RunTaskState =
  | 'BLOCKED'
  | 'READY'
  | 'CLAIMED'
  | 'IN_PROGRESS'
  | 'SUBMITTED'
  | 'EVALUATING'
  | 'REWORK_REQUIRED'
  | 'ACCEPTED';

export interface RunTaskClaim {
  readonly runAgentId: string;
  readonly leaseTokenHash: string;
  readonly claimEpoch: number;
  readonly claimedAt: string;
  readonly leaseExpiresAt: string;
  readonly maximumLeaseExpiresAt: string;
}

export interface RunTask {
  readonly id: string;
  readonly runId: string;
  readonly state: RunTaskState;
  readonly version: number;
  readonly reassignable: boolean;
  readonly claimEpoch: number;
  readonly activeClaim?: RunTaskClaim;
}

interface LeaseCommand {
  readonly expectedVersion: number;
  readonly runAgentId: string;
  readonly claimEpoch: number;
  readonly leaseTokenHash: string;
  readonly now: string;
}

function nextTask(
  task: RunTask,
  input: {
    state: RunTaskState;
    claimEpoch?: number;
    activeClaim?: RunTaskClaim;
  },
): RunTask {
  const base = {
    id: task.id,
    runId: task.runId,
    state: input.state,
    version: task.version + 1,
    reassignable: task.reassignable,
    claimEpoch: input.claimEpoch ?? task.claimEpoch,
  };
  return input.activeClaim === undefined
    ? Object.freeze(base)
    : Object.freeze({ ...base, activeClaim: input.activeClaim });
}

function assertTaskVersion(task: RunTask, expectedVersion: number): void {
  assertAggregateVersion({
    actual: task.version,
    expected: expectedVersion,
    code: 'TASK_VERSION_CONFLICT',
    aggregate: 'RunTask',
  });
}

function transitionUnclaimedRunTask(
  task: RunTask,
  expectedVersion: number,
  from: RunTaskState,
  to: RunTaskState,
): RunTask {
  assertTaskVersion(task, expectedVersion);
  if (task.state !== from || task.activeClaim !== undefined) {
    fail(
      'TASK_STATE_CONFLICT',
      `RunTask ${task.id} must be ${from} and unclaimed before moving to ${to}.`,
    );
  }
  return nextTask(task, { state: to });
}

function assertLeaseState(task: RunTask): RunTaskClaim {
  if (
    (task.state !== 'CLAIMED' && task.state !== 'IN_PROGRESS') ||
    task.activeClaim === undefined
  ) {
    fail(
      'TASK_STATE_CONFLICT',
      `RunTask ${task.id} does not have an active claim.`,
    );
  }
  return task.activeClaim;
}

function assertCurrentLease(
  task: RunTask,
  command: LeaseCommand,
): RunTaskClaim {
  assertTaskVersion(task, command.expectedVersion);
  const claim = assertLeaseState(task);
  if (
    claim.runAgentId !== command.runAgentId ||
    claim.claimEpoch !== command.claimEpoch ||
    claim.leaseTokenHash !== command.leaseTokenHash
  ) {
    fail(
      'TASK_LEASE_STALE',
      `The lease token or claim epoch for RunTask ${task.id} is stale.`,
    );
  }
  if (
    toEpoch(command.now, 'now') >=
    toEpoch(claim.leaseExpiresAt, 'leaseExpiresAt')
  ) {
    fail('TASK_LEASE_EXPIRED', `The lease for RunTask ${task.id} has expired.`);
  }
  return claim;
}

export function createRunTask(input: {
  id: string;
  runId: string;
  initialState: 'BLOCKED' | 'READY';
  reassignable: boolean;
}): RunTask {
  requireNonEmpty(input.id, 'id');
  requireNonEmpty(input.runId, 'runId');
  return Object.freeze({
    id: input.id,
    runId: input.runId,
    state: input.initialState,
    version: 1,
    reassignable: input.reassignable,
    claimEpoch: 0,
  });
}

export function claimRunTask(
  task: RunTask,
  input: {
    expectedVersion: number;
    runAgentId: string;
    leaseTokenHash: string;
    claimedAt: string;
    leaseExpiresAt: string;
    maximumLeaseExpiresAt: string;
  },
): RunTask {
  assertTaskVersion(task, input.expectedVersion);
  if (task.state !== 'READY' || task.activeClaim !== undefined) {
    fail(
      'TASK_STATE_CONFLICT',
      `RunTask ${task.id} must be READY and unclaimed before claim.`,
    );
  }
  requireNonEmpty(input.runAgentId, 'runAgentId');
  requireNonEmpty(input.leaseTokenHash, 'leaseTokenHash');
  const claimedAt = toEpoch(input.claimedAt, 'claimedAt');
  const leaseExpiresAt = toEpoch(input.leaseExpiresAt, 'leaseExpiresAt');
  const maximumLeaseExpiresAt = toEpoch(
    input.maximumLeaseExpiresAt,
    'maximumLeaseExpiresAt',
  );
  if (leaseExpiresAt <= claimedAt || maximumLeaseExpiresAt < leaseExpiresAt) {
    fail(
      'INVALID_TASK_LEASE_WINDOW',
      'The lease must expire after claim and no later than its maximum expiry.',
    );
  }

  const claimEpoch = task.claimEpoch + 1;
  const activeClaim = Object.freeze({
    runAgentId: input.runAgentId,
    leaseTokenHash: input.leaseTokenHash,
    claimEpoch,
    claimedAt: input.claimedAt,
    leaseExpiresAt: input.leaseExpiresAt,
    maximumLeaseExpiresAt: input.maximumLeaseExpiresAt,
  });
  return nextTask(task, { state: 'CLAIMED', claimEpoch, activeClaim });
}

export function beginRunTask(task: RunTask, input: LeaseCommand): RunTask {
  const claim = assertCurrentLease(task, input);
  if (task.state !== 'CLAIMED') {
    fail(
      'TASK_STATE_CONFLICT',
      `RunTask ${task.id} must be CLAIMED before begin.`,
    );
  }
  return nextTask(task, { state: 'IN_PROGRESS', activeClaim: claim });
}

export function heartbeatRunTask(
  task: RunTask,
  input: LeaseCommand & { readonly nextLeaseExpiresAt: string },
): RunTask {
  const claim = assertCurrentLease(task, input);
  const nextExpiry = toEpoch(input.nextLeaseExpiresAt, 'nextLeaseExpiresAt');
  const currentExpiry = toEpoch(claim.leaseExpiresAt, 'leaseExpiresAt');
  const maximumExpiry = toEpoch(
    claim.maximumLeaseExpiresAt,
    'maximumLeaseExpiresAt',
  );
  if (nextExpiry <= currentExpiry) {
    fail(
      'TASK_LEASE_NOT_EXTENDED',
      'A heartbeat must extend the current lease expiry.',
    );
  }
  if (nextExpiry > maximumExpiry) {
    fail(
      'TASK_LEASE_MAX_EXCEEDED',
      'A heartbeat cannot extend the lease beyond its maximum expiry.',
    );
  }
  const activeClaim = Object.freeze({
    ...claim,
    leaseExpiresAt: input.nextLeaseExpiresAt,
  });
  return nextTask(task, { state: task.state, activeClaim });
}

export function releaseRunTask(task: RunTask, input: LeaseCommand): RunTask {
  assertCurrentLease(task, input);
  return nextTask(task, {
    state: task.reassignable ? 'READY' : 'BLOCKED',
  });
}

export function submitRunTask(task: RunTask, input: LeaseCommand): RunTask {
  assertCurrentLease(task, input);
  if (task.state !== 'IN_PROGRESS') {
    fail(
      'TASK_STATE_CONFLICT',
      `RunTask ${task.id} must be IN_PROGRESS before submit.`,
    );
  }
  return nextTask(task, { state: 'SUBMITTED' });
}

export function expireRunTaskLease(task: RunTask, now: string): RunTask {
  const claim =
    task.state === 'CLAIMED' || task.state === 'IN_PROGRESS'
      ? task.activeClaim
      : undefined;
  if (claim === undefined) {
    return task;
  }
  if (toEpoch(now, 'now') < toEpoch(claim.leaseExpiresAt, 'leaseExpiresAt')) {
    return task;
  }
  return nextTask(task, {
    state: task.reassignable ? 'READY' : 'BLOCKED',
  });
}

export function beginRunTaskEvaluation(
  task: RunTask,
  expectedVersion: number,
): RunTask {
  return transitionUnclaimedRunTask(
    task,
    expectedVersion,
    'SUBMITTED',
    'EVALUATING',
  );
}

export function requireRunTaskRework(
  task: RunTask,
  expectedVersion: number,
): RunTask {
  return transitionUnclaimedRunTask(
    task,
    expectedVersion,
    'EVALUATING',
    'REWORK_REQUIRED',
  );
}

export function readyRunTaskRevision(
  task: RunTask,
  expectedVersion: number,
): RunTask {
  return transitionUnclaimedRunTask(
    task,
    expectedVersion,
    'REWORK_REQUIRED',
    'READY',
  );
}

export function acceptRunTask(task: RunTask, expectedVersion: number): RunTask {
  return transitionUnclaimedRunTask(
    task,
    expectedVersion,
    'EVALUATING',
    'ACCEPTED',
  );
}
