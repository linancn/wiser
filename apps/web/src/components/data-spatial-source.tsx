'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ListAssessmentsOutputSchema,
  type Assessment,
} from '@wiser/data-contracts';
import { getDictionary, type Locale } from '@/lib/i18n';
import styles from './data-reconciliation.module.css';

export function DataSpatialSource(props: {
  readonly locale: Locale;
  readonly dataItemId: string;
  readonly versionId: string;
  readonly assetId?: string;
  readonly geometryAvailable?: boolean;
}) {
  // A different source mounts an independent request state even when the enclosing selection reuses its component.
  return (
    <SourceDescription
      key={`${props.versionId}:${props.assetId ?? ''}`}
      {...props}
    />
  );
}
function SourceDescription({
  locale,
  dataItemId,
  versionId,
  assetId,
  geometryAvailable,
}: Parameters<typeof DataSpatialSource>[0]) {
  const copy = getDictionary(locale).spatialSource;
  const [reports, setReports] = useState<Assessment[] | null>(null);
  const [cursor, setCursor] = useState<string>();
  const [busy, setBusy] = useState(false),
    [failed, setFailed] = useState(false);
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);
  async function load(after?: string) {
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setFailed(false);
    setReports(null);
    try {
      const response = await fetch('/api/data-foundation/assessment/list', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        cache: 'no-store',
        signal: controller.signal,
        body: JSON.stringify({
          dataItemId,
          versionId,
          ...(assetId ? { assetId } : {}),
          latestPerAsset: true,
          first: 25,
          ...(after ? { after } : {}),
        }),
      });
      if (!response.ok) throw Error('unavailable');
      const result = ListAssessmentsOutputSchema.parse(await response.json());
      if (
        result.items.some(
          (r) =>
            r.dataItemId !== dataItemId ||
            r.versionId !== versionId ||
            (assetId && r.assetId !== assetId),
        )
      )
        throw Error('scope');
      if (controller.signal.aborted) return;
      setReports(result.items);
      setCursor(result.nextCursor);
    } catch {
      if (!controller.signal.aborted) {
        setFailed(true);
        setCursor(undefined);
      }
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  return (
    <section className={styles.frame} aria-label={copy.title}>
      <h3>{copy.title}</h3>
      <p>{copy.scaleWarning}</p>
      <details
        onToggle={(event) => {
          if (event.currentTarget.open && reports === null && !busy && !failed)
            void load();
        }}
      >
        <summary>{copy.load}</summary>
        <div className={styles.body}>
          <p>{copy.scope}</p>
          <dl className={styles.metrics}>
            <dt>{copy.geometry}</dt>
            <dd>
              {geometryAvailable ? copy.geometryReady : copy.geometryUnknown}
            </dd>
            <dt>{copy.rendering}</dt>
            <dd>{copy.renderingNote}</dd>
            <dt>{copy.position}</dt>
            <dd>{copy.unchecked}</dd>
            <dt>{copy.business}</dt>
            <dd>{copy.businessNote}</dd>
          </dl>
          {busy ? <p role="status">{copy.busy}</p> : null}
          {failed ? (
            <p role="alert">
              {copy.failed}{' '}
              <button onClick={() => void load()}>{copy.retry}</button>
            </p>
          ) : null}
          {reports?.length === 0 ? <p>{copy.empty}</p> : null}
          {reports?.map((report) => {
            const stale = report.result.findings.some(
              (f) => f.code === 'SOURCE_CHANGED',
            );
            const metadata = stale ? undefined : report.declaration.metadata;
            const fields = [
              [copy.source, metadata?.source],
              [copy.method, metadata?.spatial?.method],
              [copy.resolution, metadata?.spatial?.resolution],
              [
                copy.time,
                metadata?.spatial?.timeMeaning ?? metadata?.time?.role,
              ],
              [copy.limits, metadata?.spatial?.limitations],
              [copy.evidence, metadata?.spatial?.evidence],
            ];
            return (
              <article key={report.assessmentId}>
                <a
                  href={`/api/data-foundation/assets/${versionId}/${report.assetId}`}
                >
                  {copy.original}
                </a>
                {stale ? <p>{copy.stale}</p> : null}
                <dl className={styles.metrics}>
                  {fields.map(([label, value]) => (
                    <div key={label}>
                      <dt>{label}</dt>
                      <dd>{value ?? copy.unknown}</dd>
                    </div>
                  ))}
                </dl>
              </article>
            );
          })}
          {cursor && !busy ? (
            <button onClick={() => void load(cursor)}>{copy.more}</button>
          ) : null}
          <p>{copy.roles}</p>
          <Link
            href={`/${locale}/data-foundation/catalog/${dataItemId}?version=${versionId}`}
          >
            {copy.details}
          </Link>
        </div>
      </details>
    </section>
  );
}
