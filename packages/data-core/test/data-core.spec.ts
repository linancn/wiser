import { describe, expect, it } from 'vitest';

import {
  InvalidIngestionTransitionError,
  InvalidOperationTransitionError,
  InvalidQualityGateInputError,
  InvalidSecurityLevelSetError,
  SecurityLevelDowngradeError,
  assertSecurityLevelNotLowered,
  canTransitionIngestionState,
  canTransitionOperationStatus,
  evaluatePublicationEligibility,
  evaluateQualityGate,
  inheritSecurityLevel,
  maximumSecurityLevel,
  transitionIngestionState,
  transitionOperationStatus,
  type QualityGateInput,
} from '../src/index.js';
import type {
  AcceptanceStatus,
  IngestionState,
  OperationStatus,
  SecurityLevel,
} from '@wiser/data-contracts';

const INGESTION_STATES = [
  'RECEIVED',
  'QUARANTINED',
  'SECURITY_SCANNED',
  'FINGERPRINTED',
  'PROFILED',
  'CLASSIFIED',
  'SCHEMA_MAPPED',
  'SEMANTIC_MAPPED',
  'VALIDATED',
  'SPATIOTEMPORAL_ALIGNED',
  'REVIEW_REQUIRED',
  'APPROVED',
  'REJECTED',
  'COMMITTED',
  'PROJECTING',
  'PUBLISHED',
  'FAILED',
  'CANCELLED',
] as const satisfies readonly IngestionState[];

const LEGAL_INGESTION_TRANSITIONS = [
  ['RECEIVED', 'QUARANTINED'],
  ['RECEIVED', 'FAILED'],
  ['RECEIVED', 'CANCELLED'],
  ['QUARANTINED', 'SECURITY_SCANNED'],
  ['QUARANTINED', 'FAILED'],
  ['QUARANTINED', 'CANCELLED'],
  ['SECURITY_SCANNED', 'FINGERPRINTED'],
  ['SECURITY_SCANNED', 'REJECTED'],
  ['SECURITY_SCANNED', 'FAILED'],
  ['SECURITY_SCANNED', 'CANCELLED'],
  ['FINGERPRINTED', 'PROFILED'],
  ['FINGERPRINTED', 'FAILED'],
  ['FINGERPRINTED', 'CANCELLED'],
  ['PROFILED', 'CLASSIFIED'],
  ['PROFILED', 'FAILED'],
  ['PROFILED', 'CANCELLED'],
  ['CLASSIFIED', 'SCHEMA_MAPPED'],
  ['CLASSIFIED', 'FAILED'],
  ['CLASSIFIED', 'CANCELLED'],
  ['SCHEMA_MAPPED', 'SEMANTIC_MAPPED'],
  ['SCHEMA_MAPPED', 'FAILED'],
  ['SCHEMA_MAPPED', 'CANCELLED'],
  ['SEMANTIC_MAPPED', 'VALIDATED'],
  ['SEMANTIC_MAPPED', 'FAILED'],
  ['SEMANTIC_MAPPED', 'CANCELLED'],
  ['VALIDATED', 'SPATIOTEMPORAL_ALIGNED'],
  ['VALIDATED', 'REJECTED'],
  ['VALIDATED', 'FAILED'],
  ['VALIDATED', 'CANCELLED'],
  ['SPATIOTEMPORAL_ALIGNED', 'REVIEW_REQUIRED'],
  ['SPATIOTEMPORAL_ALIGNED', 'APPROVED'],
  ['SPATIOTEMPORAL_ALIGNED', 'FAILED'],
  ['SPATIOTEMPORAL_ALIGNED', 'CANCELLED'],
  ['REVIEW_REQUIRED', 'APPROVED'],
  ['REVIEW_REQUIRED', 'REJECTED'],
  ['REVIEW_REQUIRED', 'FAILED'],
  ['REVIEW_REQUIRED', 'CANCELLED'],
  ['APPROVED', 'COMMITTED'],
  ['APPROVED', 'FAILED'],
  ['APPROVED', 'CANCELLED'],
  ['COMMITTED', 'PROJECTING'],
  ['COMMITTED', 'FAILED'],
  ['PROJECTING', 'PUBLISHED'],
  ['PROJECTING', 'FAILED'],
] as const satisfies readonly (readonly [IngestionState, IngestionState])[];

const OPERATION_STATUSES = [
  'PENDING',
  'RUNNING',
  'WAITING_INPUT',
  'WAITING_REVIEW',
  'SUCCEEDED',
  'FAILED',
  'CANCELLED',
] as const satisfies readonly OperationStatus[];

