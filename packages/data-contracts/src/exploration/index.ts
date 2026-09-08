import { z } from 'zod';
import {
  QuerySpecV1Schema,
  ExplorationReadinessV1Schema,
  ExplorationResourceV12Schema,
  ExplorationQueryInputV12Schema,
  ExplorationResultV12Schema,
} from './legacy.ts';
export * from './legacy.ts';

export const ExplorationReadinessSchema = z.enum([
  ...ExplorationReadinessV1Schema.options,
  'METADATA_ONLY',
  'EMPTY',
  'NO_SPATIAL_DATA',
  'CRS_UNVERIFIED',
]);
export const QuerySpecSchema = QuerySpecV1Schema.extend({
  providers: z
    .array(z.string().trim().min(1).max(2048))
    .min(1)
    .max(64)
    .optional(),
  kinds: z
    .array(
      z.enum([
        'PROVIDER',
        'DATASET_INTERFACE',
        'CATALOG_ENTRY',
        'FILE_COLLECTION',
        'DATASET',
      ]),
    )
    .min(1)
    .max(5)
    .optional(),
  readiness: z
    .strictObject({
      records: z.array(ExplorationReadinessSchema).min(1).max(10).optional(),
      spatial: z.array(ExplorationReadinessSchema).min(1).max(10).optional(),
    })
    .optional(),
});
export const ExplorationResourceSchema = ExplorationResourceV12Schema.extend({
  readiness: z.strictObject({
    records: ExplorationReadinessSchema,
    spatial: ExplorationReadinessSchema,
    graph: ExplorationReadinessSchema,
  }),
});
export const ExplorationQueryInputSchema = z
  .strictObject({
    ...ExplorationQueryInputV12Schema.shape,
    spec: QuerySpecSchema.optional(),
  })
  .superRefine((input, context) => {
    const legacy = ExplorationQueryInputV12Schema.safeParse({
      ...input,
      ...(input.spec === undefined ? {} : { spec: {} }),
    });
    if (!legacy.success)
      for (const issue of legacy.error.issues)
        context.addIssue({
          code: 'custom',
          path: issue.path,
          message: issue.message,
        });
  });
const Count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const ExplorationSummarySchema = z.strictObject({
  resourceCount: Count,
  analyzedResourceCount: Count,
  indexedRecordCount: Count,
  indexedFeatureCount: Count,
  records: z
    .array(z.strictObject({ status: ExplorationReadinessSchema, count: Count }))
    .max(10),
  spatial: z
    .array(z.strictObject({ status: ExplorationReadinessSchema, count: Count }))
    .max(10),
});
export const ExplorationResultSchema = z
  .strictObject({
    ...ExplorationResultV12Schema.shape,
    spec: QuerySpecSchema,
    resources: z.array(ExplorationResourceSchema).max(200),
    summary: ExplorationSummarySchema.optional(),
  })
  .superRefine((result, context) => {
    if (Date.parse(result.expiresAt) <= Date.parse(result.createdAt))
      context.addIssue({
        code: 'custom',
        message: 'Result set must have a positive lifetime',
      });
    if (result.view === 'graph' && result.graph === undefined)
      context.addIssue({
        code: 'custom',
        message: 'Graph results require a typed graph',
      });
    if (
      result.view === 'records' &&
      (result.records === undefined || result.assets === undefined)
    )
      context.addIssue({
        code: 'custom',
        message: 'Record results require rows and source schemas',
      });
    if (result.view === 'map' && result.features === undefined)
      context.addIssue({
        code: 'custom',
        message: 'Map results require features',
      });
  });
export type QuerySpec = z.infer<typeof QuerySpecSchema>;
export type ExplorationReadiness = z.infer<typeof ExplorationReadinessSchema>;
export type ExplorationQueryInput = z.infer<typeof ExplorationQueryInputSchema>;
export type ExplorationResult = z.infer<typeof ExplorationResultSchema>;
export type ExplorationResource = z.infer<typeof ExplorationResourceSchema>;
export type ExplorationSummary = z.infer<typeof ExplorationSummarySchema>;
