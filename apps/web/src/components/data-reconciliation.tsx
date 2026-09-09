'use client';
import { useEffect, useRef, useState } from 'react';
import {
  CreateReconciliationInputSchema,
  CreateReconciliationOutputSchema,
  GetReconciliationOutputSchema,
  ListReconciliationsOutputSchema,
  ExplorationResultSchema,
  type ExplorationResult,
  type ReconciliationPlan,
  type ReconciliationBatch,
  type GetReconciliationOutput,
} from '@wiser/data-contracts';
import { getDictionary, type Locale } from '@/lib/i18n';
import {
  assetContentHref,
  sourceFilename,
} from '@/lib/data-content-presentation';
import styles from './data-reconciliation.module.css';

const blankPlan = (): ReconciliationPlan => ({
  keys: [
    { name: '', leftField: '', rightField: '', type: 'text', trim: false },
  ],
  left: { valueField: '', measure: { literal: '' }, unit: { literal: '' } },
  right: { valueField: '', measure: { literal: '' }, unit: { literal: '' } },
  unitConversions: [],
  conflictPolicy: 'preserve',
});
export function DataReconciliation({
  locale,
  dataItemId,
  versionId,
  queryId,
  assets,
  initialAnalysisId,
}: {
  readonly locale: Locale;
  readonly dataItemId: string;
  readonly versionId: string;
  readonly queryId?: string;
  readonly assets: NonNullable<ExplorationResult['assets']>;
  readonly initialAnalysisId?: string;
}) {
  const copy = getDictionary(locale).dataFoundation.explorer.reconciliation;
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const [leftId, setLeftId] = useState(''),
    [rightId, setRightId] = useState(''),
    [analysisId, setAnalysisId] = useState(initialAnalysisId);
  const [title, setTitle] = useState(''),
    [plan, setPlan] = useState(blankPlan),
    [ack, setAck] = useState(false);
  const [history, setHistory] = useState<ReconciliationBatch[]>([]),
    [result, setResult] = useState<GetReconciliationOutput | null>(null);
  const [members, setMembers] = useState<GetReconciliationOutput | null>(null),
    [groupIndex, setGroupIndex] = useState<number | null>(null);
  const [note, setNote] = useState(''),
    [reviewAck, setReviewAck] = useState(false);
  const pending = useRef<AbortController | null>(null);
  const commandKeys = useRef(new Map<string, string>());
  const accessGeneration = useRef(0);
  const candidates = assets.filter(
    (a) =>
      ['READY', 'EMPTY'].includes(a.status) &&
      a.paths.some((p) => /\.(csv|xlsx|xls)$/i.test(p)),
  );
  async function call(action: string, input: unknown, signal: AbortSignal) {
    const generation = accessGeneration.current;
    let key: string | undefined;
    if (action === 'create' || action === 'review') {
      const binding = JSON.stringify([action, input]);
      key = commandKeys.current.get(binding) ?? crypto.randomUUID();
      commandKeys.current.set(binding, key);
    }
    const response = await fetch(
      `/api/data-foundation/reconciliation/${action}`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(key ? { 'Idempotency-Key': key } : {}),
        },
        body: JSON.stringify(input),
        signal,
        cache: 'no-store',
      },
    );
    if (generation !== accessGeneration.current)
      throw Error('Stale authorization');
    if (!signal.aborted && [401, 403, 404].includes(response.status)) {
      accessGeneration.current++;
      setResult(null);
      setMembers(null);
      setHistory([]);
    }
    if (!response.ok) throw Error('Reconciliation unavailable');
    return response.json() as Promise<unknown>;
  }
  useEffect(() => () => pending.current?.abort(), []);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const list = ListReconciliationsOutputSchema.parse(
          await call('list', { versionId }, controller.signal),
        );
        if (!controller.signal.aborted) setHistory(list.items);
        if (!initialAnalysisId && queryId) {
          const response = await fetch('/api/data-foundation/explore', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ queryId, view: 'resources', first: 200 }),
            signal: controller.signal,
          });
          if (!response.ok) throw Error('Source unavailable');
          const value = ExplorationResultSchema.parse(await response.json());
          if (!controller.signal.aborted)
            setAnalysisId(
              value.resources.find((r) => r.versionId === versionId)?.analysis
                ?.analysisId,
            );
        }
      } catch {
        if (!controller.signal.aborted) setError(copy.error);
      }
    })();
    return () => controller.abort();
  }, [open, versionId, queryId, initialAnalysisId, copy.error]);
  function edit(next: ReconciliationPlan) {
    setPlan(next);
    setAck(false);
  }
  async function run(
    work: (signal: AbortSignal) => Promise<void>,
    message = copy.error,
  ) {
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setError(null);
    try {
      await work(controller.signal);
    } catch {
      if (!controller.signal.aborted) setError(message);
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  async function load(batchId: string, signal: AbortSignal, after?: string) {
    const value = GetReconciliationOutputSchema.parse(
      await call('get', { batchId, ...(after ? { after } : {}) }, signal),
    );
    if (signal.aborted) return;
    setResult(value);
    setMembers(null);
    setGroupIndex(null);
    setReviewAck(false);
    setNote('');
  }
  const batch = result?.batch;
  const state = (value: ReconciliationBatch) =>
    copy[
      value.status === 'VERIFIED'
        ? 'verified'
        : value.status === 'REJECTED'
          ? 'rejected'
          : 'candidate'
    ];
  const relation = batch
    ? copy[
        batch.summary.relation === 'FORMAT_COPY_CANDIDATE'
          ? batch.status === 'VERIFIED'
            ? 'copyVerified'
            : 'copyCandidate'
          : batch.summary.relation === 'OVERLAP'
            ? 'overlap'
            : batch.summary.relation === 'REVISION'
              ? 'revisionRelation'
              : batch.summary.relation === 'DISJOINT'
                ? 'disjoint'
                : 'unresolved'
      ]
    : '';
  function fields(
    side: 'left' | 'right',
    value: string,
    onChange: (value: string) => void,
    label: string,
  ) {
    const asset = assets.find(
      (a) => a.assetId === (side === 'left' ? leftId : rightId),
    );
    return (
      <label>
        {label}
        <select
          required
          value={value}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">{copy.choose}</option>
          {asset?.columns.map((c) => (
            <option key={c.key} value={c.key}>
              {c.label} ({c.key})
            </option>
          ))}
        </select>
      </label>
    );
  }
  function binding(side: 'left' | 'right', dimension: 'measure' | 'unit') {
    const value = plan[side][dimension];
    const update = (v: typeof value) =>
      edit({ ...plan, [side]: { ...plan[side], [dimension]: v } });
    return (
      <fieldset>
        <legend>{copy[dimension]}</legend>
        <label>
          {copy.bindingMode}
          <select
            value={'field' in value ? 'field' : 'literal'}
            onChange={(e) =>
              update(
                e.target.value === 'field' ? { field: '' } : { literal: '' },
              )
            }
          >
            <option value="literal">{copy.constant}</option>
            <option value="field">{copy.field}</option>
          </select>
        </label>
        {'field' in value ? (
          fields(side, value.field, (field) => update({ field }), copy.field)
        ) : (
          <label>
            {copy.constant}
            <input
              required
              maxLength={256}
              value={value.literal}
              onChange={(e) => update({ literal: e.target.value })}
            />
          </label>
        )}
      </fieldset>
    );
  }
  return (
    <details
      className={styles.frame}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary>
        {copy.title}
        {batch ? ` · ${state(batch)}` : ''}
      </summary>
      {open ? (
        <div className={styles.body}>
          <p>{copy.intro}</p>
          <p>{copy.limits}</p>
          {error ? <p role="alert">{error}</p> : null}
          {history.length ? (
            <section>
              <h3>{copy.history}</h3>
              <ul>
                {history.map((item) => (
                  <li key={item.batchId}>
                    <button
                      disabled={busy}
                      onClick={() =>
                        void run((signal) => load(item.batchId, signal))
                      }
                    >
                      {item.title} · {state(item)}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {candidates.length < 2 ? (
            <p>{copy.noSources}</p>
          ) : (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void run(async (signal) => {
                  const input = CreateReconciliationInputSchema.parse({
                    title,
                    left: {
                      dataItemId,
                      versionId,
                      analysisId,
                      assetId: leftId,
                    },
                    right: {
                      dataItemId,
                      versionId,
                      analysisId,
                      assetId: rightId,
                    },
                    plan,
                  });
                  const created = CreateReconciliationOutputSchema.parse(
                    await call('create', input, signal),
                  );
                  if (signal.aborted) return;
                  setHistory((old) => [created.batch, ...old]);
                  await load(created.batch.batchId, signal);
                });
              }}
            >
              <fieldset disabled={busy}>
                <label>
                  {copy.batchTitle}
                  <input
                    required
                    maxLength={160}
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                  />
                </label>
                <div className={styles.columns}>
                  {(['left', 'right'] as const).map((side) => (
                    <fieldset key={side}>
                      <legend>{copy[side]}</legend>
                      <label>
                        {copy[side]}
                        <select
                          required
                          value={side === 'left' ? leftId : rightId}
                          onChange={(e) => {
                            (side === 'left' ? setLeftId : setRightId)(
                              e.target.value,
                            );
                            setAck(false);
                          }}
                        >
                          <option value="">{copy.choose}</option>
                          {candidates.map((a) => (
                            <option
                              key={a.assetId}
                              value={a.assetId}
                              disabled={
                                a.assetId ===
                                (side === 'left' ? rightId : leftId)
                              }
                            >
                              {sourceFilename(a, a.assetId)}
                            </option>
                          ))}
                        </select>
                      </label>
                      {fields(
                        side,
                        plan[side].valueField,
                        (valueField) =>
                          edit({
                            ...plan,
                            [side]: { ...plan[side], valueField },
                          }),
                        copy.value,
                      )}
                      {binding(side, 'measure')}
                      {binding(side, 'unit')}
                    </fieldset>
                  ))}
                </div>
                <fieldset>
                  <legend>{copy.keys}</legend>
                  {plan.keys.map((key, index) => (
                    <div className={styles.key} key={index}>
                      <label>
                        {copy.keyName}
                        <input
                          required
                          maxLength={256}
                          value={key.name}
                          onChange={(e) =>
                            edit({
                              ...plan,
                              keys: plan.keys.map((k, i) =>
                                i === index
                                  ? { ...k, name: e.target.value }
                                  : k,
                              ),
                            })
                          }
                        />
                      </label>
                      {(['left', 'right'] as const).map((side) => (
                        <div key={side}>
                          {fields(
                            side,
                            side === 'left' ? key.leftField : key.rightField,
                            (value) =>
                              edit({
                                ...plan,
                                keys: plan.keys.map((k, i) =>
                                  i === index
                                    ? {
                                        ...k,
                                        [side === 'left'
                                          ? 'leftField'
                                          : 'rightField']: value,
                                      }
                                    : k,
                                ),
                              }),
                            copy[side === 'left' ? 'leftField' : 'rightField'],
                          )}
                        </div>
                      ))}
                      <label>
                        {copy.keyType}
                        <select
                          value={key.type}
                          onChange={(e) =>
                            edit({
                              ...plan,
                              keys: plan.keys.map((k, i) =>
                                i === index
                                  ? {
                                      ...k,
                                      type: e.target.value as typeof k.type,
                                    }
                                  : k,
                              ),
                            })
                          }
                        >
                          <option value="text">{copy.text}</option>
                          <option value="decimal">{copy.decimal}</option>
                          <option value="iso-time">{copy.time}</option>
                        </select>
                      </label>
                      <label className={styles.check}>
                        <input
                          type="checkbox"
                          checked={key.trim}
                          onChange={(e) =>
                            edit({
                              ...plan,
                              keys: plan.keys.map((k, i) =>
                                i === index
                                  ? { ...k, trim: e.target.checked }
                                  : k,
                              ),
                            })
                          }
                        />
                        {copy.trim}
                      </label>
                      <button
                        type="button"
                        disabled={plan.keys.length === 1}
                        onClick={() =>
                          edit({
                            ...plan,
                            keys: plan.keys.filter((_, i) => i !== index),
                          })
                        }
                      >
                        {copy.remove}
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    disabled={plan.keys.length >= 8}
                    onClick={() =>
                      edit({
                        ...plan,
                        keys: [
                          ...plan.keys,
                          {
                            name: '',
                            leftField: '',
                            rightField: '',
                            type: 'text',
                            trim: false,
                          },
                        ],
                      })
                    }
                  >
                    {copy.addKey}
                  </button>
                </fieldset>
                <details>
                  <summary>{copy.conversions}</summary>
                  <p>{copy.conversionHint}</p>
                  {plan.unitConversions.map((conversion, index) => (
                    <div className={styles.key} key={index}>
                      {(['from', 'to', 'factor', 'offset'] as const).map(
                        (field) => (
                          <label key={field}>
                            {copy[field]}
                            <input
                              required
                              value={conversion[field]}
                              onChange={(e) =>
                                edit({
                                  ...plan,
                                  unitConversions: plan.unitConversions.map(
                                    (c, i) =>
                                      i === index
                                        ? { ...c, [field]: e.target.value }
                                        : c,
                                  ),
                                })
                              }
                            />
                          </label>
                        ),
                      )}
                      <button
                        type="button"
                        onClick={() =>
                          edit({
                            ...plan,
                            unitConversions: plan.unitConversions.filter(
                              (_, i) => i !== index,
                            ),
                          })
                        }
                      >
                        {copy.remove}
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    disabled={plan.unitConversions.length >= 16}
                    onClick={() =>
                      edit({
                        ...plan,
                        unitConversions: [
                          ...plan.unitConversions,
                          { from: '', to: '', factor: '1', offset: '0' },
                        ],
                      })
                    }
                  >
                    {copy.addConversion}
                  </button>
                </details>
                <label>
                  {copy.policy}
                  <select
                    value={plan.conflictPolicy}
                    onChange={(e) =>
                      edit({
                        ...plan,
                        conflictPolicy: e.target
                          .value as ReconciliationPlan['conflictPolicy'],
                      })
                    }
                  >
                    <option value="preserve">{copy.preserve}</option>
                    <option value="right-revises-left">{copy.revision}</option>
                  </select>
                </label>
                <label className={styles.check}>
                  <input
                    type="checkbox"
                    checked={ack}
                    onChange={(e) => setAck(e.target.checked)}
                  />
                  {copy.scopeAck}
                </label>
                <button disabled={!ack || !analysisId} type="submit">
                  {busy ? copy.busy : copy.create}
                </button>
              </fieldset>
            </form>
          )}
          {batch && result ? (
            <section aria-label={batch.title}>
              <h3>
                {batch.title} · {state(batch)}
              </h3>
              <dl className={styles.metrics}>
                <dt>{copy.files}</dt>
                <dd>{batch.summary.fileCount}</dd>
                <dt>{copy.parsed}</dt>
                <dd>{batch.summary.parsedRecordCount}</dd>
                <dt>{copy.candidateCount}</dt>
                <dd>
                  {batch.summary.candidateObservationCount ?? copy.unknown}
                </dd>
                <dt>{copy.verifiedCount}</dt>
                <dd>{batch.independentObservationCount ?? copy.unknown}</dd>
                <dt>{copy.relation}</dt>
                <dd>{relation}</dd>
                {(
                  [
                    'duplicates',
                    'added',
                    'leftOnly',
                    'revised',
                    'conflicts',
                    'incomplete',
                  ] as const
                ).map((label, index) => (
                  <div key={label}>
                    <dt>{copy[label]}</dt>
                    <dd>
                      {
                        [
                          batch.summary.duplicateRecordCount,
                          batch.summary.addedCount,
                          batch.summary.leftOnlyCount,
                          batch.summary.revisedCount,
                          batch.summary.conflictCount,
                          batch.summary.incompleteRecordCount,
                        ][index]
                      }
                    </dd>
                  </div>
                ))}
              </dl>
              <details>
                <summary>{copy.scope}</summary>
                <p>
                  {batch.input.plan.conflictPolicy === 'preserve'
                    ? copy.preserve
                    : copy.revision}
                </p>
                <ul>
                  {batch.input.plan.keys.map((key) => (
                    <li key={key.name}>
                      {key.name}: {key.leftField} ↔ {key.rightField} ·{' '}
                      {copy[key.type === 'iso-time' ? 'time' : key.type]}
                      {key.trim ? ` · ${copy.trim}` : ''}
                    </li>
                  ))}
                </ul>
                {batch.sources.map((source, index) => (
                  <div key={`${source.analysisId}:${source.assetId}`}>
                    <h4>{copy[index === 0 ? 'left' : 'right']}</h4>
                    <p>{source.paths.join(', ')}</p>
                    <code>{source.sourceHash}</code>
                    <p>
                      <a
                        href={assetContentHref(
                          source.versionId,
                          source.assetId,
                          source.paths[0]?.split('/').at(-1) ?? source.assetId,
                          locale,
                        )}
                      >
                        {getDictionary(locale).dataFoundation.content.download}
                      </a>
                    </p>
                    <dl>
                      <dt>{copy.value}</dt>
                      <dd>
                        {
                          batch.input.plan[index === 0 ? 'left' : 'right']
                            .valueField
                        }
                      </dd>
                      {(['measure', 'unit'] as const).map((dimension) => {
                        const b =
                          batch.input.plan[index === 0 ? 'left' : 'right'][
                            dimension
                          ];
                        return (
                          <div key={dimension}>
                            <dt>{copy[dimension]}</dt>
                            <dd>
                              {'field' in b
                                ? `${copy.field}: ${b.field}`
                                : `${copy.constant}: ${b.literal}`}
                            </dd>
                          </div>
                        );
                      })}
                    </dl>
                  </div>
                ))}
                {batch.input.plan.unitConversions.map((c) => (
                  <p key={c.from}>
                    {c.from} → {c.to}: × {c.factor} + {c.offset}
                  </p>
                ))}
              </details>
              {batch.summary.candidateObservationCount === null ? (
                <p>{copy.unresolvedHint}</p>
              ) : null}
              <div className={styles.table}>
                <table>
                  <caption>{copy.groups}</caption>
                  <thead>
                    <tr>
                      <th>{copy.keys}</th>
                      <th>{copy.measure}</th>
                      <th>{copy.unit}</th>
                      <th>{copy.normalizedValue}</th>
                      <th>{copy.status}</th>
                      <th>{copy.members}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.groups.map((group) => (
                      <tr key={group.groupIndex}>
                        <td>{group.keys.join(' · ')}</td>
                        <td>{group.measure ?? '—'}</td>
                        <td>{group.unit ?? '—'}</td>
                        <td>{group.value ?? '—'}</td>
                        <td>{copy[group.status]}</td>
                        <td>
                          <button
                            disabled={busy}
                            onClick={() =>
                              void run(async (signal) => {
                                const page =
                                  GetReconciliationOutputSchema.parse(
                                    await call(
                                      'get',
                                      {
                                        batchId: batch.batchId,
                                        groupIndex: group.groupIndex,
                                      },
                                      signal,
                                    ),
                                  );
                                if (!signal.aborted) {
                                  setMembers(page);
                                  setGroupIndex(group.groupIndex);
                                }
                              })
                            }
                          >
                            {copy.members} ({group.memberCount})
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!result.groups.length ? <p>{copy.empty}</p> : null}
              <div className={styles.actions}>
                <button
                  disabled={busy}
                  onClick={() =>
                    void run((signal) => load(batch.batchId, signal))
                  }
                >
                  {copy.firstPage}
                </button>
                <button
                  disabled={busy || !result.nextCursor}
                  onClick={() =>
                    void run((signal) =>
                      load(batch.batchId, signal, result.nextCursor),
                    )
                  }
                >
                  {copy.next}
                </button>
              </div>
              {members && groupIndex !== null ? (
                <section>
                  <h4>{copy.members}</h4>
                  <ul>
                    {members.members.map((member) => (
                      <li key={`${member.side}:${member.recordId}`}>
                        {copy[member.side]} · {copy.record} {member.index} ·{' '}
                        {member.value ?? '—'} <code>{member.recordId}</code>
                      </li>
                    ))}
                  </ul>
                  <button
                    disabled={busy || !members.nextCursor}
                    onClick={() =>
                      void run(async (signal) => {
                        const page = GetReconciliationOutputSchema.parse(
                          await call(
                            'get',
                            {
                              batchId: batch.batchId,
                              groupIndex,
                              after: members.nextCursor,
                            },
                            signal,
                          ),
                        );
                        if (!signal.aborted) setMembers(page);
                      })
                    }
                  >
                    {copy.next}
                  </button>
                  <button onClick={() => setMembers(null)}>{copy.close}</button>
                </section>
              ) : null}
              {batch.status === 'CANDIDATE' ? (
                <fieldset disabled={busy}>
                  <label>
                    {copy.note}
                    <textarea
                      value={note}
                      maxLength={2000}
                      onChange={(e) => setNote(e.target.value)}
                    />
                  </label>
                  <label className={styles.check}>
                    <input
                      type="checkbox"
                      checked={reviewAck}
                      onChange={(e) => setReviewAck(e.target.checked)}
                    />
                    {copy.reviewAck}
                  </label>
                  <div className={styles.actions}>
                    {(['verify', 'reject'] as const).map((decision) => (
                      <button
                        key={decision}
                        disabled={
                          !note.trim() ||
                          (decision === 'verify' &&
                            (!reviewAck ||
                              batch.summary.candidateObservationCount === null))
                        }
                        onClick={() =>
                          void run(async (signal) => {
                            const reviewed =
                              CreateReconciliationOutputSchema.parse(
                                await call(
                                  'review',
                                  {
                                    batchId: batch.batchId,
                                    expectedVersion: batch.version,
                                    decision,
                                    note,
                                  },
                                  signal,
                                ),
                              );
                            if (signal.aborted) return;
                            setHistory((old) =>
                              old.map((b) =>
                                b.batchId === batch.batchId
                                  ? reviewed.batch
                                  : b,
                              ),
                            );
                            await load(batch.batchId, signal);
                          }, copy.reviewError)
                        }
                      >
                        {copy[decision]}
                      </button>
                    ))}
                  </div>
                </fieldset>
              ) : (
                <p>{batch.reviewNote}</p>
              )}
            </section>
          ) : null}
        </div>
      ) : null}
    </details>
  );
}
