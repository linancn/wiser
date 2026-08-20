import Link from 'next/link';

import { getDictionary, getTelemetryModeLabel, type Locale } from '@/lib/i18n';
import type { ExerciseRun, PlatformScenario } from '@/lib/platform';
import type { ReadModelGap } from '@/lib/read-model-source';
import { ReadModelGaps } from './read-model-state';

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
    <main id="main-content" className="page-main run-list-page">
      <header className="page-hero compact-hero">
        <div>
          <p className="eyebrow">{dictionary.runList.eyebrow}</p>
          <h1>{dictionary.runList.heading}</h1>
        </div>
        <p>{dictionary.runList.lede}</p>
      </header>
      <ReadModelGaps gaps={gaps} locale={locale} />
      <section className="run-register" aria-label={dictionary.runList.heading}>
        {runs.map((run) => {
          const scenario = scenarios.find(({ id }) => id === run.scenarioId);
          return (
            <article className="run-register-row" key={run.id}>
              <div
                className="run-state-marker"
                data-state={run.state}
                aria-hidden="true"
              />
              <div className="run-register-title">
                <span className={`status-badge ${run.state}`}>
                  {dictionary.common[run.state]}
                </span>
                <h2>{run.name[locale]}</h2>
                <p>{scenario?.shortName[locale]}</p>
                <code>{run.id}</code>
              </div>
              <dl>
                <div>
                  <dt>{dictionary.common.version}</dt>
                  <dd>{run.scenarioVersionId.split('-').at(-1)}</dd>
                </div>
                <div>
                  <dt>{dictionary.runList.agents}</dt>
                  <dd>{run.participants.length}</dd>
                </div>
                <div>
                  <dt>{dictionary.common.virtualTime}</dt>
                  <dd>{run.currentVirtualTime}</dd>
                </div>
                <div>
                  <dt>{dictionary.runList.coverage}</dt>
                  <dd>
                    B {Math.round(run.boundaryCoverage * 100)}% · P{' '}
                    {getTelemetryModeLabel(
                      run.participantTelemetry.mode,
                      locale,
                    )}{' '}
                    · {dictionary.trace.droppedSpans}{' '}
                    {run.participantTelemetry.droppedSpanCount} ·{' '}
                    {dictionary.trace.lateSpans}{' '}
                    {run.participantTelemetry.lateSpanCount}
                  </dd>
                </div>
              </dl>
              <Link
                className="primary-action"
                href={`/${locale}/runs/${run.id}/trace`}
              >
                {dictionary.runList.open}
                <span aria-hidden="true">→</span>
              </Link>
            </article>
          );
        })}
      </section>
    </main>
  );
}
