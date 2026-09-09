import { z } from 'zod';

const field = z.string().min(1).max(256);
const decimal = z
  .string()
  .max(128)
  .regex(/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d{1,3})?$/);
export const ReconciliationBindingSchema = z.union([
  z.strictObject({ field }),
  z.strictObject({ literal: z.string().trim().min(1).max(256) }),
]);
const mapping = z.strictObject({
  valueField: field,
  measure: ReconciliationBindingSchema,
  unit: ReconciliationBindingSchema,
});
export const ReconciliationPlanSchema = z
  .strictObject({
    keys: z
      .array(
        z.strictObject({
          name: field,
          leftField: field,
          rightField: field,
          type: z.enum(['text', 'decimal', 'iso-time']),
          trim: z.boolean(),
        }),
      )
      .min(1)
      .max(8),
    left: mapping,
    right: mapping,
    unitConversions: z
      .array(
        z.strictObject({
          from: field,
          to: field,
          factor: decimal,
          offset: decimal,
        }),
      )
      .max(16),
    conflictPolicy: z.enum(['preserve', 'right-revises-left']),
  })
  .superRefine((plan, context) => {
    if (new Set(plan.keys.map((k) => k.name)).size !== plan.keys.length)
      context.addIssue({ code: 'custom', message: 'Key names must be unique' });
    const from = new Set(plan.unitConversions.map((c) => c.from));
    if (
      from.size !== plan.unitConversions.length ||
      plan.unitConversions.some(
        (c) =>
          from.has(c.to) ||
          !Number.isFinite(Number(c.factor)) ||
          Number(c.factor) <= 0 ||
          !Number.isFinite(Number(c.offset)),
      )
    )
      context.addIssue({
        code: 'custom',
        message:
          'Conversions require unique source units, positive factors and no chains',
      });
  });
export const ReconciliationSourceRefSchema = z.strictObject({
  dataItemId: z.uuid(),
  versionId: z.uuid(),
  analysisId: z.uuid(),
  assetId: z.uuid(),
});
export const CreateReconciliationInputSchema = z
  .strictObject({
    title: z.string().trim().min(1).max(160),
    left: ReconciliationSourceRefSchema,
    right: ReconciliationSourceRefSchema,
    plan: ReconciliationPlanSchema,
  })
  .refine(
    (v) => v.left.assetId !== v.right.assetId,
    'Select two distinct files',
  );
const count = z.number().int().min(0).max(50000);
export const ReconciliationSummarySchema = z.strictObject({
  fileCount: z.literal(2),
  parsedRecordCount: count,
  candidateObservationCount: count.nullable(),
  duplicateRecordCount: count,
  unchangedCount: count,
  leftOnlyCount: count,
  addedCount: count,
  revisedCount: count,
  conflictCount: count,
  incompleteRecordCount: count,
  relation: z.enum([
    'FORMAT_COPY_CANDIDATE',
    'OVERLAP',
    'REVISION',
    'DISJOINT',
    'UNRESOLVED',
  ]),
});
export const ReconciliationMemberSchema = z.strictObject({
  side: z.enum(['left', 'right']),
  recordId: z.uuid(),
  index: z.number().int().positive(),
  value: z.string().max(512).nullable(),
});
export const ReconciliationGroupSchema = z.strictObject({
  groupIndex: count,
  keys: z.array(z.string().max(512)).max(8),
  measure: z.string().max(512).nullable(),
  unit: z.string().max(512).nullable(),
  status: z.enum([
    'UNCHANGED',
    'LEFT_ONLY',
    'ADDED',
    'REVISED',
    'CONFLICT',
    'INCOMPLETE',
  ]),
  selectedRecordId: z.uuid().nullable(),
  value: z.string().max(512).nullable(),
  memberCount: count,
});
export const ReconciliationBatchSchema = z.strictObject({
  batchId: z.uuid(),
  version: z.number().int().min(1).max(2),
  status: z.enum(['CANDIDATE', 'VERIFIED', 'REJECTED']),
  title: z.string().max(160),
  createdAt: z.iso.datetime({ offset: true }),
  reviewedAt: z.iso.datetime({ offset: true }).nullable(),
  reviewNote: z.string().max(2000).nullable(),
  independentObservationCount: count.nullable(),
  input: CreateReconciliationInputSchema,
  sources: z.tuple([
    ReconciliationSourceRefSchema.extend({
      sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
      paths: z.array(z.string()).max(1000),
      recordCount: count,
    }),
    ReconciliationSourceRefSchema.extend({
      sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
      paths: z.array(z.string()).max(1000),
      recordCount: count,
    }),
  ]),
  summary: ReconciliationSummarySchema,
});
export const CreateReconciliationOutputSchema = z.strictObject({
  batch: ReconciliationBatchSchema,
});
export const GetReconciliationInputSchema = z.strictObject({
  batchId: z.uuid(),
  first: z.number().int().min(1).max(100).default(25),
  groupIndex: count.optional(),
  after: z.string().min(1).max(1024).optional(),
});
export const GetReconciliationOutputSchema = z.strictObject({
  batch: ReconciliationBatchSchema,
  groups: z.array(ReconciliationGroupSchema).max(100),
  members: z.array(ReconciliationMemberSchema).max(100),
  totalCount: count,
  nextCursor: z.string().max(1024).optional(),
});
export const ReviewReconciliationInputSchema = z.strictObject({
  batchId: z.uuid(),
  expectedVersion: z.number().int().positive(),
  decision: z.enum(['verify', 'reject']),
  note: z.string().trim().min(1).max(2000),
});
export const ReviewReconciliationOutputSchema =
  CreateReconciliationOutputSchema;
export const ListReconciliationsInputSchema = z.strictObject({
  versionId: z.uuid(),
});
export const ListReconciliationsOutputSchema = z.strictObject({
  items: z.array(ReconciliationBatchSchema).max(100),
});
export type ReconciliationPlan = z.infer<typeof ReconciliationPlanSchema>;
export type ReconciliationMember = z.infer<typeof ReconciliationMemberSchema>;
export type ReconciliationGroup = z.infer<typeof ReconciliationGroupSchema>;
export type ReconciliationSummary = z.infer<typeof ReconciliationSummarySchema>;
export type ReconciliationBatch = z.infer<typeof ReconciliationBatchSchema>;
export type ReconciliationSourceRef = z.infer<
  typeof ReconciliationSourceRefSchema
>;
export type CreateReconciliationInput = z.infer<
  typeof CreateReconciliationInputSchema
>;
export type GetReconciliationOutput = z.infer<
  typeof GetReconciliationOutputSchema
>;
