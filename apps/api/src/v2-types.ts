import type {
  AgentIdentityDto,
  AgentVersionDto,
  CreateArtifactVersionRequest,
  CreateAgentIdentityRequest,
  CreateAgentVersionRequest,
  CreateRunRequest,
  CreateRunArtifactRequest,
  CreateRunMessageRequest,
  CreateScenarioRequest,
  CreateScenarioVersionRequest,
  CreateSubmissionEndorsementRequest,
  CreateTaskSubmissionRequest,
  FeedbackActionGrantDto,
  JoinRunAgentRequest,
  ManageScenarioSummaryDto,
  PublicScenarioVersionDetailDto,
  PublicScenarioSummaryDto,
  ReplayQuery,
  ReplayResponseDto,
  RunAgentDto,
  RunAgentMeDto,
  RunArtifactDto,
  RunDto,
  RunEventDto,
  RunFeedbackDto,
  RunMessageDto,
  RunSubmissionDto,
  SubmissionEndorsementDto,
  TaskClaimRequest,
  TaskClaimResponseDto,
  TaskHeartbeatRequest,
  TaskLeaseCommandRequest,
  RunSyncRequest,
  RunTaskDto,
  ScenarioVersionDetailDto,
  SyncDeliveryBatchDto,
  VersionCommandRequest,
} from '@agent-excon/contracts';

import type { ParticipantPrincipal } from './types.js';

export type IssuedRunResource =
  RunTaskDto | RunMessageDto | RunArtifactDto | RunFeedbackDto;

export interface V2ExerciseService {
  isReady(): Promise<boolean>;

  listPublicScenarios(): Promise<readonly PublicScenarioSummaryDto[]>;
  getPublicScenario(scenarioId: string): Promise<{
    readonly scenario: PublicScenarioSummaryDto;
    readonly currentVersion: PublicScenarioVersionDetailDto;
  }>;
  listPublicScenarioVersions(
    scenarioId: string,
  ): Promise<readonly PublicScenarioVersionDetailDto[]>;
  getPublicScenarioVersion(
    scenarioVersionId: string,
  ): Promise<PublicScenarioVersionDetailDto>;

  listManageScenarios(
    principal: ParticipantPrincipal,
  ): Promise<readonly ManageScenarioSummaryDto[]>;
  createScenario(
    principal: ParticipantPrincipal,
    idempotencyKey: string,
    input: CreateScenarioRequest,
  ): Promise<{ readonly scenario: ManageScenarioSummaryDto }>;
  createScenarioVersion(
    principal: ParticipantPrincipal,
    scenarioId: string,
    idempotencyKey: string,
    input: CreateScenarioVersionRequest,
  ): Promise<{ readonly scenarioVersion: ScenarioVersionDetailDto }>;
  validateScenarioVersion(
    principal: ParticipantPrincipal,
    scenarioVersionId: string,
    idempotencyKey: string,
    input: VersionCommandRequest,
  ): Promise<{ readonly scenarioVersion: ScenarioVersionDetailDto }>;
  publishScenarioVersion(
    principal: ParticipantPrincipal,
    scenarioVersionId: string,
    idempotencyKey: string,
    input: VersionCommandRequest,
  ): Promise<{ readonly scenarioVersion: ScenarioVersionDetailDto }>;

  listAgents(
    principal: ParticipantPrincipal,
  ): Promise<readonly AgentIdentityDto[]>;
  createAgent(
    principal: ParticipantPrincipal,
    idempotencyKey: string,
    input: CreateAgentIdentityRequest,
  ): Promise<{ readonly agent: AgentIdentityDto }>;
  createAgentVersion(
    principal: ParticipantPrincipal,
    agentId: string,
    idempotencyKey: string,
    input: CreateAgentVersionRequest,
  ): Promise<{ readonly agentVersion: AgentVersionDto }>;
  getAgentVersion(
    principal: ParticipantPrincipal,
    agentVersionId: string,
  ): Promise<AgentVersionDto>;

