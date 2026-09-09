import { describe, expect, it } from 'vitest';
import { reconcileObservations } from '../src/reconciliation.js';

const plan = {
  keys: [
    {
      name: 'station',
      leftField: 'station',
      rightField: 'station',
      type: 'text' as const,
      trim: false,
    },
  ],
  left: {
    valueField: 'value',
    measure: { field: 'measure' },
    unit: { field: 'unit' },
  },
  right: {
    valueField: 'value',
    measure: { field: 'measure' },
    unit: { field: 'unit' },
  },
  unitConversions: [],
  conflictPolicy: 'preserve' as const,
};
const row = (
  recordId: string,
  station: unknown,
  value: unknown,
  extra = {},
) => ({
  recordId,
  index: Number(recordId.slice(1)) || 1,
  values: { station, value, measure: 'level', unit: 'm', ...extra },
});

describe('non-destructive business observation reconciliation', () => {
  it('counts two CSV/XLSX representations as four records and two candidate observations', () => {
    const output = reconcileObservations(
      plan,
      [row('a1', '001', 1), row('a2', '002', 0)],
      [row('b1', '001', '1.00'), row('b2', '002', '0')],
    );
    expect(output.summary).toMatchObject({
      parsedRecordCount: 4,
      candidateObservationCount: 2,
      duplicateRecordCount: 2,
      conflictCount: 0,
      incompleteRecordCount: 0,
      relation: 'FORMAT_COPY_CANDIDATE',
    });
    expect(
      output.groups
        .flatMap((g) => g.members)
        .map((r) => r.recordId)
        .sort(),
    ).toEqual(['a1', 'a2', 'b1', 'b2']);
  });
  it('retains added observations and conflicting corrections without choosing a winner', () => {
    const output = reconcileObservations(
      plan,
      [row('a1', '001', 1)],
      [row('b1', '001', 2), row('b2', '002', 3)],
    );
    expect(output.summary).toMatchObject({
      candidateObservationCount: null,
      conflictCount: 1,
      addedCount: 1,
      relation: 'UNRESOLVED',
    });
    expect(
      output.groups.find((g) => g.status === 'CONFLICT')?.selectedRecordId,
    ).toBeNull();
  });
  it('applies explicit revision precedence while preserving old and new record references', () => {
    const output = reconcileObservations(
      { ...plan, conflictPolicy: 'right-revises-left' },
      [row('a1', '001', 1)],
      [row('b1', '001', 2), row('b2', '002', 3)],
    );
    expect(output.summary).toMatchObject({
      candidateObservationCount: 2,
      revisedCount: 1,
      addedCount: 1,
      relation: 'REVISION',
    });
    expect(output.groups.find((g) => g.status === 'REVISED')).toMatchObject({
      selectedRecordId: 'b1',
      members: [{ recordId: 'a1' }, { recordId: 'b1' }],
    });
  });
  it('keeps same-side conflicting values unresolved even with revision precedence', () => {
    const output = reconcileObservations(
      { ...plan, conflictPolicy: 'right-revises-left' },
      [row('a1', '001', 1)],
      [row('b1', '001', 2), row('b2', '001', 3)],
    );
    expect(output.summary.candidateObservationCount).toBeNull();
    expect(output.summary.conflictCount).toBe(1);
  });
  it('never merges distinct measures, units or leading-zero identifiers', () => {
    const output = reconcileObservations(
      plan,
      [row('a1', '001', 0)],
      [
        row('b1', '001', 0, { measure: 'flow' }),
        row('b2', '001', 0, { unit: 'cm' }),
        row('b3', '1', 0),
      ],
    );
    expect(output.summary.candidateObservationCount).toBe(4);
    expect(output.summary.duplicateRecordCount).toBe(0);
  });
  it('preserves null, missing, blank and zero as different states and blocks incomplete counts', () => {
    const output = reconcileObservations(
      plan,
      [row('a1', '001', 0)],
      [
        row('b1', '001', null),
        row('b2', '001', undefined),
        row('b3', '', 0),
        row('b4', '001', ''),
      ],
    );
    expect(output.summary).toMatchObject({
      candidateObservationCount: null,
      incompleteRecordCount: 4,
      duplicateRecordCount: 0,
    });
    expect(output.groups.flatMap((g) => g.members)).toHaveLength(5);
  });
  it('normalizes decimal units exactly only under explicit conversion rules', () => {
    const output = reconcileObservations(
      {
        ...plan,
        unitConversions: [{ from: 'cm', to: 'm', factor: '0.01', offset: '0' }],
      },
      [row('a1', '001', '0.29')],
      [row('b1', '001', '29', { unit: 'cm' })],
    );
    expect(output.summary).toMatchObject({
      candidateObservationCount: 1,
      duplicateRecordCount: 1,
      relation: 'FORMAT_COPY_CANDIDATE',
    });
    expect(
      reconcileObservations(
        plan,
        [row('a1', '001', '9007199254740993')],
        [row('b1', '001', '9007199254740992')],
      ).summary.conflictCount,
    ).toBe(1);
  });
  it('normalizes explicit-offset instants without accepting invalid dates or naive times', () => {
    const timePlan = {
      ...plan,
      keys: [
        ...plan.keys,
        {
          name: 'time',
          leftField: 'time',
          rightField: 'time',
          type: 'iso-time' as const,
          trim: false,
        },
      ],
    };
    const output = reconcileObservations(
      timePlan,
      [row('a1', '001', 1, { time: '2026-01-01T08:00:00+08:00' })],
      [
        row('b1', '001', 1, { time: '2026-01-01T00:00:00Z' }),
        row('b2', '001', 1, { time: '2026-02-30T00:00:00Z' }),
        row('b3', '001', 1, { time: '2026-01-01T00:00:00' }),
      ],
    );
    expect(output.summary).toMatchObject({
      duplicateRecordCount: 1,
      incompleteRecordCount: 2,
      candidateObservationCount: null,
    });
  });
  it('rejects document fragments as observations and never mutates originals', () => {
    const left = [row('a1', '001', 1, { __kind: 'DOCUMENT_PARAGRAPH' })];
    const before = structuredClone(left);
    const output = reconcileObservations(plan, left, [row('b1', '001', 1)]);
    expect(output.summary.incompleteRecordCount).toBe(1);
    expect(output.summary.candidateObservationCount).toBeNull();
    expect(left).toEqual(before);
  });
  it('does not claim an empty pair is a format copy', () => {
    expect(reconcileObservations(plan, [], []).summary).toMatchObject({
      candidateObservationCount: 0,
      relation: 'DISJOINT',
    });
  });
});
