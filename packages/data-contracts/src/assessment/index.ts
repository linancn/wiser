import { z } from 'zod';
import { Sha256Schema, OffsetDateTimeSchema } from '../common.ts';

const Text = z.string().trim().min(1).max(2000);
export const IntakeDeclarationSchema = z.strictObject({
  kind: z.enum(['TABLE', 'GIS', 'DOCUMENT', 'REGISTRATION', 'INTERFACE']),
  target: z.enum([
    'DATASET',
    'DESCRIPTION_PAGE',
    'DOWNLOAD_FILE',
    'QUERY_INTERFACE',
  ]),
  expectedSourceHash: Sha256Schema,
  entry: z.enum(['UNCHECKED', 'VALID', 'UNREACHABLE']),
  access: z.enum([
    'UNKNOWN',
    'PUBLIC',
    'LOGIN_REQUIRED',
    'APPLICATION_REQUIRED',
    'AUTHORIZED',
    'RESTRICTED',
  ]),
  acquisition: z.enum([
    'REGISTERED_ONLY',
    'DOWNLOAD_CANDIDATE',
    'ORIGINAL_ACQUIRED',
    'PARTIAL_ACQUIRED',
    'REMOTE_QUERY_REPORTED',
    'FAILED',
  ]),
  coverage: z.enum([
    'UNKNOWN',
    'COMPLETE',
    'PARTIAL',
    'SAMPLE',
    'EMPTY',
    'NOT_A_DATASET',
  ]),
  failure: z
    .enum([
      'LOGIN_REQUIRED',
      'FORBIDDEN',
      'RATE_LIMITED',
      'TEMPORARY',
      'NOT_FOUND',
      'APPLICATION_REQUIRED',
    ])
    .optional(),
  evidence: Text,
  metadata: z.strictObject({
    source: Text.optional(),
    authorization: Text.optional(),
    businessKeys: z.array(z.string().min(1).max(128)).max(16).optional(),
    time: z
      .strictObject({ field: Text, role: Text, evidence: Text })
      .optional(),
    measures: z
      .array(
        z.strictObject({ field: Text, unit: Text.nullable(), evidence: Text }),
      )
      .max(32)
      .optional(),
    crs: Text.optional(),
    locator: Text.optional(),
    spatial: z
      .strictObject({
        method: Text.nullable(),
        resolution: Text.nullable(),
        timeMeaning: Text.nullable(),
        limitations: Text,
        evidence: Text,
      })
      .optional(),
  }),
  selfCheck: z
    .strictObject({
      ruleVersion: Text,
      sourceHash: Sha256Schema,
      model: Text.optional(),
    })
    .optional(),
});
export type IntakeDeclaration = z.infer<typeof IntakeDeclarationSchema>;
export const IntakeSourceFactsSchema = z.strictObject({
  sourceHash: Sha256Schema,
  mediaType: z.string().max(256),
  byteSize: z.number().int().nonnegative(),
  parserVersion: z.string().nullable(),
  status: z
    .enum([
      'READY',
      'EMPTY',
      'PARTIAL',
      'UNSUPPORTED',
      'INVALID',
      'RESTRICTED',
      'MANIFEST',
    ])
    .nullable(),
  columns: z.array(z.string()),
  recordCount: z.number().int().nonnegative().nullable(),
  featureCount: z.number().int().nonnegative().nullable(),
  reason: z.string().nullable(),
  sourceRegistered: z.boolean(),
});
export type IntakeSourceFacts = z.infer<typeof IntakeSourceFactsSchema>;
export const IntakeFindingCodeSchema = z.enum([
  'SOURCE_CHANGED',
  'SELF_CHECK_STALE',
  'MODEL_NOT_VALIDATED',
  'SOURCE_UNKNOWN',
  'AUTHORIZATION_UNKNOWN',
  'UNIT_UNKNOWN',
  'BUSINESS_KEY_UNKNOWN',
  'FIELD_NOT_FOUND',
  'TIME_ROLE_UNKNOWN',
  'CRS_UNVERIFIED',
  'LOCATOR_UNKNOWN',
  'TARGET_NOT_ACQUIRED',
  'TARGET_CONTENT_UNVERIFIED',
  'REMOTE_QUERY_UNVERIFIED',
  'CONTENT_NOT_PARSED',
  'PARTIAL_CONTENT',
]);
const UseState = z.enum([
  'CHECKS_PASSED',
  'NEEDS_INFORMATION',
  'NOT_APPLICABLE',
]);
export const IntakeResultSchema = z.strictObject({
  ruleVersion: z.literal('wiser.intake.v1'),
  sourceHash: Sha256Schema,
  archive: z.literal('RECORDED'),
  position: z.literal('UNCHECKED'),
  target: IntakeDeclarationSchema.shape.target,
  access: IntakeDeclarationSchema.shape.access,
  entry: IntakeDeclarationSchema.shape.entry,
  acquisition: IntakeDeclarationSchema.shape.acquisition,
  coverage: IntakeDeclarationSchema.shape.coverage,
  nextAction: z.enum([
    'PARSE_SAVED_ORIGINAL',
    'REQUEST_ACCESS',
    'RETRY_LATER',
    'COMPLETE_METADATA',
    'REVIEW_EVIDENCE',
    'ACQUIRE_ORIGINAL',
  ]),
  uses: z.strictObject({
    map: UseState,
    calculation: UseState,
    join: UseState,
    citation: UseState,
  }),
  findings: z
    .array(
      z.strictObject({
        code: IntakeFindingCodeSchema,
        path: z.string(),
        severity: z.enum(['WARNING', 'NEEDS_INFORMATION']),
      }),
    )
    .max(128),
});
export type IntakeResult = z.infer<typeof IntakeResultSchema>;
export const CreateAssessmentInputSchema = z.strictObject({
  dataItemId: z.uuid(),
  versionId: z.uuid(),
  assetId: z.uuid(),
  declaration: IntakeDeclarationSchema,
});
export const AssessmentSchema = z.strictObject({
  assessmentId: z.uuid(),
  dataItemId: z.uuid(),
  versionId: z.uuid(),
  assetId: z.uuid(),
  analysisId: z.uuid().nullable(),
  createdAt: OffsetDateTimeSchema,
  declaration: IntakeDeclarationSchema,
  facts: IntakeSourceFactsSchema,
  result: IntakeResultSchema,
});
export const AssessmentOutputSchema = z.strictObject({
  assessment: AssessmentSchema,
});
export const GetAssessmentInputSchema = z.strictObject({
  assessmentId: z.uuid(),
});
export const ListAssessmentsInputSchema = z.strictObject({
  dataItemId: z.uuid(),
  versionId: z.uuid(),
  first: z.number().int().min(1).max(100).default(25),
  after: z.uuid().optional(),
});
export const ListAssessmentsOutputSchema = z.strictObject({
  items: z.array(AssessmentSchema).max(100),
  nextCursor: z.uuid().optional(),
});
export type Assessment = z.infer<typeof AssessmentSchema>;

