import {
  exerciseRuns,
  getReplayEventsForPerspective,
  getRunById,
  getScenarioById,
  scenarios,
  type AgentSession,
  type ExerciseRun,
  type LocalizedText,
  type PlatformScenario,
  type ReplayReceipt,
  type RoleSlot,
  type ScenarioVersion,
  type TraceSummary,
} from './platform';

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
    (value.traceId === undefined || isString(value.traceId)) &&
    (value.spanId === undefined || isString(value.spanId))
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
  const categories: Record<string, ReplayReceipt['category']> = {
    artifact: 'contribution',
    feedback: 'feedback',
    receipt: 'receipt',
    run: 'run',
    submission: 'submission',
  };
  return categories[event.streamType] ?? 'run';
}

function eventToReceipt(event: ApiRunEvent): ReplayReceipt {
  return {
    id: event.eventId,
    sequence: event.runSeq,
    category: eventCategory(event),
    wallTime: event.recordedAt,
    virtualTime: event.virtualTime,
    title: text(event.eventType, event.eventType),
    detail: text(
      `${event.streamType} · ${event.assertionClass}`,
      `${event.streamType} · ${event.assertionClass}`,
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
  return {
    id: receipt.id,
    sequence: receipt.issuedRunSeq,
    category: 'receipt',
    wallTime: receipt.issuedAt,
    virtualTime: receipt.issuedVirtualAt,
    title: text(
      `可见性收据 · ${receipt.viewKind}`,
      `Visibility receipt · ${receipt.viewKind}`,
    ),
    detail: text(
      `${receipt.resourceType} · ${receipt.resourceId} · Agent 收据 #${receipt.agentReceiptSeq}`,
      `${receipt.resourceType} · ${receipt.resourceId} · Agent receipt #${receipt.agentReceiptSeq}`,
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
  };
}

const liveScenarioGaps: readonly ReadModelGap[] = [
  {
    code: 'SCENARIO_CHECKPOINTS_UNAVAILABLE',
    title: text(
      '检查点尚未进入公开 v2 DTO',
      'Checkpoints are not in the public v2 DTO',
    ),
    detail: text(
      '实时视图不会用参考样例补齐双时钟检查点。',
      'The live view does not backfill dual-clock checkpoints from the reference fixture.',
    ),
  },
  {
    code: 'WATER_TOPOLOGY_UNAVAILABLE',
    title: text(
      '水系拓扑尚未进入公开 v2 DTO',
      'Water topology is not in the public v2 DTO',
    ),
    detail: text(
      '当前仅展示 API 返回的区域、版本和角色契约。',
      'Only the region, versions, and role contracts returned by the API are shown.',
    ),
  },
];

const liveRunGaps: readonly ReadModelGap[] = [
  ...liveScenarioGaps,
  {
    code: 'AGENT_IDENTITY_DETAIL_UNAVAILABLE',
    title: text(
      'Agent Identity 详情未包含在 RunAgent 列表',
      'Agent Identity detail is absent from the RunAgent list',
    ),
    detail: text(
      '显示真实 RunAgent、角色、实例键和版本 ID；模型名称与工具计数保留为空。',
      'Real RunAgent, role, instance key, and version ID are shown; model names and tool counts remain blank.',
    ),
  },
  {
    code: 'SPAN_DETAIL_UNAVAILABLE',
    title: text(
      'v2 traces 端点当前只返回 Trace 摘要',
      'The v2 traces endpoint currently returns trace summaries only',
    ),
    detail: text(
      '不会伪造 participant、model、tool Span 或父子关系；Span 瀑布需等待明细查询 DTO。',
      'Participant, model, and tool spans or parent-child edges are never invented; the waterfall awaits a span-detail query DTO.',
    ),
  },
  {
    code: 'PARTICIPANT_REPLAY_UNAVAILABLE',
    title: text(
      '实时页面只加载 operator 回放投影',
      'The live page loads only the operator replay projection',
    ),
    detail: text(
      'Agent 历史视角必须由显式授权查询加载，不能从 operator 事件反推。',
      'Historical agent views require an explicitly authorized query and are not inferred from operator events.',
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
      const [agents, replay, telemetry] = await Promise.all([
        this.runAgents(runId),
        this.replay(runId),
        this.telemetry(runId),
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
        )
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
}

export function createLiveReadModelSource(
  options: LiveReadModelSourceOptions,
): WebReadModelSource {
  return new LiveReadModelSource(options);
}
