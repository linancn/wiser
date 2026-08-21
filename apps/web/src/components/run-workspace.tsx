import Link from 'next/link';

import { getDictionary, type Locale } from '../lib/i18n';
import type { ExerciseRun, PlatformScenario } from '../lib/platform';
import styles from './run-workspace.module.css';

export type RunWorkspaceSection =
  'overview' | 'collaboration' | 'diagnostics' | 'trace' | 'replay';

function authorityLabel(run: ExerciseRun, locale: Locale): string {
  const copy = getDictionary(locale).runWorkspace;
  if (run.diagnostics.status === 'failed') return copy.authorityFailed;
  if (run.diagnostics.status === 'incomplete') return copy.authorityIncomplete;
  return copy.authorityPassed;
}

function telemetryLabel(run: ExerciseRun, locale: Locale): string {
  const copy = getDictionary(locale).runWorkspace;
  if (run.participantTelemetry.mode === 'none') {
    return copy.telemetryUnavailable;
  }
  return run.diagnostics.status === 'passed_with_gaps' ||
    run.diagnostics.findings.some(({ source }) => source === 'telemetry')
    ? copy.telemetryGaps
    : copy.telemetryHealthy;
}

export function RunWorkspaceHeader({
  active,
  locale,
  run,
  scenario,
}: {
  readonly active: RunWorkspaceSection;
  readonly locale: Locale;
  readonly run: ExerciseRun;
  readonly scenario: PlatformScenario;
}) {
  const dictionary = getDictionary(locale);
  const authority = authorityLabel(run, locale);
  const telemetry = telemetryLabel(run, locale);
  const telemetryAttention =
    telemetry !== dictionary.runWorkspace.telemetryHealthy;
  const authorityDanger = run.diagnostics.status === 'failed';
  const authorityAttention = run.diagnostics.status === 'incomplete';
  const nav = [
    {
      id: 'overview' as const,
      label: dictionary.runWorkspace.overview,
      path: '',
    },
    {
      id: 'collaboration' as const,
      label: dictionary.runWorkspace.collaboration,
      path: '/collaboration',
    },
    {
      id: 'diagnostics' as const,
      label: dictionary.runWorkspace.diagnostics,
      path: '/diagnostics',
    },
    {
      id: 'trace' as const,
      label: dictionary.runWorkspace.trace,
      path: '/trace',
    },
    {
      id: 'replay' as const,
      label: dictionary.runWorkspace.replay,
      path: '/replay',
    },
  ];

  return (
    <header className={styles.context}>
      <nav className={styles.breadcrumb} aria-label={dictionary.common.back}>
        <Link href={`/${locale}/runs`}>
          {dictionary.runWorkspace.backToRuns}
        </Link>
        <span aria-hidden="true">/</span>
        <span>{scenario.shortName[locale]}</span>
      </nav>
      <div className={styles.identityRow}>
        <div className={styles.identity}>
          <div className={styles.identityMeta}>
            <span className={styles.stateChip}>
              {dictionary.common[run.state]}
            </span>
            <span className={styles.readonlyChip}>
              {dictionary.runWorkspace.readonly}
            </span>
          </div>
          <h1>{run.name[locale]}</h1>
          <code>{run.id}</code>
        </div>
        <dl className={styles.clockFacts}>
          <div>
            <dt>{dictionary.runWorkspace.pinnedVersion}</dt>
            <dd>{run.scenarioVersionId.split('-').at(-1)}</dd>
          </div>
          <div>
            <dt>{dictionary.runWorkspace.virtualTime}</dt>
            <dd>{run.currentVirtualTime}</dd>
          </div>
        </dl>
      </div>
      <dl className={styles.statusStrip}>
        <div>
          <dt>{dictionary.runWorkspace.runState}</dt>
          <dd>{dictionary.common[run.state]}</dd>
        </div>
        <div
          className={
            authorityDanger
              ? styles.danger
              : authorityAttention
                ? styles.attention
                : undefined
          }
        >
          <dt>{dictionary.runWorkspace.authorityState}</dt>
          <dd>{authority}</dd>
        </div>
        <div className={telemetryAttention ? styles.attention : undefined}>
          <dt>{dictionary.runWorkspace.telemetryState}</dt>
          <dd>{telemetry}</dd>
        </div>
      </dl>
      <nav className={styles.localNav} aria-label={run.name[locale]}>
        {nav.map((item) => (
          <Link
            href={`/${locale}/runs/${run.id}${item.path}`}
            aria-current={active === item.id ? 'page' : undefined}
            key={item.id}
          >
            {item.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}

export function authorityStateLabel(run: ExerciseRun, locale: Locale): string {
  return authorityLabel(run, locale);
}

export function telemetryStateLabel(run: ExerciseRun, locale: Locale): string {
  return telemetryLabel(run, locale);
}
