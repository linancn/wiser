import type { RecordQuery } from '@wiser/data-contracts';
import type { QueryAdapterPgClient } from './query-adapters.js';

/** Evaluate each typed source field once, then count and sort narrow identities. */
export async function queryFilteredRecords(
  client: QueryAdapterPgClient,
  input: {
    readonly analysisId: string | null;
    readonly assetId: string;
    readonly recordId?: string;
    readonly first: number;
    readonly offset: number;
    readonly query: RecordQuery;
  },
) {
  const parameters: unknown[] = [
    input.analysisId,
    input.assetId,
    input.recordId ?? null,
  ];
  const bind = (value: unknown, type: string) => {
    parameters.push(value);
    return `$${parameters.length}::${type}`;
  };
  const fields = new Map<string, string>();
  const expressions: string[] = [];
  const scalar = (field: string, type: 'text' | 'number' | 'presence') => {
    const key = `${type}:${field}`;
    const existing = fields.get(key);
    if (existing) return existing;
    const name = `field_${fields.size}`;
    const parameter = bind(field, 'text');
    const value = `r.record_values->(${parameter})`;
    const expression =
      type === 'number'
        ? `service.exploration_number(${value})`
        : type === 'presence'
          ? `(nullif(${value},'null'::jsonb) is not null)`
          : `(case when jsonb_typeof(${value}) in ('string','number','boolean') then r.record_values->>(${parameter}) end)`;
    expressions.push(`${expression} ${name}`);
    fields.set(key, name);
    return name;
  };
  const operators = {
    eq: '=',
    ne: '<>',
    gt: '>',
    gte: '>=',
    lt: '<',
    lte: '<=',
  } as const;
  const predicates = input.query.filters.map((filter) => {
    const field = scalar(filter.field, filter.type);
    if (filter.type === 'presence')
      return filter.operator === 'isNull' ? `not ${field}` : field;
    const value = bind(
      filter.value,
      filter.type === 'number' ? 'numeric' : 'text',
    );
    return filter.operator === 'contains'
      ? `strpos(${field},${value})>0`
      : `${field} ${operators[filter.operator]} ${value}`;
  });
  const sort = input.query.sort;
  const sortField = sort ? scalar(sort.field, sort.type) : null;
  const order = (prefix = '') =>
    sort
      ? `${prefix}${sortField}${sort.type === 'text' ? ' collate "C"' : ''} ${sort.direction} nulls last,${prefix}record_index`
      : `${prefix}record_index`;
  const limit = bind(input.first + 1, 'integer');
  const offset = bind(input.offset, 'integer');
  const result = await client.query(
    `with valued as materialized (
    select r.record_id,r.record_index${expressions.length ? `,${expressions.join(',')}` : ''} from catalog.analysis_record r
    where r.analysis_id=$1::uuid and r.asset_id=$2::uuid and ($3::uuid is null or r.record_id=$3::uuid)
  ), matched as materialized (select * from valued where ${predicates.length ? predicates.join(' and ') : 'true'}),
  page as (select * from matched order by ${order()} limit ${limit} offset ${offset})
  select counted.total,r.*,st_asgeojson(r.geom)::jsonb geometry
  from (select count(*)::text total from matched) counted left join page on true
  left join catalog.analysis_record r on r.analysis_id=$1::uuid and r.record_id=page.record_id order by ${order('page.')}`,
    parameters,
  );
  return {
    total: result.rows[0]?.['total'],
    rows: result.rows.filter((row) => row['record_id'] !== null),
  };
}
