import type { QualityGrade } from '@wiser/data-contracts';

import { DataFoundationDomainError } from '../domain-error.js';

export type QualityCheckStatus = 'PASSED' | 'FAILED' | 'SKIPPED';

export interface DeterministicQualityCheck {
  readonly ruleId: string;
  readonly status: QualityCheckStatus;
  readonly weight: number;
  readonly blocking?: boolean;
}

export interface QualityGateInput {
  readonly checks: readonly DeterministicQualityCheck[];
  readonly minimumPassingScore: number;
}

export interface QualityGateDecision {
  readonly score: number;
  readonly grade: QualityGrade;
  readonly passed: boolean;
  readonly failedRuleIds: readonly string[];
  readonly blockingRuleIds: readonly string[];
}

export class InvalidQualityGateInputError extends DataFoundationDomainError {
  constructor(message: string) {
    super('INVALID_QUALITY_GATE_INPUT', message);
    this.name = 'InvalidQualityGateInputError';
  }
}

export const QUALITY_GRADE_THRESHOLDS = Object.freeze({
  A: 0.9,
  B: 0.75,
  C: 0,
} satisfies Readonly<Record<QualityGrade, number>>);

function qualityGradeFor(score: number): QualityGrade {
  if (score >= QUALITY_GRADE_THRESHOLDS.A) {
    return 'A';
  }
  if (score >= QUALITY_GRADE_THRESHOLDS.B) {
    return 'B';
  }
  return 'C';
}

function validateQualityGateInput(input: QualityGateInput): void {
  if (
    !Number.isFinite(input.minimumPassingScore) ||
    input.minimumPassingScore <= 0 ||
    input.minimumPassingScore > 1
  ) {
    throw new InvalidQualityGateInputError(
      'minimumPassingScore must be a finite number greater than 0 and at most 1.',
    );
  }

  const ruleIds = new Set<string>();
  let applicableCheckCount = 0;

  for (const check of input.checks) {
    if (check.ruleId.trim().length === 0) {
      throw new InvalidQualityGateInputError(
        'Every quality check requires a non-empty ruleId.',
      );
    }
    if (ruleIds.has(check.ruleId)) {
      throw new InvalidQualityGateInputError(
        `Quality rule ${check.ruleId} appears more than once.`,
      );
    }
    ruleIds.add(check.ruleId);

    if (!Number.isFinite(check.weight) || check.weight <= 0) {
      throw new InvalidQualityGateInputError(
        `Quality rule ${check.ruleId} must have a positive finite weight.`,
      );
    }
    if (check.status !== 'SKIPPED') {
      applicableCheckCount += 1;
    }
  }

  if (applicableCheckCount === 0) {
    throw new InvalidQualityGateInputError(
      'At least one applicable quality check is required.',
    );
  }
}

function stableScore(passedWeight: number, applicableWeight: number): number {
  return Math.round((passedWeight / applicableWeight) * 1_000_000) / 1_000_000;
}

export function evaluateQualityGate(
  input: QualityGateInput,
): QualityGateDecision {
  validateQualityGateInput(input);

  let passedWeight = 0;
  let applicableWeight = 0;
  const failedRuleIds: string[] = [];
  const blockingRuleIds: string[] = [];

  for (const check of input.checks) {
    if (check.blocking === true && check.status !== 'PASSED') {
      blockingRuleIds.push(check.ruleId);
    }
    if (check.status === 'SKIPPED') {
      continue;
    }

    applicableWeight += check.weight;
    if (check.status === 'PASSED') {
      passedWeight += check.weight;
      continue;
    }

    failedRuleIds.push(check.ruleId);
  }

  const score = stableScore(passedWeight, applicableWeight);
  return Object.freeze({
    score,
    grade: qualityGradeFor(score),
    passed: score >= input.minimumPassingScore && blockingRuleIds.length === 0,
    failedRuleIds: Object.freeze(failedRuleIds),
    blockingRuleIds: Object.freeze(blockingRuleIds),
  });
}
