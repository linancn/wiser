import { z } from 'zod';

import {
  CursorSchema,
  DataFieldNameSchema,
  DataKeySchema,
  OffsetDateTimeSchema,
  PageRequestFields,
  Sha256Schema,
} from '../common.js';
import {
  PlatformScopeSchema,
  PlatformUuidSchema,
} from '@wiser/platform-contracts';

export const ProcessingStageSchema = z.enum([
  'RAW',
  'CLEANED',
  'STANDARDIZED',
  'INTERMEDIATE',
  'KNOWLEDGE',
  'METADATA_QUALITY',
]);
export type ProcessingStage = z.infer<typeof ProcessingStageSchema>;

export const SecurityLevelSchema = z.enum([
  'L0_PUBLIC',
  'L1_INTERNAL',
  'L2_RESTRICTED',
  'L3_CONFIDENTIAL',
]);
export type SecurityLevel = z.infer<typeof SecurityLevelSchema>;

export const QualityGradeSchema = z.enum(['A', 'B', 'C']);
export type QualityGrade = z.infer<typeof QualityGradeSchema>;

export const AcceptanceStatusSchema = z.enum([
  'PENDING',
  'PASSED',
  'CONDITIONALLY_PASSED',
  'CORRECTION_REQUIRED',
  'ARCHIVED_ONLY',
  'REJECTED',
]);
export type AcceptanceStatus = z.infer<typeof AcceptanceStatusSchema>;

export const PublicationStatusSchema = z.enum([
  'UNPUBLISHED',
  'PUBLISHING',
  'PUBLISHED',
  'WITHDRAWN',
]);
export type PublicationStatus = z.infer<typeof PublicationStatusSchema>;

export const GenerationMethodSchema = z.enum([
  'OBSERVED',
  'DECLARED',
  'DERIVED_DETERMINISTIC',
  'DERIVED_AI_ASSISTED',
  'SYNTHETIC',
  'MODEL_OUTPUT',
]);
export type GenerationMethod = z.infer<typeof GenerationMethodSchema>;

export const UpdateModeSchema = z.enum([
  'APPEND',
  'REPLACE',
  'UPSERT',
  'SNAPSHOT',
]);
export type UpdateMode = z.infer<typeof UpdateModeSchema>;

export const SourceContactSchema = z.strictObject({
  name: z.string().min(1).max(256),
  email: z.string().email().max(320).optional(),
});

const BboxSchema = z
  .tuple([
    z.number().finite(),
    z.number().finite(),
    z.number().finite(),
    z.number().finite(),
  ])
  .superRefine(([minimumX, minimumY, maximumX, maximumY], context) => {
    if (minimumX > maximumX) {
      context.addIssue({
        code: 'custom',
        path: [2],
        message: 'bbox maximum x must be greater than or equal to minimum x.',
      });
    }
    if (minimumY > maximumY) {
      context.addIssue({
        code: 'custom',
        path: [3],
        message: 'bbox maximum y must be greater than or equal to minimum y.',
      });
    }
  });

export const CrsSchema = z
  .string()
  .min(3)
  .max(128)
  .regex(/^[A-Za-z][A-Za-z0-9_.:/-]+$/);

export const SpatialExtentSchema = z.strictObject({
  bbox: BboxSchema,
  crs: CrsSchema,
});

export const TemporalExtentSchema = z
  .strictObject({
    start: OffsetDateTimeSchema,
    end: OffsetDateTimeSchema,
  })
  .superRefine(({ start, end }, context) => {
    if (Date.parse(start) > Date.parse(end)) {
      context.addIssue({
        code: 'custom',
        path: ['end'],
        message: 'temporal extent end must not precede start.',
      });
    }
  });

export const UnitDefinitionSchema = z.strictObject({
  field: DataFieldNameSchema,
  sourceUnit: z.string().min(1).max(64),
  canonicalUnit: z.string().min(1).max(64),
});

export const DataRuleReferenceSchema = z.strictObject({
  ruleId: DataKeySchema,
  description: z.string().min(1).max(1024),
});

