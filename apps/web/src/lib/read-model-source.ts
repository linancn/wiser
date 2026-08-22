import {
  exerciseRuns,
  getReferenceInteractions,
  getReplayEventsForPerspective,
  getRunById,
  getScenarioById,
  scenarios,
  type AgentSession,
  type CollaborationExchange,
  type ExerciseRun,
  type LocalizedText,
  type PlatformScenario,
  type ReplayReceipt,
  type RoleSlot,
  type ScenarioVersion,
  type TraceSummary,
} from './platform';
import {
  buildRunDiagnostics,
  type DiagnosticEvaluation,
} from './run-diagnostics';

export type WebDataMode = 'reference' | 'live';

export interface ReadModelGap {
  readonly code:
    | 'SCENARIO_CHECKPOINTS_UNAVAILABLE'
    | 'WATER_TOPOLOGY_UNAVAILABLE'
    | 'AGENT_IDENTITY_DETAIL_UNAVAILABLE'
    | 'SPAN_DETAIL_UNAVAILABLE'
    | 'PARTICIPANT_REPLAY_UNAVAILABLE'
    | 'REPLAY_VERIFICATION_FAILED';
  readonly title: LocalizedText;
  readonly detail: LocalizedText;
}

export interface ScenarioCatalogReadModel {
  readonly scenarios: readonly PlatformScenario[];
  readonly runs: readonly ExerciseRun[];
}

export interface ScenarioWorkspaceReadModel {
  readonly scenario: PlatformScenario;
  readonly runs: readonly ExerciseRun[];
}

export interface RunCatalogReadModel {
  readonly scenarios: readonly PlatformScenario[];
  readonly runs: readonly ExerciseRun[];
}

export interface RunWorkspaceReadModel {
  readonly scenario: PlatformScenario;
  readonly run: ExerciseRun;
  readonly replayByPerspective: Readonly<
    Record<string, readonly ReplayReceipt[]>
  >;
}

export interface RunCollaborationReadModel extends RunWorkspaceReadModel {
  readonly interactions: readonly CollaborationExchange[];
}

export type ReadModelUnavailableReason =
  | 'configuration'
  | 'authentication'
  | 'authorization'
  | 'not_found'
  | 'request'
  | 'contract';

export type ReadModelResult<T> =
  | {
      readonly status: 'ready';
      readonly mode: WebDataMode;
      readonly data: T;
      readonly gaps: readonly ReadModelGap[];
    }
  | {
      readonly status: 'unavailable';
      readonly mode: WebDataMode;
      readonly reason: ReadModelUnavailableReason;
      readonly message: string;
    };

export interface WebReadModelSource {
  readonly mode: WebDataMode;
  readScenarioCatalog(): Promise<ReadModelResult<ScenarioCatalogReadModel>>;
  readScenarioWorkspace(
    scenarioId: string,
  ): Promise<ReadModelResult<ScenarioWorkspaceReadModel>>;
  readRunCatalog(): Promise<ReadModelResult<RunCatalogReadModel>>;
  readRunWorkspace(
    runId: string,
  ): Promise<ReadModelResult<RunWorkspaceReadModel>>;
  readRunCollaboration(
    runId: string,
  ): Promise<ReadModelResult<RunCollaborationReadModel>>;
}

export interface LiveReadModelSourceOptions {
  readonly apiOrigin: string;
  readonly operatorToken: string;
  readonly fetcher?: (
    input: string | URL | Request,
    init?: RequestInit,
  ) => Promise<Response>;
}

interface ApiScenario {
  readonly id: string;
  readonly slug: string;
  readonly title: LocalizedText;
  readonly description: LocalizedText;
  readonly region: LocalizedText;
  readonly simulationOnly: true;
  readonly lifecycle: 'PUBLISHED' | 'RETIRED';
  readonly currentVersionId: string;
  readonly publishedVersionCount: number;
  readonly requiredRoleCount: number;
  readonly minDistinctRequiredAgents: number;
}

interface ApiRole {
  readonly id: string;
  readonly name: LocalizedText;
  readonly mission: LocalizedText;
  readonly expectedArtifact: LocalizedText;
}

interface ApiScenarioVersion {
  readonly id: string;
  readonly scenarioId: string;
  readonly label: string;
  readonly summary: LocalizedText;
  readonly lifecycle: 'PUBLISHED' | 'RETIRED';
  readonly replayStartAt: string;
  readonly requiredRoles: readonly ApiRole[];
  readonly minDistinctRequiredAgents: number;
  readonly contentHash: string;
  readonly publishedAt: string;
}

type ApiRunState =
  | 'CREATED'
  | 'FORMING'
  | 'READY'
  | 'RUNNING'
  | 'PAUSED'
  | 'COMPLETING'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'FAILED';

interface ApiRun {
  readonly id: string;
  readonly scenarioVersionId: string;
  readonly ownerId: string;
  readonly label: LocalizedText;
  readonly mode: 'exercise' | 'rehearsal';
  readonly state: ApiRunState;
  readonly virtualTime: string;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly startedAt?: string;
}

type ApiRunAgentState =
  | 'JOINED'
  | 'READY'
  | 'WORKING'
  | 'WAITING_FEEDBACK'
  | 'DONE'
  | 'DISCONNECTED'
  | 'REMOVED';

interface ApiRunAgent {
  readonly id: string;
  readonly runId: string;
  readonly agentVersionId: string;
  readonly instanceKey: string;
  readonly roleSlotId: string;
  readonly state: ApiRunAgentState;
  readonly version: number;
  readonly joinedAt: string;
}

interface ApiRunEvent {
  readonly eventId: string;
  readonly runId: string;
  readonly runSeq: number;
  readonly streamType: string;
  readonly streamId: string;
  readonly eventType: string;
  readonly actorType: 'operator' | 'run_agent' | 'system';
  readonly actorId: string;
  readonly virtualTime: string;
  readonly occurredAt: string;
  readonly recordedAt: string;
  readonly schemaVersion: 1;
  readonly assertionClass: string;
  readonly eventHash: string;
  readonly traceId?: string;
  readonly spanId?: string;
  readonly payload?: Readonly<Record<string, unknown>>;
}

interface ApiRunEvaluation extends DiagnosticEvaluation {
  readonly runId: string;
  readonly taskId: string;
  readonly runAgentId: string;
}

interface ApiCollaborationArtifactReference {
  readonly artifactId: string;
  readonly artifactVersionId: string;
  readonly contentHash: string;
}

