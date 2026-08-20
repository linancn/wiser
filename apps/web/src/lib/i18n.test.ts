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
});
