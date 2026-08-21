'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
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
  const [, markRefreshRequested] = useState(0);
  const inFlight = useRef(false);
  const observedPending = useRef(false);
  const refresh = useCallback(() => {
    if (inFlight.current || document.hidden) return;
    inFlight.current = true;
    observedPending.current = false;
    startTransition(() => {
      router.refresh();
      markRefreshRequested((current) => current + 1);
    });
  }, [router]);

  useEffect(() => {
    if (!inFlight.current) return;
    if (isPending) {
      observedPending.current = true;
      return;
    }
    if (!observedPending.current) return;
    inFlight.current = false;
    observedPending.current = false;
    setLastUpdated(new Date());
  }, [isPending]);

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = window.setInterval(() => {
      if (!document.hidden) refresh();
    }, 5_000);
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

  const refreshing = isPending || inFlight.current;

  return (
    <div className={className} aria-busy={refreshing}>
      <span data-testid="collaboration-refresh-status" aria-live="polite">
        {autoRefresh ? copy.autoRefresh : copy.referenceRefresh}
        {formattedTime === undefined
          ? ''
          : ` · ${copy.lastUpdated} ${formattedTime}`}
      </span>
      <button type="button" disabled={refreshing} onClick={refresh}>
        {refreshing ? copy.refreshing : copy.refreshAction}
      </button>
    </div>
  );
}
