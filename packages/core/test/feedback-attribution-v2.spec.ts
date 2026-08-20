import { describe, expect, it } from 'vitest';

import {
  type DomainError,
  consumeFeedbackActionGrant,
  createEvaluationAttribution,
  createFeedbackActionGrant,
  groupEvaluationAttributions,
  revokeFeedbackActionGrant,
} from '../src/index.js';

const issuedAt = '2023-03-22T07:00:00.000Z';
const beforeExpiry = '2023-03-22T07:10:00.000Z';
const expiresAt = '2023-03-22T07:20:00.000Z';

function grant() {
  return createFeedbackActionGrant({
    id: 'grant-revise-evidence',
    targetRunAgentId: 'agent-a',
    targetTaskId: 'task-evidence',
    action: 'revise_task',
    predecessorSubmissionId: 'submission-evidence-v1',
    evaluationId: 'evaluation-evidence-v1',
    issuedRunSeq: 50,
    issuedAt,
    expiresVirtualAt: expiresAt,
    expiresAt,
    maxUses: 1,
    scopeHash: 'sha256:grant-scope',
  });
}

describe('feedback_action_grant', () => {
  it('consumes only the exact scoped action and enforces max uses', () => {
    const initial = grant();
    const consumed = consumeFeedbackActionGrant(initial, {
      expectedVersion: initial.version,
      runAgentId: 'agent-a',
      taskId: 'task-evidence',
      action: 'revise_task',
      predecessorSubmissionId: 'submission-evidence-v1',
      evaluationId: 'evaluation-evidence-v1',
      scopeHash: 'sha256:grant-scope',
      now: beforeExpiry,
      virtualTime: beforeExpiry,
    });

    expect(consumed).toMatchObject({ usedCount: 1, maxUses: 1, version: 2 });
    expect(initial).toMatchObject({ usedCount: 0, version: 1 });
    expect(() =>
      consumeFeedbackActionGrant(consumed, {
        expectedVersion: consumed.version,
        runAgentId: 'agent-a',
        taskId: 'task-evidence',
        action: 'revise_task',
        predecessorSubmissionId: 'submission-evidence-v1',
        evaluationId: 'evaluation-evidence-v1',
        scopeHash: 'sha256:grant-scope',
        now: beforeExpiry,
        virtualTime: beforeExpiry,
      }),
    ).toThrowError(
      expect.objectContaining<Partial<DomainError>>({
        code: 'FEEDBACK_GRANT_EXHAUSTED',
      }),
    );
  });

  it.each([
    ['runAgentId', 'agent-b'],
    ['taskId', 'task-ecology'],
    ['action', 'endorse'],
    ['predecessorSubmissionId', 'submission-other'],
    ['evaluationId', 'evaluation-other'],
    ['scopeHash', 'sha256:other-scope'],
  ] as const)('rejects a mismatched %s', (field, value) => {
    const initial = grant();
    expect(() =>
      consumeFeedbackActionGrant(initial, {
        expectedVersion: initial.version,
        runAgentId: 'agent-a',
        taskId: 'task-evidence',
        action: 'revise_task',
        predecessorSubmissionId: 'submission-evidence-v1',
        evaluationId: 'evaluation-evidence-v1',
        scopeHash: 'sha256:grant-scope',
        now: beforeExpiry,
        virtualTime: beforeExpiry,
        [field]: value,
      }),
    ).toThrowError(
      expect.objectContaining<Partial<DomainError>>({
        code: 'FEEDBACK_GRANT_SCOPE_MISMATCH',
      }),
    );
  });

  it('rejects wall/virtual expiry and revocation, all without mutating history', () => {
    const initial = grant();
    expect(() =>
      consumeFeedbackActionGrant(initial, {
        expectedVersion: initial.version,
        runAgentId: 'agent-a',
        taskId: 'task-evidence',
        action: 'revise_task',
        predecessorSubmissionId: 'submission-evidence-v1',
        evaluationId: 'evaluation-evidence-v1',
        scopeHash: 'sha256:grant-scope',
        now: expiresAt,
        virtualTime: beforeExpiry,
      }),
    ).toThrowError(
      expect.objectContaining<Partial<DomainError>>({
        code: 'FEEDBACK_GRANT_EXPIRED',
      }),
    );

    const revoked = revokeFeedbackActionGrant(initial, {
      expectedVersion: initial.version,
      revokedRunSeq: 55,
    });
    expect(revoked).toMatchObject({ revokedRunSeq: 55, version: 2 });
    expect(initial.revokedRunSeq).toBeUndefined();
    expect(() =>
      consumeFeedbackActionGrant(revoked, {
        expectedVersion: revoked.version,
        runAgentId: 'agent-a',
        taskId: 'task-evidence',
        action: 'revise_task',
        predecessorSubmissionId: 'submission-evidence-v1',
        evaluationId: 'evaluation-evidence-v1',
        scopeHash: 'sha256:grant-scope',
        now: beforeExpiry,
        virtualTime: beforeExpiry,
      }),
    ).toThrowError(
      expect.objectContaining<Partial<DomainError>>({
        code: 'FEEDBACK_GRANT_REVOKED',
      }),
    );
  });
});

describe('explicit individual, role and team evaluation attribution', () => {
  it('keeps the three scopes distinct and never fans a team metric out to people', () => {
    const team = createEvaluationAttribution({
      id: 'attribution-team',
      metricResultId: 'metric-plan-feasibility',
      scope: 'team',
      targetTeamId: 'team-yongding',
      evidenceRefs: [{ type: 'submission', id: 'submission-team-v1' }],
    });
    const groupedTeamOnly = groupEvaluationAttributions([team]);

    expect(groupedTeamOnly).toEqual({
      individual: [],
      role: [],
      team: [team],
    });

    const individual = createEvaluationAttribution({
      id: 'attribution-agent-a',
      metricResultId: 'metric-evidence-quality',
      scope: 'individual',
      targetRunAgentId: 'agent-a',
      evidenceRefs: [{ type: 'artifact', id: 'artifact-evidence-v2' }],
    });
    const role = createEvaluationAttribution({
      id: 'attribution-role-evidence',
      metricResultId: 'metric-evidence-coverage',
      scope: 'role',
      targetRoleId: 'water-evidence',
      evidenceRefs: [{ type: 'task', id: 'task-evidence' }],
    });

    expect(groupEvaluationAttributions([team, individual, role])).toEqual({
      individual: [individual],
      role: [role],
      team: [team],
    });
  });

  it('rejects ambiguous targets instead of inferring attribution', () => {
    expect(() =>
      createEvaluationAttribution({
        id: 'attribution-invalid',
        metricResultId: 'metric-team',
        scope: 'team',
        targetTeamId: 'team-yongding',
        targetRunAgentId: 'agent-a',
        evidenceRefs: [{ type: 'submission', id: 'submission-team-v1' }],
      } as never),
    ).toThrowError(
      expect.objectContaining<Partial<DomainError>>({
        code: 'ATTRIBUTION_TARGET_INVALID',
      }),
    );
  });
});
