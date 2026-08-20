export type DiagnosticVerdict = 'ACCEPTED' | 'REWORK_REQUIRED';

export interface DiagnosticEvaluation {
  readonly id: string;
  readonly roleSlotId: string;
  readonly targetScope: 'individual' | 'role' | 'team';
  readonly verdict: DiagnosticVerdict;
  readonly issueCodes: readonly string[];
  readonly submissionId: string;
  readonly deterministic: boolean;
  readonly evaluatorVersion: string;
  readonly createdRunSeq: number;
  readonly createdAt: string;
}

export interface DiagnosticTelemetryInput {
  readonly boundaryCoverage: number;
  readonly participantMode: 'none' | 'partial' | 'instrumented';
  readonly platformSpanCount: number;
  readonly participantSpanCount: number;
  readonly traceSummaryCount: number;
  readonly spanDetailCount: number;
  readonly droppedSpanCount: number;
  readonly lateSpanCount: number;
  readonly logRecordCount: number;
  readonly metricSeriesCount: number;
}

export type DiagnosticFindingCode =
  | 'AUTHORITATIVE_BARRIER_PENDING'
  | 'AUTHORITATIVE_REWORK_REQUIRED'
  | 'DETERMINISTIC_REWORK_OBSERVED'
  | 'PARTICIPANT_TELEMETRY_NONE'
  | 'PARTICIPANT_TELEMETRY_PARTIAL'
  | 'TELEMETRY_DROPPED_SPANS'
  | 'TELEMETRY_LATE_SPANS'
  | 'SPAN_DETAIL_UNAVAILABLE'
  | 'LOG_SIGNAL_UNAVAILABLE'
  | 'METRIC_SIGNAL_UNAVAILABLE';

export interface DiagnosticFinding {
  readonly code: DiagnosticFindingCode;
  readonly severity: 'error' | 'warning' | 'info';
  readonly source: 'authoritative' | 'telemetry';
  readonly count?: number;
}

export interface DiagnosticSignal {
  readonly id:
    'traces' | 'span-detail' | 'participant-spans' | 'logs' | 'metrics';
  readonly status: 'observed' | 'partial' | 'missing';
  readonly count: number;
  readonly trust: 'platform_observed' | 'participant_reported' | 'mixed';
}

export interface RunDiagnostics {
  readonly status: 'passed' | 'passed_with_gaps' | 'incomplete' | 'failed';
  readonly authoritative: {
    readonly acceptedRoleCount: number;
    readonly requiredRoleCount: number;
    readonly deterministic: boolean;
    readonly releasedBarrierCount: number;
    readonly requiredBarrierCount: number;
  };
  readonly evaluationLanes: readonly {
    readonly roleSlotId: string;
    readonly latestVerdict?: DiagnosticVerdict;
    readonly revisions: readonly DiagnosticEvaluation[];
  }[];
  readonly barriers: readonly {
    readonly key: string;
    readonly released: boolean;
  }[];
  readonly telemetry: DiagnosticTelemetryInput;
  readonly signals: readonly DiagnosticSignal[];
  readonly findings: readonly DiagnosticFinding[];
}

export interface BuildRunDiagnosticsInput {
  readonly requiredRoleIds: readonly string[];
  readonly evaluations: readonly DiagnosticEvaluation[];
  readonly releasedBarrierKeys: readonly string[];
  readonly expectedBarrierKeys?: readonly string[];
  readonly telemetry: DiagnosticTelemetryInput;
}

function signalStatus(
  count: number,
  partial = false,
): DiagnosticSignal['status'] {
  if (count === 0) return 'missing';
  return partial ? 'partial' : 'observed';
}

