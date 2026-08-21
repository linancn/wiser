import Link from 'next/link';

import { getDictionary, type Locale } from '@/lib/i18n';
import type { ExerciseRun, PlatformScenario } from '@/lib/platform';
import type { ReadModelGap } from '@/lib/read-model-source';
import { ReadModelGaps } from './read-model-state';
import { authorityStateLabel, telemetryStateLabel } from './run-workspace';
import styles from './catalog.module.css';

export function RunList({
  gaps,
  locale,
  runs,
  scenarios,
}: {
  gaps: readonly ReadModelGap[];
  locale: Locale;
  runs: readonly ExerciseRun[];
  scenarios: readonly PlatformScenario[];
}) {
  const dictionary = getDictionary(locale);

  return (
    <main id="main-content" className={styles.page}>
      <header className={styles.intro}>
        <div>
          <span className={styles.eyebrow}>{dictionary.runList.eyebrow}</span>
          <h1>{dictionary.runList.heading}</h1>
        </div>
        <p>{dictionary.runList.lede}</p>
        <dl className={styles.summary}>
          <div>
            <dt>{dictionary.common.runs}</dt>
            <dd>{runs.length}</dd>
          </div>
          <div>
            <dt>{dictionary.common.running}</dt>
            <dd>{runs.filter(({ state }) => state === 'running').length}</dd>
          </div>
        </dl>
      </header>
      <ReadModelGaps gaps={gaps} locale={locale} />
      <div className={styles.sectionHeader}>
        <h2>{dictionary.runList.heading}</h2>
        <span>{String(runs.length).padStart(2, '0')}</span>
      </div>
      <section
        className={styles.runList}
        aria-label={dictionary.runList.heading}
      >
        {runs.map((run) => {
          const scenario = scenarios.find(({ id }) => id === run.scenarioId);
          return (
            <article
              className={styles.runRow}
              data-testid="run-row"
              key={run.id}
            >
              <div
                className={styles.runRail}
                data-state={run.state}
                aria-hidden="true"
              />
              <div className={styles.runIdentity}>
                <span className={styles.badge} data-status={run.state}>
                  {dictionary.common[run.state]}
                </span>
                <h2>{run.name[locale]}</h2>
                <p>{scenario?.shortName[locale]}</p>
                <code>{run.id}</code>
              </div>
              <dl className={styles.runFacts}>
                <div>
                  <dt>{dictionary.runWorkspace.authorityState}</dt>
                  <dd>{authorityStateLabel(run, locale)}</dd>
                </div>
                <div>
                  <dt>{dictionary.runWorkspace.telemetryState}</dt>
                  <dd>{telemetryStateLabel(run, locale)}</dd>
                </div>
                <div>
                  <dt>{dictionary.runList.agents}</dt>
                  <dd>
                    {run.diagnostics.authoritative.acceptedRoleCount}/
                    {run.participants.length}
                  </dd>
                </div>
                <div>
                  <dt>{dictionary.common.virtualTime}</dt>
                  <dd>{run.currentVirtualTime}</dd>
                </div>
              </dl>
              <div className={styles.runAction}>
                <Link
                  className={styles.primary}
                  href={`/${locale}/runs/${run.id}`}
                >
                  {dictionary.runList.open}
                  <span aria-hidden="true">→</span>
                </Link>
              </div>
            </article>
          );
        })}
      </section>
    </main>
  );
}
