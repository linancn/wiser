'use client';
import { useState, type FormEvent } from 'react';
import { RecordQuerySchema, type RecordQuery } from '@wiser/data-contracts';
import { getDictionary, type Locale } from '@/lib/i18n';
import {
  DataExplorerTimeControls,
  offsetMinutes,
  timeDraft,
  type TimeDraft,
} from './data-explorer-time-controls';
import styles from './data-explorer.module.css';

type Draft = {
  field: string;
  type: 'text' | 'number' | 'presence' | 'time';
  time: TimeDraft;
  operator: string;
  value: string;
};
const operators = {
  text: ['eq', 'ne', 'contains'],
  number: ['eq', 'ne', 'gt', 'gte', 'lt', 'lte'],
  presence: ['isNull', 'isNotNull'],
  time: ['eq', 'ne', 'gt', 'gte', 'lt', 'lte'],
} as const;

export function DataExplorerRecordControls({
  locale,
  assetId,
  columns,
  value,
  onApply,
  busy,
}: {
  readonly locale: Locale;
  readonly assetId: string;
  readonly columns: readonly { readonly key: string; readonly label: string }[];
  readonly value?: RecordQuery;
  readonly onApply: (value: RecordQuery | undefined) => void;
  readonly busy: boolean;
}) {
  const copy = getDictionary(locale).dataFoundation.explorer.recordControls;
  const timeCopy = getDictionary(locale).dataFoundation.explorer.time;
  const [filters, setFilters] = useState<Draft[]>(
    () =>
      value?.filters.map((filter) => ({
        ...filter,
        time: timeDraft(filter.type === 'time' ? filter : undefined),
        value: 'value' in filter ? String(filter.value) : '',
      })) ?? [],
  );
  const [sortField, setSortField] = useState(value?.sort?.field ?? '');
  const [sortType, setSortType] = useState(value?.sort?.type ?? 'text');
  const [sortTime, setSortTime] = useState(() =>
    timeDraft(value?.sort?.type === 'time' ? value.sort : undefined),
  );
  const [direction, setDirection] = useState(value?.sort?.direction ?? 'asc');
  const [selectedColumns, setSelectedColumns] = useState<string[] | null>(
    value?.columns ?? null,
  );
  const [error, setError] = useState<string | null>(null);
  function update(index: number, patch: Partial<Draft>) {
    setFilters((current) =>
      current.map((filter, i) =>
        i === index ? { ...filter, ...patch } : filter,
      ),
    );
    setError(null);
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    if (
      filters.some(
        (filter) =>
          filter.type === 'number' &&
          (filter.value.trim() === '' ||
            !Number.isFinite(Number(filter.value))),
      )
    ) {
      setError(copy.invalidNumber);
      return;
    }
    if (
      filters.some(
        (filter) =>
          filter.type === 'time' &&
          offsetMinutes(filter.time.offset) === undefined,
      ) ||
      (sortField &&
        sortType === 'time' &&
        offsetMinutes(sortTime.offset) === undefined)
    ) {
      setError(timeCopy.invalid);
      return;
    }
    const parsed = RecordQuerySchema.safeParse({
      assetId,
      filters: filters.map((filter) => ({
        field: filter.field,
        type: filter.type,
        operator: filter.operator,
        ...(filter.type === 'time'
          ? {
              format: filter.time.format,
              utcOffsetMinutes: offsetMinutes(filter.time.offset),
            }
          : {}),
        ...(filter.type === 'presence'
          ? {}
          : {
              value:
                filter.type === 'number' ? Number(filter.value) : filter.value,
            }),
      })),
      ...(sortField
        ? {
            sort: {
              field: sortField,
              type: sortType,
              direction,
              ...(sortType === 'time'
                ? {
                    format: sortTime.format,
                    utcOffsetMinutes: offsetMinutes(sortTime.offset),
                  }
                : {}),
            },
          }
        : {}),
      ...(selectedColumns ? { columns: selectedColumns } : {}),
    });
    if (!parsed.success) {
      setError(
        filters.some((filter) => filter.type === 'time')
          ? timeCopy.invalid
          : copy.invalidColumns,
      );
      return;
    }
    setError(null);
    onApply(parsed.data);
  }
  return (
    <details className={styles.recordControls} open={value !== undefined}>
      <summary>{copy.title}</summary>
      <form onSubmit={submit} aria-label={copy.title}>
        <fieldset disabled={busy} className={styles.recordConfiguration}>
          <p>{copy.scope}</p>
          {filters.map((filter, index) => (
            <fieldset key={index} className={styles.recordCondition}>
              <legend>
                {copy.condition} {index + 1}
              </legend>
              <label>
                {copy.field}
                <select
                  value={filter.field}
                  onChange={(event) =>
                    update(index, { field: event.target.value })
                  }
                >
                  {columns.map((column) => (
                    <option key={column.key} value={column.key}>
                      {column.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {copy.type}
                <select
                  value={filter.type}
                  onChange={(event) => {
                    const type = event.target.value as Draft['type'];
                    update(index, {
                      type,
                      operator: operators[type][0],
                      value: '',
                    });
                  }}
                >
                  <option value="text">{copy.text}</option>
                  <option value="number">{copy.number}</option>
                  <option value="time">{timeCopy.label}</option>
                  <option value="presence">{copy.presence}</option>
                </select>
              </label>
              <label>
                {copy.operator}
                <select
                  value={filter.operator}
                  onChange={(event) =>
                    update(index, { operator: event.target.value })
                  }
                >
                  {operators[filter.type].map((operator) => (
                    <option key={operator} value={operator}>
                      {copy.operators[operator]}
                    </option>
                  ))}
                </select>
              </label>
              {filter.type === 'time' ? (
                <DataExplorerTimeControls
                  locale={locale}
                  value={filter.time}
                  onChange={(time) => update(index, { time })}
                />
              ) : null}
              {filter.type !== 'presence' ? (
                <label>
                  {copy.value}
                  <input
                    maxLength={512}
                    inputMode={filter.type === 'number' ? 'decimal' : 'text'}
                    value={filter.value}
                    onChange={(event) =>
                      update(index, { value: event.target.value })
                    }
                  />
                </label>
              ) : null}
              <button
                type="button"
                aria-label={`${copy.remove} ${index + 1}`}
                onClick={() =>
                  setFilters((current) => current.filter((_, i) => i !== index))
                }
              >
                {copy.remove}
              </button>
            </fieldset>
          ))}
          <button
            type="button"
            disabled={filters.length >= 8 || columns.length === 0}
            onClick={() =>
              setFilters((current) => [
                ...current,
                {
                  field: columns[0].key,
                  type: 'text',
                  time: timeDraft(),
                  operator: 'eq',
                  value: '',
                },
              ])
            }
          >
            {copy.add}
          </button>
          <div className={styles.recordCondition}>
            <label>
              {copy.sortField}
              <select
                value={sortField}
                onChange={(event) => setSortField(event.target.value)}
              >
                <option value="">{copy.originalOrder}</option>
                {columns.map((column) => (
                  <option key={column.key} value={column.key}>
                    {column.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {copy.sortType}
              <select
                disabled={!sortField}
                value={sortType}
                onChange={(event) =>
                  setSortType(event.target.value as 'text' | 'number' | 'time')
                }
              >
                <option value="text">{copy.text}</option>
                <option value="number">{copy.number}</option>
                <option value="time">{timeCopy.label}</option>
              </select>
            </label>
            <label>
              {copy.direction}
              <select
                disabled={!sortField}
                value={direction}
                onChange={(event) =>
                  setDirection(event.target.value as 'asc' | 'desc')
                }
              >
                <option value="asc">{copy.asc}</option>
                <option value="desc">{copy.desc}</option>
              </select>
            </label>
          </div>
          {sortField && sortType === 'time' ? (
            <DataExplorerTimeControls
              locale={locale}
              value={sortTime}
              onChange={setSortTime}
            />
          ) : null}
          <fieldset className={styles.columnChoices}>
            <legend>{copy.columns}</legend>
            {columns.map((column) => (
              <label key={column.key}>
                <input
                  type="checkbox"
                  checked={
                    selectedColumns === null ||
                    selectedColumns.includes(column.key)
                  }
                  onChange={(event) => {
                    const current =
                      selectedColumns ?? columns.map((entry) => entry.key);
                    setSelectedColumns(
                      event.target.checked
                        ? [...current, column.key]
                        : current.filter((key) => key !== column.key),
                    );
                    setError(null);
                  }}
                />
                {column.label}
              </label>
            ))}
          </fieldset>
          {error ? <p role="alert">{error}</p> : null}
          <div className={styles.recordActions}>
            <button type="submit">{copy.apply}</button>
            <button
              type="button"
              onClick={() => {
                setFilters([]);
                setSortField('');
                setSortType('text');
                setDirection('asc');
                setSelectedColumns(null);
                setError(null);
                onApply(undefined);
              }}
            >
              {copy.clear}
            </button>
          </div>
        </fieldset>
      </form>
    </details>
  );
}
