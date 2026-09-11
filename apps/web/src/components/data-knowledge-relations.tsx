'use client';
import Link from 'next/link';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  ImportRelationsInputSchema,
  ImportRelationsOutputSchema,
  RelationListOutputSchema,
  RelationOutputSchema,
  type RelationAssertion,
} from '@wiser/data-contracts';
import { getDictionary, type Locale } from '@/lib/i18n';
import { KnowledgeGraphCanvas } from './data-foundation-graph';
import styles from './data-reconciliation.module.css';

export function DataKnowledgeRelations({
  locale,
  dataItemId,
  versionId,
}: {
  readonly locale: Locale;
  readonly dataItemId: string;
  readonly versionId: string;
}) {
  const statusId = useId();
  const dict = getDictionary(locale),
    copy = dict.knowledgeRelations,
    common = dict.assessment;
  const [status, setStatus] = useState<RelationAssertion['status']>('APPROVED');
  const [page, setPage] = useState<ReturnType<
    typeof RelationListOutputSchema.parse
  > | null>(null);
  const [entity, setEntity] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [failed, setFailed] = useState(false),
    [message, setMessage] = useState('');
  const [payload, setPayload] = useState<unknown>(null),
    [notes, setNotes] = useState<Record<string, string>>({});
  const requests = useRef<AbortController | null>(null),
    keys = useRef(new Map<string, string>());
  useEffect(() => () => requests.current?.abort(), []);
  const graph = useMemo(
    () => ({
      nodes: [
        ...new Map(
          (page?.items ?? [])
            .flatMap((r) =>
              [r.candidate.subject, r.candidate.object].map((e) => ({
                key: JSON.stringify([r.mappingVersion, e.key]),
                label: e.label,
              })),
            )
            .map((e) => [e.key, { entityId: e.key, label: e.label }]),
        ).values(),
      ],
      edges: (page?.items ?? []).map((r) => ({
        edgeId: r.assertionId,
        fromEntityId: JSON.stringify([
          r.mappingVersion,
          r.candidate.subject.key,
        ]),
        toEntityId: JSON.stringify([r.mappingVersion, r.candidate.object.key]),
        label: copy.predicates[r.candidate.predicate],
      })),
    }),
    [page, copy.predicates],
  );
  async function request(action: string, input: unknown, command = false) {
    requests.current?.abort();
    const controller = new AbortController();
    requests.current = controller;
    setBusy(true);
    setFailed(false);
    setMessage('');
    const identity = JSON.stringify([action, input]);
    let key = keys.current.get(identity);
    if (command && !key) {
      key = crypto.randomUUID();
      keys.current.set(identity, key);
    }
    try {
      const response = await fetch(`/api/data-foundation/relations/${action}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(key ? { 'Idempotency-Key': key } : {}),
        },
        body: JSON.stringify(input),
        signal: controller.signal,
        cache: 'no-store',
      });
      if (!response.ok) {
        if ([401, 403, 404].includes(response.status)) setPage(null);
        throw Error('unavailable');
      }
      const value: unknown = await response.json();
      if (controller.signal.aborted) return null;
      const schema =
        action === 'import'
          ? ImportRelationsOutputSchema
          : action === 'list'
            ? RelationListOutputSchema
            : RelationOutputSchema;
      const parsed = schema.parse(value);
      if (command) keys.current.delete(identity);
      return parsed;
    } catch {
      if (!controller.signal.aborted) setFailed(true);
      return null;
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  const fileRead = useRef(0);
  async function chooseFile(file: File | undefined) {
    const generation = ++fileRead.current;
    setPayload(null);
    if (!file) return;
    try {
      if (file.size > 262144) throw Error();
      const input = ImportRelationsInputSchema.parse(
        JSON.parse(await file.text()),
      );
      if (input.dataItemId !== dataItemId || input.versionId !== versionId)
        throw Error();
      if (generation === fileRead.current) {
        setPayload(input);
        setMessage('');
      }
    } catch {
      if (generation === fileRead.current) setMessage(copy.badFile);
    }
  }
  async function load(selected: string | null = entity, after?: string) {
    const pair: unknown = selected ? JSON.parse(selected) : null;
    const filter =
      Array.isArray(pair) &&
      typeof pair[0] === 'string' &&
      typeof pair[1] === 'string'
        ? { mappingVersion: pair[0], entityKey: pair[1] }
        : {};
    const value = await request('list', {
      dataItemId,
      versionId,
      status,
      first: 25,
      ...filter,
      ...(after ? { after } : {}),
    });
    if (value) {
      const parsed = RelationListOutputSchema.safeParse(value);
      if (parsed.success) {
        setPage(parsed.data);
        setEntity(selected);
      } else {
        setPage(null);
        setFailed(true);
      }
    }
  }
  async function review(
    row: RelationAssertion,
    decision: 'APPROVED' | 'REJECTED' | 'CORRECTION_REQUIRED',
  ) {
    const value = await request(
      'review',
      {
        assertionId: row.assertionId,
        expectedVersion: row.version,
        decision,
        rationale: notes[row.assertionId]?.trim(),
      },
      true,
    );
    if (value) {
      const parsed = RelationOutputSchema.safeParse(value);
      if (parsed.success) {
        setPage(null);
        setMessage(copy.reviewed);
      } else setFailed(true);
    }
  }
  return (
    <details className={styles.frame}>
      <summary>{copy.title}</summary>
      <div className={styles.body}>
        <p>{copy.hint}</p>
        <label htmlFor={statusId}>{copy.status}</label>
        <select
          id={statusId}
          value={status}
          disabled={busy}
          onChange={(e) => {
            setStatus(e.target.value as RelationAssertion['status']);
            setPage(null);
            setEntity(null);
          }}
        >
          {Object.entries(copy.statuses).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
        <button type="button" disabled={busy} onClick={() => void load()}>
          {busy ? common.busy : copy.load}
        </button>
        {entity ? (
          <button type="button" disabled={busy} onClick={() => void load(null)}>
            {copy.all}
          </button>
        ) : null}
        {failed ? <p role="alert">{common.failure}</p> : null}
        {message ? <p role="status">{message}</p> : null}
        {page ? (
          <>
            <p>
              {copy.count}
              {page.totalCount}
            </p>
            <p>
              {status === 'APPROVED' ? copy.approvedHint : copy.candidateHint}
            </p>
            {page.items.length === 0 ? <p>{copy.empty}</p> : null}
            {status === 'APPROVED' && page.items.length > 0 ? (
              <KnowledgeGraphCanvas
                result={graph}
                selectedId={entity}
                onSelect={(id) => {
                  if (!busy) void load(id);
                }}
                locale={locale}
              />
            ) : null}
            {page.items.map((row) => (
              <article key={row.assertionId}>
                <h3>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void load(
                        JSON.stringify([
                          row.mappingVersion,
                          row.candidate.subject.key,
                        ]),
                      )
                    }
                  >
                    {row.candidate.subject.label}
                  </button>
                  {' → '}
                  {copy.predicates[row.candidate.predicate]}
                  {' → '}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void load(
                        JSON.stringify([
                          row.mappingVersion,
                          row.candidate.object.key,
                        ]),
                      )
                    }
                  >
                    {row.candidate.object.label}
                  </button>
                </h3>
                <p>{copy.statuses[row.status]}</p>
                <dl className={styles.metrics}>
                  {[
                    [
                      copy.method,
                      copy.methods[row.candidate.generation.method],
                    ],
                    [copy.measure, row.candidate.qualifiers.measure],
                    [copy.unit, row.candidate.qualifiers.unit],
                    [copy.value, row.candidate.qualifiers.reportedValue],
                    [copy.limit, row.candidate.qualifiers.reportedLimit],
                    [copy.time, row.candidate.qualifiers.observedAt],
                    [copy.spatialScope, row.candidate.qualifiers.spatialScope],
                    [
                      copy.conclusion,
                      row.candidate.qualifiers.reportedConclusion,
                    ],
                    [copy.external, row.candidate.object.externalId],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <dt>{label}</dt>
                      <dd>{value ?? copy.unknown}</dd>
                    </div>
                  ))}
                </dl>
                {row.candidate.qualifiers.missing ? (
                  <p>{copy.missing}</p>
                ) : null}
                {row.candidate.qualifiers.limitations.length > 0 ? (
                  <p>
                    {copy.limits}:{' '}
                    {row.candidate.qualifiers.limitations.join(' / ')}
                  </p>
                ) : null}
                <h4>{copy.evidence}</h4>
                {row.candidate.evidence.map((e, i) => (
                  <div key={i}>
                    <p>
                      {copy.polarities[e.polarity]} · {e.locator}
                    </p>
                    {e.excerpt ? <blockquote>{e.excerpt}</blockquote> : null}
                    <Link
                      href={`/api/data-foundation/assets/${row.versionId}/${e.assetId}`}
                    >
                      {copy.original}
                    </Link>
                  </div>
                ))}
                {row.candidate.supersedesId ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void request('get', {
                        assertionId: row.candidate.supersedesId,
                      }).then((v) => {
                        const p = RelationOutputSchema.safeParse(v);
                        if (p.success) {
                          setStatus(p.data.assertion.status);
                          setPage({ items: [p.data.assertion], totalCount: 1 });
                        }
                      })
                    }
                  >
                    {copy.supersedes}
                  </button>
                ) : null}
                <details>
                  <summary>{copy.history}</summary>
                  {row.reviews.map((r) => (
                    <p key={r.reviewId}>
                      {copy.statuses[r.decision]} ·{' '}
                      <time dateTime={r.createdAt}>{r.createdAt}</time> ·{' '}
                      {r.rationale}
                    </p>
                  ))}
                </details>
                <p>{copy.reviewHint}</p>
                <label>
                  {copy.note}
                  <textarea
                    value={notes[row.assertionId] ?? ''}
                    maxLength={1024}
                    disabled={busy}
                    onChange={(e) =>
                      setNotes((old) => ({
                        ...old,
                        [row.assertionId]: e.target.value,
                      }))
                    }
                  />
                </label>
                <div className={styles.actions}>
                  {(
                    [
                      ['APPROVED', copy.approve],
                      ['CORRECTION_REQUIRED', copy.correct],
                      ['REJECTED', copy.reject],
                    ] as const
                  ).map(([decision, label]) => (
                    <button
                      key={decision}
                      type="button"
                      disabled={busy || !notes[row.assertionId]?.trim()}
                      onClick={() => void review(row, decision)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </article>
            ))}
            {page.nextCursor ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void load(entity, page.nextCursor)}
              >
                {copy.more}
              </button>
            ) : null}
          </>
        ) : null}
        <details>
          <summary>{copy.importTitle}</summary>
          <p>{copy.importHint}</p>
          <label>
            {copy.file}
            <input
              type="file"
              accept="application/json,.json"
              disabled={busy}
              onChange={(e) => {
                void chooseFile(e.target.files?.[0]);
              }}
            />
          </label>
          <button
            type="button"
            disabled={busy || !payload}
            onClick={() =>
              void request('import', payload, true).then((v) => {
                if (v) {
                  setPayload(null);
                  setPage(null);
                  setMessage(copy.imported);
                }
              })
            }
          >
            {copy.importAction}
          </button>
        </details>
      </div>
    </details>
  );
}
