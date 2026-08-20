import type { Locale } from './i18n';

export type LocalizedText = Readonly<Record<Locale, string>>;

export interface ScenarioVersion {
  readonly id: string;
  readonly label: string;
  readonly status: 'draft' | 'published' | 'retired';
  readonly publishedAt?: string;
  readonly contentHash: string;
  readonly summary: LocalizedText;
}

export interface RoleSlot {
  readonly id: string;
  readonly name: LocalizedText;
  readonly mission: LocalizedText;
  readonly expectedArtifact: LocalizedText;
  readonly accent: 'river' | 'cyan' | 'amber' | 'reed';
}

export interface ScenarioCheckpoint {
  readonly id: string;
  readonly virtualTime: string;
  readonly title: LocalizedText;
  readonly contract: LocalizedText;
}

export interface PlatformScenario {
  readonly id: string;
  readonly shortName: LocalizedText;
  readonly title: LocalizedText;
  readonly description: LocalizedText;
  readonly region: LocalizedText;
  readonly simulationOnly: true;
  readonly currentVersionId: string;
  readonly versions: readonly ScenarioVersion[];
  readonly requiredRoles: readonly RoleSlot[];
  readonly checkpoints: readonly ScenarioCheckpoint[];
  readonly topology: readonly LocalizedText[];
}

export interface AgentSession {
  readonly id: string;
  readonly roleId: string;
  readonly displayName: LocalizedText;
  readonly instanceKey?: string;
  readonly agentVersionId?: string;
  readonly version?: string;
  readonly model?: string;
  readonly state:
    | 'joined'
    | 'ready'
    | 'working'
    | 'waiting'
    | 'waiting-feedback'
    | 'complete'
    | 'done'
    | 'disconnected'
    | 'removed';
  readonly lastActivity: string;
  readonly tokenCount?: number;
  readonly toolCalls?: number;
}

export interface TraceSummary {
  readonly traceId: string;
  readonly runId: string;
  readonly runAgentId?: string;
  readonly name: string;
  readonly startedAt: string;
  readonly durationMs: number;
  readonly status: 'UNSET' | 'OK' | 'ERROR';
  readonly source: 'excon_service' | 'participant_exporter';
  readonly trust: 'platform_observed' | 'participant_reported';
  readonly spanCount: number;
}

export interface SpanLink {
  readonly spanId: string;
  readonly relation: 'depends_on';
  readonly label: LocalizedText;
}

export interface SpanEvent {
  readonly atMs: number;
  readonly name: string;
  readonly detail: LocalizedText;
}

export interface ExerciseSpan {
  readonly id: string;
  readonly traceId: string;
  readonly parentSpanId?: string;
  readonly agentSessionId: string;
  readonly operation:
    | 'inject'
    | 'sync'
    | 'model'
    | 'tool'
    | 'contribution'
    | 'coordination'
    | 'submission'
    | 'evaluation'
    | 'feedback';
  readonly name: LocalizedText;
  readonly startPercent: number;
  readonly durationPercent: number;
  readonly startWallTime: string;
  readonly virtualTime: string;
  readonly durationMs: number;
  readonly status: 'ok' | 'running' | 'error';
  readonly telemetrySource: 'excon_service' | 'participant_exporter';
  readonly telemetryTrust: 'platform_observed' | 'participant_reported';
  readonly links: readonly SpanLink[];
  readonly events: readonly SpanEvent[];
  readonly attributes: Readonly<Record<string, string>>;
}

export interface ReplayReceipt {
  readonly id: string;
  readonly sequence: number;
  readonly category:
    | 'run'
    | 'inject'
    | 'receipt'
    | 'contribution'
    | 'submission'
    | 'evaluation'
    | 'feedback';
  readonly wallTime: string;
  readonly virtualTime: string;
  readonly title: LocalizedText;
  readonly detail: LocalizedText;
  readonly actorId: string;
  readonly visibility: 'team' | 'agent' | 'operator';
  readonly visibleTo: readonly string[];
  readonly traceId?: string;
  readonly spanId?: string;
  readonly digest: string;
}

