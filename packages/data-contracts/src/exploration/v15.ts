/** Immutable exploration 1.5 definitions. */
import { z } from 'zod';
import {
  ExplorationResultV14Schema,
  ExplorationQueryInputV14Schema,
} from './v14.ts';
export * from './v14.ts';
export { ExplorationQueryInputV14Schema as ExplorationQueryInputV15Schema } from './v14.ts';
export type { ExplorationQueryInputV14 as ExplorationQueryInputV15 } from './v14.ts';
export const ExplorationSpatialSummarySchema = z.strictObject({
  bounds: ExplorationQueryInputV14Schema.shape.bbox.unwrap().nullable(),
  mercatorFeatureCount: z
    .number()
    .int()
    .nonnegative()
    .max(Number.MAX_SAFE_INTEGER),
});
export const ExplorationResultV15Schema = z
  .strictObject({
    ...ExplorationResultV14Schema.shape,
    spatial: ExplorationSpatialSummarySchema.optional(),
  })
  .superRefine((result, context) => {
    const { spatial, ...previous } = result;
    const checked = ExplorationResultV14Schema.safeParse(previous);
    if (!checked.success)
      for (const issue of checked.error.issues)
        context.addIssue({
          code: 'custom',
          path: issue.path,
          message: issue.message,
        });
    if (
      spatial !== undefined &&
      (result.view !== 'map' ||
        spatial.mercatorFeatureCount > result.totalCount)
    )
      context.addIssue({
        code: 'custom',
        message: 'Spatial coverage belongs to the bounded map result',
      });
  });
export type ExplorationResultV15 = z.infer<typeof ExplorationResultV15Schema>;
