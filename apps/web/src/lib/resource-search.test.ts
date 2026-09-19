import { expect, it } from 'vitest';
import { resourceSearchMatch, resourceSearchExamples } from './resource-search';
it('explains the applied name/registration search, not unsubmitted draft text or provider display aliases', () => {
  expect(resourceSearchMatch('永定河报告', '永定河')).toBe('name');
  expect(resourceSearchMatch('Water report', 'water')).toBe('name');
  expect(resourceSearchMatch('月报', '监测中心')).toBe('registration');
  expect(resourceSearchMatch('月报', '%')).toBe('pattern');
  expect(resourceSearchMatch('月报', undefined)).toBeNull();
});
it('offers distinct real indexed names only, bounded to the search contract', () => {
  expect(
    resourceSearchExamples([
      { name: '甲' },
      { name: '甲' },
      { name: '乙' },
      { name: '丙' },
      { name: '丁' },
      { name: 'x'.repeat(513) },
    ]),
  ).toEqual(['甲', '乙', '丙']);
  expect(
    resourceSearchExamples([
      { name: '100%覆盖' },
      { name: '测试_资料' },
      { name: '普通资料' },
    ]),
  ).toEqual(['普通资料']);
});
