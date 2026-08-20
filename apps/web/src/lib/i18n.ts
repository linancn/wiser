export const LOCALES = ['zh-CN', 'en'] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'zh-CN';

export function isLocale(value: string): value is Locale {
  return LOCALES.includes(value as Locale);
}

const zhCN = {
  meta: {
    title: 'WISER 水地图｜Agent EXCON 智能体演练场',
    description:
      '水地图：AI 赋能的水智能系统与重构引擎；当前展示可运行、可裁决、可回放的 Agent EXCON 环境。',
  },
  a11y: {
    skip: '跳到主要内容',
    language: '切换界面语言',
    otherLanguage: 'English',
    timeline: '演练时间轨',
    network: '京津冀永定河补水链路',
  },
  brand: {
    name: 'WISER',
    product: '水地图 · Agent EXCON',
    role: '智能体演练场',
    environment: '本地可信开发',
  },
  nav: {
    scenario: '场景说明',
    console: '导调控制台',
    replay: '事件回放',
    docs: '开发文档',
  },
  hero: {
    kicker: '事实锚定合成演练 · 京津冀水系统',
    summary:
      '参训智能体在分阶段信息下编制未来 24 小时联合调度方案；确定性规则负责裁决，全部演练数据与现实运行系统隔离。',
    mode: '演练模式',
    modeValue: '仅合成数据',
    clock: '演练时钟',
    clockValue: 'T+12:00',
    currentPhase: '当前阶段',
    currentPhaseValue: '来水修订',
    openConsole: '进入导调台',
    readScenario: '查看场景边界',
  },
  scenario: {
    eyebrow: '任务简报',
    heading: '场景说明',
    lede: '公开资料只用于锚定水系拓扑、水源类别和控制位置；可用量、阈值、成本、观测与结果均为固定合成值。',
    boundaryTitle: '演练边界',
    boundary:
      '决策域限定在京津冀水系统。晋蒙上游来水作为带来源与时态的边界输入，不代表跨行政区指挥关系。',
    taskTitle: '智能体任务',
    task: '在水量守恒、通道能力、传播时滞、生态流量和水质混合约束下，形成可解释、可复算的 24 小时调度方案。',
    verdictTitle: '裁决原则',
    verdict:
      'Schema、权限、证据可见性与工程约束由确定性程序检查；AI 不生成分数或最终结论。',
    sourceLabel: '事实水源类别',
    locationLabel: '关键控制位置',
    disclaimer: '演练数据 · 不用于现实调度',
  },
  console: {
    eyebrow: '运行可观测性',
    heading: '导调控制台',
    lede: '只读观察信息释放、智能体响应与确定性裁决。实际运行由 Skill 通过 HTTP 或 MCP 发起。',
    status: '演练进行中',
    agentLabel: '参训智能体',
    agentValue: 'allocation-agent-a / v1.0.0',
    providerLabel: '开发算力',
    providerValue: '本机 Codex 订阅',
    checkpointLabel: '下一检查点',
    checkpointValue: 'T+14 修订方案',
    evidenceLabel: '已释放证据',
    evidenceValue: '9 / 14 项',
    versionLabel: '场景 / 方案版本',
    versionValue: 'v1 / submission v1',
    scoreLabel: '确定性得分',
    scoreValue: '82 / 100',
    scoreNote: '合成目标满足度',
    traceTitle: '智能体运行链路',
    traceNote: 'Inject → Observation → Submission → Evaluation → Feedback',
    filtersLabel: '筛选事件类型',
    filterAll: '全部事件',
    filterInject: '信息注入',
    filterObservation: '观测形成',
    filterSubmission: '方案提交',
    filterEvaluation: '规则裁决',
    filterFeedback: '反馈返回',
    readonly: '只读观测',
    transport: 'Agent 运行入口 · Skill + HTTP / MCP',
    systemTitle: '水系链路状态',
    flowUnit: '合成流量单位',
    released: '已释放',
    pending: '待释放',
    observed: '已观测',
  },
  replay: {
    eyebrow: '可复现证据',
    heading: '事件回放',
    lede: '沿同一时间轨回看信息释放、智能体提交、规则反馈与方案修订。',
    play: '播放回放',
    pause: '暂停回放',
    reset: '回到起点',
    current: '当前事件',
    sequence: '事件序号',
    virtualTime: '虚拟时间',
    actor: '执行主体',
    hash: '审计摘要',
    eventList: '事件列表',
  },
  footer: {
    note: 'WISER 水地图 · Agent EXCON · MIT 开源',
    architecture: 'HTTP API 是界面与演练内核之间的唯一边界',
  },
};

