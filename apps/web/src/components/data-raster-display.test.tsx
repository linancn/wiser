// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DataRasterDisplay } from './data-raster-display';
afterEach(cleanup);
it('shows a value legend with explicit unknown units and restores original colors', async () => {
  const onApply = vi.fn(),
    user = userEvent.setup();
  render(<DataRasterDisplay locale="zh-CN" onApply={onApply} />);
  await user.click(screen.getByText('单波段数值显示', { selector: 'summary' }));
  await user.type(screen.getByLabelText('显示下限'), '0');
  await user.type(screen.getByLabelText('显示上限'), '50');
  await user.type(screen.getByLabelText('缺测码（可选）'), '-9999');
  await user.click(screen.getByRole('button', { name: '应用数值配色' }));
  expect(onApply).toHaveBeenLastCalledWith({
    band: 1,
    min: 0,
    max: 50,
    nodata: -9999,
    unit: '',
  });
  expect(
    screen.getByRole('img', { name: '数值颜色图例: 0 – 50' }),
  ).toBeDefined();
  expect(screen.getByText(/单位未知/)).toBeDefined();
  expect(screen.getByText(/透明显示，区别于数值零/)).toBeDefined();
  await user.click(screen.getByRole('button', { name: '恢复原始配色' }));
  expect(onApply).toHaveBeenLastCalledWith(null);
  expect(screen.queryByRole('img')).toBeNull();
});
