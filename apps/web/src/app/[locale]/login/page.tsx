import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { type AuthFailureReason, safeLocalizedRedirect } from '@/lib/auth';
import { getDictionary, isLocale } from '@/lib/i18n';

import styles from './page.module.css';

interface LoginPageProps {
  readonly params: Promise<{ readonly locale: string }>;
  readonly searchParams: Promise<{
    readonly next?: string | readonly string[];
    readonly reason?: string | readonly string[];
    readonly signedOut?: string | readonly string[];
  }>;
}

function first(value: string | readonly string[] | undefined): string | null {
  if (typeof value === 'string') return value;
  return value?.[0] ?? null;
}

function authReason(value: string | null): AuthFailureReason | null {
  return value === 'callback' ||
    value === 'configuration' ||
    value === 'credentials' ||
    value === 'fields' ||
    value === 'session'
    ? value
    : null;
}

export async function generateMetadata({
  params,
}: Pick<LoginPageProps, 'params'>): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  return {
    title: getDictionary(locale).auth.metaTitle,
    robots: { follow: false, index: false },
  };
}

export default async function LoginPage({
  params,
  searchParams,
}: LoginPageProps) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const query = await searchParams;
  const dictionary = getDictionary(locale);
  const next = safeLocalizedRedirect(first(query.next), locale);
  const reason = authReason(first(query.reason));
  const signedOut = first(query.signedOut) === '1';

  return (
    <main id="main-content" className={styles.main}>
      <section className={styles.thesis} aria-labelledby="login-title">
        <p className={styles.eyebrow}>{dictionary.auth.eyebrow}</p>
        <h1 id="login-title">{dictionary.auth.title}</h1>
        <p className={styles.lede}>{dictionary.auth.lede}</p>

        <div className={styles.identityGate}>
          <div className={styles.gateHeading}>
            <h2>{dictionary.auth.gateTitle}</h2>
            <p>{dictionary.auth.gateLede}</p>
          </div>
          <ol className={styles.gateSteps}>
            {dictionary.auth.gateSteps.map((step, index) => (
              <li key={step.label}>
                <span className={styles.gateIndex} aria-hidden="true">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <span className={styles.gateCopy}>
                  <small>{step.label}</small>
                  <strong>{step.value}</strong>
                  <span>{step.copy}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className={styles.formPanel} aria-labelledby="session-title">
        <div className={styles.formHeading}>
          <p className={styles.eyebrow}>{dictionary.auth.formEyebrow}</p>
          <h2 id="session-title">{dictionary.auth.formTitle}</h2>
        </div>

        {reason !== null ? (
          <p className={styles.error} id="auth-feedback" role="alert">
            {dictionary.auth.errors[reason]}
          </p>
        ) : null}
        {reason === null && signedOut ? (
          <p className={styles.success} id="auth-feedback" role="status">
            {dictionary.auth.signedOutNotice}
          </p>
        ) : null}

        <form
          className={styles.form}
          action={`/${locale}/auth/login`}
          method="post"
          aria-describedby={
            reason !== null || signedOut ? 'auth-feedback' : undefined
          }
        >
          <input name="next" type="hidden" value={next} />
          <label>
            <span>{dictionary.auth.email}</span>
            <input
              name="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              maxLength={320}
              placeholder={dictionary.auth.emailPlaceholder}
              required
            />
          </label>
          <label>
            <span>{dictionary.auth.password}</span>
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              maxLength={4096}
              placeholder={dictionary.auth.passwordPlaceholder}
              aria-describedby="password-boundary"
              required
            />
          </label>
          <p className={styles.hint} id="password-boundary">
            {dictionary.auth.passwordHint}
          </p>
          <button type="submit">{dictionary.auth.submit}</button>
        </form>

        <div className={styles.boundaryNote}>
          <p>{dictionary.auth.accountNote}</p>
          <p>{dictionary.auth.securityNote}</p>
        </div>
      </section>
    </main>
  );
}
