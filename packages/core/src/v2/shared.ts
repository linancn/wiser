import { DomainError } from '../domain-error.js';

export function fail(code: string, message: string): never {
  throw new DomainError(code, message);
}

export function requireNonEmpty(value: string, field: string): void {
  if (value.trim().length === 0) {
    fail('INVALID_DOMAIN_VALUE', `${field} must not be empty.`);
  }
}

const ISO_OFFSET_TIMESTAMP =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?(Z|[+-]\d{2}:\d{2})$/;

function leapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function maximumDay(year: number, month: number): number {
  if (month === 2) return leapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

export function toEpoch(value: string, field: string): number {
  const match = ISO_OFFSET_TIMESTAMP.exec(value);
  const year = Number(match?.[1]);
  const month = Number(match?.[2]);
  const day = Number(match?.[3]);
  const hour = Number(match?.[4]);
  const minute = Number(match?.[5]);
  const second = match?.[6] === undefined ? 0 : Number(match[6]);
  const offset = match?.[8];
  const offsetHour = offset === 'Z' ? 0 : Number(offset?.slice(1, 3));
  const offsetMinute = offset === 'Z' ? 0 : Number(offset?.slice(4, 6));
  const epoch = Date.parse(value);
  if (
    match === null ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > maximumDay(year, month) ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    offsetHour > 23 ||
    offsetMinute > 59 ||
    Number.isNaN(epoch)
  ) {
    fail('INVALID_TIMESTAMP', `${field} must be a valid ISO 8601 timestamp.`);
  }
  return epoch;
}

export function assertAggregateVersion(input: {
  actual: number;
  expected: number;
  code: string;
  aggregate: string;
}): void {
  if (input.actual !== input.expected) {
    fail(
      input.code,
      `Expected ${input.aggregate} version ${input.expected}, received ${input.actual}. Refresh and retry.`,
    );
  }
}

export type CanonicalJsonPrimitive = string | number | boolean | null;

export type CanonicalJsonValue =
  | CanonicalJsonPrimitive
  | readonly CanonicalJsonValue[]
  | { readonly [key: string]: CanonicalJsonValue };

function cloneCanonicalJson(
  value: CanonicalJsonValue,
  ancestors: Set<object>,
): CanonicalJsonValue {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isFinite(value)) {
      fail('INVALID_CANONICAL_JSON', 'Canonical JSON numbers must be finite.');
    }
    return value;
  }
  if (ancestors.has(value)) {
    fail('INVALID_CANONICAL_JSON', 'Canonical JSON cannot contain cycles.');
  }
  ancestors.add(value);
  if (Array.isArray(value)) {
    const cloned = Object.freeze(
      (value as readonly CanonicalJsonValue[]).map((item) =>
        cloneCanonicalJson(item, ancestors),
      ),
    );
    ancestors.delete(value);
    return cloned;
  }
  const record = value as Readonly<Record<string, CanonicalJsonValue>>;
  const cloned: Record<string, CanonicalJsonValue> = {};
  for (const [key, entry] of Object.entries(record)) {
    cloned[key] = cloneCanonicalJson(entry, ancestors);
  }
  ancestors.delete(value);
  return Object.freeze(cloned);
}

export function cloneAndFreezeCanonicalJson(
  value: CanonicalJsonValue,
): CanonicalJsonValue {
  return cloneCanonicalJson(value, new Set<object>());
}

export function canonicalJson(value: CanonicalJsonValue): string {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isFinite(value)) {
      fail('INVALID_CANONICAL_JSON', 'Canonical JSON numbers must be finite.');
    }
    const serialized = JSON.stringify(value);
    if (serialized === undefined) {
      fail('INVALID_CANONICAL_JSON', 'The value cannot be serialized.');
    }
    return serialized;
  }

  if (Array.isArray(value)) {
    return `[${(value as readonly CanonicalJsonValue[])
      .map((item) => canonicalJson(item))
      .join(',')}]`;
  }

  // Canonical hashes must not depend on the host ICU locale. JavaScript's
  // relational string comparison gives a stable UTF-16 code-unit ordering,
  // unlike localeCompare(), whose collation can vary by runtime locale.
  const entries = Object.entries(value).sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
  return `{${entries
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
    .join(',')}}`;
}

export function freezeArray<T>(values: readonly T[]): readonly T[] {
  return Object.freeze([...values]);
}
