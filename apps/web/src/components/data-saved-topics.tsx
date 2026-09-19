'use client';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import {
  ListExplorationViewsOutputSchema,
  type ExplorationSavedView,
} from '@wiser/data-contracts';
import { getDictionary, type Locale } from '@/lib/i18n';
import styles from './data-saved-topics.module.css';

export function DataSavedTopics({ locale }: { readonly locale: Locale }) {
  const copy = getDictionary(locale).dataFoundation.explorer.topics;
  const savedCopy = getDictionary(locale).dataFoundation.explorer.saved;
  const labelId = useId();
  const input = useRef<HTMLInputElement | null>(null);
  const [items, setItems] = useState<ExplorationSavedView[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(true);
  const [failed, setFailed] = useState(false);
  const pending = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setItems([]);
    setBusy(true);
    setFailed(false);
    try {
      const response = await fetch('/api/data-foundation/explore/views/list', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
        cache: 'no-store',
        signal: controller.signal,
      });
      if (!response.ok) throw new Error('Unavailable');
      const result = ListExplorationViewsOutputSchema.parse(
        await response.json(),
      );
      if (!controller.signal.aborted)
        setItems(result.items.filter((item) => item.revokedAt === null));
    } catch {
      if (!controller.signal.aborted) setFailed(true);
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
    const restore = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', restore);
    window.addEventListener('pageshow', restore);
    return () => {
      pending.current?.abort();
      document.removeEventListener('visibilitychange', restore);
      window.removeEventListener('pageshow', restore);
    };
  }, [refresh]);
  const visible = items.filter((item) =>
    item.title
      .toLocaleLowerCase(locale)
      .includes(text.trim().toLocaleLowerCase(locale)),
  );
  return (
    <section className={styles.topics} aria-labelledby={labelId}>
      <div className={styles.toolbar}>
        <h2 id={labelId}>{copy.title}</h2>
        <label>
          {copy.find}
          <input
            ref={input}
            type="search"
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
        </label>
        <button type="button" onClick={() => void refresh()}>
          {copy.refresh}
        </button>
      </div>
      <p>{copy.scope}</p>
      {busy ? (
        <p role="status">{copy.loading}</p>
      ) : failed ? (
        <p role="alert">{copy.failed}</p>
      ) : items.length === 0 ? (
        <p>
          {copy.empty}{' '}
          <a href={`/${locale}/data-foundation/explore`}>{copy.explore}</a>
        </p>
      ) : (
        <>
          {visible.length === 0 ? <p>{copy.noMatch}</p> : null}
          {text ? (
            <button
              type="button"
              onClick={() => {
                setText('');
                input.current?.focus();
              }}
            >
              {copy.clear}
            </button>
          ) : null}
          <ul className={styles.list}>
            {visible.map((item) => (
              <li key={item.viewId}>
                <a
                  href={`/${locale}/data-foundation/explore?saved=${encodeURIComponent(item.viewId)}`}
                  aria-label={`${item.title} · ${savedCopy[item.visibility]} · ${new Date(item.createdAt).toLocaleString(locale, { timeZone: 'UTC' })} UTC`}
                >
                  {item.title}
                </a>
                <span>{savedCopy[item.visibility]}</span>
                <time dateTime={item.createdAt}>
                  {new Date(item.createdAt).toLocaleString(locale, {
                    timeZone: 'UTC',
                  })}{' '}
                  UTC
                </time>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
