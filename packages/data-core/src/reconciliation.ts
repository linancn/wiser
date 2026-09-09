import type {
  ReconciliationPlan,
  ReconciliationGroup,
  ReconciliationMember,
  ReconciliationSummary,
} from '@wiser/data-contracts';

export interface ReconciliationRecord {
  readonly recordId: string;
  readonly index: number;
  readonly values: Readonly<Record<string, unknown>>;
}
type Decimal = { coefficient: bigint; scale: number };
function decimal(value: unknown): Decimal | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  if (
    typeof value === 'number' &&
    (!Number.isFinite(value) ||
      (Number.isInteger(value) && !Number.isSafeInteger(value)))
  )
    return null;
  const text = String(value);
  if (text.length > 128) return null;
  const match = /^([+-]?)(\d+|\d*\.\d+|\d+\.)(?:[eE]([+-]?\d{1,3}))?$/.exec(
    text,
  );
  if (!match) return null;
  const exponent = Number(match[3] ?? 0);
  if (Math.abs(exponent) > 100) return null;
  const [whole, fraction = ''] = match[2]!.split('.');
  let coefficient = BigInt(
    (match[1] === '-' ? '-' : '') + (whole || '0') + fraction,
  );
  let scale = fraction.length - exponent;
  if (scale < 0) {
    coefficient *= 10n ** BigInt(-scale);
    scale = 0;
  }
  return { coefficient, scale };
}
function decimalText(value: Decimal): string {
  let { coefficient, scale } = value;
  if (coefficient === 0n) return '0';
  while (scale > 0 && coefficient % 10n === 0n) {
    coefficient /= 10n;
    scale--;
  }
  const sign = coefficient < 0n ? '-' : '';
  const digits = (coefficient < 0n ? -coefficient : coefficient)
    .toString()
    .padStart(scale + 1, '0');
  return (
    sign +
    (scale ? `${digits.slice(0, -scale)}.${digits.slice(-scale)}` : digits)
  );
}
function convert(value: Decimal, factor: Decimal, offset: Decimal): Decimal {
  const scale = Math.max(value.scale + factor.scale, offset.scale);
  return {
    scale,
    coefficient:
      value.coefficient *
        factor.coefficient *
        10n ** BigInt(scale - value.scale - factor.scale) +
      offset.coefficient * 10n ** BigInt(scale - offset.scale),
  };
}
/** Gregorian calendar arithmetic: no host clock, timezone, Date parsing or locale. */
function instant(value: string): string | null {
  const m =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/.exec(
      value,
    );
  if (!m) return null;
  const [year, month, day, hour, minute, second] = m
    .slice(1, 7)
    .map(Number) as [number, number, number, number, number, number];
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const months = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (
    year < 1 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > (months[month - 1] ?? 0) ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  )
    return null;
  let offset = 0;
  if (m[8] !== 'Z') {
    const h = Number(m[8]!.slice(1, 3)),
      min = Number(m[8]!.slice(4));
    if (h > 14 || min > 59 || (h === 14 && min !== 0)) return null;
    offset = (h * 60 + min) * (m[8]![0] === '-' ? -1 : 1);
  }
  const y = year - 1;
  const days =
    y * 365 +
    Math.floor(y / 4) -
    Math.floor(y / 100) +
    Math.floor(y / 400) +
    months.slice(0, month - 1).reduce((a, b) => a + b, 0) +
    day -
    1;
  return (
    BigInt(days * 86400 + hour * 3600 + minute * 60 + second - offset * 60) *
      1000000n +
    BigInt((m[7] ?? '').padEnd(6, '0'))
  ).toString();
}
function text(value: unknown, trim = false): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  if (
    typeof value === 'number' &&
    (!Number.isFinite(value) ||
      (Number.isInteger(value) && !Number.isSafeInteger(value)))
  )
    return null;
  const result = (trim ? String(value).trim() : String(value)).normalize('NFC');
  return result.trim().length && result.length <= 512 ? result : null;
}
function binding(
  value: ReconciliationPlan['left']['measure'],
  record: ReconciliationRecord,
) {
  return text('literal' in value ? value.literal : record.values[value.field]);
}

