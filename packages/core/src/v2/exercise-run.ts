import {
  assertAggregateVersion,
  fail,
  freezeArray,
  requireNonEmpty,
  toEpoch,
} from './shared.js';

export type ExerciseRunState =
  | 'CREATED'
  | 'FORMING'
  | 'READY'
  | 'RUNNING'
  | 'PAUSED'
  | 'COMPLETING'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'FAILED';

export type ExerciseRunCompatibilityMode = 'collaborative_v2' | 'legacy_v1';

export interface ExerciseRun {
  readonly id: string;
  readonly scenarioVersionId: string;
  readonly state: ExerciseRunState;
  readonly virtualTime: string;
  readonly version: number;
  readonly compatibilityMode: ExerciseRunCompatibilityMode;
}

export interface RunRoleSlot {
  readonly id: string;
  readonly roleId: string;
  readonly required: boolean;
}

export interface RunRoleAssignment {
  readonly roleSlotId: string;
  readonly runAgentId: string;
  readonly kind: 'primary' | 'assistant';
  readonly active: boolean;
}

export type RequiredRoleQuorumViolation =
  | 'REQUIRED_ROLE_PRIMARY_NOT_EXACTLY_ONE'
  | 'REQUIRED_ROLE_AGENT_NOT_DISTINCT'
  | 'MIN_DISTINCT_REQUIRED_AGENTS_NOT_MET';

export interface RequiredRoleQuorumAssessment {
  readonly ready: boolean;
  readonly requiredRoleSlotCount: number;
  readonly assignedRequiredRoleSlotCount: number;
  readonly distinctRequiredRunAgentCount: number;
  readonly violations: readonly RequiredRoleQuorumViolation[];
}

function nextRun(run: ExerciseRun, state: ExerciseRunState): ExerciseRun {
  return Object.freeze({ ...run, state, version: run.version + 1 });
}

function transitionRun(
  run: ExerciseRun,
  expectedVersion: number,
  from: readonly ExerciseRunState[],
  to: ExerciseRunState,
): ExerciseRun {
  assertAggregateVersion({
    actual: run.version,
    expected: expectedVersion,
    code: 'RUN_VERSION_CONFLICT',
    aggregate: 'ExerciseRun',
  });
  if (!from.includes(run.state)) {
    fail(
      'RUN_STATE_CONFLICT',
      `ExerciseRun ${run.id} cannot move from ${run.state} to ${to}.`,
    );
  }
  return nextRun(run, to);
}

export function createExerciseRun(input: {
  id: string;
  scenarioVersionId: string;
  virtualStartAt: string;
  compatibilityMode: ExerciseRunCompatibilityMode;
}): ExerciseRun {
  requireNonEmpty(input.id, 'id');
  requireNonEmpty(input.scenarioVersionId, 'scenarioVersionId');
  toEpoch(input.virtualStartAt, 'virtualStartAt');
  return Object.freeze({
    id: input.id,
    scenarioVersionId: input.scenarioVersionId,
    state: 'CREATED',
    virtualTime: input.virtualStartAt,
    version: 1,
    compatibilityMode: input.compatibilityMode,
  });
}

