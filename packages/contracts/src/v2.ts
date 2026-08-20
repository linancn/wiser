import { z } from 'zod';

const V2LocalizedTextSchema = z.strictObject({
  'zh-CN': z.string().trim().min(1).max(2_000),
  en: z.string().trim().min(1).max(2_000),
});

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number().finite(),
    z.string(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
  ]),
);

export const JsonObjectSchema = z.record(z.string(), JsonValueSchema);
export type JsonObject = z.infer<typeof JsonObjectSchema>;

export const EntityKeySchema = z
  .string()
  .trim()
  .min(3)
  .max(128)
  .regex(/^[a-z0-9][a-z0-9._:-]*$/);
export const Sha256DigestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
export const V2TimestampSchema = z.string().datetime({ offset: true });
export const AggregateVersionSchema = z.number().int().positive();

export const ScenarioLifecycleSchema = z.enum([
  'DRAFT',
  'PUBLISHED',
  'RETIRED',
]);
export const PublishedScenarioLifecycleSchema = z.enum([
  'PUBLISHED',
  'RETIRED',
]);
export const ScenarioValidationStatusSchema = z.enum([
  'NOT_VALIDATED',
  'VALID',
  'INVALID',
]);

export const RoleDefinitionSchema = z.strictObject({
  id: EntityKeySchema,
  name: V2LocalizedTextSchema,
  mission: V2LocalizedTextSchema,
  expectedArtifact: V2LocalizedTextSchema,
});
export type RoleDefinitionDto = z.infer<typeof RoleDefinitionSchema>;

const PublicScenarioFields = {
  id: EntityKeySchema,
  slug: EntityKeySchema,
  title: V2LocalizedTextSchema,
  description: V2LocalizedTextSchema,
  region: V2LocalizedTextSchema,
  simulationOnly: z.literal(true),
  lifecycle: PublishedScenarioLifecycleSchema,
  currentVersionId: EntityKeySchema,
  publishedVersionCount: z.number().int().positive(),
  requiredRoleCount: z.number().int().min(2).max(64),
  minDistinctRequiredAgents: z.number().int().min(2).max(64),
} as const;

export const PublicScenarioSummarySchema = z.strictObject(PublicScenarioFields);
export type PublicScenarioSummaryDto = z.infer<
  typeof PublicScenarioSummarySchema
>;

export const PublicScenarioListSchema = z.strictObject({
  items: z.array(PublicScenarioSummarySchema),
});
export type PublicScenarioListDto = z.infer<typeof PublicScenarioListSchema>;

export const ManageScenarioSummarySchema = z.strictObject({
  ...PublicScenarioFields,
  lifecycle: ScenarioLifecycleSchema,
  currentVersionId: EntityKeySchema.optional(),
  publishedVersionCount: z.number().int().nonnegative(),
  requiredRoleCount: z.number().int().nonnegative().max(64),
  minDistinctRequiredAgents: z.number().int().nonnegative().max(64),
  ownerId: z.string().trim().min(1).max(128),
  version: AggregateVersionSchema,
  draftVersionCount: z.number().int().nonnegative(),
  latestValidationStatus: ScenarioValidationStatusSchema,
  updatedAt: V2TimestampSchema,
});
export type ManageScenarioSummaryDto = z.infer<
  typeof ManageScenarioSummarySchema
>;

export const ScenarioValidationIssueSchema = z.strictObject({
  code: z.enum([
    'REQUIRED_ROLES_MISSING',
    'DISTINCT_AGENT_QUORUM_INVALID',
    'DUPLICATE_ROLE_SLOT',
  ]),
  path: z.array(z.union([z.string(), z.number()])),
  message: V2LocalizedTextSchema,
});

export const ScenarioValidationSchema = z.strictObject({
  status: ScenarioValidationStatusSchema,
  errors: z.array(ScenarioValidationIssueSchema),
  validatedAt: V2TimestampSchema.optional(),
});

