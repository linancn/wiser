/** Immutable exploration 1.10 definitions. */
import { z } from 'zod';
import {
  ExplorationQueryInputV19Schema,
  ExplorationResultV19Schema,
  QuerySpecSchema as PreviousSpec,
} from './v19.ts';
export * from './v19.ts';
export const ExplorationBoundsSchema =
  ExplorationQueryInputV19Schema.shape.bbox.unwrap();
export const QuerySpecSchema = z
  .strictObject({
    ...PreviousSpec.shape,
    spatialBounds: ExplorationBoundsSchema.optional(),
  })
  .superRefine((value, context) => {
    const { spatialBounds: _bounds, ...previous } = value;
    const checked = PreviousSpec.safeParse(previous);
    if (!checked.success)
      for (const issue of checked.error.issues)
        context.addIssue({
          code: 'custom',
          path: issue.path,
          message: issue.message,
        });
  });
export const ExplorationQueryInputV110Schema = z
  .strictObject({
    ...ExplorationQueryInputV19Schema.shape,
    spec: QuerySpecSchema.optional(),
  })
  .superRefine((input, context) => {
    const { spatialBounds: _bounds, ...spec } = input.spec ?? {};
    const checked = ExplorationQueryInputV19Schema.safeParse({
      ...input,
      ...(input.spec ? { spec } : {}),
    });
    if (!checked.success)
      for (const issue of checked.error.issues)
        context.addIssue({
          code: 'custom',
          path: issue.path,
          message: issue.message,
        });
  });
export const ExplorationResultV110Schema = z
  .strictObject({ ...ExplorationResultV19Schema.shape, spec: QuerySpecSchema })
  .superRefine((result, context) => {
    const { spatialBounds: _bounds, ...spec } = result.spec;
    const checked = ExplorationResultV19Schema.safeParse({ ...result, spec });
    if (!checked.success)
      for (const issue of checked.error.issues)
        context.addIssue({
          code: 'custom',
          path: issue.path,
          message: issue.message,
        });
  });
export type ExplorationBounds = z.infer<typeof ExplorationBoundsSchema>;
export type QuerySpec = z.infer<typeof QuerySpecSchema>;
export type ExplorationQueryInputV110 = z.infer<
  typeof ExplorationQueryInputV110Schema
>;
export type ExplorationResultV110 = z.infer<typeof ExplorationResultV110Schema>;
