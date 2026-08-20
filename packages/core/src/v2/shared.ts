import { DomainError } from '../domain-error.js';

export function fail(code: string, message: string): never {
  throw new DomainError(code, message);
}

export function requireNonEmpty(value: string, field: string): void {
  if (value.trim().length === 0) {
    fail('INVALID_DOMAIN_VALUE', `${field} must not be empty.`);
  }
}

export function toEpoch(value: string, field: string): number {
  const epoch = Date.parse(value);
  if (Number.isNaN(epoch)) {
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
