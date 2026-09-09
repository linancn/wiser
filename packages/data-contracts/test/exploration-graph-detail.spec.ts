import { expect, it } from 'vitest';
import { ExplorationQueryInputSchema } from '../src/exploration/index.js';
const id = '10000000-0000-4000-8000-000000000001';
it('bounds graph neighbors and rejects ambiguous focus or non-graph options', () => {
  const base = { queryId: id, view: 'graph', versionId: id };
  expect(
    ExplorationQueryInputSchema.safeParse({
      ...base,
      graph: { detail: 'assets' },
    }).success,
  ).toBe(true);
  expect(
    ExplorationQueryInputSchema.safeParse({
      ...base,
      assetId: id,
      graph: {
        detail: 'records',
        relations: ['HAS_RECORD'],
        path: { from: 'a', to: 'b', maxDepth: 8 },
      },
    }).success,
  ).toBe(true);
  for (const value of [
    { ...base, versionId: undefined, graph: { detail: 'assets' } },
    { ...base, graph: { detail: 'records' } },
    { ...base, recordId: id, graph: { detail: 'assets' } },
    { ...base, view: 'records', graph: {} },
    { ...base, graph: { relations: ['invented'] } },
    { ...base, graph: { relations: ['HAS_RECORD', 'HAS_RECORD'] } },
    { ...base, graph: { path: { from: 'a', to: 'b', maxDepth: 9 } } },
  ])
    expect(ExplorationQueryInputSchema.safeParse(value).success).toBe(false);
});
