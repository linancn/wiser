'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  ResourceBatchesPageSchema,
  ResourceBatchViewSchema,
  ResourceBatchPreviewCommandSchema,
  ResourceBatchPurposeSchema,
  ResourceDefinitionsPageSchema,
  ProjectAccessMembersPageSchema,
  type ResourceBatchView,
  type ProjectAccessProjectView,
  type ResourceDefinitionsPage,
  type ResourceBatchPreviewCommand,
} from '@wiser/platform-contracts';
import { getDictionary, type Locale } from '@/lib/i18n';
import { ContextHelp } from './context-help';
import styles from './project-access-workspace.module.css';
type ResourceDefinition = ResourceDefinitionsPage['items'][number];
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
  schema: { parse(value: unknown): T },
  revision = 0,
) {
  const [data, setData] = useState<T | null>(null),
    [error, setError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    setError(false);
    if (url)
      void fetch(url, { cache: 'no-store', signal: controller.signal })
        .then(json)
        .then((x) => schema.parse(x))
        .then((x) => {
          if (!controller.signal.aborted) setData(x);
        })
        .catch(() => {
          if (!controller.signal.aborted) setError(true);
        });
    return () => controller.abort();
  }, [url, schema, revision]);
  return { data, error, loading: url !== null && data === null && !error };
}
function message(code: string, locale: Locale) {
  const t = getDictionary(locale).resourceBatches;
  return code === 'PREVIEW_CHANGED' || code === 'ACCESS_CHANGED'
    ? t.accessChanged
    : code === 'PREVIEW_EXPIRED'
      ? t.expired
      : code === 'MEMBERSHIP_CHANGED'
        ? t.membershipChanged
        : code === 'AUTHORITY_CHANGED'
          ? t.authorityChanged
          : code === 'IMPORTANT_APPROVAL_REQUIRED'
            ? t.important
            : code === 'RESOURCE_UNAVAILABLE'
              ? t.resourceUnavailable
              : [
                    'NOT_AUTHENTICATED',
                    'NOT_AUTHORIZED',
                    'SELF_CHANGE_FORBIDDEN',
                  ].includes(code)
                ? t.denied
                : [
                      'VERSION_CONFLICT',
                      'IDEMPOTENCY_CONFLICT',
                      'REQUEST_STATE_CONFLICT',
                    ].includes(code)
                  ? t.conflict
                  : code === 'VALIDATION_FAILED'
                    ? t.invalid
                    : t.unavailable;
}
function field(form: FormData, name: string) {
  const v = form.get(name);
  return typeof v === 'string' ? v : '';
}
function DefinitionPicker({
  projectId,
  kind,
  locale,
  onSelect,
}: {
  projectId: string;
  kind: 'package' | 'preset';
  locale: Locale;
  onSelect: (value: ResourceDefinition | null) => void;
}) {
  const t = getDictionary(locale).resourceBatches,
    [page, setPage] = useState(0),
    [selected, setSelected] = useState<ResourceDefinition | null>(null);
  const state = useRemote(
    '/api/platform/access/resource-definitions?' +
      new URLSearchParams({
        projectId,
        kind,
        offset: String(page * 20),
        limit: '20',
      }).toString(),
    ResourceDefinitionsPageSchema,
  );
  useEffect(() => {
    if (state.error) {
      setSelected(null);
      onSelect(null);
    }
  }, [state.error, onSelect]);
  return (
    <fieldset>
      <label>
        {t[kind]}
        <select
          aria-label={t[kind]}
          value={selected?.id ?? ''}
          disabled={state.loading || state.error}
          onChange={(e) => {
            const item =
              state.data?.items.find((x) => x.id === e.target.value) ?? null;
            setSelected(item);
            onSelect(item);
          }}
        >
          <option value="">{t.choose}</option>
          {selected && !state.data?.items.some((x) => x.id === selected.id) ? (
            <option value={selected.id}>
              {selected.name} · {t.version} {selected.version}
            </option>
          ) : null}
          {state.data?.items.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name} · {t.version} {x.version}
            </option>
          ))}
        </select>
      </label>
      {state.error ? <p role="alert">{t.unavailable}</p> : null}
      <div className={styles.actions}>
        <button
          type="button"
          disabled={page === 0 || state.loading}
          onClick={() => setPage((x) => x - 1)}
        >
          {t.previous}
        </button>
        <button
          type="button"
          disabled={!state.data?.hasMore || state.loading}
          onClick={() => setPage((x) => x + 1)}
        >
          {t.next}
        </button>
      </div>
    </fieldset>
  );
}
function BatchForm({
  locale,
  project,
  busy,
  onSubmit,
  onCancel,
}: {
  locale: Locale;
  project: ProjectAccessProjectView;
  busy: boolean;
  onSubmit: (command: ResourceBatchPreviewCommand) => void;
  onCancel: () => void;
}) {
  const t = getDictionary(locale).resourceBatches,
    [page, setPage] = useState(0),
    [search, setSearch] = useState(''),
    [selected, setSelected] = useState<Record<string, string>>({}),
    [pack, setPack] = useState<ResourceDefinition | null>(null),
    [preset, setPreset] = useState<ResourceDefinition | null>(null),
    [error, setError] = useState<string | null>(null);
  const previewKey = useRef<{
    signature: string;
    command: ResourceBatchPreviewCommand;
  } | null>(null);
  const members = useRemote(
    '/api/platform/access/members?' +
      new URLSearchParams({
        projectId: project.projectId,
        offset: String(page * 20),
        limit: '20',
        search,
      }).toString(),
    ProjectAccessMembersPageSchema,
  );
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget),
      days = Number(field(form, 'days')),
      now = Date.now();
    if (
      !pack ||
      !preset ||
      preset.kind !== 'preset' ||
      !Number.isInteger(days) ||
      days < 1 ||
      days > preset.maxDays
    ) {
      setError(t.invalid);
      return;
    }
    const parsed = ResourceBatchPreviewCommandSchema.safeParse({
      projectId: project.projectId,
      packageId: pack.id,
      packageVersion: pack.version,
      presetId: preset.id,
      presetVersion: preset.version,
      actorIds: Object.keys(selected),
      purpose: field(form, 'purpose'),
      startsAt: new Date(now).toISOString(),
      expiresAt: new Date(now + days * 86400000).toISOString(),
      reason: field(form, 'reason'),
    });
    if (!parsed.success) {
      setError(t.invalid);
      return;
    }
    setError(null);
    const signature = JSON.stringify({
      projectId: project.projectId,
      packageId: pack.id,
      packageVersion: pack.version,
      presetId: preset.id,
      presetVersion: preset.version,
      actorIds: Object.keys(selected).sort(),
      purpose: parsed.data.purpose,
      days,
      reason: parsed.data.reason,
    });
    if (previewKey.current?.signature === signature)
      onSubmit(previewKey.current.command);
    else {
      previewKey.current = { signature, command: parsed.data };
      onSubmit(parsed.data);
    }
  }
  return (
    <form onSubmit={submit} className={styles.batchForm}>
      <fieldset disabled={busy}>
        <legend>{t.create}</legend>
        <DefinitionPicker
          projectId={project.projectId}
          kind="package"
          locale={locale}
          onSelect={setPack}
        />
        <DefinitionPicker
          projectId={project.projectId}
          kind="preset"
          locale={locale}
          onSelect={setPreset}
        />
        <label>
          {getDictionary(locale).resourcePurposes.label}
          <select
            name="purpose"
            aria-label={getDictionary(locale).resourcePurposes.label}
            defaultValue="web-console"
            required
          >
            {ResourceBatchPurposeSchema.options.map((purpose) => (
              <option key={purpose} value={purpose}>
                {getDictionary(locale).resourcePurposes[purpose]}
              </option>
            ))}
          </select>
        </label>
        <p>{getDictionary(locale).resourcePurposes.help}</p>
        <label>
          {t.memberSearch}
          <input
            type="search"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
          />
        </label>
        <fieldset>
          <legend>{t.members}</legend>
          {members.loading ? <p role="status">{t.loading}</p> : null}
          {members.error ? <p role="alert">{t.unavailable}</p> : null}
          {members.data?.items
            .filter((m) => m.status === 'active')
            .map((m) => (
              <label key={m.actorId}>
                <input
                  type="checkbox"
                  checked={m.actorId in selected}
                  onChange={(e) => {
                    if (e.target.checked) {
                      if (Object.keys(selected).length >= 50) {
                        setError(t.limit);
                        return;
                      }
                      setSelected((x) => ({
                        ...x,
                        [m.actorId]: m.displayName || m.email,
                      }));
                    } else
                      setSelected((x) => {
                        const next = { ...x };
                        delete next[m.actorId];
                        return next;
                      });
                  }}
                />
                {m.displayName || m.email}
              </label>
            ))}
          <div className={styles.actions}>
            <button
              type="button"
              disabled={page === 0 || members.loading}
              onClick={() => setPage((x) => x - 1)}
            >
              {t.previous}
            </button>
            <button
              type="button"
              disabled={!members.data?.hasMore || members.loading}
              onClick={() => setPage((x) => x + 1)}
            >
              {t.next}
            </button>
          </div>
        </fieldset>
        <details open={Object.keys(selected).length > 0}>
          <summary>
            {t.selected} · {Object.keys(selected).length}/50
          </summary>
          <ul>
            {Object.entries(selected).map(([id, name]) => (
              <li key={id}>
                {name}{' '}
                <button
                  type="button"
                  aria-label={`${t.remove} ${name}`}
                  onClick={() =>
                    setSelected((x) => {
                      const n = { ...x };
                      delete n[id];
                      return n;
                    })
                  }
                >
                  {t.remove}
                </button>
              </li>
            ))}
          </ul>
          <button type="button" onClick={() => setSelected({})}>
            {t.clear}
          </button>
        </details>
        <label>
          {t.days}
          <input
            name="days"
            type="number"
            min="1"
            max={preset?.kind === 'preset' ? preset.maxDays : 366}
            defaultValue="7"
            required
          />
        </label>
        <label>
          {t.reason}
          <textarea name="reason" minLength={5} maxLength={1000} required />
        </label>
        {error ? <p role="alert">{error}</p> : null}
        <div className={styles.actions}>
          <button
            type="submit"
            disabled={
              !pack ||
              !preset ||
              !Object.keys(selected).length ||
              members.loading ||
              members.error
            }
          >
            {t.preview}
          </button>
          <button type="button" onClick={onCancel}>
            {t.cancel}
          </button>
        </div>
      </fieldset>
    </form>
  );
}
type Action = 'approve' | 'reject' | 'execute' | 'withdraw';
function BatchDetails({
  batch,
  locale,
}: {
  batch: ResourceBatchView;
  locale: Locale;
}) {
  const t = getDictionary(locale).resourceBatches,
    d = getDictionary(locale).resourceDefinitions;
  return (
    <>
      <dl className={styles.batchFacts}>
        <dt>{getDictionary(locale).resourcePurposes.label}</dt>
        <dd>{getDictionary(locale).resourcePurposes[batch.purpose]}</dd>
        <dt>{t.preset}</dt>
        <dd>
          {batch.presetName} · {t.version} {batch.presetVersion}
        </dd>
        <dt>{t.count}</dt>
        <dd>{batch.resourceCount}</dd>
        <dt>{t.actions}</dt>
        <dd>{batch.actions.map((x) => d[x]).join(' · ')}</dd>
        <dt>{t.permission}</dt>
        <dd>{t[batch.approvalLevel]}</dd>
        <dt>{t.starts}</dt>
        <dd>{new Date(batch.startsAt).toLocaleString(locale)}</dd>
        <dt>{t.expires}</dt>
        <dd>{new Date(batch.expiresAt).toLocaleString(locale)}</dd>
        <dt>{t.valid}</dt>
        <dd>{new Date(batch.validUntil).toLocaleString(locale)}</dd>
        <dt>{t.source}</dt>
        <dd>{batch.reason}</dd>
      </dl>
      <details>
        <summary>
          {t.detail} · {batch.members.length}
        </summary>
        <ContextHelp label={t.diff}>{t.diffHelp}</ContextHelp>
        <div className={styles.table}>
          <table>
            <thead>
              <tr>
                <th>{t.members}</th>
                <th>{t.status}</th>
                <th>{t.existing}</th>
                <th>{t.diff}</th>
                <th>{t.attempts}</th>
              </tr>
            </thead>
            <tbody>
              {batch.members.map((m) => (
                <tr key={m.actorId}>
                  <td>{m.displayName}</td>
                  <td>
                    {t[m.status]}
                    {m.code ? <p>{message(m.code, locale)}</p> : null}
                  </td>
                  <td>{m.existingGrantCount}</td>
                  <td>
                    {m.diff ? (
                      <>
                        <p>
                          {t.added} · {m.diff.added}
                        </p>
                        <p>
                          {t.extended} · {m.diff.extended}
                        </p>
                        <p>
                          {t.retained} · {m.diff.retained}
                        </p>
                        <p>
                          {t.removed} · {m.diff.removed}
                        </p>
                        <details>
                          <summary>{t.byAction}</summary>
                          {m.diff.byAction.map((row) => (
                            <p key={row.action}>
                              {d[row.action]} · {t.added} {row.added} ·{' '}
                              {t.extended} {row.extended} · {t.retained}{' '}
                              {row.retained}
                            </p>
                          ))}
                        </details>
                      </>
                    ) : (
                      t.diffUnknown
                    )}
                  </td>
                  <td>{m.attempts}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </>
  );
}
export function ProjectResourceBatches({
  locale,
  project,
  viewerId,
}: {
  locale: Locale;
  project: ProjectAccessProjectView;
  viewerId: string;
}) {
  const t = getDictionary(locale).resourceBatches,
    [page, setPage] = useState(0),
    [status, setStatus] = useState(''),
    [revision, setRevision] = useState(0),
    [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [receipt, setReceipt] = useState<ResourceBatchView | null>(null),
    [selected, setSelected] = useState<{
      batch: ResourceBatchView;
      action: Action;
    } | null>(null);
  const epoch = useRef(0),
    inFlight = useRef<AbortController | null>(null),
    keys = useRef(new Map<string, string>());
  useEffect(() => {
    epoch.current++;
    setPage(0);
    setOpen(false);
    setSelected(null);
    setReceipt(null);
    setError(null);
    setBusy(false);
    return () => {
      epoch.current++;
      inFlight.current?.abort();
    };
  }, [project.projectId]);
  const enabled =
    !!project.resourceAccessEnabled &&
    (project.canManage || project.canApprove);
  const state = useRemote(
    enabled
      ? '/api/platform/access/resource-batches?' +
          new URLSearchParams({
            projectId: project.projectId,
            offset: String(page * 20),
            limit: '20',
            ...(status ? { status } : {}),
          }).toString()
      : null,
    ResourceBatchesPageSchema,
    revision,
  );
  async function post(action: string, command: unknown) {
    if (inFlight.current) return;
    const signature = action + JSON.stringify(command),
      key = keys.current.get(signature) ?? crypto.randomUUID();
    keys.current.set(signature, key);
    const ticket = epoch.current,
      controller = new AbortController();
    inFlight.current = controller;
    setBusy(true);
    setError(null);
    try {
      const value = ResourceBatchViewSchema.parse(
        await json(
          await fetch('/api/platform/access/resource-batch-' + action, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'idempotency-key': key,
            },
            body: JSON.stringify(command),
            signal: controller.signal,
          }),
        ),
      );
      if (ticket !== epoch.current) return;
      setReceipt(value);
      setOpen(false);
      setSelected(null);
      setRevision((x) => x + 1);
    } catch (e) {
      if (ticket === epoch.current && !controller.signal.aborted)
        setError(
          message(
            e instanceof Error ? e.message : 'ACCESS_UNAVAILABLE',
            locale,
          ),
        );
    } finally {
      if (inFlight.current === controller) inFlight.current = null;
      if (ticket === epoch.current) setBusy(false);
    }
  }
  if (!enabled) return null;
  return (
    <section aria-label={t.title}>
      <div className={styles.actions}>
        <ContextHelp label={t.help}>{t.helpText}</ContextHelp>
        <label>
          {t.status}
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(0);
            }}
          >
            <option value="">{t.all}</option>
            {(
              [
                'pending',
                'approved',
                'partial',
                'executed',
                'rejected',
                'withdrawn',
              ] as const
            ).map((x) => (
              <option key={x} value={x}>
                {t[x]}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          disabled={busy}
          onClick={() => setRevision((x) => x + 1)}
        >
          {t.refresh}
        </button>
        {project.canManage ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setOpen(true);
              setSelected(null);
              setReceipt(null);
              setError(null);
            }}
          >
            {t.create}
          </button>
        ) : null}
      </div>
      {error ? <p role="alert">{error}</p> : null}
      {receipt ? (
        <section aria-label={t.receipt}>
          <h3>{t.receipt}</h3>
          <p role="status">
            {t[receipt.status]} · {receipt.packageName}
          </p>
          <ContextHelp label={t.receipt}>{t.resultHelp}</ContextHelp>
          <BatchDetails batch={receipt} locale={locale} />
        </section>
      ) : null}
      {open ? (
        <BatchForm
          key={project.projectId}
          locale={locale}
          project={project}
          busy={busy}
          onCancel={() => {
            setOpen(false);
            setError(null);
          }}
          onSubmit={(command) => void post('preview', command)}
        />
      ) : null}
      {selected ? (
        <form
          className={styles.batchForm}
          onSubmit={(e) => {
            e.preventDefault();
            const form = new FormData(e.currentTarget);
            void post(
              selected.action === 'approve' || selected.action === 'reject'
                ? 'decide'
                : selected.action,
              {
                projectId: project.projectId,
                batchId: selected.batch.id,
                expectedVersion: selected.batch.version,
                reason: field(form, 'reason'),
                ...(selected.action === 'approve' ||
                selected.action === 'reject'
                  ? { decision: selected.action }
                  : {}),
              },
            );
          }}
        >
          <h3>
            {t[selected.action]} · {selected.batch.packageName}
          </h3>
          <BatchDetails batch={selected.batch} locale={locale} />
          <label>
            {t.reason}
            <textarea
              name="reason"
              minLength={5}
              maxLength={1000}
              disabled={busy}
              required
            />
          </label>
          <div className={styles.actions}>
            <button type="submit" disabled={busy}>
              {t.submit}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setSelected(null)}
            >
              {t.cancel}
            </button>
          </div>
        </form>
      ) : null}
      {state.loading ? (
        <p role="status">{t.loading}</p>
      ) : state.error ? (
        <p role="alert">{t.unavailable}</p>
      ) : state.data?.items.length === 0 ? (
        <p>{t.empty}</p>
      ) : null}
      {state.data?.items.map((batch) => {
        const self =
          batch.applicantId === viewerId ||
          batch.members.some((m) => m.actorId === viewerId);
        return (
          <article key={batch.id} className={styles.batchCard}>
            <h3>{batch.packageName}</h3>
            <span className={styles.badge} data-status={batch.status}>
              {t[batch.status]}
            </span>{' '}
            · {t.version} {batch.packageVersion}
            <details>
              <summary>
                {t.detail} · {batch.members.length} · {t.count}{' '}
                {batch.resourceCount}
              </summary>
              <BatchDetails batch={batch} locale={locale} />
            </details>
            <div className={styles.actions}>
              {project.canApprove && !self && batch.status === 'pending'
                ? (['approve', 'reject'] as const).map((action) => (
                    <button
                      key={action}
                      disabled={busy}
                      onClick={() => {
                        setSelected({ batch, action });
                        setOpen(false);
                        setError(null);
                      }}
                    >
                      {t[action]}
                    </button>
                  ))
                : null}
              {project.canManage &&
              ['approved', 'partial'].includes(batch.status) ? (
                <button
                  disabled={busy}
                  onClick={() => {
                    setSelected({ batch, action: 'execute' });
                    setOpen(false);
                    setError(null);
                  }}
                >
                  {batch.status === 'partial' ? t.retry : t.execute}
                </button>
              ) : null}
              {project.canManage &&
              batch.applicantId === viewerId &&
              batch.status === 'pending' ? (
                <button
                  disabled={busy}
                  onClick={() => {
                    setSelected({ batch, action: 'withdraw' });
                    setOpen(false);
                    setError(null);
                  }}
                >
                  {t.withdraw}
                </button>
              ) : null}
            </div>
          </article>
        );
      })}
      <div className={styles.actions}>
        <button
          disabled={busy || state.loading || page === 0}
          onClick={() => setPage((x) => x - 1)}
        >
          {t.previous}
        </button>
        <button
          disabled={busy || state.loading || !state.data?.hasMore}
          onClick={() => setPage((x) => x + 1)}
        >
          {t.next}
        </button>
      </div>
    </section>
  );
}
