'use client';
import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type HTMLAttributes,
} from 'react';
import { getDictionary, type Locale } from '@/lib/i18n';
import styles from './exploration-workspace.module.css';

/** Expand in place: graph/map components and their reading state remain mounted. */
export function ExplorationWorkspace({
  children,
  locale,
  className,
  ...attributes
}: HTMLAttributes<HTMLElement> & {
  children: ReactNode;
  locale: Locale;
}) {
  const copy = getDictionary(locale).dataFoundation.explorer;
  const [expanded, setExpanded] = useState(false);
  const panel = useRef<HTMLElement>(null),
    toggle = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!expanded || !panel.current) return;
    const element = panel.current,
      previousOverflow = document.body.style.overflow;
    const top = element.scrollTop,
      left = element.scrollLeft;
    const inert: HTMLElement[] = [];
    let current: HTMLElement | null = element;
    while (current && current !== document.body) {
      for (const sibling of current.parentElement?.children ?? []) {
        if (
          sibling !== current &&
          sibling instanceof HTMLElement &&
          !sibling.hasAttribute('inert')
        ) {
          sibling.setAttribute('inert', '');
          inert.push(sibling);
        }
      }
      current = current.parentElement;
    }
    document.body.style.overflow = 'hidden';
    toggle.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      for (const sibling of inert) sibling.removeAttribute('inert');
      element.scrollTop = top;
      element.scrollLeft = left;
      toggle.current?.focus({ preventScroll: true });
    };
  }, [expanded]);
  return (
    <main
      {...attributes}
      ref={panel}
      className={`${expanded ? styles.expanded : styles.workspace} ${className ?? ''}`}
      role={expanded ? 'dialog' : undefined}
      aria-modal={expanded ? true : undefined}
      aria-label={copy.title}
      onKeyDownCapture={(event) => {
        if (expanded && event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          setExpanded(false);
        }
      }}
      onKeyDown={(event) => {
        if (!expanded) return;
        if (event.key === 'Escape') {
          event.preventDefault();
          setExpanded(false);
          return;
        }
        if (event.key !== 'Tab') return;
        const focusable = [
          ...event.currentTarget.querySelectorAll<HTMLElement>(
            'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex="0"]',
          ),
        ].filter(
          (el) =>
            !el.closest('[inert], [hidden]') &&
            (!el.closest('details:not([open])') || el.tagName === 'SUMMARY') &&
            el.getAttribute('aria-hidden') !== 'true',
        );
        const first = focusable[0],
          last = focusable.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }}
    >
      <div className={styles.toolbar}>
        <button
          ref={toggle}
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? copy.exitWorkspace : copy.expandWorkspace}
        </button>
        {expanded ? <span>{copy.workspaceEscape}</span> : null}
      </div>
      {children}
    </main>
  );
}