export interface ExerciseRun {
  readonly id: string;
  readonly name: LocalizedText;
  readonly scenarioId: string;
  readonly scenarioVersionId: string;
  readonly state:
    | 'created'
    | 'forming'
    | 'ready'
    | 'running'
    | 'paused'
    | 'completing'
    | 'completed'
    | 'cancelled'
    | 'failed';
  readonly currentVirtualTime: string;
  readonly wallStartedAt: string;
  readonly boundaryCoverage: number;
  readonly participantTelemetry: {
    readonly mode: 'none' | 'partial' | 'instrumented';
    readonly platformObservedSpanCount: number;
    readonly participantReportedSpanCount: number;
    readonly droppedSpanCount: number;
    readonly lateSpanCount: number;
  };
  readonly participants: readonly AgentSession[];
  readonly spans: readonly ExerciseSpan[];
  readonly traceSummaries: readonly TraceSummary[];
  readonly replayReceipts: readonly ReplayReceipt[];
}

export const PLATFORM_DATA_SOURCE = 'demo-static-read-model' as const;

function text(zhCN: string, en: string): LocalizedText {
  return { 'zh-CN': zhCN, en };
}

const yongdingRoles: readonly RoleSlot[] = [
  {
    id: 'inflow-analysis',
    name: text('来水研判', 'Inflow analysis'),
    mission: text(
      '核验多源来水时态、来源和可用量。',
      'Verify the timing, provenance, and availability of inflows.',
    ),
    expectedArtifact: text('来水边界工件', 'Inflow boundary artifact'),
    accent: 'river',
  },
  {
    id: 'hydraulic-constraints',
    name: text('水力约束', 'Hydraulic constraints'),
    mission: text(
      '检查输水通道、传播时滞与水量守恒。',
      'Check corridor capacity, travel time, and mass balance.',
    ),
    expectedArtifact: text('约束检查工件', 'Constraint check artifact'),
    accent: 'cyan',
  },
  {
    id: 'ecological-targets',
    name: text('生态目标', 'Ecological targets'),
    mission: text(
      '核对控制断面的生态目标与证据覆盖。',
      'Check ecological targets and evidence coverage at control sections.',
    ),
    expectedArtifact: text('生态目标工件', 'Ecological target artifact'),
    accent: 'reed',
  },
  {
    id: 'dispatch-coordination',
    name: text('调度协调', 'Dispatch coordination'),
    mission: text(
      '汇聚并行工件，形成可复算的团队联合方案。',
      'Converge parallel artifacts into a reproducible team plan.',
    ),
    expectedArtifact: text('团队联合提交', 'Joint team submission'),
    accent: 'amber',
  },
];

const baiyangdianRoles: readonly RoleSlot[] = [
  {
    id: 'water-level-analysis',
    name: text('水位研判', 'Water-level analysis'),
    mission: text(
      '解释分区水位观测。',
      'Interpret zonal water-level observations.',
    ),
    expectedArtifact: text('水位状态工件', 'Water-level state artifact'),
    accent: 'river',
  },
  {
    id: 'habitat-analysis',
    name: text('生境分析', 'Habitat analysis'),
    mission: text(
      '核对生境目标与约束。',
      'Check habitat targets and constraints.',
    ),
    expectedArtifact: text('生境目标工件', 'Habitat target artifact'),
    accent: 'reed',
  },
  {
    id: 'replenishment-planning',
    name: text('补水规划', 'Replenishment planning'),
    mission: text(
      '组合可行补水窗口。',
      'Combine feasible replenishment windows.',
    ),
    expectedArtifact: text('补水方案工件', 'Replenishment plan artifact'),
    accent: 'cyan',
  },
];

const haiheRoles: readonly RoleSlot[] = [
  {
    id: 'signal-triage',
    name: text('信号甄别', 'Signal triage'),
    mission: text(
      '校验异常信号与时态。',
      'Validate anomaly signals and timing.',
    ),
    expectedArtifact: text('信号证据工件', 'Signal evidence artifact'),
    accent: 'river',
  },
  {
    id: 'source-reasoning',
    name: text('来源推理', 'Source reasoning'),
    mission: text(
      '形成受证据约束的来源假设。',
      'Build evidence-bounded source hypotheses.',
    ),
    expectedArtifact: text('来源假设工件', 'Source hypothesis artifact'),
    accent: 'cyan',
  },
  {
    id: 'response-coordination',
    name: text('协同响应', 'Response coordination'),
    mission: text(
      '汇总核验动作和响应顺序。',
      'Consolidate verification actions and response order.',
    ),
    expectedArtifact: text('协同响应工件', 'Coordinated response artifact'),
    accent: 'amber',
  },
];

