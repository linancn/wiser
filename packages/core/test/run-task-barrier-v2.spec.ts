import { describe, expect, it } from 'vitest';

import {
  acceptRunTask,
  beginRunTaskEvaluation,
  type DomainError,
  beginRunTask,
  claimRunTask,
  createRunBarrier,
  createRunTask,
  expireRunTaskLease,
  heartbeatRunTask,
  readyRunTaskRevision,
  recordRunBarrierInput,
  releaseBlockedRunTask,
  releaseRunBarrier,
  releaseRunTask,
  requireRunTaskRework,
  submitRunTask,
} from '../src/index.js';

const t0 = '2023-03-22T07:00:00.000Z';
const t1 = '2023-03-22T07:05:00.000Z';
const t2 = '2023-03-22T07:10:00.000Z';
const t3 = '2023-03-22T07:15:00.000Z';
const t4 = '2023-03-22T07:20:00.000Z';

function task(id = 'task-evidence', reassignable = true) {
  return createRunTask({
    id,
    runId: 'run-yongding-001',
    initialState: 'READY',
    reassignable,
  });
}

describe('RunTask lease state machine', () => {
  it('releases a blocked downstream Task only with its current version', () => {
    const blocked = createRunTask({
      id: 'task-dispatch',
      runId: 'run-yongding-001',
      initialState: 'BLOCKED',
      reassignable: false,
    });
    const ready = releaseBlockedRunTask(blocked, blocked.version);

    expect(ready).toMatchObject({ state: 'READY', version: 2 });
    expect(() => releaseBlockedRunTask(blocked, 99)).toThrowError(
      expect.objectContaining<Partial<DomainError>>({
        code: 'TASK_VERSION_CONFLICT',
      }),
    );
    expect(() => releaseBlockedRunTask(ready, ready.version)).toThrowError(
      expect.objectContaining<Partial<DomainError>>({
        code: 'TASK_STATE_CONFLICT',
      }),
    );
  });

  it('claims, begins, heartbeats and releases with a bounded lease', () => {
    const ready = task();
    const claimed = claimRunTask(ready, {
      expectedVersion: ready.version,
      runAgentId: 'agent-a',
      leaseTokenHash: 'sha256:lease-a',
      claimedAt: t0,
      leaseExpiresAt: t2,
      maximumLeaseExpiresAt: t4,
    });
    const started = beginRunTask(claimed, {
      expectedVersion: claimed.version,
      runAgentId: 'agent-a',
      claimEpoch: 1,
      leaseTokenHash: 'sha256:lease-a',
      now: t1,
    });
    const renewed = heartbeatRunTask(started, {
      expectedVersion: started.version,
      runAgentId: 'agent-a',
      claimEpoch: 1,
      leaseTokenHash: 'sha256:lease-a',
      now: t1,
      nextLeaseExpiresAt: t3,
    });
    const released = releaseRunTask(renewed, {
      expectedVersion: renewed.version,
      runAgentId: 'agent-a',
      claimEpoch: 1,
      leaseTokenHash: 'sha256:lease-a',
      now: t2,
    });

    expect(claimed).toMatchObject({
      state: 'CLAIMED',
      version: 2,
      claimEpoch: 1,
      activeClaim: {
        runAgentId: 'agent-a',
        leaseExpiresAt: t2,
      },
    });
    expect(started).toMatchObject({ state: 'IN_PROGRESS', version: 3 });
    expect(renewed).toMatchObject({
      state: 'IN_PROGRESS',
      version: 4,
      activeClaim: { leaseExpiresAt: t3 },
    });
    expect(released).toMatchObject({
      state: 'READY',
      version: 5,
      claimEpoch: 1,
    });
    expect(released.activeClaim).toBeUndefined();
    expect(ready).toMatchObject({ state: 'READY', version: 1 });
  });

  it('expires a lease, permits a new epoch, and permanently rejects the stale token', () => {
    const firstClaim = claimRunTask(task(), {
      expectedVersion: 1,
      runAgentId: 'agent-a',
      leaseTokenHash: 'sha256:lease-a',
      claimedAt: t0,
      leaseExpiresAt: t1,
      maximumLeaseExpiresAt: t2,
    });

    expect(expireRunTaskLease(firstClaim, t0)).toBe(firstClaim);
    const expired = expireRunTaskLease(firstClaim, t1);
    const secondClaim = claimRunTask(expired, {
      expectedVersion: expired.version,
      runAgentId: 'agent-b',
      leaseTokenHash: 'sha256:lease-b',
      claimedAt: t1,
      leaseExpiresAt: t2,
      maximumLeaseExpiresAt: t3,
    });

    expect(expired).toMatchObject({
      state: 'READY',
      version: 3,
      claimEpoch: 1,
    });
    expect(secondClaim).toMatchObject({
      state: 'CLAIMED',
      version: 4,
      claimEpoch: 2,
    });
    expect(() =>
      heartbeatRunTask(secondClaim, {
        expectedVersion: secondClaim.version,
        runAgentId: 'agent-a',
        claimEpoch: 1,
        leaseTokenHash: 'sha256:lease-a',
        now: t1,
        nextLeaseExpiresAt: t2,
      }),
    ).toThrowError(
      expect.objectContaining<Partial<DomainError>>({
        code: 'TASK_LEASE_STALE',
      }),
    );
    expect(() =>
      submitRunTask(secondClaim, {
        expectedVersion: secondClaim.version,
        runAgentId: 'agent-a',
        claimEpoch: 1,
        leaseTokenHash: 'sha256:lease-a',
        now: t1,
      }),
    ).toThrowError(
      expect.objectContaining<Partial<DomainError>>({
        code: 'TASK_LEASE_STALE',
      }),
    );
  });

  it('submits only in-progress work with the current live lease', () => {
    const claimed = claimRunTask(task(), {
      expectedVersion: 1,
      runAgentId: 'agent-a',
      leaseTokenHash: 'sha256:lease-a',
      claimedAt: t0,
      leaseExpiresAt: t2,
      maximumLeaseExpiresAt: t4,
    });
    const started = beginRunTask(claimed, {
      expectedVersion: claimed.version,
      runAgentId: 'agent-a',
      claimEpoch: 1,
      leaseTokenHash: 'sha256:lease-a',
      now: t1,
    });
    const submitted = submitRunTask(started, {
      expectedVersion: started.version,
      runAgentId: 'agent-a',
      claimEpoch: 1,
      leaseTokenHash: 'sha256:lease-a',
      now: t1,
    });

    expect(submitted).toMatchObject({ state: 'SUBMITTED', version: 4 });
    expect(submitted.activeClaim).toBeUndefined();
  });

  it('evaluates, requests a clean revision, and accepts without a Run-wide version', () => {
    const claimed = claimRunTask(task(), {
      expectedVersion: 1,
      runAgentId: 'agent-a',
      leaseTokenHash: 'sha256:lease-a',
      claimedAt: t0,
      leaseExpiresAt: t2,
      maximumLeaseExpiresAt: t4,
    });
    const started = beginRunTask(claimed, {
      expectedVersion: claimed.version,
      runAgentId: 'agent-a',
      claimEpoch: 1,
      leaseTokenHash: 'sha256:lease-a',
      now: t1,
    });
    const submitted = submitRunTask(started, {
      expectedVersion: started.version,
      runAgentId: 'agent-a',
      claimEpoch: 1,
      leaseTokenHash: 'sha256:lease-a',
      now: t1,
    });
    const evaluating = beginRunTaskEvaluation(submitted, submitted.version);
    const rework = requireRunTaskRework(evaluating, evaluating.version);
    const revisionReady = readyRunTaskRevision(rework, rework.version);
    const revisedClaim = claimRunTask(revisionReady, {
      expectedVersion: revisionReady.version,
      runAgentId: 'agent-a',
      leaseTokenHash: 'sha256:lease-revision',
      claimedAt: t2,
      leaseExpiresAt: t3,
      maximumLeaseExpiresAt: t4,
    });
    const revisedStarted = beginRunTask(revisedClaim, {
      expectedVersion: revisedClaim.version,
      runAgentId: 'agent-a',
      claimEpoch: 2,
      leaseTokenHash: 'sha256:lease-revision',
      now: t2,
    });
    const revisedSubmission = submitRunTask(revisedStarted, {
      expectedVersion: revisedStarted.version,
      runAgentId: 'agent-a',
      claimEpoch: 2,
      leaseTokenHash: 'sha256:lease-revision',
      now: t2,
    });
    const revisedEvaluation = beginRunTaskEvaluation(
      revisedSubmission,
      revisedSubmission.version,
    );
    const accepted = acceptRunTask(
      revisedEvaluation,
      revisedEvaluation.version,
    );

    expect([
      submitted.state,
      evaluating.state,
      rework.state,
      revisionReady.state,
      accepted.state,
    ]).toEqual([
      'SUBMITTED',
      'EVALUATING',
      'REWORK_REQUIRED',
      'READY',
      'ACCEPTED',
    ]);
    expect(revisionReady.claimEpoch).toBe(1);
    expect(accepted.claimEpoch).toBe(2);
  });

  it('rejects illegal evaluation and revision transitions', () => {
    const ready = task();
    expect(() => beginRunTaskEvaluation(ready, ready.version)).toThrowError(
      expect.objectContaining<Partial<DomainError>>({
        code: 'TASK_STATE_CONFLICT',
      }),
    );
    expect(() => readyRunTaskRevision(ready, ready.version)).toThrowError(
      expect.objectContaining<Partial<DomainError>>({
        code: 'TASK_STATE_CONFLICT',
      }),
    );
  });

  it('blocks expired non-reassignable work and enforces token and maximum lease guards', () => {
    const claimed = claimRunTask(task('task-fixed', false), {
      expectedVersion: 1,
      runAgentId: 'agent-a',
      leaseTokenHash: 'sha256:lease-a',
      claimedAt: t0,
      leaseExpiresAt: t1,
      maximumLeaseExpiresAt: t2,
    });

    expect(() =>
      beginRunTask(claimed, {
        expectedVersion: claimed.version,
        runAgentId: 'agent-a',
        claimEpoch: 1,
        leaseTokenHash: 'sha256:wrong',
        now: t0,
      }),
    ).toThrowError(
      expect.objectContaining<Partial<DomainError>>({
        code: 'TASK_LEASE_STALE',
      }),
    );
    expect(() =>
      heartbeatRunTask(claimed, {
        expectedVersion: claimed.version,
        runAgentId: 'agent-a',
        claimEpoch: 1,
        leaseTokenHash: 'sha256:lease-a',
        now: t0,
        nextLeaseExpiresAt: t3,
      }),
    ).toThrowError(
      expect.objectContaining<Partial<DomainError>>({
        code: 'TASK_LEASE_MAX_EXCEEDED',
      }),
    );
    expect(expireRunTaskLease(claimed, t1)).toMatchObject({
      state: 'BLOCKED',
      version: 3,
    });
  });

  it('uses independent task versions instead of a Run-wide lock', () => {
    const evidence = task('task-evidence');
    const ecology = task('task-ecology');
    const claimedEvidence = claimRunTask(evidence, {
      expectedVersion: evidence.version,
      runAgentId: 'agent-a',
      leaseTokenHash: 'sha256:lease-a',
      claimedAt: t0,
      leaseExpiresAt: t2,
      maximumLeaseExpiresAt: t4,
    });
    const claimedEcology = claimRunTask(ecology, {
      expectedVersion: ecology.version,
      runAgentId: 'agent-c',
      leaseTokenHash: 'sha256:lease-c',
      claimedAt: t0,
      leaseExpiresAt: t2,
      maximumLeaseExpiresAt: t4,
    });

    expect(claimedEvidence).toMatchObject({ id: 'task-evidence', version: 2 });
    expect(claimedEcology).toMatchObject({ id: 'task-ecology', version: 2 });
  });
});

