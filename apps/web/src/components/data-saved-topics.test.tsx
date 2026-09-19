// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, act, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DataSavedTopics } from './data-saved-topics';
const first = {
  viewId: '10000000-0000-4000-8000-000000000001',
  title: '永定河',
  visibility: 'private',
  createdAt: '2026-09-18T09:00:00Z',
  revokedAt: null,
};
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it('opens exact saved topics and distinguishes same titles without treating title lookup as resource search', async () => {
  const fetch = vi.fn().mockResolvedValue(
    Response.json({
      items: [
        first,
        {
          ...first,
          viewId: '20000000-0000-4000-8000-000000000002',
          visibility: 'project',
        },
      ],
    }),
  );
  vi.stubGlobal('fetch', fetch);
  const user = userEvent.setup();
  render(<DataSavedTopics locale="zh-CN" />);
  const links = await screen.findAllByRole('link', { name: /^永定河/ });
  expect(links.map((a) => a.getAttribute('href'))).toEqual([
    '/zh-CN/data-foundation/explore?saved=' + first.viewId,
    '/zh-CN/data-foundation/explore?saved=20000000-0000-4000-8000-000000000002',
  ]);
  expect(within(links[0].closest('li')!).getByText('仅自己')).toBeTruthy();
  expect(
    within(links[1].closest('li')!).getByText('有权限的项目成员'),
  ).toBeTruthy();
  expect(screen.getByRole('link', { name: /永定河.*仅自己/ })).toBe(links[0]);
  expect(screen.getByRole('link', { name: /永定河.*有权限的项目成员/ })).toBe(
    links[1],
  );
  await user.type(screen.getByLabelText('查找已保存专题'), '无此专题');
  expect(screen.queryByRole('link', { name: /^永定河/ })).toBeNull();
  expect(
    screen.getByText('这些已保存专题中没有匹配名称，可清除文字重新选择。'),
  ).toBeTruthy();
  expect(fetch).toHaveBeenCalledTimes(1);
  await user.click(screen.getByRole('button', { name: '清除专题筛选' }));
  expect(screen.getAllByRole('link', { name: /^永定河/ })).toHaveLength(2);
  expect(document.activeElement).toBe(screen.getByLabelText('查找已保存专题'));
});
it('discards a late earlier response and clears retained topic names when access fails', async () => {
  let resolve!: (response: Response) => void;
  const fetch = vi
    .fn()
    .mockReturnValueOnce(
      new Promise<Response>((r) => {
        resolve = r;
      }),
    )
    .mockResolvedValueOnce(
      Response.json({ items: [{ ...first, title: '当前专题' }] }),
    )
    .mockResolvedValueOnce(new Response('private diagnostic', { status: 403 }));
  vi.stubGlobal('fetch', fetch);
  const user = userEvent.setup();
  render(<DataSavedTopics locale="zh-CN" />);
  await user.click(screen.getByRole('button', { name: '刷新专题' }));
  await screen.findByRole('link', { name: /^当前专题/ });
  const late = Response.json({ items: [first] });
  const parsed = vi.spyOn(late, 'json').mockResolvedValue({ items: [first] });
  await act(async () => {
    resolve(late);
    await Promise.resolve();
  });
  expect(parsed).toHaveBeenCalled();
  expect(screen.queryByRole('link', { name: /^永定河/ })).toBeNull();
  expect(screen.getByRole('link', { name: /^当前专题/ })).toBeTruthy();
  await user.click(screen.getByRole('button', { name: '刷新专题' }));
  await screen.findByRole('alert');
  expect(screen.queryByRole('link', { name: /^当前专题/ })).toBeNull();
  expect(screen.queryByText('private diagnostic')).toBeNull();
});
it('keeps empty and bounded topic results explicit, excluding revoked views', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(
        Response.json({ items: [{ ...first, revokedAt: first.createdAt }] }),
      ),
  );
  render(<DataSavedTopics locale="en" />);
  await screen.findByText(
    'No saved topics are available. Open data exploration to save a view.',
  );
  expect(screen.queryByRole('link', { name: /^永定河/ })).toBeNull();
  expect(
    screen.getByText(
      'Up to 100 authorized saved views; this list is not the complete project. Opening a topic checks source access again.',
    ),
  ).toBeTruthy();
});
