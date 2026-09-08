'use client';
import type { ExplorationTimeConfig } from '@wiser/data-contracts';
import { getDictionary, type Locale } from '@/lib/i18n';

export type TimeDraft = {
  format: ExplorationTimeConfig['format'];
  offset: string;
};
export function offsetMinutes(value: string): number | undefined {
  const parts = /^([+-])(\d{2}):([0-5]\d)$/.exec(value.trim());
  if (!parts) return undefined;
  const minutes = Number(parts[2]) * 60 + Number(parts[3]);
  return minutes <= 840 ? minutes * (parts[1] === '-' ? -1 : 1) : undefined;
}
export function timeDraft(value?: ExplorationTimeConfig): TimeDraft {
  const minutes = value?.utcOffsetMinutes;
  return {
    format: value?.format ?? 'iso-offset',
    offset:
      minutes === undefined
        ? ''
        : `${minutes < 0 ? '-' : '+'}${String(Math.floor(Math.abs(minutes) / 60)).padStart(2, '0')}:${String(Math.abs(minutes) % 60).padStart(2, '0')}`,
  };
}
export function DataExplorerTimeControls({
  locale,
  value,
  onChange,
}: {
  readonly locale: Locale;
  readonly value: TimeDraft;
  readonly onChange: (value: TimeDraft) => void;
}) {
  const copy = getDictionary(locale).dataFoundation.explorer.time;
  return (
    <>
      <label>
        {copy.format}
        <select
          value={value.format}
          onChange={(event) =>
            onChange({
              ...value,
              format: event.target.value as TimeDraft['format'],
            })
          }
        >
          <option value="iso-offset">{copy.iso}</option>
          <option value="dmy-local">{copy.dmy}</option>
          <option value="ymd-local">{copy.ymd}</option>
        </select>
      </label>
      <label>
        {copy.offset}
        <input
          value={value.offset}
          placeholder="+08:00"
          maxLength={6}
          onChange={(event) =>
            onChange({ ...value, offset: event.target.value })
          }
        />
      </label>
      <p>{copy.policy}</p>
    </>
  );
}
