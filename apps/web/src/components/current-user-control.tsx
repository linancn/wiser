import Link from 'next/link';
import { connection } from 'next/server';

import { readVerifiedAuthViewer } from '@/lib/auth';
import { getDictionary, type Locale } from '@/lib/i18n';
import { createWiserServerSupabaseClient } from '@/lib/supabase/server';

import styles from './app-shell.module.css';

function StateMark() {
  return <span className={styles.authStateMark} aria-hidden="true" />;
}

export function CurrentUserFallback({ locale }: { readonly locale: Locale }) {
  const dictionary = getDictionary(locale);
  return (
    <span
      className={styles.authState}
      data-state="loading"
      aria-label={dictionary.auth.loading}
    >
      <StateMark />
      <span className={styles.authStateLabel}>{dictionary.auth.loading}</span>
    </span>
  );
}

export async function CurrentUserControl({
  locale,
}: {
  readonly locale: Locale;
}) {
  await connection();
  const dictionary = getDictionary(locale);
  const client = await createWiserServerSupabaseClient();
  if (client === null) {
    return (
      <div className={styles.authControl}>
        <span
          className={styles.authState}
          data-state="disabled"
          aria-label={dictionary.auth.disabled}
        >
          <StateMark />
          <span className={styles.authStateLabel}>
            {dictionary.auth.disabled}
          </span>
        </span>
        <Link className={styles.authAction} href={`/${locale}/login`}>
          {dictionary.auth.signIn}
        </Link>
      </div>
    );
  }

  const viewer = await readVerifiedAuthViewer(client);
  if (viewer === null) {
    return (
      <div className={styles.authControl}>
        <span
          className={styles.authState}
          data-state="anonymous"
          aria-label={dictionary.auth.anonymous}
        >
          <StateMark />
          <span className={styles.authStateLabel}>
            {dictionary.auth.anonymous}
          </span>
        </span>
        <Link className={styles.authAction} href={`/${locale}/login`}>
          {dictionary.auth.signIn}
        </Link>
      </div>
    );
  }

  return (
    <div className={styles.authControl}>
      <span
        className={styles.authState}
        data-state="authenticated"
        aria-label={`${dictionary.auth.signedIn}: ${viewer.email ?? dictionary.auth.signedIn}`}
        title={viewer.email ?? dictionary.auth.signedIn}
      >
        <StateMark />
        <span className={styles.authStateLabel}>
          {viewer.email ?? dictionary.auth.signedIn}
        </span>
      </span>
      <form action={`/${locale}/auth/sign-out`} method="post">
        <button className={styles.authAction} type="submit">
          {dictionary.auth.signOut}
        </button>
      </form>
    </div>
  );
}
