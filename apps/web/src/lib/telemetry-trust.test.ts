import { describe, expect, it } from 'vitest';

import { getRunById } from './platform';

describe('telemetry trust projection', () => {
  it('distinguishes platform-observed boundaries from participant-reported spans', () => {
    const run = getRunById('run-yongding-spring-042');
    expect(run?.boundaryCoverage).toBe(1);
    expect(run?.participantTelemetry.mode).toBe('instrumented');
    expect(run?.participantTelemetry.platformObservedSpanCount).toBeGreaterThan(
      0,
    );
    expect(
      run?.participantTelemetry.participantReportedSpanCount,
    ).toBeGreaterThan(0);
    expect(run?.participantTelemetry.droppedSpanCount).toBeGreaterThanOrEqual(
      0,
    );
    expect(run?.participantTelemetry.lateSpanCount).toBeGreaterThanOrEqual(0);
    expect(run?.participantTelemetry).not.toHaveProperty('coverage');

    const platformSpans = run?.spans.filter(
      (span) => span.telemetryTrust === 'platform_observed',
    );
    expect(platformSpans?.length).toBeGreaterThan(0);
    expect(
      platformSpans?.every((span) => span.telemetrySource === 'excon_service'),
    ).toBe(true);

    const participantSpans = run?.spans.filter(
      (span) => span.telemetryTrust === 'participant_reported',
    );
    expect(participantSpans?.length).toBeGreaterThan(0);
    expect(
      participantSpans?.every(
        (span) => span.telemetrySource === 'participant_exporter',
      ),
    ).toBe(true);
  });
});