export function reconcileObservations(
  plan: ReconciliationPlan,
  left: readonly ReconciliationRecord[],
  right: readonly ReconciliationRecord[],
): {
  summary: ReconciliationSummary;
  groups: (ReconciliationGroup & { members: ReconciliationMember[] })[];
} {
  if (left.length + right.length > 50000)
    throw new Error('RECONCILIATION_LIMIT');
  const groups: (ReconciliationGroup & { members: ReconciliationMember[] })[] =
    [];
  const byKey = new Map<string, (typeof groups)[number]>();
  let incompleteRecordCount = 0;
  for (const side of ['left', 'right'] as const) {
    for (const record of side === 'left' ? left : right) {
      const keys = plan.keys.map((key) => {
        const value =
          record.values[side === 'left' ? key.leftField : key.rightField];
        const raw = text(value, key.trim);
        if (raw === null) return null;
        return key.type === 'text'
          ? raw
          : key.type === 'iso-time'
            ? instant(raw)
            : ((v) => (v ? decimalText(v) : null))(decimal(raw));
      });
      const mapping = plan[side];
      const measure = binding(mapping.measure, record);
      let unit = binding(mapping.unit, record);
      let value = decimal(record.values[mapping.valueField]);
      const conversion = plan.unitConversions.find((c) => c.from === unit);
      if (conversion && value) {
        const factor = decimal(conversion.factor),
          offset = decimal(conversion.offset);
        if (!factor || !offset || factor.coefficient <= 0n)
          throw new Error('INVALID_CONVERSION');
        value = convert(value, factor, offset);
        unit = conversion.to;
      }
      const normalized = value ? decimalText(value) : null;
      const incomplete =
        keys.some((k) => k === null) ||
        measure === null ||
        unit === null ||
        normalized === null ||
        record.values['__kind'] !== undefined;
      const signature = incomplete
        ? null
        : JSON.stringify([keys, measure, unit]);
      let group = signature === null ? undefined : byKey.get(signature);
      if (!group) {
        group = {
          groupIndex: groups.length,
          keys: keys.map((k) => k ?? ''),
          measure,
          unit,
          status: incomplete
            ? 'INCOMPLETE'
            : side === 'left'
              ? 'LEFT_ONLY'
              : 'ADDED',
          selectedRecordId: null,
          value: null,
          memberCount: 0,
          members: [],
        };
        groups.push(group);
        if (signature !== null) byKey.set(signature, group);
      }
      group.members.push({
        side,
        recordId: record.recordId,
        index: record.index,
        value: normalized,
      });
      group.memberCount++;
      if (incomplete) incompleteRecordCount++;
    }
  }
  let duplicateRecordCount = 0,
    unchangedCount = 0,
    leftOnlyCount = 0,
    addedCount = 0,
    revisedCount = 0,
    conflictCount = 0;
  for (const group of groups) {
    if (group.status === 'INCOMPLETE') continue;
    const l = group.members.filter((m) => m.side === 'left'),
      r = group.members.filter((m) => m.side === 'right');
    const lv = new Set(l.map((m) => m.value)),
      rv = new Set(r.map((m) => m.value));
    const values = new Set(group.members.map((m) => m.value));
    duplicateRecordCount += group.members.length - values.size;
    let selected: ReconciliationMember | undefined;
    if (values.size === 1) {
      group.status =
        l.length && r.length ? 'UNCHANGED' : l.length ? 'LEFT_ONLY' : 'ADDED';
      selected = l[0] ?? r[0];
    } else if (
      plan.conflictPolicy === 'right-revises-left' &&
      lv.size === 1 &&
      rv.size === 1
    ) {
      group.status = 'REVISED';
      selected = r[0];
    } else group.status = 'CONFLICT';
    group.selectedRecordId = selected?.recordId ?? null;
    group.value = selected?.value ?? null;
    if (group.status === 'UNCHANGED') unchangedCount++;
    if (group.status === 'LEFT_ONLY') leftOnlyCount++;
    if (group.status === 'ADDED') addedCount++;
    if (group.status === 'REVISED') revisedCount++;
    if (group.status === 'CONFLICT') conflictCount++;
  }
  const unresolved = conflictCount > 0 || incompleteRecordCount > 0;
  const relation: ReconciliationSummary['relation'] = unresolved
    ? 'UNRESOLVED'
    : revisedCount
      ? 'REVISION'
      : unchangedCount > 0 && leftOnlyCount === 0 && addedCount === 0
        ? 'FORMAT_COPY_CANDIDATE'
        : unchangedCount
          ? 'OVERLAP'
          : 'DISJOINT';
  return {
    summary: {
      fileCount: 2,
      parsedRecordCount: left.length + right.length,
      candidateObservationCount: unresolved ? null : groups.length,
      duplicateRecordCount,
      unchangedCount,
      leftOnlyCount,
      addedCount,
      revisedCount,
      conflictCount,
      incompleteRecordCount,
      relation,
    },
    groups,
  };
}