export const ScenarioVersionDetailSchema = z
  .strictObject({
    id: EntityKeySchema,
    scenarioId: EntityKeySchema,
    label: z.string().trim().min(1).max(128),
    summary: V2LocalizedTextSchema,
    lifecycle: ScenarioLifecycleSchema,
    replayStartAt: V2TimestampSchema,
    requiredRoles: z.array(RoleDefinitionSchema).min(1).max(64),
    minDistinctRequiredAgents: z.number().int().min(1).max(64),
    contentHash: Sha256DigestSchema.optional(),
    validation: ScenarioValidationSchema,
    version: AggregateVersionSchema,
    createdAt: V2TimestampSchema,
    updatedAt: V2TimestampSchema,
    publishedAt: V2TimestampSchema.optional(),
  })
  .superRefine((version, context) => {
    if (version.lifecycle !== 'DRAFT' && version.contentHash === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['contentHash'],
        message: 'published scenario versions require a content hash',
      });
    }
  });
export type ScenarioVersionDetailDto = z.infer<
  typeof ScenarioVersionDetailSchema
>;

export const PublicScenarioVersionDetailSchema = z.strictObject({
  id: EntityKeySchema,
  scenarioId: EntityKeySchema,
  label: z.string().trim().min(1).max(128),
  summary: V2LocalizedTextSchema,
  lifecycle: PublishedScenarioLifecycleSchema,
  replayStartAt: V2TimestampSchema,
  requiredRoles: z.array(RoleDefinitionSchema).min(2).max(64),
  minDistinctRequiredAgents: z.number().int().min(2).max(64),
  contentHash: Sha256DigestSchema,
  publishedAt: V2TimestampSchema,
});
export type PublicScenarioVersionDetailDto = z.infer<
  typeof PublicScenarioVersionDetailSchema
>;

export const PublicScenarioDetailSchema = z.strictObject({
  scenario: PublicScenarioSummarySchema,
  currentVersion: PublicScenarioVersionDetailSchema,
});

export const PublicScenarioVersionListSchema = z.strictObject({
  items: z.array(PublicScenarioVersionDetailSchema),
});

export const ManageScenarioListSchema = z.strictObject({
  items: z.array(ManageScenarioSummarySchema),
});

export const CreateScenarioRequestSchema = z.strictObject({
  slug: EntityKeySchema,
  title: V2LocalizedTextSchema,
  description: V2LocalizedTextSchema,
  region: V2LocalizedTextSchema,
  simulationOnly: z.literal(true),
});
export type CreateScenarioRequest = z.infer<typeof CreateScenarioRequestSchema>;

export const CreateScenarioVersionRequestSchema = z.strictObject({
  expectedScenarioVersion: AggregateVersionSchema,
  label: z.string().trim().min(1).max(128),
  summary: V2LocalizedTextSchema,
  replayStartAt: V2TimestampSchema,
  minDistinctRequiredAgents: z.number().int().min(1).max(64),
  requiredRoles: z.array(RoleDefinitionSchema).min(1).max(64),
});
export type CreateScenarioVersionRequest = z.infer<
  typeof CreateScenarioVersionRequestSchema
>;

export const VersionCommandRequestSchema = z.strictObject({
  expectedVersion: AggregateVersionSchema,
});
export type VersionCommandRequest = z.infer<typeof VersionCommandRequestSchema>;

export const AgentIdentityLifecycleSchema = z.enum([
  'ACTIVE',
  'SUSPENDED',
  'REVOKED',
]);
export const AgentVersionLifecycleSchema = z.enum(['PUBLISHED', 'RETIRED']);
export const ParticipantTelemetryModeSchema = z.enum([
  'none',
  'partial',
  'instrumented',
]);

export const AgentIdentitySchema = z.strictObject({
  id: z.string().uuid(),
  ownerId: z.string().trim().min(1).max(128),
  displayName: V2LocalizedTextSchema,
  description: V2LocalizedTextSchema,
  lifecycle: AgentIdentityLifecycleSchema,
  version: AggregateVersionSchema,
  createdAt: V2TimestampSchema,
  updatedAt: V2TimestampSchema,
});
export type AgentIdentityDto = z.infer<typeof AgentIdentitySchema>;

export const AgentVersionSchema = z.strictObject({
  id: z.string().uuid(),
  agentId: z.string().uuid(),
  lifecycle: AgentVersionLifecycleSchema,
  providerKind: z.enum(['fake', 'trusted-local-codex', 'openai-compatible']),
  model: z.string().trim().min(1).max(256),
  capabilities: z.array(EntityKeySchema).min(1).max(128),
  protocolVersion: z.literal('v2'),
  telemetryMode: ParticipantTelemetryModeSchema,
  skillManifestHash: Sha256DigestSchema,
  toolManifestHash: Sha256DigestSchema,
  contentHash: Sha256DigestSchema,
  version: AggregateVersionSchema,
  publishedAt: V2TimestampSchema,
});
export type AgentVersionDto = z.infer<typeof AgentVersionSchema>;

