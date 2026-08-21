import { z } from 'zod';

export {
  PlatformScopeSchema,
  PlatformUuidSchema,
  type PlatformScope,
} from '@wiser/platform-contracts';

export const DataKeySchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-z][a-z0-9-]*(?:[.:][a-z0-9][a-z0-9_-]*)*$/);

export const DataFieldNameSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z_][A-Za-z0-9_.-]*$/);

export const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

export const OffsetDateTimeSchema = z.string().datetime({ offset: true });

export const CursorSchema = z.string().min(1).max(2048);

export const PageRequestFields = {
  first: z.number().int().min(1).max(200).default(50),
  after: CursorSchema.optional(),
} as const;