export const scenarios: readonly PlatformScenario[] = [
  {
    id: 'yongding-2023-ecological-replenishment',
    shortName: text('永定河联合调度', 'Yongding joint dispatch'),
    title: text(
      '2023 永定河春季生态补水——京津冀多水源联合调度（事实锚定合成版）',
      '2023 Yongding River Spring Ecological Replenishment — Jing-Jin-Ji Multi-source Dispatch (Fact-anchored Synthetic Edition)',
    ),
    description: text(
      '四类专业智能体并行研判来水、工程约束与生态目标，由调度协调智能体汇聚团队方案。',
      'Four specialist agents analyze inflows, engineering constraints, and ecological targets in parallel before a coordinator converges the team plan.',
    ),
    region: text(
      '京津冀 · 永定河水系统',
      'Jing-Jin-Ji · Yongding River system',
    ),
    simulationOnly: true,
    currentVersionId: 'jjj-yongding-replenishment-2023-v2',
    versions: [
      {
        id: 'jjj-yongding-replenishment-2023-v2',
        label: 'v2',
        status: 'published',
        publishedAt: '2026-08-20T09:00:00.000Z',
        contentHash: 'e18a7b42…9f20',
        summary: text(
          '多智能体角色与团队交付契约',
          'Multi-agent roles and team delivery contract',
        ),
      },
      {
        id: 'jjj-yongding-replenishment-2023-v1',
        label: 'v1',
        status: 'retired',
        publishedAt: '2026-08-19T09:00:00.000Z',
        contentHash: '7ca613ef…42db',
        summary: text('单智能体纵向切片', 'Single-agent walking slice'),
      },
    ],
    requiredRoles: yongdingRoles,
    checkpoints: [
      {
        id: 'briefing',
        virtualTime: 'T+00:00',
        title: text('任务展开', 'Mission opened'),
        contract: text('团队读取初始证据', 'Team reads the initial evidence'),
      },
      {
        id: 'parallel-analysis',
        virtualTime: 'T+06:00',
        title: text('并行研判', 'Parallel analysis'),
        contract: text('三个专业工件齐备', 'Three specialist artifacts ready'),
      },
      {
        id: 'team-submission',
        virtualTime: 'T+12:00',
        title: text('团队汇聚', 'Team convergence'),
        contract: text('联合方案进入裁决', 'Joint plan enters evaluation'),
      },
      {
        id: 'revision',
        virtualTime: 'T+14:00',
        title: text('定向反馈', 'Targeted feedback'),
        contract: text(
          '按 Agent 与团队返回反馈',
          'Return agent and team feedback',
        ),
      },
    ],
    topology: [
      text('官厅水库', 'Guanting Reservoir'),
      text('三家店', 'Sanjiadian'),
      text('卢沟桥', 'Lugou Bridge'),
      text('崔指挥营', 'Cuizhihuiying'),
      text('屈家店', 'Qujiadian'),
    ],
  },
  {
    id: 'baiyangdian-ecological-level-coordination',
    shortName: text('白洋淀生态协同', 'Baiyangdian ecological coordination'),
    title: text(
      '白洋淀生态水位与多源补水协同（合成演练）',
      'Baiyangdian ecological level and multi-source replenishment coordination (Synthetic exercise)',
    ),
    description: text(
      '围绕分区水位、生境目标和补水窗口组织多角色协同。',
      'Coordinate multiple roles around zonal water levels, habitat targets, and replenishment windows.',
    ),
    region: text(
      '雄安新区 · 白洋淀水系统',
      "Xiong'an · Baiyangdian water system",
    ),
    simulationOnly: true,
    currentVersionId: 'baiyangdian-ecological-v1',
    versions: [
      {
        id: 'baiyangdian-ecological-v1',
        label: 'v1',
        status: 'draft',
        contentHash: '2fb91c48…138d',
        summary: text('角色契约验证中', 'Role contracts under validation'),
      },
    ],
    requiredRoles: baiyangdianRoles,
    checkpoints: [
      {
        id: 'baseline',
        virtualTime: 'T+00:00',
        title: text('基线发布', 'Baseline released'),
        contract: text('读取分区水位', 'Read zonal water levels'),
      },
      {
        id: 'window',
        virtualTime: 'T+08:00',
        title: text('窗口组合', 'Window composition'),
        contract: text(
          '汇聚生境与水源工件',
          'Converge habitat and source artifacts',
        ),
      },
    ],
    topology: [
      text('入淀口', 'Inlet'),
      text('开阔水域', 'Open water'),
      text('淀边湿地', 'Wetland margin'),
    ],
  },
  {
    id: 'haihe-water-quality-collaboration',
    shortName: text('海河水质协同', 'Haihe water-quality collaboration'),
    title: text(
      '海河流域跨区域水质异常协同研判（合成演练）',
      'Haihe basin cross-region water-quality anomaly collaboration (Synthetic exercise)',
    ),
    description: text(
      '多个智能体分别负责信号甄别、来源推理和协同响应。',
      'Multiple agents separately handle signal triage, source reasoning, and coordinated response.',
    ),
    region: text('京津冀 · 海河水系统', 'Jing-Jin-Ji · Haihe water system'),
    simulationOnly: true,
    currentVersionId: 'haihe-quality-v1',
    versions: [
      {
        id: 'haihe-quality-v1',
        label: 'v1',
        status: 'published',
        publishedAt: '2026-08-20T08:30:00.000Z',
        contentHash: 'a560c81d…046e',
        summary: text(
          '跨区域多角色协作基线',
          'Cross-region multi-role collaboration baseline',
        ),
      },
    ],
    requiredRoles: haiheRoles,
    checkpoints: [
      {
        id: 'signal',
        virtualTime: 'T+00:00',
        title: text('异常信号', 'Anomaly signal'),
        contract: text(
          '形成独立信号判断',
          'Form an independent signal assessment',
        ),
      },
      {
        id: 'coordination',
        virtualTime: 'T+04:00',
        title: text('协同核验', 'Coordinated verification'),
        contract: text('形成团队响应顺序', 'Produce the team response order'),
      },
    ],
    topology: [
      text('上游监测点', 'Upstream station'),
      text('跨界断面', 'Boundary section'),
      text('下游控制点', 'Downstream control'),
    ],
  },
] as const;