export const CreateAgentIdentityRequestSchema = z.strictObject({
  displayName: V2LocalizedTextSchema,
  description: V2LocalizedTextSchema,
});
export type CreateAgentIdentityRequest = z.infer<
  typeof CreateAgentIdentityRequestSchema
>;

export const CreateAgentVersionRequestSchema = z.strictObject({
  expectedAgentVersion: AggregateVersionSchema,
  providerKind: z.enum(['fake', 'trusted-local-codex', 'openai-compatible']),
  model: z.string().trim().min(1).max(256),
  capabilities: z.array(EntityKeySchema).min(1).max(128),
  protocolVersion: z.literal('v2'),
  telemetryMode: ParticipantTelemetryModeSchema,
  skillManifestHash: Sha256DigestSchema,
  toolManifestHash: Sha256DigestSchema,
});
export type CreateAgentVersionRequest = z.infer<
  typeof CreateAgentVersionRequestSchema
>;

export const AgentIdentityListSchema = z.strictObject({
  items: z.array(AgentIdentitySchema),
});

export const ExerciseRunStateSchema = z.enum([
  'CREATED',
  'FORMING',
  'READY',
  'RUNNING',
  'PAUSED',
  'COMPLETING',
  'COMPLETED',
  'CANCELLED',
  'FAILED',
]);
export const ExerciseRunModeSchema = z.enum(['exercise', 'rehearsal']);

export const RunSchema = z.strictObject({
  id: z.string().uuid(),
  scenarioVersionId: EntityKeySchema,
  ownerId: z.string().trim().min(1).max(128),
  label: V2LocalizedTextSchema,
  mode: ExerciseRunModeSchema,
  state: ExerciseRunStateSchema,
  virtualTime: V2TimestampSchema,
  version: AggregateVersionSchema,
  createdAt: V2TimestampSchema,
  updatedAt: V2TimestampSchema,
  startedAt: V2TimestampSchema.optional(),
});
export type RunDto = z.infer<typeof RunSchema>;

export const RunAgentStateSchema = z.enum([
  'JOINED',
  'READY',
  'WORKING',
  'WAITING_FEEDBACK',
  'DONE',
  'DISCONNECTED',
  'REMOVED',
]);

export const RunAgentSchema = z.strictObject({
  id: z.string().uuid(),
  runId: z.string().uuid(),
  agentVersionId: z.string().uuid(),
  instanceKey: EntityKeySchema,
  roleSlotId: EntityKeySchema,
  state: RunAgentStateSchema,
  version: AggregateVersionSchema,
  joinedAt: V2TimestampSchema,
});
export type RunAgentDto = z.infer<typeof RunAgentSchema>;

export const RunRoleAssignmentSchema = z.strictObject({
  id: z.string().uuid(),
  runId: z.string().uuid(),
  runAgentId: z.string().uuid(),
  roleSlotId: EntityKeySchema,
  primary: z.literal(true),
  assignedAt: V2TimestampSchema,
  assignedRunSeq: z.number().int().positive(),
});
export type RunRoleAssignmentDto = z.infer<typeof RunRoleAssignmentSchema>;

export const RunTaskStateSchema = z.enum([
  'BLOCKED',
  'READY',
  'CLAIMED',
  'IN_PROGRESS',
  'SUBMITTED',
  'EVALUATING',
  'REWORK_REQUIRED',
  'ACCEPTED',
]);

export const RunTaskSchema = z.strictObject({
  id: z.string().uuid(),
  runId: z.string().uuid(),
  roleSlotId: EntityKeySchema,
  assignedRunAgentId: z.string().uuid(),
  definitionKey: EntityKeySchema,
  title: V2LocalizedTextSchema,
  objective: V2LocalizedTextSchema,
  state: RunTaskStateSchema,
  lockVersion: AggregateVersionSchema,
  claimEpoch: z.number().int().nonnegative().default(0),
  claimedByRunAgentId: z.string().uuid().optional(),
  leaseExpiresAt: V2TimestampSchema.optional(),
  createdRunSeq: z.number().int().positive(),
});
export type RunTaskDto = z.infer<typeof RunTaskSchema>;

