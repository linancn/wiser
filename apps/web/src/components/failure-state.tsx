import Link from 'next/link';

import styles from './failure-state.module.css';

export function FailureState({
  copy,
  eyebrow,
  guidance,
  headingLevel = 1,
  primaryAction,
  title,
}: {
  readonly copy: string;
  readonly eyebrow: string;
  readonly guidance?: string;
  readonly headingLevel?: 1 | 2;
  readonly primaryAction: {
    readonly href: string;
    readonly label: string;
  };
  readonly title: string;
}) {
  const Heading = headingLevel === 1 ? 'h1' : 'h2';
  return (
    <section
      className={`${styles.state} ${headingLevel === 2 ? styles.embedded : ''}`}
      role="alert"
    >
      <span className={styles.mark} aria-hidden="true">
        <i />
      </span>
      <div>
        <p className={styles.eyebrow}>{eyebrow}</p>
        <Heading>{title}</Heading>
        <p className={styles.copy}>{copy}</p>
        {guidance === undefined ? null : (
          <p className={styles.guidance}>{guidance}</p>
        )}
        <Link className={styles.action} href={primaryAction.href}>
          {primaryAction.label}
          <span aria-hidden="true">→</span>
        </Link>
      </div>
    </section>
  );
}
