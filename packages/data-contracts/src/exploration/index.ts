import { z } from 'zod';
import { PlatformUuidSchema } from '@wiser/platform-contracts';
import {
  DataKeySchema,
  OffsetDateTimeSchema,
  PageRequestFields,
} from '../common.js';
import { QualityGradeSchema } from '../catalog/index.js';

export const ExplorationVersionRefSchema = z.strictObject({
  dataItemId: PlatformUuidSchema,
  versionId: PlatformUuidSchema,
});

/** Declarative criteria only; authorization always comes from the verified caller. */
export const QuerySpecSchema = z.strictObject({
  text: z.string().trim().min(1).max(512).optional(),
  dataItemIds: z
    .array(PlatformUuidSchema)
    .min(1)
    .max(256)
    .refine((ids) => new Set(ids).size === ids.length, 'Duplicate data item')
    .optional(),
  versions: z
    .array(ExplorationVersionRefSchema)
    .min(1)
    .max(256)
    .refine(
      (refs) =>
        new Set(refs.map((ref) => `${ref.dataItemId}:${ref.versionId}`))
          .size === refs.length,
      'Duplicate version',
    )
    .optional(),
  businessDomains: z.array(DataKeySchema).min(1).max(64).optional(),
  qualityGrades: z.array(QualityGradeSchema).min(1).max(3).optional(),
});

export const ExplorationQueryInputSchema = z
  .strictObject({
    spec: QuerySpecSchema.optional(),
    queryId: PlatformUuidSchema.optional(),
    view: z.literal('resources'),
    ...PageRequestFields,
  })
  .refine(
    (input) => (input.spec === undefined) !== (input.queryId === undefined),
    'Supply a query specification or an existing result set',
  )
  .refine(
    (input) => input.after === undefined || input.queryId !== undefined,
    'Continuation requires a result set',
  );

const CountSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
export const ExplorationReadinessSchema = z.enum([
  'NOT_PARSED',
  'READY',
  'PARTIAL',
  'UNSUPPORTED',
  'INVALID',
  'RESTRICTED',
]);
export const ExplorationResourceSchema = z.strictObject({
  dataItemId: PlatformUuidSchema,
  versionId: PlatformUuidSchema,
  name: z.string().min(1).max(2048),
  provider: z.string().max(2048),
  kind: z.string().min(1).max(128),
  assetCount: CountSchema,
  readiness: z.strictObject({
    records: ExplorationReadinessSchema,
    spatial: ExplorationReadinessSchema,
    graph: ExplorationReadinessSchema,
  }),
  recordCount: CountSchema.nullable(),
  featureCount: CountSchema.nullable(),
  limitations: z.array(z.string().max(2048)).max(64),
});

export const ExplorationResultSchema = z
  .strictObject({
    queryId: PlatformUuidSchema,
    spec: QuerySpecSchema,
    createdAt: OffsetDateTimeSchema,
    expiresAt: OffsetDateTimeSchema,
    view: z.literal('resources'),
    totalCount: CountSchema,
    resources: z.array(ExplorationResourceSchema).max(200),
    nextCursor: PageRequestFields.after,
  })
  .refine(
    (result) => Date.parse(result.expiresAt) > Date.parse(result.createdAt),
    'Result set must have a positive lifetime',
  );

export type QuerySpec = z.infer<typeof QuerySpecSchema>;
export type ExplorationQueryInput = z.infer<typeof ExplorationQueryInputSchema>;
export type ExplorationResult = z.infer<typeof ExplorationResultSchema>;
export type ExplorationResource = z.infer<typeof ExplorationResourceSchema>;
