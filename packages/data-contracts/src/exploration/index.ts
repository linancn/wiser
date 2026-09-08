import { z } from 'zod';
import {
  ExplorationQueryInputV17Schema,
  ExplorationResultV17Schema,
  QuerySpecSchema as PreviousSpec,
  RecordQuerySchema as PreviousRecordQuery,
  RecordFilterSchema as PreviousFilter,
} from './v17.ts';
import {
  ExplorationAggregateSpecSchema,
  ExplorationAggregateSchema,
  type ExplorationAggregateSpec,
} from './aggregate.ts';
import {
  ExplorationTimeFilterSchema,
  ExplorationTimeSortSchema,
} from './time.ts';
export * from './v17.ts';
export {
  ExplorationAggregateSpecSchema,
  ExplorationAggregateSchema,
} from './aggregate.ts';
export type {
  ExplorationAggregateSpec,
  ExplorationAggregate,
} from './aggregate.ts';
export * from './time.ts';
export const RecordFilterSchema = z.discriminatedUnion('type', [
  ...PreviousFilter.options,
  ExplorationTimeFilterSchema,
]);
export const RecordQuerySchema = PreviousRecordQuery.extend({
  filters: z.array(RecordFilterSchema).max(8).default([]),
  sort: z
    .union([PreviousRecordQuery.shape.sort.unwrap(), ExplorationTimeSortSchema])
    .optional(),
});
const QueryShape = z.strictObject({
  ...PreviousSpec.shape,
  recordQuery: RecordQuerySchema.optional(),
});
export const QuerySpecSchema = QueryShape.superRefine((spec, context) => {
  const checked = PreviousSpec.safeParse(previousSpec(spec));
  if (!checked.success)
    for (const issue of checked.error.issues)
      context.addIssue({
        code: 'custom',
        path: issue.path,
        message: issue.message,
      });
});
function previousSpec(spec: z.infer<typeof QueryShape>) {
  return {
    ...spec,
    ...(spec.recordQuery
      ? {
          recordQuery: {
            ...spec.recordQuery,
            filters: spec.recordQuery.filters.filter(
              (filter) => filter.type !== 'time',
            ),
            sort:
              spec.recordQuery.sort?.type === 'time'
                ? undefined
                : spec.recordQuery.sort,
          },
        }
      : {}),
  };
}
function previousAggregate(spec: ExplorationAggregateSpec) {
  return {
    ...spec,
    ...(spec.groupBy?.type === 'time'
      ? { groupBy: { field: spec.groupBy.field, type: 'text' as const } }
      : {}),
  };
}
export const ExplorationQueryInputSchema = z
  .strictObject({
    ...ExplorationQueryInputV17Schema.shape,
    spec: QuerySpecSchema.optional(),
    aggregate: ExplorationAggregateSpecSchema.optional(),
  })
  .superRefine((input, context) => {
    const checked = ExplorationQueryInputV17Schema.safeParse({
      ...input,
      ...(input.spec ? { spec: previousSpec(input.spec) } : {}),
      ...(input.aggregate
        ? { aggregate: previousAggregate(input.aggregate) }
        : {}),
    });
    if (!checked.success)
      for (const issue of checked.error.issues)
        context.addIssue({
          code: 'custom',
          path: issue.path,
          message: issue.message,
        });
  });
export const ExplorationResultSchema = z
  .strictObject({
    ...ExplorationResultV17Schema.shape,
    spec: QuerySpecSchema,
    aggregate: ExplorationAggregateSchema.optional(),
  })
  .superRefine((result, context) => {
    const checked = ExplorationResultV17Schema.safeParse({
      ...result,
      spec: previousSpec(result.spec),
      ...(result.aggregate
        ? {
            aggregate: {
              ...result.aggregate,
              spec: previousAggregate(result.aggregate.spec),
            },
          }
        : {}),
    });
    if (!checked.success)
      for (const issue of checked.error.issues)
        context.addIssue({
          code: 'custom',
          path: issue.path,
          message: issue.message,
        });
  });
export type RecordFilter = z.infer<typeof RecordFilterSchema>;
export type RecordQuery = z.infer<typeof RecordQuerySchema>;
export type QuerySpec = z.infer<typeof QuerySpecSchema>;
export type ExplorationQueryInput = z.infer<typeof ExplorationQueryInputSchema>;
export type ExplorationResult = z.infer<typeof ExplorationResultSchema>;
