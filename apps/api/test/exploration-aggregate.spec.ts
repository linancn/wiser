import { expect, it, vi } from 'vitest';
import { ExplorationQueryInputSchema } from '@wiser/data-contracts';
import { queryAggregate } from '../src/data-foundation/exploration-aggregate.js';
import type { QueryAdapterPgClient } from '../src/data-foundation/query-adapters.js';
const id = '10000000-0000-4000-8000-000000000001';
const input = ExplorationQueryInputSchema.parse({
  queryId: id,
  versionId: id,
  view: 'aggregate',
  aggregate: {
    assetId: id,
    groupBy: { field: 'number', type: 'number', interval: 10 },
    measure: { operation: 'mean', field: 'number', unitField: 'unit' },
  },
});
it('binds source fields, reuses numeric expressions and preserves empty aggregate coverage', async () => {
  const query = vi
    .fn<QueryAdapterPgClient['query']>()
    .mockResolvedValueOnce({
      rows: [{ columns: [{ key: 'number' }, { key: 'unit' }] }],
    })
    .mockResolvedValueOnce({
      rows: [{ group_count: '0', total: '0', count: null }],
    });
  const result = await queryAggregate(
    { query, release() {} },
    [{ dataItemId: id, versionId: id, analysisId: id }],
    input,
    {},
  );
  expect(result).toMatchObject({
    view: 'aggregate',
    totalCount: 0,
    aggregate: { groups: [], groupCount: 0, truncated: false },
  });
  const [sql, parameters] = query.mock.calls[1] as Parameters<
    QueryAdapterPgClient['query']
  >;
  expect(sql.match(/service\.exploration_number\(/g)).toHaveLength(1);
  expect(parameters).toContain('number');
  expect(parameters).toContain('unit');
  expect(sql).toContain('limit 200');
});
it('refuses another asset or unavailable analysis before reading source data', async () => {
  const query = vi.fn<QueryAdapterPgClient['query']>();
  const client = { query, release() {} };
  await expect(queryAggregate(client, [], input, {})).rejects.toMatchObject({
    code: 'NOT_FOUND',
  });
  await expect(
    queryAggregate(
      client,
      [{ dataItemId: id, versionId: id, analysisId: id }],
      input,
      {
        recordQuery: {
          assetId: '20000000-0000-4000-8000-000000000001',
          filters: [],
        },
      },
    ),
  ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  expect(query).not.toHaveBeenCalled();
});
it('validates every grouping, measure and unit field against the pinned asset schema', async () => {
  const query = vi
    .fn<QueryAdapterPgClient['query']>()
    .mockResolvedValue({ rows: [{ columns: [{ key: 'number' }] }] });
  await expect(
    queryAggregate(
      { query, release() {} },
      [{ dataItemId: id, versionId: id, analysisId: id }],
      input,
      {},
    ),
  ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  expect(query).toHaveBeenCalledTimes(1);
});
