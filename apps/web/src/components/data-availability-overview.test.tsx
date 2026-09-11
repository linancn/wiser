// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DataAvailabilityOverview } from './data-availability-overview';
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it('shows a resource denominator and filters the matching list without counting unknown as unavailable', async () => {
  const request = vi.fn<typeof fetch>().mockResolvedValue(
    Response.json({
      target: 'DATASET',
      totalCount: 10,
      checkedCount: 3,
      uncheckedCount: 7,
      selectedCount: 0,
      counts: [
        { action: 'UNCHECKED', count: 7 },
        { action: 'REQUEST_ACCESS', count: 3 },
      ],
      items: [],
    }),
  );
  vi.stubGlobal('fetch', request);
  render(<DataAvailabilityOverview locale="zh-CN" query="" />);
  const user = userEvent.setup();
  await user.click(screen.getByText('取得情况与下一步', { exact: true }));
  await user.click(screen.getByRole('button', { name: '查看核查概况' }));
  await screen.findByText('7 / 10');
  await user.click(screen.getByRole('button', { name: '未核查 · 7' }));
  const body: unknown = JSON.parse(
    request.mock.calls.at(-1)?.[1]?.body as string,
  );
  expect(body).toMatchObject({ target: 'DATASET', action: 'UNCHECKED' });
  expect(screen.queryByText('不可得')).toBeNull();
});
