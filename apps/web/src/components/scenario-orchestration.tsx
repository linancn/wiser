import Link from 'next/link';

import { getDictionary, type Locale } from '@/lib/i18n';
import { getRunsForScenario, type PlatformScenario } from '@/lib/platform';

export function ScenarioOrchestration({
  locale,
  scenario,
}: {
  locale: Locale;
  scenario: PlatformScenario;
}) {
  const dictionary = getDictionary(locale);
  const runs = getRunsForScenario(scenario.id);
  const currentRun = runs[0];

  return (
    <main id="main-content" className="page-main orchestration-page">
      <nav className="breadcrumb" aria-label={dictionary.common.back}>
        <Link href={`/${locale}/scenarios`}>
          ← {dictionary.orchestration.returnCatalog}
        </Link>
      </nav>
      <header className="orchestration-hero">
        <div className="orchestration-title">
          <p className="eyebrow">{dictionary.orchestration.eyebrow}</p>
          <h1>{dictionary.orchestration.heading}</h1>
          <p>{scenario.title[locale]}</p>
        </div>
        <div className="orchestration-summary">
          <span className="status-badge simulation">
            {dictionary.common.simulationOnly}
          </span>
          <p>{dictionary.orchestration.lede}</p>
          {currentRun === undefined ? null : (
            <Link
              className="primary-action"
              href={`/${locale}/runs/${currentRun.id}/trace`}
            >
              {dictionary.orchestration.openTrace}
              <span aria-hidden="true">→</span>
            </Link>
          )}
        </div>
      </header>

      <section
        className="management-boundary"
        aria-labelledby="management-boundary-heading"
      >
        <span className="boundary-lock" aria-hidden="true">
          ◇
        </span>
        <div>
          <h2 id="management-boundary-heading">
            {dictionary.orchestration.managementBoundary}
          </h2>
          <p>{dictionary.orchestration.managementCopy}</p>
        </div>
        <code>{dictionary.shell.participantBoundary}</code>
      </section>

      <section
        className="orchestration-section"
        aria-labelledby="role-contract-heading"
      >
        <div className="section-heading split-heading">
          <div>
            <p className="eyebrow">01 · TEAM CONTRACT</p>
            <h2 id="role-contract-heading">
              {dictionary.orchestration.rolesHeading}
            </h2>
          </div>
          <p>{dictionary.orchestration.rolesLede}</p>
        </div>
        <div className="role-contract-grid">
          {scenario.requiredRoles.map((role, index) => (
            <article
              className={`role-slot accent-${role.accent}`}
              data-testid="role-slot"
              key={role.id}
            >
              <div className="role-slot-head">
                <span className="role-number">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <span className="required-mark">REQUIRED</span>
              </div>
              <h3>{role.name[locale]}</h3>
              <dl>
                <div>
                  <dt>{dictionary.orchestration.mission}</dt>
                  <dd>{role.mission[locale]}</dd>
                </div>
                <div>
                  <dt>{dictionary.orchestration.artifact}</dt>
                  <dd>{role.expectedArtifact[locale]}</dd>
                </div>
              </dl>
              <code>{role.id}</code>
            </article>
          ))}
        </div>
      </section>

      <section
        className="orchestration-section checkpoints-section"
        aria-labelledby="checkpoint-heading"
      >
        <div className="section-heading split-heading">
          <div>
            <p className="eyebrow">02 · DUAL CLOCK</p>
            <h2 id="checkpoint-heading">
              {dictionary.orchestration.checkpointsHeading}
            </h2>
          </div>
          <p>{dictionary.orchestration.checkpointsLede}</p>
        </div>
        <ol className="checkpoint-flow">
          {scenario.checkpoints.map((checkpoint, index) => (
            <li key={checkpoint.id}>
              <span className="checkpoint-time">{checkpoint.virtualTime}</span>
              <i aria-hidden="true" />
              <strong>{checkpoint.title[locale]}</strong>
              <p>{checkpoint.contract[locale]}</p>
              {index < scenario.checkpoints.length - 1 ? (
                <span className="flow-arrow" aria-hidden="true">
                  →
                </span>
              ) : null}
            </li>
          ))}
        </ol>
      </section>

      <div className="orchestration-lower-grid">
        <section className="topology-panel" aria-labelledby="topology-heading">
          <p className="eyebrow">03 · WATER SYSTEM</p>
          <h2 id="topology-heading">
            {dictionary.orchestration.topologyHeading}
          </h2>
          <div
            className="topology-river"
            role="img"
            aria-label={scenario.region[locale]}
          >
            {scenario.topology.map((node, index) => (
              <div key={node.en}>
                <span>{node[locale]}</span>
                <i aria-hidden="true" />
                {index < scenario.topology.length - 1 ? (
                  <b aria-hidden="true" />
                ) : null}
              </div>
            ))}
          </div>
        </section>

        <section className="version-panel" aria-labelledby="versions-heading">
          <p className="eyebrow">04 · IMMUTABLE</p>
          <h2 id="versions-heading">
            {dictionary.orchestration.versionsHeading}
          </h2>
          <p className="version-notice">
            {dictionary.orchestration.versionNotice}
          </p>
          <ol className="version-list">
            {scenario.versions.map((version) => (
              <li key={version.id}>
                <div>
                  <strong>{version.label}</strong>
                  <span className={`status-badge ${version.status}`}>
                    {dictionary.common[version.status]}
                  </span>
                </div>
                <p>{version.summary[locale]}</p>
                <code>{version.contentHash}</code>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </main>
  );
}
