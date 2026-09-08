import { z } from 'zod';
import { ExplorationQueryInputV13Schema } from './v13.ts';
export * from './v13.ts';
export { ExplorationResultV13Schema as ExplorationResultSchema } from './v13.ts';
export type { ExplorationResultV13 as ExplorationResult } from './v13.ts';

export const ExplorationQueryInputSchema = z
  .strictObject({ ...ExplorationQueryInputV13Schema.shape })
  .superRefine((input, context) => {
    const checked = ExplorationQueryInputV13Schema.safeParse({
      ...input,
      ...(input.view === 'records' ? { recordId: undefined } : {}),
    });
    if (!checked.success)
      for (const issue of checked.error.issues)
        context.addIssue({
          code: 'custom',
          path: issue.path,
          message: issue.message,
        });
    if (
      input.view === 'records' &&
      input.recordId !== undefined &&
      input.after !== undefined
    )
      context.addIssue({
        code: 'custom',
        message: 'A record lookup cannot be paginated',
      });
  });
export type ExplorationQueryInput = z.infer<typeof ExplorationQueryInputSchema>;