export const RunBarrierSchema = z.strictObject({
  id: z.string().uuid(),
  runId: z.string().uuid(),
  definitionKey: EntityKeySchema,
  state: z.enum(['CLOSED', 'SATISFIED', 'RELEASED']),
  version: AggregateVersionSchema,
  requiredTaskIds: z.array(z.string().uuid()).min(1),
});
export type RunBarrierDto = z.infer<typeof RunBarrierSchema>;

export const RunMessageSchema = z.strictObject({
  id: z.string().uuid(),
  runId: z.string().uuid(),
  senderType: z.enum(['EXCON', 'RUN_AGENT']),
  senderId: z.string().min(1).max(128),
  recipientRunAgentIds: z.array(z.string().uuid()).min(1),
  subject: V2LocalizedTextSchema,
  body: V2LocalizedTextSchema,
  createdRunSeq: z.number().int().positive(),
  createdAt: V2TimestampSchema,
});
export type RunMessageDto = z.infer<typeof RunMessageSchema>;

export const RunArtifactSchema = z.strictObject({
  id: z.string().uuid(),
  runId: z.string().uuid(),
  artifactKey: EntityKeySchema.optional(),
  versionId: z.string().uuid(),
  versionNo: z.number().int().positive().default(1),
  baseVersionId: z.string().uuid().optional(),
  artifactType: EntityKeySchema,
  title: V2LocalizedTextSchema,
  content: JsonObjectSchema,
  contentHash: Sha256DigestSchema,
  authorType: z.enum(['EXCON', 'RUN_AGENT']),
  authorId: z.string().min(1).max(128),
  recipientRunAgentIds: z.array(z.string().uuid()).min(1).optional(),
  createdRunSeq: z.number().int().positive(),
  createdAt: V2TimestampSchema,
});
export type RunArtifactDto = z.infer<typeof RunArtifactSchema>;

export const FeedbackActionSchema = z.enum([
  'revise_task',
  'resubmit',
  'endorse',
  'request_clarification',
]);

export const FeedbackActionGrantSchema = z.strictObject({
  id: z.string().uuid(),
  targetRunAgentId: z.string().uuid(),
  targetTaskId: z.string().uuid(),
  action: FeedbackActionSchema,
  predecessorSubmissionId: z.string().uuid().optional(),
  evaluationId: z.string().uuid(),
  issuedRunSeq: z.number().int().positive(),
  issuedAt: V2TimestampSchema,
  expiresVirtualAt: V2TimestampSchema.optional(),
  expiresAt: V2TimestampSchema.optional(),
  maxUses: z.number().int().positive(),
  usedCount: z.number().int().nonnegative(),
  revokedRunSeq: z.number().int().positive().optional(),
  scopeHash: Sha256DigestSchema,
  version: AggregateVersionSchema,
});
export type FeedbackActionGrantDto = z.infer<typeof FeedbackActionGrantSchema>;

export const RunFeedbackSchema = z.strictObject({
  id: z.string().uuid(),
  runId: z.string().uuid(),
  targetScope: z.enum(['individual', 'role', 'team']),
  recipientRunAgentIds: z.array(z.string().uuid()).min(1),
  basisType: z.enum(['readiness', 'evaluation']),
  summary: V2LocalizedTextSchema,
  guidance: z.array(V2LocalizedTextSchema).max(20),
  allowedActions: z.array(
    z.enum([
      'claim_task',
      'revise_task',
      'resubmit',
      'endorse',
      'request_clarification',
    ]),
  ),
  subjectSubmissionId: z.string().uuid().optional(),
  actionGrants: z.array(FeedbackActionGrantSchema).optional(),
  createdRunSeq: z.number().int().positive(),
  createdAt: V2TimestampSchema,
});
export type RunFeedbackDto = z.infer<typeof RunFeedbackSchema>;

export const RunAgentMeSchema = z.strictObject({
  runAgent: RunAgentSchema,
  roleAssignment: RunRoleAssignmentSchema,
  role: RoleDefinitionSchema,
  syncCursor: z.strictObject({
    afterReceiptSeq: z.number().int().nonnegative(),
    receiptHeadHash: Sha256DigestSchema,
  }),
});
export type RunAgentMeDto = z.infer<typeof RunAgentMeSchema>;

export const TaskClaimRequestSchema = z.strictObject({
  expectedVersion: AggregateVersionSchema,
  leaseSeconds: z.number().int().min(15).max(300).default(60),
});
export type TaskClaimRequest = z.infer<typeof TaskClaimRequestSchema>;

