import { describe, expect, it } from 'vitest';
import { ExplorationQueryInputSchema } from '../src/exploration/index.js';

const version = {
  dataItemId: '20000000-0000-4000-8000-000000000001',
  versionId: '30000000-0000-4000-8000-000000000001',
};
const assetId = '40000000-0000-4000-8000-000000000001';
const recordQuery = {
  assetId,
  filters: [
    { field: 'c1', type: 'text', operator: 'eq', value: '00000001' },
    { field: 'c2', type: 'number', operator: 'gte', value: 0 },
  ],
  sort: { field: 'c2', type: 'number', direction: 'desc' },
  columns: ['c1', 'c2'],
};
describe('version-bound record query contract', () => {
  it('accepts typed filters, stable sorting and selected columns for one immutable version and asset', () => {
    const input = {
      spec: { versions: [version], recordQuery },
      view: 'resources',
    };
    expect(ExplorationQueryInputSchema.safeParse(input).success).toBe(true);
  });
  it.each([
    { versions: undefined, recordQuery },
    { versions: [version, { ...version, versionId: assetId }], recordQuery },
    {
      versions: [version],
      recordQuery: {
        ...recordQuery,
        filters: [{ field: 'c1', type: 'sql', operator: 'eq', value: 'x' }],
      },
    },
    {
      versions: [version],
      recordQuery: {
        ...recordQuery,
        filters: [{ field: 'c2', type: 'number', operator: 'gte', value: '2' }],
      },
    },
    {
      versions: [version],
      recordQuery: { ...recordQuery, columns: ['c1', 'c1'] },
    },
    {
      versions: [version],
      recordQuery: {
        ...recordQuery,
        filters: Array.from({ length: 9 }, () => recordQuery.filters[0]),
      },
    },
  ])('rejects unbound or ambiguous record conditions %#', (spec) => {
    expect(
      ExplorationQueryInputSchema.safeParse({ spec, view: 'resources' })
        .success,
    ).toBe(false);
  });
});
