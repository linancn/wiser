import { createHash, randomBytes, randomUUID } from 'node:crypto';

import { RunTaskSchema } from '@agent-excon/contracts';

import type {
  AgentIdentityDto,
  AgentVersionDto,
  AgentViewReceiptDto,
  BestEffortTelemetryOverlayDto,
  CreateArtifactVersionRequest,
  CreateAgentIdentityRequest,
  CreateAgentVersionRequest,
  CreateRunArtifactRequest,
  CreateRunMessageRequest,
  CreateRunRequest,
  CreateScenarioRequest,
  CreateScenarioVersionRequest,
  CreateSubmissionEndorsementRequest,
  CreateTaskSubmissionRequest,
  FeedbackActionGrantDto,
  JoinRunAgentRequest,
  ManageScenarioSummaryDto,
  PublicScenarioSummaryDto,
  PublicScenarioVersionDetailDto,
  ReplayQuery,
  ReplayResponseDto,
  RoleDefinitionDto,
  RunAgentDto,
  RunAgentMeDto,
  RunArtifactDto,
  RunDto,
  RunEventDto,
  RunFeedbackDto,
  RunMessageDto,
  RunRoleAssignmentDto,
  RunSubmissionDto,
  RunSyncRequest,
  RunTaskDto,
  ScenarioVersionDetailDto,
  SyncDeliveryBatchDto,
  SubmissionEndorsementDto,
  TaskClaimRequest,
  TaskClaimResponseDto,
  TaskHeartbeatRequest,
  TaskLeaseCommandRequest,
  VersionCommandRequest,
} from '@agent-excon/contracts';
import {
  assessRequiredRoleQuorum,
  beginRunTask,
  claimRunTask,
  consumeFeedbackActionGrant,
  createFeedbackActionGrant,
  createRunTask,
  heartbeatRunTask,
  releaseRunTask,
  submitRunTask,
  type FeedbackActionGrant,
  type RunTask as DomainRunTask,
} from '@agent-excon/core';

import { ExerciseServiceError, type ParticipantPrincipal } from './types.js';
import type { IssuedRunResource, V2ExerciseService } from './v2-types.js';

export const DEFAULT_V2_SCENARIO_ID = 'jing-jin-ji-yongding-river';
export const DEFAULT_V2_SCENARIO_VERSION_ID =
  'jjj-yongding-collaboration-2023-v2';

const ZERO_HASH = `sha256:${'0'.repeat(64)}`;

type LocalizedText = { readonly 'zh-CN': string; readonly en: string };

interface StoredScenario {
  readonly id: string;
  readonly slug: string;
  readonly ownerId: string;
  readonly title: LocalizedText;
  readonly description: LocalizedText;
  readonly region: LocalizedText;
  readonly simulationOnly: true;
  lifecycle: 'DRAFT' | 'PUBLISHED' | 'RETIRED';
  currentVersionId: string | undefined;
  version: number;
  readonly versionIds: string[];
  updatedAt: string;
}

interface StoredAgent {
  dto: AgentIdentityDto;
  readonly versionIds: string[];
}

interface StoredRunAgent {
  readonly dto: RunAgentDto;
  readonly joinedRunSeq: number;
}

type ResourceType = 'task' | 'message' | 'artifact' | 'feedback';

interface EligibleDisclosure {
  readonly resourceType: ResourceType;
  readonly viewKind:
    'task_assignment' | 'message' | 'artifact_grant' | 'feedback';
  readonly resourceId: string;
  readonly resourceVersion: string;
  readonly sourceEventId: string;
  readonly sourceRunSeq: number;
  readonly contentSnapshot: IssuedRunResource;
  readonly contentHash: string;
}

interface StoredAcknowledgement {
  readonly throughReceiptSeq: number;
  readonly headHash: string;
  readonly acknowledgedRunSeq: number;
}

interface StoredRun {
  readonly initial: RunDto;
  run: RunDto;
  readonly createdRunSeq: number;
  readonly runAgents: Map<string, StoredRunAgent>;
  readonly roleAssignments: RunRoleAssignmentDto[];
  readonly tasks: Map<string, RunTaskDto>;
  readonly taskStates: Map<string, DomainRunTask>;
  readonly messages: Map<string, RunMessageDto>;
  readonly artifacts: Map<string, RunArtifactDto>;
  readonly artifactVersions: Map<string, RunArtifactDto>;
  readonly submissions: Map<string, RunSubmissionDto>;
  readonly endorsements: Map<string, SubmissionEndorsementDto>;
  readonly feedback: Map<string, RunFeedbackDto>;
  readonly actionGrants: Map<string, FeedbackActionGrant>;
  readonly eligible: Map<string, EligibleDisclosure[]>;
  readonly receipts: Map<string, AgentViewReceiptDto[]>;
  readonly acknowledgements: Map<string, StoredAcknowledgement[]>;
  readonly events: RunEventDto[];
  eventHeadHash: string;
}

interface IdempotencyRecord {
  readonly requestHash: string;
  readonly response: unknown;
}

export interface InMemoryV2ExerciseServiceOptions {
  readonly idFactory?: () => string;
  readonly now?: () => Date;
  readonly leaseTokenFactory?: () => string;
}

const defaultRoles: readonly RoleDefinitionDto[] = Object.freeze([
  {
    id: 'water-evidence',
    name: { 'zh-CN': '水情与证据智能体', en: 'Water evidence agent' },
    mission: {
      'zh-CN': '整理官方流量、来源、时态与修订记录。',
      en: 'Curate official flows, provenance, timing, and revisions.',
    },
    expectedArtifact: {
      'zh-CN': '证据清单与来水摘要',
      en: 'Evidence register and inflow summary',
    },
  },
  {
    id: 'hydraulic-constraints',
    name: {
      'zh-CN': '水动力约束智能体',
      en: 'Hydraulic constraints agent',
    },
    mission: {
      'zh-CN': '分析河道、断面、损失与传播约束。',
      en: 'Analyze channel, section, loss, and propagation constraints.',
    },
    expectedArtifact: {
      'zh-CN': '断面响应与容量约束',
      en: 'Section response and capacity constraints',
    },
  },
  {
    id: 'ecological-target',
    name: {
      'zh-CN': '生态目标智能体',
      en: 'Ecological target agent',
    },
    mission: {
      'zh-CN': '分析目标区间、连续性和水质边界。',
      en: 'Analyze target ranges, continuity, and water-quality boundaries.',
    },
    expectedArtifact: {
      'zh-CN': '生态目标风险与优先级',
      en: 'Ecological target risks and priorities',
    },
  },
  {
    id: 'dispatch-coordination',
    name: {
      'zh-CN': '调度协调智能体',
      en: 'Dispatch coordination agent',
    },
    mission: {
      'zh-CN': '基于三类显式共享工件组织团队提交。',
      en: 'Coordinate a team submission from three explicitly shared artifacts.',
    },
    expectedArtifact: {
      'zh-CN': '候选联合方案与团队提交',
      en: 'Candidate joint plan and team submission',
    },
  },
]);

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, entry]) => [key, canonicalize(entry)]),
  );
}

function hash(value: unknown): string {
  return `sha256:${createHash('sha256')
    .update(JSON.stringify(canonicalize(value)))
    .digest('hex')}`;
}

/**
 * A deterministic protocol adapter for v2 TDD and local Skill debugging.
 * It models independent RunAgent/Task/Receipt aggregates, but intentionally
 * provides no durability, cross-process concurrency, transaction, or RLS
 * guarantee. The PostgreSQL adapter is the production boundary.
 */
export class InMemoryV2ExerciseService implements V2ExerciseService {
  readonly #scenarios = new Map<string, StoredScenario>();
  readonly #scenarioVersions = new Map<string, ScenarioVersionDetailDto>();
  readonly #agents = new Map<string, StoredAgent>();
  readonly #agentVersions = new Map<string, AgentVersionDto>();
  readonly #runs = new Map<string, StoredRun>();
  readonly #idempotency = new Map<string, IdempotencyRecord>();
  readonly #idFactory: () => string;
  readonly #now: () => Date;
  readonly #leaseTokenFactory: () => string;
  #closed = false;

  constructor(options: InMemoryV2ExerciseServiceOptions = {}) {
    this.#idFactory = options.idFactory ?? randomUUID;
    this.#now = options.now ?? (() => new Date());
    this.#leaseTokenFactory =
      options.leaseTokenFactory ??
      (() => `wlt_${randomBytes(32).toString('base64url')}`);
    this.seedYongdingScenario();
  }