export function buildRunDiagnostics(
  input: BuildRunDiagnosticsInput,
): RunDiagnostics {
  const expectedBarrierKeys = input.expectedBarrierKeys ?? [
    'analysis-ready',
    'endorsement-ready',
  ];
  const released = new Set(input.releasedBarrierKeys);
  const evaluationLanes = input.requiredRoleIds.map((roleSlotId) => {
    const revisions = input.evaluations
      .filter((evaluation) => evaluation.roleSlotId === roleSlotId)
      .sort((left, right) => left.createdRunSeq - right.createdRunSeq);
    return {
      roleSlotId,
      latestVerdict: revisions.at(-1)?.verdict,
      revisions,
    };
  });
  const acceptedRoleCount = evaluationLanes.filter(
    ({ revisions }) =>
      revisions.at(-1)?.verdict === 'ACCEPTED' &&
      revisions.at(-1)?.deterministic === true,
  ).length;
  const pendingLatest = evaluationLanes.some(
    ({ latestVerdict }) => latestVerdict === 'REWORK_REQUIRED',
  );
  const allBarriersReleased = expectedBarrierKeys.every((key) =>
    released.has(key),
  );
  const deterministic = input.evaluations.every(
    (evaluation) => evaluation.deterministic,
  );
  const signals: readonly DiagnosticSignal[] = [
    {
      id: 'traces',
      status: signalStatus(
        input.telemetry.traceSummaryCount,
        input.telemetry.boundaryCoverage < 1,
      ),
      count: input.telemetry.traceSummaryCount,
      trust: 'platform_observed',
    },
    {
      id: 'span-detail',
      status: signalStatus(input.telemetry.spanDetailCount),
      count: input.telemetry.spanDetailCount,
      trust: 'mixed',
    },
    {
      id: 'participant-spans',
      status: signalStatus(
        input.telemetry.participantSpanCount,
        input.telemetry.participantMode !== 'instrumented',
      ),
      count: input.telemetry.participantSpanCount,
      trust: 'participant_reported',
    },
    {
      id: 'logs',
      status: signalStatus(input.telemetry.logRecordCount),
      count: input.telemetry.logRecordCount,
      trust: 'mixed',
    },
    {
      id: 'metrics',
      status: signalStatus(input.telemetry.metricSeriesCount),
      count: input.telemetry.metricSeriesCount,
      trust: 'platform_observed',
    },
  ];
  const findings: DiagnosticFinding[] = [];
  if (!allBarriersReleased) {
    findings.push({
      code: 'AUTHORITATIVE_BARRIER_PENDING',
      severity: 'error',
      source: 'authoritative',
      count: expectedBarrierKeys.filter((key) => !released.has(key)).length,
    });
  }
  if (pendingLatest) {
    findings.push({
      code: 'AUTHORITATIVE_REWORK_REQUIRED',
      severity: 'error',
      source: 'authoritative',
    });
  }
  const reworkCount = input.evaluations.filter(
    ({ verdict }) => verdict === 'REWORK_REQUIRED',
  ).length;
  if (reworkCount > 0) {
    findings.push({
      code: 'DETERMINISTIC_REWORK_OBSERVED',
      severity: 'info',
      source: 'authoritative',
      count: reworkCount,
    });
  }
  if (input.telemetry.participantMode === 'none') {
    findings.push({
      code: 'PARTICIPANT_TELEMETRY_NONE',
      severity: 'warning',
      source: 'telemetry',
    });
  } else if (input.telemetry.participantMode === 'partial') {
    findings.push({
      code: 'PARTICIPANT_TELEMETRY_PARTIAL',
      severity: 'warning',
      source: 'telemetry',
    });
  }
  if (input.telemetry.droppedSpanCount > 0) {
    findings.push({
      code: 'TELEMETRY_DROPPED_SPANS',
      severity: 'warning',
      source: 'telemetry',
      count: input.telemetry.droppedSpanCount,
    });
  }
  if (input.telemetry.lateSpanCount > 0) {
    findings.push({
      code: 'TELEMETRY_LATE_SPANS',
      severity: 'warning',
      source: 'telemetry',
      count: input.telemetry.lateSpanCount,
    });
  }
  if (input.telemetry.spanDetailCount === 0) {
    findings.push({
      code: 'SPAN_DETAIL_UNAVAILABLE',
      severity: 'info',
      source: 'telemetry',
    });
  }
  if (input.telemetry.logRecordCount === 0) {
    findings.push({
      code: 'LOG_SIGNAL_UNAVAILABLE',
      severity: 'info',
      source: 'telemetry',
    });
  }
  if (input.telemetry.metricSeriesCount === 0) {
    findings.push({
      code: 'METRIC_SIGNAL_UNAVAILABLE',
      severity: 'info',
      source: 'telemetry',
    });
  }

  const authorityComplete =
    acceptedRoleCount === input.requiredRoleIds.length &&
    input.requiredRoleIds.length > 0 &&
    allBarriersReleased &&
    deterministic;
  const telemetryHasGaps =
    input.telemetry.boundaryCoverage < 1 ||
    input.telemetry.participantMode !== 'instrumented' ||
    input.telemetry.droppedSpanCount > 0 ||
    input.telemetry.lateSpanCount > 0 ||
    signals.some(({ status }) => status !== 'observed');
  const status: RunDiagnostics['status'] = authorityComplete
    ? telemetryHasGaps
      ? 'passed_with_gaps'
      : 'passed'
    : pendingLatest
      ? 'failed'
      : 'incomplete';

  return {
    status,
    authoritative: {
      acceptedRoleCount,
      requiredRoleCount: input.requiredRoleIds.length,
      deterministic,
      releasedBarrierCount: expectedBarrierKeys.filter((key) =>
        released.has(key),
      ).length,
      requiredBarrierCount: expectedBarrierKeys.length,
    },
    evaluationLanes,
    barriers: expectedBarrierKeys.map((key) => ({
      key,
      released: released.has(key),
    })),
    telemetry: input.telemetry,
    signals,
    findings,
  };
}
