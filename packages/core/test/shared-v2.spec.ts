import { describe, expect, it } from 'vitest';

import { createExerciseRun, type DomainError } from '../src/index.js';
import {
  canonicalJson,
  cloneAndFreezeCanonicalJson,
  freezeArray,
  type CanonicalJsonValue,
} from '../src/v2/shared.js';

function createRunAt(virtualStartAt: string) {
  return createExerciseRun({
    id: 'run-shared-contract',
    scenarioVersionId: 'scenario-version-shared-contract',
    virtualStartAt,
    compatibilityMode: 'collaborative_v2',
  });
}

describe('v2 shared deterministic boundaries', () => {
  it.each([
    '2023-03-22T07:00:00.000Z',
    '2023-03-22T15:00:00.000+08:00',
    '2023-03-22T01:30:00.000-05:30',
  ])('accepts an ISO 8601 timestamp with an explicit offset: %s', (value) => {
    expect(createRunAt(value).virtualTime).toBe(value);
  });

  it.each([
    'March 1, 2023',
    '123',
    '2023-02-30T00:00:00.000Z',
    '2023-03-22T07:00:00.000',
  ])('rejects a non-contract timestamp before creating a Run: %s', (value) => {
    expect(() => createRunAt(value)).toThrowError(
      expect.objectContaining<Partial<DomainError>>({
        code: 'INVALID_TIMESTAMP',
      }),
    );
  });

  it('rejects whitespace-only public identifiers', () => {
    expect(() =>
      createExerciseRun({
        id: '   ',
        scenarioVersionId: 'scenario-version-shared-contract',
        virtualStartAt: '2023-03-22T07:00:00.000Z',
        compatibilityMode: 'collaborative_v2',
      }),
    ).toThrowError(
      expect.objectContaining<Partial<DomainError>>({
        code: 'INVALID_DOMAIN_VALUE',
      }),
    );
  });

  it('canonicalizes nested arrays and objects without locale-dependent key order', () => {
    expect(
      canonicalJson({
        z: [3, { b: true, a: null }],
        a: 'first',
      }),
    ).toBe('{"a":"first","z":[3,{"a":null,"b":true}]}');
  });

  it('deep-clones and freezes canonical arrays and objects', () => {
    const sourceEntry = { value: 'original' };
    const source = {
      nested: [sourceEntry],
    } satisfies CanonicalJsonValue;
    const cloned = cloneAndFreezeCanonicalJson(source) as {
      readonly nested: readonly [{ readonly value: string }];
    };

    sourceEntry.value = 'changed';

    expect(cloned).not.toBe(source);
    expect(cloned.nested).not.toBe(source.nested);
    expect(cloned.nested[0]).not.toBe(sourceEntry);
    expect(cloned.nested[0].value).toBe('original');
    expect(Object.isFrozen(cloned)).toBe(true);
    expect(Object.isFrozen(cloned.nested)).toBe(true);
    expect(Object.isFrozen(cloned.nested[0])).toBe(true);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'rejects a non-finite canonical JSON number: %s',
    (value) => {
      expect(() => canonicalJson(value)).toThrowError(
        expect.objectContaining<Partial<DomainError>>({
          code: 'INVALID_CANONICAL_JSON',
        }),
      );
      expect(() => cloneAndFreezeCanonicalJson(value)).toThrowError(
        expect.objectContaining<Partial<DomainError>>({
          code: 'INVALID_CANONICAL_JSON',
        }),
      );
    },
  );

  it('rejects cycles while cloning canonical JSON', () => {
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    expect(() =>
      cloneAndFreezeCanonicalJson(cyclic as CanonicalJsonValue),
    ).toThrowError(
      expect.objectContaining<Partial<DomainError>>({
        code: 'INVALID_CANONICAL_JSON',
      }),
    );
  });

  it('freezes a copied array without aliasing the caller array', () => {
    const source = ['evidence', 'hydraulics'];
    const frozen = freezeArray(source);
    source.push('ecology');

    expect(frozen).toEqual(['evidence', 'hydraulics']);
    expect(Object.isFrozen(frozen)).toBe(true);
  });
});
