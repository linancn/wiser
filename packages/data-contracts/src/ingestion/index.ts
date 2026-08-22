import { z } from 'zod';

import { SecurityLevelSchema } from '../catalog/index.js';
import {
  DataKeySchema,
  OffsetDateTimeSchema,
  Sha256Schema,
} from '../common.js';
import { PlatformUuidSchema } from '@wiser/platform-contracts';

export const IngestionStateSchema = z.enum([
  'RECEIVED',
  'QUARANTINED',
  'SECURITY_SCANNED',
  'FINGERPRINTED',
  'PROFILED',
  'CLASSIFIED',
  'SCHEMA_MAPPED',
  'SEMANTIC_MAPPED',
  'VALIDATED',
  'SPATIOTEMPORAL_ALIGNED',
  'REVIEW_REQUIRED',
  'APPROVED',
  'REJECTED',
  'COMMITTED',
  'PROJECTING',
  'PUBLISHED',
  'FAILED',
  'CANCELLED',
]);
export type IngestionState = z.infer<typeof IngestionStateSchema>;

export const IngestionSchema = z.strictObject({
  ingestionId: PlatformUuidSchema,
  tenantId: PlatformUuidSchema,
  projectId: PlatformUuidSchema,
  assetIds: z.array(PlatformUuidSchema).min(1).max(10_000),
  intendedUses: z.array(DataKeySchema).min(1).max(64),
  requestedSecurityLevel: SecurityLevelSchema,
  state: IngestionStateSchema,
  operationId: PlatformUuidSchema.optional(),
  version: z.number().int().positive(),
  createdAt: OffsetDateTimeSchema,
  updatedAt: OffsetDateTimeSchema,
});
export type IngestionDto = z.infer<typeof IngestionSchema>;

export const QualityIssueSummarySchema = z.strictObject({
  issueId: PlatformUuidSchema,
  severity: z.string().min(1).max(64),
  status: z.string().min(1).max(64),
  fieldPath: z.string().min(1).max(512).optional(),
  message: z.string().min(1).max(4096),
  createdAt: OffsetDateTimeSchema,
});
export type QualityIssueSummaryDto = z.infer<typeof QualityIssueSummarySchema>;

export const AgentRunSummarySchema = z.strictObject({
  agentRunId: PlatformUuidSchema,
  agentKind: z.string().min(1).max(128),
  provider: z.string().min(1).max(128),
  model: z.string().min(1).max(256),
  deterministic: z.boolean(),
  inputHash: Sha256Schema,
  outputHash: Sha256Schema.optional(),
  status: z.string().min(1).max(64),
  createdAt: OffsetDateTimeSchema,
  updatedAt: OffsetDateTimeSchema,
});
export type AgentRunSummaryDto = z.infer<typeof AgentRunSummarySchema>;

export const ProjectionStatusSummarySchema = z.strictObject({
  dataItemId: PlatformUuidSchema,
  versionId: PlatformUuidSchema,
  projectionKind: z.string().min(1).max(128),
  status: z.enum(['PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED']),
  attemptCount: z.number().int().nonnegative(),
  projectedAt: OffsetDateTimeSchema.optional(),
  updatedAt: OffsetDateTimeSchema,
});
export type ProjectionStatusSummaryDto = z.infer<
  typeof ProjectionStatusSummarySchema
>;

export const IngestionOutputSchema = z.strictObject({
  ingestion: IngestionSchema,
  qualityIssues: z.array(QualityIssueSummarySchema).max(200).optional(),
  agentRuns: z.array(AgentRunSummarySchema).max(200).optional(),
  projectionStatuses: z
    .array(ProjectionStatusSummarySchema)
    .max(200)
    .optional(),
});

export const GetIngestionInputSchema = z.strictObject({
  ingestionId: PlatformUuidSchema,
});

export const ApproveIngestionInputSchema = z.strictObject({
  ingestionId: PlatformUuidSchema,
  expectedVersion: z.number().int().positive(),
  reviewNote: z.string().min(1).max(4096).optional(),
  conditions: z.array(z.string().min(1).max(2048)).max(64).optional(),
});

export const RejectIngestionInputSchema = z.strictObject({
  ingestionId: PlatformUuidSchema,
  expectedVersion: z.number().int().positive(),
  reasonCode: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[A-Z][A-Z0-9_]*$/),
  reason: z.string().min(1).max(4096),
});
