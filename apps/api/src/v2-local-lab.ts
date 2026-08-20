import { createHash, randomBytes, randomUUID } from 'node:crypto';

import { StaticParticipantAuthenticator } from './auth.js';
import type { ParticipantPrincipal } from './types.js';
import { ExerciseServiceError } from './types.js';
import {
  DEFAULT_V2_SCENARIO_VERSION_ID,
  InMemoryV2ExerciseService,
  type InMemoryV2ExerciseServiceOptions,
} from './v2-in-memory-service.js';

export const LOCAL_LAB_ROLE_KEYS = [
  'water-evidence',
  'hydraulic-constraints',
  'ecological-target',
  'dispatch-coordination',
] as const;

export type LocalLabRoleKey = (typeof LOCAL_LAB_ROLE_KEYS)[number];

export interface LocalLabCredential {
  readonly roleSlotId: LocalLabRoleKey;
  readonly runAgentId: string;
  readonly token: string;
}

export interface LocalLabRosterEntry {
  readonly roleSlotId: LocalLabRoleKey;
  readonly runAgentId: string;
  readonly agentVersionId: string;
  readonly instanceKey: string;
}

export interface LocalLabManifest {
  readonly schemaVersion: 1;
  readonly profile: 'ephemeral-local-tdd';
  readonly protocolVersion: 'v2';
  readonly scenarioVersionId: string;
  readonly runId: string;
  readonly runState: 'RUNNING';
  readonly storageBackend: 'memory';
  readonly restartPolicy: 'abort-run';
  readonly roster: readonly LocalLabRosterEntry[];
}

export interface CreateV2LocalLabOptions extends InMemoryV2ExerciseServiceOptions {
  readonly environment?: NodeJS.ProcessEnv;
  readonly operatorToken?: string;
  readonly tokenFactory?: (roleSlotId: LocalLabRoleKey) => string;
}

export interface V2LocalLab {
  readonly manifest: LocalLabManifest;
  readonly credentials: readonly LocalLabCredential[];
  readonly operatorToken: string;
  readonly v2Service: InMemoryV2ExerciseService;
  readonly authenticator: StaticParticipantAuthenticator;
}

const roleNames: Readonly<
  Record<LocalLabRoleKey, { readonly 'zh-CN': string; readonly en: string }>
> = {
  'water-evidence': {
    'zh-CN': 'WorkBuddy 水情与证据智能体',
    en: 'WorkBuddy water evidence agent',
  },
  'hydraulic-constraints': {
    'zh-CN': 'WorkBuddy 水动力约束智能体',
    en: 'WorkBuddy hydraulic constraints agent',
  },
  'ecological-target': {
    'zh-CN': 'WorkBuddy 生态目标智能体',
    en: 'WorkBuddy ecological target agent',
  },
  'dispatch-coordination': {
    'zh-CN': 'WorkBuddy 调度协调智能体',
    en: 'WorkBuddy dispatch coordination agent',
  },
};