describe('RunBarrier exactly-once release', () => {
  it('deduplicates inputs and emits one release decision forever', () => {
    const closed = createRunBarrier({
      id: 'barrier-analysis-ready',
      runId: 'run-yongding-001',
      requiredConditionKeys: ['task:evidence', 'task:hydraulic'],
    });
    const one = recordRunBarrierInput(closed, {
      expectedVersion: closed.version,
      conditionKey: 'task:evidence',
      sourceEventId: 'event-evidence-accepted',
    });
    const duplicate = recordRunBarrierInput(one, {
      expectedVersion: one.version,
      conditionKey: 'task:evidence',
      sourceEventId: 'event-evidence-accepted',
    });
    const satisfied = recordRunBarrierInput(duplicate, {
      expectedVersion: duplicate.version,
      conditionKey: 'task:hydraulic',
      sourceEventId: 'event-hydraulic-accepted',
    });
    const released = releaseRunBarrier(satisfied, satisfied.version);
    const retried = releaseRunBarrier(released.barrier, satisfied.version);

    expect(one).toMatchObject({ state: 'CLOSED', version: 2 });
    expect(duplicate).toBe(one);
    expect(satisfied).toMatchObject({ state: 'SATISFIED', version: 3 });
    expect(released).toMatchObject({
      releasedNow: true,
      barrier: { state: 'RELEASED', version: 4 },
    });
    expect(retried).toEqual({ barrier: released.barrier, releasedNow: false });
  });

  it('cannot release before every required condition is present', () => {
    const barrier = createRunBarrier({
      id: 'barrier-analysis-ready',
      runId: 'run-yongding-001',
      requiredConditionKeys: ['task:evidence'],
    });

    expect(() => releaseRunBarrier(barrier, barrier.version)).toThrowError(
      expect.objectContaining<Partial<DomainError>>({
        code: 'BARRIER_NOT_SATISFIED',
      }),
    );
  });
});
