import type { CSSProperties } from 'react';

import { getDictionary, getTelemetryModeLabel, type Locale } from '../lib/i18n';
import type { ExerciseRun, PlatformScenario } from '../lib/platform';
import type { DiagnosticSignal, RunDiagnostics } from '../lib/run-diagnostics';

function statusLabel(status: RunDiagnostics['status'], locale: Locale): string {
  const dictionary = getDictionary(locale).diagnostics;
  return {
    failed: dictionary.failed,
    incomplete: dictionary.incomplete,
    passed: dictionary.passed,
    passed_with_gaps: dictionary.passedWithGaps,
  }[status];
}

function signalStatusLabel(
  status: DiagnosticSignal['status'],
  locale: Locale,
): string {
  return getDictionary(locale).diagnostics[status];
}

function roleLabel(
  roleSlotId: string,
  scenario: PlatformScenario,
  locale: Locale,
): string {
  return (
    scenario.requiredRoles.find(({ id }) => id === roleSlotId)?.name[locale] ??
    roleSlotId
  );
}

export function RunDiagnosticsPanel({
  locale,
  run,
  scenario,
}: {
  readonly locale: Locale;
  readonly run: ExerciseRun;
  readonly scenario: PlatformScenario;
}) {
  const copy = getDictionary(locale).diagnostics;
  const diagnostics = run.diagnostics;

  return (
    <section
      id="diagnostics"
      className="diagnostics-board"
      aria-labelledby="diagnostics-heading"
    >
      <header className="diagnostics-heading">
        <div>
          <p className="eyebrow">02 · {copy.eyebrow}</p>
          <h2 id="diagnostics-heading">{copy.heading}</h2>
        </div>
        <p>{copy.lede}</p>
      </header>

      <div className="diagnostic-tracks">
        <article
          className="authority-track"
          data-source="authoritative"
          data-status={diagnostics.status}
        >
          <header>
            <span>01 / AUTHORITY</span>
            <strong>{copy.authorityTrack}</strong>
            <p>{copy.authorityCopy}</p>
          </header>
          <div className="authority-verdict">
            <span className="verdict-pulse" aria-hidden="true" />
            <div>
              <small>{statusLabel(diagnostics.status, locale)}</small>
              <b>
                {diagnostics.authoritative.acceptedRoleCount} /{' '}
                {diagnostics.authoritative.requiredRoleCount}
              </b>
              <span>{copy.acceptedRoles}</span>
            </div>
          </div>
          <dl className="authority-facts">
            <div>
              <dt>{copy.releasedBarriers}</dt>
              <dd>
                {diagnostics.authoritative.releasedBarrierCount} /{' '}
                {diagnostics.authoritative.requiredBarrierCount}
              </dd>
            </div>
            <div>
              <dt>{copy.deterministic}</dt>
              <dd>
                {diagnostics.authoritative.deterministic ? copy.yes : copy.no}
              </dd>
            </div>
          </dl>
          <ol className="barrier-rail" aria-label={copy.barrierFlow}>
            {diagnostics.barriers.map((barrier, index) => (
              <li
                className={barrier.released ? 'is-released' : 'is-pending'}
                key={barrier.key}
              >
                <span>{String(index + 1).padStart(2, '0')}</span>
                <div>
                  <code>{barrier.key}</code>
                  <small>
                    {barrier.released ? copy.released : copy.pending}
                  </small>
                </div>
              </li>
            ))}
          </ol>
        </article>

        <article className="telemetry-track" data-source="telemetry">
          <header>
            <span>02 / OTEL</span>
            <strong>{copy.telemetryTrack}</strong>
            <p>{copy.telemetryCopy}</p>
          </header>
          <div className="coverage-orbit">
            <div
              className="coverage-dial"
              style={
                {
                  '--coverage': `${Math.round(
                    diagnostics.telemetry.boundaryCoverage * 100,
                  )}%`,
                } as CSSProperties
              }
            >
              <b>{Math.round(diagnostics.telemetry.boundaryCoverage * 100)}%</b>
              <small>{copy.boundaryCoverage}</small>
            </div>
            <dl>
              <div>
                <dt>{copy.participantMode}</dt>
                <dd>
                  {getTelemetryModeLabel(
                    diagnostics.telemetry.participantMode,
                    locale,
                  )}
                </dd>
              </div>
              <div>
                <dt>{getDictionary(locale).trace.platformSpans}</dt>
                <dd>{diagnostics.telemetry.platformSpanCount}</dd>
              </div>
              <div>
                <dt>{getDictionary(locale).trace.participantSpans}</dt>
                <dd>{diagnostics.telemetry.participantSpanCount}</dd>
              </div>
              <div>
                <dt>{getDictionary(locale).trace.droppedSpans}</dt>
                <dd>{diagnostics.telemetry.droppedSpanCount}</dd>
              </div>
              <div>
                <dt>{getDictionary(locale).trace.lateSpans}</dt>
                <dd>{diagnostics.telemetry.lateSpanCount}</dd>
              </div>
            </dl>
          </div>
        </article>
      </div>

      <section className="evaluation-ledger" aria-labelledby="ledger-heading">
        <header>
          <div>
            <span>03 / RED → GREEN</span>
            <h3 id="ledger-heading">{copy.revisionLedger}</h3>
          </div>
          <p>{copy.revisionLede}</p>
        </header>
        <div className="evaluation-lanes">
          {diagnostics.evaluationLanes.map((lane, laneIndex) => (
            <article key={lane.roleSlotId}>
              <div className="evaluation-role">
                <span>{String(laneIndex + 1).padStart(2, '0')}</span>
                <strong>{roleLabel(lane.roleSlotId, scenario, locale)}</strong>
                <code>{lane.roleSlotId}</code>
              </div>
              <ol>
                {lane.revisions.length === 0 ? (
                  <li className="evaluation-empty">{copy.noEvaluation}</li>
                ) : (
                  lane.revisions.map((revision, revisionIndex) => (
                    <li
                      className={
                        revision.verdict === 'ACCEPTED'
                          ? 'revision-accepted'
                          : 'revision-rework'
                      }
                      key={revision.id}
                    >
                      <span>R{revisionIndex + 1}</span>
                      <strong>
                        {revision.verdict === 'ACCEPTED'
                          ? copy.accepted
                          : copy.rework}
                      </strong>
                      <small>run_seq {revision.createdRunSeq}</small>
                      {revision.issueCodes.map((code) => (
                        <code key={code}>{code}</code>
                      ))}
                    </li>
                  ))
                )}
              </ol>
            </article>
          ))}
        </div>
      </section>

      <div className="diagnostic-lower-grid">
        <section className="signal-matrix" data-source="telemetry">
          <header>
            <span>04 / SIGNALS</span>
            <h3>{copy.signalMatrix}</h3>
            <p>{copy.signalLede}</p>
          </header>
          <ol>
            {diagnostics.signals.map((signal) => (
              <li data-status={signal.status} key={signal.id}>
                <i aria-hidden="true" />
                <div>
                  <strong>{copy.signalLabels[signal.id]}</strong>
                  <small>{copy.trustLabels[signal.trust]}</small>
                </div>
                <b>{signal.count}</b>
                <span>{signalStatusLabel(signal.status, locale)}</span>
              </li>
            ))}
          </ol>
        </section>

        <section
          className="diagnostic-findings"
          aria-labelledby="findings-heading"
        >
          <header>
            <span>05 / FINDINGS</span>
            <h3 id="findings-heading">{copy.findings}</h3>
            <p>{copy.findingsLede}</p>
          </header>
          <ol>
            {diagnostics.findings.map((finding, index) => (
              <li
                data-severity={finding.severity}
                data-source={finding.source}
                key={`${finding.code}-${index}`}
              >
                <span>{String(index + 1).padStart(2, '0')}</span>
                <div>
                  <small>
                    {finding.source === 'authoritative'
                      ? copy.sourceAuthoritative
                      : copy.sourceTelemetry}
                  </small>
                  <strong>{copy.findingLabels[finding.code]}</strong>
                  <code>{finding.code}</code>
                </div>
                {finding.count === undefined ? null : <b>{finding.count}</b>}
              </li>
            ))}
          </ol>
        </section>
      </div>
    </section>
  );
}
