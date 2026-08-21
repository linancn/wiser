import { notFound } from 'next/navigation';

import { getDictionary, isLocale } from '@/lib/i18n';

import styles from './page.module.css';

interface DataFoundationPageProps {
  params: Promise<{ locale: string }>;
}

export default async function DataFoundationPage({
  params,
}: DataFoundationPageProps) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const copy = getDictionary(locale).dataFoundation;

  return (
    <main id="main-content" className={`page-main ${styles.page}`}>
      <header className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>{copy.eyebrow}</p>
          <h1>{copy.title}</h1>
          <p className={styles.description}>{copy.description}</p>
        </div>
        <aside className={styles.phase} aria-label={copy.phaseLabel}>
          <span>{copy.phaseLabel}</span>
          <strong>{copy.phase}</strong>
        </aside>
      </header>

      <section className={styles.authority} aria-labelledby="authority-title">
        <h2 id="authority-title">{copy.authorityTitle}</h2>
        <dl>
          <div>
            <dt>{copy.identityLabel}</dt>
            <dd>{copy.identityValue}</dd>
          </div>
          <div>
            <dt>{copy.authorityLabel}</dt>
            <dd>{copy.authorityValue}</dd>
          </div>
          <div>
            <dt>{copy.projectionLabel}</dt>
            <dd>{copy.projectionValue}</dd>
          </div>
        </dl>
      </section>

      <section className={styles.domains} aria-labelledby="domains-title">
        <h2 id="domains-title">{copy.domainsTitle}</h2>
        <div className={styles.domainGrid}>
          {copy.domains.map((domain) => (
            <article key={domain.title}>
              <h3>{domain.title}</h3>
              <p>{domain.copy}</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
