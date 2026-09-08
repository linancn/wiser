'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  ExplorationAggregateSpecSchema,
  ExplorationResultSchema,
  RecordQuerySchema,
  type ExplorationAggregate,
  type ExplorationAggregateSpec,
  type ExplorationAnalysisAsset,
  type RecordFilter,
  type RecordQuery,
} from '@wiser/data-contracts';
import { getDictionary, type Locale } from '@/lib/i18n';
import {
  invalidatesExploration,
  type InvalidateExploration,
} from '@/lib/exploration-request';
import { DataExplorerAggregateChart } from './data-explorer-aggregate-chart';
import {
  DataExplorerTimeControls,
  offsetMinutes,
  timeDraft,
} from './data-explorer-time-controls';
import styles from './data-explorer.module.css';
import { useExplorationViewState } from './exploration-view-context';

function groupQuery(
  result: ExplorationAggregate,
  group: ExplorationAggregate['groups'][number],
  current?: RecordQuery,
): RecordQuery | undefined {
  const filters: RecordFilter[] = [...(current?.filters ?? [])];
  const grouping = result.spec.groupBy;
  if (grouping) {
    if (group.key === null) return undefined;
    if (grouping.type === 'text')
      filters.push({
        field: grouping.field,
        type: 'text',
        operator: 'eq',
        value: group.key,
      });
    else if (grouping.type === 'time') {
      if (group.upperBound === null) return undefined;
      const { bucket: _bucket, ...time } = grouping;
      filters.push(
        { ...time, operator: 'gte', value: group.key },
        { ...time, operator: 'lt', value: group.upperBound },
      );
    } else {
      if (group.upperBound === null) return undefined;
      filters.push(
        {
          field: grouping.field,
          type: 'number',
          operator: 'gte',
          value: Number(group.key),
        },
        {
          field: grouping.field,
          type: 'number',
          operator: 'lt',
          value: Number(group.upperBound),
        },
      );
    }
  }
  const measure = result.spec.measure;
  if ('unitField' in measure && measure.unitField) {
    if (group.unit === null) return undefined;
    filters.push({
      field: measure.unitField,
      type: 'text',
      operator: 'eq',
      value: group.unit,
    });
  }
  if (filters.length === (current?.filters.length ?? 0)) return undefined;
  const checked = RecordQuerySchema.safeParse({
    ...current,
    assetId: result.spec.assetId,
    filters,
  });
  return checked.success ? checked.data : undefined;
}

