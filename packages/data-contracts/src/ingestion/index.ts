import { z } from 'zod';

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