export const OpaqueTaskLeaseTokenSchema = z
  .string()
  .min(36)
  .max(256)
  .regex(/^wlt_[A-Za-z0-9_-]+$/);

export const TaskLeaseCommandRequestSchema = z.strictObject({
  expectedVersion: AggregateVersionSchema,
  claimEpoch: z.number().int().positive(),
  leaseToken: OpaqueTaskLeaseTokenSchema,
});
export type TaskLeaseCommandRequest = z.infer<
  typeof TaskLeaseCommandRequestSchema
>;

export const TaskHeartbeatRequestSchema = TaskLeaseCommandRequestSchema.extend({
  extendBySeconds: z.number().int().min(1).max(300),
});
export type TaskHeartbeatRequest = z.infer<typeof TaskHeartbeatRequestSchema>;

export const TaskCommandResponseSchema = z.strictObject({
  task: RunTaskSchema,
});

export const TaskClaimResponseSchema = z.strictObject({
  task: RunTaskSchema,
  lease: z.strictObject({
    claimEpoch: z.number().int().positive(),
    leaseToken: OpaqueTaskLeaseTokenSchema,
    leaseExpiresAt: V2TimestampSchema,
    maximumLeaseExpiresAt: V2TimestampSchema,
  }),
});
export type TaskClaimResponseDto = z.infer<typeof TaskClaimResponseSchema>;

export const ReceiptReferenceSchema = z.strictObject({
  receiptId: z.string().uuid(),
  receiptHash: Sha256DigestSchema,
});
export type ReceiptReferenceDto = z.infer<typeof ReceiptReferenceSchema>;

export const ArtifactVersionReferenceSchema = z.strictObject({
  artifactId: z.string().uuid(),
  artifactVersionId: z.string().uuid(),
  contentHash: Sha256DigestSchema,
});
export type ArtifactVersionReferenceDto = z.infer<
  typeof ArtifactVersionReferenceSchema
>;

const UniqueRunAgentRecipientsSchema = z
  .array(z.string().uuid())
  .min(1)
  .max(64)
  .superRefine((ids, context) => {
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: 'custom',
        message: 'recipientRunAgentIds must be unique',
      });
    }
  });

export const CreateTaskSubmissionRequestSchema = z
  .strictObject({
    expectedVersion: AggregateVersionSchema,
    claimEpoch: z.number().int().positive(),
    leaseToken: OpaqueTaskLeaseTokenSchema,
    submissionType: EntityKeySchema,
    targetScope: z.enum(['individual', 'role', 'team']).default('individual'),
    payload: JsonObjectSchema,
    receiptRefs: z.array(ReceiptReferenceSchema).max(200).default([]),
    artifactVersionRefs: z
      .array(ArtifactVersionReferenceSchema)
      .max(200)
      .default([]),
    revisionOfId: z.string().uuid().optional(),
    feedbackActionGrantId: z.string().uuid().optional(),
    endorsementRecipientRunAgentIds: z
      .array(z.string().uuid())
      .max(64)
      .default([]),
  })
  .superRefine((input, context) => {
    if (input.receiptRefs.length + input.artifactVersionRefs.length === 0) {
      context.addIssue({
        code: 'custom',
        path: ['receiptRefs'],
        message:
          'a submission must cite at least one issued Receipt or ArtifactVersion',
      });
    }
    if (
      new Set(input.endorsementRecipientRunAgentIds).size !==
      input.endorsementRecipientRunAgentIds.length
    ) {
      context.addIssue({
        code: 'custom',
        path: ['endorsementRecipientRunAgentIds'],
        message: 'endorsement recipients must be unique',
      });
    }
    if (
      (input.revisionOfId === undefined) !==
      (input.feedbackActionGrantId === undefined)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['feedbackActionGrantId'],
        message:
          'a revision requires both revisionOfId and feedbackActionGrantId',
      });
    }
  });
export type CreateTaskSubmissionRequest = z.infer<
  typeof CreateTaskSubmissionRequestSchema
>;

