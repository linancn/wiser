import { z } from 'zod';

import { OffsetDateTimeSchema, Sha256Schema } from '../common.js';
import { PlatformUuidSchema } from '@wiser/platform-contracts';

const MAX_UPLOAD_SIZE_BYTES = 5 * 1024 * 1024 * 1024 * 1024;

export const UploadSessionStatusSchema = z.enum([
  'OPEN',
  'COMPLETED',
  'EXPIRED',
  'CANCELLED',
]);
export type UploadSessionStatus = z.infer<typeof UploadSessionStatusSchema>;

export const UploadObjectRequestSchema = z.strictObject({
  fileName: z
    .string()
    .min(1)
    .max(1024)
    .regex(/^[^/\\\0]+$/),
  mediaType: z
    .string()
    .min(3)
    .max(255)
    .regex(/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i),
  sizeBytes: z.number().int().positive().max(MAX_UPLOAD_SIZE_BYTES),
  sha256: Sha256Schema.optional(),
});

export const CreateUploadSessionInputSchema = z.strictObject({
  ownerProjectId: PlatformUuidSchema,
  objects: z.array(UploadObjectRequestSchema).min(1).max(1_000),
  preferredMode: z.enum(['PRESIGNED_PUT', 'MULTIPART']).optional(),
});

export const UploadSessionSchema = z.strictObject({
  uploadSessionId: PlatformUuidSchema,
  tenantId: PlatformUuidSchema,
  projectId: PlatformUuidSchema,
  status: UploadSessionStatusSchema,
  assetIds: z.array(PlatformUuidSchema).min(1).max(1_000),
  version: z.number().int().positive(),
  expiresAt: OffsetDateTimeSchema,
  createdAt: OffsetDateTimeSchema,
  completedAt: OffsetDateTimeSchema.optional(),
});
export type UploadSessionDto = z.infer<typeof UploadSessionSchema>;

export const UploadTargetSchema = z.strictObject({
  assetId: PlatformUuidSchema,
  method: z.enum(['PRESIGNED_PUT', 'MULTIPART']),
  uploadUrl: z.string().url().max(4096),
  headers: z.record(z.string().min(1).max(128), z.string().max(4096)),
  partSizeBytes: z.number().int().positive().optional(),
});

export const CreateUploadSessionOutputSchema = z.strictObject({
  uploadSession: UploadSessionSchema,
  uploadTargets: z.array(UploadTargetSchema).min(1).max(1_000),
});

export const CompletedUploadObjectSchema = z.strictObject({
  assetId: PlatformUuidSchema,
  sizeBytes: z.number().int().positive().max(MAX_UPLOAD_SIZE_BYTES),
  sha256: Sha256Schema,
  etag: z.string().min(1).max(1024).optional(),
});

export const CompleteUploadSessionInputSchema = z.strictObject({
  uploadSessionId: PlatformUuidSchema,
  expectedVersion: z.number().int().positive(),
  objects: z.array(CompletedUploadObjectSchema).min(1).max(1_000),
});

export const CompleteUploadSessionOutputSchema = z.strictObject({
  uploadSession: UploadSessionSchema,
});