const yongdingParticipants: readonly AgentSession[] = [
  {
    id: 'agent-inflow',
    roleId: 'inflow-analysis',
    displayName: text('来水研判智能体', 'Inflow analysis agent'),
    version: 'inflow-agent@2.1.0',
    model: 'local-codex',
    state: 'complete',
    lastActivity: '10:32:04',
    tokenCount: 18_420,
    toolCalls: 8,
  },
  {
    id: 'agent-hydraulics',
    roleId: 'hydraulic-constraints',
    displayName: text('水力约束智能体', 'Hydraulic constraint agent'),
    version: 'hydraulic-agent@1.4.2',
    model: 'local-codex',
    state: 'complete',
    lastActivity: '10:32:06',
    tokenCount: 12_870,
    toolCalls: 11,
  },
  {
    id: 'agent-ecology',
    roleId: 'ecological-targets',
    displayName: text('生态目标智能体', 'Ecological target agent'),
    version: 'ecology-agent@1.8.0',
    model: 'openai-compatible',
    state: 'working',
    lastActivity: '10:32:11',
    tokenCount: 16_340,
    toolCalls: 7,
  },
  {
    id: 'agent-coordinator',
    roleId: 'dispatch-coordination',
    displayName: text('调度协调智能体', 'Dispatch coordination agent'),
    version: 'coordinator-agent@3.0.0',
    model: 'local-codex',
    state: 'working',
    lastActivity: '10:32:15',
    tokenCount: 21_760,
    toolCalls: 13,
  },
];

