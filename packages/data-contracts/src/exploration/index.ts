import { z } from 'zod';
import {
  QuerySpecSchema as PreviousQuerySpec,
  ExplorationQueryInputV15Schema,
  ExplorationResultV15Schema,
} from './v15.ts';
export * from './v15.ts';

const Field = z.string().min(1).max(128);
export const RecordFilterSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('text'),
    field: Field,
    operator: z.enum(['eq', 'ne', 'contains']),
    value: z.string().max(512),
  }),
  z.strictObject({
    type: z.literal('number'),
    field: Field,
    operator: z.enum(['eq', 'ne', 'gt', 'gte', 'lt', 'lte']),
    value: z.number().finite(),
  }),
  z.strictObject({
    type: z.literal('presence'),
    field: Field,
    operator: z.enum(['isNull', 'isNotNull']),
  }),
]);
export const RecordQuerySchema = z.strictObject({
  assetId: z.uuid(),
  filters: z.array(RecordFilterSchema).max(8).default([]),
  sort: z
    .strictObject({
      field: Field,
      type: z.enum(['text', 'number']),
      direction: z.enum(['asc', 'desc']),
    })
    .optional(),
  columns: z
    .array(Field)
    .min(1)
    .max(32)
    .refine(
      (fields) => new Set(fields).size === fields.length,
      'Columns must be unique',
    )
    .optional(),
});
export const QuerySpecSchema = PreviousQuerySpec.extend({
  recordQuery: RecordQuerySchema.optional(),
}).superRefine((spec, context) => {
  if (spec.recordQuery && spec.versions?.length !== 1)
    context.addIssue({
      code: 'custom',
      path: ['recordQuery'],
      message: 'Record conditions require one explicit immutable version',
    });
});
export const ExplorationQueryInputSchema = z
  .strictObject({
    ...ExplorationQueryInputV15Schema.shape,
    spec: QuerySpecSchema.optional(),
  })
  .superRefine((input, context) => {
    const { recordQuery: _recordQuery, ...previousSpec } = input.spec ?? {};
    const checked = ExplorationQueryInputV15Schema.safeParse({
      ...input,
      ...(input.spec === undefined ? {} : { spec: previousSpec }),
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
    ...ExplorationResultV15Schema.shape,
    spec: QuerySpecSchema,
  })
  .superRefine((result, context) => {
    const { recordQuery: _recordQuery, ...previousSpec } = result.spec;
    const checked = ExplorationResultV15Schema.safeParse({
      ...result,
      spec: previousSpec,
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
