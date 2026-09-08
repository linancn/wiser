import { z } from 'zod';
import {
  ExplorationQueryInputV18Schema,
  ExplorationResultV18Schema,
} from './v18.ts';
export * from './v18.ts';
export const ExplorationQueryInputSchema = z
  .strictObject({
    ...ExplorationQueryInputV18Schema.shape,
    baseQueryId: z.uuid().optional(),
  })
  .superRefine((input, context) => {
    const { baseQueryId, ...previous } = input;
    const checked = ExplorationQueryInputV18Schema.safeParse(previous);
    if (!checked.success)
      for (const issue of checked.error.issues)
        context.addIssue({
          code: 'custom',
          path: issue.path,
          message: issue.message,
        });
    if (baseQueryId && (!input.spec || input.queryId))
      context.addIssue({
        code: 'custom',
        path: ['baseQueryId'],
        message:
          'Refinement requires a new specification without a continuation query',
      });
  });
export const ExplorationResultSchema = ExplorationResultV18Schema;
export type ExplorationQueryInput = z.infer<typeof ExplorationQueryInputSchema>;
export type ExplorationResult = z.infer<typeof ExplorationResultSchema>;