interface ApiCollaborationDelivery {
  readonly recipientRunAgentId: string;
  readonly state: 'pending_sync' | 'issued' | 'acknowledged';
  readonly agentReceiptSeq?: number;
  readonly issuedRunSeq?: number;
  readonly acknowledgedRunSeq?: number;
}

interface ApiRunInteraction {
  readonly id: string;
  readonly runId: string;
  readonly threadId: string;
  readonly kind: 'inform' | 'request' | 'response' | 'handoff';
  readonly replyToMessageId?: string;
  readonly senderType: 'EXCON' | 'RUN_AGENT';
  readonly senderId: string;
  readonly recipientRunAgentIds: readonly string[];
  readonly subject: LocalizedText;
  readonly artifactVersionRefs: readonly ApiCollaborationArtifactReference[];
  readonly createdRunSeq: number;
  readonly createdVirtualAt: string;
  readonly createdAt: string;
  readonly deliveries: readonly ApiCollaborationDelivery[];
  readonly responseMessageIds: readonly string[];
  readonly status: 'open' | 'responded' | 'complete';
}

interface ApiAgentReceipt {
  readonly id: string;
  readonly runId: string;
  readonly runAgentId: string;
  readonly agentReceiptSeq: number;
  readonly sourceRunSeq: number;
  readonly issuedRunSeq: number;
  readonly viewKind:
    | 'task_assignment'
    | 'message'
    | 'artifact_grant'
    | 'feedback'
    | 'submission';
  readonly resourceType:
    'task' | 'message' | 'artifact' | 'feedback' | 'submission';
  readonly resourceId: string;
  readonly resourceVersion: string;
  readonly issuedVirtualAt: string;
  readonly issuedAt: string;
  readonly contentHash: string;
  readonly receiptHash: string;
}

interface ApiTelemetryOverlay {
  readonly bestEffort: true;
  readonly gap: boolean;
  readonly traces: readonly TraceSummary[];
  readonly coverage: {
    readonly boundaryCoverage: number;
    readonly participantTelemetryMode: 'none' | 'partial' | 'instrumented';
    readonly droppedSpanCount: number;
    readonly lateSpanCount: number;
  };
  readonly trust: {
    readonly platformObservedSpanCount: number;
    readonly participantReportedSpanCount: number;
  };
}

interface ApiReplay {
  readonly authoritativeProjection: {
    readonly run: ApiRun;
    readonly runAgents: readonly ApiRunAgent[];
    readonly events: readonly ApiRunEvent[];
    readonly receipts: readonly ApiAgentReceipt[];
    readonly manifest: {
      readonly atRunSeq: number;
      readonly verified: boolean;
    };
  };
  readonly bestEffortTelemetryOverlay: ApiTelemetryOverlay;
}

class ReadModelSourceError extends Error {
  constructor(
    readonly reason: ReadModelUnavailableReason,
    message: string,
  ) {
    super(message);
    this.name = 'ReadModelSourceError';
  }
}

function text(zhCN: string, en: string): LocalizedText {
  return { 'zh-CN': zhCN, en };
}

function ready<T>(
  mode: WebDataMode,
  data: T,
  gaps: readonly ReadModelGap[] = [],
): ReadModelResult<T> {
  return { status: 'ready', mode, data, gaps };
}

function unavailable<T>(
  mode: WebDataMode,
  reason: ReadModelUnavailableReason,
  message: string,
): ReadModelResult<T> {
  return { status: 'unavailable', mode, reason, message };
}

function referenceMissing<T>(resource: string): ReadModelResult<T> {
  return unavailable(
    'reference',
    'not_found',
    `${resource} is not part of the committed reference projection.`,
  );
}

export function createReferenceReadModelSource(): WebReadModelSource {
  return {
    mode: 'reference',
    readScenarioCatalog() {
      return Promise.resolve(
        ready('reference', { scenarios, runs: exerciseRuns }),
      );
    },
    readScenarioWorkspace(scenarioId) {
      const scenario = getScenarioById(scenarioId);
      if (scenario === undefined) {
        return Promise.resolve(referenceMissing(scenarioId));
      }
      return Promise.resolve(
        ready('reference', {
          scenario,
          runs: exerciseRuns.filter((run) => run.scenarioId === scenarioId),
        }),
      );
    },
    readRunCatalog() {
      return Promise.resolve(
        ready('reference', { scenarios, runs: exerciseRuns }),
      );
    },
    readRunWorkspace(runId) {
      const run = getRunById(runId);
      if (run === undefined) return Promise.resolve(referenceMissing(runId));
      const scenario = getScenarioById(run.scenarioId);
      if (scenario === undefined) {
        return Promise.resolve(referenceMissing(run.scenarioId));
      }
      const replayByPerspective: Record<string, readonly ReplayReceipt[]> = {
        operator: getReplayEventsForPerspective(run.id, 'operator'),
      };
      for (const participant of run.participants) {
        replayByPerspective[participant.id] = getReplayEventsForPerspective(
          run.id,
          participant.id,
        );
      }
      return Promise.resolve(
        ready('reference', { scenario, run, replayByPerspective }),
      );
    },
    readRunCollaboration(runId) {
      const run = getRunById(runId);
      if (run === undefined) return Promise.resolve(referenceMissing(runId));
      const scenario = getScenarioById(run.scenarioId);
      if (scenario === undefined) {
        return Promise.resolve(referenceMissing(run.scenarioId));
      }
      const replayByPerspective: Record<string, readonly ReplayReceipt[]> = {
        operator: getReplayEventsForPerspective(run.id, 'operator'),
      };
      for (const participant of run.participants) {
        replayByPerspective[participant.id] = getReplayEventsForPerspective(
          run.id,
          participant.id,
        );
      }
      return Promise.resolve(
        ready('reference', {
          scenario,
          run,
          interactions: getReferenceInteractions(run.id),
          replayByPerspective,
        }),
      );
    },
  };
}

