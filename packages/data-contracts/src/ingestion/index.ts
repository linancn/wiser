import { z } from 'zod';

import { SecurityLevelSchema } from '../catalog/index.js';
import { DataKeySchema, OffsetDateTimeSchema } from '../common.js';
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

export const IngestionOutputSchema = z.strictObject({
  ingestion: IngestionSchema,
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
