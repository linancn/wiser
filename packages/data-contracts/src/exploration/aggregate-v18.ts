import { z } from 'zod';
import {
  ExplorationAggregateSpecSchema as PreviousSpec,
  ExplorationAggregateSchema as PreviousResult,
} from './aggregate-v17.ts';
import { ExplorationTimeGroupSchema } from './time.ts';
export const ExplorationAggregateSpecSchema = PreviousSpec.extend({
  groupBy: z
    .union([PreviousSpec.shape.groupBy.unwrap(), ExplorationTimeGroupSchema])
    .optional(),
});
export const ExplorationAggregateSchema = z
  .strictObject({
    ...PreviousResult.shape,
    spec: ExplorationAggregateSpecSchema,
  })
  .superRefine((result, context) => {
    const group = result.spec.groupBy;
    const checked = PreviousResult.safeParse({
      ...result,
      spec: {
        ...result.spec,
        ...(group?.type === 'time'
          ? { groupBy: { field: group.field, type: 'text' } }
          : {}),
      },
    });
    if (!checked.success)
      for (const issue of checked.error.issues)
        context.addIssue({
          code: 'custom',
          path: issue.path,
          message: issue.message,
        });
  });
export type ExplorationAggregateSpec = z.infer<
  typeof ExplorationAggregateSpecSchema
>;
export type ExplorationAggregate = z.infer<typeof ExplorationAggregateSchema>;
