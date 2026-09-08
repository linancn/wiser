import { expect, it, vi } from 'vitest';
import { RecordQuerySchema } from '@wiser/data-contracts';
import { queryFilteredRecords } from '../src/data-foundation/exploration-filtered-records.js';
import type { QueryAdapterPgClient } from '../src/data-foundation/query-adapters.js';

it('binds source fields and values as data while reusing one numeric evaluation for filter and sort', async () => {
  const field = 'source"field';
  const value = "literal'); select hidden_records; --";
  const query = vi.fn<QueryAdapterPgClient['query']>().mockResolvedValue({
    rows: [
      { total: '1', record_id: 'record', record_values: { [field]: value } },
    ],
  });
  const result = await queryFilteredRecords(
    { query, release() {} },
    {
      analysisId: 'analysis',
      assetId: 'asset',
      first: 25,
      offset: 0,
      query: RecordQuerySchema.parse({
        assetId: '40000000-0000-4000-8000-000000000001',
        filters: [
          { field: 'number', type: 'number', operator: 'gte', value: 0 },
          { field, type: 'text', operator: 'contains', value },
          { field: 'nullable', type: 'presence', operator: 'isNull' },
        ],
        sort: { field: 'number', type: 'number', direction: 'desc' },
      }),
    },
  );
  const [sql, parameters] = query.mock.calls[0] as Parameters<
    QueryAdapterPgClient['query']
  >;
  expect(sql).not.toContain(field);
  expect(sql).not.toContain(value);
  expect(sql.match(/service.exploration_number/g)).toHaveLength(1);
  expect(parameters).toContain(field);
  expect(parameters).toContain(value);
  expect(parameters?.slice(-2)).toEqual([26, 0]);
  expect(result.total).toBe('1');
  expect(result.rows).toHaveLength(1);
});

it('keeps zero totals without inventing a metadata row as a source record', async () => {
  const query = vi
    .fn<QueryAdapterPgClient['query']>()
    .mockResolvedValue({ rows: [{ total: '0', record_id: null }] });
  const result = await queryFilteredRecords(
    { query, release() {} },
    {
      analysisId: null,
      assetId: 'asset',
      recordId: 'record',
      first: 1,
      offset: 0,
      query: RecordQuerySchema.parse({
        assetId: '40000000-0000-4000-8000-000000000001',
      }),
    },
  );
  expect(result).toEqual({ total: '0', rows: [] });
});
