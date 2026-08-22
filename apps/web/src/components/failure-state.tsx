import Link from 'next/link';

import styles from './failure-state.module.css';

export function FailureState({
  copy,
  eyebrow,
  guidance,
  primaryAction,
  title,
}: {
  readonly copy: string;
  readonly eyebrow: string;
  readonly guidance?: string;
  readonly primaryAction: {
    readonly href: string;
    readonly label: string;
  };
  readonly title: string;
}) {
  return (
    <section className={styles.state} role="alert">
      <span className={styles.mark} aria-hidden="true">
        <i />
      </span>
      <div>
        <p className={styles.eyebrow}>{eyebrow}</p>
        <h1>{title}</h1>
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
