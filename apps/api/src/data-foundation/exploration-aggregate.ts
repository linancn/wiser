import { z } from 'zod';
import {
  ExplorationAggregateSchema,
  type ExplorationQueryInput,
  type QuerySpec,
} from '@wiser/data-contracts';
import { DataCapabilityHandlerError } from './capability-handler.js';
import type { AnalysisVersionRef } from './exploration-views.js';
import type { QueryAdapterPgClient } from './query-adapters.js';
import { recordProjection } from './exploration-record-sql.js';

const Count = z.coerce
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);
export async function queryAggregate(
  client: QueryAdapterPgClient,
  refs: readonly AnalysisVersionRef[],
  input: ExplorationQueryInput,
  spec: QuerySpec,
) {
  const aggregate = input.aggregate;
  if (!aggregate) throw new DataCapabilityHandlerError('VALIDATION_FAILED');
  const ref = refs.find((entry) => entry.versionId === input.versionId);
  if (
    !ref?.analysisId ||
    (spec.recordQuery && spec.recordQuery.assetId !== aggregate.assetId)
  )
    throw new DataCapabilityHandlerError('NOT_FOUND');
  const metadata = await client.query(
    'select columns from service.analysis_asset where analysis_id=$1::uuid and asset_id=$2::uuid',
    [ref.analysisId, aggregate.assetId],
  );
  if (!metadata.rows[0]) throw new DataCapabilityHandlerError('NOT_FOUND');
  const fields = new Set(
    z
      .array(z.object({ key: z.string() }))
      .parse(metadata.rows[0]['columns'])
      .map((column) => column.key),
  );
  const measure = aggregate.measure;
  const requested = [
    aggregate.groupBy?.field,
    ...('field' in measure ? [measure.field, measure.unitField] : []),
  ].filter((field) => field !== undefined);
  if (requested.some((field) => !fields.has(field)))
    throw new DataCapabilityHandlerError('VALIDATION_FAILED');
  const parameters: unknown[] = [ref.analysisId, aggregate.assetId];
  const { bind, scalar, predicates, expressions } =
    recordProjection(parameters);
  const where = predicates(spec.recordQuery?.filters ?? []);
  const group = aggregate.groupBy;
  const grouping = group
    ? scalar(group.field, group.type, group.type === 'time' ? group : undefined)
    : null;
  const interval =
    group?.type === 'number' ? bind(group.interval, 'numeric') : null;
  const offset =
    group?.type === 'time' ? bind(group.utcOffsetMinutes, 'integer') : null;
  const calendar = group?.type === 'time' ? bind(group.bucket, 'text') : null;
  const timeKey = `((date_trunc(${calendar},${grouping} at time zone 'UTC'+make_interval(mins=>${offset}))-make_interval(mins=>${offset})) at time zone 'UTC')`;
  const instantText = (expression: string) =>
    `to_char((${expression}) at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
  const key =
    group?.type === 'time'
      ? instantText(timeKey)
      : group?.type === 'number'
        ? `(floor(${grouping}/${interval})*${interval})::text`
        : grouping
          ? `(case when length(${grouping})<=4096 then ${grouping} end)`
          : 'null::text';
  const numeric =
    'field' in measure ? scalar(measure.field, 'number') : '1::numeric';
  const present =
    'field' in measure ? scalar(measure.field, 'presence') : 'true';
  const unit =
    'unitField' in measure && measure.unitField
      ? scalar(measure.unitField, 'text')
      : null;
  const operation = {
    count: 'count(*)',
    sum: `sum(value)`,
    mean: `avg(value)`,
    min: `min(value)`,
    max: `max(value)`,
  }[measure.operation];
  const upperBound =
    group?.type === 'time'
      ? instantText(
          `(((page.key::timestamptz at time zone 'UTC')+make_interval(mins=>${offset})+${bind(`1 ${group.bucket}`, 'interval')}-make_interval(mins=>${offset})) at time zone 'UTC')`,
        )
      : group?.type === 'number'
        ? `(page.key::numeric+${interval})::text`
        : 'null::text';
  const result = await client.query(
    `with valued as materialized (
    select ${expressions.length ? expressions.join(',') : '1 placeholder'} from catalog.analysis_record r where r.analysis_id=$1::uuid and r.asset_id=$2::uuid
  ), matched as (select ${key} key,${unit ? `(case when length(${unit})<=4096 then ${unit} end)` : 'null::text'} unit,${numeric} value,${present} present from valued where ${where.length ? where.join(' and ') : 'true'}),
  grouped as materialized (
    select key,unit,count(*)::text count,count(value)::text valid_count,count(*) filter(where not present)::text missing_count,count(*) filter(where present and value is null)::text invalid_count,(${operation})::text value
    from matched group by key,unit
  ) select totals.*,page.*,${upperBound} upper_bound from (select count(*)::text group_count,coalesce(sum(count::numeric),0)::text total from grouped) totals
  left join lateral (select * from grouped order by ${group?.type === 'number' ? 'key::numeric' : 'key collate "C"'} nulls last,unit collate "C" nulls last limit 200) page on true`,
    parameters,
  );
  const groupCount = Count.parse(result.rows[0]?.['group_count']);
  return {
    view: 'aggregate' as const,
    resources: [],
    totalCount: Count.parse(result.rows[0]?.['total']),
    aggregate: ExplorationAggregateSchema.parse({
      spec: aggregate,
      groupCount,
      truncated: groupCount > 200,
      groups: result.rows
        .filter((row) => row['count'] !== null)
        .map((row) => ({
          key: row['key'],
          upperBound: row['upper_bound'],
          unit: row['unit'],
          count: Count.parse(row['count']),
          validCount: Count.parse(row['valid_count']),
          missingCount: Count.parse(row['missing_count']),
          invalidCount: Count.parse(row['invalid_count']),
          value: row['value'],
        })),
    }),
  };
}
