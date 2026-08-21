import { z } from 'zod';

import {
  CursorSchema,
  OffsetDateTimeSchema,
  PageRequestFields,
} from '../common.js';
import { PlatformUuidSchema } from '@wiser/platform-contracts';

export const OperationStatusSchema = z.enum([
  'PENDING',
  'RUNNING',
  'WAITING_INPUT',
  'WAITING_REVIEW',
  'SUCCEEDED',
  'FAILED',
  'CANCELLED',
]);
export type OperationStatus = z.infer<typeof OperationStatusSchema>;

export const CapabilityKeySchema = z
  .string()
  .min(3)
  .max(128)
  .regex(/^[a-z][a-z0-9-]*(?:\.[a-z][A-Za-z0-9-]*)+$/);

export const OperationErrorSchema = z.strictObject({
  code: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[A-Z][A-Z0-9_]*$/),
  message: z.string().min(1).max(2048),
  retryable: z.boolean(),
});

export const OperationSchema = z
  .strictObject({
    operationId: PlatformUuidSchema,
    tenantId: PlatformUuidSchema,
    projectId: PlatformUuidSchema,
    capabilityId: CapabilityKeySchema,
    status: OperationStatusSchema,
    resource: z
      .string()
      .regex(
        /^operation:\/\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      ),
    progressPercent: z.number().int().min(0).max(100),
    version: z.number().int().positive(),
    createdAt: OffsetDateTimeSchema,
    updatedAt: OffsetDateTimeSchema,
    startedAt: OffsetDateTimeSchema.optional(),
    completedAt: OffsetDateTimeSchema.optional(),
    error: OperationErrorSchema.optional(),
  })
  .superRefine((operation, context) => {
    const terminal = ['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(
      operation.status,
    );
    if (terminal && operation.completedAt === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['completedAt'],
        message: 'completedAt is required for terminal operations.',
      });
    }
    if (operation.status === 'FAILED' && operation.error === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['error'],
        message: 'error is required for failed operations.',
      });
    }
  });
export type OperationDto = z.infer<typeof OperationSchema>;

export const CancelOperationInputSchema = z.strictObject({
  operationId: PlatformUuidSchema,
  expectedVersion: z.number().int().positive(),
  reason: z.string().min(1).max(2048).optional(),
});

export const OperationEventTypeSchema = z.enum([
  'CREATED',
  'STARTED',
  'PROGRESS_REPORTED',
  'WAITING_INPUT',
  'WAITING_REVIEW',
  'SUCCEEDED',
  'FAILED',
  'CANCELLED',
]);

export const OperationEventSchema = z.strictObject({
  eventId: PlatformUuidSchema,
  operationId: PlatformUuidSchema,
  sequence: z.number().int().positive(),
  eventType: OperationEventTypeSchema,
  status: OperationStatusSchema,
  progressPercent: z.number().int().min(0).max(100),
  operationVersion: z.number().int().positive(),
  occurredAt: OffsetDateTimeSchema,
  message: z.string().min(1).max(2048).optional(),
});
export type OperationEventDto = z.infer<typeof OperationEventSchema>;

export const GetOperationEventsInputSchema = z.strictObject({
  operationId: PlatformUuidSchema,
  ...PageRequestFields,
});

export const OperationEventPageSchema = z.strictObject({
  items: z.array(OperationEventSchema).max(10_000),
  nextCursor: CursorSchema.optional(),
});
