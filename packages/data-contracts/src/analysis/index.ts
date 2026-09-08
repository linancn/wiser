import { z } from 'zod';
import { PlatformUuidSchema } from '@wiser/platform-contracts';
import { ExplorationVersionRefSchema } from '../exploration/index.ts';
import { OperationSchema } from '../operation/index.ts';

export const CreateAnalysisInputSchema = ExplorationVersionRefSchema;
export const CreateAnalysisOutputSchema = z.strictObject({
  analysisId: PlatformUuidSchema,
  operation: OperationSchema,
});

const CountSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
export const AnalysisAssetResultSchema = z
  .strictObject({
    assetId: PlatformUuidSchema,
    status: z.enum([
      'READY',
      'EMPTY',
      'PARTIAL',
      'UNSUPPORTED',
      'INVALID',
      'RESTRICTED',
    ]),
    recordCount: CountSchema.nullable(),
    featureCount: CountSchema.nullable(),
    reason: z
      .string()
      .regex(/^[A-Z][A-Z0-9_]{0,127}$/)
      .nullable(),
  })
  .superRefine((value, context) => {
    const parsed = ['READY', 'EMPTY', 'PARTIAL'].includes(value.status);
    if (parsed) {
      if (
        value.recordCount === null ||
        value.featureCount === null ||
        value.featureCount > value.recordCount
      ) {
        context.addIssue({
          code: 'custom',
          message:
            'Parsed counts must be known and features cannot exceed records',
        });
      }
      if (
        value.status === 'EMPTY' &&
        (value.recordCount !== 0 || value.featureCount !== 0)
      ) {
        context.addIssue({
          code: 'custom',
          message: 'Empty sources have zero records and features',
        });
      }
    } else if (
      value.recordCount !== null ||
      value.featureCount !== null ||
      value.reason === null
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'Unparsed sources require unknown counts and an explicit reason',
      });
    }
    if (value.status === 'PARTIAL' && value.reason === null) {
      context.addIssue({
        code: 'custom',
        message: 'Partial parsing requires an explicit reason',
      });
    }
  });

export type CreateAnalysisInput = z.infer<typeof CreateAnalysisInputSchema>;
export type AnalysisAssetResult = z.infer<typeof AnalysisAssetResultSchema>;
