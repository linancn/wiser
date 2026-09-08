import { z } from 'zod';
import { PlatformUuidSchema } from '@wiser/platform-contracts';
import { Sha256Schema } from '../common.js';

const SourceKeySchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
export const SourceCompletenessSchema = z.enum([
  'UNKNOWN',
  'NOT_A_DATASET',
  'SAMPLE',
  'PARTIAL',
  'EMPTY',
]);

export const SourceRegistrationSchema = z.strictObject({
  sourceId: SourceKeySchema,
  kind: z.enum([
    'PROVIDER',
    'DATASET_INTERFACE',
    'CATALOG_ENTRY',
    'FILE_COLLECTION',
  ]),
  name: z.string().min(1).max(256),
  bundleId: SourceKeySchema,
  providerName: z.string().min(1).max(256),
  accessStatus: z.string().min(1).max(256),
  completeness: SourceCompletenessSchema,
  manifestAssetId: PlatformUuidSchema,
  manifestSha256: Sha256Schema,
  limitations: z.array(z.string().min(1).max(2048)).min(1).max(24),
});
export type SourceRegistration = z.infer<typeof SourceRegistrationSchema>;

export const SourceRegistrationFileSchema = z.strictObject({
  assetId: PlatformUuidSchema.optional(),
  path: z
    .string()
    .min(1)
    .max(1024)
    .regex(/^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[^\\]+$/)
    .refine((path) =>
      [...path].every(
        (character) =>
          character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127,
      ),
    ),
  sha256: Sha256Schema,
  sizeBytes: z.number().int().nonnegative(),
  preparedSha256: Sha256Schema,
  preparedSizeBytes: z.number().int().nonnegative(),
  artifactClass: z.string().min(1).max(128),
  completeness: SourceCompletenessSchema,
  disposition: z.enum(['IMPORT', 'SANITIZE_TEXT']),
  relatedSourceIds: z.array(SourceKeySchema).max(64),
});

export const SourceRegistrationManifestSchema = z.strictObject({
  schemaVersion: z.literal('wiser.source-registration.v1'),
  sourceId: SourceKeySchema,
  record: z.record(z.string().min(1).max(128), z.json()),
  files: z.array(SourceRegistrationFileSchema).max(1000),
});
