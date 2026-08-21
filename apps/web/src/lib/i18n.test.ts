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
      '当前展示导调员使用的管理视图预览。每个场景独立版本化，并明确多智能体角色、阶段契约和评价边界；参训智能体仍通过 Skill、HTTP 或 MCP 与平台交互。',
    );
    expect(dictionaries['zh-CN'].runWorkspace.trace).toBe('追踪');
    expect(dictionaries['zh-CN'].trace.workspaceHeading).toBe('追踪分析');
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

    expect(productCopy).toContain('Skill');
    expect(productCopy).toContain('HTTP');
    expect(productCopy).toContain('MCP');
    expect(productCopy).toContain('OpenTelemetry');
    expect(productCopy).toContain('Span');
    expect(productCopy).not.toMatch(
      /\b(?:Operator|Agent Session|Agent|Run|Trace|Barrier|ArtifactVersion|Receipt|Event|Telemetry|Best-effort|Thread|Operation|Exporter|Revision|Verdict|Evidence|Inject|Feedback|Prompt|Tool|payload|cursor|signal|live|Web|Log|Logs|Metric|Links?)\b/,
    );
  });
});