export function DataExplorerAggregate({
  locale,
  queryId,
  versionId,
  recordQuery,
  onConfigure,
  onInvalidated,
}: {
  readonly locale: Locale;
  readonly queryId: string;
  readonly versionId: string | null;
  readonly recordQuery?: RecordQuery;
  readonly onConfigure: (query: RecordQuery) => void;
  readonly onInvalidated: InvalidateExploration;
}) {
  const viewState = useExplorationViewState();
  const [seed] = useState(() => {
    const request = viewState?.initial.requests.statistics;
    return request?.versionId === versionId ? request.aggregate : undefined;
  });
  const restorePending = useRef(seed !== undefined);
  const all = getDictionary(locale).dataFoundation.explorer;
  const copy = all.aggregate;
  const [assets, setAssets] = useState<ExplorationAnalysisAsset[]>([]);
  const [assetId, setAssetId] = useState(seed?.assetId ?? '');
  const [groupField, setGroupField] = useState(seed?.groupBy?.field ?? '');
  const [groupType, setGroupType] = useState<string>(
    seed?.groupBy?.type ?? 'text',
  );
  const [time, setTime] = useState(() =>
    timeDraft(seed?.groupBy?.type === 'time' ? seed.groupBy : undefined),
  );
  const [bucket, setBucket] = useState<string>(
    seed?.groupBy?.type === 'time' ? seed.groupBy.bucket : 'month',
  );
  const [rangeStart, setRangeStart] = useState('');
  const [rangeEnd, setRangeEnd] = useState('');
  const [interval, setInterval] = useState(
    seed?.groupBy?.type === 'number' ? String(seed.groupBy.interval) : '10',
  );
  const [operation, setOperation] = useState<string>(
    seed?.measure.operation ?? 'count',
  );
  const [field, setField] = useState(
    seed && 'field' in seed.measure ? seed.measure.field : '',
  );
  const [unitField, setUnitField] = useState(
    seed && 'unitField' in seed.measure ? (seed.measure.unitField ?? '') : '',
  );
  const [result, setResult] = useState<ExplorationAggregate | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    pending.current?.abort();
    pending.current = controller;
    setAssets([]);
    setResult(null);
    setError(null);
    if (!versionId) return () => controller.abort();
    setBusy(true);
    void (async () => {
      try {
        const response = await fetch('/api/data-foundation/explore', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            queryId,
            versionId,
            view: 'records',
            first: 1,
          }),
          cache: 'no-store',
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        if (!response.ok) {
          if (invalidatesExploration(response.status))
            onInvalidated(queryId, response.status);
          throw new Error('Unavailable');
        }
        const data = ExplorationResultSchema.parse(await response.json());
        if (controller.signal.aborted) return;
        setAssets(
          data.assets?.filter((asset) => asset.status !== 'MANIFEST') ?? [],
        );
        setAssetId(seed?.assetId ?? data.selectedAssetId ?? '');
      } catch {
        if (!controller.signal.aborted) setError(all.unavailable);
      } finally {
        if (!controller.signal.aborted) setBusy(false);
      }
    })();
    return () => {
      controller.abort();
      pending.current?.abort();
    };
  }, [queryId, versionId, onInvalidated, all.unavailable]);
  const columns =
    assets.find((asset) => asset.assetId === assetId)?.columns ?? [];
  async function submit(event: FormEvent) {
    event.preventDefault();
    const parsed = ExplorationAggregateSpecSchema.safeParse({
      assetId,
      ...(groupField
        ? {
            groupBy: {
              field: groupField,
              type: groupType,
              ...(groupType === 'number' ? { interval: Number(interval) } : {}),
              ...(groupType === 'time'
                ? {
                    format: time.format,
                    utcOffsetMinutes: offsetMinutes(time.offset),
                    bucket,
                  }
                : {}),
            },
          }
        : {}),
      measure: {
        operation,
        ...(operation === 'count'
          ? {}
          : { field, ...(unitField ? { unitField } : {}) }),
      },
    });
    if (!parsed.success) {
      setError(copy.checkFields);
      return;
    }
    await calculate(parsed.data);
  }
  async function calculate(aggregate: ExplorationAggregateSpec) {
    viewState?.report('statistics', null);
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const response = await fetch('/api/data-foundation/explore', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          queryId,
          versionId,
          view: 'aggregate',
          aggregate,
        }),
        cache: 'no-store',
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      if (!response.ok) {
        if (invalidatesExploration(response.status))
          onInvalidated(queryId, response.status);
        throw new Error('Unavailable');
      }
      const data = ExplorationResultSchema.parse(await response.json());
      if (!controller.signal.aborted) {
        if (data.queryId !== queryId || data.view !== 'aggregate')
          throw new Error('Mismatched aggregate');
        viewState?.report('statistics', {
          first: 25,
          queryId,
          versionId: versionId ?? undefined,
          view: 'aggregate',
          aggregate,
        });
        setResult(data.aggregate ?? null);
        const timed =
          data.aggregate?.groups.filter(
            (group) => group.key !== null && group.upperBound !== null,
          ) ?? [];
        setRangeStart(timed[0]?.key ?? '');
        setRangeEnd(timed.at(-1)?.key ?? '');
        setTotal(data.totalCount);
      }
    } catch {
      if (!controller.signal.aborted) setError(all.unavailable);
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  useEffect(() => {
    if (
      restorePending.current &&
      seed &&
      assets.length &&
      assets.some((asset) => asset.assetId === seed.assetId)
    ) {
      restorePending.current = false;
      void calculate(seed);
    }
  }, [assets, seed]);
  if (!versionId) return <p className={styles.empty}>{all.selectForRecords}</p>;
  const pick = (group: ExplorationAggregate['groups'][number]) => {
    if (!result) return;
    const next = groupQuery(result, group, recordQuery);
    if (next) onConfigure(next);
  };
  const range = (start: string, end: string) => {
    if (!result || result.spec.groupBy?.type !== 'time') return;
    const first = result.groups.find((group) => group.key === start);
    const last = result.groups.find((group) => group.key === end);
    if (!first?.key || !last?.upperBound || first.key > last.key!) return;
    const { bucket: _bucket, ...timeGroup } = result.spec.groupBy;
    const checked = RecordQuerySchema.safeParse({
      ...recordQuery,
      assetId: result.spec.assetId,
      filters: [
        ...(recordQuery?.filters ?? []),
        { ...timeGroup, operator: 'gte', value: first.key },
        { ...timeGroup, operator: 'lt', value: last.upperBound },
      ],
    });
    if (checked.success) onConfigure(checked.data);
    else setError(copy.checkFields);
  };
  const timeGroups =
    result?.spec.groupBy?.type === 'time'
      ? result.groups
          .filter((group) => group.key !== null && group.upperBound !== null)
          .filter(
            (group, index, groups) =>
              groups.findIndex((entry) => entry.key === group.key) === index,
          )
      : [];
  const timeLabel = (instant: string) => {
    const offset =
      result?.spec.groupBy?.type === 'time'
        ? result.spec.groupBy.utcOffsetMinutes
        : 0;
    return new Date(Date.parse(instant) + offset * 60000)
      .toISOString()
      .slice(0, 16)
      .replace('T', ' ');
  };
  return (
    <section
      className={styles.statistics}
      aria-label={copy.title}
      data-testid="explorer-aggregate"
      aria-busy={busy}
    >
      <h2>{copy.title}</h2>
      <p>{copy.scope}</p>
      <form
        onSubmit={(event) => {
          void submit(event);
        }}
        onChange={() => setResult(null)}
      >
        <fieldset className={styles.recordCondition} disabled={busy}>
          <label>
            {all.sourceFile}
            <select
              value={assetId}
              disabled={recordQuery !== undefined}
              onChange={(event) => {
                setAssetId(event.target.value);
                setGroupField('');
                setField('');
                setUnitField('');
              }}
            >
              {assets.map((asset) => (
                <option key={asset.assetId} value={asset.assetId}>
                  {asset.paths[0]?.split('/').at(-1) ?? asset.assetId}
                </option>
              ))}
            </select>
          </label>
          <label>
            {copy.groupField}
            <select
              value={groupField}
              onChange={(event) => setGroupField(event.target.value)}
            >
              <option value="">{copy.ungrouped}</option>
              {columns.map((column) => (
                <option key={column.key} value={column.key}>
                  {column.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            {copy.groupType}
            <select
              value={groupType}
              disabled={!groupField}
              onChange={(event) => setGroupType(event.target.value)}
            >
              <option value="text">{all.recordControls.text}</option>
              <option value="number">{copy.histogram}</option>
              <option value="time">{all.time.label}</option>
            </select>
          </label>
          {groupField && groupType === 'time' ? (
            <>
              <DataExplorerTimeControls
                locale={locale}
                value={time}
                onChange={setTime}
              />
              <label>
                {all.time.bucket}
                <select
                  value={bucket}
                  onChange={(event) => setBucket(event.target.value)}
                >
                  {(['hour', 'day', 'month', 'year'] as const).map((key) => (
                    <option key={key} value={key}>
                      {all.time.buckets[key]}
                    </option>
                  ))}
                </select>
              </label>
            </>
          ) : null}
          {groupField && groupType === 'number' ? (
            <label>
              {copy.interval}
              <input
                value={interval}
                inputMode="decimal"
                onChange={(event) => setInterval(event.target.value)}
              />
            </label>
          ) : null}
          <label>
            {copy.operation}
            <select
              value={operation}
              onChange={(event) => setOperation(event.target.value)}
            >
              {(['count', 'mean', 'sum', 'min', 'max'] as const).map((key) => (
                <option key={key} value={key}>
                  {copy.operations[key]}
                </option>
              ))}
            </select>
          </label>
          {operation !== 'count' ? (
            <>
              <label>
                {copy.field}
                <select
                  value={field}
                  onChange={(event) => setField(event.target.value)}
                >
                  <option value="">{copy.chooseField}</option>
                  {columns.map((column) => (
                    <option key={column.key} value={column.key}>
                      {column.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {copy.unitField}
                <select
                  value={unitField}
                  onChange={(event) => setUnitField(event.target.value)}
                >
                  <option value="">{copy.unknownUnit}</option>
                  {columns.map((column) => (
                    <option key={column.key} value={column.key}>
                      {column.label}
                    </option>
                  ))}
                </select>
              </label>
            </>
          ) : null}
          <button type="submit" disabled={!assetId}>
            {busy ? all.querying : copy.calculate}
          </button>
        </fieldset>
      </form>
      {error ? <p role="alert">{error}</p> : null}
      {result ? (
        <>
          <p>
            {copy.matchingRecords} {total.toLocaleString(locale)} ·{' '}
            {copy.groups} {result.groupCount.toLocaleString(locale)}
          </p>
          {result.spec.measure.operation !== 'count' ? (
            <p>{copy.unitPolicy}</p>
          ) : null}
          {result.truncated ? <p role="status">{copy.truncated}</p> : null}
          <DataExplorerAggregateChart
            locale={locale}
            result={result}
            onPick={pick}
            onRange={range}
          />
          {timeGroups.length ? (
            <fieldset className={styles.recordCondition}>
              <legend>{all.time.brush}</legend>
              <label>
                {all.time.start}
                <select
                  value={rangeStart}
                  onChange={(event) => setRangeStart(event.target.value)}
                >
                  {timeGroups.map((group) => (
                    <option key={group.key} value={group.key!}>
                      {timeLabel(group.key!)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {all.time.end}
                <select
                  value={rangeEnd}
                  onChange={(event) => setRangeEnd(event.target.value)}
                >
                  {timeGroups.map((group) => (
                    <option key={group.key} value={group.key!}>
                      {timeLabel(group.key!)}
                    </option>
                  ))}
                </select>
              </label>
              <button
                disabled={!rangeStart || !rangeEnd || rangeStart > rangeEnd}
                onClick={() => range(rangeStart, rangeEnd)}
              >
                {all.time.apply}
              </button>
            </fieldset>
          ) : null}
          <div className={styles.tableScroll}>
            <table>
              <thead>
                <tr>
                  {[
                    copy.groupField,
                    copy.unit,
                    copy.value,
                    copy.count,
                    copy.valid,
                    copy.missing,
                    copy.invalid,
                  ].map((label) => (
                    <th key={label} scope="col">
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.groups.map((group, index) => (
                  <tr key={index}>
                    <td>
                      {groupQuery(result, group, recordQuery) ? (
                        <button
                          aria-label={`${copy.inspect} ${group.key ?? group.unit}`}
                          onClick={() => pick(group)}
                        >
                          {group.key ?? group.unit}
                        </button>
                      ) : (
                        (group.key ?? copy.unknownGroup)
                      )}
                    </td>
                    <td>
                      {group.unit ??
                        (result.spec.measure.operation === 'count'
                          ? '—'
                          : copy.unknownUnit)}
                    </td>
                    <td>{group.value ?? '—'}</td>
                    {[
                      group.count,
                      group.validCount,
                      group.missingCount,
                      group.invalidCount,
                    ].map((value, index) => (
                      <td key={index}>{value.toLocaleString(locale)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {result.groups.length === 0 ? <p>{all.noRecords}</p> : null}
        </>
      ) : null}
    </section>
  );
}