const yongdingSpans: readonly ExerciseSpan[] = [
  {
    id: '0000000000000001',
    traceId: 'a84719d8276348f59a6184c1b51d3001',
    agentSessionId: 'excon',
    operation: 'inject',
    name: text('释放阶段证据', 'Release checkpoint evidence'),
    startPercent: 2,
    durationPercent: 8,
    startWallTime: '10:31:40.000',
    virtualTime: 'T+12:00',
    durationMs: 420,
    status: 'ok',
    telemetrySource: 'excon_service',
    telemetryTrust: 'platform_observed',
    links: [],
    events: [
      {
        atMs: 320,
        name: 'inject.released',
        detail: text(
          '向团队发布来水修订。',
          'Released the inflow revision to the team.',
        ),
      },
    ],
    attributes: {
      'service.name': 'agent-excon-api',
      'wiser.run.id': 'run-yongding-spring-042',
      'wiser.virtual_time': 'T+12:00',
    },
  },
  {
    id: '1000000000000001',
    traceId: 'b84719d8276348f59a6184c1b51d3011',
    agentSessionId: 'agent-inflow',
    operation: 'sync',
    name: text('同步来水修订收据', 'Sync inflow revision receipt'),
    startPercent: 12,
    durationPercent: 12,
    startWallTime: '10:31:43.120',
    virtualTime: 'T+12:00',
    durationMs: 1_280,
    status: 'ok',
    telemetrySource: 'excon_service',
    telemetryTrust: 'platform_observed',
    links: [],
    events: [],
    attributes: {
      'gen_ai.agent.id': 'agent-inflow',
      'gen_ai.agent.name': 'Inflow analysis agent',
      'wiser.receipt.count': '3',
    },
  },
  {
    id: '1000000000000002',
    traceId: 'b84719d8276348f59a6184c1b51d3011',
    parentSpanId: '1000000000000001',
    agentSessionId: 'agent-inflow',
    operation: 'contribution',
    name: text('形成来水边界工件', 'Produce inflow boundary artifact'),
    startPercent: 27,
    durationPercent: 18,
    startWallTime: '10:31:46.600',
    virtualTime: 'T+12:01',
    durationMs: 3_860,
    status: 'ok',
    telemetrySource: 'participant_exporter',
    telemetryTrust: 'participant_reported',
    links: [],
    events: [],
    attributes: {
      'gen_ai.agent.id': 'agent-inflow',
      'wiser.artifact.type': 'inflow-boundary',
      'gen_ai.usage.input_tokens': '8120',
      'gen_ai.usage.output_tokens': '1460',
    },
  },
  {
    id: '2000000000000001',
    traceId: 'c84719d8276348f59a6184c1b51d3021',
    agentSessionId: 'agent-hydraulics',
    operation: 'tool',
    name: text('复算通道约束', 'Recalculate corridor constraints'),
    startPercent: 14,
    durationPercent: 28,
    startWallTime: '10:31:43.480',
    virtualTime: 'T+12:00',
    durationMs: 5_740,
    status: 'ok',
    telemetrySource: 'participant_exporter',
    telemetryTrust: 'participant_reported',
    links: [],
    events: [],
    attributes: {
      'gen_ai.agent.id': 'agent-hydraulics',
      'gen_ai.tool.name': 'validate-corridor',
      'wiser.constraint.version': 'corridor-v2',
    },
  },
  {
    id: '3000000000000001',
    traceId: 'd84719d8276348f59a6184c1b51d3031',
    agentSessionId: 'agent-ecology',
    operation: 'model',
    name: text('核对生态目标', 'Check ecological targets'),
    startPercent: 18,
    durationPercent: 30,
    startWallTime: '10:31:44.040',
    virtualTime: 'T+12:00',
    durationMs: 6_210,
    status: 'ok',
    telemetrySource: 'participant_exporter',
    telemetryTrust: 'participant_reported',
    links: [],
    events: [],
    attributes: {
      'gen_ai.agent.id': 'agent-ecology',
      'gen_ai.operation.name': 'chat',
      'gen_ai.request.model': 'compatible-water-reasoner',
      'gen_ai.usage.input_tokens': '7030',
      'gen_ai.usage.output_tokens': '1210',
    },
  },
  {
    id: '3000000000000002',
    traceId: 'd84719d8276348f59a6184c1b51d3031',
    parentSpanId: '3000000000000001',
    agentSessionId: 'agent-ecology',
    operation: 'contribution',
    name: text('提交生态目标工件', 'Submit ecological target artifact'),
    startPercent: 51,
    durationPercent: 11,
    startWallTime: '10:31:50.460',
    virtualTime: 'T+12:02',
    durationMs: 1_090,
    status: 'ok',
    telemetrySource: 'participant_exporter',
    telemetryTrust: 'participant_reported',
    links: [],
    events: [],
    attributes: {
      'gen_ai.agent.id': 'agent-ecology',
      'wiser.artifact.type': 'ecological-targets',
    },
  },
  {
    id: '4000000000000001',
    traceId: 'e84719d8276348f59a6184c1b51d3041',
    agentSessionId: 'agent-coordinator',
    operation: 'coordination',
    name: text('汇聚三类专业工件', 'Converge three specialist artifacts'),
    startPercent: 48,
    durationPercent: 25,
    startWallTime: '10:31:50.120',
    virtualTime: 'T+12:02',
    durationMs: 5_210,
    status: 'ok',
    telemetrySource: 'participant_exporter',
    telemetryTrust: 'participant_reported',
    links: [
      {
        spanId: '1000000000000002',
        relation: 'depends_on',
        label: text('来水边界', 'Inflow boundary'),
      },
      {
        spanId: '2000000000000001',
        relation: 'depends_on',
        label: text('通道约束', 'Corridor constraints'),
      },
      {
        spanId: '3000000000000002',
        relation: 'depends_on',
        label: text('生态目标', 'Ecological targets'),
      },
    ],
    events: [],
    attributes: {
      'gen_ai.agent.id': 'agent-coordinator',
      'wiser.contribution.count': '3',
    },
  },
  {
    id: '4000000000000002',
    traceId: 'e84719d8276348f59a6184c1b51d3041',
    parentSpanId: '4000000000000001',
    agentSessionId: 'agent-coordinator',
    operation: 'submission',
    name: text('提交团队联合方案', 'Submit joint team plan'),
    startPercent: 75,
    durationPercent: 8,
    startWallTime: '10:31:55.520',
    virtualTime: 'T+12:04',
    durationMs: 780,
    status: 'ok',
    telemetrySource: 'excon_service',
    telemetryTrust: 'platform_observed',
    links: [],
    events: [],
    attributes: {
      'gen_ai.agent.id': 'agent-coordinator',
      'wiser.submission.producer': 'team',
      'wiser.submission.revision': '2',
    },
  },
  {
    id: '0000000000000002',
    traceId: 'f84719d8276348f59a6184c1b51d3051',
    agentSessionId: 'excon',
    operation: 'evaluation',
    name: text('确定性团队裁决', 'Deterministic team evaluation'),
    startPercent: 84,
    durationPercent: 9,
    startWallTime: '10:31:56.440',
    virtualTime: 'T+12:04',
    durationMs: 1_840,
    status: 'ok',
    telemetrySource: 'excon_service',
    telemetryTrust: 'platform_observed',
    links: [
      {
        spanId: '1000000000000002',
        relation: 'depends_on',
        label: text('来水工件', 'Inflow artifact'),
      },
      {
        spanId: '2000000000000001',
        relation: 'depends_on',
        label: text('约束工件', 'Constraint artifact'),
      },
      {
        spanId: '3000000000000002',
        relation: 'depends_on',
        label: text('生态工件', 'Ecology artifact'),
      },
      {
        spanId: '4000000000000002',
        relation: 'depends_on',
        label: text('团队提交', 'Team submission'),
      },
    ],
    events: [
      {
        atMs: 1_720,
        name: 'evaluation.completed',
        detail: text(
          '确定性规则输出部分通过。',
          'Deterministic rules returned a partial pass.',
        ),
      },
    ],
    attributes: {
      'service.name': 'agent-excon-worker',
      'wiser.evaluator.version': 'allocation-rules@2.0.0',
      'wiser.verdict': 'partial',
    },
  },
  {
    id: '0000000000000003',
    traceId: 'f84719d8276348f59a6184c1b51d3051',
    parentSpanId: '0000000000000002',
    agentSessionId: 'excon',
    operation: 'feedback',
    name: text('返回定向反馈', 'Return targeted feedback'),
    startPercent: 94,
    durationPercent: 5,
    startWallTime: '10:31:58.360',
    virtualTime: 'T+12:05',
    durationMs: 360,
    status: 'running',
    telemetrySource: 'excon_service',
    telemetryTrust: 'platform_observed',
    links: [],
    events: [],
    attributes: {
      'service.name': 'agent-excon-api',
      'wiser.feedback.target': 'agent-ecology,team',
    },
  },
];

