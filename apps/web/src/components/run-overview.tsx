import Link from 'next/link';

import { getDictionary, type Locale } from '../lib/i18n';
import type { ExerciseRun, PlatformScenario } from '../lib/platform';
import type { DiagnosticFinding } from '../lib/run-diagnostics';
import {
  authorityStateLabel,
  RunWorkspaceHeader,
  telemetryStateLabel,
} from './run-workspace';
import styles from './run-workspace.module.css';

function findingWeight(finding: DiagnosticFinding): number {
  if (finding.source === 'authoritative' && finding.severity === 'error')
    return 0;
  if (finding.source === 'authoritative') return 1;
  if (finding.severity === 'warning') return 2;
  return 3;
}

function findingHref(
  code: DiagnosticFinding['code'],
  locale: Locale,
  runId: string,
): string {
  const traceCodes: readonly DiagnosticFinding['code'][] = [
    'TELEMETRY_DROPPED_SPANS',
    'TELEMETRY_LATE_SPANS',
    'SPAN_DETAIL_UNAVAILABLE',
  ];
  return `/${locale}/runs/${runId}${traceCodes.includes(code) ? '/trace' : '/diagnostics'}`;
}

function laneStatus(
  run: ExerciseRun,
  roleId: string,
): 'complete' | 'attention' | 'pending' {
  const verdict = run.diagnostics.evaluationLanes.find(
    ({ roleSlotId }) => roleSlotId === roleId,
  )?.latestVerdict;
  if (verdict === 'ACCEPTED') return 'complete';
  if (verdict === 'REWORK_REQUIRED') return 'attention';
  return 'pending';
}