const en: typeof zhCN = {
  meta: {
    title: 'WISER | Agent EXCON observability',
    description:
      'Water Intelligence System & Engine for Reconfiguration, empowered by AI; showing the runnable and replayable Agent EXCON environment.',
  },
  a11y: {
    skip: 'Skip to main content',
    language: 'Switch interface language',
    otherLanguage: '中文',
    timeline: 'Exercise timeline',
    network: 'Yongding River replenishment network',
  },
  brand: {
    name: 'WISER',
    product: 'Water Map · Agent EXCON',
    role: 'Agent exercise field',
    environment: 'Trusted local development',
  },
  nav: {
    scenario: 'Scenario brief',
    console: 'Control room',
    replay: 'Event replay',
    docs: 'Developer docs',
  },
  hero: {
    kicker: 'Fact-anchored synthetic exercise · Jing-Jin-Ji water system',
    summary:
      'The agent prepares a 24-hour joint allocation plan as information is released in stages. Deterministic rules judge the plan; all exercise data stays isolated from real operations.',
    mode: 'Exercise mode',
    modeValue: 'Synthetic data only',
    clock: 'Exercise clock',
    clockValue: 'T+12:00',
    currentPhase: 'Current phase',
    currentPhaseValue: 'Inflow revision',
    openConsole: 'Open control room',
    readScenario: 'Review scenario boundary',
  },
  scenario: {
    eyebrow: 'Mission brief',
    heading: 'Scenario brief',
    lede: 'Public sources anchor only the network topology, source categories and control locations. Availability, thresholds, costs, observations and outcomes are fixed synthetic values.',
    boundaryTitle: 'Exercise boundary',
    boundary:
      'The decision domain is limited to the Jing-Jin-Ji water system. Upstream inflow from Shanxi and Inner Mongolia is a sourced, time-stamped boundary input—not a claim of cross-jurisdiction authority.',
    taskTitle: 'Agent task',
    task: 'Produce an explainable, reproducible 24-hour plan under mass balance, channel capacity, travel-time, ecological-flow and water-quality mixing constraints.',
    verdictTitle: 'Judging rule',
    verdict:
      'Deterministic code checks schemas, access, evidence visibility and engineering constraints. AI produces neither scores nor final verdicts.',
    sourceLabel: 'Fact-anchored source types',
    locationLabel: 'Key control locations',
    disclaimer: 'Exercise data · Not for operational use',
  },
  console: {
    eyebrow: 'Runtime observability',
    heading: 'Control room',
    lede: 'Observe information releases, agent responses and deterministic verdicts. Skills start real runs through HTTP or MCP.',
    status: 'Exercise running',
    agentLabel: 'Participant agent',
    agentValue: 'allocation-agent-a / v1.0.0',
    providerLabel: 'Development compute',
    providerValue: 'Local Codex subscription',
    checkpointLabel: 'Next checkpoint',
    checkpointValue: 'T+14 revised plan',
    evidenceLabel: 'Evidence released',
    evidenceValue: '9 / 14 items',
    versionLabel: 'Scenario / plan version',
    versionValue: 'v1 / submission v1',
    scoreLabel: 'Deterministic score',
    scoreValue: '82 / 100',
    scoreNote: 'Synthetic target attainment',
    traceTitle: 'Agent execution trace',
    traceNote: 'Inject → Observation → Submission → Evaluation → Feedback',
    filtersLabel: 'Filter event type',
    filterAll: 'All events',
    filterInject: 'Inject',
    filterObservation: 'Observation',
    filterSubmission: 'Submission',
    filterEvaluation: 'Evaluation',
    filterFeedback: 'Feedback',
    readonly: 'Read-only observability',
    transport: 'Agent runtime entry · Skill + HTTP / MCP',
    systemTitle: 'Water network status',
    flowUnit: 'synthetic flow units',
    released: 'Released',
    pending: 'Pending',
    observed: 'Observed',
  },
  replay: {
    eyebrow: 'Reproducible evidence',
    heading: 'Event replay',
    lede: 'Use the shared timeline to review information releases, agent submissions, rule feedback and plan revisions.',
    play: 'Play replay',
    pause: 'Pause replay',
    reset: 'Return to start',
    current: 'Current event',
    sequence: 'Event sequence',
    virtualTime: 'Virtual time',
    actor: 'Actor',
    hash: 'Audit digest',
    eventList: 'Event list',
  },
  footer: {
    note: 'WISER Water Map · Agent EXCON · MIT licensed',
    architecture:
      'The HTTP API is the only boundary between the interface and exercise core',
  },
};

export const dictionaries = { 'zh-CN': zhCN, en } as const;

export type Dictionary = (typeof dictionaries)[Locale];

export function getDictionary(locale: Locale): Dictionary {
  return dictionaries[locale];
}
