import { z } from 'zod';
import { PlatformUuidSchema } from '@wiser/platform-contracts';
import {
  DataKeySchema,
  OffsetDateTimeSchema,
  PageRequestFields,
} from '../common.ts';
import { QualityGradeSchema } from '../catalog/index.ts';

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

export const ExplorationQueryInputV1Schema = z
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

export const ExplorationQueryInputSchema = z
  .strictObject({
    ...ExplorationQueryInputV1Schema.shape,
    view: z.enum(['resources', 'records', 'map']),
    versionId: PlatformUuidSchema.optional(),
    assetId: PlatformUuidSchema.optional(),
    bbox: z
      .tuple([
        z.number().min(-180).max(180),
        z.number().min(-90).max(90),
        z.number().min(-180).max(180),
        z.number().min(-90).max(90),
      ])
      .refine(([west, south, east, north]) => west <= east && south <= north)
      .optional(),
  })
  .refine(
    (input) => (input.spec === undefined) !== (input.queryId === undefined),
    'Supply a query specification or an existing result set',
  )
  .refine(
    (input) => input.after === undefined || input.queryId !== undefined,
    'Continuation requires a result set',
  )
  .superRefine((input, context) => {
    if (input.view !== 'resources' && input.queryId === undefined)
      context.addIssue({
        code: 'custom',
        message: 'Analytical views require an existing result set',
      });
    if (input.view === 'records' && input.versionId === undefined)
      context.addIssue({
        code: 'custom',
        message: 'Record views require a selected version',
      });
    if (
      (input.view === 'resources' &&
        (input.versionId !== undefined || input.assetId !== undefined)) ||
      (input.view !== 'map' && input.bbox !== undefined)
    )
      context.addIssue({
        code: 'custom',
        message: 'View options do not apply to the selected view',
      });
  });

const CountSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
export const ExplorationReadinessSchema = z.enum([
  'NOT_PARSED',
  'READY',
  'PARTIAL',
  'UNSUPPORTED',
  'INVALID',
  'RESTRICTED',
]);
export const ExplorationResourceV1Schema = z.strictObject({
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

export const ExplorationResultV1Schema = z
  .strictObject({
    queryId: PlatformUuidSchema,
    spec: QuerySpecSchema,
    createdAt: OffsetDateTimeSchema,
    expiresAt: OffsetDateTimeSchema,
    view: z.literal('resources'),
    totalCount: CountSchema,
    resources: z.array(ExplorationResourceV1Schema).max(200),
    nextCursor: PageRequestFields.after,
  })
  .refine(
    (result) => Date.parse(result.expiresAt) > Date.parse(result.createdAt),
    'Result set must have a positive lifetime',
  );

export const ExplorationAnalysisAssetSchema = z.strictObject({
  assetId: PlatformUuidSchema,
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
  status: z.enum([
    'READY',
    'EMPTY',
    'PARTIAL',
    'UNSUPPORTED',
    'INVALID',
    'RESTRICTED',
    'MANIFEST',
  ]),
  recordCount: CountSchema.nullable(),
  featureCount: CountSchema.nullable(),
  reason: z.string().nullable(),
  columns: z
    .array(
      z.strictObject({
        key: z.string().min(1).max(128),
        label: z.string().min(1).max(512),
      }),
    )
    .max(256),
  paths: z.array(z.string().max(1024)).max(1000),
});
export const ExplorationResourceSchema = ExplorationResourceV1Schema.extend({
  analysis: z
    .strictObject({
      analysisId: PlatformUuidSchema,
      status: z.enum(['READY', 'PARTIAL']),
    })
    .optional(),
});
export const ExplorationRecordSchema = z.strictObject({
  recordId: PlatformUuidSchema,
  featureId: PlatformUuidSchema.nullable(),
  dataItemId: PlatformUuidSchema,
  versionId: PlatformUuidSchema,
  analysisId: PlatformUuidSchema,
  assetId: PlatformUuidSchema,
  sourceId: z.string().nullable(),
  index: CountSchema,
  values: z.record(z.string(), z.json()),
});
export const ExplorationMapFeatureSchema = z.strictObject({
  type: z.literal('Feature'),
  id: PlatformUuidSchema,
  geometry: z.record(z.string(), z.json()),
  properties: ExplorationRecordSchema,
});
export const ExplorationResultSchema = z
  .strictObject({
    ...ExplorationResultV1Schema.shape,
    view: z.enum(['resources', 'records', 'map']),
    resources: z.array(ExplorationResourceSchema).max(200),
    assets: z.array(ExplorationAnalysisAssetSchema).max(1000).optional(),
    records: z.array(ExplorationRecordSchema).max(200).optional(),
    features: z.array(ExplorationMapFeatureSchema).max(200).optional(),
    selectedAssetId: PlatformUuidSchema.optional(),
    coverage: z
      .strictObject({
        resourceCount: CountSchema,
        analyzedResourceCount: CountSchema,
        indexedRecordCount: CountSchema,
        indexedFeatureCount: CountSchema,
      })
      .optional(),
  })
  .refine(
    (result) => Date.parse(result.expiresAt) > Date.parse(result.createdAt),
    'Result set must have a positive lifetime',
  )
  .superRefine((result, context) => {
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
export type ExplorationQueryInput = z.infer<typeof ExplorationQueryInputSchema>;
export type ExplorationResult = z.infer<typeof ExplorationResultSchema>;
export type ExplorationResource = z.infer<typeof ExplorationResourceSchema>;
export type ExplorationRecord = z.infer<typeof ExplorationRecordSchema>;
export type ExplorationAnalysisAsset = z.infer<
  typeof ExplorationAnalysisAssetSchema
>;
