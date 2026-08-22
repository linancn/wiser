import Link from 'next/link';

import { getDictionary, type Locale } from '@/lib/i18n';

import styles from './portal-landing.module.css';

function Arrow() {
  return <span aria-hidden="true">↗</span>;
}

function ConfluenceMark() {
  return (
    <svg
      className={styles.confluence}
      viewBox="0 0 760 220"
      aria-hidden="true"
      focusable="false"
    >
      <path className={styles.channelLine} d="M20 44C210 44 234 110 382 110" />
      <path
        className={styles.exerciseLine}
        d="M20 176C210 176 234 110 382 110"
      />
      <path className={styles.wiserLine} d="M382 110C526 110 570 110 740 110" />
      <circle className={styles.dataNode} cx="20" cy="44" r="7" />
      <circle className={styles.exerciseNode} cx="20" cy="176" r="7" />
      <circle className={styles.wiserNode} cx="382" cy="110" r="10" />
      <circle className={styles.destinationNode} cx="740" cy="110" r="7" />
    </svg>
  );
}

export function PortalLanding({ locale }: { readonly locale: Locale }) {
  const copy = getDictionary(locale).portal;
  const systems = [
    {
      ...copy.dataFoundation,
      href: `/${locale}/data-foundation`,
      tone: 'data',
    },
    {
      ...copy.agentExcon,
      href: `/${locale}/scenarios`,
      tone: 'exercise',
    },
  ] as const;

  return (
    <main id="main-content" className={styles.portal} tabIndex={-1}>
      <section className={styles.hero} aria-labelledby="portal-heading">
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}>{copy.eyebrow}</p>
          <h1 id="portal-heading">{copy.heading}</h1>
          <p className={styles.lede}>{copy.lede}</p>
          <Link className={styles.primaryAction} href={`/${locale}/login`}>
            {copy.signInAction}
            <span aria-hidden="true">→</span>
          </Link>
        </div>
        <div className={styles.confluenceFrame}>
          <div className={styles.flowLabel} data-flow="data">
            <span>01</span>
            <strong>{copy.dataFoundation.title}</strong>
          </div>
          <div className={styles.flowLabel} data-flow="exercise">
            <span>02</span>
            <strong>{copy.agentExcon.title}</strong>
          </div>
          <div className={styles.flowLabel} data-flow="wiser">
            <span>W</span>
            <strong>WISER</strong>
          </div>
          <ConfluenceMark />
        </div>
      </section>

      <section className={styles.workspaces} aria-labelledby="workspaces-title">
        <header className={styles.sectionHeading}>
          <p className={styles.eyebrow}>02 / WORKSPACES</p>
          <div>
            <h2 id="workspaces-title">{copy.workspacesTitle}</h2>
            <p>{copy.workspacesLede}</p>
          </div>
        </header>
        <div className={styles.systemGrid}>
          {systems.map((system) => (
            <article
              className={styles.systemCard}
              data-tone={system.tone}
              key={system.tone}
              data-testid="portal-system"
            >
              <header>
                <span className={styles.systemOrder}>{system.order}</span>
                <span className={styles.systemTag}>{system.tag}</span>
              </header>
              <h3>{system.title}</h3>
              <p>{system.copy}</p>
              <ul>
                {system.features.map((feature) => (
                  <li key={feature}>{feature}</li>
                ))}
              </ul>
              <Link href={system.href}>
                {system.action}
                <Arrow />
              </Link>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.identity} aria-labelledby="identity-title">
        <div>
          <p className={styles.eyebrow}>01 / IDENTITY</p>
          <h2 id="identity-title">{copy.identityTitle}</h2>
          <p>{copy.identityCopy}</p>
        </div>
        <ul>
          {copy.identityPoints.map((point) => (
            <li key={point}>{point}</li>
          ))}
        </ul>
        <Link href={`/${locale}/login`}>
          {copy.signInAction}
          <span aria-hidden="true">→</span>
        </Link>
      </section>
    </main>
  );
}
