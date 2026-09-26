import { connection } from 'next/server';
import Link from 'next/link';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { readVerifiedAuthViewer } from '@/lib/auth';
import { getAgentConnectionAccount } from '@/lib/agent-connections.server';
import { getDictionary, isLocale } from '@/lib/i18n';
import { createWiserServerSupabaseClient } from '@/lib/supabase/server';
import styles from '@/components/project-access-workspace.module.css';

export const metadata: Metadata = {
  robots: { index: false, follow: false },
  referrer: 'same-origin',
};

export default async function AgentConnectionsPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly locale: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  await connection();
  const client = await createWiserServerSupabaseClient();
  if (!client || !(await readVerifiedAuthViewer(client)))
    redirect(
      `/${locale}/login?next=${encodeURIComponent(`/${locale}/account/agents`)}`,
    );
  const t = getDictionary(locale).auth.agentConnections;
  let items;
  try {
    items = await (await getAgentConnectionAccount()).load();
  } catch {
    return (
      <main id="main-content" className={styles.workspace}>
        <h1>{t.title}</h1>
        <p role="alert">{t.unavailable}</p>
        <Link href={`/${locale}/account/agents`}>{t.retry}</Link>
      </main>
    );
  }
  const { result } = await searchParams;
  const message =
    result === 'disconnected'
      ? t.disconnected
      : result === 'provider-pending'
        ? t.pending
        : result === 'unavailable'
          ? t.failed
          : null;
  return (
    <main id="main-content" className={styles.workspace}>
      <header className={styles.heading}>
        <div>
          <h1>{t.title}</h1>
          <p>{t.description}</p>
        </div>
      </header>
      {message ? (
        <p role={result === 'disconnected' ? 'status' : 'alert'}>{message}</p>
      ) : null}
      <p>{t.bounded}</p>
      {items.length === 0 ? (
        <p>{t.empty}</p>
      ) : (
        items.map((item) => (
          <section
            className={styles.content}
            key={item.connectionId}
            aria-labelledby={`connection-${item.connectionId}`}
          >
            <h2 id={`connection-${item.connectionId}`}>
              {item.clientName ?? t.client}
            </h2>
            <p>{t.status[item.status]}</p>
            <dl>
              <dt>{t.project}</dt>
              <dd>{item.projectName?.[locale] ?? t.unknownProject}</dd>
              <dt>{t.expires}</dt>
              <dd>
                <time dateTime={item.expiresAt}>
                  {new Intl.DateTimeFormat(locale, {
                    dateStyle: 'medium',
                    timeStyle: 'long',
                    timeZone: 'UTC',
                  }).format(new Date(item.expiresAt))}
                </time>
              </dd>
            </dl>
            {item.status !== 'revoked' || item.providerConsent ? (
              <form
                method="post"
                action={`/${locale}/account/agents/disconnect`}
                aria-describedby={`impact-${item.connectionId}`}
              >
                <input
                  type="hidden"
                  name="connectionId"
                  value={item.connectionId}
                />
                <p id={`impact-${item.connectionId}`}>{t.impact}</p>
                <button type="submit">
                  {item.status === 'revoked' ? t.retryDisconnect : t.disconnect}
                </button>
              </form>
            ) : null}
          </section>
        ))
      )}
      <Link href={`/${locale}`}>{t.home}</Link>
    </main>
  );
}
