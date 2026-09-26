import { z } from 'zod';
import { ResourceAccessActionSchema } from './resource-access.ts';
const Id = z.string().uuid();
const Version = z.number().int().min(1).max(2147483646);
const Reason = z.string().trim().min(5).max(1000);
export const ResourceBatchPurposeSchema = z.enum(['web-console', 'agent-data']);
export const ResourceBatchPreviewCommandSchema = z
  .strictObject({
    projectId: Id,
    packageId: Id,
    packageVersion: Version,
    presetId: Id,
    presetVersion: Version,
    actorIds: z
      .array(Id)
      .min(1)
      .max(50)
      .refine((v) => new Set(v).size === v.length),
    purpose: ResourceBatchPurposeSchema,
    startsAt: z.string().datetime({ offset: true }),
    expiresAt: z.string().datetime({ offset: true }),
    reason: Reason,
  })
  .refine((v) => Date.parse(v.expiresAt) > Date.parse(v.startsAt), {
    message: 'Expiry must follow activation',
  });
export const ResourceBatchActionSchema = z.strictObject({
  projectId: Id,
  batchId: Id,
  expectedVersion: Version,
  reason: Reason,
});
export const ResourceBatchDecisionSchema = ResourceBatchActionSchema.extend({
  decision: z.enum(['approve', 'reject']),
});
const DifferenceCount = z.number().int().min(0).max(5000);
export const ResourceGrantDifferenceSchema = z.object({
  added: DifferenceCount,
  extended: DifferenceCount,
  retained: DifferenceCount,
  removed: z.literal(0),
  byAction: z
    .array(
      z.object({
        action: ResourceAccessActionSchema,
        added: DifferenceCount,
        extended: DifferenceCount,
        retained: DifferenceCount,
      }),
    )
    .min(1)
    .max(5),
});
export type ResourceGrantDifference = z.infer<
  typeof ResourceGrantDifferenceSchema
>;
export const ResourceBatchViewSchema = z.object({
  id: Id,
  projectId: Id,
  version: Version,
  status: z.enum([
    'pending',
    'approved',
    'rejected',
    'withdrawn',
    'partial',
    'executed',
  ]),
  packageId: Id,
  packageVersion: Version,
  packageName: z.string().max(160),
  presetId: Id,
  presetVersion: Version,
  presetName: z.string().max(160),
  resourceCount: z.number().int().min(1).max(1000),
  actions: z.array(ResourceAccessActionSchema).min(1).max(5),
  approvalLevel: z.enum(['ordinary', 'important']),
  purpose: ResourceBatchPurposeSchema,
  startsAt: z.string().datetime({ offset: true }),
  expiresAt: z.string().datetime({ offset: true }),
  validUntil: z.string().datetime({ offset: true }),
  applicantId: Id,
  decidedBy: Id.nullable(),
  reason: Reason,
  decisionReason: Reason.nullable(),
  members: z
    .array(
      z.object({
        actorId: Id,
        displayName: z.string().max(320),
        membershipVersion: z.number().int().positive(),
        existingGrantCount: z.number().int().nonnegative(),
        diff: ResourceGrantDifferenceSchema.nullable().default(null),
        status: z.enum(['pending', 'granted', 'failed']),
        grantId: Id.nullable(),
        code: z
          .enum([
            'MEMBERSHIP_CHANGED',
            'ACCESS_CHANGED',
            'RESOURCE_UNAVAILABLE',
            'AUTHORITY_CHANGED',
            'EXECUTION_FAILED',
          ])
          .nullable(),
        attempts: z.number().int().min(0),
      }),
    )
    .min(1)
    .max(50),
});
export const ResourceBatchesPageSchema = z.object({
  items: z.array(ResourceBatchViewSchema).max(20),
  hasMore: z.boolean(),
});
export type ResourceBatchPreviewCommand = z.infer<
  typeof ResourceBatchPreviewCommandSchema
>;
export type ResourceBatchAction = z.infer<typeof ResourceBatchActionSchema>;
export type ResourceBatchDecision = z.infer<typeof ResourceBatchDecisionSchema>;
export type ResourceBatchView = z.infer<typeof ResourceBatchViewSchema>;

export const ResourceBatchesQuerySchema = z.strictObject({
  offset: z.coerce.number().int().min(0).max(10000).default(0),
  limit: z.coerce.number().int().min(1).max(20).default(20),
  status: z
    .enum([
      'pending',
      'approved',
      'rejected',
      'withdrawn',
      'partial',
      'executed',
    ])
    .optional(),
});
export type ResourceBatchesQuery = z.infer<typeof ResourceBatchesQuerySchema>;
export type ResourceBatchesPage = z.infer<typeof ResourceBatchesPageSchema>;