export const RunSubmissionSchema = z.strictObject({
  id: z.string().uuid(),
  runId: z.string().uuid(),
  taskId: z.string().uuid(),
  actorRunAgentId: z.string().uuid(),
  targetScope: z.enum(['individual', 'role', 'team']),
  roleSlotId: EntityKeySchema,
  revisionNo: z.number().int().positive(),
  revisionOfId: z.string().uuid().optional(),
  submissionType: EntityKeySchema,
  isFinal: z.boolean(),
  payload: JsonObjectSchema,
  payloadHash: Sha256DigestSchema,
  receiptRefs: z.array(ReceiptReferenceSchema),
  artifactVersionRefs: z.array(ArtifactVersionReferenceSchema),
  endorsementRecipientRunAgentIds: z.array(z.string().uuid()),
  submittedVirtualAt: V2TimestampSchema,
  submittedAt: V2TimestampSchema,
  createdRunSeq: z.number().int().positive(),
});
export type RunSubmissionDto = z.infer<typeof RunSubmissionSchema>;

export const CreateRunMessageRequestSchema = z.strictObject({
  recipientRunAgentIds: UniqueRunAgentRecipientsSchema,
  subject: V2LocalizedTextSchema,
  body: V2LocalizedTextSchema,
});
export type CreateRunMessageRequest = z.infer<
  typeof CreateRunMessageRequestSchema
>;

export const CreateRunArtifactRequestSchema = z.strictObject({
  artifactKey: EntityKeySchema,
  artifactType: EntityKeySchema,
  title: V2LocalizedTextSchema,
  content: JsonObjectSchema,
  recipientRunAgentIds: UniqueRunAgentRecipientsSchema,
});
export type CreateRunArtifactRequest = z.infer<
  typeof CreateRunArtifactRequestSchema
>;

export const CreateArtifactVersionRequestSchema = z.strictObject({
  baseVersionId: z.string().uuid(),
  content: JsonObjectSchema,
  recipientRunAgentIds: UniqueRunAgentRecipientsSchema,
});
export type CreateArtifactVersionRequest = z.infer<
  typeof CreateArtifactVersionRequestSchema
>;

export const CreateSubmissionEndorsementRequestSchema = z.strictObject({
  feedbackActionGrantId: z.string().uuid(),
});
export type CreateSubmissionEndorsementRequest = z.infer<
  typeof CreateSubmissionEndorsementRequestSchema
>;

export const SubmissionEndorsementSchema = z.strictObject({
  id: z.string().uuid(),
  runId: z.string().uuid(),
  submissionId: z.string().uuid(),
  endorserRunAgentId: z.string().uuid(),
  feedbackActionGrantId: z.string().uuid(),
  endorsedAt: V2TimestampSchema,
  createdRunSeq: z.number().int().positive(),
});
export type SubmissionEndorsementDto = z.infer<
  typeof SubmissionEndorsementSchema
>;

export const CreateRunRequestSchema = z.strictObject({
  scenarioVersionId: EntityKeySchema,
  label: V2LocalizedTextSchema,
  mode: ExerciseRunModeSchema,
});
export type CreateRunRequest = z.infer<typeof CreateRunRequestSchema>;

export const JoinRunAgentRequestSchema = z.strictObject({
  agentVersionId: z.string().uuid(),
  instanceKey: EntityKeySchema,
  roleSlotId: EntityKeySchema,
});
export type JoinRunAgentRequest = z.infer<typeof JoinRunAgentRequestSchema>;

export const RunListSchema = z.strictObject({ items: z.array(RunSchema) });
export const RunAgentListSchema = z.strictObject({
  items: z.array(RunAgentSchema),
});

export const RunResourceSchema = z.union([
  RunTaskSchema,
  RunMessageSchema,
  RunArtifactSchema,
  RunFeedbackSchema,
]);
export const RunResourceListSchema = z.strictObject({
  items: z.array(RunResourceSchema),
});

export const ReceiptResourceTypeSchema = z.enum([
  'task',
  'message',
  'artifact',
  'feedback',
]);
export const ReceiptViewKindSchema = z.enum([
  'task_assignment',
  'message',
  'artifact_grant',
  'feedback',
]);

export const ReceiptAcknowledgementRequestSchema = z.strictObject({
  throughReceiptSeq: z.number().int().positive(),
  headHash: Sha256DigestSchema,
});

