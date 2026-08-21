'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useTransition,
} from 'react';
import { useRouter } from 'next/navigation';

import { getDictionary, type Locale } from '@/lib/i18n';

export function RunLiveRefresh({
  autoRefresh,
  className,
  locale,
}: {
  readonly autoRefresh: boolean;
  readonly className?: string;
  readonly locale: Locale;
}) {
  const router = useRouter();
  const copy = getDictionary(locale).collaboration;
  const [lastUpdated, setLastUpdated] = useState<Date>();
  const [isPending, startTransition] = useTransition();
  const refresh = useCallback(() => {
    startTransition(() => router.refresh());
    setLastUpdated(new Date());
  }, [router]);

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = window.setInterval(() => {
      if (!document.hidden) refresh();
    }, 3_000);
    const onVisibilityChange = () => {
      if (!document.hidden) refresh();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [autoRefresh, refresh]);

  const formattedTime = useMemo(
    () =>
      lastUpdated?.toLocaleTimeString(locale, {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }),
    [lastUpdated, locale],
  );

  return (
    <div className={className} aria-busy={isPending}>
      <span data-testid="collaboration-refresh-status" aria-live="polite">
        {autoRefresh ? copy.autoRefresh : copy.referenceRefresh}
        {formattedTime === undefined
          ? ''
          : ` · ${copy.lastUpdated} ${formattedTime}`}
      </span>
      <button type="button" disabled={isPending} onClick={refresh}>
        {isPending ? copy.refreshing : copy.refreshAction}
      </button>
    </div>
  );
}
