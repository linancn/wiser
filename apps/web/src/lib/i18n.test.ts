import { describe, expect, it } from 'vitest';

import { DEFAULT_LOCALE, dictionaries, isLocale, LOCALES } from './i18n';
import { scenarios } from './platform';

function keysOf(value: unknown, prefix = ''): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => keysOf(item, `${prefix}.${index}`));
  }

  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, item]) =>
      keysOf(item, prefix ? `${prefix}.${key}` : key),
    );
  }

  return [prefix];
}

function stringsOf(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(stringsOf);
  if (value && typeof value === 'object') {
    return Object.values(value).flatMap(stringsOf);
  }
  return [];
}

describe('bilingual product contract', () => {
  it('uses Simplified Chinese as the default and only exposes supported routes', () => {
    expect(DEFAULT_LOCALE).toBe('zh-CN');
    expect(LOCALES).toEqual(['zh-CN', 'en']);
    expect(isLocale('zh-CN')).toBe(true);
    expect(isLocale('en')).toBe(true);
    expect(isLocale('en-US')).toBe(false);
  });

  it('keeps every visible message present in both dictionaries', () => {
    expect(keysOf(dictionaries.en).sort()).toEqual(
      keysOf(dictionaries['zh-CN']).sort(),
    );
  });

  it('names peer systems consistently and gives the public portal a human entry point', () => {
    expect(dictionaries['zh-CN'].systems.agentExcon).toBe('智能体演练场');
    expect(dictionaries['zh-CN'].nav.runs).toBe('演练运行');
    expect(dictionaries['zh-CN'].portal.heading).toBe(
      '让可信数据与智能体协作服务于每一次水系统决策',
    );
    expect(dictionaries.en.portal.heading).toBe(
      'Trusted data and agent collaboration for every water-system decision',
    );
  });

  it('keeps internal diagnostics out of ordinary failure messages', () => {
    const ordinaryFailureCopy = stringsOf({
      excon: dictionaries['zh-CN'].dataSource,
      data: dictionaries['zh-CN'].dataFoundation.failures,
    }).join('\n');

    expect(ordinaryFailureCopy).not.toMatch(
      /HTTP\s*\d{3}|AGENT_EXCON_|WISER_[A-Z_]+|\/health\/ready|Capability Registry|DTO|网页服务端|API 日志/,
    );
  });

  it('keeps Yongding as the first case inside a multi-scenario catalog', () => {
    expect(scenarios[0]?.id).toBe('yongding-2023-ecological-replenishment');
    expect(scenarios[0]?.title['zh-CN']).toBe(
      '2023 永定河春季生态补水——京津冀多水源联合调度（事实锚定合成版）',
    );
    expect(scenarios.length).toBeGreaterThanOrEqual(3);
    expect(JSON.stringify({ dictionaries, scenarios })).not.toContain(
      ['防', '汛'].join(''),
    );
  });

  it('uses professional Chinese product terminology while retaining protocol names', () => {
    expect(dictionaries['zh-CN'].scenarioCenter.lede).toBe(
      '浏览和管理多智能体演练场景。每个场景定义参与角色、任务阶段和评测要求。',
    );
    expect(dictionaries['zh-CN'].runWorkspace.trace).toBe('追踪');
    expect(dictionaries['zh-CN'].trace.workspaceHeading).toBe('执行追踪');
    expect(dictionaries['zh-CN'].shell.themeToDark).toBe('切换至深色模式');
    expect(dictionaries['zh-CN'].shell.themeToLight).toBe('切换至浅色模式');

    const productCopy = stringsOf({
      shell: dictionaries['zh-CN'].shell,
      scenarioCenter: dictionaries['zh-CN'].scenarioCenter,
      orchestration: dictionaries['zh-CN'].orchestration,
      runList: dictionaries['zh-CN'].runList,
      runWorkspace: dictionaries['zh-CN'].runWorkspace,
      runOverview: dictionaries['zh-CN'].runOverview,
      collaboration: dictionaries['zh-CN'].collaboration,
      trace: dictionaries['zh-CN'].trace,
      diagnostics: dictionaries['zh-CN'].diagnostics,
      replay: dictionaries['zh-CN'].replay,
    })
      .join('\n')
      .replaceAll('Agent EXCON', '');

    expect(productCopy).toContain('OpenTelemetry');
    expect(productCopy).toContain('Span');
    expect(productCopy).not.toMatch(
      /WISER_[A-Z_]+|AGENT_EXCON_|Capability Registry|DTO|DAL|\/health\//,
    );
    expect(productCopy).not.toMatch(
      /\b(?:Operator|Agent Session|Agent|Run|Trace|Barrier|ArtifactVersion|Receipt|Event|Telemetry|Best-effort|Thread|Operation|Exporter|Revision|Verdict|Evidence|Inject|Feedback|Prompt|Tool|payload|cursor|signal|live|Web|Log|Logs|Metric|Links?)\b/,
    );
  });
});