export function RunOverview({
  locale,
  run,
  scenario,
}: {
  readonly locale: Locale;
  readonly run: ExerciseRun;
  readonly scenario: PlatformScenario;
}) {
  const dictionary = getDictionary(locale);
  const copy = dictionary.runOverview;
  const coordinator = scenario.requiredRoles.find(({ id }) =>
    id.includes('coordination'),
  );
  const specialists = scenario.requiredRoles
    .filter(({ id }) => id !== coordinator?.id)
    .slice(0, 3);
  const analysisBarrier = run.diagnostics.barriers.find(
    ({ key }) => key === 'analysis-ready',
  );
  const endorsementBarrier = run.diagnostics.barriers.find(
    ({ key }) => key === 'endorsement-ready',
  );
  const attention = [...run.diagnostics.findings]
    .sort((left, right) => findingWeight(left) - findingWeight(right))
    .slice(0, 3);
  const nodes = [
    ...specialists.map((role) => ({
      id: role.id,
      kind: 'role',
      label: role.name[locale],
      status: laneStatus(run, role.id),
    })),
    {
      id: 'analysis-ready',
      kind: 'barrier',
      label: copy.analysisGate,
      status: analysisBarrier?.released
        ? ('complete' as const)
        : ('pending' as const),
    },
    {
      id: coordinator?.id ?? 'coordination',
      kind: 'role',
      label: coordinator?.name[locale] ?? 'Coordination',
      status:
        coordinator === undefined
          ? ('pending' as const)
          : laneStatus(run, coordinator.id),
    },
    {
      id: 'endorsement-ready',
      kind: 'barrier',
      label: copy.endorsementGate,
      status: endorsementBarrier?.released
        ? ('complete' as const)
        : ('pending' as const),
    },
    {
      id: 'verdict',
      kind: 'verdict',
      label: copy.finalVerdict,
      status:
        run.diagnostics.status === 'passed' ||
        run.diagnostics.status === 'passed_with_gaps'
          ? ('complete' as const)
          : run.diagnostics.status === 'failed'
            ? ('attention' as const)
            : ('pending' as const),
    },
  ];
  const recent = [...run.replayReceipts]
    .sort((left, right) => right.sequence - left.sequence)
    .slice(0, 4);

  return (
    <main id="main-content" className={styles.workspace}>
      <RunWorkspaceHeader
        active="overview"
        locale={locale}
        run={run}
        scenario={scenario}
      />
      <div className={styles.overview}>
        <header className={styles.overviewHeading}>
          <div>
            <span className={styles.eyebrow}>RUN CONTROL</span>
            <h2>{copy.heading}</h2>
          </div>
          <p>{copy.lede}</p>
        </header>

        <div className={styles.overviewGrid}>
          <section
            className={styles.attentionPanel}
            aria-labelledby="attention-heading"
          >
            <div className={styles.panelHeader}>
              <div>
                <h3 id="attention-heading">{copy.attention}</h3>
                <p>{copy.attentionLede}</p>
              </div>
            </div>
            {attention.length === 0 ? (
              <p className={styles.emptyAttention}>{copy.noAttention}</p>
            ) : (
              <ol className={styles.attentionList}>
                {attention.map((finding, index) => (
                  <li
                    data-testid="attention-item"
                    key={`${finding.code}-${index}`}
                  >
                    <span className={styles.attentionMark} aria-hidden="true">
                      {finding.severity === 'error' ? '!' : index + 1}
                    </span>
                    <span className={styles.attentionCopy}>
                      <strong>
                        {dictionary.diagnostics.findingLabels[finding.code]}
                      </strong>
                      <code>{finding.code}</code>
                    </span>
                    <Link href={findingHref(finding.code, locale, run.id)}>
                      {copy.inspect} →
                    </Link>
                  </li>
                ))}
              </ol>
            )}
          </section>

          <section
            className={styles.spinePanel}
            aria-labelledby="spine-heading"
          >
            <div className={styles.panelHeader}>
              <div>
                <h3 id="spine-heading">{copy.decisionSpine}</h3>
                <p>{copy.decisionSpineLede}</p>
              </div>
            </div>
            <div
              className={styles.spine}
              data-testid="run-decision-spine"
              role="list"
            >
              {nodes.map((node) => (
                <div
                  className={styles.decisionNode}
                  data-kind={node.kind}
                  data-status={node.status}
                  data-testid="decision-node"
                  role="listitem"
                  key={node.id}
                >
                  <span className={styles.nodeType}>{node.kind}</span>
                  <strong>{node.label}</strong>
                  <small>
                    {node.status === 'complete'
                      ? copy.completed
                      : node.status === 'attention'
                        ? copy.attentionState
                        : copy.pending}
                  </small>
                </div>
              ))}
            </div>
          </section>
        </div>

        <div className={styles.lowerGrid}>
          <section
            className={styles.teamPanel}
            aria-labelledby="team-state-heading"
          >
            <div className={styles.panelHeader}>
              <div>
                <h3 id="team-state-heading">{copy.teamState}</h3>
                <p>{copy.teamStateLede}</p>
              </div>
              <Link
                className={styles.panelLink}
                href={`/${locale}/runs/${run.id}/diagnostics`}
              >
                {copy.openDiagnostics} →
              </Link>
            </div>
            <ul className={styles.agentList}>
              {run.participants.map((agent) => (
                <li key={agent.id}>
                  <i className={styles.agentDot} aria-hidden="true" />
                  <span>
                    <strong>{agent.displayName[locale]}</strong>
                    <small>{agent.roleId}</small>
                  </span>
                  <span>
                    {laneStatus(run, agent.roleId) === 'complete' ? '✓' : '…'}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section
            className={styles.activityPanel}
            aria-labelledby="activity-heading"
          >
            <div className={styles.panelHeader}>
              <div>
                <h3 id="activity-heading">{copy.recentActivity}</h3>
                <p>{copy.recentActivityLede}</p>
              </div>
              <Link
                className={styles.panelLink}
                href={`/${locale}/runs/${run.id}/replay`}
              >
                {copy.openReplay} →
              </Link>
            </div>
            <ol className={styles.activityList}>
              {recent.map((event) => (
                <li key={event.id}>
                  <code>#{event.sequence}</code>
                  <span>{event.title[locale]}</span>
                  <time>{event.virtualTime}</time>
                </li>
              ))}
            </ol>
          </section>
        </div>

        <span hidden>
          {authorityStateLabel(run, locale)} ·{' '}
          {telemetryStateLabel(run, locale)}
        </span>
      </div>
    </main>
  );
}
