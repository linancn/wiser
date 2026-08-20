import {
  AllocationPlanSubmissionSchema,
  CreateEpisodeRequestSchema,
} from '@agent-excon/contracts';
import { z } from 'zod';

import { DEFAULT_SCENARIO_VERSION_ID } from './scenario.js';

export const EpisodeIdParamsSchema = z.strictObject({
  episodeId: z.string().uuid(),
});

export const SubmissionIdParamsSchema = z.strictObject({
  submissionId: z.string().uuid(),
});

export const CreateEpisodeBodySchema = CreateEpisodeRequestSchema.extend({
  scenarioVersionId: z
    .string()
    .min(3)
    .max(128)
    .default(DEFAULT_SCENARIO_VERSION_ID),
});

export const ObserveBodySchema = z.strictObject({
  episodeVersion: z.number().int().positive(),
  informationIds: z
    .array(z.string().min(3).max(128))
    .min(1)
    .max(100)
    .optional(),
});

export const SubmitPlanBodySchema = z.strictObject({
  episodeVersion: z.number().int().positive(),
  plan: AllocationPlanSubmissionSchema,
});

export const AdvanceBodySchema = z.strictObject({
  episodeVersion: z.number().int().positive(),
});

export const IdempotencyKeySchema = z.string().uuid();

export const ObservationQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const EventQuerySchema = z.strictObject({
  after: z.coerce.number().int().nonnegative().default(0),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});
