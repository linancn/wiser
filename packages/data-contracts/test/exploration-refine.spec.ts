import { expect, it } from 'vitest';
import { ExplorationQueryInputSchema } from '../src/exploration/index.js';
const id = '10000000-0000-4000-8000-000000000001';
it('accepts refinement only when creating a fresh specification from an authorized base query', () => {
  expect(
    ExplorationQueryInputSchema.safeParse({
      baseQueryId: id,
      spec: {},
      view: 'resources',
    }).success,
  ).toBe(true);
  for (const input of [
    { baseQueryId: id, queryId: id, view: 'resources' },
    { baseQueryId: id, view: 'resources' },
    { baseQueryId: 'not-a-query', spec: {}, view: 'resources' },
  ])
    expect(ExplorationQueryInputSchema.safeParse(input).success).toBe(false);
});
