/** Immutable exploration 1.4 definitions. */
import { z } from 'zod';
import { ExplorationQueryInputV13Schema } from './v13.ts';
export * from './v13.ts';
export { ExplorationResultV13Schema as ExplorationResultV14Schema } from './v13.ts';
export type { ExplorationResultV13 as ExplorationResultV14 } from './v13.ts';

export const ExplorationQueryInputV14Schema = z
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
export type ExplorationQueryInputV14 = z.infer<
  typeof ExplorationQueryInputV14Schema
>;
