import { z } from 'zod';
export const ExplorationTimeShape = {
  format: z.enum(['iso-offset', 'dmy-local', 'ymd-local']),
  utcOffsetMinutes: z.number().int().min(-840).max(840),
};
export const ExplorationInstantSchema = z.iso
  .datetime({ offset: true })
  .regex(/^[^.]+(?:\.[0-9]{1,6})?(?:Z|[+-][0-9]{2}:[0-9]{2})$/);
export const ExplorationTimeFilterSchema = z.strictObject({
  field: z.string().min(1).max(128),
  type: z.literal('time'),
  ...ExplorationTimeShape,
  operator: z.enum(['eq', 'ne', 'gt', 'gte', 'lt', 'lte']),
  value: ExplorationInstantSchema,
});
export const ExplorationTimeSortSchema = z.strictObject({
  field: z.string().min(1).max(128),
  type: z.literal('time'),
  ...ExplorationTimeShape,
  direction: z.enum(['asc', 'desc']),
});
export const ExplorationTimeGroupSchema = z.strictObject({
  field: z.string().min(1).max(128),
  type: z.literal('time'),
  ...ExplorationTimeShape,
  bucket: z.enum(['hour', 'day', 'month', 'year']),
});
export type ExplorationTimeConfig = Pick<
  z.infer<typeof ExplorationTimeFilterSchema>,
  'format' | 'utcOffsetMinutes'
>;
