import { expect, it } from 'vitest';
import { businessPeriod } from './business-period';

it('selects inclusive calendar months across leap years and year boundaries', () => {
  expect(businessPeriod('2024-01-31', 'month', 1)).toEqual({
    from: '2024-02-01',
    to: '2024-02-29',
  });
  expect(businessPeriod('2025-01-01', 'month', -1)).toEqual({
    from: '2024-12-01',
    to: '2024-12-31',
  });
  expect(businessPeriod('2025-02-28', 'month', 0)).toEqual({
    from: '2025-02-01',
    to: '2025-02-28',
  });
});
it('selects whole years without converting annual observations into monthly records', () => {
  expect(businessPeriod('2024-02-29', 'year', 1)).toEqual({
    from: '2025-01-01',
    to: '2025-12-31',
  });
  expect(businessPeriod('2024-02-29', 'year', -1)).toEqual({
    from: '2023-01-01',
    to: '2023-12-31',
  });
});
it('refuses absent, invalid or overflowing anchors instead of guessing a period', () => {
  for (const value of [
    null,
    '',
    '2025-02-29',
    '2025-13-01',
    '2025-01-32',
    '2025-1-1',
    'not-a-date',
  ])
    expect(businessPeriod(value, 'month', 1)).toBeNull();
  expect(businessPeriod('0001-01-01', 'year', -1)).toBeNull();
  expect(businessPeriod('9999-12-31', 'month', 1)).toBeNull();
  expect(businessPeriod('0099-12-01', 'month', 1)).toEqual({
    from: '0100-01-01',
    to: '0100-01-31',
  });
});
