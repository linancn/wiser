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

export const MultipartUploadTargetPartSchema = z.strictObject({
  partNumber: z.number().int().min(1).max(10_000),
  sizeBytes: z.number().int().positive(),
  uploadUrl: z.string().url().max(4096),
  expiresAt: OffsetDateTimeSchema,
});

export const UploadTargetSchema = z
  .strictObject({
    assetId: PlatformUuidSchema,
    method: z.enum(['PRESIGNED_PUT', 'MULTIPART']),
    uploadUrl: z.string().url().max(4096).optional(),
    headers: z.record(z.string().min(1).max(128), z.string().max(4096)),
    multipartUploadId: z.string().min(1).max(1024).optional(),
    partSizeBytes: z.number().int().positive().optional(),
    parts: z
      .array(MultipartUploadTargetPartSchema)
      .min(1)
      .max(10_000)
      .optional(),
  })
  .superRefine((target, context) => {
    if (target.method === 'PRESIGNED_PUT') {
      if (target.uploadUrl === undefined) {
        context.addIssue({
          code: 'custom',
          path: ['uploadUrl'],
          message: 'uploadUrl is required for PRESIGNED_PUT.',
        });
      }
      for (const field of [
        'multipartUploadId',
        'partSizeBytes',
        'parts',
      ] as const) {
        if (target[field] !== undefined) {
          context.addIssue({
            code: 'custom',
            path: [field],
            message: `${field} is forbidden for PRESIGNED_PUT.`,
          });
        }
      }
      return;
    }
    for (const field of [
      'multipartUploadId',
      'partSizeBytes',
      'parts',
    ] as const) {
      if (target[field] === undefined) {
        context.addIssue({
          code: 'custom',
          path: [field],
          message: `${field} is required for MULTIPART.`,
        });
      }
    }
    if (target.uploadUrl !== undefined) {
      context.addIssue({
        code: 'custom',
        path: ['uploadUrl'],
        message: 'uploadUrl is forbidden for MULTIPART.',
      });
    }
    if (
      target.parts !== undefined &&
      target.parts.some((part, index) => part.partNumber !== index + 1)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['parts'],
        message: 'Multipart part numbers must be contiguous from one.',
      });
    }
  });

export const CreateUploadSessionOutputSchema = z.strictObject({
  uploadSession: UploadSessionSchema,
  uploadTargets: z.array(UploadTargetSchema).min(1).max(1_000),
});

export const CompletedMultipartPartSchema = z.strictObject({
  partNumber: z.number().int().min(1).max(10_000),
  etag: z.string().min(1).max(1024),
});

export const CompletedUploadObjectSchema = z
  .strictObject({
    assetId: PlatformUuidSchema,
    sizeBytes: z.number().int().positive().max(MAX_UPLOAD_SIZE_BYTES),
    sha256: Sha256Schema,
    etag: z.string().min(1).max(1024).optional(),
    multipartUploadId: z.string().min(1).max(1024).optional(),
    parts: z.array(CompletedMultipartPartSchema).min(1).max(10_000).optional(),
  })
  .superRefine((object, context) => {
    if (
      (object.multipartUploadId === undefined) !==
      (object.parts === undefined)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['parts'],
        message: 'multipartUploadId and parts must be supplied together.',
      });
    }
    if (
      object.parts !== undefined &&
      object.parts.some((part, index) => part.partNumber !== index + 1)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['parts'],
        message: 'Completed multipart parts must be contiguous from one.',
      });
    }
  });

export const CompleteUploadSessionInputSchema = z.strictObject({
  uploadSessionId: PlatformUuidSchema,
  expectedVersion: z.number().int().positive(),
  objects: z.array(CompletedUploadObjectSchema).min(1).max(1_000),
});

export const CompleteUploadSessionOutputSchema = z.strictObject({
  uploadSession: UploadSessionSchema,
});
