import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { connection } from 'next/server';

import { PlatformAgentAuthorizationIdSchema } from '@wiser/platform-contracts';

import {
  loadAgentConsent,
  type AgentConsentRequest,
} from '@/lib/agent-consent';
import { getAgentConsentServerContext } from '@/lib/agent-consent.server';
import { getDictionary, isLocale } from '@/lib/i18n';

import styles from './page.module.css';

interface Props {
  readonly params: Promise<{ readonly locale: string }>;
  readonly searchParams: Promise<{
    readonly authorization_id?: string | readonly string[];
    readonly error?: string | readonly string[];
  }>;
}

const securityLevels = [
  'L0_PUBLIC',
  'L1_INTERNAL',
  'L2_RESTRICTED',
  'L3_CONFIDENTIAL',
] as const;

export const metadata: Metadata = {
  robots: { index: false, follow: false },
  // Native same-origin POST forms need their Origin for the decision route's
  // CSRF check. External callbacks must still receive no consent-page referrer.
  referrer: 'same-origin',
};

function first(value: string | readonly string[] | undefined): string | null {
  return typeof value === 'string' ? value : (value?.[0] ?? null);
}

export default async function AgentConsentPage({
  params,
  searchParams,
}: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  await connection();
  const query = await searchParams;
  const t = getDictionary(locale).auth.agentConsent;
  const authorizationId = first(query.authorization_id);
  const validId =
    PlatformAgentAuthorizationIdSchema.safeParse(authorizationId).success;
  let consent: AgentConsentRequest | null = null;
  if (validId && authorizationId !== null) {
    try {
      const { deps, token } = await getAgentConsentServerContext();
      consent = await loadAgentConsent(deps, token, authorizationId);
    } catch {
      consent = null;
    }
  }
  if (consent?.kind === 'already-authorized') redirect(consent.redirectUrl);
  const request = consent?.kind === 'request' ? consent : null;
  const action = `/${locale}/oauth/consent/decision`;

  return (
    <main id="main-content" className={styles.main}>
      <section className={styles.heading}>
        <p className={styles.eyebrow}>{t.eyebrow}</p>
        <h1>{t.title}</h1>
        <p>{t.description}</p>
      </section>

      {request === null ? (
        <section className={styles.notice} role="alert">
          <h2>{t.unavailableTitle}</h2>
          <p>{validId ? t.unavailable : t.invalid}</p>
          <Link href={`/${locale}`}>{t.returnHome}</Link>
        </section>
      ) : (
        <>
          {first(query.error) !== null ? (
            <p className={styles.error} role="alert">
              {t.retry}
            </p>
          ) : null}
          <section className={styles.client} aria-labelledby="client-title">
            <h2 id="client-title">{request.clientName}</h2>
            <p>{t.clientRequest}</p>
            <dl>
              <div>
                <dt>{t.callback}</dt>
                <dd>{new URL(request.redirectUri).host}</dd>
              </div>
              <div>
                <dt>{t.requestedScopes}</dt>
                <dd>{request.scopes.join(', ') || t.noScopes}</dd>
              </div>
            </dl>
            <p className={styles.caution}>{t.caution}</p>
          </section>

          <section aria-labelledby="projects-title">
            <h2 id="projects-title">{t.projectsTitle}</h2>
            {request.projects.length === 0 ? (
              <p className={styles.notice}>{t.noProjects}</p>
            ) : (
              <div className={styles.projects}>
                {request.projects.map((project) => (
                  <form
                    className={styles.project}
                    key={project.projectId}
                    action={action}
                    method="post"
                  >
                    <input
                      type="hidden"
                      name="authorization_id"
                      value={request.authorizationId}
                    />
                    <input
                      type="hidden"
                      name="tenantId"
                      value={project.tenantId}
                    />
                    <input
                      type="hidden"
                      name="projectId"
                      value={project.projectId}
                    />
                    <input type="hidden" name="decision" value="approve" />
                    <p className={styles.tenant}>
                      {project.tenantName[locale]}
                    </p>
                    <h3>{project.projectName[locale]}</h3>
                    <div className={styles.fields}>
                      <label>
                        <span>{t.mode}</span>
                        <select name="mode" defaultValue="query">
                          {project.modes.map((mode) => (
                            <option key={mode} value={mode}>
                              {t.modes[mode]}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        <span>{t.securityLevel}</span>
                        <select
                          name="maxSecurityLevel"
                          defaultValue="L0_PUBLIC"
                        >
                          {securityLevels
                            .slice(
                              0,
                              securityLevels.indexOf(project.maxSecurityLevel) +
                                1,
                            )
                            .map((level) => (
                              <option key={level} value={level}>
                                {t.levels[level]}
                              </option>
                            ))}
                        </select>
                      </label>
                      <label>
                        <span>{t.duration}</span>
                        <select name="expiresInSeconds" defaultValue="900">
                          <option value="900">{t.fifteenMinutes}</option>
                          <option value="3600">{t.oneHour}</option>
                        </select>
                      </label>
                    </div>
                    <p className={styles.projectNote}>{t.projectScope}</p>
                    <button type="submit">{t.approve}</button>
                  </form>
                ))}
              </div>
            )}
          </section>

          <form className={styles.deny} action={action} method="post">
            <input
              type="hidden"
              name="authorization_id"
              value={request.authorizationId}
            />
            <input type="hidden" name="decision" value="deny" />
            <button type="submit">{t.deny}</button>
          </form>
        </>
      )}
    </main>
  );
}
