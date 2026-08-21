import Link from 'next/link';

import { getDictionary, type Locale } from '@/lib/i18n';
import type { ExerciseRun, PlatformScenario } from '@/lib/platform';
import type { ReadModelGap, WebDataMode } from '@/lib/read-model-source';
import styles from './catalog.module.css';
import { ReadModelGaps } from './read-model-state';

function priorityRun(runs: readonly ExerciseRun[]): ExerciseRun | undefined {
  const weights: Readonly<Record<ExerciseRun['state'], number>> = {
    failed: 0,
    running: 1,
    paused: 2,
    completing: 3,
    ready: 4,
    forming: 5,
    created: 6,
    completed: 7,
    cancelled: 8,
  };
  return [...runs].sort(
    (left, right) =>
      weights[left.state] - weights[right.state] ||
      right.wallStartedAt.localeCompare(left.wallStartedAt),
  )[0];
}

export function ScenarioCenter({
  gaps,
  locale,
  mode,
  runs,
  scenarios,
}: {
  gaps: readonly ReadModelGap[];
  locale: Locale;
  mode: WebDataMode;
  runs: readonly ExerciseRun[];
  scenarios: readonly PlatformScenario[];
}) {
  const dictionary = getDictionary(locale);

  return (
    <main id="main-content" className={styles.page}>
      <header className={styles.intro}>
        <div>
          <span className={styles.eyebrow}>
            {dictionary.scenarioCenter.eyebrow}
          </span>
          <h1>{dictionary.scenarioCenter.heading}</h1>
        </div>
        <p>
          {mode === 'reference'
            ? dictionary.scenarioCenter.lede
            : dictionary.scenarioCenter.liveLede}
        </p>
        <dl className={styles.summary}>
          <div>
            <dt>{dictionary.scenarioCenter.catalogLabel}</dt>
            <dd>{scenarios.length}</dd>
          </div>
          <div>
            <dt>{dictionary.scenarioCenter.activeRuns}</dt>
            <dd>{runs.filter(({ state }) => state === 'running').length}</dd>
          </div>
        </dl>
      </header>

      <ReadModelGaps gaps={gaps} locale={locale} />

      <section aria-labelledby="scenario-catalog-heading">
        <div className={styles.sectionHeader}>
          <h2 id="scenario-catalog-heading">
            {dictionary.scenarioCenter.catalogLabel}
          </h2>
          <span>{String(scenarios.length).padStart(2, '0')}</span>
        </div>
        <div className={styles.scenarioList}>
          {scenarios.map((scenario, index) => {
            const currentVersion = scenario.versions.find(
              (version) => version.id === scenario.currentVersionId,
            );
            const scenarioRuns = runs.filter(
              (run) => run.scenarioId === scenario.id,
            );
            const firstRun = priorityRun(scenarioRuns);
            return (
              <article
                className={styles.scenarioRow}
                data-testid="scenario-card"
                key={scenario.id}
              >
                <div
                  className={styles.topology}
                  aria-label={scenario.region[locale]}
                >
                  <span>{scenario.region[locale]}</span>
                  <div className={styles.topologyNodes} aria-hidden="true">
                    {scenario.requiredRoles.map((role, roleIndex) => (
                      <i key={role.id}>
                        {String(roleIndex + 1).padStart(2, '0')}
                      </i>
                    ))}
                  </div>
                  <code>SCN-{String(index + 1).padStart(2, '0')}</code>
                </div>
                <div className={styles.scenarioCopy}>
                  <div className={styles.badges}>
                    <span className={styles.badge}>
                      {dictionary.common.simulationOnly}
                    </span>
                    <span
                      className={styles.badge}
                      data-status={currentVersion?.status ?? 'draft'}
                    >
                      {dictionary.common[currentVersion?.status ?? 'draft']}
                    </span>
                  </div>
                  <span>{scenario.shortName[locale]}</span>
                  <h2>{scenario.title[locale]}</h2>
                  <p>{scenario.description[locale]}</p>
                </div>
                <dl className={styles.facts}>
                  <div>
                    <dt>{dictionary.scenarioCenter.currentVersion}</dt>
                    <dd>{currentVersion?.label ?? '—'}</dd>
                  </div>
                  <div>
                    <dt>{dictionary.scenarioCenter.roleSlots}</dt>
                    <dd>{scenario.requiredRoles.length}</dd>
                  </div>
                  <div>
                    <dt>{dictionary.scenarioCenter.activeRuns}</dt>
                    <dd>{scenarioRuns.length}</dd>
                  </div>
                  <div>
                    <dt>{dictionary.common.virtualTime}</dt>
                    <dd>{firstRun?.currentVirtualTime ?? '—'}</dd>
                  </div>
                </dl>
                <div className={styles.actions}>
                  <Link
                    className={styles.primary}
                    href={`/${locale}/scenarios/${scenario.id}`}
                  >
                    {dictionary.scenarioCenter.manage}
                    <span aria-hidden="true">→</span>
                  </Link>
                  {firstRun === undefined ? (
                    <span className={styles.muted}>
                      {dictionary.scenarioCenter.noLiveRun}
                    </span>
                  ) : (
                    <Link
                      className={styles.secondary}
                      href={`/${locale}/runs/${firstRun.id}`}
                    >
                      {dictionary.scenarioCenter.observeRun}
                    </Link>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </main>
  );
}