export const AssessmentActionSchema = IntakeResultSchema.shape.nextAction.or(
  z.literal('UNCHECKED'),
);
export const AssessmentOverviewInputSchema = z.strictObject({
  target: IntakeDeclarationSchema.shape.target,
  query: z.string().min(1).max(512).optional(),
  action: AssessmentActionSchema.optional(),
  first: z.number().int().min(1).max(100).default(25),
  after: z.uuid().optional(),
});
export const AssessmentOverviewOutputSchema = z.strictObject({
  target: IntakeDeclarationSchema.shape.target,
  totalCount: z.number().int().nonnegative(),
  checkedCount: z.number().int().nonnegative(),
  uncheckedCount: z.number().int().nonnegative(),
  selectedCount: z.number().int().nonnegative(),
  counts: z.array(
    z.strictObject({
      action: AssessmentActionSchema,
      count: z.number().int().nonnegative(),
    }),
  ),
  items: z
    .array(
      z.strictObject({
        dataItemId: z.uuid(),
        versionId: z.uuid(),
        name: z.string(),
        assessmentId: z.uuid().nullable(),
        checkedAt: OffsetDateTimeSchema.nullable(),
        acquisition: IntakeDeclarationSchema.shape.acquisition.nullable(),
        access: IntakeDeclarationSchema.shape.access.nullable(),
        coverage: IntakeDeclarationSchema.shape.coverage.nullable(),
        nextAction: AssessmentActionSchema,
      }),
    )
    .max(100),
  nextCursor: z.uuid().optional(),
});
export type AssessmentOverview = z.infer<typeof AssessmentOverviewOutputSchema>;
