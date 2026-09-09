import { expect, it } from 'vitest';
import { findExplorationPath } from '../src/exploration-path.js';
const nodes = ['a', 'b', 'c', 'd', 'isolated'].map((id) => ({ id }));
const edges = [
  { id: 'ac', source: 'a', target: 'c' },
  { id: 'ab', source: 'a', target: 'b' },
  { id: 'bd', source: 'b', target: 'd' },
  { id: 'cd', source: 'c', target: 'd' },
  { id: 'da', source: 'd', target: 'a' },
];
it('returns a deterministic directed shortest path and respects the depth budget', () => {
  expect(
    findExplorationPath({ nodes, edges }, { from: 'a', to: 'd', maxDepth: 8 }),
  ).toEqual({ found: true, nodeIds: ['a', 'b', 'd'], edgeIds: ['ab', 'bd'] });
  expect(
    findExplorationPath(
      { nodes, edges: [...edges].reverse() },
      { from: 'a', to: 'd', maxDepth: 8 },
    ),
  ).toEqual({ found: true, nodeIds: ['a', 'b', 'd'], edgeIds: ['ab', 'bd'] });
  expect(
    findExplorationPath({ nodes, edges }, { from: 'a', to: 'd', maxDepth: 1 }),
  ).toEqual({ found: false, nodeIds: [], edgeIds: [] });
  expect(
    findExplorationPath(
      { nodes, edges },
      { from: 'a', to: 'isolated', maxDepth: 8 },
    ).found,
  ).toBe(false);
  expect(
    findExplorationPath({ nodes, edges }, { from: 'a', to: 'a', maxDepth: 1 }),
  ).toEqual({ found: true, nodeIds: ['a'], edgeIds: [] });
  expect(
    findExplorationPath(
      { nodes, edges },
      { from: 'outside', to: 'outside', maxDepth: 8 },
    ).found,
  ).toBe(false);
  expect(
    findExplorationPath(
      { nodes, edges: [{ id: 'foreign', source: 'a', target: 'outside' }] },
      { from: 'a', to: 'outside', maxDepth: 8 },
    ).found,
  ).toBe(false);
});