export const DataItemSchema = z.strictObject({
  tenantId: PlatformUuidSchema,
  dataItemId: PlatformUuidSchema,
  name: z.string().min(1).max(256),
  businessDomains: z.array(DataKeySchema).min(1).max(64),
  sourceNatures: z.array(DataKeySchema).min(1).max(32),
  sourceChannels: z.array(DataKeySchema).min(1).max(32),
  processingStage: ProcessingStageSchema,
  intendedUses: z.array(DataKeySchema).min(1).max(64),
  ownerProjectId: PlatformUuidSchema,
  sourceOrganization: z.string().min(1).max(256),
  sourceContact: SourceContactSchema.optional(),
  authorizationScope: PlatformScopeSchema,
  citationRequirements: z.array(z.string().min(1).max(2048)).max(32),
  spatialExtent: SpatialExtentSchema.optional(),
  sourceCrs: CrsSchema.optional(),
  canonicalCrs: CrsSchema.optional(),
  temporalExtent: TemporalExtentSchema.optional(),
  timezone: z
    .string()
    .min(3)
    .max(64)
    .regex(/^[A-Za-z_+-]+(?:\/[A-Za-z0-9_+-]+)+$/)
    .optional(),
  temporalResolution: z.string().min(2).max(64).regex(/^P/).optional(),
  schemaVersionId: PlatformUuidSchema.optional(),
  unitDefinitions: z.array(UnitDefinitionSchema).max(512),
  missingValueRules: z.array(DataRuleReferenceSchema).max(256),
  anomalyRules: z.array(DataRuleReferenceSchema).max(256),
  generationMethod: GenerationMethodSchema,
  qualityGrade: QualityGradeSchema,
  acceptanceStatus: AcceptanceStatusSchema,
  publicationStatus: PublicationStatusSchema,
  securityLevel: SecurityLevelSchema,
  version: z.number().int().positive(),
  updateMode: UpdateModeSchema,
  createdAt: OffsetDateTimeSchema,
  updatedAt: OffsetDateTimeSchema,
});
export type DataItemDto = z.infer<typeof DataItemSchema>;

export const DataItemVersionSchema = z
  .strictObject({
    tenantId: PlatformUuidSchema,
    dataItemId: PlatformUuidSchema,
    versionId: PlatformUuidSchema,
    version: z.number().int().positive(),
    assetIds: z.array(PlatformUuidSchema).min(1).max(10_000),
    sourceHash: Sha256Schema,
    metadataHash: Sha256Schema,
    schemaVersionId: PlatformUuidSchema.optional(),
    processingStage: ProcessingStageSchema,
    generationMethod: GenerationMethodSchema,
    qualityGrade: QualityGradeSchema,
    acceptanceStatus: AcceptanceStatusSchema,
    publicationStatus: PublicationStatusSchema,
    securityLevel: SecurityLevelSchema,
    createdAt: OffsetDateTimeSchema,
    committedAt: OffsetDateTimeSchema.optional(),
    publishedAt: OffsetDateTimeSchema.optional(),
    supersedesVersionId: PlatformUuidSchema.optional(),
  })
  .superRefine((version, context) => {
    if (
      version.publicationStatus === 'PUBLISHED' &&
      version.publishedAt === undefined
    ) {
      context.addIssue({
        code: 'custom',
        path: ['publishedAt'],
        message: 'publishedAt is required for a published data item version.',
      });
    }
    if (
      version.publicationStatus === 'PUBLISHED' &&
      version.committedAt === undefined
    ) {
      context.addIssue({
        code: 'custom',
        path: ['committedAt'],
        message: 'committedAt is required for a published data item version.',
      });
    }
  });
export type DataItemVersionDto = z.infer<typeof DataItemVersionSchema>;

export const CreateDataItemInputSchema = DataItemSchema.omit({
  tenantId: true,
  dataItemId: true,
  qualityGrade: true,
  acceptanceStatus: true,
  publicationStatus: true,
  version: true,
  createdAt: true,
  updatedAt: true,
});

export const CreateDataItemOutputSchema = z.strictObject({
  item: DataItemSchema,
});

export const ListDataItemVersionsInputSchema = z.strictObject({
  dataItemId: PlatformUuidSchema,
  ...PageRequestFields,
});

export const DataItemVersionPageSchema = z.strictObject({
  items: z.array(DataItemVersionSchema),
  nextCursor: CursorSchema.optional(),
});

export const GetDataItemVersionInputSchema = z.strictObject({
  dataItemId: PlatformUuidSchema,
  versionId: PlatformUuidSchema,
});

export const GetDataItemVersionOutputSchema = z.strictObject({
  version: DataItemVersionSchema,
});
