'use client';
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { getDictionary, type Locale } from '@/lib/i18n';
import styles from './data-explorer.module.css';
export function DataExplorerInspector({
  locale,
  selectionKey,
  children,
}: {
  readonly locale: Locale;
  readonly selectionKey: string | null;
  readonly children: ReactNode;
}) {
  const copy = getDictionary(locale).dataFoundation.explorer;
  const [expanded, setExpanded] = useState(false);
  const panel = useRef<HTMLElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (
      selectionKey === null &&
      expanded &&
      window.matchMedia('(max-width: 900px)').matches &&
      (panel.current?.contains(document.activeElement) ||
        document.activeElement === document.body)
    ) {
      panel.current
        ?.closest('main')
        ?.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]')
        ?.focus();
    }
    setExpanded(false);
  }, [selectionKey]);
  useEffect(() => {
    if (expanded && window.matchMedia('(max-width: 900px)').matches)
      panel.current?.focus();
  }, [expanded]);
  function collapseOnEscape(event: KeyboardEvent<HTMLElement>) {
    if (
      event.key === 'Escape' &&
      expanded &&
      window.matchMedia('(max-width: 900px)').matches
    ) {
      event.preventDefault();
      event.stopPropagation();
      setExpanded(false);
      toggle.current?.focus();
    }
  }
  return (
    <>
      <aside
        ref={panel}
        id="explorer-inspector-panel"
        className={`${styles.inspector} ${styles.responsiveInspector}`}
        data-testid="explorer-inspector"
        data-expanded={expanded}
        data-has-selection={selectionKey !== null}
        aria-label={copy.details}
        tabIndex={-1}
        onKeyDown={collapseOnEscape}
      >
        {children}
      </aside>
      {selectionKey !== null ? (
        <button
          ref={toggle}
          className={styles.inspectorToggle}
          aria-controls="explorer-inspector-panel"
          aria-expanded={expanded}
          onKeyDown={collapseOnEscape}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? copy.collapseDetails : copy.inspectSelection}
        </button>
      ) : null}
    </>
  );
}
