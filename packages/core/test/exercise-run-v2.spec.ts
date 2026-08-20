import { describe, expect, it } from 'vitest';

import {
  type DomainError,
  assessRequiredRoleQuorum,
  beginExerciseRunCompletion,
  beginExerciseRunFormation,
  completeExerciseRun,
  createExerciseRun,
  markExerciseRunReady,
  pauseExerciseRun,
  resumeExerciseRun,
  startExerciseRun,
  type RunRoleAssignment,
  type RunRoleSlot,
} from '../src/index.js';

const virtualStart = '2023-03-22T07:00:00.000Z';

const requiredRoleSlots: readonly RunRoleSlot[] = [
  { id: 'slot-evidence', roleId: 'water-evidence', required: true },
  { id: 'slot-hydraulic', roleId: 'hydraulic', required: true },
  { id: 'slot-ecology', roleId: 'ecology', required: true },
  { id: 'slot-coordinator', roleId: 'coordinator', required: true },
];

function assignments(
  runAgentIds: readonly string[],
): readonly RunRoleAssignment[] {
  return requiredRoleSlots.map((slot, index) => ({
    roleSlotId: slot.id,
    runAgentId: runAgentIds[index] ?? runAgentIds[0] ?? 'missing-agent',
    kind: 'primary',
    active: true,
  }));
}

function run() {
  return createExerciseRun({
    id: 'run-yongding-001',
    scenarioVersionId: 'scenario-yongding-v2',
    virtualStartAt: virtualStart,
    compatibilityMode: 'collaborative_v2',
  });
}

describe('ExerciseRun v2 lifecycle and staffing quorum', () => {
  it('moves through the complete collaborative lifecycle with optimistic versions', () => {
    const created = run();
    const forming = beginExerciseRunFormation(created, created.version);
    const ready = markExerciseRunReady(forming, {
      expectedVersion: forming.version,
      roleSlots: requiredRoleSlots,
      assignments: assignments(['agent-a', 'agent-b', 'agent-c', 'agent-d']),
      minDistinctRequiredAgents: 4,
    });
    const running = startExerciseRun(ready, ready.version);
    const paused = pauseExerciseRun(running, running.version);
    const resumed = resumeExerciseRun(paused, paused.version);
    const completing = beginExerciseRunCompletion(resumed, resumed.version);
    const completed = completeExerciseRun(completing, completing.version);

    expect([
      created.state,
      forming.state,
      ready.state,
      running.state,
      paused.state,
      resumed.state,
      completing.state,
      completed.state,
    ]).toEqual([
      'CREATED',
      'FORMING',
      'READY',
      'RUNNING',
      'PAUSED',
      'RUNNING',
      'COMPLETING',
      'COMPLETED',
    ]);
    expect(completed.version).toBe(8);
    expect(created).toMatchObject({ state: 'CREATED', version: 1 });
  });

  it('requires every required primary role to be staffed by a distinct RunAgent', () => {
    const sameAgent = assignments(['agent-a', 'agent-a', 'agent-a', 'agent-a']);
    const assessment = assessRequiredRoleQuorum({
      roleSlots: requiredRoleSlots,
      assignments: sameAgent,
      minDistinctRequiredAgents: 4,
      compatibilityMode: 'collaborative_v2',
    });

    expect(assessment).toEqual({
      ready: false,
      requiredRoleSlotCount: 4,
      assignedRequiredRoleSlotCount: 4,
      distinctRequiredRunAgentCount: 1,
      violations: [
        'REQUIRED_ROLE_AGENT_NOT_DISTINCT',
        'MIN_DISTINCT_REQUIRED_AGENTS_NOT_MET',
      ],
    });

    const forming = beginExerciseRunFormation(run(), 1);
    expect(() =>
      markExerciseRunReady(forming, {
        expectedVersion: forming.version,
        roleSlots: requiredRoleSlots,
        assignments: sameAgent,
        minDistinctRequiredAgents: 4,
      }),
    ).toThrowError(
      expect.objectContaining<Partial<DomainError>>({
        code: 'RUN_ROLE_QUORUM_NOT_MET',
      }),
    );
  });

  it('rejects missing or duplicate primaries and does not count assistants', () => {
    const malformed: readonly RunRoleAssignment[] = [
      ...assignments(['agent-a', 'agent-b', 'agent-c', 'agent-d']).slice(0, 3),
      {
        roleSlotId: 'slot-coordinator',
        runAgentId: 'agent-d',
        kind: 'assistant',
        active: true,
      },
      {
        roleSlotId: 'slot-evidence',
        runAgentId: 'agent-z',
        kind: 'primary',
        active: true,
      },
    ];

    expect(
      assessRequiredRoleQuorum({
        roleSlots: requiredRoleSlots,
        assignments: malformed,
        minDistinctRequiredAgents: 4,
        compatibilityMode: 'collaborative_v2',
      }),
    ).toMatchObject({
      ready: false,
      assignedRequiredRoleSlotCount: 2,
      violations: [
        'REQUIRED_ROLE_PRIMARY_NOT_EXACTLY_ONE',
        'MIN_DISTINCT_REQUIRED_AGENTS_NOT_MET',
      ],
    });
  });

  it('keeps the one-agent exception explicit and limited to legacy compatibility runs', () => {
    const legacySlot: readonly RunRoleSlot[] = [
      { id: 'legacy-slot', roleId: 'legacy-participant', required: true },
    ];
    const legacyAssignment: readonly RunRoleAssignment[] = [
      {
        roleSlotId: 'legacy-slot',
        runAgentId: 'legacy-agent',
        kind: 'primary',
        active: true,
      },
    ];

    expect(
      assessRequiredRoleQuorum({
        roleSlots: legacySlot,
        assignments: legacyAssignment,
        minDistinctRequiredAgents: 1,
        compatibilityMode: 'legacy_v1',
      }).ready,
    ).toBe(true);
    expect(() =>
      assessRequiredRoleQuorum({
        roleSlots: legacySlot,
        assignments: legacyAssignment,
        minDistinctRequiredAgents: 1,
        compatibilityMode: 'collaborative_v2',
      }),
    ).toThrowError(
      expect.objectContaining<Partial<DomainError>>({
        code: 'INVALID_REQUIRED_AGENT_QUORUM',
      }),
    );
  });

  it('rejects stale and illegal lifecycle transitions without mutating the run', () => {
    const created = run();
    const forming = beginExerciseRunFormation(created, created.version);

    expect(() => startExerciseRun(forming, forming.version)).toThrowError(
      expect.objectContaining<Partial<DomainError>>({
        code: 'RUN_STATE_CONFLICT',
      }),
    );
    expect(() => beginExerciseRunFormation(forming, 1)).toThrowError(
      expect.objectContaining<Partial<DomainError>>({
        code: 'RUN_VERSION_CONFLICT',
      }),
    );
    expect(created).toMatchObject({ state: 'CREATED', version: 1 });
  });
});
