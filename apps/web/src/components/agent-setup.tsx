'use client';

import { useState } from 'react';
import type { Dictionary } from '@/lib/i18n';
import styles from './agent-setup.module.css';

function publicSetupUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== '/agent-setup/prompt.md'
    )
      return null;
    return url.protocol === 'https:' ||
      (url.protocol === 'http:' &&
        ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
      ? url.href
      : null;
  } catch {
    return null;
  }
}

export function AgentSetup({
  copy,
  setupUrl,
}: {
  readonly copy: Dictionary['agentSetup'];
  readonly setupUrl: string;
}) {
  const [state, setState] = useState<'idle' | 'copied' | 'manual'>('idle');
  const url = publicSetupUrl(setupUrl);
  const prompt = url === null ? '' : copy.promptPrefix + url;
  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(prompt);
      setState('copied');
    } catch {
      setState('manual');
    }
  }
  return (
    <div className={styles.entry}>
      <button
        className={styles.action}
        type="button"
        disabled={url === null}
        onClick={() => void copyPrompt()}
      >
        <span aria-hidden="true">✦</span> {copy.action}
      </button>
      <p aria-live="polite">
        {url === null
          ? copy.unavailable
          : state === 'copied'
            ? copy.copied
            : state === 'manual'
              ? copy.manual
              : copy.hint}
      </p>
      {state === 'manual' && (
        <textarea
          aria-label={copy.textLabel}
          readOnly
          rows={4}
          value={prompt}
          onFocus={(event) => event.currentTarget.select()}
        />
      )}
    </div>
  );
}
