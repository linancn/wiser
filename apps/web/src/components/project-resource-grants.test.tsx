// @vitest-environment jsdom
import { afterEach, it, expect, vi } from 'vitest';
import {
  render,
  screen,
  fireEvent,
  cleanup,
  waitFor,
} from '@testing-library/react';
import { ProjectResourceGrants } from './project-resource-grants';
const id = (n: number) =>
  `11111111-1111-4111-8111-${String(n).padStart(12, '0')}`;
const project = {
  projectId: id(1),
  tenantId: id(2),
  nameZh: '研究项目',
  nameEn: 'Research',
  canManage: true,
  canApprove: true,
  requestsEnabled: true,
  resourceAccessEnabled: true,
  memberStatus: 'active',
  expiresAt: null,
  roles: ['manager'],
  assignableRoles: [],
};
const grant = {
  id: id(3),
  actorId: id(4),
  packageId: id(5),
  packageVersion: 1,
  packageName: '水文资料',
  presetId: id(6),
  presetVersion: 1,
  presetName: '研究查阅',
  actions: ['content.read'],
  resourceCount: 2,
  purpose: 'web-console',
  startsAt: '2026-09-23T00:00:00Z',
  expiresAt: '2026-09-30T00:00:00Z',
  status: 'active',
  revokedAt: null,
  reason: '研究任务许可',
  revocationReason: null,
  createdBy: id(7),
  approvedBy: id(8),
};
const page = () =>
  Response.json({
    items: [grant],
    hasMore: false,
    checkedAt: '2026-09-23T00:00:00Z',
  });
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it.each([
  ['zh-CN', 'AI/MCP 访问', '申请续期'],
  ['en', 'AI/MCP access', 'Request renewal'],
] as const)(
  'shows the approved agent purpose and permits independent renewal in %s',
  async (locale, purposeLabel, renewLabel) => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        Promise.resolve(
          Response.json(
            url.includes('/members?')
              ? { items: [], hasMore: false }
              : {
                  items: [{ ...grant, purpose: 'agent-data' }],
                  hasMore: false,
                  checkedAt: grant.startsAt,
                },
          ),
        ),
      ),
    );
    render(
      <ProjectResourceGrants
        project={project}
        viewerId={id(4)}
        locale={locale}
      />,
    );
    await screen.findByText('水文资料');
    expect(screen.getByText(purposeLabel)).toBeDefined();
    expect(screen.getByRole('button', { name: renewLabel })).toBeDefined();
  },
);
it('shows own records without management controls and labels stored state separately from actual access', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(page())),
  );
  render(
    <ProjectResourceGrants
      project={{ ...project, canManage: false }}
      viewerId={id(4)}
      locale="zh-CN"
    />,
  );
  await screen.findByText('水文资料');
  expect(
    screen.getByText('有效期内', { selector: '[data-status]' }),
  ).toBeDefined();
  expect(screen.queryByRole('button', { name: '撤销本项授权' })).toBeNull();
  expect(screen.queryByRole('button', { name: '申请续期' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '授权记录说明' }));
  expect(screen.getByText(/实际访问仍需通过成员状态/)).toBeDefined();
});
it('retries an uncertain selective revocation with the same key and reports remaining independent grants', async () => {
  const calls: RequestInit[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        calls.push(init);
        return Promise.resolve(
          calls.length === 1
            ? Response.json({ code: 'ACCESS_UNAVAILABLE' }, { status: 503 })
            : Response.json({
                grantId: grant.id,
                revokedAt: '2026-09-23T00:00:00Z',
                alreadyRevoked: false,
                otherActiveGrantCount: 1,
              }),
        );
      }
      return Promise.resolve(
        _url.includes('/members?')
          ? Response.json({ items: [], hasMore: false })
          : page(),
      );
    }),
  );
  render(
    <ProjectResourceGrants project={project} viewerId={id(4)} locale="zh-CN" />,
  );
  fireEvent.click(await screen.findByRole('button', { name: '撤销本项授权' }));
  fireEvent.change(screen.getByLabelText('办理原因'), {
    target: { value: '任务结束，撤销本项授权' },
  });
  fireEvent.click(screen.getByRole('button', { name: '确认撤销' }));
  await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: '确认撤销' }));
  await screen.findByText('本项授权已撤销');
  expect(screen.getByText('其他有效期内的独立授权记录：1')).toBeDefined();
  expect(new Headers(calls[0]?.headers).get('idempotency-key')).toBe(
    new Headers(calls[1]?.headers).get('idempotency-key'),
  );
  expect(
    JSON.parse(typeof calls[1]?.body === 'string' ? calls[1].body : ''),
  ).toMatchObject({
    projectId: id(1),
    grantId: grant.id,
  });
});
it('discards a previous project response after switching projects', async () => {
  let resolve: ((r: Response) => void) | undefined;
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) =>
      url.includes(id(1))
        ? new Promise<Response>((r) => {
            resolve = r;
          })
        : Promise.resolve(
            Response.json({
              items: [],
              hasMore: false,
              checkedAt: '2026-09-23T00:00:00Z',
            }),
          ),
    ),
  );
  const view = render(
    <ProjectResourceGrants project={project} viewerId={id(4)} locale="zh-CN" />,
  );
  view.rerender(
    <ProjectResourceGrants
      project={{ ...project, projectId: id(9) }}
      viewerId={id(4)}
      locale="zh-CN"
    />,
  );
  await screen.findByText('暂无符合条件的授权记录。');
  resolve?.(page());
  await waitFor(() => expect(screen.queryByText('水文资料')).toBeNull());
});
it('creates a pending renewal without changing the original grant and supports cancellation', async () => {
  const calls: RequestInit[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        calls.push(init);
        return Promise.resolve(
          Response.json({
            previousGrantId: grant.id,
            batch: {
              id: id(10),
              projectId: id(1),
              version: 1,
              status: 'pending',
              packageId: grant.packageId,
              packageVersion: 1,
              packageName: grant.packageName,
              presetId: grant.presetId,
              presetVersion: 1,
              presetName: grant.presetName,
              resourceCount: 2,
              actions: grant.actions,
              approvalLevel: 'ordinary',
              purpose: 'web-console',
              startsAt: grant.expiresAt,
              expiresAt: '2026-10-05T00:00:00Z',
              validUntil: '2026-09-23T00:15:00Z',
              applicantId: id(7),
              decidedBy: null,
              reason: '延长课题研究资料使用期限',
              decisionReason: null,
              members: [
                {
                  actorId: id(4),
                  displayName: '研究成员',
                  membershipVersion: 1,
                  existingGrantCount: 1,
                  diff: null,
                  status: 'pending',
                  grantId: null,
                  code: null,
                  attempts: 0,
                },
              ],
            },
          }),
        );
      }
      return Promise.resolve(
        _url.includes('/members?')
          ? Response.json({ items: [], hasMore: false })
          : page(),
      );
    }),
  );
  render(
    <ProjectResourceGrants project={project} viewerId={id(4)} locale="zh-CN" />,
  );
  fireEvent.click(await screen.findByRole('button', { name: '申请续期' }));
  fireEvent.click(screen.getByRole('button', { name: '取消办理' }));
  expect(screen.queryByLabelText('新的到期时间')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '申请续期' }));
  fireEvent.change(screen.getByLabelText('办理原因'), {
    target: { value: '延长课题研究资料使用期限' },
  });
  fireEvent.change(screen.getByLabelText('新的到期时间'), {
    target: { value: '2026-09-25T08:00' },
  });
  fireEvent.submit(
    screen.getByRole('button', { name: '生成续期申请' }).closest('form')!,
  );
  await screen.findByText('请填写办理原因，并核对新的到期时间。');
  expect(calls).toHaveLength(0);
  fireEvent.change(screen.getByLabelText('新的到期时间'), {
    target: { value: '2099-10-05T08:00' },
  });
  fireEvent.click(screen.getByRole('button', { name: '生成续期申请' }));
  await screen.findByText('续期申请待审批');
  expect(calls).toHaveLength(1);
  expect(
    JSON.parse(typeof calls[0]?.body === 'string' ? calls[0].body : ''),
  ).toMatchObject({
    grantId: grant.id,
    projectId: project.projectId,
  });
  expect(
    await screen.findByText('有效期内', { selector: '[data-status]' }),
  ).toBeDefined();
});
it('selects members using bounded pages, resets grant paging on status changes and refreshes records', async () => {
  const urls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      urls.push(url);
      if (url.includes('/members?'))
        return Promise.resolve(
          Response.json({
            items: [
              {
                actorId: id(9),
                displayName: '另一位研究成员',
                email: 'reader@example.test',
                status: 'active',
                version: 1,
                expiresAt: null,
                protected: false,
                roles: [],
              },
            ],
            hasMore: !url.includes('offset=20'),
          }),
        );
      return Promise.resolve(
        Response.json({
          items: url.includes('offset=20') ? [] : [grant],
          hasMore: !url.includes('offset=20'),
          checkedAt: '2026-09-23T00:00:00Z',
        }),
      );
    }),
  );
  render(
    <ProjectResourceGrants project={project} viewerId={id(4)} locale="en" />,
  );
  fireEvent.click(
    await screen.findByRole('button', { name: '另一位研究成员' }),
  );
  await waitFor(() =>
    expect(
      urls.some(
        (u) => u.includes('resource-grants?') && u.includes('actorId=' + id(9)),
      ),
    ).toBe(true),
  );
  fireEvent.click(screen.getByRole('button', { name: 'My grants' }));
  fireEvent.change(screen.getByLabelText('Member name or email'), {
    target: { value: '研究' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Find members' }));
  await waitFor(() =>
    expect(urls.some((u) => u.includes('search=%E7%A0%94%E7%A9%B6'))).toBe(
      true,
    ),
  );
  fireEvent.click(screen.getAllByRole('button', { name: 'Next' }).at(-1)!);
  await screen.findByText('No matching grant records.');
  fireEvent.click(screen.getAllByRole('button', { name: 'Previous' }).at(-1)!);
  await screen.findByText('水文资料');
  fireEvent.change(screen.getByLabelText('Grant status'), {
    target: { value: 'expired' },
  });
  await waitFor(() =>
    expect(
      urls.some((u) => u.includes('status=expired') && u.includes('offset=0')),
    ).toBe(true),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Refresh records' }));
  await screen.findByText('水文资料');
});
it.each(['NOT_AUTHORIZED', 'REQUEST_STATE_CONFLICT', 'VALIDATION_FAILED'])(
  'shows safe action failures for %s without exposing server details',
  async (code) => {
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init?: RequestInit) =>
        Promise.resolve(
          init?.method === 'POST'
            ? Response.json(
                { code, detail: 'internal-secret' },
                { status: 403 },
              )
            : page(),
        ),
      ),
    );
    render(
      <ProjectResourceGrants
        project={project}
        viewerId={id(4)}
        locale="zh-CN"
      />,
    );
    fireEvent.click(
      await screen.findByRole('button', { name: '撤销本项授权' }),
    );
    fireEvent.change(screen.getByLabelText('办理原因'), {
      target: { value: '结束此项授权' },
    });
    fireEvent.click(screen.getByRole('button', { name: '确认撤销' }));
    await screen.findByRole('alert');
    expect(screen.queryByText(/internal-secret/)).toBeNull();
  },
);

it('keeps members without a display name selectable by their permitted email', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) =>
      Promise.resolve(
        url.includes('/members?')
          ? Response.json({
              items: [
                {
                  actorId: id(9),
                  displayName: '',
                  email: 'unnamed@example.test',
                  status: 'active',
                  version: 1,
                  expiresAt: null,
                  protected: false,
                  roles: [],
                },
              ],
              hasMore: false,
            })
          : page(),
      ),
    ),
  );
  render(
    <ProjectResourceGrants project={project} viewerId={id(4)} locale="en" />,
  );
  fireEvent.click(
    await screen.findByRole('button', { name: 'unnamed@example.test' }),
  );
  expect(
    screen.getByText('Grant recipient · unnamed@example.test'),
  ).toBeDefined();
});
