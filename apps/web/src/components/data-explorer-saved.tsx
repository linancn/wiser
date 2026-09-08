'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  CreateExplorationViewOutputSchema,
  ListExplorationViewsOutputSchema,
  ExportExplorationOutputSchema,
  RevokeExplorationViewOutputSchema,
  type ExplorationSavedView,
  type ExplorationViewSpec,
} from '@wiser/data-contracts';
import { getDictionary, type Locale } from '@/lib/i18n';
import styles from './data-explorer.module.css';
export function DataExplorerSaved({
  locale,
  queryId,
  capture,
}: {
  readonly locale: Locale;
  readonly queryId: string;
  readonly capture: () => ExplorationViewSpec | null;
}) {
  const copy = getDictionary(locale).dataFoundation.explorer.saved;
  const [title, setTitle] = useState('');
  const [visibility, setVisibility] = useState<'private' | 'project'>(
    'private',
  );
  const [items, setItems] = useState<ExplorationSavedView[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);
  const [link, setLink] = useState('');
  const pending = useRef<AbortController | null>(null);
  const retry = useRef<{ body: string; key: string } | null>(null);
  useEffect(() => () => pending.current?.abort(), []);
  const href = (viewId: string) =>
    `/${locale}/data-foundation/explore?saved=${encodeURIComponent(viewId)}`;
  async function request(action: string, input: unknown, mutation = false) {
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    const body = JSON.stringify(input);
    if (mutation && retry.current?.body !== `${action}:${body}`)
      retry.current = { body: `${action}:${body}`, key: crypto.randomUUID() };
    setBusy(true);
    setMessage('');
    setFailed(false);
    try {
      const response = await fetch(
        `/api/data-foundation/explore/views/${action}`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(mutation && retry.current
              ? { 'Idempotency-Key': retry.current.key }
              : {}),
          },
          body,
          cache: 'no-store',
          signal: controller.signal,
        },
      );
      if (!response.ok) throw new Error('Unavailable');
      const value: unknown = await response.json();
      if (controller.signal.aborted)
        throw new DOMException('Aborted', 'AbortError');
      return value;
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  function failure(error: unknown) {
    if (error instanceof DOMException && error.name === 'AbortError') return;
    if (pending.current?.signal.aborted) return;
    setFailed(true);
    setMessage(copy.failed);
  }
  async function list() {
    try {
      setItems(
        ListExplorationViewsOutputSchema.parse(await request('list', {})).items,
      );
    } catch (error) {
      failure(error);
    }
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    const viewSpec = capture();
    if (!viewSpec) {
      setFailed(true);
      setMessage(copy.wait);
      return;
    }
    try {
      const { savedView } = CreateExplorationViewOutputSchema.parse(
        await request('create', { queryId, title, visibility, viewSpec }, true),
      );
      setItems((current) => [
        savedView,
        ...current.filter((item) => item.viewId !== savedView.viewId),
      ]);
      setLink(new URL(href(savedView.viewId), window.location.origin).href);
      setMessage(copy.saved);
    } catch (error) {
      failure(error);
    }
  }
  async function revoke(viewId: string) {
    try {
      RevokeExplorationViewOutputSchema.parse(
        await request('revoke', { viewId }, true),
      );
      setItems((current) => current.filter((item) => item.viewId !== viewId));
      if (link.endsWith(viewId)) setLink('');
      setMessage(copy.revoked);
    } catch (error) {
      failure(error);
    }
  }
  async function download() {
    const viewSpec = capture();
    const input = viewSpec?.requests[viewSpec.activeView];
    if (!input) {
      setFailed(true);
      setMessage(copy.wait);
      return;
    }
    try {
      const data = ExportExplorationOutputSchema.parse(
        await request('export', { request: input }),
      );
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `wiser-${queryId}-${input.view}.json`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage(
        `${copy.exported} ${data.coverage.returnedCount.toLocaleString(locale)} / ${data.coverage.totalCount.toLocaleString(locale)} · ${copy.units[data.coverage.unit]} · ${data.coverage.complete ? copy.complete : copy.partial}`,
      );
    } catch (error) {
      failure(error);
    }
  }
  async function copyLink() {
    try {
      if (!navigator.clipboard) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(link);
      setFailed(false);
      setMessage(copy.copied);
    } catch {
      setFailed(true);
      setMessage(copy.copyFallback);
    }
  }
  return (
    <details
      className={styles.saved}
      onToggle={(event) => {
        if (event.currentTarget.open) void list();
      }}
    >
      <summary>{copy.title}</summary>
      <p>{copy.description}</p>
      <form onSubmit={(event) => void save(event)} className={styles.savedForm}>
        <label>
          {copy.name}
          <input
            required
            maxLength={160}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <label>
          {copy.visibility}
          <select
            value={visibility}
            onChange={(event) =>
              setVisibility(
                event.target.value === 'project' ? 'project' : 'private',
              )
            }
          >
            <option value="private">{copy.private}</option>
            <option value="project">{copy.project}</option>
          </select>
        </label>
        <button disabled={busy} type="submit">
          {copy.save}
        </button>
        <button disabled={busy} type="button" onClick={() => void download()}>
          {copy.export}
        </button>
      </form>
      <p>{copy.exportScope}</p>
      {message ? <p role={failed ? 'alert' : 'status'}>{message}</p> : null}
      {link ? (
        <div className={styles.savedForm}>
          <label>
            {copy.link}
            <input
              readOnly
              value={link}
              onFocus={(event) => event.target.select()}
            />
          </label>
          <button onClick={() => void copyLink()}>{copy.copy}</button>
        </div>
      ) : null}
      <ul>
        {items.map((item) => (
          <li key={item.viewId}>
            <a href={href(item.viewId)}>{item.title}</a>
            <span>{copy[item.visibility]}</span>
            <button
              disabled={busy}
              onClick={() =>
                setLink(new URL(href(item.viewId), window.location.origin).href)
              }
            >
              {copy.link}
            </button>
            <button disabled={busy} onClick={() => void revoke(item.viewId)}>
              {copy.revoke}
            </button>
          </li>
        ))}
      </ul>
      {!busy && items.length === 0 ? <p>{copy.empty}</p> : null}
    </details>
  );
}
