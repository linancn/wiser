import type {
  LocalizedTextSchema,
  ObservationDto,
  WaterSectionId,
  WaterSourceId,
} from '@agent-excon/contracts';
import type { z } from 'zod';

export const DEFAULT_SCENARIO_VERSION_ID = 'jjj-yongding-replenishment-2023-v1';

type LocalizedText = z.infer<typeof LocalizedTextSchema>;

export interface ScenarioCheckpoint {
  readonly stage: 1 | 2;
  readonly virtualTime: string;
  readonly title: LocalizedText;
}

export interface ScenarioDocument {
  readonly id: 'jing-jin-ji-yongding-river';
  readonly versionId: typeof DEFAULT_SCENARIO_VERSION_ID;
  readonly defaultLocale: 'zh-CN';
  readonly simulationOnly: true;
  readonly title: LocalizedText;
  readonly description: LocalizedText;
  readonly safetyNotice: LocalizedText;
  readonly replayStartAt: string;
  readonly checkpoints: readonly ScenarioCheckpoint[];
  readonly sources: readonly {
    readonly id: WaterSourceId;
    readonly name: LocalizedText;
  }[];
  readonly sections: readonly {
    readonly id: WaterSectionId;
    readonly name: LocalizedText;
  }[];
}

export interface ScenarioInformation extends Omit<
  ObservationDto,
  'accessedTime' | 'episodeId' | 'id'
> {
  readonly id: string;
}

export const DEFAULT_SCENARIO: ScenarioDocument =
  Object.freeze<ScenarioDocument>({
    id: 'jing-jin-ji-yongding-river',
    versionId: DEFAULT_SCENARIO_VERSION_ID,
    defaultLocale: 'zh-CN',
    simulationOnly: true,
    title: {
      'zh-CN': '2023 京津冀永定河生态补水与多水源联合调度',
      en: '2023 Jing-Jin-Ji Yongding River ecological replenishment and multi-source allocation',
    },
    description: {
      'zh-CN':
        '参训智能体通过 Skill 观察分阶段水情，编制官厅水库、南水北调来水与下游再生水的 24 小时联合调度方案。',
      en: 'A participant agent uses Skills to observe staged water-system information and prepare a 24-hour joint allocation plan across Guanting Reservoir, transferred water, and downstream reclaimed water.',
    },
    safetyNotice: {
      'zh-CN':
        '这是事实背景锚定的合成演练。所有流量、阈值、约束和结果均为 simulation-only，不连接实时控制系统，也不构成现实调度建议。',
      en: 'This is a fact-anchored synthetic exercise. Every flow, threshold, constraint, and outcome is simulation-only; it is not connected to a live control system and is not operational advice.',
    },
    replayStartAt: '2023-03-22T07:00:00.000Z',
    checkpoints: [
      {
        stage: 1,
        virtualTime: '2023-03-22T07:00:00.000Z',
        title: {
          'zh-CN': '阶段一：形成初始联合调度方案',
          en: 'Stage one: prepare the initial joint allocation plan',
        },
      },
      {
        stage: 2,
        virtualTime: '2023-03-23T03:10:00.000Z',
        title: {
          'zh-CN': '阶段二：根据合成来水修订方案',
          en: 'Stage two: revise the plan after the synthetic inflow update',
        },
      },
    ],
    sources: [
      {
        id: 'guanting',
        name: { 'zh-CN': '官厅水库下泄', en: 'Guanting Reservoir release' },
      },
      {
        id: 'south-water',
        name: {
          'zh-CN': '南水北调中线来水',
          en: 'South-to-North Water Diversion supply',
        },
      },
      {
        id: 'reclaimed-lower',
        name: {
          'zh-CN': '下游再生水',
          en: 'Downstream reclaimed water',
        },
      },
    ],
    sections: [
      { id: 'sanjiadian', name: { 'zh-CN': '三家店', en: 'Sanjiadian' } },
      { id: 'lugouqiao', name: { 'zh-CN': '卢沟桥', en: 'Lugouqiao' } },
      {
        id: 'cuizhihuiying',
        name: {
          'zh-CN': '翠之汇营（合成控制点）',
          en: 'Cuizhihuiying (synthetic control point)',
        },
      },
      { id: 'qujiadian', name: { 'zh-CN': '屈家店', en: 'Qujiadian' } },
    ],
  });

export const SCENARIO_INFORMATION: readonly ScenarioInformation[] =
  Object.freeze([
    {
      id: 'official-flow-20230322-guanting',
      informationId: 'official-flow-20230322-guanting',
      informationType: 'official_flow_anchor',
      eventTime: '2023-03-22T00:00:00.000Z',
      observedTime: '2023-03-22T00:00:00.000Z',
      ingestedTime: '2023-03-22T06:56:00.000Z',
      releasedTime: '2023-03-22T07:00:00.000Z',
      payload: {
        sourceId: 'guanting',
        maximumFlowM3s: 24,
        unit: 'm3/s',
        provenance: 'simulation-only',
      },
      isSynthetic: true,
    },
    {
      id: 'official-flow-20230322-lugouqiao',
      informationId: 'official-flow-20230322-lugouqiao',
      informationType: 'simulated_constraint',
      eventTime: '2023-03-22T00:00:00.000Z',
      observedTime: '2023-03-22T00:00:00.000Z',
      ingestedTime: '2023-03-22T06:57:00.000Z',
      releasedTime: '2023-03-22T07:00:00.000Z',
      payload: {
        sourceId: 'south-water',
        maximumFlowM3s: 10,
        unit: 'm3/s',
        provenance: 'simulation-only',
      },
      isSynthetic: true,
    },
    {
      id: 'official-flow-20230322-cuizhihuiying',
      informationId: 'official-flow-20230322-cuizhihuiying',
      informationType: 'simulated_constraint',
      eventTime: '2023-03-22T00:00:00.000Z',
      observedTime: '2023-03-22T00:00:00.000Z',
      ingestedTime: '2023-03-22T06:58:00.000Z',
      releasedTime: '2023-03-22T07:00:00.000Z',
      payload: {
        sourceId: 'reclaimed-lower',
        maximumFlowM3s: 6,
        unit: 'm3/s',
        provenance: 'simulation-only',
      },
      isSynthetic: true,
    },
    {
      id: 'simulated-update-20230323-corridor',
      informationId: 'simulated-update-20230323-corridor',
      informationType: 'simulated_constraint_update',
      eventTime: '2023-03-23T00:00:00.000Z',
      observedTime: '2023-03-23T00:20:00.000Z',
      ingestedTime: '2023-03-23T03:09:00.000Z',
      releasedTime: '2023-03-23T03:10:00.000Z',
      payload: {
        constraintVersion: 'yongding-stage-2-v1',
        note: {
          'zh-CN': '合成通道约束更新已发布，请修订第二阶段方案。',
          en: 'A synthetic corridor constraint update is available; revise the stage-two plan.',
        },
        provenance: 'simulation-only',
      },
      isSynthetic: true,
    },
  ]);
