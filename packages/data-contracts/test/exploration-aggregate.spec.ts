import { describe, expect, it } from 'vitest';
import { ExplorationQueryInputSchema } from '../src/exploration/index.js';
const queryId = '10000000-0000-4000-8000-000000000001';
const versionId = '20000000-0000-4000-8000-000000000001';
const assetId = '30000000-0000-4000-8000-000000000001';
const aggregate = {
  assetId,
  groupBy: { field: 'c1', type: 'text' },
  measure: { operation: 'mean', field: 'c3', unitField: 'c4' },
};
describe('bounded single-source aggregation', () => {
  it('accepts explicit scalar groups and source-unit-separated measures on an authorized query', () => {
    expect(
      ExplorationQueryInputSchema.safeParse({
        queryId,
        versionId,
        view: 'aggregate',
        aggregate,
      }).success,
    ).toBe(true);
  });
  it('accepts counts and numeric histogram intervals without row pagination', () => {
    expect(
      ExplorationQueryInputSchema.safeParse({
        queryId,
        versionId,
        view: 'aggregate',
        aggregate: {
          assetId,
          groupBy: { field: 'c3', type: 'number', interval: 10 },
          measure: { operation: 'count' },
        },
      }).success,
    ).toBe(true);
  });
  it.each([
    { spec: {}, versionId, view: 'aggregate', aggregate },
    { queryId, view: 'aggregate', aggregate },
    { queryId, versionId, view: 'aggregate' },
    { queryId, versionId, view: 'resources', aggregate },
    { queryId, versionId, view: 'aggregate', aggregate, after: 'cursor' },
    {
      queryId,
      versionId,
      view: 'aggregate',
      aggregate: { ...aggregate, measure: { operation: 'sql', field: 'c3' } },
    },
    {
      queryId,
      versionId,
      view: 'aggregate',
      aggregate: {
        ...aggregate,
        groupBy: { field: 'c3', type: 'number', interval: 0 },
      },
    },
  ])(
    'rejects unbound, ambiguous or executable aggregation input %#',
    (input) => {
      expect(ExplorationQueryInputSchema.safeParse(input).success).toBe(false);
    },
  );
});