  listRuns(principal: ParticipantPrincipal): Promise<readonly RunDto[]>;
  createRun(
    principal: ParticipantPrincipal,
    idempotencyKey: string,
    input: CreateRunRequest,
  ): Promise<{ readonly run: RunDto }>;
  getRun(
    principal: ParticipantPrincipal,
    runId: string,
  ): Promise<{ readonly run: RunDto }>;
  joinRun(
    principal: ParticipantPrincipal,
    runId: string,
    idempotencyKey: string,
    input: JoinRunAgentRequest,
  ): Promise<{ readonly runAgent: RunAgentDto }>;
  listRunAgents(
    principal: ParticipantPrincipal,
    runId: string,
  ): Promise<readonly RunAgentDto[]>;
  getRunAgentMe(
    principal: ParticipantPrincipal,
    runId: string,
    runAgentId: string,
  ): Promise<RunAgentMeDto>;
  startRun(
    principal: ParticipantPrincipal,
    runId: string,
    idempotencyKey: string,
    input: VersionCommandRequest,
  ): Promise<{ readonly run: RunDto }>;

  sync(
    principal: ParticipantPrincipal,
    runId: string,
    runAgentId: string,
    idempotencyKey: string,
    input: RunSyncRequest,
  ): Promise<SyncDeliveryBatchDto>;
  listIssuedResources(
    principal: ParticipantPrincipal,
    runId: string,
    runAgentId: string,
    resourceType: 'task' | 'message' | 'artifact' | 'feedback',
  ): Promise<readonly IssuedRunResource[]>;
  claimTask(
    principal: ParticipantPrincipal,
    runAgentId: string,
    taskId: string,
    idempotencyKey: string,
    input: TaskClaimRequest,
  ): Promise<TaskClaimResponseDto>;
  beginTask(
    principal: ParticipantPrincipal,
    runAgentId: string,
    taskId: string,
    idempotencyKey: string,
    input: TaskLeaseCommandRequest,
  ): Promise<{ readonly task: RunTaskDto }>;
  heartbeatTask(
    principal: ParticipantPrincipal,
    runAgentId: string,
    taskId: string,
    idempotencyKey: string,
    input: TaskHeartbeatRequest,
  ): Promise<{ readonly task: RunTaskDto }>;
  releaseTask(
    principal: ParticipantPrincipal,
    runAgentId: string,
    taskId: string,
    idempotencyKey: string,
    input: TaskLeaseCommandRequest,
  ): Promise<{ readonly task: RunTaskDto }>;
  submitTask(
    principal: ParticipantPrincipal,
    runAgentId: string,
    taskId: string,
    idempotencyKey: string,
    input: CreateTaskSubmissionRequest,
  ): Promise<{
    readonly submission: RunSubmissionDto;
    readonly task: RunTaskDto;
  }>;
  createMessage(
    principal: ParticipantPrincipal,
    runAgentId: string,
    runId: string,
    idempotencyKey: string,
    input: CreateRunMessageRequest,
  ): Promise<{ readonly message: RunMessageDto }>;
  createArtifact(
    principal: ParticipantPrincipal,
    runAgentId: string,
    runId: string,
    idempotencyKey: string,
    input: CreateRunArtifactRequest,
  ): Promise<{ readonly artifact: RunArtifactDto }>;
  createArtifactVersion(
    principal: ParticipantPrincipal,
    runAgentId: string,
    artifactId: string,
    idempotencyKey: string,
    input: CreateArtifactVersionRequest,
  ): Promise<{ readonly artifact: RunArtifactDto }>;
  endorseSubmission(
    principal: ParticipantPrincipal,
    runAgentId: string,
    submissionId: string,
    idempotencyKey: string,
    input: CreateSubmissionEndorsementRequest,
  ): Promise<{
    readonly endorsement: SubmissionEndorsementDto;
    readonly actionGrant: FeedbackActionGrantDto;
  }>;
  listRunEvents(
    principal: ParticipantPrincipal,
    runId: string,
    after: number,
    limit: number,
  ): Promise<readonly RunEventDto[]>;
  getReplay(
    principal: ParticipantPrincipal,
    runId: string,
    query: ReplayQuery,
  ): Promise<ReplayResponseDto>;

  close(): Promise<void>;
}
