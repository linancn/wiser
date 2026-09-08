import { z } from 'zod';
const Field = z.string().min(1).max(128);
const Count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const ExplorationAggregateSpecSchema = z.strictObject({
  assetId: z.uuid(),
  groupBy: z
    .discriminatedUnion('type', [
      z.strictObject({ field: Field, type: z.literal('text') }),
      z.strictObject({
        field: Field,
        type: z.literal('number'),
        interval: z.number().finite().positive(),
      }),
    ])
    .optional(),
  measure: z.union([
    z.strictObject({ operation: z.literal('count') }),
    z.strictObject({
      operation: z.enum(['sum', 'mean', 'min', 'max']),
      field: Field,
      unitField: Field.optional(),
    }),
  ]),
});
export const ExplorationAggregateSchema = z
  .strictObject({
    spec: ExplorationAggregateSpecSchema,
    groupCount: Count,
    truncated: z.boolean(),
    groups: z
      .array(
        z.strictObject({
          key: z.string().max(4096).nullable(),
          upperBound: z.string().max(4096).nullable(),
          unit: z.string().max(4096).nullable(),
          count: Count,
          validCount: Count,
          missingCount: Count,
          invalidCount: Count,
          value: z.string().max(4096).nullable(),
        }),
      )
      .max(200),
  })
  .superRefine((result, context) => {
    if (
      result.groups.some(
        (group) =>
          group.validCount + group.missingCount + group.invalidCount !==
          group.count,
      ) ||
      result.groupCount < result.groups.length ||
      result.truncated !== result.groupCount > result.groups.length
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Aggregate coverage must reconcile',
      });
    }
  });
export type ExplorationAggregateSpec = z.infer<
  typeof ExplorationAggregateSpecSchema
>;
export type ExplorationAggregate = z.infer<typeof ExplorationAggregateSchema>;