const LEGAL_OPERATION_TRANSITIONS = [
  ['PENDING', 'RUNNING'],
  ['PENDING', 'WAITING_INPUT'],
  ['PENDING', 'WAITING_REVIEW'],
  ['PENDING', 'FAILED'],
  ['PENDING', 'CANCELLED'],
  ['RUNNING', 'WAITING_INPUT'],
  ['RUNNING', 'WAITING_REVIEW'],
  ['RUNNING', 'SUCCEEDED'],
  ['RUNNING', 'FAILED'],
  ['RUNNING', 'CANCELLED'],
  ['WAITING_INPUT', 'RUNNING'],
  ['WAITING_INPUT', 'FAILED'],
  ['WAITING_INPUT', 'CANCELLED'],
  ['WAITING_REVIEW', 'RUNNING'],
  ['WAITING_REVIEW', 'SUCCEEDED'],
  ['WAITING_REVIEW', 'FAILED'],
  ['WAITING_REVIEW', 'CANCELLED'],
] as const satisfies readonly (readonly [OperationStatus, OperationStatus])[];

function transitionKey(from: string, to: string): string {
  return `${from}->${to}`;
}

describe('ingestion state policy', () => {
  const legalTransitions = new Set(
    LEGAL_INGESTION_TRANSITIONS.map(([from, to]) => transitionKey(from, to)),
  );

  it.each(LEGAL_INGESTION_TRANSITIONS)('allows %s -> %s', (from, to) => {
    expect(canTransitionIngestionState(from, to)).toBe(true);
    expect(transitionIngestionState(from, to)).toBe(to);
  });

  it('rejects every transition not present in the explicit policy', () => {
    for (const from of INGESTION_STATES) {
      for (const to of INGESTION_STATES) {
        if (legalTransitions.has(transitionKey(from, to))) {
          continue;
        }

        expect(canTransitionIngestionState(from, to)).toBe(false);
        expect(() => transitionIngestionState(from, to)).toThrow(
          InvalidIngestionTransitionError,
        );

        try {
          transitionIngestionState(from, to);
        } catch (error) {
          expect(error).toMatchObject({
            code: 'INVALID_INGESTION_TRANSITION',
            from,
            to,
          });
        }
      }
    }
  });
});

describe('deterministic quality gate', () => {
  it('derives grade A and passes when all applicable checks pass', () => {
    expect(
      evaluateQualityGate({
        minimumPassingScore: 0.8,
        checks: [
          { ruleId: 'completeness', status: 'PASSED', weight: 3 },
          { ruleId: 'consistency', status: 'PASSED', weight: 2 },
          { ruleId: 'accuracy', status: 'PASSED', weight: 5 },
          { ruleId: 'advisory', status: 'SKIPPED', weight: 1 },
        ],
      }),
    ).toEqual({
      score: 1,
      grade: 'A',
      passed: true,
      failedRuleIds: [],
      blockingRuleIds: [],
    });
  });

  it('uses deterministic weights and keeps grade separate from gate outcome', () => {
    expect(
      evaluateQualityGate({
        minimumPassingScore: 0.95,
        checks: [
          { ruleId: 'complete', status: 'PASSED', weight: 8 },
          { ruleId: 'warning', status: 'FAILED', weight: 2 },
        ],
      }),
    ).toEqual({
      score: 0.8,
      grade: 'B',
      passed: false,
      failedRuleIds: ['warning'],
      blockingRuleIds: [],
    });
  });

  it('fails a high-scoring gate when any blocking rule fails', () => {
    expect(
      evaluateQualityGate({
        minimumPassingScore: 0.8,
        checks: [
          { ruleId: 'bulk-checks', status: 'PASSED', weight: 99 },
          {
            ruleId: 'malware-free',
            status: 'FAILED',
            weight: 1,
            blocking: true,
          },
        ],
      }),
    ).toMatchObject({
      score: 0.99,
      grade: 'A',
      passed: false,
      blockingRuleIds: ['malware-free'],
    });
  });

  it('fails closed when a blocking rule is skipped', () => {
    expect(
      evaluateQualityGate({
        minimumPassingScore: 0.8,
        checks: [
          { ruleId: 'complete', status: 'PASSED', weight: 1 },
          {
            ruleId: 'security-scan',
            status: 'SKIPPED',
            weight: 1,
            blocking: true,
          },
        ],
      }),
    ).toEqual({
      score: 1,
      grade: 'A',
      passed: false,
      failedRuleIds: [],
      blockingRuleIds: ['security-scan'],
    });
  });

  it('can pass policy at grade C without turning grade into acceptance', () => {
    expect(
      evaluateQualityGate({
        minimumPassingScore: 0.5,
        checks: [
          { ruleId: 'passed', status: 'PASSED', weight: 6 },
          { ruleId: 'failed', status: 'FAILED', weight: 4 },
        ],
      }),
    ).toEqual({
      score: 0.6,
      grade: 'C',
      passed: true,
      failedRuleIds: ['failed'],
      blockingRuleIds: [],
    });
  });

  it.each([
    {
      minimumPassingScore: 0,
      checks: [{ ruleId: 'valid', status: 'PASSED', weight: 1 }],
    },
    {
      minimumPassingScore: 1.1,
      checks: [{ ruleId: 'valid', status: 'PASSED', weight: 1 }],
    },
    {
      minimumPassingScore: 0.8,
      checks: [{ ruleId: 'invalid-weight', status: 'PASSED', weight: 0 }],
    },
    {
      minimumPassingScore: 0.8,
      checks: [{ ruleId: 'skipped', status: 'SKIPPED', weight: 1 }],
    },
    {
      minimumPassingScore: 0.8,
      checks: [
        { ruleId: 'duplicate', status: 'PASSED', weight: 1 },
        { ruleId: 'duplicate', status: 'FAILED', weight: 1 },
      ],
    },
  ] as const satisfies readonly QualityGateInput[])(
    'rejects invalid or unauditable gate input %#',
    (input) => {
      expect(() => evaluateQualityGate(input)).toThrow(
        InvalidQualityGateInputError,
      );
    },
  );
});