const allYongdingAgents = yongdingParticipants.map(({ id }) => id);

const yongdingReplayReceipts: readonly ReplayReceipt[] = [
  {
    id: 'receipt-181',
    sequence: 181,
    category: 'run',
    wallTime: '10:31:39.880',
    virtualTime: 'T+12:00',
    title: text('阶段检查点恢复', 'Checkpoint resumed'),
    detail: text(
      '四个 Agent Session 恢复到相同运行检查点。',
      'Four agent sessions resumed at the same run checkpoint.',
    ),
    actorId: 'excon',
    visibility: 'team',
    visibleTo: allYongdingAgents,
    digest: '54fd…181a',
  },
  {
    id: 'receipt-182',
    sequence: 182,
    category: 'inject',
    wallTime: '10:31:40.320',
    virtualTime: 'T+12:00',
    title: text('来水修订释放', 'Inflow revision released'),
    detail: text(
      '团队可见的新证据已发布。',
      'New team-visible evidence was released.',
    ),
    actorId: 'excon',
    visibility: 'team',
    visibleTo: allYongdingAgents,
    traceId: 'a84719d8276348f59a6184c1b51d3001',
    spanId: '0000000000000001',
    digest: '86c0…182d',
  },
  {
    id: 'receipt-183',
    sequence: 183,
    category: 'receipt',
    wallTime: '10:31:44.040',
    virtualTime: 'T+12:00',
    title: text('生态证据已读取', 'Ecology evidence observed'),
    detail: text(
      '生态目标智能体读取当前可见断面目标。',
      'The ecology agent read the currently visible section targets.',
    ),
    actorId: 'agent-ecology',
    visibility: 'agent',
    visibleTo: ['agent-ecology', 'agent-coordinator'],
    traceId: 'd84719d8276348f59a6184c1b51d3031',
    spanId: '3000000000000001',
    digest: '09ac…183f',
  },
  {
    id: 'receipt-184',
    sequence: 184,
    category: 'contribution',
    wallTime: '10:31:51.550',
    virtualTime: 'T+12:02',
    title: text('生态目标工件提交', 'Ecological target artifact submitted'),
    detail: text(
      '工件固定了证据版本与可见性收据。',
      'The artifact pinned evidence versions and its visibility receipt.',
    ),
    actorId: 'agent-ecology',
    visibility: 'agent',
    visibleTo: ['agent-ecology', 'agent-coordinator'],
    traceId: 'd84719d8276348f59a6184c1b51d3031',
    spanId: '3000000000000002',
    digest: '734c…184b',
  },
  {
    id: 'receipt-185',
    sequence: 185,
    category: 'feedback',
    wallTime: '10:31:58.720',
    virtualTime: 'T+12:05',
    title: text('生态目标定向反馈', 'Targeted ecology feedback'),
    detail: text(
      '请复核屈家店目标的证据覆盖；团队方案保持可修订。',
      'Recheck evidence coverage for Qujiadian; the team plan remains revisable.',
    ),
    actorId: 'excon',
    visibility: 'agent',
    visibleTo: ['agent-ecology', 'agent-coordinator'],
    traceId: 'f84719d8276348f59a6184c1b51d3051',
    spanId: '0000000000000003',
    digest: '2aa1…185e',
  },
  {
    id: 'receipt-186',
    sequence: 186,
    category: 'evaluation',
    wallTime: '10:31:57.900',
    virtualTime: 'T+12:04',
    title: text('隐藏规则证据固定', 'Private rule evidence pinned'),
    detail: text(
      '裁决服务固定内部规则与结果哈希。',
      'The evaluator pinned private rules and outcome hashes.',
    ),
    actorId: 'excon',
    visibility: 'operator',
    visibleTo: [],
    traceId: 'f84719d8276348f59a6184c1b51d3051',
    spanId: '0000000000000002',
    digest: '11bf…186c',
  },
  {
    id: 'receipt-187',
    sequence: 187,
    category: 'submission',
    wallTime: '10:31:55.520',
    virtualTime: 'T+12:04',
    title: text('团队提交审计载荷', 'Team submission audit payload'),
    detail: text(
      '完整贡献者清单仅向授权导调员展示。',
      'The complete contributor list is visible only to authorized operators.',
    ),
    actorId: 'agent-coordinator',
    visibility: 'operator',
    visibleTo: [],
    traceId: 'e84719d8276348f59a6184c1b51d3041',
    spanId: '4000000000000002',
    digest: 'c72e…187a',
  },
];