  isReady(): Promise<boolean> {
    return Promise.resolve(!this.#closed);
  }

  listPublicScenarios(): Promise<readonly PublicScenarioSummaryDto[]> {
    return Promise.resolve(
      [...this.#scenarios.values()]
        .filter(
          ({ lifecycle, currentVersionId }) =>
            lifecycle !== 'DRAFT' && currentVersionId !== undefined,
        )
        .map((scenario) => this.publicScenario(scenario)),
    );
  }

  getPublicScenario(scenarioId: string): Promise<{
    readonly scenario: PublicScenarioSummaryDto;
    readonly currentVersion: PublicScenarioVersionDetailDto;
  }> {
    const scenario = this.publicStoredScenario(scenarioId);
    const currentVersion = this.#scenarioVersions.get(
      scenario.currentVersionId!,
    );
    if (currentVersion === undefined) {
      throw this.scenarioNotFound();
    }
    return Promise.resolve({
      scenario: this.publicScenario(scenario),
      currentVersion: this.publicScenarioVersion(currentVersion),
    });
  }

  listPublicScenarioVersions(
    scenarioId: string,
  ): Promise<readonly PublicScenarioVersionDetailDto[]> {
    const scenario = this.publicStoredScenario(scenarioId);
    return Promise.resolve(
      scenario.versionIds
        .map((id) => this.#scenarioVersions.get(id))
        .filter(
          (version): version is ScenarioVersionDetailDto =>
            version !== undefined && version.lifecycle !== 'DRAFT',
        )
        .map((version) => this.publicScenarioVersion(version)),
    );
  }

  getPublicScenarioVersion(
    scenarioVersionId: string,
  ): Promise<PublicScenarioVersionDetailDto> {
    const version = this.#scenarioVersions.get(scenarioVersionId);
    if (version === undefined || version.lifecycle === 'DRAFT') {
      throw new ExerciseServiceError(
        'SCENARIO_VERSION_NOT_FOUND',
        '场景版本不存在。 / The scenario version does not exist.',
      );
    }
    return Promise.resolve(this.publicScenarioVersion(version));
  }

  listManageScenarios(
    principal: ParticipantPrincipal,
  ): Promise<readonly ManageScenarioSummaryDto[]> {
    return Promise.resolve(
      [...this.#scenarios.values()]
        .filter(({ ownerId }) => ownerId === principal.id)
        .map((scenario) => this.manageScenario(scenario)),
    );
  }

  createScenario(
    principal: ParticipantPrincipal,
    idempotencyKey: string,
    input: CreateScenarioRequest,
  ): Promise<{ readonly scenario: ManageScenarioSummaryDto }> {
    return Promise.resolve(
      this.idempotent(
        principal.id,
        'scenario:create',
        idempotencyKey,
        input,
        () => {
          if (
            [...this.#scenarios.values()].some(
              ({ slug }) => slug === input.slug,
            )
          ) {
            throw new ExerciseServiceError(
              'SCENARIO_STATE_CONFLICT',
              '场景 slug 已存在。 / The scenario slug already exists.',
            );
          }
          const now = this.timestamp();
          const stored: StoredScenario = {
            id: this.#idFactory(),
            slug: input.slug,
            ownerId: principal.id,
            title: input.title,
            description: input.description,
            region: input.region,
            simulationOnly: true,
            lifecycle: 'DRAFT',
            currentVersionId: undefined,
            version: 1,
            versionIds: [],
            updatedAt: now,
          };
          this.#scenarios.set(stored.id, stored);
          return { scenario: this.manageScenario(stored) };
        },
      ),
    );
  }

  createScenarioVersion(
    principal: ParticipantPrincipal,
    scenarioId: string,
    idempotencyKey: string,
    input: CreateScenarioVersionRequest,
  ): Promise<{ readonly scenarioVersion: ScenarioVersionDetailDto }> {
    return Promise.resolve(
      this.idempotent(
        principal.id,
        `scenario:${scenarioId}:version:create`,
        idempotencyKey,
        input,
        () => {
          const scenario = this.ownedScenario(principal, scenarioId);
          this.assertAggregateVersion(
            scenario.version,
            input.expectedScenarioVersion,
            'SCENARIO_VERSION_CONFLICT',
            'Scenario',
          );
          const now = this.timestamp();
          const scenarioVersion: ScenarioVersionDetailDto = {
            id: this.#idFactory(),
            scenarioId: scenario.id,
            label: input.label,
            summary: input.summary,
            lifecycle: 'DRAFT',
            replayStartAt: input.replayStartAt,
            requiredRoles: input.requiredRoles,
            minDistinctRequiredAgents: input.minDistinctRequiredAgents,
            validation: { status: 'NOT_VALIDATED', errors: [] },
            version: 1,
            createdAt: now,
            updatedAt: now,
          };
          this.#scenarioVersions.set(scenarioVersion.id, scenarioVersion);
          scenario.versionIds.push(scenarioVersion.id);
          scenario.version += 1;
          scenario.updatedAt = now;
          return { scenarioVersion };
        },
      ),
    );
  }

  validateScenarioVersion(
    principal: ParticipantPrincipal,
    scenarioVersionId: string,
    idempotencyKey: string,
    input: VersionCommandRequest,
  ): Promise<{ readonly scenarioVersion: ScenarioVersionDetailDto }> {
    return Promise.resolve(
      this.idempotent(
        principal.id,
        `scenario-version:${scenarioVersionId}:validate`,
        idempotencyKey,
        input,
        () => {
          const current = this.ownedScenarioVersion(
            principal,
            scenarioVersionId,
          );
          this.assertDraftScenarioVersion(current);
          this.assertAggregateVersion(
            current.version,
            input.expectedVersion,
            'SCENARIO_VERSION_CONFLICT',
            'ScenarioVersion',
          );
          const roleIds = current.requiredRoles.map(({ id }) => id);
          const errors: NonNullable<
            ScenarioVersionDetailDto['validation']['errors']
          >[number][] = [];
          if (roleIds.length < 2) {
            errors.push({
              code: 'REQUIRED_ROLES_MISSING',
              path: ['requiredRoles'],
              message: {
                'zh-CN': '发布场景至少需要两个必需角色。',
                en: 'A published scenario needs at least two required roles.',
              },
            });
          }
          if (new Set(roleIds).size !== roleIds.length) {
            errors.push({
              code: 'DUPLICATE_ROLE_SLOT',
              path: ['requiredRoles'],
              message: {
                'zh-CN': '角色槽位标识不能重复。',
                en: 'Role slot identifiers must be unique.',
              },
            });
          }
          if (
            current.minDistinctRequiredAgents < 2 ||
            current.minDistinctRequiredAgents > new Set(roleIds).size
          ) {
            errors.push({
              code: 'DISTINCT_AGENT_QUORUM_INVALID',
              path: ['minDistinctRequiredAgents'],
              message: {
                'zh-CN':
                  '不同 RunAgent 的就绪人数必须介于 2 与唯一必需角色数之间。',
                en: 'The distinct RunAgent quorum must be between two and the unique required-role count.',
              },
            });
          }
          const now = this.timestamp();
          const next: ScenarioVersionDetailDto = {
            ...current,
            validation: {
              status: errors.length === 0 ? 'VALID' : 'INVALID',
              errors,
              validatedAt: now,
            },
            version: current.version + 1,
            updatedAt: now,
          };
          this.#scenarioVersions.set(next.id, next);
          return { scenarioVersion: next };
        },
      ),
    );
  }

  publishScenarioVersion(
    principal: ParticipantPrincipal,
    scenarioVersionId: string,
    idempotencyKey: string,
    input: VersionCommandRequest,
  ): Promise<{ readonly scenarioVersion: ScenarioVersionDetailDto }> {
    return Promise.resolve(
      this.idempotent(
        principal.id,
        `scenario-version:${scenarioVersionId}:publish`,
        idempotencyKey,
        input,
        () => {
          const current = this.ownedScenarioVersion(
            principal,
            scenarioVersionId,
          );
          this.assertDraftScenarioVersion(current);
          this.assertAggregateVersion(
            current.version,
            input.expectedVersion,
            'SCENARIO_VERSION_CONFLICT',
            'ScenarioVersion',
          );
          if (current.validation.status !== 'VALID') {
            throw new ExerciseServiceError(
              'SCENARIO_STATE_CONFLICT',
              '只能发布已通过校验的草稿。 / Only a validated draft can be published.',
            );
          }
          const scenario = this.ownedScenario(principal, current.scenarioId);
          const now = this.timestamp();
          const contentHash = hash({
            scenarioId: current.scenarioId,
            label: current.label,
            summary: current.summary,
            replayStartAt: current.replayStartAt,
            requiredRoles: current.requiredRoles,
            minDistinctRequiredAgents: current.minDistinctRequiredAgents,
          });
          const next: ScenarioVersionDetailDto = {
            ...current,
            lifecycle: 'PUBLISHED',
            contentHash,
            version: current.version + 1,
            updatedAt: now,
            publishedAt: now,
          };
          this.#scenarioVersions.set(next.id, next);
          scenario.lifecycle = 'PUBLISHED';
          scenario.currentVersionId = next.id;
          scenario.version += 1;
          scenario.updatedAt = now;
          return { scenarioVersion: next };
        },
      ),
    );
  }

  listAgents(
    principal: ParticipantPrincipal,
  ): Promise<readonly AgentIdentityDto[]> {
    return Promise.resolve(
      [...this.#agents.values()]
        .map(({ dto }) => dto)
        .filter(({ ownerId }) => ownerId === principal.id),
    );
  }

  createAgent(
    principal: ParticipantPrincipal,
    idempotencyKey: string,
    input: CreateAgentIdentityRequest,
  ): Promise<{ readonly agent: AgentIdentityDto }> {
    return Promise.resolve(
      this.idempotent(
        principal.id,
        'agent:create',
        idempotencyKey,
        input,
        () => {
          const now = this.timestamp();
          const agent: AgentIdentityDto = {
            id: this.#idFactory(),
            ownerId: principal.id,
            displayName: input.displayName,
            description: input.description,
            lifecycle: 'ACTIVE',
            version: 1,
            createdAt: now,
            updatedAt: now,
          };
          this.#agents.set(agent.id, { dto: agent, versionIds: [] });
          return { agent };
        },
      ),
    );
  }

  createAgentVersion(
    principal: ParticipantPrincipal,
    agentId: string,
    idempotencyKey: string,
    input: CreateAgentVersionRequest,
  ): Promise<{ readonly agentVersion: AgentVersionDto }> {
    return Promise.resolve(
      this.idempotent(
        principal.id,
        `agent:${agentId}:version:create`,
        idempotencyKey,
        input,
        () => {
          const stored = this.ownedAgent(principal, agentId);
          this.assertAggregateVersion(
            stored.dto.version,
            input.expectedAgentVersion,
            'AGENT_VERSION_CONFLICT',
            'AgentIdentity',
          );
          if (stored.dto.lifecycle !== 'ACTIVE') {
            throw new ExerciseServiceError(
              'AGENT_VERSION_CONFLICT',
              '非 ACTIVE 的 AgentIdentity 不能发布新版本。 / A non-active AgentIdentity cannot publish a version.',
            );
          }
          const publishedAt = this.timestamp();
          const content = {
            agentId,
            providerKind: input.providerKind,
            model: input.model,
            capabilities: input.capabilities,
            protocolVersion: input.protocolVersion,
            telemetryMode: input.telemetryMode,
            skillManifestHash: input.skillManifestHash,
            toolManifestHash: input.toolManifestHash,
          };
          const agentVersion: AgentVersionDto = {
            id: this.#idFactory(),
            ...content,
            lifecycle: 'PUBLISHED',
            contentHash: hash(content),
            version: 1,
            publishedAt,
          };
          this.#agentVersions.set(agentVersion.id, agentVersion);
          stored.versionIds.push(agentVersion.id);
          stored.dto = {
            ...stored.dto,
            version: stored.dto.version + 1,
            updatedAt: publishedAt,
          };
          return { agentVersion };
        },
      ),
    );
  }

  getAgentVersion(
    principal: ParticipantPrincipal,
    agentVersionId: string,
  ): Promise<AgentVersionDto> {
    const version = this.#agentVersions.get(agentVersionId);
    if (version === undefined) {
      throw this.agentVersionNotFound();
    }
    this.ownedAgent(principal, version.agentId);
    return Promise.resolve(version);
  }

  listRuns(principal: ParticipantPrincipal): Promise<readonly RunDto[]> {
    return Promise.resolve(
      [...this.#runs.values()]
        .map(({ run }) => run)
        .filter(({ ownerId }) => ownerId === principal.id),
    );
  }

  createRun(
    principal: ParticipantPrincipal,
    idempotencyKey: string,
    input: CreateRunRequest,
  ): Promise<{ readonly run: RunDto }> {
    return Promise.resolve(
      this.idempotent(principal.id, 'run:create', idempotencyKey, input, () => {
        const scenarioVersion = this.#scenarioVersions.get(
          input.scenarioVersionId,
        );
        if (
          scenarioVersion === undefined ||
          scenarioVersion.lifecycle !== 'PUBLISHED'
        ) {
          throw new ExerciseServiceError(
            'SCENARIO_VERSION_NOT_FOUND',
            '已发布场景版本不存在。 / The published scenario version does not exist.',
          );
        }
        const now = this.timestamp();
        const run: RunDto = {
          id: this.#idFactory(),
          scenarioVersionId: scenarioVersion.id,
          ownerId: principal.id,
          label: input.label,
          mode: input.mode,
          state: 'FORMING',
          virtualTime: scenarioVersion.replayStartAt,
          version: 1,
          createdAt: now,
          updatedAt: now,
        };
        const stored: StoredRun = {
          initial: run,
          run,
          createdRunSeq: 1,
          runAgents: new Map(),
          roleAssignments: [],
          tasks: new Map(),
          taskStates: new Map(),
          messages: new Map(),
          artifacts: new Map(),
          artifactVersions: new Map(),
          submissions: new Map(),
          endorsements: new Map(),
          feedback: new Map(),
          actionGrants: new Map(),
          eligible: new Map(),
          receipts: new Map(),
          acknowledgements: new Map(),
          events: [],
          eventHeadHash: ZERO_HASH,
        };
        this.#runs.set(run.id, stored);
        this.appendRunEvent(stored, {
          streamType: 'run',
          streamId: run.id,
          eventType: 'run.created',
          actorType: 'operator',
          actorId: principal.id,
          assertionClass: 'operator_asserted',
          payload: { scenarioVersionId: run.scenarioVersionId },
        });
        return { run };
      }),
    );
  }

  getRun(
    principal: ParticipantPrincipal,
    runId: string,
  ): Promise<{ readonly run: RunDto }> {
    return Promise.resolve({ run: this.ownedRun(principal, runId).run });
  }

  joinRun(
    principal: ParticipantPrincipal,
    runId: string,
    idempotencyKey: string,
    input: JoinRunAgentRequest,
  ): Promise<{ readonly runAgent: RunAgentDto }> {
    return Promise.resolve(
      this.idempotent(
        principal.id,
        `run:${runId}:agent:join`,
        idempotencyKey,
        input,
        () => {
          const stored = this.ownedRun(principal, runId);
          if (stored.run.state !== 'FORMING') {
            throw new ExerciseServiceError(
              'RUN_STATE_CONFLICT',
              '只有 FORMING Run 可以加入智能体。 / Agents can join only a forming run.',
            );
          }
          const scenarioVersion = this.pinnedScenarioVersion(stored);
          if (
            !scenarioVersion.requiredRoles.some(
              ({ id }) => id === input.roleSlotId,
            )
          ) {
            throw new ExerciseServiceError(
              'RUN_ROLE_CONFLICT',
              '角色槽位不属于本 Run 的场景版本。 / The role slot is not part of this run scenario version.',
            );
          }
          if (
            stored.roleAssignments.some(
              ({ roleSlotId }) => roleSlotId === input.roleSlotId,
            )
          ) {
            throw new ExerciseServiceError(
              'RUN_ROLE_CONFLICT',
              '必需角色槽位已有主分配。 / The required role slot already has a primary assignment.',
            );
          }
          if (
            [...stored.runAgents.values()].some(
              ({ dto }) => dto.instanceKey === input.instanceKey,
            )
          ) {
            throw new ExerciseServiceError(
              'RUN_ROLE_CONFLICT',
              'instanceKey 在 Run 内必须唯一。 / instanceKey must be unique within the run.',
            );
          }
          const agentVersion = this.#agentVersions.get(input.agentVersionId);
          if (
            agentVersion === undefined ||
            agentVersion.lifecycle !== 'PUBLISHED'
          ) {
            throw this.agentVersionNotFound();
          }
          this.ownedAgent(principal, agentVersion.agentId);
          const joinedAt = this.timestamp();
          const runAgentId = this.#idFactory();
          const joinedEvent = this.appendRunEvent(stored, {
            streamType: 'run_agent',
            streamId: runAgentId,
            eventType: 'run-agent.joined',
            actorType: 'operator',
            actorId: principal.id,
            assertionClass: 'operator_asserted',
            payload: {
              agentVersionId: agentVersion.id,
              roleSlotId: input.roleSlotId,
              instanceKey: input.instanceKey,
            },
          });
          const runAgent: RunAgentDto = {
            id: runAgentId,
            runId,
            agentVersionId: agentVersion.id,
            instanceKey: input.instanceKey,
            roleSlotId: input.roleSlotId,
            state: 'JOINED',
            version: 1,
            joinedAt,
          };
          stored.runAgents.set(runAgent.id, {
            dto: runAgent,
            joinedRunSeq: joinedEvent.runSeq,
          });
          stored.roleAssignments.push({
            id: this.#idFactory(),
            runId,
            runAgentId: runAgent.id,
            roleSlotId: input.roleSlotId,
            primary: true,
            assignedAt: joinedAt,
            assignedRunSeq: joinedEvent.runSeq,
          });
          stored.eligible.set(runAgent.id, []);
          stored.receipts.set(runAgent.id, []);
          stored.acknowledgements.set(runAgent.id, []);
          return { runAgent };
        },
      ),
    );
  }

  listRunAgents(
    principal: ParticipantPrincipal,
    runId: string,
  ): Promise<readonly RunAgentDto[]> {
    const stored = this.ownedRun(principal, runId);
    return Promise.resolve(
      [...stored.runAgents.values()].map(({ dto }) => dto),
    );
  }

  getRunAgentMe(
    principal: ParticipantPrincipal,
    runId: string,
    runAgentId: string,
  ): Promise<RunAgentMeDto> {
    const stored = this.runForAgent(principal, runId, runAgentId);
    const runAgent = this.ownedRunAgent(stored, runAgentId).dto;
    const roleAssignment = stored.roleAssignments.find(
      (assignment) => assignment.runAgentId === runAgentId,
    );
    const role = this.pinnedScenarioVersion(stored).requiredRoles.find(
      ({ id }) => id === runAgent.roleSlotId,
    );
    if (roleAssignment === undefined || role === undefined) {
      throw new ExerciseServiceError(
        'INTERNAL_ERROR',
        'RunAgent assignment projection is incomplete.',
      );
    }
    const receipts = stored.receipts.get(runAgentId) ?? [];
    return Promise.resolve({
      runAgent,
      roleAssignment,
      role,
      syncCursor: {
        afterReceiptSeq: receipts.length,
        receiptHeadHash: receipts.at(-1)?.receiptHash ?? ZERO_HASH,
      },
    });
  }

  startRun(
    principal: ParticipantPrincipal,
    runId: string,
    idempotencyKey: string,
    input: VersionCommandRequest,
  ): Promise<{ readonly run: RunDto }> {
    return Promise.resolve(
      this.idempotent(
        principal.id,
        `run:${runId}:start`,
        idempotencyKey,
        input,
        () => {
          const stored = this.ownedRun(principal, runId);
          this.assertAggregateVersion(
            stored.run.version,
            input.expectedVersion,
            'RUN_VERSION_CONFLICT',
            'ExerciseRun',
          );
          if (stored.run.state !== 'FORMING') {
            throw new ExerciseServiceError(
              'RUN_STATE_CONFLICT',
              '只有 FORMING Run 可以启动。 / Only a forming run can start.',
            );
          }
          const scenarioVersion = this.pinnedScenarioVersion(stored);
          const assignments = new Map(
            stored.roleAssignments.map((assignment) => [
              assignment.roleSlotId,
              assignment.runAgentId,
            ]),
          );
          const assignedIds = scenarioVersion.requiredRoles.map(({ id }) =>
            assignments.get(id),
          );
          const quorum = assessRequiredRoleQuorum({
            roleSlots: scenarioVersion.requiredRoles.map(({ id }) => ({
              id,
              roleId: id,
              required: true,
            })),
            assignments: stored.roleAssignments.map(
              ({ roleSlotId, runAgentId }) => ({
                roleSlotId,
                runAgentId,
                kind: 'primary' as const,
                active: true,
              }),
            ),
            minDistinctRequiredAgents:
              scenarioVersion.minDistinctRequiredAgents,
            compatibilityMode: 'collaborative_v2',
          });
          if (!quorum.ready) {
            throw new ExerciseServiceError(
              'RUN_ROLE_CONFLICT',
              '必需角色必须由达到场景 quorum 的不同 RunAgent 占位。 / Required roles must be staffed by enough distinct RunAgents.',
              {
                requiredRoleIds: scenarioVersion.requiredRoles.map(
                  ({ id }) => id,
                ),
                minDistinctRequiredAgents:
                  scenarioVersion.minDistinctRequiredAgents,
                violations: quorum.violations,
              },
            );
          }
          const startedAt = this.timestamp();
          stored.run = {
            ...stored.run,
            state: 'RUNNING',
            version: stored.run.version + 1,
            updatedAt: startedAt,
            startedAt,
          };
          this.appendRunEvent(stored, {
            streamType: 'run',
            streamId: runId,
            eventType: 'run.started',
            actorType: 'operator',
            actorId: principal.id,
            assertionClass: 'operator_asserted',
            payload: {
              staffedRunAgentIds: [...new Set(assignedIds as string[])],
            },
          });
          for (const role of scenarioVersion.requiredRoles) {
            const runAgentId = assignments.get(role.id)!;
            this.createInitialResources(stored, role, runAgentId);
          }
          return { run: stored.run };
        },
      ),
    );
  }

  sync(
    principal: ParticipantPrincipal,
    runId: string,
    runAgentId: string,
    idempotencyKey: string,
    input: RunSyncRequest,
  ): Promise<SyncDeliveryBatchDto> {
    return Promise.resolve(
      this.idempotent(
        runAgentId,
        `run:${runId}:agent:${runAgentId}:sync`,
        idempotencyKey,
        input,
        () => {
          const stored = this.runForAgent(principal, runId, runAgentId);
          if (stored.run.state !== 'RUNNING') {
            throw new ExerciseServiceError(
              'RUN_STATE_CONFLICT',
              '只有 RUNNING Run 可以同步新内容。 / New content can be synced only from a running run.',
            );
          }
          const receipts = stored.receipts.get(runAgentId)!;
          if (input.afterReceiptSeq !== receipts.length) {
            throw new ExerciseServiceError(
              'RECEIPT_CURSOR_CONFLICT',
              '同步光标与服务端 Receipt head 不一致。 / The sync cursor does not match the server receipt head.',
              { currentReceiptSeq: receipts.length },
            );
          }
          if (input.ack !== undefined) {
            this.acknowledgeReceipts(
              stored,
              runAgentId,
              input.ack.throughReceiptSeq,
              input.ack.headHash,
            );
          }
          const issuedIds = new Set(
            receipts.map(
              ({ resourceType, resourceId, resourceVersion }) =>
                `${resourceType}:${resourceId}:${resourceVersion}`,
            ),
          );
          const eligible = (stored.eligible.get(runAgentId) ?? []).filter(
            ({ resourceType, resourceId, resourceVersion }) =>
              !issuedIds.has(
                `${resourceType}:${resourceId}:${resourceVersion}`,
              ),
          );
          const selected = eligible.slice(0, input.maxItems);
          const deliveryBatchId = this.#idFactory();
          const issued: AgentViewReceiptDto[] = [];
          let previousReceiptHash = receipts.at(-1)?.receiptHash ?? ZERO_HASH;
          for (const disclosure of selected) {
            const receiptId = this.#idFactory();
            const issuance = this.appendRunEvent(stored, {
              streamType: 'receipt',
              streamId: receiptId,
              eventType: 'receipt.issued',
              actorType: 'system',
              actorId: 'excon',
              assertionClass: 'platform_observed',
              payload: {
                runAgentId,
                resourceType: disclosure.resourceType,
                resourceId: disclosure.resourceId,
              },
            });
            const resource = this.resource(stored, disclosure);
            const base = {
              id: receiptId,
              runId,
              runAgentId,
              agentReceiptSeq: receipts.length + issued.length + 1,
              deliveryBatchId,
              sourceEventId: disclosure.sourceEventId,
              sourceRunSeq: disclosure.sourceRunSeq,
              issuedEventId: issuance.eventId,
              issuedRunSeq: issuance.runSeq,
              viewKind: disclosure.viewKind,
              resourceType: disclosure.resourceType,
              resourceId: disclosure.resourceId,
              resourceVersion: disclosure.resourceVersion,
              availableVirtualAt: stored.run.virtualTime,
              issuedVirtualAt: stored.run.virtualTime,
              issuedAt: this.timestamp(),
              schemaVersion: 1 as const,
              contentSnapshot: canonicalize(resource) as Record<
                string,
                unknown
              >,
              contentHash: disclosure.contentHash,
              previousReceiptHash,
            };
            const receipt: AgentViewReceiptDto = {
              ...base,
              receiptHash: hash(base),
            };
            previousReceiptHash = receipt.receiptHash;
            issued.push(receipt);
          }
          receipts.push(...issued);
          return {
            deliveryBatchId,
            runId,
            runAgentId,
            fromReceiptSeq:
              issued.length === 0 ? null : input.afterReceiptSeq + 1,
            throughReceiptSeq: receipts.length,
            receiptHeadHash: receipts.at(-1)?.receiptHash ?? ZERO_HASH,
            runCursor: stored.events.length,
            hasMore: selected.length < eligible.length,
            receipts: issued,
          };
        },
      ),
    );
  }

  listIssuedResources(
    principal: ParticipantPrincipal,
    runId: string,
    runAgentId: string,
    resourceType: ResourceType,
  ): Promise<readonly IssuedRunResource[]> {
    const stored = this.runForAgent(principal, runId, runAgentId);
    const latest = new Map<string, IssuedRunResource>();
    for (const receipt of stored.receipts.get(runAgentId) ?? []) {
      if (receipt.resourceType === resourceType) {
        latest.set(
          receipt.resourceId,
          receipt.contentSnapshot as IssuedRunResource,
        );
      }
    }
    return Promise.resolve([...latest.values()]);
  }

  claimTask(
    principal: ParticipantPrincipal,
    runAgentId: string,
    taskId: string,
    idempotencyKey: string,
    input: TaskClaimRequest,
  ): Promise<TaskClaimResponseDto> {
    return Promise.resolve(
      this.idempotent(
        runAgentId,
        `task:${taskId}:claim`,
        idempotencyKey,
        input,
        () => {
          const { stored, task } = this.taskForAgent(
            principal,
            runAgentId,
            taskId,
          );
          const claimedAt = this.timestamp();
          const leaseExpiresAt = this.addSeconds(claimedAt, input.leaseSeconds);
          const maximumLeaseExpiresAt = this.addSeconds(claimedAt, 15 * 60);
          const leaseToken = this.#leaseTokenFactory();
          const next = claimRunTask(task, {
            expectedVersion: input.expectedVersion,
            runAgentId,
            leaseTokenHash: hash(leaseToken),
            claimedAt,
            leaseExpiresAt,
            maximumLeaseExpiresAt,
          });
          const dto = this.recordTaskTransition(
            stored,
            next,
            runAgentId,
            'task.claimed',
          );
          return {
            task: dto,
            lease: {
              claimEpoch: next.claimEpoch,
              leaseToken,
              leaseExpiresAt,
              maximumLeaseExpiresAt,
            },
          };
        },
      ),
    );
  }

  beginTask(
    principal: ParticipantPrincipal,
    runAgentId: string,
    taskId: string,
    idempotencyKey: string,
    input: TaskLeaseCommandRequest,
  ): Promise<{ readonly task: RunTaskDto }> {
    return Promise.resolve(
      this.idempotent(
        runAgentId,
        `task:${taskId}:begin`,
        idempotencyKey,
        input,
        () => {
          const { stored, task } = this.taskForAgent(
            principal,
            runAgentId,
            taskId,
          );
          const next = beginRunTask(task, this.leaseCommand(input, runAgentId));
          return {
            task: this.recordTaskTransition(
              stored,
              next,
              runAgentId,
              'task.started',
            ),
          };
        },
      ),
    );
  }

  heartbeatTask(
    principal: ParticipantPrincipal,
    runAgentId: string,
    taskId: string,
    idempotencyKey: string,
    input: TaskHeartbeatRequest,
  ): Promise<{ readonly task: RunTaskDto }> {
    return Promise.resolve(
      this.idempotent(
        runAgentId,
        `task:${taskId}:heartbeat`,
        idempotencyKey,
        input,
        () => {
          const { stored, task } = this.taskForAgent(
            principal,
            runAgentId,
            taskId,
          );
          if (task.activeClaim === undefined) {
            return {
              task: this.recordTaskTransition(
                stored,
                heartbeatRunTask(task, {
                  ...this.leaseCommand(input, runAgentId),
                  nextLeaseExpiresAt: this.timestamp(),
                }),
                runAgentId,
                'task.lease-renewed',
              ),
            };
          }
          const next = heartbeatRunTask(task, {
            ...this.leaseCommand(input, runAgentId),
            nextLeaseExpiresAt: this.addSeconds(
              task.activeClaim.leaseExpiresAt,
              input.extendBySeconds,
            ),
          });
          return {
            task: this.recordTaskTransition(
              stored,
              next,
              runAgentId,
              'task.lease-renewed',
            ),
          };
        },
      ),
    );
  }

  releaseTask(
    principal: ParticipantPrincipal,
    runAgentId: string,
    taskId: string,
    idempotencyKey: string,
    input: TaskLeaseCommandRequest,
  ): Promise<{ readonly task: RunTaskDto }> {
    return Promise.resolve(
      this.idempotent(
        runAgentId,
        `task:${taskId}:release`,
        idempotencyKey,
        input,
        () => {
          const { stored, task } = this.taskForAgent(
            principal,
            runAgentId,
            taskId,
          );
          const next = releaseRunTask(
            task,
            this.leaseCommand(input, runAgentId),
          );
          return {
            task: this.recordTaskTransition(
              stored,
              next,
              runAgentId,
              'task.released',
            ),
          };
        },
      ),
    );
  }

  submitTask(
    principal: ParticipantPrincipal,
    runAgentId: string,
    taskId: string,
    idempotencyKey: string,
    input: CreateTaskSubmissionRequest,
  ): Promise<{
    readonly submission: RunSubmissionDto;
    readonly task: RunTaskDto;
  }> {
    return Promise.resolve(
      this.idempotent(
        runAgentId,
        `task:${taskId}:submission:create`,
        idempotencyKey,
        input,
        () => {
          const {
            stored,
            task,
            dto: currentTask,
          } = this.taskForAgent(principal, runAgentId, taskId);
          this.assertSubmissionReferences(stored, runAgentId, input);
          this.assertRecipientSnapshot(
            stored,
            input.endorsementRecipientRunAgentIds,
            runAgentId,
          );

          let revisionNo = 1;
          let consumedRevisionGrant:
            { id: string; next: FeedbackActionGrant } | undefined;
          if (input.revisionOfId !== undefined) {
            const predecessor = stored.submissions.get(input.revisionOfId);
            if (
              predecessor === undefined ||
              predecessor.taskId !== taskId ||
              predecessor.actorRunAgentId !== runAgentId
            ) {
              throw new ExerciseServiceError(
                'SUBMISSION_CONFLICT',
                "修订必须指向同一智能体在同一 Task 的不可变前序提交。 / A revision must reference the same agent's immutable predecessor for this Task.",
              );
            }
            revisionNo = predecessor.revisionNo + 1;
            consumedRevisionGrant = {
              id: input.feedbackActionGrantId!,
              next: this.consumeGrant(
                stored,
                runAgentId,
                input.feedbackActionGrantId!,
                taskId,
                'resubmit',
                predecessor.id,
              ),
            };
          }

          const nextTask = submitRunTask(
            task,
            this.leaseCommand(input, runAgentId),
          );
          const submittedAt = this.timestamp();
          const submissionId = this.#idFactory();
          const event = this.appendRunEvent(stored, {
            streamType: 'task',
            streamId: taskId,
            eventType: 'task.submitted',
            actorType: 'run_agent',
            actorId: runAgentId,
            assertionClass: 'participant_reported',
            payload: {
              runAgentId,
              submissionId,
              taskVersion: nextTask.version,
              claimEpoch: input.claimEpoch,
              revisionNo,
            },
          });
          const submission: RunSubmissionDto = {
            id: submissionId,
            runId: stored.run.id,
            taskId,
            actorRunAgentId: runAgentId,
            targetScope: input.targetScope,
            roleSlotId: currentTask.roleSlotId,
            revisionNo,
            ...(input.revisionOfId === undefined
              ? {}
              : { revisionOfId: input.revisionOfId }),
            submissionType: input.submissionType,
            isFinal: false,
            payload: canonicalize(
              input.payload,
            ) as CreateTaskSubmissionRequest['payload'],
            payloadHash: hash(input.payload),
            receiptRefs: [...input.receiptRefs],
            artifactVersionRefs: [...input.artifactVersionRefs],
            endorsementRecipientRunAgentIds: [
              ...input.endorsementRecipientRunAgentIds,
            ],
            submittedVirtualAt: stored.run.virtualTime,
            submittedAt,
            createdRunSeq: event.runSeq,
          };
          stored.submissions.set(submission.id, submission);
          stored.taskStates.set(taskId, nextTask);
          const taskDto = this.updateTaskDto(stored, nextTask);
          this.addEligible(stored, runAgentId, taskDto, event, 'task');
          if (consumedRevisionGrant !== undefined) {
            stored.actionGrants.set(
              consumedRevisionGrant.id,
              consumedRevisionGrant.next,
            );
            this.appendGrantConsumedEvent(
              stored,
              runAgentId,
              consumedRevisionGrant.next,
            );
          }
          this.issueEndorsementGrants(stored, submission);
          return { submission, task: taskDto };
        },
      ),
    );
  }

  createMessage(
    principal: ParticipantPrincipal,
    runAgentId: string,
    runId: string,
    idempotencyKey: string,
    input: CreateRunMessageRequest,
  ): Promise<{ readonly message: RunMessageDto }> {
    return Promise.resolve(
      this.idempotent(
        runAgentId,
        `run:${runId}:message:create`,
        idempotencyKey,
        input,
        () => {
          const stored = this.runForAgent(principal, runId, runAgentId);
          this.assertRunning(stored);
          this.assertRecipientSnapshot(stored, input.recipientRunAgentIds);
          const messageId = this.#idFactory();
          const event = this.appendRunEvent(stored, {
            streamType: 'message',
            streamId: messageId,
            eventType: 'message.created',
            actorType: 'run_agent',
            actorId: runAgentId,
            assertionClass: 'participant_reported',
            payload: {
              runAgentId,
              recipientRunAgentIds: [...input.recipientRunAgentIds],
            },
          });
          const message: RunMessageDto = {
            id: messageId,
            runId,
            senderType: 'RUN_AGENT',
            senderId: runAgentId,
            recipientRunAgentIds: [...input.recipientRunAgentIds],
            subject: input.subject,
            body: input.body,
            createdRunSeq: event.runSeq,
            createdAt: this.timestamp(),
          };
          stored.messages.set(message.id, message);
          for (const recipientId of message.recipientRunAgentIds) {
            this.addEligible(stored, recipientId, message, event, 'message');
          }
          return { message };
        },
      ),
    );
  }

  createArtifact(
    principal: ParticipantPrincipal,
    runAgentId: string,
    runId: string,
    idempotencyKey: string,
    input: CreateRunArtifactRequest,
  ): Promise<{ readonly artifact: RunArtifactDto }> {
    return Promise.resolve(
      this.idempotent(
        runAgentId,
        `run:${runId}:artifact:create`,
        idempotencyKey,
        input,
        () => {
          const stored = this.runForAgent(principal, runId, runAgentId);
          this.assertRunning(stored);
          this.assertRecipientSnapshot(stored, input.recipientRunAgentIds);
          if (
            [...stored.artifacts.values()].some(
              ({ artifactKey }) => artifactKey === input.artifactKey,
            )
          ) {
            throw new ExerciseServiceError(
              'ARTIFACT_KEY_CONFLICT',
              'artifactKey 在 Run 内必须唯一。 / artifactKey must be unique within a Run.',
            );
          }
          const artifactId = this.#idFactory();
          const versionId = this.#idFactory();
          const event = this.appendRunEvent(stored, {
            streamType: 'artifact',
            streamId: artifactId,
            eventType: 'artifact.published',
            actorType: 'run_agent',
            actorId: runAgentId,
            assertionClass: 'participant_reported',
            payload: {
              runAgentId,
              versionId,
              versionNo: 1,
              recipientRunAgentIds: [...input.recipientRunAgentIds],
            },
          });
          const artifact: RunArtifactDto = {
            id: artifactId,
            runId,
            artifactKey: input.artifactKey,
            versionId,
            versionNo: 1,
            artifactType: input.artifactType,
            title: input.title,
            content: canonicalize(
              input.content,
            ) as CreateRunArtifactRequest['content'],
            contentHash: hash(input.content),
            authorType: 'RUN_AGENT',
            authorId: runAgentId,
            recipientRunAgentIds: [...input.recipientRunAgentIds],
            createdRunSeq: event.runSeq,
            createdAt: this.timestamp(),
          };
          stored.artifacts.set(artifact.id, artifact);
          stored.artifactVersions.set(artifact.versionId, artifact);
          for (const recipientId of input.recipientRunAgentIds) {
            this.addEligible(stored, recipientId, artifact, event, 'artifact');
          }
          return { artifact };
        },
      ),
    );
  }

  createArtifactVersion(
    principal: ParticipantPrincipal,
    runAgentId: string,
    artifactId: string,
    idempotencyKey: string,
    input: CreateArtifactVersionRequest,
  ): Promise<{ readonly artifact: RunArtifactDto }> {
    return Promise.resolve(
      this.idempotent(
        runAgentId,
        `artifact:${artifactId}:version:create`,
        idempotencyKey,
        input,
        () => {
          const stored = this.runContainingArtifact(artifactId);
          this.runForAgent(principal, stored.run.id, runAgentId);
          this.assertRunning(stored);
          const current = stored.artifacts.get(artifactId)!;
          if (
            current.authorId !== runAgentId &&
            !this.hasIssuedResource(
              stored,
              runAgentId,
              'artifact',
              artifactId,
              input.baseVersionId,
            )
          ) {
            throw new ExerciseServiceError(
              'RESOURCE_NOT_ISSUED',
              '只能基于本人已收到的 ArtifactVersion 创建新版本。 / A new version must be based on an ArtifactVersion issued to this RunAgent.',
            );
          }
          if (current.versionId !== input.baseVersionId) {
            throw new ExerciseServiceError(
              'ARTIFACT_BASE_CONFLICT',
              'baseVersionId 不是当前版本；不会静默覆盖。 / baseVersionId is not current; the service will not overwrite silently.',
              { currentVersionId: current.versionId },
            );
          }
          this.assertRecipientSnapshot(stored, input.recipientRunAgentIds);
          const versionId = this.#idFactory();
          const event = this.appendRunEvent(stored, {
            streamType: 'artifact',
            streamId: artifactId,
            eventType: 'artifact.version-published',
            actorType: 'run_agent',
            actorId: runAgentId,
            assertionClass: 'participant_reported',
            payload: {
              runAgentId,
              versionId,
              baseVersionId: input.baseVersionId,
              versionNo: current.versionNo + 1,
              recipientRunAgentIds: [...input.recipientRunAgentIds],
            },
          });
          const artifact: RunArtifactDto = {
            ...current,
            versionId,
            versionNo: current.versionNo + 1,
            baseVersionId: input.baseVersionId,
            content: canonicalize(
              input.content,
            ) as CreateArtifactVersionRequest['content'],
            contentHash: hash(input.content),
            authorType: 'RUN_AGENT',
            authorId: runAgentId,
            recipientRunAgentIds: [...input.recipientRunAgentIds],
            createdRunSeq: event.runSeq,
            createdAt: this.timestamp(),
          };
          stored.artifacts.set(artifact.id, artifact);
          stored.artifactVersions.set(artifact.versionId, artifact);
          for (const recipientId of input.recipientRunAgentIds) {
            this.addEligible(stored, recipientId, artifact, event, 'artifact');
          }
          return { artifact };
        },
      ),
    );
  }

  endorseSubmission(
    principal: ParticipantPrincipal,
    runAgentId: string,
    submissionId: string,
    idempotencyKey: string,
    input: CreateSubmissionEndorsementRequest,
  ): Promise<{
    readonly endorsement: SubmissionEndorsementDto;
    readonly actionGrant: FeedbackActionGrantDto;
  }> {
    return Promise.resolve(
      this.idempotent(
        runAgentId,
        `submission:${submissionId}:endorsement:create`,
        idempotencyKey,
        input,
        () => {
          const { stored, submission } =
            this.runContainingSubmission(submissionId);
          this.runForAgent(principal, stored.run.id, runAgentId);
          const nextGrant = this.consumeGrant(
            stored,
            runAgentId,
            input.feedbackActionGrantId,
            submission.taskId,
            'endorse',
            submission.id,
          );
          if (
            !this.hasIssuedGrant(
              stored,
              runAgentId,
              input.feedbackActionGrantId,
            )
          ) {
            throw new ExerciseServiceError(
              'RESOURCE_NOT_ISSUED',
              'ActionGrant 必须先通过 /sync Receipt 发放。 / The ActionGrant must first be issued by a /sync Receipt.',
            );
          }
          if (
            [...stored.endorsements.values()].some(
              (endorsement) =>
                endorsement.submissionId === submissionId &&
                endorsement.endorserRunAgentId === runAgentId,
            )
          ) {
            throw new ExerciseServiceError(
              'SUBMISSION_CONFLICT',
              '该 RunAgent 已 endorsement 此 Submission。 / This RunAgent already endorsed the Submission.',
            );
          }
          stored.actionGrants.set(nextGrant.id, nextGrant);
          this.appendGrantConsumedEvent(stored, runAgentId, nextGrant);
          const endorsedAt = this.timestamp();
          const endorsementId = this.#idFactory();
          const event = this.appendRunEvent(stored, {
            streamType: 'endorsement',
            streamId: endorsementId,
            eventType: 'submission.endorsed',
            actorType: 'run_agent',
            actorId: runAgentId,
            assertionClass: 'participant_reported',
            payload: {
              runAgentId,
              submissionId,
              feedbackActionGrantId: nextGrant.id,
            },
          });
          const endorsement: SubmissionEndorsementDto = {
            id: endorsementId,
            runId: stored.run.id,
            submissionId,
            endorserRunAgentId: runAgentId,
            feedbackActionGrantId: nextGrant.id,
            endorsedAt,
            createdRunSeq: event.runSeq,
          };
          stored.endorsements.set(endorsement.id, endorsement);
          return { endorsement, actionGrant: nextGrant };
        },
      ),
    );
  }

  listRunEvents(
    principal: ParticipantPrincipal,
    runId: string,
    after: number,
    limit: number,
  ): Promise<readonly RunEventDto[]> {
    const stored = this.ownedRun(principal, runId);
    return Promise.resolve(
      stored.events.filter(({ runSeq }) => runSeq > after).slice(0, limit),
    );
  }

  getReplay(
    principal: ParticipantPrincipal,
    runId: string,
    query: ReplayQuery,
  ): Promise<ReplayResponseDto> {
    const stored = principal.roles?.includes('operator')
      ? this.ownedRun(principal, runId)
      : this.runAgentReplay(principal, runId, query);
    const atRunSeq = Math.min(
      query.atRunSeq ?? stored.events.length,
      stored.events.length,
    );
    const visibleRunAgentIds = this.replayRunAgentIds(stored, query);
    const allEvents = stored.events.filter(({ runSeq }) => runSeq <= atRunSeq);
    const runAgents = [...stored.runAgents.values()]
      .filter(
        ({ dto, joinedRunSeq }) =>
          joinedRunSeq <= atRunSeq && visibleRunAgentIds.has(dto.id),
      )
      .map(({ dto }) => dto);
    const roleAssignments = stored.roleAssignments.filter(
      ({ runAgentId, assignedRunSeq }) =>
        assignedRunSeq <= atRunSeq && visibleRunAgentIds.has(runAgentId),
    );
    const events = allEvents.filter((event) =>
      this.eventVisibleTo(event, stored, query, visibleRunAgentIds),
    );
    const receipts = [...stored.receipts.entries()].flatMap(
      ([candidateRunAgentId, candidateReceipts]) => {
        if (query.perspective === 'team') return [];
        if (!visibleRunAgentIds.has(candidateRunAgentId)) return [];
        const acknowledgedThrough = this.acknowledgedThroughAt(
          stored,
          candidateRunAgentId,
          atRunSeq,
        );
        return candidateReceipts.filter(
          ({ agentReceiptSeq, issuedRunSeq }) =>
            issuedRunSeq <= atRunSeq &&
            (query.deliverySemantics !== 'acknowledged' ||
              agentReceiptSeq <= acknowledgedThrough),
        );
      },
    );
    const tasks = this.replayTasksAt(
      stored,
      query,
      visibleRunAgentIds,
      atRunSeq,
      receipts,
    );
    const eligibleResources =
      query.deliverySemantics === 'eligible' && query.perspective !== 'team'
        ? [...stored.eligible.entries()].flatMap(
            ([candidateRunAgentId, disclosures]) => {
              if (!visibleRunAgentIds.has(candidateRunAgentId)) return [];
              const candidateReceipts =
                stored.receipts.get(candidateRunAgentId) ?? [];
              return disclosures
                .filter(({ sourceRunSeq }) => sourceRunSeq <= atRunSeq)
                .map((disclosure) => {
                  const issuedReceipt = candidateReceipts.find(
                    ({ resourceId, issuedRunSeq }) =>
                      resourceId === disclosure.resourceId &&
                      issuedRunSeq <= atRunSeq,
                  );
                  return {
                    runAgentId: candidateRunAgentId,
                    resourceType: disclosure.resourceType,
                    resourceId: disclosure.resourceId,
                    resourceVersion: disclosure.resourceVersion,
                    sourceRunSeq: disclosure.sourceRunSeq,
                    availableVirtualAt: stored.run.virtualTime,
                    ...(issuedReceipt === undefined
                      ? {}
                      : {
                          issuedReceiptSeq: issuedReceipt.agentReceiptSeq,
                        }),
                  };
                });
            },
          )
        : [];
    const scenarioVersion = this.pinnedScenarioVersion(stored);
    const eventChainHead = allEvents.at(-1)?.eventHash ?? ZERO_HASH;
    const receiptChainHeads = Object.fromEntries(
      [...visibleRunAgentIds].map((candidateRunAgentId) => {
        const head = receipts
          .filter(({ runAgentId: id }) => id === candidateRunAgentId)
          .at(-1)?.receiptHash;
        return [candidateRunAgentId, head ?? ZERO_HASH];
      }),
    );
    const runStartedAtCutoff = allEvents.some(
      ({ eventType }) => eventType === 'run.started',
    );
    const runAtCutoff: RunDto = runStartedAtCutoff
      ? stored.run
      : stored.initial;
    const telemetry = this.telemetryOverlay(stored, visibleRunAgentIds);
    return Promise.resolve({
      authoritativeProjection: {
        run: runAtCutoff,
        runAgents,
        roleAssignments,
        tasks,
        events,
        receipts,
        eligibleResources,
        manifest: {
          atRunSeq,
          scenarioVersionHash: scenarioVersion.contentHash!,
          eventChainHead,
          receiptChainHeads,
          verified:
            this.verifyEventChain(allEvents) &&
            this.verifyReceiptChains(
              [...stored.receipts.values()]
                .flat()
                .filter(({ issuedRunSeq }) => issuedRunSeq <= atRunSeq),
            ),
        },
      },
      bestEffortTelemetryOverlay: telemetry,
    });
  }

  close(): Promise<void> {
    this.#closed = true;
    return Promise.resolve();
  }

  private assertRunning(stored: StoredRun): void {
    if (stored.run.state !== 'RUNNING') {
      throw new ExerciseServiceError(
        'RUN_STATE_CONFLICT',
        '该协作命令只允许在 RUNNING Run 执行。 / This collaboration command requires a RUNNING Run.',
      );
    }
  }

  private taskForAgent(
    principal: ParticipantPrincipal,
    runAgentId: string,
    taskId: string,
  ): {
    readonly stored: StoredRun;
    readonly task: DomainRunTask;
    readonly dto: RunTaskDto;
  } {
    const stored = [...this.#runs.values()].find(({ tasks }) =>
      tasks.has(taskId),
    );
    if (stored === undefined) {
      throw new ExerciseServiceError(
        'TASK_NOT_FOUND',
        'Task 不存在。 / The Task does not exist.',
      );
    }
    this.runForAgent(principal, stored.run.id, runAgentId);
    this.assertRunning(stored);
    const dto = stored.tasks.get(taskId)!;
    if (dto.assignedRunAgentId !== runAgentId) {
      throw new ExerciseServiceError(
        'FORBIDDEN',
        "RunAgent 不能操作其他智能体的 Task。 / A RunAgent cannot operate another agent's Task.",
      );
    }
    if (!this.hasIssuedResource(stored, runAgentId, 'task', taskId)) {
      throw new ExerciseServiceError(
        'RESOURCE_NOT_ISSUED',
        'Task 必须先通过 /sync Receipt 发放。 / The Task must first be issued by a /sync Receipt.',
      );
    }
    const task = stored.taskStates.get(taskId);
    if (task === undefined) {
      throw new ExerciseServiceError(
        'INTERNAL_ERROR',
        'Task domain state is missing.',
      );
    }
    return { stored, task, dto };
  }

  private leaseCommand(
    input: TaskLeaseCommandRequest,
    runAgentId: string,
  ): {
    readonly expectedVersion: number;
    readonly runAgentId: string;
    readonly claimEpoch: number;
    readonly leaseTokenHash: string;
    readonly now: string;
  } {
    return {
      expectedVersion: input.expectedVersion,
      runAgentId,
      claimEpoch: input.claimEpoch,
      leaseTokenHash: hash(input.leaseToken),
      now: this.timestamp(),
    };
  }

  private recordTaskTransition(
    stored: StoredRun,
    task: DomainRunTask,
    runAgentId: string,
    eventType: string,
  ): RunTaskDto {
    stored.taskStates.set(task.id, task);
    const dto = this.updateTaskDto(stored, task);
    const event = this.appendRunEvent(stored, {
      streamType: 'task',
      streamId: task.id,
      eventType,
      actorType: 'run_agent',
      actorId: runAgentId,
      assertionClass: 'platform_observed',
      payload: {
        runAgentId,
        state: task.state,
        taskVersion: task.version,
        claimEpoch: task.claimEpoch,
        ...(task.activeClaim === undefined
          ? {}
          : { leaseExpiresAt: task.activeClaim.leaseExpiresAt }),
      },
    });
    this.addEligible(stored, runAgentId, dto, event, 'task');
    return dto;
  }

  private updateTaskDto(stored: StoredRun, task: DomainRunTask): RunTaskDto {
    const current = stored.tasks.get(task.id);
    if (current === undefined) {
      throw new ExerciseServiceError(
        'INTERNAL_ERROR',
        'Task projection is missing.',
      );
    }
    const next: RunTaskDto = {
      id: current.id,
      runId: current.runId,
      roleSlotId: current.roleSlotId,
      assignedRunAgentId: current.assignedRunAgentId,
      definitionKey: current.definitionKey,
      title: current.title,
      objective: current.objective,
      state: task.state,
      lockVersion: task.version,
      claimEpoch: task.claimEpoch,
      createdRunSeq: current.createdRunSeq,
      ...(task.activeClaim === undefined
        ? {}
        : {
            claimedByRunAgentId: task.activeClaim.runAgentId,
            leaseExpiresAt: task.activeClaim.leaseExpiresAt,
          }),
    };
    stored.tasks.set(task.id, next);
    return next;
  }

  private hasIssuedResource(
    stored: StoredRun,
    runAgentId: string,
    resourceType: ResourceType,
    resourceId: string,
    resourceVersion?: string,
  ): boolean {
    return (stored.receipts.get(runAgentId) ?? []).some(
      (receipt) =>
        receipt.resourceType === resourceType &&
        receipt.resourceId === resourceId &&
        (resourceVersion === undefined ||
          receipt.resourceVersion === resourceVersion),
    );
  }

  private assertSubmissionReferences(
    stored: StoredRun,
    runAgentId: string,
    input: CreateTaskSubmissionRequest,
  ): void {
    const receipts = stored.receipts.get(runAgentId) ?? [];
    for (const reference of input.receiptRefs) {
      const receipt = receipts.find(({ id }) => id === reference.receiptId);
      if (
        receipt === undefined ||
        receipt.receiptHash !== reference.receiptHash
      ) {
        throw new ExerciseServiceError(
          'RECEIPT_REFERENCE_CONFLICT',
          "Submission 只能引用本人已发放且哈希匹配的 Receipt。 / A Submission may cite only this agent's issued Receipt with a matching hash.",
        );
      }
    }
    for (const reference of input.artifactVersionRefs) {
      const receipt = receipts.find(
        (candidate) =>
          candidate.resourceType === 'artifact' &&
          candidate.resourceId === reference.artifactId &&
          candidate.resourceVersion === reference.artifactVersionId,
      );
      const snapshotContentHash = receipt?.contentSnapshot.contentHash;
      if (
        receipt === undefined ||
        snapshotContentHash !== reference.contentHash
      ) {
        throw new ExerciseServiceError(
          'RECEIPT_REFERENCE_CONFLICT',
          "ArtifactVersion 引用必须来自本人已发放的 Receipt 且内容哈希匹配。 / An ArtifactVersion reference must come from this agent's issued Receipt with a matching content hash.",
        );
      }
    }
  }

  private assertRecipientSnapshot(
    stored: StoredRun,
    recipientRunAgentIds: readonly string[],
    excludedRunAgentId?: string,
  ): void {
    for (const recipientId of recipientRunAgentIds) {
      if (recipientId === excludedRunAgentId) {
        throw new ExerciseServiceError(
          'FORBIDDEN',
          'Endorsement 收件人不能是提交者本人。 / An endorsement recipient cannot be the submitter.',
        );
      }
      this.ownedRunAgent(stored, recipientId);
    }
  }

  private runContainingArtifact(artifactId: string): StoredRun {
    const stored = [...this.#runs.values()].find(({ artifacts }) =>
      artifacts.has(artifactId),
    );
    if (stored === undefined) {
      throw new ExerciseServiceError(
        'ARTIFACT_NOT_FOUND',
        'Artifact 不存在。 / The Artifact does not exist.',
      );
    }
    return stored;
  }

  private runContainingSubmission(submissionId: string): {
    readonly stored: StoredRun;
    readonly submission: RunSubmissionDto;
  } {
    const stored = [...this.#runs.values()].find(({ submissions }) =>
      submissions.has(submissionId),
    );
    const submission = stored?.submissions.get(submissionId);
    if (stored === undefined || submission === undefined) {
      throw new ExerciseServiceError(
        'SUBMISSION_NOT_FOUND',
        'Submission 不存在。 / The Submission does not exist.',
      );
    }
    return { stored, submission };
  }

  private issueEndorsementGrants(
    stored: StoredRun,
    submission: RunSubmissionDto,
  ): void {
    for (const recipientRunAgentId of submission.endorsementRecipientRunAgentIds) {
      const feedbackId = this.#idFactory();
      const evaluationId = this.#idFactory();
      const grantId = this.#idFactory();
      const scopeHash = hash({
        targetRunAgentId: recipientRunAgentId,
        targetTaskId: submission.taskId,
        action: 'endorse',
        predecessorSubmissionId: submission.id,
        evaluationId,
      });
      const issuedAt = this.timestamp();
      const event = this.appendRunEvent(stored, {
        streamType: 'feedback',
        streamId: feedbackId,
        eventType: 'feedback-action-grant.issued',
        actorType: 'system',
        actorId: 'excon',
        assertionClass: 'evaluator_derived',
        payload: {
          runAgentId: recipientRunAgentId,
          feedbackActionGrantId: grantId,
          targetTaskId: submission.taskId,
          predecessorSubmissionId: submission.id,
          action: 'endorse',
        },
      });
      const grant = createFeedbackActionGrant({
        id: grantId,
        targetRunAgentId: recipientRunAgentId,
        targetTaskId: submission.taskId,
        action: 'endorse',
        predecessorSubmissionId: submission.id,
        evaluationId,
        issuedRunSeq: event.runSeq,
        issuedAt,
        expiresAt: this.addSeconds(issuedAt, 24 * 60 * 60),
        maxUses: 1,
        scopeHash,
      });
      stored.actionGrants.set(grant.id, grant);
      const feedback: RunFeedbackDto = {
        id: feedbackId,
        runId: stored.run.id,
        targetScope: 'individual',
        recipientRunAgentIds: [recipientRunAgentId],
        basisType: 'evaluation',
        summary: {
          'zh-CN': '团队提交正在收集明确 endorsement。',
          en: 'The team submission is collecting explicit endorsements.',
        },
        guidance: [
          {
            'zh-CN': '核对提交引用后，仅使用本反馈中不可转让的 ActionGrant。',
            en: 'Check the cited evidence, then use only the non-transferable ActionGrant in this feedback.',
          },
        ],
        allowedActions: ['endorse'],
        subjectSubmissionId: submission.id,
        actionGrants: [grant],
        createdRunSeq: event.runSeq,
        createdAt: issuedAt,
      };
      stored.feedback.set(feedback.id, feedback);
      this.addEligible(
        stored,
        recipientRunAgentId,
        feedback,
        event,
        'feedback',
      );
    }
  }

  private consumeGrant(
    stored: StoredRun,
    runAgentId: string,
    grantId: string,
    taskId: string,
    action: 'resubmit' | 'endorse',
    predecessorSubmissionId: string,
  ): FeedbackActionGrant {
    const grant = stored.actionGrants.get(grantId);
    if (grant === undefined) {
      throw new ExerciseServiceError(
        'FEEDBACK_GRANT_NOT_FOUND',
        'Feedback ActionGrant 不存在。 / The Feedback ActionGrant does not exist.',
      );
    }
    const commandScopeHash = hash({
      targetRunAgentId: runAgentId,
      targetTaskId: taskId,
      action,
      predecessorSubmissionId,
      evaluationId: grant.evaluationId,
    });
    const next = consumeFeedbackActionGrant(grant, {
      expectedVersion: grant.version,
      runAgentId,
      taskId,
      action,
      predecessorSubmissionId,
      evaluationId: grant.evaluationId,
      scopeHash: commandScopeHash,
      now: this.timestamp(),
      virtualTime: stored.run.virtualTime,
    });
    if (!this.hasIssuedGrant(stored, runAgentId, grantId)) {
      throw new ExerciseServiceError(
        'RESOURCE_NOT_ISSUED',
        'ActionGrant 必须先通过 /sync Receipt 发放。 / The ActionGrant must first be issued by a /sync Receipt.',
      );
    }
    return next;
  }

  private hasIssuedGrant(
    stored: StoredRun,
    runAgentId: string,
    grantId: string,
  ): boolean {
    return (stored.receipts.get(runAgentId) ?? []).some((receipt) => {
      if (receipt.resourceType !== 'feedback') return false;
      const snapshot = receipt.contentSnapshot as {
        readonly actionGrants?: readonly FeedbackActionGrantDto[];
      };
      return snapshot.actionGrants?.some(({ id }) => id === grantId) ?? false;
    });
  }

  private appendGrantConsumedEvent(
    stored: StoredRun,
    runAgentId: string,
    grant: FeedbackActionGrant,
  ): void {
    this.appendRunEvent(stored, {
      streamType: 'feedback',
      streamId: grant.id,
      eventType: 'feedback-action-grant.consumed',
      actorType: 'run_agent',
      actorId: runAgentId,
      assertionClass: 'platform_observed',
      payload: {
        runAgentId,
        feedbackActionGrantId: grant.id,
        usedCount: grant.usedCount,
        version: grant.version,
      },
    });
  }

  private addSeconds(timestamp: string, seconds: number): string {
    return new Date(Date.parse(timestamp) + seconds * 1_000).toISOString();
  }

  private seedYongdingScenario(): void {
    const createdAt = '2026-08-20T00:00:00.000Z';
    const base = {
      id: DEFAULT_V2_SCENARIO_VERSION_ID,
      scenarioId: DEFAULT_V2_SCENARIO_ID,
      label: 'v2.0.0',
      summary: {
        'zh-CN': '2023 京津冀永定河四角色联合调度演练',
        en: '2023 Jing-Jin-Ji Yongding four-role joint dispatch exercise',
      },
      replayStartAt: '2023-03-22T07:00:00.000Z',
      requiredRoles: [...defaultRoles],
      minDistinctRequiredAgents: 4,
    };
    const scenarioVersion: ScenarioVersionDetailDto = {
      ...base,
      lifecycle: 'PUBLISHED',
      contentHash: hash(base),
      validation: {
        status: 'VALID',
        errors: [],
        validatedAt: createdAt,
      },
      version: 1,
      createdAt,
      updatedAt: createdAt,
      publishedAt: createdAt,
    };
    this.#scenarioVersions.set(scenarioVersion.id, scenarioVersion);
    this.#scenarios.set(DEFAULT_V2_SCENARIO_ID, {
      id: DEFAULT_V2_SCENARIO_ID,
      slug: DEFAULT_V2_SCENARIO_ID,
      ownerId: 'system',
      title: {
        'zh-CN': '2023 京津冀永定河生态补水与多水源联合调度',
        en: '2023 Jing-Jin-Ji Yongding ecological replenishment and multi-source dispatch',
      },
      description: {
        'zh-CN':
          '四个外部智能体通过 Skill + HTTP/MCP 并行参训的事实锚定合成案例。',
        en: 'A fact-anchored synthetic case for four external agents training in parallel through Skill + HTTP/MCP.',
      },
      region: { 'zh-CN': '京津冀·永定河', en: 'Jing-Jin-Ji · Yongding River' },
      simulationOnly: true,
      lifecycle: 'PUBLISHED',
      currentVersionId: DEFAULT_V2_SCENARIO_VERSION_ID,
      version: 1,
      versionIds: [DEFAULT_V2_SCENARIO_VERSION_ID],
      updatedAt: createdAt,
    });
  }

  private createInitialResources(
    stored: StoredRun,
    role: RoleDefinitionDto,
    runAgentId: string,
  ): void {
    const createdAt = this.timestamp();
    const taskId = this.#idFactory();
    const taskEvent = this.appendRunEvent(stored, {
      streamType: 'task',
      streamId: taskId,
      eventType: 'task.ready',
      actorType: 'system',
      actorId: 'excon',
      assertionClass: 'platform_observed',
      payload: { roleSlotId: role.id, assignedRunAgentId: runAgentId },
    });
    const task: RunTaskDto = {
      id: taskId,
      runId: stored.run.id,
      roleSlotId: role.id,
      assignedRunAgentId: runAgentId,
      definitionKey: `analyze-${role.id}`,
      title: role.name,
      objective: role.mission,
      state: 'READY',
      lockVersion: 1,
      claimEpoch: 0,
      createdRunSeq: taskEvent.runSeq,
    };
    stored.tasks.set(task.id, task);
    stored.taskStates.set(
      task.id,
      createRunTask({
        id: task.id,
        runId: stored.run.id,
        initialState: 'READY',
        reassignable: true,
      }),
    );
    this.addEligible(stored, runAgentId, task, taskEvent, 'task');

    const messageId = this.#idFactory();
    const messageEvent = this.appendRunEvent(stored, {
      streamType: 'message',
      streamId: messageId,
      eventType: 'message.created',
      actorType: 'system',
      actorId: 'excon',
      assertionClass: 'platform_observed',
      payload: { recipientRunAgentIds: [runAgentId] },
    });
    const message: RunMessageDto = {
      id: messageId,
      runId: stored.run.id,
      senderType: 'EXCON',
      senderId: 'excon',
      recipientRunAgentIds: [runAgentId],
      subject: {
        'zh-CN': `${role.name['zh-CN']}角色简报`,
        en: `${role.name.en} role briefing`,
      },
      body: {
        'zh-CN':
          '只有通过 Receipt 发放的内容和明确共享工件才能进入你的证据集。',
        en: 'Only receipted content and explicitly shared artifacts may enter your evidence set.',
      },
      createdRunSeq: messageEvent.runSeq,
      createdAt,
    };
    stored.messages.set(message.id, message);
    this.addEligible(stored, runAgentId, message, messageEvent, 'message');

    const artifactId = this.#idFactory();
    const artifactEvent = this.appendRunEvent(stored, {
      streamType: 'artifact',
      streamId: artifactId,
      eventType: 'artifact.published',
      actorType: 'system',
      actorId: 'excon',
      assertionClass: 'platform_observed',
      payload: { roleSlotId: role.id, recipientRunAgentIds: [runAgentId] },
    });
    const content = {
      'zh-CN': `交付目标：${role.expectedArtifact['zh-CN']}`,
      en: `Expected artifact: ${role.expectedArtifact.en}`,
    };
    const artifact: RunArtifactDto = {
      id: artifactId,
      runId: stored.run.id,
      artifactKey: `role-brief-${role.id}`,
      versionId: this.#idFactory(),
      versionNo: 1,
      artifactType: 'role-brief',
      title: role.expectedArtifact,
      content,
      contentHash: hash(content),
      authorType: 'EXCON',
      authorId: 'excon',
      recipientRunAgentIds: [runAgentId],
      createdRunSeq: artifactEvent.runSeq,
      createdAt,
    };
    stored.artifacts.set(artifact.id, artifact);
    stored.artifactVersions.set(artifact.versionId, artifact);
    this.addEligible(stored, runAgentId, artifact, artifactEvent, 'artifact');

    const feedbackId = this.#idFactory();
    const feedbackEvent = this.appendRunEvent(stored, {
      streamType: 'feedback',
      streamId: feedbackId,
      eventType: 'feedback.created',
      actorType: 'system',
      actorId: 'excon',
      assertionClass: 'platform_observed',
      payload: {
        targetScope: 'individual',
        recipientRunAgentIds: [runAgentId],
      },
    });
    const feedback: RunFeedbackDto = {
      id: feedbackId,
      runId: stored.run.id,
      targetScope: 'individual',
      recipientRunAgentIds: [runAgentId],
      basisType: 'readiness',
      summary: {
        'zh-CN': '角色分配已通过就绪检查。',
        en: 'The role assignment passed its readiness check.',
      },
      guidance: [
        {
          'zh-CN': '先认领你的独立 Task，再通过 Message/Artifact 显式协作。',
          en: 'Claim your independent task before collaborating through explicit messages and artifacts.',
        },
      ],
      allowedActions: ['claim_task', 'request_clarification'],
      createdRunSeq: feedbackEvent.runSeq,
      createdAt,
    };
    stored.feedback.set(feedback.id, feedback);
    this.addEligible(stored, runAgentId, feedback, feedbackEvent, 'feedback');
  }

  private addEligible(
    stored: StoredRun,
    runAgentId: string,
    resource: IssuedRunResource,
    sourceEvent: RunEventDto,
    resourceType: ResourceType,
  ): void {
    const viewKind =
      resourceType === 'task'
        ? 'task_assignment'
        : resourceType === 'artifact'
          ? 'artifact_grant'
          : resourceType;
    stored.eligible.get(runAgentId)!.push({
      resourceType,
      viewKind,
      resourceId: resource.id,
      resourceVersion:
        resourceType === 'task'
          ? String((resource as RunTaskDto).lockVersion)
          : resourceType === 'artifact'
            ? (resource as RunArtifactDto).versionId
            : '1',
      sourceEventId: sourceEvent.eventId,
      sourceRunSeq: sourceEvent.runSeq,
      contentSnapshot: canonicalize(resource) as IssuedRunResource,
      contentHash: hash(resource),
    });
  }

  private acknowledgeReceipts(
    stored: StoredRun,
    runAgentId: string,
    throughReceiptSeq: number,
    headHash: string,
  ): void {
    const receipts = stored.receipts.get(runAgentId)!;
    const expected = receipts[throughReceiptSeq - 1];
    if (
      expected === undefined ||
      expected.receiptHash !== headHash ||
      throughReceiptSeq !== receipts.length
    ) {
      throw new ExerciseServiceError(
        'RECEIPT_CHAIN_CONFLICT',
        '确认的 Receipt 序号与 chain head 不匹配。 / The acknowledged receipt sequence and chain head do not match.',
      );
    }
    const previous = stored.acknowledgements.get(runAgentId)!.at(-1);
    if (
      previous?.throughReceiptSeq === throughReceiptSeq &&
      previous.headHash === headHash
    ) {
      return;
    }
    const event = this.appendRunEvent(stored, {
      streamType: 'receipt',
      streamId: runAgentId,
      eventType: 'receipt.acknowledged',
      actorType: 'run_agent',
      actorId: runAgentId,
      assertionClass: 'participant_reported',
      payload: { throughReceiptSeq, headHash },
    });
    stored.acknowledgements.get(runAgentId)!.push({
      throughReceiptSeq,
      headHash,
      acknowledgedRunSeq: event.runSeq,
    });
  }

  private appendRunEvent(
    stored: StoredRun,
    input: Pick<
      RunEventDto,
      | 'streamType'
      | 'streamId'
      | 'eventType'
      | 'actorType'
      | 'actorId'
      | 'assertionClass'
      | 'payload'
    >,
  ): RunEventDto {
    const timestamp = this.timestamp();
    const base = {
      eventId: this.#idFactory(),
      runId: stored.run.id,
      runSeq: stored.events.length + 1,
      ...input,
      virtualTime: stored.run.virtualTime,
      occurredAt: timestamp,
      recordedAt: timestamp,
      schemaVersion: 1 as const,
      payloadHash: hash(input.payload),
      previousHash: stored.eventHeadHash,
    };
    const event: RunEventDto = { ...base, eventHash: hash(base) };
    stored.events.push(event);
    stored.eventHeadHash = event.eventHash;
    return event;
  }

  private resource(
    stored: StoredRun,
    disclosure: EligibleDisclosure,
  ): IssuedRunResource {
    void stored;
    return disclosure.contentSnapshot;
  }

  private replayRunAgentIds(
    stored: StoredRun,
    query: ReplayQuery,
  ): Set<string> {
    if (query.perspective === 'operator' || query.perspective === 'team') {
      return new Set(stored.runAgents.keys());
    }
    if (query.perspective === 'agent') {
      this.ownedRunAgent(stored, query.subjectId!);
      return new Set([query.subjectId!]);
    }
    return new Set(
      [...stored.runAgents.values()]
        .filter(({ dto }) => dto.roleSlotId === query.subjectId)
        .map(({ dto }) => dto.id),
    );
  }

  private replayTasksAt(
    stored: StoredRun,
    query: ReplayQuery,
    visibleRunAgentIds: ReadonlySet<string>,
    atRunSeq: number,
    visibleReceipts: readonly AgentViewReceiptDto[],
  ): RunTaskDto[] {
    if (query.perspective === 'team') return [];
    const snapshots = new Map<
      string,
      { readonly task: RunTaskDto; readonly evidenceRunSeq: number }
    >();
    const consider = (value: unknown, evidenceRunSeq: number): void => {
      const parsed = RunTaskSchema.safeParse(value);
      if (
        !parsed.success ||
        !visibleRunAgentIds.has(parsed.data.assignedRunAgentId)
      ) {
        return;
      }
      const previous = snapshots.get(parsed.data.id);
      if (previous === undefined || evidenceRunSeq > previous.evidenceRunSeq) {
        snapshots.set(parsed.data.id, { task: parsed.data, evidenceRunSeq });
      }
    };

    if (query.perspective === 'operator') {
      for (const [runAgentId, disclosures] of stored.eligible) {
        if (!visibleRunAgentIds.has(runAgentId)) continue;
        for (const disclosure of disclosures) {
          if (
            disclosure.resourceType === 'task' &&
            disclosure.sourceRunSeq <= atRunSeq
          ) {
            consider(disclosure.contentSnapshot, disclosure.sourceRunSeq);
          }
        }
      }
    } else {
      for (const receipt of visibleReceipts) {
        if (
          receipt.resourceType === 'task' &&
          receipt.issuedRunSeq <= atRunSeq
        ) {
          consider(receipt.contentSnapshot, receipt.issuedRunSeq);
        }
      }
    }

    return [...snapshots.values()]
      .map(({ task }) => task)
      .sort(
        (left, right) =>
          left.createdRunSeq - right.createdRunSeq ||
          left.id.localeCompare(right.id),
      );
  }

  private eventVisibleTo(
    event: RunEventDto,
    stored: StoredRun,
    query: ReplayQuery,
    visibleRunAgentIds: ReadonlySet<string>,
  ): boolean {
    if (query.perspective === 'operator') return true;
    if (query.perspective === 'team') {
      if (event.streamType === 'run' || event.streamType === 'run_agent') {
        return true;
      }
      if (event.streamType === 'message') {
        const message = stored.messages.get(event.streamId);
        return (
          message !== undefined &&
          message.recipientRunAgentIds.length === stored.runAgents.size
        );
      }
      if (event.streamType === 'artifact') {
        const artifact = stored.artifacts.get(event.streamId);
        return (
          artifact !== undefined &&
          (artifact.recipientRunAgentIds ?? []).length === stored.runAgents.size
        );
      }
      if (event.streamType === 'feedback') {
        return stored.feedback.get(event.streamId)?.targetScope === 'team';
      }
      if (event.streamType === 'submission') {
        return stored.submissions.get(event.streamId)?.targetScope === 'team';
      }
      return false;
    }
    if (event.streamType === 'run') return true;
    if (event.streamType === 'run_agent') {
      return visibleRunAgentIds.has(event.streamId);
    }
    if (event.streamType === 'task') {
      const task = stored.tasks.get(event.streamId);
      return (
        task !== undefined && visibleRunAgentIds.has(task.assignedRunAgentId)
      );
    }
    if (event.streamType === 'message') {
      const message = stored.messages.get(event.streamId);
      return Boolean(
        message !== undefined &&
        ((message.senderType === 'RUN_AGENT' &&
          visibleRunAgentIds.has(message.senderId)) ||
          message.recipientRunAgentIds.some((id) =>
            visibleRunAgentIds.has(id),
          )),
      );
    }
    if (event.streamType === 'feedback') {
      const feedback = stored.feedback.get(event.streamId);
      if (feedback !== undefined) {
        return feedback.recipientRunAgentIds.some((id) =>
          visibleRunAgentIds.has(id),
        );
      }
      const payloadRunAgentId = event.payload.runAgentId;
      return (
        typeof payloadRunAgentId === 'string' &&
        visibleRunAgentIds.has(payloadRunAgentId)
      );
    }
    if (event.streamType === 'artifact') {
      const artifact = stored.artifacts.get(event.streamId);
      return Boolean(
        artifact !== undefined &&
        ((artifact.authorType === 'RUN_AGENT' &&
          visibleRunAgentIds.has(artifact.authorId)) ||
          (artifact.recipientRunAgentIds ?? []).some((id) =>
            visibleRunAgentIds.has(id),
          )),
      );
    }
    const payloadRunAgentId = event.payload.runAgentId;
    return (
      (typeof payloadRunAgentId === 'string' &&
        visibleRunAgentIds.has(payloadRunAgentId)) ||
      visibleRunAgentIds.has(event.streamId)
    );
  }

  private acknowledgedThroughAt(
    stored: StoredRun,
    runAgentId: string,
    atRunSeq: number,
  ): number {
    return (
      (stored.acknowledgements.get(runAgentId) ?? [])
        .filter(({ acknowledgedRunSeq }) => acknowledgedRunSeq <= atRunSeq)
        .at(-1)?.throughReceiptSeq ?? 0
    );
  }

  private telemetryOverlay(
    stored: StoredRun,
    visibleRunAgentIds: ReadonlySet<string>,
  ): BestEffortTelemetryOverlayDto {
    const modes = [...visibleRunAgentIds].map((runAgentId) => {
      const runAgent = stored.runAgents.get(runAgentId)!.dto;
      return this.#agentVersions.get(runAgent.agentVersionId)!.telemetryMode;
    });
    const participantTelemetryMode =
      modes.length > 0 && modes.every((mode) => mode === 'instrumented')
        ? 'instrumented'
        : modes.some((mode) => mode !== 'none')
          ? 'partial'
          : 'none';
    return {
      bestEffort: true,
      gap: true,
      traces: [],
      coverage: {
        boundaryCoverage: stored.run.state === 'RUNNING' ? 1 : 0,
        participantTelemetryMode,
        droppedSpanCount: 0,
        lateSpanCount: 0,
      },
      trust: {
        platformObservedSpanCount: 0,
        participantReportedSpanCount: 0,
      },
    };
  }

  private verifyEventChain(events: readonly RunEventDto[]): boolean {
    let previousHash = ZERO_HASH;
    for (const event of events) {
      if (event.previousHash !== previousHash) return false;
      if (hash({ ...event, eventHash: undefined }) !== event.eventHash) {
        return false;
      }
      previousHash = event.eventHash;
    }
    return true;
  }

  private verifyReceiptChains(
    receipts: readonly AgentViewReceiptDto[],
  ): boolean {
    const byAgent = new Map<string, AgentViewReceiptDto[]>();
    for (const receipt of receipts) {
      const scoped = byAgent.get(receipt.runAgentId) ?? [];
      scoped.push(receipt);
      byAgent.set(receipt.runAgentId, scoped);
    }
    for (const scoped of byAgent.values()) {
      scoped.sort(
        (left, right) => left.agentReceiptSeq - right.agentReceiptSeq,
      );
      let previousHash = ZERO_HASH;
      let expectedSequence = 1;
      for (const receipt of scoped) {
        if (
          receipt.agentReceiptSeq !== expectedSequence ||
          receipt.previousReceiptHash !== previousHash
        ) {
          return false;
        }
        if (
          hash({ ...receipt, receiptHash: undefined }) !== receipt.receiptHash
        ) {
          return false;
        }
        previousHash = receipt.receiptHash;
        expectedSequence += 1;
      }
    }
    return true;
  }

  private publicStoredScenario(scenarioId: string): StoredScenario {
    const scenario =
      this.#scenarios.get(scenarioId) ??
      [...this.#scenarios.values()].find(({ slug }) => slug === scenarioId);
    if (
      scenario === undefined ||
      scenario.lifecycle === 'DRAFT' ||
      scenario.currentVersionId === undefined
    ) {
      throw this.scenarioNotFound();
    }
    return scenario;
  }

  private ownedScenario(
    principal: ParticipantPrincipal,
    scenarioId: string,
  ): StoredScenario {
    const scenario = this.#scenarios.get(scenarioId);
    if (scenario === undefined || scenario.ownerId !== principal.id) {
      throw this.scenarioNotFound();
    }
    return scenario;
  }

  private ownedScenarioVersion(
    principal: ParticipantPrincipal,
    scenarioVersionId: string,
  ): ScenarioVersionDetailDto {
    const version = this.#scenarioVersions.get(scenarioVersionId);
    if (version === undefined) {
      throw new ExerciseServiceError(
        'SCENARIO_VERSION_NOT_FOUND',
        '场景版本不存在或无权访问。 / The scenario version does not exist or is not accessible.',
      );
    }
    this.ownedScenario(principal, version.scenarioId);
    return version;
  }

  private publicScenario(scenario: StoredScenario): PublicScenarioSummaryDto {
    const current = this.#scenarioVersions.get(scenario.currentVersionId!)!;
    return {
      id: scenario.id,
      slug: scenario.slug,
      title: scenario.title,
      description: scenario.description,
      region: scenario.region,
      simulationOnly: true,
      lifecycle: scenario.lifecycle === 'RETIRED' ? 'RETIRED' : 'PUBLISHED',
      currentVersionId: current.id,
      publishedVersionCount: scenario.versionIds.filter(
        (id) => this.#scenarioVersions.get(id)?.lifecycle !== 'DRAFT',
      ).length,
      requiredRoleCount: current.requiredRoles.length,
      minDistinctRequiredAgents: current.minDistinctRequiredAgents,
    };
  }

  private publicScenarioVersion(
    version: ScenarioVersionDetailDto,
  ): PublicScenarioVersionDetailDto {
    if (
      version.lifecycle === 'DRAFT' ||
      version.contentHash === undefined ||
      version.publishedAt === undefined
    ) {
      throw new ExerciseServiceError(
        'SCENARIO_VERSION_NOT_FOUND',
        '已发布场景版本不存在。 / The published scenario version does not exist.',
      );
    }
    return {
      id: version.id,
      scenarioId: version.scenarioId,
      label: version.label,
      summary: version.summary,
      lifecycle: version.lifecycle,
      replayStartAt: version.replayStartAt,
      requiredRoles: version.requiredRoles,
      minDistinctRequiredAgents: version.minDistinctRequiredAgents,
      contentHash: version.contentHash,
      publishedAt: version.publishedAt,
    };
  }

  private manageScenario(scenario: StoredScenario): ManageScenarioSummaryDto {
    const versions = scenario.versionIds
      .map((id) => this.#scenarioVersions.get(id))
      .filter((version): version is ScenarioVersionDetailDto =>
        Boolean(version),
      );
    const current =
      scenario.currentVersionId === undefined
        ? undefined
        : this.#scenarioVersions.get(scenario.currentVersionId);
    const latest = versions.at(-1);
    return {
      id: scenario.id,
      slug: scenario.slug,
      title: scenario.title,
      description: scenario.description,
      region: scenario.region,
      simulationOnly: true,
      lifecycle: scenario.lifecycle,
      ...(current === undefined ? {} : { currentVersionId: current.id }),
      publishedVersionCount: versions.filter(
        ({ lifecycle }) => lifecycle !== 'DRAFT',
      ).length,
      requiredRoleCount: current?.requiredRoles.length ?? 0,
      minDistinctRequiredAgents: current?.minDistinctRequiredAgents ?? 0,
      ownerId: scenario.ownerId,
      version: scenario.version,
      draftVersionCount: versions.filter(
        ({ lifecycle }) => lifecycle === 'DRAFT',
      ).length,
      latestValidationStatus: latest?.validation.status ?? 'NOT_VALIDATED',
      updatedAt: scenario.updatedAt,
    };
  }

  private ownedAgent(
    principal: ParticipantPrincipal,
    agentId: string,
  ): StoredAgent {
    const stored = this.#agents.get(agentId);
    if (stored === undefined || stored.dto.ownerId !== principal.id) {
      throw new ExerciseServiceError(
        'AGENT_NOT_FOUND',
        'AgentIdentity 不存在或无权访问。 / The AgentIdentity does not exist or is not accessible.',
      );
    }
    return stored;
  }

  private ownedRun(principal: ParticipantPrincipal, runId: string): StoredRun {
    const stored = this.#runs.get(runId);
    if (stored === undefined || stored.run.ownerId !== principal.id) {
      throw new ExerciseServiceError(
        'RUN_NOT_FOUND',
        'Run 不存在或无权访问。 / The run does not exist or is not accessible.',
      );
    }
    return stored;
  }

  private runForAgent(
    principal: ParticipantPrincipal,
    runId: string,
    runAgentId: string,
  ): StoredRun {
    const stored = this.#runs.get(runId);
    if (
      stored === undefined ||
      !principal.roles?.includes('run_agent') ||
      principal.roles.includes('operator') ||
      !principal.runAgentIds?.includes(runAgentId)
    ) {
      throw new ExerciseServiceError(
        'FORBIDDEN',
        'RunAgent credential 未绑定请求的 Run 实例。 / The RunAgent credential is not bound to the requested run instance.',
      );
    }
    this.ownedRunAgent(stored, runAgentId);
    return stored;
  }

  private ownedRunAgent(stored: StoredRun, runAgentId: string): StoredRunAgent {
    const runAgent = stored.runAgents.get(runAgentId);
    if (runAgent === undefined) {
      throw new ExerciseServiceError(
        'RUN_AGENT_NOT_FOUND',
        'RunAgent 不存在或不属于本 Run。 / The RunAgent does not exist or does not belong to this run.',
      );
    }
    return runAgent;
  }

  private runAgentReplay(
    principal: ParticipantPrincipal,
    runId: string,
    query: ReplayQuery,
  ): StoredRun {
    if (
      query.perspective !== 'agent' ||
      query.subjectId === undefined ||
      query.deliverySemantics === 'eligible'
    ) {
      throw new ExerciseServiceError(
        'FORBIDDEN',
        'RunAgent 只能回放自身已发放或已确认的视角。 / A RunAgent may replay only its own issued or acknowledged view.',
      );
    }
    return this.runForAgent(principal, runId, query.subjectId);
  }

  private pinnedScenarioVersion(stored: StoredRun): ScenarioVersionDetailDto {
    const version = this.#scenarioVersions.get(stored.run.scenarioVersionId);
    if (version === undefined || version.lifecycle !== 'PUBLISHED') {
      throw new ExerciseServiceError(
        'SCENARIO_VERSION_NOT_FOUND',
        '固定的场景版本不存在。 / The pinned scenario version does not exist.',
      );
    }
    return version;
  }

  private assertDraftScenarioVersion(version: ScenarioVersionDetailDto): void {
    if (version.lifecycle !== 'DRAFT') {
      throw new ExerciseServiceError(
        'SCENARIO_STATE_CONFLICT',
        '已发布或退役的场景版本内容不可变。 / Published or retired scenario version content is immutable.',
      );
    }
  }

  private assertAggregateVersion(
    current: number,
    expected: number,
    code:
      | 'SCENARIO_VERSION_CONFLICT'
      | 'AGENT_VERSION_CONFLICT'
      | 'RUN_VERSION_CONFLICT',
    aggregate: string,
  ): void {
    if (current !== expected) {
      throw new ExerciseServiceError(
        code,
        `${aggregate} 版本冲突；当前版本为 ${current}。 / ${aggregate} version conflict; current version is ${current}.`,
        { currentVersion: current },
      );
    }
  }

  private idempotent<T>(
    actorId: string,
    scope: string,
    key: string,
    request: unknown,
    operation: () => T,
  ): T {
    const cacheKey = `${actorId}:${scope}:${key}`;
    const requestHash = hash(request);
    const previous = this.#idempotency.get(cacheKey);
    if (previous !== undefined) {
      if (previous.requestHash !== requestHash) {
        throw new ExerciseServiceError(
          'IDEMPOTENCY_CONFLICT',
          '幂等键已用于不同请求。 / The idempotency key was already used for a different request.',
        );
      }
      return previous.response as T;
    }
    const response = operation();
    this.#idempotency.set(cacheKey, { requestHash, response });
    return response;
  }

  private scenarioNotFound(): ExerciseServiceError {
    return new ExerciseServiceError(
      'SCENARIO_NOT_FOUND',
      '场景不存在或无权访问。 / The scenario does not exist or is not accessible.',
    );
  }

  private agentVersionNotFound(): ExerciseServiceError {
    return new ExerciseServiceError(
      'AGENT_VERSION_NOT_FOUND',
      'AgentVersion 不存在或无权访问。 / The AgentVersion does not exist or is not accessible.',
    );
  }

  private timestamp(): string {
    return this.#now().toISOString();
  }
}
