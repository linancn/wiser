'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  ResourceGrantsPageSchema,
  ResourceGrantRevokeReceiptSchema,
  ResourceGrantRenewReceiptSchema,
  ResourceBatchPurposeSchema,
  ProjectAccessMembersPageSchema,
  type ResourceGrantsPage,
  type ResourceGrantRenewReceipt,
  type ResourceGrantRevokeReceipt,
  type ProjectAccessProjectView,
} from '@wiser/platform-contracts';
import { getDictionary, type Locale } from '@/lib/i18n';
import { ContextHelp } from './context-help';
import styles from './project-access-workspace.module.css';
type Grant = ResourceGrantsPage['items'][number];
type Props = {
  project: ProjectAccessProjectView;
  viewerId: string;
  locale: Locale;
};
async function json(response: Response): Promise<unknown> {
  const data: unknown = await response.json();
  if (!response.ok)
    throw Error(
      data &&
        typeof data === 'object' &&
        'code' in data &&
        typeof data.code === 'string'
        ? data.code
        : 'ACCESS_UNAVAILABLE',
    );
  return data;
}
function useRemote<T>(
  url: string | null,
  schema: { parse(input: unknown): T },
  revision = 0,
) {
  const [state, setState] = useState<{
    url: string | null;
    revision: number;
    data: T | null;
    error: boolean;
  }>({ url: null, revision: 0, data: null, error: false });
  useEffect(() => {
    const controller = new AbortController();
    if (url)
      void fetch(url, { cache: 'no-store', signal: controller.signal })
        .then(json)
        .then((data) => schema.parse(data))
        .then((data) => {
          if (!controller.signal.aborted)
            setState({ url, revision, data, error: false });
        })
        .catch(() => {
          if (!controller.signal.aborted)
            setState({ url, revision, data: null, error: true });
        });
    return () => controller.abort();
  }, [url, schema, revision]);
  return state.url === url && state.revision === revision
    ? state
    : { data: null, error: false };
}
function MemberChoice({
  projectId,
  viewerId,
  locale,
  onChange,
}: {
  projectId: string;
  viewerId: string;
  locale: Locale;
  onChange: (id: string) => void;
}) {
  const t = getDictionary(locale).resourceGrants,
    [search, setSearch] = useState(''),
    [page, setPage] = useState(0),
    [selected, setSelected] = useState(t.self);
  const state = useRemote(
    '/api/platform/access/members?' +
      new URLSearchParams({
        projectId,
        search,
        offset: String(page * 20),
        limit: '20',
      }).toString(),
    ProjectAccessMembersPageSchema,
  );
  return (
    <details>
      <summary>
        {t.member} · {selected}
      </summary>
      <form
        className={styles.search}
        onSubmit={(e) => {
          e.preventDefault();
          const value = new FormData(e.currentTarget).get('search');
          setSearch(typeof value === 'string' ? value : '');
          setPage(0);
        }}
      >
        <label>
          {t.memberSearch}
          <input name="search" maxLength={100} />
        </label>
        <button type="submit">{t.search}</button>
      </form>
      <div className={styles.actions}>
        <button
          onClick={() => {
            onChange(viewerId);
            setSelected(t.self);
          }}
        >
          {t.self}
        </button>
        {state.data?.items.map((m) => (
          <button
            key={m.actorId}
            onClick={() => {
              onChange(m.actorId);
              setSelected(m.displayName?.trim() || m.email || m.actorId);
            }}
          >
            {m.displayName?.trim() || m.email || m.actorId}
          </button>
        ))}
      </div>
      {state.error ? <p role="alert">{t.unavailable}</p> : null}
      {state.data?.items.length === 0 ? <p>{t.none}</p> : null}
      <div className={styles.actions}>
        <button disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
          {t.previous}
        </button>
        <button
          disabled={!state.data?.hasMore}
          onClick={() => setPage((p) => p + 1)}
        >
          {t.next}
        </button>
      </div>
    </details>
  );
}
export function ProjectResourceGrants(props: Props) {
  return <GrantWorkspace key={props.project.projectId} {...props} />;
}
function GrantWorkspace({ project, viewerId, locale }: Props) {
  const t = getDictionary(locale).resourceGrants,
    d = getDictionary(locale).resourceDefinitions,
    [actorId, setActorId] = useState(viewerId),
    [page, setPage] = useState(0),
    [status, setStatus] = useState(''),
    [revision, setRevision] = useState(0),
    [editor, setEditor] = useState<{
      grant: Grant;
      action: 'revoke' | 'renew';
    } | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [receipt, setReceipt] = useState<
      | { kind: 'revoke'; data: ResourceGrantRevokeReceipt }
      | { kind: 'renew'; data: ResourceGrantRenewReceipt }
      | null
    >(null);
  const retry = useRef<{ body: string; key: string } | null>(null),
    controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const state = useRemote(
    '/api/platform/access/resource-grants?' +
      new URLSearchParams({
        projectId: project.projectId,
        actorId,
        offset: String(page * 20),
        limit: '20',
        ...(status ? { status } : {}),
      }).toString(),
    ResourceGrantsPageSchema,
    revision,
  );
  const cancel = () => {
    controller.current?.abort();
    setBusy(false);
    setEditor(null);
    setError('');
    retry.current = null;
  };
  const reset = () => {
    cancel();
    setReceipt(null);
    setPage(0);
  };
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!editor || busy) return;
    const form = new FormData(e.currentTarget),
      reasonValue = form.get('reason'),
      reason = typeof reasonValue === 'string' ? reasonValue.trim() : '';
    const expiryValue = form.get('expiresAt');
    const expiry = new Date(typeof expiryValue === 'string' ? expiryValue : '');
    if (
      reason.length < 5 ||
      (editor.action === 'renew' &&
        (!Number.isFinite(expiry.getTime()) ||
          expiry.getTime() <=
            Math.max(Date.now(), Date.parse(editor.grant.expiresAt))))
    ) {
      setError(t.invalid);
      return;
    }
    const body = JSON.stringify({
      projectId: project.projectId,
      grantId: editor.grant.id,
      reason,
      ...(editor.action === 'renew' ? { expiresAt: expiry.toISOString() } : {}),
    });
    if (retry.current?.body !== body)
      retry.current = { body, key: crypto.randomUUID() };
    const request = new AbortController();
    controller.current = request;
    setBusy(true);
    setError('');
    try {
      const result = await fetch(
        '/api/platform/access/resource-grant-' + editor.action,
        {
          method: 'POST',
          cache: 'no-store',
          signal: request.signal,
          headers: {
            'content-type': 'application/json',
            'idempotency-key': retry.current.key,
          },
          body,
        },
      ).then(json);
      if (request.signal.aborted) return;
      setReceipt(
        editor.action === 'revoke'
          ? {
              kind: 'revoke',
              data: ResourceGrantRevokeReceiptSchema.parse(result),
            }
          : {
              kind: 'renew',
              data: ResourceGrantRenewReceiptSchema.parse(result),
            },
      );
      setEditor(null);
      retry.current = null;
      setRevision((x) => x + 1);
    } catch (err) {
      if (!request.signal.aborted) {
        const code = err instanceof Error ? err.message : '';
        setError(
          ['NOT_AUTHORIZED', 'NOT_AUTHENTICATED'].includes(code)
            ? t.denied
            : [
                  'REQUEST_STATE_CONFLICT',
                  'VERSION_CONFLICT',
                  'RESOURCE_UNAVAILABLE',
                  'PREVIEW_CHANGED',
                ].includes(code)
              ? t.conflict
              : code === 'VALIDATION_FAILED'
                ? t.invalid
                : t.unavailable,
        );
      }
    } finally {
      if (!request.signal.aborted) setBusy(false);
    }
  }
  return (
    <section aria-label={t.records}>
      <ContextHelp label={t.help}>{t.helpText}</ContextHelp>
      {project.canManage ? (
        <MemberChoice
          projectId={project.projectId}
          viewerId={viewerId}
          locale={locale}
          onChange={(id) => {
            reset();
            setActorId(id);
          }}
        />
      ) : null}
      <div className={styles.actions}>
        <label>
          {t.status}
          <select
            value={status}
            onChange={(e) => {
              reset();
              setStatus(e.target.value);
            }}
          >
            <option value="">{t.all}</option>
            {(['active', 'scheduled', 'expired', 'revoked'] as const).map(
              (s) => (
                <option key={s} value={s}>
                  {t[s]}
                </option>
              ),
            )}
          </select>
        </label>
        <button
          onClick={() => {
            cancel();
            setRevision((x) => x + 1);
          }}
        >
          {t.refresh}
        </button>
      </div>
      {state.error ? (
        <p role="alert">{t.unavailable}</p>
      ) : state.data === null ? (
        <p role="status">{t.loading}</p>
      ) : null}
      {state.data?.items.length === 0 ? <p>{t.empty}</p> : null}
      {state.data?.items.map((g) => (
        <article className={styles.editor} key={g.id}>
          <div className={styles.projectHeading}>
            <h3>{g.packageName}</h3>
            <span className={styles.badge} data-status={g.status}>
              {t[g.status]}
            </span>
            <span className={styles.roleBadge}>{g.presetName}</span>
          </div>
          <dl className={styles.facts}>
            <div>
              <dt>{t.range}</dt>
              <dd>{g.resourceCount}</dd>
            </div>
            <div>
              <dt>{getDictionary(locale).resourcePurposes.label}</dt>
              <dd>
                {
                  getDictionary(locale).resourcePurposes[
                    g.purpose === 'web-console' || g.purpose === 'agent-data'
                      ? g.purpose
                      : 'other'
                  ]
                }
              </dd>
            </div>
            <div>
              <dt>{t.starts}</dt>
              <dd>
                <time dateTime={g.startsAt}>
                  {new Date(g.startsAt).toLocaleString(locale)}
                </time>
              </dd>
            </div>
            <div>
              <dt>{t.expires}</dt>
              <dd>
                <time dateTime={g.expiresAt}>
                  {new Date(g.expiresAt).toLocaleString(locale)}
                </time>
              </dd>
            </div>
          </dl>
          <div aria-label={t.actions}>
            {g.actions.map((a) => (
              <span className={styles.roleBadge} key={a}>
                {d[a]}
              </span>
            ))}
          </div>
          <details>
            <summary>{t.history}</summary>
            <p>
              {t.reason}：{g.reason}
            </p>
            <p>
              {t.package} · {g.packageName} v{g.packageVersion} · {t.preset} ·{' '}
              {g.presetName} v{g.presetVersion}
            </p>
            {g.revocationReason ? (
              <p>
                {t.revoked}：{g.revocationReason}
              </p>
            ) : null}
          </details>
          {project.canManage && g.status !== 'revoked' ? (
            <div className={styles.actions}>
              <button
                disabled={busy}
                onClick={() => {
                  cancel();
                  setReceipt(null);
                  setEditor({ grant: g, action: 'revoke' });
                }}
              >
                {t.revoke}
              </button>
              {ResourceBatchPurposeSchema.safeParse(g.purpose).success ? (
                <button
                  disabled={busy}
                  onClick={() => {
                    cancel();
                    setReceipt(null);
                    setEditor({ grant: g, action: 'renew' });
                  }}
                >
                  {t.renew}
                </button>
              ) : null}
            </div>
          ) : null}
        </article>
      ))}
      <div className={styles.actions}>
        <button
          disabled={page === 0 || busy}
          onClick={() => {
            cancel();
            setPage((x) => x - 1);
          }}
        >
          {t.previous}
        </button>
        <button
          disabled={!state.data?.hasMore || busy}
          onClick={() => {
            cancel();
            setPage((x) => x + 1);
          }}
        >
          {t.next}
        </button>
      </div>
      {state.data ? (
        <p>
          {t.checked} ·{' '}
          <time dateTime={state.data.checkedAt}>
            {new Date(state.data.checkedAt).toLocaleString(locale)}
          </time>
        </p>
      ) : null}
      {editor ? (
        <div className={styles.editor}>
          <h3>
            {editor.action === 'renew' ? t.renew : t.revoke} ·{' '}
            {editor.grant.packageName}
          </h3>
          <p>{editor.action === 'renew' ? t.renewImpact : t.revokeImpact}</p>
          <form
            onSubmit={(e) => {
              void submit(e);
            }}
          >
            {editor.action === 'renew' ? (
              <label>
                {t.newExpiry}
                <input
                  name="expiresAt"
                  type="datetime-local"
                  required
                  disabled={busy}
                />
              </label>
            ) : null}
            <label>
              {t.reason}
              <textarea
                name="reason"
                minLength={5}
                maxLength={1000}
                required
                disabled={busy}
              />
            </label>
            {error ? <p role="alert">{error}</p> : null}
            <div className={styles.actions}>
              <button type="submit" disabled={busy}>
                {editor.action === 'renew' ? t.confirmRenew : t.confirmRevoke}
              </button>
              <button type="button" onClick={cancel}>
                {t.cancel}
              </button>
            </div>
          </form>
        </div>
      ) : null}
      {receipt ? (
        <section aria-label={t.receipt} role="status">
          <h3>{t.receipt}</h3>
          {receipt.kind === 'revoke' ? (
            <>
              <p>{t.revokedSuccess}</p>
              <p>
                {t.other}：{receipt.data.otherActiveGrantCount}
              </p>
            </>
          ) : (
            <>
              <p>{t.renewPending}</p>
              <p>
                {t.batch} · {receipt.data.batch.id}
              </p>
              <p>{t.renewImpact}</p>
            </>
          )}
        </section>
      ) : null}
    </section>
  );
}