function participantForRole(
  prefix: string,
  role: RoleSlot,
  index: number,
): AgentSession {
  return {
    id: `${prefix}-${index + 1}`,
    roleId: role.id,
    displayName: text(`${role.name['zh-CN']}智能体`, `${role.name.en} agent`),
    version: `${prefix}@1.0.${index}`,
    model: 'openai-compatible',
    state: 'waiting',
    lastActivity: '—',
    tokenCount: 0,
    toolCalls: 0,
  };
}

export const exerciseRuns: readonly ExerciseRun[] = [
  {
    id: 'run-yongding-spring-042',
    name: text(
      '永定河春季协同演练 #042',
      'Yongding spring collaboration run #042',
    ),
    scenarioId: 'yongding-2023-ecological-replenishment',
    scenarioVersionId: 'jjj-yongding-replenishment-2023-v2',
    state: 'running',
    currentVirtualTime: 'T+12:05',
    wallStartedAt: '2026-08-20T10:20:00.000+08:00',
    boundaryCoverage: 1,
    participantTelemetry: {
      mode: 'instrumented',
      platformObservedSpanCount: yongdingSpans.filter(
        ({ telemetryTrust }) => telemetryTrust === 'platform_observed',
      ).length,
      participantReportedSpanCount: yongdingSpans.filter(
        ({ telemetryTrust }) => telemetryTrust === 'participant_reported',
      ).length,
      droppedSpanCount: 2,
      lateSpanCount: 1,
    },
    participants: yongdingParticipants,
    spans: yongdingSpans,
    traceSummaries: [],
    replayReceipts: yongdingReplayReceipts,
  },
  {
    id: 'run-baiyangdian-draft-007',
    name: text('白洋淀角色联调 #007', 'Baiyangdian role integration #007'),
    scenarioId: 'baiyangdian-ecological-level-coordination',
    scenarioVersionId: 'baiyangdian-ecological-v1',
    state: 'paused',
    currentVirtualTime: 'T+00:00',
    wallStartedAt: '2026-08-20T08:00:00.000+08:00',
    boundaryCoverage: 0.55,
    participantTelemetry: {
      mode: 'none',
      platformObservedSpanCount: 0,
      participantReportedSpanCount: 0,
      droppedSpanCount: 0,
      lateSpanCount: 0,
    },
    participants: baiyangdianRoles.map((role, index) =>
      participantForRole('baiyangdian-agent', role, index),
    ),
    spans: [],
    traceSummaries: [],
    replayReceipts: [],
  },
  {
    id: 'run-haihe-quality-011',
    name: text('海河水质协同演练 #011', 'Haihe quality collaboration run #011'),
    scenarioId: 'haihe-water-quality-collaboration',
    scenarioVersionId: 'haihe-quality-v1',
    state: 'completed',
    currentVirtualTime: 'T+04:00',
    wallStartedAt: '2026-08-19T14:00:00.000+08:00',
    boundaryCoverage: 0.96,
    participantTelemetry: {
      mode: 'partial',
      platformObservedSpanCount: 0,
      participantReportedSpanCount: 0,
      droppedSpanCount: 3,
      lateSpanCount: 0,
    },
    participants: haiheRoles.map((role, index) =>
      participantForRole('haihe-agent', role, index),
    ),
    spans: [],
    traceSummaries: [],
    replayReceipts: [],
  },
] as const;

export function getScenarioById(id: string): PlatformScenario | undefined {
  return scenarios.find((scenario) => scenario.id === id);
}

export function getRunById(id: string): ExerciseRun | undefined {
  return exerciseRuns.find((run) => run.id === id);
}

export function getRunsForScenario(scenarioId: string): readonly ExerciseRun[] {
  return exerciseRuns.filter((run) => run.scenarioId === scenarioId);
}

export function getReplayEventsForPerspective(
  runId: string,
  perspective: string,
): readonly ReplayReceipt[] {
  const run = getRunById(runId);
  if (run === undefined) return [];
  if (perspective === 'operator') return run.replayReceipts;
  return run.replayReceipts.filter((receipt) =>
    receipt.visibleTo.includes(perspective),
  );
}
