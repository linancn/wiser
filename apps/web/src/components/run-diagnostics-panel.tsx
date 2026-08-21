import { getDictionary, getTelemetryModeLabel, type Locale } from '../lib/i18n';
import type { ExerciseRun, PlatformScenario } from '../lib/platform';
import type { DiagnosticSignal, RunDiagnostics } from '../lib/run-diagnostics';
import styles from './run-diagnostics-panel.module.css';

function statusLabel(status: RunDiagnostics['status'], locale: Locale): string {
  const copy = getDictionary(locale).diagnostics;
  return {
    failed: copy.failed,
    incomplete: copy.incomplete,
    passed: copy.passed,
    passed_with_gaps: copy.passedWithGaps,
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
  const traceCopy = getDictionary(locale).trace;
  const diagnostics = run.diagnostics;
  const telemetryFindingCount = diagnostics.findings.filter(
    ({ source }) => source === 'telemetry',
  ).length;

  return (
    <section className={styles.panel} aria-labelledby="diagnostics-heading">
      <header className={styles.heading}>
        <div>
          <span>{copy.eyebrow}</span>
          <h2 id="diagnostics-heading">{copy.heading}</h2>
        </div>
        <p>{copy.lede}</p>
      </header>

      <section
        className={styles.summary}
        data-testid="diagnostic-summary"
        data-source="authoritative"
        data-status={diagnostics.status}
      >
        <div className={styles.verdict}>
          <span>
            {copy.authorityTrack} · {statusLabel(diagnostics.status, locale)}
          </span>
          <strong>
            {diagnostics.authoritative.acceptedRoleCount} /{' '}
            {diagnostics.authoritative.requiredRoleCount}
          </strong>
          <small>{copy.acceptedRoles}</small>
        </div>
        <dl className={styles.summaryFacts}>
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
        <div className={styles.telemetrySummary} data-source="telemetry">
          <span>{copy.telemetryTrack}</span>
          <strong>
            {Math.round(diagnostics.telemetry.boundaryCoverage * 100)}%
          </strong>
          <small>
            {getTelemetryModeLabel(
              diagnostics.telemetry.participantMode,
              locale,
            )}{' '}
            ·{' '}
            {locale === 'zh-CN'
              ? `${telemetryFindingCount} 项诊断`
              : `${telemetryFindingCount} ${telemetryFindingCount === 1 ? 'finding' : 'findings'}`}
          </small>
        </div>
      </section>

      <section
        className={styles.barrierSection}
        aria-labelledby="barrier-heading"
      >
        <div className={styles.sectionHeading}>
          <div>
            <span>{copy.authorityFlowLabel}</span>
            <h3 id="barrier-heading">{copy.barrierFlow}</h3>
          </div>
          <p>{copy.authorityCopy}</p>
        </div>
        <ol className={styles.barriers}>
          {diagnostics.barriers.map((barrier, index) => (
            <li data-released={barrier.released} key={barrier.key}>
              <span>{String(index + 1).padStart(2, '0')}</span>
              <code>{barrier.key}</code>
              <strong>{barrier.released ? copy.released : copy.pending}</strong>
            </li>
          ))}
        </ol>
      </section>

      <section className={styles.ledger} aria-labelledby="ledger-heading">
        <div className={styles.sectionHeading}>
          <div>
            <span>{copy.redGreenLabel}</span>
            <h3 id="ledger-heading">{copy.revisionLedger}</h3>
          </div>
          <p>{copy.revisionLede}</p>
        </div>
        <div className={styles.ledgerHeader} aria-hidden="true">
          <span>{getDictionary(locale).common.roles}</span>
          <span>{copy.revisionColumn}</span>
          <span>{copy.verdictColumn}</span>
          <span>{copy.evidenceColumn}</span>
          <span>{copy.runSequenceColumn}</span>
        </div>
        <div className={styles.evaluationRows}>
          {diagnostics.evaluationLanes.flatMap((lane) =>
            lane.revisions.map((revision, revisionIndex) => (
              <article
                className={styles.evaluationRow}
                data-testid="evaluation-row"
                data-verdict={revision.verdict}
                key={revision.id}
              >
                <div>
                  <strong>
                    {roleLabel(lane.roleSlotId, scenario, locale)}
                  </strong>
                  <code>{lane.roleSlotId}</code>
                </div>
                <span>R{revisionIndex + 1}</span>
                <strong>
                  {revision.verdict === 'ACCEPTED'
                    ? copy.accepted
                    : copy.rework}
                </strong>
                <div className={styles.issueCodes}>
                  {revision.issueCodes.length === 0 ? (
                    <span>—</span>
                  ) : (
                    revision.issueCodes.map((code) => (
                      <code key={code}>{code}</code>
                    ))
                  )}
                </div>
                <code>{revision.createdRunSeq}</code>
              </article>
            )),
          )}
        </div>
      </section>

      <div className={styles.lowerGrid}>
        <section
          className={styles.signals}
          data-source="telemetry"
          aria-labelledby="signals-heading"
        >
          <div className={styles.sectionHeading}>
            <div>
              <span>{copy.otelSignalsLabel}</span>
              <h3 id="signals-heading">{copy.signalMatrix}</h3>
            </div>
            <p>{copy.signalLede}</p>
          </div>
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

        <section className={styles.findings} aria-labelledby="findings-heading">
          <div className={styles.sectionHeading}>
            <div>
              <span>{copy.triageLabel}</span>
              <h3 id="findings-heading">{copy.findings}</h3>
            </div>
            <p>{copy.findingsLede}</p>
          </div>
          <ol>
            {diagnostics.findings.map((finding, index) => (
              <li
                data-severity={finding.severity}
                data-source={finding.source}
                key={`${finding.code}-${index}`}
              >
                <i aria-hidden="true">
                  {finding.severity === 'error'
                    ? '!'
                    : finding.severity === 'warning'
                      ? '△'
                      : 'i'}
                </i>
                <div>
                  <strong>{copy.findingLabels[finding.code]}</strong>
                  <code>{finding.code}</code>
                </div>
                {finding.count === undefined ? null : <b>{finding.count}</b>}
              </li>
            ))}
          </ol>
          <footer>
            <span>{traceCopy.platformObserved}</span>
            <span>{traceCopy.participantReported}</span>
          </footer>
        </section>
      </div>
    </section>
  );
}
