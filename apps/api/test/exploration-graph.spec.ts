import { expect, it, vi } from 'vitest';
import { ExplorationQueryInputSchema } from '@wiser/data-contracts';
import { queryProvenanceGraph } from '../src/data-foundation/exploration-graph.js';
import type { QueryAdapterPgClient } from '../src/data-foundation/query-adapters.js';
const id = '10000000-0000-4000-8000-000000000001';
const second = '20000000-0000-4000-8000-000000000001';
const refs = [{ dataItemId: id, versionId: id, analysisId: id }];
const asset = {
  asset_id: id,
  version_id: id,
  data_item_id: id,
  media_type: 'application/json',
  source_hash: 'a'.repeat(64),
  source_paths: [{ path: 'source.json' }],
  total: '2',
};
const resource = {
  data_item_id: id,
  name: 'Source',
  version_id: id,
  version_number: 1,
  source_hash: 'a'.repeat(64),
};
function client() {
  const query = vi
    .fn<QueryAdapterPgClient['query']>()
    .mockImplementation((sql, parameters) => {
      if (sql.includes('join catalog.data_item_version'))
        return Promise.resolve({ rows: [resource] });
      if (sql.includes('from catalog.asset'))
        return Promise.resolve({
          rows:
            parameters?.[3] === 1
              ? [{ ...asset, asset_id: second }]
              : [asset, { ...asset, asset_id: second }],
        });
      if (sql.includes('from knowledge.evidence_fragment'))
        return Promise.resolve({
          rows:
            parameters?.[1] === 0
              ? []
              : [
                  {
                    evidence_id: id,
                    version_id: id,
                    data_item_id: id,
                    total: '1',
                  },
                ],
        });
      throw new Error('Unexpected database operation');
    });
  return { query, release() {} };
}
const input = (extra: Record<string, unknown> = {}) =>
  ExplorationQueryInputSchema.parse({
    queryId: id,
    versionId: id,
    view: 'graph',
    first: 1,
    ...extra,
  });
it('pages asset neighbors with exact grain and rejects cursors reused for evidence or other filters', async () => {
  const db = client();
  const first = await queryProvenanceGraph(
    db,
    refs,
    id,
    input({ graph: { detail: 'assets' } }),
  );
  expect(first.totalCount).toBe(2);
  expect(first.graph.grain).toBe('assets');
  expect(
    first.graph.nodes.filter((n) => n.kind === 'ASSET').map((n) => n.assetId),
  ).toEqual([id]);
  const next = await queryProvenanceGraph(
    db,
    refs,
    id,
    input({ graph: { detail: 'assets' }, after: first.nextCursor }),
  );
  expect(
    next.graph.nodes.filter((n) => n.kind === 'ASSET').map((n) => n.assetId),
  ).toEqual([second]);
  expect(next.nextCursor).toBeUndefined();
  await expect(
    queryProvenanceGraph(
      db,
      refs,
      id,
      input({ graph: { detail: 'evidence' }, after: first.nextCursor }),
    ),
  ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  await expect(
    queryProvenanceGraph(
      db,
      refs,
      id,
      input({
        graph: { detail: 'assets', relations: [] },
        after: first.nextCursor,
      }),
    ),
  ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  const evidence = await queryProvenanceGraph(
    db,
    refs,
    id,
    input({ graph: { detail: 'evidence' } }),
  );
  expect(evidence.graph.nodes.map((n) => n.kind)).toEqual([
    'RESOURCE',
    'VERSION',
    'EVIDENCE',
  ]);
  expect(evidence.totalCount).toBe(1);
});
it('finds directed paths only through returned relations and refuses outside endpoints', async () => {
  const db = client();
  const path = {
    from: `resource:${id}:${id}`,
    to: `asset:${id}:${id}`,
    maxDepth: 8,
  };
  const graph = await queryProvenanceGraph(
    db,
    refs,
    id,
    input({ graph: { detail: 'assets', path } }),
  );
  expect(graph.graph.path).toMatchObject({
    found: true,
    nodeIds: [path.from, `version:${id}`, path.to],
  });
  const hidden = await queryProvenanceGraph(
    db,
    refs,
    id,
    input({ graph: { detail: 'assets', path, relations: [] } }),
  );
  expect(hidden.graph.edges).toEqual([]);
  expect(hidden.graph.path?.found).toBe(false);
  await expect(
    queryProvenanceGraph(
      db,
      refs,
      id,
      input({ graph: { detail: 'assets', path: { ...path, to: 'outside' } } }),
    ),
  ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  await expect(
    queryProvenanceGraph(db, refs, id, input({ versionId: second })),
  ).rejects.toMatchObject({ code: 'NOT_FOUND' });
});
it('discloses bounded overview truncation and retains source hashes and exact record provenance', async () => {
  const db = client();
  db.query
    .mockResolvedValueOnce({ rows: [resource] })
    .mockResolvedValueOnce({
      rows: [
        {
          record_id: id,
          analysis_id: id,
          asset_id: id,
          data_item_id: id,
          version_id: id,
          source_id: null,
          record_index: '0',
          record_values: { c1: '001', c2: 5 },
          spatial: true,
        },
      ],
    })
    .mockResolvedValueOnce({ rows: [asset] })
    .mockResolvedValueOnce({ rows: [] });
  const found = await queryProvenanceGraph(
    db,
    refs,
    id,
    input({ recordId: id }),
    { recordQuery: { assetId: id, filters: [], columns: ['c1'] } },
  );
  expect(
    found.graph.nodes.find((n) => n.kind === 'RECORD')?.record,
  ).toMatchObject({ recordId: id, featureId: id, values: { c1: '001' } });
  expect(found.graph.nodes.find((n) => n.kind === 'ASSET')?.sourceHash).toBe(
    'a'.repeat(64),
  );
  await expect(
    queryProvenanceGraph(db, refs, id, input({ assetId: second }), {
      recordQuery: { assetId: id, filters: [] },
    }),
  ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  const truncated = client();
  truncated.query
    .mockResolvedValueOnce({ rows: [resource] })
    .mockResolvedValueOnce({
      rows: Array.from({ length: 201 }, (_, i) => ({
        ...asset,
        asset_id: `10000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
      })),
    })
    .mockResolvedValueOnce({ rows: [] });
  const overview = await queryProvenanceGraph(truncated, refs, id, input());
  expect(overview.graph.truncated).toBe(true);
  expect(overview.graph.nodes).toHaveLength(202);
});
