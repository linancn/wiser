'use client';
import { useState, type ComponentProps } from 'react';
import dynamic from 'next/dynamic';
import { getDictionary } from '@/lib/i18n';
import styles from './data-explorer.module.css';
const Statistics = dynamic(
  () =>
    import('./data-explorer-statistics').then(
      (module) => module.DataExplorerStatistics,
    ),
  { ssr: false },
);
export function DataExplorerReadiness({
  initiallyOpen,
  ...props
}: ComponentProps<typeof Statistics> & { readonly initiallyOpen: boolean }) {
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <details
      className={styles.readinessSection}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        {getDictionary(props.locale).dataFoundation.explorer.readinessOverview}
      </summary>
      {open ? <Statistics {...props} /> : null}
    </details>
  );
}
