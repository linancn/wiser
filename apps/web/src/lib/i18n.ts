export const LOCALES = ['zh-CN', 'en'] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'zh-CN';

export function getTelemetryModeLabel(
  mode: 'none' | 'partial' | 'instrumented',
  locale: Locale,
): string {
  const labels = {
    none: { 'zh-CN': '仅平台边界', en: 'Boundary only' },
    instrumented: {
      'zh-CN': '参与者主动导出',
      en: 'Participant exported',
    },
    partial: {
      'zh-CN': '参与者采样导出',
      en: 'Sampled participant export',
    },
  } as const;
  return labels[mode][locale];
}

export function isLocale(value: string): value is Locale {
  return LOCALES.includes(value as Locale);
}

const zhCN = {
  meta: {
    title: 'WISER 水地图｜多智能体演练可观测性',
    description:
      'WISER Agent EXCON 的多场景管理、协作 Trace 与可见性收据回放。',
  },
  brand: {
    name: 'WISER',
    product: '水地图 · Agent EXCON',
    motto: 'wiser water, better future',
  },
  nav: {
    scenarios: '场景中心',
    runs: '演练运行',
    trace: '协作 Trace',
    docs: '开发文档',
  },
  shell: {
    skip: '跳到主要内容',
    language: '切换界面语言',
    otherLanguage: 'English',
    demo: '设计预览',
    demoDetail: '静态 Operator 管理投影；未连接 API，也不代表生产授权',
    participantBoundary: '智能体入口：Skill + HTTP / MCP',
    observerBoundary: 'Web：场景管理展示、只读导调与回放',
  },
  common: {
    simulationOnly: '仅合成演练',
    published: '已发布',
    retired: '已退役',
    draft: '草稿',
    running: '运行中',
    paused: '已暂停',
    completed: '已完成',
    roles: '角色',
    runs: '运行',
    version: '版本',
    virtualTime: '虚拟时间',
    wallTime: '实际时间',
    readonly: '只读观测',
    back: '返回',
  },
  scenarioCenter: {
    eyebrow: '多场景演练目录',
    heading: '场景中心',
    lede: '当前为 Operator 管理投影设计预览。每个场景独立版本化并声明多智能体角色、阶段契约与评价边界；参训行为仍由外部智能体通过 Skill、HTTP 或 MCP 完成。',
    catalogLabel: '场景目录',
    currentVersion: '当前版本',
    roleSlots: '必需角色',
    activeRuns: '关联运行',
    manage: '管理场景',
    observeRun: '查看运行',
    noLiveRun: '尚无活跃运行',
    riverSignature: '水系统签名',
  },
  orchestration: {
    eyebrow: '场景版本控制面',
    heading: '场景编排',
    lede: '发布版本不可变；角色、信息可见性、预期工件与检查点共同组成团队协作契约。此处展示管理投影，不提供智能体提交入口。',
    rolesHeading: '角色与协作契约',
    rolesLede: 'Run 启动前必须为每个必需角色绑定独立 Agent Session。',
    mission: '职责',
    artifact: '预期工件',
    checkpointsHeading: '双时钟检查点',
    checkpointsLede: '虚拟时点决定信息释放；实际时间用于追踪 Agent 执行耗时。',
    topologyHeading: '水系统任务拓扑',
    versionsHeading: '不可变版本',
    versionNotice: '修改已发布内容时，应基于当前版本创建新草稿。',
    managementBoundary: '管理边界',
    managementCopy:
      '管理员可创建草稿、验证并发布版本；导调观察页始终只读。所有运行期 Inject 与人工 Feedback 必须通过独立受权命令写入审计事件。',
    openTrace: '打开当前 Run Trace',
    returnCatalog: '返回场景中心',
  },
  runList: {
    eyebrow: '复数运行目录',
    heading: '演练运行',
    lede: '每个 Run 固定场景版本和团队编制，并聚合多条 Trace，而不是伪造一条超长调用链。',
    agents: 'Agent Session',
    coverage: '遥测完整性信号',
    open: '查看协作 Trace',
  },
  trace: {
    eyebrow: 'OTel 式协作观测',
    heading: '多智能体协作 Trace',
    lede: '按 Agent 展示并行工作，以父子 Span 表示单一调用链，以 Links 表示跨 Agent 汇聚与异步因果。领域事件仍是完整审计依据。',
    replay: '事件回放',
    scenarios: '场景中心',
    collaborationGraph: '协作河网',
    collaborationGraphLede: '专业工件像支流汇聚到团队提交，再进入确定性裁决。',
    agentLanes: 'Agent 泳道',
    dualClock: '双时钟汇流轴',
    wallClock: 'Wall clock · Span duration',
    virtualClock: 'Virtual clock · 领域检查点',
    excon: '导调中枢 / EXCON',
    agentSession: 'Agent Session',
    version: 'Agent 版本',
    model: '模型入口',
    status: 'Span 状态',
    duration: '耗时',
    operation: 'Operation',
    traceId: 'Trace ID',
    spanId: 'Span ID',
    attributes: '安全属性',
    linkedSpans: 'Span Links',
    linkRelation: '跨 Trace depends_on',
    logs: '关联 Logs',
    logsCopy:
      'LogRecord 通过 traceId / spanId 关联；原始 Prompt 与 Tool payload 默认不采集。',
    inspector: 'Span Inspector',
    selectHint: '选择任一 Agent 或 Span 查看安全投影。',
    coverage: 'Telemetry 覆盖率',
    boundaryCoverage: '平台边界覆盖',
    participantMode: '参与者遥测模式',
    platformSpans: '平台观测 Span',
    participantSpans: '参与者上报 Span',
    droppedSpans: '丢弃 Span',
    lateSpans: '迟到 Span',
    source: '观测来源',
    trust: '信任范围',
    platformObserved: '平台边界观测',
    participantReported: '参与者上报',
    exconService: 'EXCON 服务',
    participantExporter: '参与者 Exporter',
    noTelemetry: '此运行尚无 Agent telemetry；领域事件仍可回放。',
    parallel: '并行',
    converged: '汇聚',
  },
  replay: {
    eyebrow: '收据驱动的知识视角',
    heading: '事件回放',
    lede: '回放历史时刻实际保存的可见性收据，不用当前权限重新推算过去。切换视角会同步事件、证据和 Trace 投影。',
    trace: '返回协作 Trace',
    perspectiveLabel: '回放视角',
    operatorPerspective: '授权导调员',
    operatorVisible: '导调员授权视角：包含内部审计事件',
    agentVisibleSuffix: '当时可见',
    play: '播放',
    pause: '暂停',
    previous: '上一事件',
    next: '下一事件',
    sequence: '事件序号',
    receipt: '可见性收据',
    digest: '审计摘要',
    eventStream: '历史事件收据',
    noEvents: '该视角在此范围内没有可见事件。',
    dualClock: '领域序号是权威 cursor；实际时间只表示遥测发生时刻。',
    authoritative: '权威状态：不可变事件与可见性收据',
    authoritativeCopy: '决定过去某一时刻谁实际看到了什么，并驱动回放投影。',
    telemetryOverlay: 'Best-effort 遥测叠加',
    telemetryOverlayCopy:
      'Span 与 Log 可能采样、晚到或由参与者上报，不用于重算权限或审计状态。',
  },
  footer: {
    product: 'WISER 水地图 · Agent EXCON · MIT 开源',
    boundary: '确定性环境边界 · 多智能体通过 Skill / HTTP / MCP 参训',
  },
};

