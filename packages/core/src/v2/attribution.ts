import { fail, freezeArray, requireNonEmpty } from './shared.js';

export type EvaluationAttributionEvidenceType =
  'task' | 'submission' | 'artifact' | 'message' | 'run_agent';

export interface EvaluationAttributionEvidenceRef {
  readonly type: EvaluationAttributionEvidenceType;
  readonly id: string;
}

interface EvaluationAttributionBase {
  readonly id: string;
  readonly metricResultId: string;
  readonly evidenceRefs: readonly EvaluationAttributionEvidenceRef[];
}

export interface IndividualEvaluationAttribution extends EvaluationAttributionBase {
  readonly scope: 'individual';
  readonly targetRunAgentId: string;
}

export interface RoleEvaluationAttribution extends EvaluationAttributionBase {
  readonly scope: 'role';
  readonly targetRoleId: string;
}

export interface TeamEvaluationAttribution extends EvaluationAttributionBase {
  readonly scope: 'team';
  readonly targetTeamId: string;
}

export type EvaluationAttribution =
  | IndividualEvaluationAttribution
  | RoleEvaluationAttribution
  | TeamEvaluationAttribution;

type CreateEvaluationAttributionInput =
  | (EvaluationAttributionBase & {
      readonly scope: 'individual';
      readonly targetRunAgentId: string;
      readonly targetRoleId?: never;
      readonly targetTeamId?: never;
    })
  | (EvaluationAttributionBase & {
      readonly scope: 'role';
      readonly targetRunAgentId?: never;
      readonly targetRoleId: string;
      readonly targetTeamId?: never;
    })
  | (EvaluationAttributionBase & {
      readonly scope: 'team';
      readonly targetRunAgentId?: never;
      readonly targetRoleId?: never;
      readonly targetTeamId: string;
    });

export function createEvaluationAttribution(
  input: CreateEvaluationAttributionInput,
): EvaluationAttribution {
  requireNonEmpty(input.id, 'id');
  requireNonEmpty(input.metricResultId, 'metricResultId');
  if (input.evidenceRefs.length === 0) {
    fail(
      'ATTRIBUTION_EVIDENCE_REQUIRED',
      'An evaluation attribution requires explicit evidence.',
    );
  }
  const raw = input as unknown as Record<string, unknown>;
  const targets = [
    raw.targetRunAgentId,
    raw.targetRoleId,
    raw.targetTeamId,
  ].filter((target) => typeof target === 'string' && target.length > 0);
  const expectedTarget =
    input.scope === 'individual'
      ? raw.targetRunAgentId
      : input.scope === 'role'
        ? raw.targetRoleId
        : raw.targetTeamId;
  if (targets.length !== 1 || typeof expectedTarget !== 'string') {
    fail(
      'ATTRIBUTION_TARGET_INVALID',
      'Exactly one target matching the attribution scope is required.',
    );
  }
  const evidenceRefs = freezeArray(
    input.evidenceRefs.map((reference) => {
      requireNonEmpty(reference.id, 'evidenceRef.id');
      return Object.freeze({ ...reference });
    }),
  );
  if (input.scope === 'individual') {
    return Object.freeze({
      id: input.id,
      metricResultId: input.metricResultId,
      scope: input.scope,
      targetRunAgentId: input.targetRunAgentId,
      evidenceRefs,
    });
  }
  if (input.scope === 'role') {
    return Object.freeze({
      id: input.id,
      metricResultId: input.metricResultId,
      scope: input.scope,
      targetRoleId: input.targetRoleId,
      evidenceRefs,
    });
  }
  return Object.freeze({
    id: input.id,
    metricResultId: input.metricResultId,
    scope: input.scope,
    targetTeamId: input.targetTeamId,
    evidenceRefs,
  });
}

export function groupEvaluationAttributions(
  attributions: readonly EvaluationAttribution[],
): {
  readonly individual: readonly IndividualEvaluationAttribution[];
  readonly role: readonly RoleEvaluationAttribution[];
  readonly team: readonly TeamEvaluationAttribution[];
} {
  return Object.freeze({
    individual: freezeArray(
      attributions.filter(
        (attribution): attribution is IndividualEvaluationAttribution =>
          attribution.scope === 'individual',
      ),
    ),
    role: freezeArray(
      attributions.filter(
        (attribution): attribution is RoleEvaluationAttribution =>
          attribution.scope === 'role',
      ),
    ),
    team: freezeArray(
      attributions.filter(
        (attribution): attribution is TeamEvaluationAttribution =>
          attribution.scope === 'team',
      ),
    ),
  });
}