function digest(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function localToken(): string {
  return `wbl_${randomBytes(32).toString('base64url')}`;
}

function assertDevelopmentOnly(environment: NodeJS.ProcessEnv): void {
  if (environment['NODE_ENV'] === 'production') {
    throw new ExerciseServiceError(
      'VALIDATION_FAILED',
      '本地四智能体 Lab 不能在 production 启动。 / The local four-agent lab cannot run in production.',
    );
  }
}

function assertDistinctTokens(
  operatorToken: string,
  credentials: readonly LocalLabCredential[],
): void {
  const tokens = [operatorToken, ...credentials.map(({ token }) => token)];
  if (
    tokens.some((token) => token.trim().length < 16) ||
    new Set(tokens).size !== tokens.length
  ) {
    throw new ExerciseServiceError(
      'VALIDATION_FAILED',
      'Lab operator 与四个 RunAgent 必须使用不同且非空的 token。 / The lab operator and four RunAgents require distinct non-empty tokens.',
    );
  }
}

export async function createV2LocalLab(
  options: CreateV2LocalLabOptions = {},
): Promise<V2LocalLab> {
  const environment = options.environment ?? process.env;
  assertDevelopmentOnly(environment);

  const v2Service = new InMemoryV2ExerciseService({
    ...(options.idFactory === undefined
      ? {}
      : { idFactory: options.idFactory }),
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.leaseTokenFactory === undefined
      ? {}
      : { leaseTokenFactory: options.leaseTokenFactory }),
  });
  const operator: ParticipantPrincipal = {
    id: 'local-workbuddy-lab-operator',
    participantVersionIds: [],
    roles: ['operator'],
  };
  const operatorToken = options.operatorToken ?? localToken();

  const agentVersions = new Map<LocalLabRoleKey, string>();
  for (const roleSlotId of LOCAL_LAB_ROLE_KEYS) {
    const { agent } = await v2Service.createAgent(operator, randomUUID(), {
      displayName: roleNames[roleSlotId],
      description: {
        'zh-CN': '仅用于本机 WorkBuddy 四智能体 TDD Lab。',
        en: 'For the local WorkBuddy four-agent TDD lab only.',
      },
    });
    const { agentVersion } = await v2Service.createAgentVersion(
      operator,
      agent.id,
      randomUUID(),
      {
        expectedAgentVersion: agent.version,
        providerKind: 'fake',
        model: 'workbuddy-lab-bootstrap',
        capabilities: ['agent-excon-v2', roleSlotId],
        protocolVersion: 'v2',
        telemetryMode: 'none',
        skillManifestHash: digest('skills/agent-excon'),
        toolManifestHash: digest('agent-excon-mcp-server:v2'),
      },
    );
    agentVersions.set(roleSlotId, agentVersion.id);
  }

  const { run } = await v2Service.createRun(operator, randomUUID(), {
    scenarioVersionId: DEFAULT_V2_SCENARIO_VERSION_ID,
    label: {
      'zh-CN': 'WorkBuddy 永定河四智能体 TDD Lab',
      en: 'WorkBuddy Yongding four-agent TDD lab',
    },
    mode: 'exercise',
  });

  const roster: LocalLabRosterEntry[] = [];
  const credentials: LocalLabCredential[] = [];
  for (const roleSlotId of LOCAL_LAB_ROLE_KEYS) {
    const instanceKey = `workbuddy-${roleSlotId}`;
    const { runAgent } = await v2Service.joinRun(
      operator,
      run.id,
      randomUUID(),
      {
        agentVersionId: agentVersions.get(roleSlotId)!,
        roleSlotId,
        instanceKey,
      },
    );
    roster.push({
      roleSlotId,
      runAgentId: runAgent.id,
      agentVersionId: runAgent.agentVersionId,
      instanceKey,
    });
    credentials.push({
      roleSlotId,
      runAgentId: runAgent.id,
      token: options.tokenFactory?.(roleSlotId) ?? localToken(),
    });
  }
  assertDistinctTokens(operatorToken, credentials);

  const { run: startedRun } = await v2Service.startRun(
    operator,
    run.id,
    randomUUID(),
    { expectedVersion: run.version },
  );
  if (startedRun.state !== 'RUNNING') {
    throw new ExerciseServiceError(
      'RUN_STATE_CONFLICT',
      '本地 Lab 未进入 RUNNING。 / The local lab did not enter RUNNING.',
    );
  }

  const principals: Record<string, ParticipantPrincipal> = {
    [operatorToken]: operator,
  };
  for (const credential of credentials) {
    principals[credential.token] = {
      id: `local-workbuddy-${credential.roleSlotId}-credential`,
      participantVersionIds: [],
      roles: ['run_agent'],
      runAgentIds: [credential.runAgentId],
    };
  }

  return {
    manifest: {
      schemaVersion: 1,
      profile: 'ephemeral-local-tdd',
      protocolVersion: 'v2',
      scenarioVersionId: DEFAULT_V2_SCENARIO_VERSION_ID,
      runId: startedRun.id,
      runState: 'RUNNING',
      storageBackend: 'memory',
      restartPolicy: 'abort-run',
      roster,
    },
    credentials,
    operatorToken,
    v2Service,
    authenticator: new StaticParticipantAuthenticator(principals),
  };
}
