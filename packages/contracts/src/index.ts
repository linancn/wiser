import { z } from 'zod';

export const LocaleSchema = z.enum(['zh-CN', 'en']);
export type Locale = z.infer<typeof LocaleSchema>;

export const LocalizedTextSchema = z
  .object({
    'zh-CN': z.string().min(1).max(2_000),
    en: z.string().min(1).max(2_000),
  })
  .strict();

export const EpisodeStateSchema = z.enum([
  'waiting_for_submission',
  'evaluation_queued',
  'evaluating',
  'feedback_available',
  'completed',
]);
export type EpisodeState = z.infer<typeof EpisodeStateSchema>;

export const WaterSourceIdSchema = z.enum([
  'guanting',
  'south-water',
  'reclaimed-lower',
]);
export type WaterSourceId = z.infer<typeof WaterSourceIdSchema>;

export const WaterSectionIdSchema = z.enum([
  'sanjiadian',
  'lugouqiao',
  'cuizhihuiying',
  'qujiadian',
]);
export type WaterSectionId = z.infer<typeof WaterSectionIdSchema>;

export const SourceReleaseDecisionSchema = z
  .object({
    sourceId: WaterSourceIdSchema,
    flowM3s: z.number().finite().min(0).max(100).multipleOf(0.1),
    evidenceRefs: z.array(z.string().min(3).max(128)).min(1).max(32),
  })
  .strict();
export type SourceReleaseDecision = z.infer<typeof SourceReleaseDecisionSchema>;

export const ExpectedSectionFlowSchema = z
  .object({
    sectionId: WaterSectionIdSchema,
    flowM3s: z.number().finite().min(0).max(200),
  })
  .strict();
export type ExpectedSectionFlow = z.infer<typeof ExpectedSectionFlowSchema>;

export const AllocationPlanSubmissionSchema = z
  .object({
    stage: z.number().int().min(1).max(2),
    sourceReleases: z.array(SourceReleaseDecisionSchema).length(3),
    expectedSectionFlows: z.array(ExpectedSectionFlowSchema).length(4),
    isFinal: z.boolean(),
  })
  .strict()
  .superRefine((plan, context) => {
    if (
      (plan.stage === 1 && plan.isFinal) ||
      (plan.stage === 2 && !plan.isFinal)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['isFinal'],
        message: 'stage 1 must be revisable and stage 2 must be final',
      });
    }
    const sourceIds = plan.sourceReleases.map(({ sourceId }) => sourceId);
    if (new Set(sourceIds).size !== sourceIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['sourceReleases'],
        message: 'sourceId values must be unique',
      });
    }
    const sectionIds = plan.expectedSectionFlows.map(
      ({ sectionId }) => sectionId,
    );
    if (new Set(sectionIds).size !== sectionIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['expectedSectionFlows'],
        message: 'sectionId values must be unique',
      });
    }
  });
export type AllocationPlanSubmission = z.infer<
  typeof AllocationPlanSubmissionSchema
>;

export const CreateEpisodeRequestSchema = z
  .object({
    scenarioVersionId: z.string().min(3).max(128),
    participantVersionId: z.string().uuid(),
  })
  .strict();
export type CreateEpisodeRequest = z.infer<typeof CreateEpisodeRequestSchema>;

export const EpisodeSchema = z
  .object({
    id: z.string().uuid(),
    scenarioVersionId: z.string().min(3).max(128),
    participantVersionId: z.string().uuid(),
    state: EpisodeStateSchema,
    stageIndex: z.number().int().min(0).max(1),
    virtualTime: z.string().datetime({ offset: true }),
    version: z.number().int().positive(),
  })
  .strict();
export type EpisodeDto = z.infer<typeof EpisodeSchema>;

export const ObservationSchema = z
  .object({
    id: z.string().uuid(),
    episodeId: z.string().uuid(),
    informationId: z.string().min(3).max(128),
    informationType: z.enum([
      'official_flow_anchor',
      'simulated_constraint',
      'simulated_constraint_update',
    ]),
    eventTime: z.string().datetime({ offset: true }),
    observedTime: z.string().datetime({ offset: true }),
    ingestedTime: z.string().datetime({ offset: true }),
    releasedTime: z.string().datetime({ offset: true }),
    accessedTime: z.string().datetime({ offset: true }),
    accessedVirtualTime: z.string().datetime({ offset: true }),
    supersedesInformationId: z.string().min(3).max(128).optional(),
    payload: z.record(z.string(), z.unknown()),
    sourceUrl: z.string().url().optional(),
    isSynthetic: z.boolean(),
  })
  .strict();
export type ObservationDto = z.infer<typeof ObservationSchema>;

export const EvaluationResultSchema = z
  .object({
    verdict: z.enum(['pass', 'partial', 'fail']),
    metrics: z
      .object({
        constraintCompliance: z.number().min(0).max(1),
        ecologicalCoverage: z.number().min(0).max(1),
        modelAccuracy: z.number().min(0).max(1),
        evidenceCoverage: z.number().min(0).max(1),
        timeTravelViolations: z.number().int().nonnegative(),
        totalScore: z.number().min(0).max(100),
      })
      .strict(),
  })
  .strict();
export type EvaluationResultDto = z.infer<typeof EvaluationResultSchema>;

export const FeedbackSchema = z
  .object({
    id: z.string().uuid(),
    submissionId: z.string().uuid(),
    level: z.number().int().min(0).max(6),
    evaluation: EvaluationResultSchema,
    summary: LocalizedTextSchema,
    issues: z.array(
      z
        .object({
          type: z.enum([
            'constraint_violation',
            'ecological_target_gap',
            'evidence_gap',
            'time_travel',
          ]),
          severity: z.enum(['low', 'medium', 'high']),
          target: z.string().min(1).max(128).optional(),
          message: LocalizedTextSchema,
        })
        .strict(),
    ),
    guidance: z.array(LocalizedTextSchema).max(20),
    allowedActions: z.array(
      z.enum(['observe', 'revise_submission', 'advance', 'finalize']),
    ),
  })
  .strict();
export type FeedbackDto = z.infer<typeof FeedbackSchema>;

export const ApiErrorCodeSchema = z.enum([
  'VALIDATION_FAILED',
  'EPISODE_NOT_FOUND',
  'EPISODE_VERSION_CONFLICT',
  'EPISODE_STATE_CONFLICT',
  'EVIDENCE_NOT_OBSERVED',
  'IDEMPOTENCY_CONFLICT',
  'NOT_AUTHORIZED',
  'INTERNAL_ERROR',
]);

export const ApiErrorSchema = z
  .object({
    error: z
      .object({
        code: ApiErrorCodeSchema,
        message: z.string().min(1).max(500),
        details: z.record(z.string(), z.unknown()).optional(),
        traceId: z.string().min(8).max(128),
      })
      .strict(),
  })
  .strict();
export type ApiError = z.infer<typeof ApiErrorSchema>;

export const AiProviderKindSchema = z.enum([
  'fake',
  'trusted-local-codex',
  'openai-compatible',
]);
export type AiProviderKind = z.infer<typeof AiProviderKindSchema>;

export const AiFeedbackSummarySchema = z
  .object({
    summary: LocalizedTextSchema,
    guidance: z.array(LocalizedTextSchema).max(5),
  })
  .strict();
export type AiFeedbackSummary = z.infer<typeof AiFeedbackSummarySchema>;