export const RunSyncRequestSchema = z
  .strictObject({
    afterReceiptSeq: z.number().int().nonnegative(),
    ack: ReceiptAcknowledgementRequestSchema.optional(),
    maxItems: z.number().int().min(1).max(100).default(50),
  })
  .superRefine((request, context) => {
    if (
      request.ack !== undefined &&
      request.ack.throughReceiptSeq !== request.afterReceiptSeq
    ) {
      context.addIssue({
        code: 'custom',
        path: ['ack', 'throughReceiptSeq'],
        message: 'acknowledgement must cover the supplied receipt cursor',
      });
    }
  });
export type RunSyncRequest = z.infer<typeof RunSyncRequestSchema>;

export const AgentViewReceiptSchema = z.strictObject({
  id: z.string().uuid(),
  runId: z.string().uuid(),
  runAgentId: z.string().uuid(),
  agentReceiptSeq: z.number().int().positive(),
  deliveryBatchId: z.string().uuid(),
  sourceEventId: z.string().uuid(),
  sourceRunSeq: z.number().int().positive(),
  issuedEventId: z.string().uuid(),
  issuedRunSeq: z.number().int().positive(),
  viewKind: ReceiptViewKindSchema,
  resourceType: ReceiptResourceTypeSchema,
  resourceId: z.string().uuid(),
  resourceVersion: z.string().min(1).max(128),
  availableVirtualAt: V2TimestampSchema,
  issuedVirtualAt: V2TimestampSchema,
  issuedAt: V2TimestampSchema,
  schemaVersion: z.literal(1),
  contentSnapshot: z.record(z.string(), z.unknown()),
  contentHash: Sha256DigestSchema,
  previousReceiptHash: Sha256DigestSchema,
  receiptHash: Sha256DigestSchema,
});
export type AgentViewReceiptDto = z.infer<typeof AgentViewReceiptSchema>;

export const SyncDeliveryBatchSchema = z
  .strictObject({
    deliveryBatchId: z.string().uuid(),
    runId: z.string().uuid(),
    runAgentId: z.string().uuid(),
    fromReceiptSeq: z.number().int().positive().nullable(),
    throughReceiptSeq: z.number().int().nonnegative(),
    receiptHeadHash: Sha256DigestSchema,
    runCursor: z.number().int().nonnegative(),
    hasMore: z.boolean(),
    receipts: z.array(AgentViewReceiptSchema),
  })
  .superRefine((batch, context) => {
    if (batch.receipts.length === 0) {
      if (batch.fromReceiptSeq !== null) {
        context.addIssue({
          code: 'custom',
          path: ['fromReceiptSeq'],
          message: 'an empty delivery batch must have a null fromReceiptSeq',
        });
      }
      return;
    }
    if (
      batch.fromReceiptSeq === null ||
      batch.fromReceiptSeq > batch.throughReceiptSeq ||
      batch.receipts[0]?.agentReceiptSeq !== batch.fromReceiptSeq ||
      batch.receipts.at(-1)?.agentReceiptSeq !== batch.throughReceiptSeq
    ) {
      context.addIssue({
        code: 'custom',
        path: ['fromReceiptSeq'],
        message: 'receipt bounds must match a non-empty delivery batch',
      });
    }
  });
export type SyncDeliveryBatchDto = z.infer<typeof SyncDeliveryBatchSchema>;

export const RunEventAssertionClassSchema = z.enum([
  'platform_observed',
  'participant_reported',
  'evaluator_derived',
  'operator_asserted',
  'external_outcome',
]);

export const RunEventSchema = z.strictObject({
  eventId: z.string().uuid(),
  runId: z.string().uuid(),
  runSeq: z.number().int().positive(),
  streamType: z.enum([
    'run',
    'run_agent',
    'task',
    'message',
    'artifact',
    'feedback',
    'receipt',
    'submission',
    'endorsement',
  ]),
  streamId: z.string().min(1).max(128),
  eventType: EntityKeySchema,
  actorType: z.enum(['operator', 'run_agent', 'system']),
  actorId: z.string().min(1).max(128),
  correlationId: z.string().uuid().optional(),
  causationId: z.string().uuid().optional(),
  virtualTime: V2TimestampSchema,
  occurredAt: V2TimestampSchema,
  recordedAt: V2TimestampSchema,
  schemaVersion: z.literal(1),
  assertionClass: RunEventAssertionClassSchema,
  payload: z.record(z.string(), z.unknown()),
  payloadHash: Sha256DigestSchema,
  previousHash: Sha256DigestSchema,
  eventHash: Sha256DigestSchema,
  traceId: z.string().min(16).max(64).optional(),
  spanId: z.string().min(8).max(32).optional(),
});
export type RunEventDto = z.infer<typeof RunEventSchema>;

