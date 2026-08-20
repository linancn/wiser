import type { Locale } from './i18n';

type LocalizedText = Record<Locale, string>;

export interface WaterSource {
  id: string;
  name: LocalizedText;
  detail: LocalizedText;
  flow: number;
  state: 'released' | 'pending' | 'observed';
}

export interface ReplayEvent {
  sequence: number;
  time: string;
  category: 'inject' | 'observation' | 'submission' | 'evaluation' | 'feedback';
  type: LocalizedText;
  detail: LocalizedText;
  actor: LocalizedText;
  digest: string;
}

export const yongdingScenario = {
  id: 'yongding-2023-ecological-replenishment',
  simulationOnly: true,
  title: {
    'zh-CN': '2023 永定河春季生态补水——京津冀多水源联合调度（事实锚定合成版）',
    en: '2023 Yongding River Spring Ecological Replenishment — Jing-Jin-Ji Multi-source Dispatch (Fact-anchored Synthetic Edition)',
  },
  shortName: {
    'zh-CN': '永定河联合调度',
    en: 'Yongding joint dispatch',
  },
  sources: [
    {
      id: 'upstream-reservoir-group',
      name: { 'zh-CN': '上游水库群', en: 'Upstream reservoir group' },
      detail: { 'zh-CN': '册田 · 友谊 · 洋河', en: 'Cetian · Youyi · Yanghe' },
      flow: 14.2,
      state: 'released',
    },
    {
      id: 'guanting-release',
      name: { 'zh-CN': '官厅水库', en: 'Guanting Reservoir' },
      detail: { 'zh-CN': '合成下泄过程', en: 'Synthetic release profile' },
      flow: 18.5,
      state: 'observed',
    },
    {
      id: 'middle-route-transfer',
      name: { 'zh-CN': '南水北调中线', en: 'Middle Route transfer' },
      detail: {
        'zh-CN': '引江补充水源',
        en: 'Transferred supplementary source',
      },
      flow: 7.8,
      state: 'released',
    },
    {
      id: 'xiaohongmen-reclaimed',
      name: { 'zh-CN': '小红门再生水', en: 'Xiaohongmen reclaimed water' },
      detail: { 'zh-CN': '下游连续补水', en: 'Continuous downstream supply' },
      flow: 5.4,
      state: 'pending',
    },
  ] satisfies WaterSource[],
  locations: [
    { 'zh-CN': '官厅水库', en: 'Guanting Reservoir' },
    { 'zh-CN': '三家店', en: 'Sanjiadian' },
    { 'zh-CN': '卢沟桥', en: 'Lugou Bridge' },
    { 'zh-CN': '崔指挥营', en: 'Cuizhihuiying' },
  ] satisfies LocalizedText[],
  events: [
    {
      sequence: 1,
      time: 'T+00:00',
      category: 'inject',
      type: { 'zh-CN': '场景版本锁定', en: 'Scenario version locked' },
      detail: {
        'zh-CN': '拓扑、水源快照与控制目标已释放。',
        en: 'Topology, source snapshot and control targets released.',
      },
      actor: { 'zh-CN': '导调中枢', en: 'Exercise control' },
      digest: 'a13c…91fe',
    },
    {
      sequence: 2,
      time: 'T+00:01',
      category: 'observation',
      type: { 'zh-CN': '初始观测形成', en: 'Initial observations created' },
      detail: {
        'zh-CN': '水源快照与控制断面基线进入智能体可见集。',
        en: 'Source snapshot and control-section baseline entered the agent-visible set.',
      },
      actor: { 'zh-CN': '观测服务', en: 'Observation service' },
      digest: 'b21a…4e90',
    },
    {
      sequence: 3,
      time: 'T+06:00',
      category: 'submission',
      type: { 'zh-CN': '首轮方案提交', en: 'Initial plan submitted' },
      detail: {
        'zh-CN': '智能体提交 24 小时多水源分配方案 v1。',
        en: 'Agent submitted 24-hour multi-source allocation plan v1.',
      },
      actor: { 'zh-CN': '参训智能体', en: 'Participant agent' },
      digest: 'c72e…308a',
    },
    {
      sequence: 4,
      time: 'T+06:01',
      category: 'evaluation',
      type: { 'zh-CN': '确定性检查', en: 'Deterministic checks' },
      detail: {
        'zh-CN': '完成水量守恒、容量、时滞与证据可见性检查。',
        en: 'Mass-balance, capacity, travel-time and evidence-visibility checks completed.',
      },
      actor: { 'zh-CN': '规则引擎', en: 'Rules engine' },
      digest: 'd08d…6bd2',
    },
    {
      sequence: 5,
      time: 'T+06:02',
      category: 'feedback',
      type: { 'zh-CN': 'L2 反馈返回', en: 'L2 feedback returned' },
      detail: {
        'zh-CN': '容量与证据检查通过；卢沟桥目标需要修订。',
        en: 'Capacity and evidence checks passed; Lugou Bridge target needs revision.',
      },
      actor: { 'zh-CN': '反馈服务', en: 'Feedback service' },
      digest: 'e15f…2aa1',
    },
    {
      sequence: 6,
      time: 'T+12:00',
      category: 'inject',
      type: { 'zh-CN': '来水修订释放', en: 'Inflow revision released' },
      detail: {
        'zh-CN': '上游合成来水下调，新增卢沟桥断面观测。',
        en: 'Synthetic upstream inflow revised down; Lugou Bridge observation added.',
      },
      actor: { 'zh-CN': '导调中枢', en: 'Exercise control' },
      digest: 'f39f…12c7',
    },
    {
      sequence: 7,
      time: 'T+12:01',
      category: 'observation',
      type: { 'zh-CN': '断面观测形成', en: 'Section observation created' },
      detail: {
        'zh-CN': '卢沟桥断面合成观测进入智能体可见集。',
        en: 'Synthetic Lugou Bridge observation entered the agent-visible set.',
      },
      actor: { 'zh-CN': '观测服务', en: 'Observation service' },
      digest: '09ac…ec43',
    },
  ] satisfies ReplayEvent[],
} as const;

export type Scenario = typeof yongdingScenario;
