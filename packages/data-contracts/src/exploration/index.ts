import { z } from 'zod';
import {
  ExplorationQueryInputV16Schema,
  ExplorationResultV16Schema,
} from './v16.ts';
import {
  ExplorationAggregateSpecSchema,
  ExplorationAggregateSchema,
} from './aggregate.ts';
export * from './v16.ts';
export * from './aggregate.ts';
const View = z.enum(['resources', 'records', 'map', 'graph', 'aggregate']);
export const ExplorationQueryInputSchema = z
  .strictObject({
    ...ExplorationQueryInputV16Schema.shape,
    view: View.default('resources'),
    aggregate: ExplorationAggregateSpecSchema.optional(),
  })
  .superRefine((input, context) => {
    const { aggregate, ...previous } = input;
    const checked = ExplorationQueryInputV16Schema.safeParse({
      ...previous,
      view: input.view === 'aggregate' ? 'records' : input.view,
    });
    if (!checked.success)
      for (const issue of checked.error.issues)
        context.addIssue({
          code: 'custom',
          path: issue.path,
          message: issue.message,
        });
    if (
      (input.view === 'aggregate') !== (aggregate !== undefined) ||
      (input.view === 'aggregate' &&
        (!input.queryId ||
          !input.versionId ||
          input.after ||
          input.recordId ||
          input.assetId ||
          input.bbox))
    )
      context.addIssue({
        code: 'custom',
        message:
          'Aggregation requires an authorized query, version and source specification without row pagination',
      });
  });
export const ExplorationResultSchema = z
  .strictObject({
    ...ExplorationResultV16Schema.shape,
    view: View,
    aggregate: ExplorationAggregateSchema.optional(),
  })
  .superRefine((result, context) => {
    const { aggregate, ...previous } = result;
    const checked = ExplorationResultV16Schema.safeParse({
      ...previous,
      view: result.view === 'aggregate' ? 'resources' : result.view,
    });
    if (!checked.success)
      for (const issue of checked.error.issues)
        context.addIssue({
          code: 'custom',
          path: issue.path,
          message: issue.message,
        });
    if ((result.view === 'aggregate') !== (aggregate !== undefined))
      context.addIssue({
        code: 'custom',
        message: 'Aggregate results require bounded groups',
      });
    if (
      aggregate &&
      !aggregate.truncated &&
      aggregate.groups.reduce((sum, group) => sum + group.count, 0) !==
        result.totalCount
    )
      context.addIssue({
        code: 'custom',
        message: 'Aggregate group counts must cover all matched records',
      });
  });
export type ExplorationQueryInput = z.infer<typeof ExplorationQueryInputSchema>;
export type ExplorationResult = z.infer<typeof ExplorationResultSchema>;