export function createUnavailableReadModelSource(
  mode: WebDataMode,
  message: string,
): WebReadModelSource {
  const result = <T>(): Promise<ReadModelResult<T>> =>
    Promise.resolve(unavailable(mode, 'configuration', message));
  return {
    mode,
    readScenarioCatalog: result,
    readScenarioWorkspace: result,
    readRunCatalog: result,
    readRunWorkspace: result,
    readRunCollaboration: result,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0;
}

function isLocalizedText(value: unknown): value is LocalizedText {
  return isRecord(value) && isString(value['zh-CN']) && isString(value.en);
}

function hasStringFields(
  value: Record<string, unknown>,
  fields: readonly string[],
): boolean {
  return fields.every((field) => isString(value[field]));
}

function isApiScenario(value: unknown): value is ApiScenario {
  if (!isRecord(value)) return false;
  return (
    hasStringFields(value, ['id', 'slug', 'currentVersionId']) &&
    isLocalizedText(value.title) &&
    isLocalizedText(value.description) &&
    isLocalizedText(value.region) &&
    value.simulationOnly === true &&
    (value.lifecycle === 'PUBLISHED' || value.lifecycle === 'RETIRED') &&
    isNonNegativeInteger(value.publishedVersionCount) &&
    isNonNegativeInteger(value.requiredRoleCount) &&
    isNonNegativeInteger(value.minDistinctRequiredAgents)
  );
}

function isApiRole(value: unknown): value is ApiRole {
  return (
    isRecord(value) &&
    isString(value.id) &&
    isLocalizedText(value.name) &&
    isLocalizedText(value.mission) &&
    isLocalizedText(value.expectedArtifact)
  );
}

function isApiScenarioVersion(value: unknown): value is ApiScenarioVersion {
  if (!isRecord(value)) return false;
  return (
    hasStringFields(value, [
      'id',
      'scenarioId',
      'label',
      'replayStartAt',
      'contentHash',
      'publishedAt',
    ]) &&
    isLocalizedText(value.summary) &&
    (value.lifecycle === 'PUBLISHED' || value.lifecycle === 'RETIRED') &&
    Array.isArray(value.requiredRoles) &&
    value.requiredRoles.every(isApiRole) &&
    isNonNegativeInteger(value.minDistinctRequiredAgents)
  );
}

const apiRunStates = new Set<ApiRunState>([
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

function isApiRunState(value: unknown): value is ApiRunState {
  return typeof value === 'string' && apiRunStates.has(value as ApiRunState);
}

function isApiRun(value: unknown): value is ApiRun {
  if (!isRecord(value)) return false;
  return (
    hasStringFields(value, [
      'id',
      'scenarioVersionId',
      'ownerId',
      'virtualTime',
      'createdAt',
      'updatedAt',
    ]) &&
    isLocalizedText(value.label) &&
    (value.mode === 'exercise' || value.mode === 'rehearsal') &&
    isApiRunState(value.state) &&
    Number.isInteger(value.version) &&
    (value.startedAt === undefined || isString(value.startedAt))
  );
}

const apiRunAgentStates = new Set<ApiRunAgentState>([
  'JOINED',
  'READY',
  'WORKING',
  'WAITING_FEEDBACK',
  'DONE',
  'DISCONNECTED',
  'REMOVED',
]);

function isApiRunAgentState(value: unknown): value is ApiRunAgentState {
  return (
    typeof value === 'string' &&
    apiRunAgentStates.has(value as ApiRunAgentState)
  );
}

function isApiRunAgent(value: unknown): value is ApiRunAgent {
  if (!isRecord(value)) return false;
  return (
    hasStringFields(value, [
      'id',
      'runId',
      'agentVersionId',
      'instanceKey',
      'roleSlotId',
      'joinedAt',
    ]) &&
    isApiRunAgentState(value.state) &&
    Number.isInteger(value.version)
  );
}

function isApiRunEvent(value: unknown): value is ApiRunEvent {
  if (!isRecord(value)) return false;
  return (
    hasStringFields(value, [
      'eventId',
      'runId',
      'streamType',
      'streamId',
      'eventType',
      'actorId',
      'virtualTime',
      'occurredAt',
      'recordedAt',
      'assertionClass',
      'eventHash',
    ]) &&
    Number.isInteger(value.runSeq) &&
    Number(value.runSeq) > 0 &&
    (value.actorType === 'operator' ||
      value.actorType === 'run_agent' ||
      value.actorType === 'system') &&
    value.schemaVersion === 1 &&
    (value.payload === undefined || isRecord(value.payload)) &&
    (value.traceId === undefined || isString(value.traceId)) &&
    (value.spanId === undefined || isString(value.spanId))
  );
}

function isApiRunEvaluation(value: unknown): value is ApiRunEvaluation {
  if (!isRecord(value)) return false;
  return (
    hasStringFields(value, [
      'id',
      'runId',
      'submissionId',
      'taskId',
      'runAgentId',
      'roleSlotId',
      'evaluatorVersion',
      'createdAt',
    ]) &&
    (value.targetScope === 'individual' ||
      value.targetScope === 'role' ||
      value.targetScope === 'team') &&
    (value.verdict === 'ACCEPTED' || value.verdict === 'REWORK_REQUIRED') &&
    Array.isArray(value.issueCodes) &&
    value.issueCodes.every(isString) &&
    value.deterministic === true &&
    Number.isInteger(value.createdRunSeq) &&
    Number(value.createdRunSeq) > 0
  );
}

function isApiCollaborationArtifactReference(
  value: unknown,
): value is ApiCollaborationArtifactReference {
  return (
    isRecord(value) &&
    hasStringFields(value, ['artifactId', 'artifactVersionId', 'contentHash'])
  );
}

function optionalPositiveInteger(value: unknown): boolean {
  return value === undefined || (Number.isInteger(value) && Number(value) > 0);
}

function isApiCollaborationDelivery(
  value: unknown,
): value is ApiCollaborationDelivery {
  return (
    isRecord(value) &&
    isString(value.recipientRunAgentId) &&
    (value.state === 'pending_sync' ||
      value.state === 'issued' ||
      value.state === 'acknowledged') &&
    optionalPositiveInteger(value.agentReceiptSeq) &&
    optionalPositiveInteger(value.issuedRunSeq) &&
    optionalPositiveInteger(value.acknowledgedRunSeq)
  );
}

function isApiRunInteraction(value: unknown): value is ApiRunInteraction {
  return (
    isRecord(value) &&
    hasStringFields(value, [
      'id',
      'runId',
      'threadId',
      'senderId',
      'createdVirtualAt',
      'createdAt',
    ]) &&
    (value.kind === 'inform' ||
      value.kind === 'request' ||
      value.kind === 'response' ||
      value.kind === 'handoff') &&
    (value.replyToMessageId === undefined ||
      isString(value.replyToMessageId)) &&
    (value.senderType === 'EXCON' || value.senderType === 'RUN_AGENT') &&
    Array.isArray(value.recipientRunAgentIds) &&
    value.recipientRunAgentIds.length > 0 &&
    value.recipientRunAgentIds.every(isString) &&
    isLocalizedText(value.subject) &&
    Array.isArray(value.artifactVersionRefs) &&
    value.artifactVersionRefs.every(isApiCollaborationArtifactReference) &&
    Number.isInteger(value.createdRunSeq) &&
    Number(value.createdRunSeq) > 0 &&
    Array.isArray(value.deliveries) &&
    value.deliveries.length > 0 &&
    value.deliveries.every(isApiCollaborationDelivery) &&
    Array.isArray(value.responseMessageIds) &&
    value.responseMessageIds.every(isString) &&
    (value.status === 'open' ||
      value.status === 'responded' ||
      value.status === 'complete')
  );
}

function isApiAgentReceipt(value: unknown): value is ApiAgentReceipt {
  if (!isRecord(value)) return false;
  return (
    hasStringFields(value, [
      'id',
      'runId',
      'runAgentId',
      'resourceId',
      'resourceVersion',
      'issuedVirtualAt',
      'issuedAt',
      'contentHash',
      'receiptHash',
    ]) &&
    Number.isInteger(value.agentReceiptSeq) &&
    Number(value.agentReceiptSeq) > 0 &&
    Number.isInteger(value.sourceRunSeq) &&
    Number(value.sourceRunSeq) > 0 &&
    Number.isInteger(value.issuedRunSeq) &&
    Number(value.issuedRunSeq) > 0 &&
    (value.viewKind === 'task_assignment' ||
      value.viewKind === 'message' ||
      value.viewKind === 'artifact_grant' ||
      value.viewKind === 'feedback' ||
      value.viewKind === 'submission') &&
    (value.resourceType === 'task' ||
      value.resourceType === 'message' ||
      value.resourceType === 'artifact' ||
      value.resourceType === 'feedback' ||
      value.resourceType === 'submission')
  );
}

function isTraceSummary(value: unknown): value is TraceSummary {
  if (!isRecord(value)) return false;
  return (
    hasStringFields(value, ['traceId', 'runId', 'name', 'startedAt']) &&
    (value.runAgentId === undefined || isString(value.runAgentId)) &&
    isFiniteNumber(value.durationMs) &&
    Number(value.durationMs) >= 0 &&
    (value.status === 'UNSET' ||
      value.status === 'OK' ||
      value.status === 'ERROR') &&
    (value.source === 'excon_service' ||
      value.source === 'participant_exporter') &&
    (value.trust === 'platform_observed' ||
      value.trust === 'participant_reported') &&
    isNonNegativeInteger(value.spanCount)
  );
}

function isApiTelemetryOverlay(value: unknown): value is ApiTelemetryOverlay {
  if (!isRecord(value) || !isRecord(value.coverage) || !isRecord(value.trust)) {
    return false;
  }
  return (
    value.bestEffort === true &&
    typeof value.gap === 'boolean' &&
    Array.isArray(value.traces) &&
    value.traces.every(isTraceSummary) &&
    isFiniteNumber(value.coverage.boundaryCoverage) &&
    Number(value.coverage.boundaryCoverage) >= 0 &&
    Number(value.coverage.boundaryCoverage) <= 1 &&
    (value.coverage.participantTelemetryMode === 'none' ||
      value.coverage.participantTelemetryMode === 'partial' ||
      value.coverage.participantTelemetryMode === 'instrumented') &&
    isNonNegativeInteger(value.coverage.droppedSpanCount) &&
    isNonNegativeInteger(value.coverage.lateSpanCount) &&
    isNonNegativeInteger(value.trust.platformObservedSpanCount) &&
    isNonNegativeInteger(value.trust.participantReportedSpanCount)
  );
}

function isApiReplay(value: unknown): value is ApiReplay {
  if (!isRecord(value)) return false;
  const projection = value.authoritativeProjection;
  if (!isRecord(projection)) return false;
  const manifest = projection.manifest;
  if (!isRecord(manifest)) return false;
  return (
    isApiRun(projection.run) &&
    Array.isArray(projection.runAgents) &&
    projection.runAgents.every(isApiRunAgent) &&
    Array.isArray(projection.events) &&
    projection.events.every(isApiRunEvent) &&
    Array.isArray(projection.receipts) &&
    projection.receipts.every(isApiAgentReceipt) &&
    isNonNegativeInteger(manifest.atRunSeq) &&
    typeof manifest.verified === 'boolean' &&
    isApiTelemetryOverlay(value.bestEffortTelemetryOverlay)
  );
}

function isItems<T>(
  value: unknown,
  guard: (item: unknown) => item is T,
): value is { readonly items: readonly T[] } {
  return (
    isRecord(value) && Array.isArray(value.items) && value.items.every(guard)
  );
}

function isScenarioDetail(value: unknown): value is {
  readonly scenario: ApiScenario;
  readonly currentVersion: ApiScenarioVersion;
} {
  return (
    isRecord(value) &&
    isApiScenario(value.scenario) &&
    isApiScenarioVersion(value.currentVersion)
  );
}

function scenarioVersionToReadModel(
  version: ApiScenarioVersion,
): ScenarioVersion {
  return {
    id: version.id,
    label: version.label,
    status: version.lifecycle === 'PUBLISHED' ? 'published' : 'retired',
    publishedAt: version.publishedAt,
    contentHash: version.contentHash,
    summary: version.summary,
  };
}

const roleAccents = ['river', 'cyan', 'reed', 'amber'] as const;

function roleToReadModel(role: ApiRole, index: number): RoleSlot {
  return {
    id: role.id,
    name: role.name,
    mission: role.mission,
    expectedArtifact: role.expectedArtifact,
    accent: roleAccents[index % roleAccents.length] ?? 'river',
  };
}

function scenarioToReadModel(
  scenario: ApiScenario,
  versions: readonly ApiScenarioVersion[],
): PlatformScenario {
  const current =
    versions.find((version) => version.id === scenario.currentVersionId) ??
    versions[0];
  return {
    id: scenario.id,
    shortName: scenario.title,
    title: scenario.title,
    description: scenario.description,
    region: scenario.region,
    simulationOnly: true,
    currentVersionId: scenario.currentVersionId,
    versions: versions.map(scenarioVersionToReadModel),
    requiredRoles:
      current?.requiredRoles.map(roleToReadModel) ??
      ([] as readonly RoleSlot[]),
    checkpoints: [],
    topology: [],
  };
}

function runStateToReadModel(state: ApiRunState): ExerciseRun['state'] {
  return state.toLowerCase() as ExerciseRun['state'];
}

function agentStateToReadModel(state: ApiRunAgentState): AgentSession['state'] {
  const mapped: Record<ApiRunAgentState, AgentSession['state']> = {
    DISCONNECTED: 'disconnected',
    DONE: 'done',
    JOINED: 'joined',
    READY: 'ready',
    REMOVED: 'removed',
    WAITING_FEEDBACK: 'waiting-feedback',
    WORKING: 'working',
  };
  return mapped[state];
}

function runAgentToReadModel(
  agent: ApiRunAgent,
  scenario: PlatformScenario,
): AgentSession {
  const role = scenario.requiredRoles.find(({ id }) => id === agent.roleSlotId);
  const displayName =
    role === undefined
      ? text(agent.instanceKey, agent.instanceKey)
      : text(
          `${role.name['zh-CN']} · ${agent.instanceKey}`,
          `${role.name.en} · ${agent.instanceKey}`,
        );
  return {
    id: agent.id,
    roleId: agent.roleSlotId,
    displayName,
    instanceKey: agent.instanceKey,
    agentVersionId: agent.agentVersionId,
    state: agentStateToReadModel(agent.state),
    lastActivity: agent.joinedAt,
  };
}

function eventCategory(event: ApiRunEvent): ReplayReceipt['category'] {
  if (
    event.streamType === 'receipt' &&
    event.eventType === 'receipt.acknowledged'
  ) {
    return 'acknowledgement';
  }
  const categories: Record<string, ReplayReceipt['category']> = {
    artifact: 'artifact',
    endorsement: 'endorsement',
    feedback: 'feedback',
    message: 'message',
    receipt: 'receipt',
    run: 'run',
    submission: 'submission',
  };
  return categories[event.streamType] ?? 'run';
}

const eventTypeLabels: Readonly<Record<string, LocalizedText>> = {
  'agent.joined': text('智能体加入运行', 'Agent joined run'),
  'artifact.published': text('工件首版已发布', 'Artifact published'),
  'artifact.version-published': text(
    '工件新版本已发布',
    'Artifact version published',
  ),
  'barrier.created': text('阶段闸门已创建', 'Stage gate created'),
  'barrier.released': text('阶段闸门已放行', 'Stage gate released'),
  'barrier.satisfied': text('阶段闸门条件已满足', 'Stage gate satisfied'),
  'evaluation.completed': text('确定性评测已完成', 'Evaluation completed'),
  'feedback.created': text('定向反馈已发放', 'Feedback created'),
  'message.created': text('协作消息已发送', 'Collaboration message sent'),
  'receipt.acknowledged': text(
    '可见性收据已确认',
    'Visibility receipt acknowledged',
  ),
  'receipt.issued': text('可见性收据已签发', 'Visibility receipt issued'),
  'role.assigned': text('运行角色已分配', 'Run role assigned'),
  'run.created': text('演练运行已创建', 'Exercise run created'),
  'run.started': text('演练运行已启动', 'Exercise run started'),
  'submission.created': text('提交已创建', 'Submission created'),
  'submission.endorsed': text('提交已背书', 'Submission endorsed'),
  'task.accepted': text('任务已通过', 'Task accepted'),
  'task.blocked': text('任务等待阶段闸门', 'Task blocked by stage gate'),
  'task.claimed': text('任务已领取', 'Task claimed'),
  'task.lease-renewed': text('任务租约已续期', 'Task lease renewed'),
  'task.ready': text('任务已就绪', 'Task ready'),
  'task.rework-required': text('任务需要返工', 'Task requires rework'),
  'task.started': text('任务已开始', 'Task started'),
  'task.submitted': text('任务结果已提交', 'Task result submitted'),
};

const streamTypeLabels: Readonly<Record<string, LocalizedText>> = {
  artifact: text('工件', 'Artifact'),
  barrier: text('阶段闸门', 'Stage gate'),
  endorsement: text('背书', 'Endorsement'),
  evaluation: text('评测', 'Evaluation'),
  feedback: text('反馈', 'Feedback'),
  message: text('消息', 'Message'),
  receipt: text('可见性收据', 'Visibility receipt'),
  run: text('运行', 'Run'),
  run_agent: text('运行智能体', 'Run agent'),
  submission: text('提交', 'Submission'),
  task: text('任务', 'Task'),
};

const assertionClassLabels: Readonly<Record<string, LocalizedText>> = {
  evaluator_derived: text('评测器推导', 'Evaluator-derived'),
  external_outcome: text('外部结果', 'External outcome'),
  operator_asserted: text('导调员确认', 'Exercise-controller asserted'),
  participant_reported: text('参与者上报', 'Participant-reported'),
  platform_observed: text('平台观测', 'Platform-observed'),
};

function localizedLabel(
  labels: Readonly<Record<string, LocalizedText>>,
  value: string,
  fallback: LocalizedText,
): LocalizedText {
  return labels[value] ?? fallback;
}

function eventToReceipt(event: ApiRunEvent): ReplayReceipt {
  const eventTitle = localizedLabel(
    eventTypeLabels,
    event.eventType,
    text('领域事件', event.eventType),
  );
  const stream = localizedLabel(
    streamTypeLabels,
    event.streamType,
    text('运行记录', event.streamType),
  );
  const assertion = localizedLabel(
    assertionClassLabels,
    event.assertionClass,
    text('来源未分类', event.assertionClass),
  );
  return {
    id: event.eventId,
    sequence: event.runSeq,
    category: eventCategory(event),
    wallTime: event.recordedAt,
    virtualTime: event.virtualTime,
    title: eventTitle,
    detail: text(
      `${stream['zh-CN']} · ${assertion['zh-CN']}`,
      `${stream.en} · ${assertion.en}`,
    ),
    actorId: event.actorId,
    visibility: 'operator',
    visibleTo: ['operator'],
    traceId: event.traceId,
    spanId: event.spanId,
    digest: event.eventHash,
  };
}

function agentReceiptToReplay(receipt: ApiAgentReceipt): ReplayReceipt {
  const viewKind = localizedLabel(
    {
      artifact_grant: text('工件授权', 'Artifact grant'),
      feedback: text('反馈', 'Feedback'),
      message: text('消息', 'Message'),
      submission: text('提交', 'Submission'),
      task_assignment: text('任务分配', 'Task assignment'),
    },
    receipt.viewKind,
    text('可见内容', receipt.viewKind),
  );
  const resourceType = localizedLabel(
    streamTypeLabels,
    receipt.resourceType,
    text('运行资源', receipt.resourceType),
  );
  return {
    id: receipt.id,
    sequence: receipt.issuedRunSeq,
    category: 'receipt',
    wallTime: receipt.issuedAt,
    virtualTime: receipt.issuedVirtualAt,
    title: text(
      `可见性收据 · ${viewKind['zh-CN']}`,
      `Visibility receipt · ${viewKind.en}`,
    ),
    detail: text(
      `${resourceType['zh-CN']} · 智能体收据 #${receipt.agentReceiptSeq}`,
      `${resourceType.en} · Agent receipt #${receipt.agentReceiptSeq}`,
    ),
    actorId: receipt.runAgentId,
    visibility: 'agent',
    visibleTo: [receipt.runAgentId],
    digest: receipt.receiptHash,
  };
}

function emptyTelemetry(): ApiTelemetryOverlay {
  return {
    bestEffort: true,
    gap: true,
    traces: [],
    coverage: {
      boundaryCoverage: 0,
      participantTelemetryMode: 'none',
      droppedSpanCount: 0,
      lateSpanCount: 0,
    },
    trust: {
      platformObservedSpanCount: 0,
      participantReportedSpanCount: 0,
    },
  };
}

function runToReadModel(
  run: ApiRun,
  scenario: PlatformScenario,
  agents: readonly ApiRunAgent[] = [],
  telemetry: ApiTelemetryOverlay = emptyTelemetry(),
  replayEvents: readonly ApiRunEvent[] = [],
  replayReceipts: readonly ApiAgentReceipt[] = [],
  evaluations: readonly ApiRunEvaluation[] = [],
): ExerciseRun {
  const replay = [
    ...replayEvents.map(eventToReceipt),
    ...replayReceipts.map(agentReceiptToReplay),
  ].sort(
    (left, right) =>
      left.sequence - right.sequence ||
      Number(left.category === 'receipt') -
        Number(right.category === 'receipt'),
  );
  return {
    id: run.id,
    name: run.label,
    scenarioId: scenario.id,
    scenarioVersionId: run.scenarioVersionId,
    state: runStateToReadModel(run.state),
    currentVirtualTime: run.virtualTime,
    wallStartedAt: run.startedAt ?? run.createdAt,
    boundaryCoverage: telemetry.coverage.boundaryCoverage,
    participantTelemetry: {
      mode: telemetry.coverage.participantTelemetryMode,
      platformObservedSpanCount: telemetry.trust.platformObservedSpanCount,
      participantReportedSpanCount:
        telemetry.trust.participantReportedSpanCount,
      droppedSpanCount: telemetry.coverage.droppedSpanCount,
      lateSpanCount: telemetry.coverage.lateSpanCount,
    },
    participants: agents.map((agent) => runAgentToReadModel(agent, scenario)),
    spans: [],
    traceSummaries: telemetry.traces,
    replayReceipts: replay,
    diagnostics: buildRunDiagnostics({
      requiredRoleIds: scenario.requiredRoles.map(({ id }) => id),
      evaluations,
      releasedBarrierKeys: replayEvents
        .filter(({ eventType }) => eventType === 'barrier.released')
        .map(({ payload }) => payload?.['definitionKey'])
        .filter((key): key is string => typeof key === 'string'),
      telemetry: {
        boundaryCoverage: telemetry.coverage.boundaryCoverage,
        participantMode: telemetry.coverage.participantTelemetryMode,
        platformSpanCount: telemetry.trust.platformObservedSpanCount,
        participantSpanCount: telemetry.trust.participantReportedSpanCount,
        traceSummaryCount: telemetry.traces.length,
        spanDetailCount: 0,
        droppedSpanCount: telemetry.coverage.droppedSpanCount,
        lateSpanCount: telemetry.coverage.lateSpanCount,
        logRecordCount: 0,
        metricSeriesCount: 0,
      },
    }),
  };
}

const liveScenarioGaps: readonly ReadModelGap[] = [
  {
    code: 'SCENARIO_CHECKPOINTS_UNAVAILABLE',
    title: text(
      '部分检查点信息暂不可用',
      'Some checkpoint details are unavailable',
    ),
    detail: text(
      '当前页面会在检查点信息可用后自动补充。',
      'Checkpoint details will appear when they become available.',
    ),
  },
  {
    code: 'WATER_TOPOLOGY_UNAVAILABLE',
    title: text(
      '水系关系图暂不可用',
      'The water-system relationship map is unavailable',
    ),
    detail: text(
      '目前仍可查看区域、版本和角色要求。',
      'Region, version, and role requirements remain available.',
    ),
  },
];

const liveRunGaps: readonly ReadModelGap[] = [
  ...liveScenarioGaps,
  {
    code: 'AGENT_IDENTITY_DETAIL_UNAVAILABLE',
    title: text('部分智能体详情暂不可用', 'Some agent details are unavailable'),
    detail: text(
      '目前仍可查看参演智能体、角色和版本。',
      'Participating agents, roles, and versions remain available.',
    ),
  },
  {
    code: 'SPAN_DETAIL_UNAVAILABLE',
    title: text(
      '当前仅提供追踪摘要',
      'Trace summaries are currently available',
    ),
    detail: text(
      '获得执行明细后，页面会显示完整调用链。',
      'The full call chain will appear when execution details are available.',
    ),
  },
  {
    code: 'PARTICIPANT_REPLAY_UNAVAILABLE',
    title: text(
      '当前仅提供导调员回放视角',
      'Only the exercise-controller replay view is available',
    ),
    detail: text(
      '其他角色视角会在获得相应权限后显示。',
      'Other role perspectives appear when the required access is available.',
    ),
  },
];

class LiveReadModelSource implements WebReadModelSource {
  readonly mode = 'live' as const;
  private readonly origin?: string;
  private readonly configurationError?: string;
  private readonly fetcher: NonNullable<LiveReadModelSourceOptions['fetcher']>;

  constructor(private readonly options: LiveReadModelSourceOptions) {
    this.fetcher = options.fetcher ?? globalThis.fetch;
    try {
      const parsed = new URL(options.apiOrigin);
      if (
        (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
        parsed.username.length > 0 ||
        parsed.password.length > 0
      ) {
        throw new Error('origin must be an HTTP(S) URL without credentials');
      }
      this.origin = parsed.origin;
    } catch {
      this.configurationError =
        'AGENT_EXCON_API_INTERNAL_URL must be a valid HTTP(S) origin.';
    }
    if (options.operatorToken.trim().length === 0) {
      this.configurationError =
        'WISER_WEB_OPERATOR_TOKEN is required when Web data mode is live.';
    }
  }

  async readScenarioCatalog(): Promise<
    ReadModelResult<ScenarioCatalogReadModel>
  > {
    return this.capture(async () => {
      const [apiScenarios, apiRuns] = await Promise.all([
        this.scenarioSummaries(),
        this.runs(),
      ]);
      const mappedScenarios = await Promise.all(
        apiScenarios.map((item) => this.scenario(item.id)),
      );
      const mappedRuns = apiRuns.flatMap((apiRun) => {
        const scenario = mappedScenarios.find((candidate) =>
          candidate.versions.some(
            (version) => version.id === apiRun.scenarioVersionId,
          ),
        );
        return scenario === undefined ? [] : [runToReadModel(apiRun, scenario)];
      });
      return ready(
        'live',
        { scenarios: mappedScenarios, runs: mappedRuns },
        liveScenarioGaps,
      );
    });
  }

  async readScenarioWorkspace(
    scenarioId: string,
  ): Promise<ReadModelResult<ScenarioWorkspaceReadModel>> {
    return this.capture(async () => {
      const [scenario, apiRuns] = await Promise.all([
        this.scenario(scenarioId),
        this.runs(),
      ]);
      return ready(
        'live',
        {
          scenario,
          runs: apiRuns
            .filter((run) =>
              scenario.versions.some(
                (version) => version.id === run.scenarioVersionId,
              ),
            )
            .map((run) => runToReadModel(run, scenario)),
        },
        liveScenarioGaps,
      );
    });
  }

  async readRunCatalog(): Promise<ReadModelResult<RunCatalogReadModel>> {
    return this.capture(async () => {
      const [apiScenarios, apiRuns] = await Promise.all([
        this.scenarioSummaries(),
        this.runs(),
      ]);
      const mappedScenarios = await Promise.all(
        apiScenarios.map((item) => this.scenario(item.id)),
      );
      const mappedRuns = await Promise.all(
        apiRuns.map(async (apiRun) => {
          const scenario = mappedScenarios.find((candidate) =>
            candidate.versions.some(
              (version) => version.id === apiRun.scenarioVersionId,
            ),
          );
          if (scenario === undefined) {
            throw new ReadModelSourceError(
              'contract',
              `Run ${apiRun.id} references a scenario version missing from /api/v2/scenarios.`,
            );
          }
          const [agents, telemetry] = await Promise.all([
            this.runAgents(apiRun.id),
            this.telemetry(apiRun.id),
          ]);
          return runToReadModel(apiRun, scenario, agents, telemetry);
        }),
      );
      return ready(
        'live',
        { scenarios: mappedScenarios, runs: mappedRuns },
        liveRunGaps,
      );
    });
  }

  async readRunWorkspace(
    runId: string,
  ): Promise<ReadModelResult<RunWorkspaceReadModel>> {
    return this.capture(async () => {
      const [apiScenarios, apiRuns] = await Promise.all([
        this.scenarioSummaries(),
        this.runs(),
      ]);
      const apiRun = apiRuns.find((candidate) => candidate.id === runId);
      if (apiRun === undefined) {
        throw new ReadModelSourceError(
          'not_found',
          `Run ${runId} was not returned by /api/v2/runs.`,
        );
      }
      const mappedScenarios = await Promise.all(
        apiScenarios.map((item) => this.scenario(item.id)),
      );
      const scenario = mappedScenarios.find((candidate) =>
        candidate.versions.some(
          (version) => version.id === apiRun.scenarioVersionId,
        ),
      );
      if (scenario === undefined) {
        throw new ReadModelSourceError(
          'contract',
          `Run ${runId} references a scenario version missing from /api/v2/scenarios.`,
        );
      }
      const [agents, replay, telemetry, evaluations] = await Promise.all([
        this.runAgents(runId),
        this.replay(runId),
        this.telemetry(runId),
        this.evaluations(runId),
      ]);
      if (replay.authoritativeProjection.run.id !== apiRun.id) {
        throw new ReadModelSourceError(
          'contract',
          `/api/v2/runs/${runId}/replay returned a different Run.`,
        );
      }
      if (
        agents.some((agent) => agent.runId !== runId) ||
        telemetry.traces.some((trace) => trace.runId !== runId) ||
        replay.authoritativeProjection.run.scenarioVersionId !==
          apiRun.scenarioVersionId ||
        replay.authoritativeProjection.runAgents.some(
          (agent) => agent.runId !== runId,
        ) ||
        replay.authoritativeProjection.events.some(
          (event) => event.runId !== runId,
        ) ||
        replay.authoritativeProjection.receipts.some(
          (receipt) => receipt.runId !== runId,
        ) ||
        replay.bestEffortTelemetryOverlay.traces.some(
          (trace) => trace.runId !== runId,
        ) ||
        evaluations.some((evaluation) => evaluation.runId !== runId)
      ) {
        throw new ReadModelSourceError(
          'contract',
          `A Run, RunAgent, Event, Receipt, or Trace returned for ${runId} references a different Run or ScenarioVersion.`,
        );
      }
      const run = runToReadModel(
        apiRun,
        scenario,
        agents,
        telemetry,
        replay.authoritativeProjection.events,
        replay.authoritativeProjection.receipts,
        evaluations,
      );
      const gaps = replay.authoritativeProjection.manifest.verified
        ? liveRunGaps
        : [
            ...liveRunGaps,
            {
              code: 'REPLAY_VERIFICATION_FAILED' as const,
              title: text(
                '事件链验证未通过',
                'Event-chain verification failed',
              ),
              detail: text(
                '停止把当前回放作为已验证审计依据，并检查 API 事件链。',
                'Do not treat this replay as verified audit evidence; inspect the API event chain.',
              ),
            },
          ];
      return ready(
        'live',
        {
          scenario,
          run,
          replayByPerspective: { operator: run.replayReceipts },
        },
        gaps,
      );
    });
  }

  async readRunCollaboration(
    runId: string,
  ): Promise<ReadModelResult<RunCollaborationReadModel>> {
    const workspace = await this.readRunWorkspace(runId);
    if (workspace.status === 'unavailable') return workspace;
    return this.capture(async () => {
      const interactions = await this.interactions(runId);
      if (interactions.some((interaction) => interaction.runId !== runId)) {
        throw new ReadModelSourceError(
          'contract',
          `An interaction returned for ${runId} references a different Run.`,
        );
      }
      return ready('live', { ...workspace.data, interactions }, workspace.gaps);
    });
  }

  private async capture<T>(
    operation: () => Promise<ReadModelResult<T>>,
  ): Promise<ReadModelResult<T>> {
    if (this.configurationError !== undefined) {
      return unavailable('live', 'configuration', this.configurationError);
    }
    try {
      return await operation();
    } catch (error) {
      if (error instanceof ReadModelSourceError) {
        return unavailable('live', error.reason, error.message);
      }
      return unavailable(
        'live',
        'request',
        'The v2 API request failed before a safe read model could be built.',
      );
    }
  }

  private async request(
    path: string,
    protectedRead: boolean,
  ): Promise<unknown> {
    if (this.origin === undefined) {
      throw new ReadModelSourceError(
        'configuration',
        'AGENT_EXCON_API_INTERNAL_URL is unavailable.',
      );
    }
    let response: Response;
    try {
      response = await this.fetcher(`${this.origin}${path}`, {
        cache: 'no-store',
        headers: protectedRead
          ? { authorization: `Bearer ${this.options.operatorToken}` }
          : undefined,
        method: 'GET',
      });
    } catch {
      throw new ReadModelSourceError(
        'request',
        `${path} could not be reached. Check AGENT_EXCON_API_INTERNAL_URL and API health.`,
      );
    }
    if (!response.ok) {
      const reason: ReadModelUnavailableReason =
        response.status === 401
          ? 'authentication'
          : response.status === 403
            ? 'authorization'
            : response.status === 404
              ? 'not_found'
              : 'request';
      throw new ReadModelSourceError(
        reason,
        `${path} returned HTTP ${response.status}. Check the server-only operator credential and API readiness.`,
      );
    }
    try {
      return await response.json();
    } catch {
      throw new ReadModelSourceError(
        'contract',
        `${path} returned a non-JSON response instead of the v2 contract.`,
      );
    }
  }

  private async scenarioSummaries(): Promise<readonly ApiScenario[]> {
    const path = '/api/v2/scenarios';
    const value = await this.request(path, false);
    if (!isItems(value, isApiScenario)) {
      throw new ReadModelSourceError(
        'contract',
        `${path} did not match the expected v2 scenario-list contract.`,
      );
    }
    return value.items;
  }

  private async scenario(scenarioId: string): Promise<PlatformScenario> {
    const detailPath = `/api/v2/scenarios/${encodeURIComponent(scenarioId)}`;
    const versionsPath = `${detailPath}/versions`;
    const [detailValue, versionsValue] = await Promise.all([
      this.request(detailPath, false),
      this.request(versionsPath, false),
    ]);
    if (!isScenarioDetail(detailValue)) {
      throw new ReadModelSourceError(
        'contract',
        `${detailPath} did not match the expected v2 scenario-detail contract.`,
      );
    }
    if (!isItems(versionsValue, isApiScenarioVersion)) {
      throw new ReadModelSourceError(
        'contract',
        `${versionsPath} did not match the expected v2 scenario-version contract.`,
      );
    }
    if (
      detailValue.scenario.id !== scenarioId ||
      detailValue.scenario.currentVersionId !== detailValue.currentVersion.id ||
      detailValue.currentVersion.scenarioId !== scenarioId ||
      versionsValue.items.some(
        (version) => version.scenarioId !== scenarioId,
      ) ||
      (versionsValue.items.length > 0 &&
        !versionsValue.items.some(
          (version) => version.id === detailValue.scenario.currentVersionId,
        ))
    ) {
      throw new ReadModelSourceError(
        'contract',
        `${detailPath} returned a cross-scenario version reference.`,
      );
    }
    const versions = versionsValue.items.length
      ? versionsValue.items
      : [detailValue.currentVersion];
    return scenarioToReadModel(detailValue.scenario, versions);
  }

  private async runs(): Promise<readonly ApiRun[]> {
    const path = '/api/v2/runs';
    const value = await this.request(path, true);
    if (!isItems(value, isApiRun)) {
      throw new ReadModelSourceError(
        'contract',
        `${path} did not match the expected v2 Run-list contract.`,
      );
    }
    return value.items;
  }

  private async runAgents(runId: string): Promise<readonly ApiRunAgent[]> {
    const path = `/api/v2/runs/${encodeURIComponent(runId)}/agents`;
    const value = await this.request(path, true);
    if (!isItems(value, isApiRunAgent)) {
      throw new ReadModelSourceError(
        'contract',
        `${path} did not match the expected v2 RunAgent-list contract.`,
      );
    }
    return value.items;
  }

  private async replay(runId: string): Promise<ApiReplay> {
    const path = `/api/v2/runs/${encodeURIComponent(runId)}/replay?perspective=operator`;
    const value = await this.request(path, true);
    if (!isApiReplay(value)) {
      throw new ReadModelSourceError(
        'contract',
        `${path} did not match the expected v2 operator-replay contract.`,
      );
    }
    return value;
  }

  private async telemetry(runId: string): Promise<ApiTelemetryOverlay> {
    const path = `/api/v2/runs/${encodeURIComponent(runId)}/traces`;
    const value = await this.request(path, true);
    if (!isApiTelemetryOverlay(value)) {
      throw new ReadModelSourceError(
        'contract',
        `${path} did not match the expected v2 telemetry-overlay contract.`,
      );
    }
    return value;
  }

  private async evaluations(
    runId: string,
  ): Promise<readonly ApiRunEvaluation[]> {
    const path = `/api/v2/runs/${encodeURIComponent(runId)}/evaluations`;
    const value = await this.request(path, true);
    if (!isItems(value, isApiRunEvaluation)) {
      throw new ReadModelSourceError(
        'contract',
        `${path} did not match the expected deterministic evaluation-list contract.`,
      );
    }
    return value.items;
  }

  private async interactions(
    runId: string,
  ): Promise<readonly CollaborationExchange[]> {
    const path = `/api/v2/runs/${encodeURIComponent(runId)}/interactions`;
    const value = await this.request(path, true);
    if (!isItems(value, isApiRunInteraction)) {
      throw new ReadModelSourceError(
        'contract',
        `${path} did not match the expected v2 interaction-list contract.`,
      );
    }
    return value.items;
  }
}

export function createLiveReadModelSource(
  options: LiveReadModelSourceOptions,
): WebReadModelSource {
  return new LiveReadModelSource(options);
}