describe('security inheritance', () => {
  it.each([
    ['L0_PUBLIC', 'L0_PUBLIC', 'L0_PUBLIC'],
    ['L0_PUBLIC', 'L1_INTERNAL', 'L1_INTERNAL'],
    ['L0_PUBLIC', 'L2_RESTRICTED', 'L2_RESTRICTED'],
    ['L0_PUBLIC', 'L3_CONFIDENTIAL', 'L3_CONFIDENTIAL'],
    ['L1_INTERNAL', 'L0_PUBLIC', 'L1_INTERNAL'],
    ['L1_INTERNAL', 'L1_INTERNAL', 'L1_INTERNAL'],
    ['L1_INTERNAL', 'L2_RESTRICTED', 'L2_RESTRICTED'],
    ['L1_INTERNAL', 'L3_CONFIDENTIAL', 'L3_CONFIDENTIAL'],
    ['L2_RESTRICTED', 'L0_PUBLIC', 'L2_RESTRICTED'],
    ['L2_RESTRICTED', 'L1_INTERNAL', 'L2_RESTRICTED'],
    ['L2_RESTRICTED', 'L2_RESTRICTED', 'L2_RESTRICTED'],
    ['L2_RESTRICTED', 'L3_CONFIDENTIAL', 'L3_CONFIDENTIAL'],
    ['L3_CONFIDENTIAL', 'L0_PUBLIC', 'L3_CONFIDENTIAL'],
    ['L3_CONFIDENTIAL', 'L1_INTERNAL', 'L3_CONFIDENTIAL'],
    ['L3_CONFIDENTIAL', 'L2_RESTRICTED', 'L3_CONFIDENTIAL'],
    ['L3_CONFIDENTIAL', 'L3_CONFIDENTIAL', 'L3_CONFIDENTIAL'],
  ] as const satisfies readonly (readonly [
    SecurityLevel,
    SecurityLevel,
    SecurityLevel,
  ])[])(
    'selects %s + %s -> %s as the inherited level',
    (left, right, level) => {
      expect(maximumSecurityLevel([left, right])).toBe(level);
    },
  );

  it('rejects inheritance without source provenance', () => {
    expect(() => maximumSecurityLevel([])).toThrow(
      InvalidSecurityLevelSetError,
    );
  });

  it('never lets a transformation request lower inherited security', () => {
    expect(
      inheritSecurityLevel(['L1_INTERNAL', 'L2_RESTRICTED'], 'L0_PUBLIC'),
    ).toBe('L2_RESTRICTED');
    expect(inheritSecurityLevel(['L1_INTERNAL'], 'L3_CONFIDENTIAL')).toBe(
      'L3_CONFIDENTIAL',
    );
  });

  it('throws an explicit domain error when a proposed level is too low', () => {
    expect(() =>
      assertSecurityLevelNotLowered('L2_RESTRICTED', 'L1_INTERNAL'),
    ).toThrow(SecurityLevelDowngradeError);

    try {
      assertSecurityLevelNotLowered('L3_CONFIDENTIAL', 'L0_PUBLIC');
    } catch (error) {
      expect(error).toMatchObject({
        code: 'SECURITY_LEVEL_DOWNGRADE',
        inheritedLevel: 'L3_CONFIDENTIAL',
        proposedLevel: 'L0_PUBLIC',
      });
    }
  });
});