export function assessRequiredRoleQuorum(input: {
  roleSlots: readonly RunRoleSlot[];
  assignments: readonly RunRoleAssignment[];
  minDistinctRequiredAgents: number;
  compatibilityMode: ExerciseRunCompatibilityMode;
}): RequiredRoleQuorumAssessment {
  const minimumAllowed = input.compatibilityMode === 'legacy_v1' ? 1 : 2;
  if (
    !Number.isInteger(input.minDistinctRequiredAgents) ||
    input.minDistinctRequiredAgents < minimumAllowed
  ) {
    fail(
      'INVALID_REQUIRED_AGENT_QUORUM',
      `${input.compatibilityMode} requires at least ${minimumAllowed} distinct required RunAgent(s).`,
    );
  }

  const requiredSlots = input.roleSlots.filter(({ required }) => required);
  if (requiredSlots.length < minimumAllowed) {
    fail(
      'INVALID_REQUIRED_ROLE_SLOTS',
      `${input.compatibilityMode} requires at least ${minimumAllowed} required role slot(s).`,
    );
  }

  const violations: RequiredRoleQuorumViolation[] = [];
  const validPrimaryAssignments: RunRoleAssignment[] = [];
  let primaryCardinalityInvalid = false;

  for (const slot of requiredSlots) {
    const primaries = input.assignments.filter(
      (assignment) =>
        assignment.active &&
        assignment.kind === 'primary' &&
        assignment.roleSlotId === slot.id,
    );
    if (primaries.length !== 1) {
      primaryCardinalityInvalid = true;
      continue;
    }
    const primary = primaries[0];
    if (primary !== undefined) {
      validPrimaryAssignments.push(primary);
    }
  }

  if (primaryCardinalityInvalid) {
    violations.push('REQUIRED_ROLE_PRIMARY_NOT_EXACTLY_ONE');
  }

  const agents = validPrimaryAssignments.map(({ runAgentId }) => runAgentId);
  const distinctAgents = new Set(agents);
  if (
    validPrimaryAssignments.length === requiredSlots.length &&
    distinctAgents.size !== validPrimaryAssignments.length
  ) {
    violations.push('REQUIRED_ROLE_AGENT_NOT_DISTINCT');
  }
  if (distinctAgents.size < input.minDistinctRequiredAgents) {
    violations.push('MIN_DISTINCT_REQUIRED_AGENTS_NOT_MET');
  }

  return Object.freeze({
    ready: violations.length === 0,
    requiredRoleSlotCount: requiredSlots.length,
    assignedRequiredRoleSlotCount: validPrimaryAssignments.length,
    distinctRequiredRunAgentCount: distinctAgents.size,
    violations: freezeArray(violations),
  });
}

export function beginExerciseRunFormation(
  run: ExerciseRun,
  expectedVersion: number,
): ExerciseRun {
  return transitionRun(run, expectedVersion, ['CREATED'], 'FORMING');
}

export function markExerciseRunReady(
  run: ExerciseRun,
  input: {
    expectedVersion: number;
    roleSlots: readonly RunRoleSlot[];
    assignments: readonly RunRoleAssignment[];
    minDistinctRequiredAgents: number;
  },
): ExerciseRun {
  assertAggregateVersion({
    actual: run.version,
    expected: input.expectedVersion,
    code: 'RUN_VERSION_CONFLICT',
    aggregate: 'ExerciseRun',
  });
  if (run.state !== 'FORMING') {
    fail(
      'RUN_STATE_CONFLICT',
      `ExerciseRun ${run.id} must be FORMING before it can become READY.`,
    );
  }
  const assessment = assessRequiredRoleQuorum({
    roleSlots: input.roleSlots,
    assignments: input.assignments,
    minDistinctRequiredAgents: input.minDistinctRequiredAgents,
    compatibilityMode: run.compatibilityMode,
  });
  if (!assessment.ready) {
    fail(
      'RUN_ROLE_QUORUM_NOT_MET',
      `ExerciseRun ${run.id} is not ready: ${assessment.violations.join(', ')}.`,
    );
  }
  return nextRun(run, 'READY');
}

export function startExerciseRun(
  run: ExerciseRun,
  expectedVersion: number,
): ExerciseRun {
  return transitionRun(run, expectedVersion, ['READY'], 'RUNNING');
}

export function pauseExerciseRun(
  run: ExerciseRun,
  expectedVersion: number,
): ExerciseRun {
  return transitionRun(run, expectedVersion, ['RUNNING'], 'PAUSED');
}

export function resumeExerciseRun(
  run: ExerciseRun,
  expectedVersion: number,
): ExerciseRun {
  return transitionRun(run, expectedVersion, ['PAUSED'], 'RUNNING');
}

export function beginExerciseRunCompletion(
  run: ExerciseRun,
  expectedVersion: number,
): ExerciseRun {
  return transitionRun(run, expectedVersion, ['RUNNING'], 'COMPLETING');
}

export function completeExerciseRun(
  run: ExerciseRun,
  expectedVersion: number,
): ExerciseRun {
  return transitionRun(run, expectedVersion, ['COMPLETING'], 'COMPLETED');
}

export function cancelExerciseRun(
  run: ExerciseRun,
  expectedVersion: number,
): ExerciseRun {
  return transitionRun(
    run,
    expectedVersion,
    ['CREATED', 'FORMING', 'READY', 'RUNNING', 'PAUSED', 'COMPLETING'],
    'CANCELLED',
  );
}

export function failExerciseRun(
  run: ExerciseRun,
  expectedVersion: number,
): ExerciseRun {
  return transitionRun(
    run,
    expectedVersion,
    ['CREATED', 'FORMING', 'READY', 'RUNNING', 'PAUSED', 'COMPLETING'],
    'FAILED',
  );
}
