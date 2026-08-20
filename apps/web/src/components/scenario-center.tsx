import Link from 'next/link';

import { getDictionary, type Locale } from '@/lib/i18n';
import {
  getRunsForScenario,
  scenarios,
  type PlatformScenario,
} from '@/lib/platform';

function ScenarioRiver({
  index,
  scenario,
  locale,
}: {
  index: number;
  scenario: PlatformScenario;
  locale: Locale;
}) {
  const paths = [
    'M8 61C48 15 82 83 128 42s69-25 110 5 72 31 114 4',
    'M8 38c42 31 71-24 117 1s72 33 112 3 70-25 115 8',
    'M8 56c40-43 80 7 120-14s72-4 108 15 75-14 116-25',
  ];
  const path = paths[index % paths.length] ?? paths[0];

  return (
    <div className="scenario-river" aria-label={scenario.region[locale]}>
      <svg viewBox="0 0 360 88" aria-hidden="true">
        <path className="river-bed" d={path} />
        <path className="river-current" d={path} />
        {scenario.topology.slice(0, 5).map((node, nodeIndex) => (
          <g
            key={node.en}
            transform={`translate(${36 + nodeIndex * (286 / Math.max(1, Math.min(4, scenario.topology.length - 1)))} ${[48, 38, 50, 43, 52][nodeIndex] ?? 45})`}
          >
            <circle r="5" />
          </g>
        ))}
      </svg>
      <span>{scenario.region[locale]}</span>
    </div>
  );
}

export function ScenarioCenter({ locale }: { locale: Locale }) {
  const dictionary = getDictionary(locale);

  return (
    <main id="main-content" className="page-main scenario-center-page">
      <header className="page-hero compact-hero">
        <div>
          <p className="eyebrow">{dictionary.scenarioCenter.eyebrow}</p>
          <h1>{dictionary.scenarioCenter.heading}</h1>
        </div>
        <p>{dictionary.scenarioCenter.lede}</p>
      </header>

      <section
        className="catalog-section"
        aria-labelledby="scenario-catalog-heading"
      >
        <div className="section-heading ruled-heading">
          <h2 id="scenario-catalog-heading">
            {dictionary.scenarioCenter.catalogLabel}
          </h2>
          <span className="mono-count">
            {String(scenarios.length).padStart(2, '0')}
          </span>
        </div>
        <div className="scenario-grid">
          {scenarios.map((scenario, index) => {
            const currentVersion = scenario.versions.find(
              (version) => version.id === scenario.currentVersionId,
            );
            const runs = getRunsForScenario(scenario.id);
            const firstRun = runs[0];
            return (
              <article
                className="scenario-card"
                data-testid="scenario-card"
                key={scenario.id}
              >
                <div className="scenario-card-index" aria-hidden="true">
                  SCN-{String(index + 1).padStart(2, '0')}
                </div>
                <ScenarioRiver
                  index={index}
                  locale={locale}
                  scenario={scenario}
                />
                <div className="scenario-card-copy">
                  <div className="card-badges">
                    <span className="status-badge simulation">
                      {dictionary.common.simulationOnly}
                    </span>
                    <span
                      className={`status-badge ${currentVersion?.status ?? 'draft'}`}
                    >
                      {dictionary.common[currentVersion?.status ?? 'draft']}
                    </span>
                  </div>
                  <p className="scenario-short-name">
                    {scenario.shortName[locale]}
                  </p>
                  <h2>{scenario.title[locale]}</h2>
                  <p className="scenario-description">
                    {scenario.description[locale]}
                  </p>
                </div>
                <dl className="scenario-card-stats">
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
                    <dd>{runs.length}</dd>
                  </div>
                </dl>
                <div className="scenario-card-actions">
                  <Link
                    className="primary-action"
                    href={`/${locale}/scenarios/${scenario.id}`}
                  >
                    {dictionary.scenarioCenter.manage}
                    <span aria-hidden="true">↗</span>
                  </Link>
                  {firstRun === undefined ? (
                    <span className="muted-action">
                      {dictionary.scenarioCenter.noLiveRun}
                    </span>
                  ) : (
                    <Link
                      className="text-action"
                      href={`/${locale}/runs/${firstRun.id}/trace`}
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