const en: typeof zhCN = {
  meta: {
    title: 'WISER | Multi-agent exercise observability',
    description:
      'Multi-scenario management, collaborative traces, and visibility-receipt replay for WISER Agent EXCON.',
  },
  brand: {
    name: 'WISER',
    product: 'Water Map · Agent EXCON',
    motto: 'wiser water, better future',
  },
  nav: {
    scenarios: 'Scenario center',
    runs: 'Exercise runs',
    trace: 'Collaboration trace',
    docs: 'Developer docs',
  },
  shell: {
    skip: 'Skip to main content',
    language: 'Switch interface language',
    otherLanguage: '中文',
    demo: 'Design preview',
    demoDetail:
      'Static operator management projection; no API connection or production authorization is implied',
    participantBoundary: 'Agent entry: Skill + HTTP / MCP',
    observerBoundary:
      'Web: scenario management views, read-only EXCON, and replay',
  },
  common: {
    simulationOnly: 'Synthetic exercise only',
    published: 'Published',
    retired: 'Retired',
    draft: 'Draft',
    running: 'Running',
    paused: 'Paused',
    completed: 'Completed',
    roles: 'Roles',
    runs: 'Runs',
    version: 'Version',
    virtualTime: 'Virtual time',
    wallTime: 'Wall time',
    readonly: 'Read-only observability',
    back: 'Back',
  },
  scenarioCenter: {
    eyebrow: 'Multi-scenario exercise catalog',
    heading: 'Scenario center',
    lede: 'This is an operator management-projection preview. Each scenario is independently versioned and declares multi-agent roles, stage contracts, and evaluation boundaries; external agents still participate through Skills, HTTP, or MCP.',
    catalogLabel: 'Scenario catalog',
    currentVersion: 'Current version',
    roleSlots: 'Required roles',
    activeRuns: 'Related runs',
    manage: 'Manage scenario',
    observeRun: 'Observe run',
    noLiveRun: 'No active run yet',
    riverSignature: 'Water-system signature',
  },
  orchestration: {
    eyebrow: 'Scenario version control plane',
    heading: 'Scenario orchestration',
    lede: 'Published versions are immutable. Roles, visibility, expected artifacts, and checkpoints form the team collaboration contract. This is a management projection, not an agent submission surface.',
    rolesHeading: 'Roles and collaboration contracts',
    rolesLede:
      'Every required role must be bound to an independent Agent Session before a Run starts.',
    mission: 'Mission',
    artifact: 'Expected artifact',
    checkpointsHeading: 'Dual-clock checkpoints',
    checkpointsLede:
      'Virtual time releases information; wall time measures agent execution.',
    topologyHeading: 'Water-system task topology',
    versionsHeading: 'Immutable versions',
    versionNotice:
      'Create a new draft from the current version to change published content.',
    managementBoundary: 'Management boundary',
    managementCopy:
      'Administrators can create drafts, validate, and publish versions; the EXCON observation workspace remains read-only. Runtime Injects and manual Feedback use separately authorized commands that append audit events.',
    openTrace: 'Open current Run trace',
    returnCatalog: 'Return to scenario center',
  },
  runList: {
    eyebrow: 'Plural run catalog',
    heading: 'Exercise runs',
    lede: 'Every Run pins a scenario version and team roster, and aggregates multiple traces instead of inventing one oversized call tree.',
    agents: 'Agent Sessions',
    coverage: 'Telemetry completeness signals',
    open: 'Observe collaboration trace',
  },
  trace: {
    eyebrow: 'OTel-style collaboration observability',
    heading: 'Multi-agent collaboration trace',
    lede: 'Parallel work is grouped by Agent. Parent-child spans describe one call chain; Links represent cross-agent convergence and asynchronous causality. Domain events remain the complete audit source.',
    replay: 'Event replay',
    scenarios: 'Scenario center',
    collaborationGraph: 'Collaboration river network',
    collaborationGraphLede:
      'Specialist artifacts converge like tributaries into a team submission and deterministic evaluation.',
    agentLanes: 'Agent lanes',
    dualClock: 'Dual-clock confluence axis',
    wallClock: 'Wall clock · Span duration',
    virtualClock: 'Virtual clock · domain checkpoints',
    excon: 'Exercise control / EXCON',
    agentSession: 'Agent Session',
    version: 'Agent version',
    model: 'Model entry',
    status: 'Span status',
    duration: 'Duration',
    operation: 'Operation',
    traceId: 'Trace ID',
    spanId: 'Span ID',
    attributes: 'Safe attributes',
    linkedSpans: 'Span Links',
    linkRelation: 'Cross-trace depends_on',
    logs: 'Correlated Logs',
    logsCopy:
      'LogRecords correlate by traceId / spanId. Raw prompts and tool payloads are not collected by default.',
    inspector: 'Span Inspector',
    selectHint: 'Select an Agent or Span to inspect its safe projection.',
    coverage: 'Telemetry coverage',
    boundaryCoverage: 'Platform boundary coverage',
    participantMode: 'Participant telemetry mode',
    platformSpans: 'Platform-observed spans',
    participantSpans: 'Participant-reported spans',
    droppedSpans: 'Dropped spans',
    lateSpans: 'Late spans',
    source: 'Observation source',
    trust: 'Trust scope',
    platformObserved: 'Platform boundary observed',
    participantReported: 'Participant reported',
    exconService: 'EXCON service',
    participantExporter: 'Participant exporter',
    noTelemetry:
      'This run has no agent telemetry yet; domain events remain replayable.',
    parallel: 'Parallel',
    converged: 'Converged',
  },
  replay: {
    eyebrow: 'Receipt-driven knowledge perspective',
    heading: 'Event replay',
    lede: 'Replay the visibility receipts captured at the time; never recompute the past from current permissions. Switching perspective synchronizes events, evidence, and trace projections.',
    trace: 'Return to collaboration trace',
    perspectiveLabel: 'Replay perspective',
    operatorPerspective: 'Authorized operator',
    operatorVisible:
      'Authorized operator perspective: includes internal audit events',
    agentVisibleSuffix: 'visible at that time',
    play: 'Play',
    pause: 'Pause',
    previous: 'Previous event',
    next: 'Next event',
    sequence: 'Event sequence',
    receipt: 'Visibility receipt',
    digest: 'Audit digest',
    eventStream: 'Historical event receipts',
    noEvents: 'This perspective has no visible events in the current range.',
    dualClock:
      'Domain sequence is the authoritative cursor; wall time only locates telemetry.',
    authoritative:
      'Authoritative state: immutable events and visibility receipts',
    authoritativeCopy:
      'Determines who actually saw what at the time and drives the replay projection.',
    telemetryOverlay: 'Best-effort telemetry overlay',
    telemetryOverlayCopy:
      'Spans and Logs may be sampled, late, or participant-reported; they never recompute authorization or audit state.',
  },
  footer: {
    product: 'WISER Water Map · Agent EXCON · MIT licensed',
    boundary:
      'Deterministic environment boundary · agents participate through Skill / HTTP / MCP',
  },
};

export const dictionaries = { 'zh-CN': zhCN, en } as const;

export type Dictionary = (typeof dictionaries)[Locale];

export function getDictionary(locale: Locale): Dictionary {
  return dictionaries[locale];
}

export function switchLocalePath(pathname: string, locale: Locale): string {
  const segments = pathname.split('/');
  if (segments.length > 1 && isLocale(segments[1] ?? '')) {
    segments[1] = locale;
    return segments.join('/') || `/${locale}/scenarios`;
  }
  return `/${locale}/scenarios`;
}
