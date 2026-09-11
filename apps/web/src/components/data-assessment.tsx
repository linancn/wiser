'use client';
import { useEffect, useRef, useState } from 'react';
import {
  AssessmentOutputSchema,
  ListAssessmentsOutputSchema,
  type Assessment,
  type IntakeDeclaration,
} from '@wiser/data-contracts';
import { getDictionary, type Locale } from '@/lib/i18n';
import styles from './data-reconciliation.module.css';

export function DataAssessment({
  locale,
  dataItemId,
  versionId,
  asset,
}: {
  readonly locale: Locale;
  readonly dataItemId: string;
  readonly versionId: string;
  readonly asset: { assetId: string; sourceHash: string } | null;
}) {
  const copy = getDictionary(locale).assessment;
  const [kind, setKind] = useState<IntakeDeclaration['kind']>('TABLE');
  const [reports, setReports] = useState<Assessment[] | null>(null);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false),
    [failed, setFailed] = useState(false);
  const pending = useRef<AbortController | null>(null);
  const command = useRef<{ body: string; key: string } | null>(null);
  useEffect(() => () => pending.current?.abort(), []);
  async function request(action: 'create' | 'list', body: unknown) {
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setFailed(false);
    const encoded = JSON.stringify(body);
    if (action === 'create' && command.current?.body !== encoded)
      command.current = { body: encoded, key: crypto.randomUUID() };
    try {
      const response = await fetch(
        `/api/data-foundation/assessment/${action}`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(action === 'create'
              ? { 'Idempotency-Key': command.current!.key }
              : {}),
          },
          body: encoded,
          signal: controller.signal,
          cache: 'no-store',
        },
      );
      if (!response.ok) {
        if ([401, 403, 404].includes(response.status)) {
          setReports(null);
          setCursor(undefined);
        }
        throw Error('unavailable');
      }
      const raw: unknown = await response.json();
      if (controller.signal.aborted) return;
      if (action === 'create') {
        const value = AssessmentOutputSchema.parse(raw);
        setReports([value.assessment]);
        setCursor(undefined);
        command.current = null;
      } else {
        const value = ListAssessmentsOutputSchema.parse(raw);
        setReports(value.items);
        setCursor(value.nextCursor);
      }
    } catch {
      if (!controller.signal.aborted) setFailed(true);
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  const select = (
    name: string,
    label: string,
    options: Record<string, string>,
    initial: string,
  ) => (
    <label>
      {label}
      <select name={name} defaultValue={initial}>
        {Object.entries(options).map(([key, value]) => (
          <option key={key} value={key}>
            {value}
          </option>
        ))}
      </select>
    </label>
  );
  const field = (name: string, label: string) => (
    <label>
      {label}
      <input name={name} maxLength={2000} />
    </label>
  );
  return (
    <details className={styles.frame}>
      <summary>{copy.title}</summary>
      <div className={styles.body}>
        <p>{copy.hint}</p>
        <p>{copy.scope}</p>
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            void request('list', { dataItemId, versionId, first: 25 })
          }
        >
          {copy.load}
        </button>
        {reports === null ? (
          <p>{copy.unknown}</p>
        ) : reports.length === 0 ? (
          <p>{copy.empty}</p>
        ) : (
          <section aria-label={copy.records}>
            {reports.map((report) => (
              <article key={report.assessmentId}>
                <dl className={styles.metrics}>
                  <div>
                    <dt>{copy.checkedAt}</dt>
                    <dd>
                      <time dateTime={report.createdAt}>
                        {new Date(report.createdAt).toLocaleString(locale, {
                          timeZone: 'UTC',
                        })}{' '}
                        UTC
                      </time>
                    </dd>
                  </div>
                  <div>
                    <dt>{copy.target}</dt>
                    <dd>{copy.targets[report.result.target]}</dd>
                  </div>
                  <div>
                    <dt>{copy.acquisition}</dt>
                    <dd>{copy.acquisitions[report.result.acquisition]}</dd>
                  </div>
                  <div>
                    <dt>{copy.coverage}</dt>
                    <dd>{copy.coverages[report.result.coverage]}</dd>
                  </div>
                  <div>
                    <dt>{copy.access}</dt>
                    <dd>{copy.accesses[report.result.access]}</dd>
                  </div>
                  {(Object.keys(copy.uses) as (keyof typeof copy.uses)[]).map(
                    (use) => (
                      <div key={use}>
                        <dt>{copy.uses[use]}</dt>
                        <dd>{copy.states[report.result.uses[use]]}</dd>
                      </div>
                    ),
                  )}
                </dl>
                <a
                  href={`/api/data-foundation/assets/${report.versionId}/${report.assetId}`}
                >
                  {getDictionary(locale).dataFoundation.content.download}
                </a>
                <p>{copy.position}</p>
                <p>
                  {copy.evidence}: {report.declaration.evidence}
                </p>
                {report.declaration.metadata.spatial ? (
                  <p>
                    {[
                      report.declaration.metadata.spatial.method,
                      report.declaration.metadata.spatial.resolution,
                      report.declaration.metadata.spatial.timeMeaning,
                      report.declaration.metadata.spatial.limitations,
                      report.declaration.metadata.spatial.evidence,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                ) : null}
                <ul>
                  {report.result.findings.map((finding, i) => (
                    <li key={i}>{copy.findings[finding.code]}</li>
                  ))}
                </ul>
                <p>
                  {copy.next}: {copy.actions[report.result.nextAction]}
                </p>
              </article>
            ))}
          </section>
        )}
        {cursor ? (
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void request('list', {
                dataItemId,
                versionId,
                first: 25,
                after: cursor,
              })
            }
          >
            {copy.more}
          </button>
        ) : null}
        {failed ? <p role="alert">{copy.failure}</p> : null}
        {!asset ? <p>{copy.missingAsset}</p> : null}
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!asset) return;
            const values = new FormData(event.currentTarget);
            const text = (name: string) => {
              const value = values.get(name);
              return typeof value === 'string' ? value.trim() : '';
            };
            const evidence = text('evidence');
            const metadata: IntakeDeclaration['metadata'] = {};
            for (const name of [
              'source',
              'authorization',
              'locator',
            ] as const) {
              if (text(name)) metadata[name] = text(name);
            }
            if (kind === 'TABLE') {
              if (text('keys'))
                metadata.businessKeys = text('keys')
                  .split(/[,，]/)
                  .map((s) => s.trim())
                  .filter(Boolean);
              if (text('timeField') && text('timeRole'))
                metadata.time = {
                  field: text('timeField'),
                  role: text('timeRole'),
                  evidence,
                };
              if (text('measure'))
                metadata.measures = [
                  {
                    field: text('measure'),
                    unit: text('unit') || null,
                    evidence,
                  },
                ];
            }
            if (kind === 'GIS' && text('limitations'))
              metadata.spatial = {
                method: text('method') || null,
                resolution: text('resolution') || null,
                timeMeaning: text('timeMeaning') || null,
                limitations: text('limitations'),
                evidence,
              };
            void request('create', {
              dataItemId,
              versionId,
              assetId: asset.assetId,
              declaration: {
                kind,
                target: text('target'),
                expectedSourceHash: asset.sourceHash,
                entry: text('entry'),
                access: text('access'),
                acquisition: text('acquisition'),
                coverage: text('coverage'),
                evidence,
                metadata,
              },
            });
          }}
        >
          <fieldset disabled={busy}>
            <legend>{copy.save}</legend>
            <div className={styles.columns}>
              <label>
                {copy.kind}
                <select
                  value={kind}
                  onChange={(event) =>
                    setKind(event.target.value as IntakeDeclaration['kind'])
                  }
                >
                  {Object.entries(copy.kinds).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              {select('target', copy.target, copy.targets, 'DOWNLOAD_FILE')}
              {select('entry', copy.entry, copy.entries, 'UNCHECKED')}
              {select('access', copy.access, copy.accesses, 'UNKNOWN')}
              {select(
                'acquisition',
                copy.acquisition,
                copy.acquisitions,
                'REGISTERED_ONLY',
              )}
              {select('coverage', copy.coverage, copy.coverages, 'UNKNOWN')}
              {field('source', copy.source)}
              {field('authorization', copy.authorization)}
              {field('locator', copy.locator)}
              {kind === 'TABLE' ? (
                <>
                  {field('keys', copy.keys)}
                  {field('timeField', copy.timeField)}
                  {field('timeRole', copy.timeRole)}
                  {field('measure', copy.measure)}
                  {field('unit', copy.unit)}
                </>
              ) : null}
              {kind === 'GIS' ? (
                <>
                  {field('method', copy.method)}
                  {field('resolution', copy.resolution)}
                  {field('timeMeaning', copy.timeMeaning)}
                  {field('limitations', copy.limitations)}
                </>
              ) : null}
            </div>
            <label>
              {copy.evidence}
              <textarea name="evidence" required maxLength={2000} />
            </label>
            <button type="submit" disabled={!asset || busy}>
              {busy ? copy.busy : copy.save}
            </button>
          </fieldset>
        </form>
      </div>
    </details>
  );
}
