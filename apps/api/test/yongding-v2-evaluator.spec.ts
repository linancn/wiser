import { describe, expect, it } from 'vitest';

import { evaluateYongdingV2RoleOutput } from '../src/index.js';

describe('Yongding v2 deterministic role evaluator', () => {
  it.each([
    [
      'water-evidence',
      {
        evidenceRegister: [{}, {}, {}],
        inflowSummary: {},
        evidenceRefs: ['receipt-1'],
      },
      1,
    ],
    [
      'hydraulic-constraints',
      {
        sectionResponse: [{}, {}, {}, {}],
        constraints: {},
        evidenceRefs: ['receipt-1'],
      },
      1,
    ],
    [
      'ecological-target',
      {
        targetRegister: [{}, {}, {}, {}],
        riskPriorities: [{}],
        evidenceRefs: ['receipt-1'],
      },
      1,
    ],
    [
      'dispatch-coordination',
      {
        candidatePlan: {},
        artifactVersionRefs: ['artifact-1', 'artifact-2', 'artifact-3'],
        evidenceRefs: ['receipt-1'],
      },
      3,
    ],
  ] as const)(
    'accepts a schema-valid %s output with enough ArtifactVersion evidence',
    (roleSlotId, payload, artifactReferenceCount) => {
      expect(
        evaluateYongdingV2RoleOutput({
          roleSlotId,
          payload,
          artifactReferenceCount,
        }),
      ).toEqual({ verdict: 'ACCEPTED', issues: [] });
    },
  );

  it('returns stable issues instead of using an LLM verdict', () => {
    expect(
      evaluateYongdingV2RoleOutput({
        roleSlotId: 'water-evidence',
        payload: { evidenceRegister: [] },
        artifactReferenceCount: 0,
      }),
    ).toEqual({
      verdict: 'REWORK_REQUIRED',
      issues: [
        'OUTPUT_SCHEMA_REQUIRED_FIELD',
        'OUTPUT_SCHEMA_MIN_ITEMS',
        'ARTIFACT_EVIDENCE_REQUIRED',
      ],
    });
  });
});
