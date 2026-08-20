import { describe, expect, it } from 'vitest';

import { buildRunDiagnostics } from './run-diagnostics';

const roles = [
  'water-evidence',
  'hydraulic-constraints',
  'ecological-target',
  'dispatch-coordination',
] as const;

const accepted = roles.map((roleSlotId, index) => ({
  id: `evaluation-${index}`,
  roleSlotId,
  targetScope: roleSlotId === 'dispatch-coordination' ? 'team' : 'role',
  verdict: 'ACCEPTED' as const,
  issueCodes: [] as readonly string[],
  submissionId: `submission-${index}`,
  deterministic: true as const,
  evaluatorVersion: 'yongding-role-output-v1',
  createdRunSeq: 100 + index,
  createdAt: `2026-08-20T10:3${index}:00.000Z`,
}));

describe('run diagnostics projection', () => {
  it('keeps deterministic acceptance authoritative while surfacing telemetry gaps', () => {
    const diagnostics = buildRunDiagnostics({
      requiredRoleIds: roles,
      evaluations: [
        {
          ...accepted[0]!,
          id: 'evaluation-water-red',
          verdict: 'REWORK_REQUIRED',
          issueCodes: ['OUTPUT_SCHEMA_ADDITIONAL_PROPERTY'],
          createdRunSeq: 90,
        },
        ...accepted,
      ],
      releasedBarrierKeys: ['analysis-ready', 'endorsement-ready'],
      telemetry: {
        boundaryCoverage: 1,
        participantMode: 'partial',
        platformSpanCount: 8,
        participantSpanCount: 12,
        traceSummaryCount: 4,
        spanDetailCount: 0,
        droppedSpanCount: 2,
        lateSpanCount: 1,
        logRecordCount: 0,
        metricSeriesCount: 0,
      },
    });

    expect(diagnostics.status).toBe('passed_with_gaps');
    expect(diagnostics.authoritative).toMatchObject({
      acceptedRoleCount: 4,
      requiredRoleCount: 4,
      deterministic: true,
      releasedBarrierCount: 2,
    });
    expect(
      diagnostics.evaluationLanes
        .find(({ roleSlotId }) => roleSlotId === 'water-evidence')
        ?.revisions.map(({ verdict }) => verdict),
    ).toEqual(['REWORK_REQUIRED', 'ACCEPTED']);
    expect(diagnostics.signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'traces', status: 'observed' }),
        expect.objectContaining({ id: 'span-detail', status: 'missing' }),
        expect.objectContaining({ id: 'logs', status: 'missing' }),
        expect.objectContaining({ id: 'metrics', status: 'missing' }),
      ]),
    );
    expect(diagnostics.findings.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        'PARTICIPANT_TELEMETRY_PARTIAL',
        'TELEMETRY_DROPPED_SPANS',
        'TELEMETRY_LATE_SPANS',
        'SPAN_DETAIL_UNAVAILABLE',
      ]),
    );
  });

  it('never infers a passing authority state from spans when a barrier is absent', () => {
    const diagnostics = buildRunDiagnostics({
      requiredRoleIds: roles,
      evaluations: accepted,
      releasedBarrierKeys: ['analysis-ready'],
      telemetry: {
        boundaryCoverage: 1,
        participantMode: 'instrumented',
        platformSpanCount: 30,
        participantSpanCount: 40,
        traceSummaryCount: 8,
        spanDetailCount: 64,
        droppedSpanCount: 0,
        lateSpanCount: 0,
        logRecordCount: 100,
        metricSeriesCount: 12,
      },
    });

    expect(diagnostics.status).toBe('incomplete');
    expect(diagnostics.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'AUTHORITATIVE_BARRIER_PENDING',
          source: 'authoritative',
        }),
      ]),
    );
  });
});