export const ReplayPerspectiveSchema = z.enum([
  'operator',
  'team',
  'role',
  'agent',
]);
export const DeliverySemanticsSchema = z.enum([
  'acknowledged',
  'issued',
  'eligible',
]);

export const ReplayQuerySchema = z
  .strictObject({
    perspective: ReplayPerspectiveSchema.default('operator'),
    subjectId: z.string().min(1).max(128).optional(),
    atRunSeq: z.coerce.number().int().positive().optional(),
    deliverySemantics: DeliverySemanticsSchema.default('issued'),
  })
  .superRefine((query, context) => {
    if (query.perspective !== 'operator' && query.subjectId === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['subjectId'],
        message: 'subjectId is required outside the operator perspective',
      });
    }
  });
export type ReplayQuery = z.infer<typeof ReplayQuerySchema>;

export const ReplayManifestSchema = z.strictObject({
  atRunSeq: z.number().int().nonnegative(),
  scenarioVersionHash: Sha256DigestSchema,
  eventChainHead: Sha256DigestSchema,
  receiptChainHeads: z.record(z.string(), Sha256DigestSchema),
  verified: z.boolean(),
});

export const EligibleResourceProjectionSchema = z.strictObject({
  runAgentId: z.string().uuid(),
  resourceType: ReceiptResourceTypeSchema,
  resourceId: z.string().uuid(),
  resourceVersion: z.string().min(1).max(128),
  sourceRunSeq: z.number().int().positive(),
  availableVirtualAt: V2TimestampSchema,
  issuedReceiptSeq: z.number().int().positive().optional(),
});
export type EligibleResourceProjectionDto = z.infer<
  typeof EligibleResourceProjectionSchema
>;

export const RunAuthoritativeProjectionSchema = z.strictObject({
  run: RunSchema,
  runAgents: z.array(RunAgentSchema),
  roleAssignments: z.array(RunRoleAssignmentSchema),
  tasks: z.array(RunTaskSchema),
  events: z.array(RunEventSchema),
  receipts: z.array(AgentViewReceiptSchema),
  eligibleResources: z.array(EligibleResourceProjectionSchema),
  manifest: ReplayManifestSchema,
});
export type RunAuthoritativeProjectionDto = z.infer<
  typeof RunAuthoritativeProjectionSchema
>;

export const TraceSummarySchema = z.strictObject({
  traceId: z.string().min(16).max(64),
  runId: z.string().uuid(),
  runAgentId: z.string().uuid().optional(),
  name: z.string().min(1).max(256),
  startedAt: V2TimestampSchema,
  durationMs: z.number().nonnegative(),
  status: z.enum(['UNSET', 'OK', 'ERROR']),
  source: z.enum(['excon_service', 'participant_exporter']),
  trust: z.enum(['platform_observed', 'participant_reported']),
  spanCount: z.number().int().nonnegative(),
});
export type TraceSummaryDto = z.infer<typeof TraceSummarySchema>;

export const BestEffortTelemetryOverlaySchema = z.strictObject({
  bestEffort: z.literal(true),
  gap: z.boolean(),
  traces: z.array(TraceSummarySchema),
  coverage: z.strictObject({
    boundaryCoverage: z.number().min(0).max(1),
    participantTelemetryMode: ParticipantTelemetryModeSchema,
    droppedSpanCount: z.number().int().nonnegative(),
    lateSpanCount: z.number().int().nonnegative(),
    retentionEndsAt: V2TimestampSchema.optional(),
  }),
  trust: z.strictObject({
    platformObservedSpanCount: z.number().int().nonnegative(),
    participantReportedSpanCount: z.number().int().nonnegative(),
  }),
});
export type BestEffortTelemetryOverlayDto = z.infer<
  typeof BestEffortTelemetryOverlaySchema
>;

export const ReplayResponseSchema = z.strictObject({
  authoritativeProjection: RunAuthoritativeProjectionSchema,
  bestEffortTelemetryOverlay: BestEffortTelemetryOverlaySchema,
});
export type ReplayResponseDto = z.infer<typeof ReplayResponseSchema>;

export const RunEventListSchema = z.strictObject({
  items: z.array(RunEventSchema),
  nextAfter: z.number().int().nonnegative(),
});
