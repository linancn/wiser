import Link from 'next/link';

import { getDictionary, type Locale } from '@/lib/i18n';
import type { ExerciseRun, PlatformScenario } from '@/lib/platform';
import type { ReadModelGap } from '@/lib/read-model-source';
import { ReadModelGaps } from './read-model-state';
import styles from './scenario-workspace.module.css';

export function ScenarioOrchestration({
  locale,
  gaps,
  runs,
  scenario,
}: {
  gaps: readonly ReadModelGap[];
  locale: Locale;
  runs: readonly ExerciseRun[];
  scenario: PlatformScenario;
}) {
  const dictionary = getDictionary(locale);
  const copy = dictionary.orchestration;
  const currentVersion = scenario.versions.find(
    ({ id }) => id === scenario.currentVersionId,
  );

  return (
    <main id="main-content" className={styles.page}>
      <nav className={styles.breadcrumb} aria-label={dictionary.common.back}>
        <Link href={`/${locale}/scenarios`}>← {copy.returnCatalog}</Link>
      </nav>

      <header className={styles.hero}>
        <div>
          <span className={styles.eyebrow}>{copy.eyebrow}</span>
          <h1>{copy.heading}</h1>
          <h2>{scenario.title[locale]}</h2>
        </div>
        <dl className={styles.summary} data-testid="scenario-contract-summary">
          <div>
            <dt>{copy.immutableVersion}</dt>
            <dd>{currentVersion?.label ?? '—'}</dd>
          </div>
          <div>
            <dt>{copy.rolesHeading}</dt>
            <dd>
              {scenario.requiredRoles.length} {copy.requiredRoleSuffix}
            </dd>
          </div>
          <div>
            <dt>{copy.checkpointsHeading}</dt>
            <dd>{scenario.checkpoints.length}</dd>
          </div>
          <div>
            <dt>{copy.associatedRunsHeading}</dt>
            <dd>{runs.length}</dd>
          </div>
        </dl>
      </header>

      <ReadModelGaps gaps={gaps} locale={locale} />

      <section className={styles.boundary} aria-labelledby="boundary-heading">
        <span aria-hidden="true">◇</span>
        <div>
          <h2 id="boundary-heading">{copy.managementBoundary}</h2>
          <p>{copy.managementCopy}</p>
        </div>
      </section>

      <section className={styles.section} aria-labelledby="roles-heading">
        <div className={styles.sectionHeading}>
          <div>
            <span className={styles.eyebrow}>{copy.roleContractLabel}</span>
            <h2 id="roles-heading">{copy.rolesHeading}</h2>
          </div>
          <p>{copy.rolesLede}</p>
        </div>
        <div className={styles.roles}>
          {scenario.requiredRoles.map((role, index) => (
            <article
              className={styles.role}
              data-testid="role-slot"
              data-accent={role.accent}
              key={role.id}
            >
              <div className={styles.roleHeader}>
                <span>{String(index + 1).padStart(2, '0')}</span>
                <span>{copy.required}</span>
              </div>
              <h3>{role.name[locale]}</h3>
              <dl>
                <div>
                  <dt>{copy.mission}</dt>
                  <dd>{role.mission[locale]}</dd>
                </div>
                <div>
                  <dt>{copy.artifact}</dt>
                  <dd>{role.expectedArtifact[locale]}</dd>
                </div>
              </dl>
              <code>{role.id}</code>
            </article>
          ))}
        </div>
      </section>

      {scenario.checkpoints.length === 0 ? null : (
        <section
          className={styles.section}
          aria-labelledby="checkpoint-heading"
        >
          <div className={styles.sectionHeading}>
            <div>
              <span className={styles.eyebrow}>{copy.checkpointsLabel}</span>
              <h2 id="checkpoint-heading">{copy.checkpointsHeading}</h2>
            </div>
            <p>{copy.checkpointsLede}</p>
          </div>
          <ol className={styles.checkpoints}>
            {scenario.checkpoints.map((checkpoint) => (
              <li key={checkpoint.id}>
                <time>{checkpoint.virtualTime}</time>
                <strong>{checkpoint.title[locale]}</strong>
                <p>{checkpoint.contract[locale]}</p>
              </li>
            ))}
          </ol>
        </section>
      )}

      <div className={styles.lowerGrid}>
        <section className={styles.panel} aria-labelledby="topology-heading">
          <span className={styles.eyebrow}>{copy.topologyLabel}</span>
          <h2 id="topology-heading">{copy.topologyHeading}</h2>
          <div
            className={styles.topology}
            role="img"
            aria-label={scenario.region[locale]}
          >
            {scenario.topology.map((node) => (
              <div key={node.en}>
                <i aria-hidden="true" />
                <span>{node[locale]}</span>
              </div>
            ))}
          </div>
        </section>

        <section className={styles.panel} aria-labelledby="versions-heading">
          <span className={styles.eyebrow}>{copy.versionsLabel}</span>
          <h2 id="versions-heading">{copy.versionsHeading}</h2>
          <ol className={styles.versionList}>
            {scenario.versions.map((version) => (
              <li key={version.id}>
                <div className={styles.versionHeader}>
                  <strong>{version.label}</strong>
                  <span>{dictionary.common[version.status]}</span>
                </div>
                <p>{version.summary[locale]}</p>
                <code>{version.contentHash}</code>
              </li>
            ))}
          </ol>
        </section>
      </div>

      <section
        className={styles.section}
        aria-labelledby="related-runs-heading"
      >
        <div className={styles.sectionHeading}>
          <div>
            <span className={styles.eyebrow}>RUNS</span>
            <h2 id="related-runs-heading">{copy.associatedRunsHeading}</h2>
          </div>
          <p>{copy.associatedRunsLede}</p>
        </div>
        <ol className={styles.runList}>
          {runs.map((run) => (
            <li data-testid="associated-run" key={run.id}>
              <div className={styles.runHeader}>
                <div>
                  <strong>{run.name[locale]}</strong>
                  <p>
                    {dictionary.common[run.state]} · {run.currentVirtualTime}
                  </p>
                  <code>{run.id}</code>
                </div>
                <Link href={`/${locale}/runs/${run.id}`}>{copy.openRun} →</Link>
              </div>
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}