describe('publication eligibility', () => {
  const acceptedStatuses = [
    'PASSED',
    'CONDITIONALLY_PASSED',
  ] as const satisfies readonly AcceptanceStatus[];

  it.each(acceptedStatuses)(
    'allows %s data only after commit, quality gate, and every projection succeed',
    (acceptanceStatus) => {
      expect(
        evaluatePublicationEligibility({
          ingestionState: 'PROJECTING',
          authoritativeVersionCommitted: true,
          qualityGatePassed: true,
          acceptanceStatus,
          projections: [
            { projectionId: 'opensearch', status: 'SUCCEEDED' },
            { projectionId: 'weaviate', status: 'SUCCEEDED' },
            { projectionId: 'neo4j', status: 'SUCCEEDED' },
            { projectionId: 'stac', status: 'SUCCEEDED' },
          ],
        }),
      ).toEqual({ eligible: true, reasons: [] });
    },
  );

  it('keeps deterministic quality and acceptance as independent gates', () => {
    expect(
      evaluatePublicationEligibility({
        ingestionState: 'PROJECTING',
        authoritativeVersionCommitted: true,
        qualityGatePassed: true,
        acceptanceStatus: 'REJECTED',
        projections: [{ projectionId: 'search', status: 'SUCCEEDED' }],
      }),
    ).toEqual({ eligible: false, reasons: ['ACCEPTANCE_NOT_ELIGIBLE'] });

    expect(
      evaluatePublicationEligibility({
        ingestionState: 'PROJECTING',
        authoritativeVersionCommitted: true,
        qualityGatePassed: false,
        acceptanceStatus: 'PASSED',
        projections: [{ projectionId: 'search', status: 'SUCCEEDED' }],
      }),
    ).toEqual({ eligible: false, reasons: ['QUALITY_GATE_FAILED'] });
  });

  it.each([
    'PENDING',
    'CORRECTION_REQUIRED',
    'ARCHIVED_ONLY',
    'REJECTED',
  ] as const satisfies readonly AcceptanceStatus[])(
    'blocks non-accepted status %s',
    (acceptanceStatus) => {
      expect(
        evaluatePublicationEligibility({
          ingestionState: 'PROJECTING',
          authoritativeVersionCommitted: true,
          qualityGatePassed: true,
          acceptanceStatus,
          projections: [{ projectionId: 'search', status: 'SUCCEEDED' }],
        }),
      ).toEqual({ eligible: false, reasons: ['ACCEPTANCE_NOT_ELIGIBLE'] });
    },
  );

  it('reports every unmet publication condition in stable policy order', () => {
    expect(
      evaluatePublicationEligibility({
        ingestionState: 'COMMITTED',
        authoritativeVersionCommitted: false,
        qualityGatePassed: false,
        acceptanceStatus: 'CORRECTION_REQUIRED',
        projections: [
          { projectionId: 'search', status: 'FAILED' },
          { projectionId: 'search', status: 'SUCCEEDED' },
        ],
      }),
    ).toEqual({
      eligible: false,
      reasons: [
        'INGESTION_NOT_PROJECTING',
        'AUTHORITATIVE_VERSION_NOT_COMMITTED',
        'QUALITY_GATE_FAILED',
        'ACCEPTANCE_NOT_ELIGIBLE',
        'DUPLICATE_PROJECTION',
        'PROJECTIONS_INCOMPLETE',
      ],
    });
  });

  it('requires an explicit non-empty projection set', () => {
    expect(
      evaluatePublicationEligibility({
        ingestionState: 'PROJECTING',
        authoritativeVersionCommitted: true,
        qualityGatePassed: true,
        acceptanceStatus: 'PASSED',
        projections: [],
      }),
    ).toEqual({ eligible: false, reasons: ['PROJECTIONS_MISSING'] });
  });
});

describe('operation state policy', () => {
  const legalTransitions = new Set(
    LEGAL_OPERATION_TRANSITIONS.map(([from, to]) => transitionKey(from, to)),
  );

  it.each(LEGAL_OPERATION_TRANSITIONS)('allows %s -> %s', (from, to) => {
    expect(canTransitionOperationStatus(from, to)).toBe(true);
    expect(transitionOperationStatus(from, to)).toBe(to);
  });

  it('rejects every transition not present in the explicit policy', () => {
    for (const from of OPERATION_STATUSES) {
      for (const to of OPERATION_STATUSES) {
        if (legalTransitions.has(transitionKey(from, to))) {
          continue;
        }

        expect(canTransitionOperationStatus(from, to)).toBe(false);
        expect(() => transitionOperationStatus(from, to)).toThrow(
          InvalidOperationTransitionError,
        );

        try {
          transitionOperationStatus(from, to);
        } catch (error) {
          expect(error).toMatchObject({
            code: 'INVALID_OPERATION_TRANSITION',
            from,
            to,
          });
        }
      }
    }
  });
});
