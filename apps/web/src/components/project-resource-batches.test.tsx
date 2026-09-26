// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { StrictMode } from 'react';
import {
  cleanup,
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from '@testing-library/react';
import { ProjectResourceBatches } from './project-resource-batches';
function requestBody(value: RequestInit['body']) {
  if (typeof value !== 'string') throw Error('Expected JSON body');
  return value;
}
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
const batch = {
  id: id(3),
  projectId: id(1),
  version: 1,
  status: 'pending',
  packageId: id(4),
  packageVersion: 1,
  packageName: '公开水文资料',
  presetId: id(5),
  presetVersion: 1,
  presetName: '研究查阅',
  resourceCount: 2,
  actions: ['content.read'],
  approvalLevel: 'ordinary',
  purpose: 'web-console',
  startsAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 86400000).toISOString(),
  validUntil: new Date(Date.now() + 900000).toISOString(),
  applicantId: id(6),
  decidedBy: null,
  reason: '研究资料查阅申请',
  decisionReason: null,
  members: [
    {
      actorId: id(7),
      displayName: '研究成员',
      membershipVersion: 1,
      existingGrantCount: 0,
      status: 'pending',
      grantId: null,
      code: null,
      attempts: 0,
    },
  ],
};
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
function response() {
  return Response.json({ items: [batch], hasMore: false });
}
it('shows a pending batch as unexecuted and forbids applicant or recipient self-approval', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(response())),
  );
  const view = render(
    <ProjectResourceBatches
      locale="zh-CN"
      project={project}
      viewerId={id(6)}
    />,
  );
  await screen.findByText('公开水文资料');
  expect(
    screen.getByText('待审批', { selector: '[data-status]' }),
  ).toBeDefined();
  expect(screen.queryByRole('button', { name: '批准申请' })).toBeNull();
  expect(screen.getByRole('button', { name: '撤回申请' })).toBeDefined();
  view.rerender(
    <ProjectResourceBatches
      locale="zh-CN"
      project={project}
      viewerId={id(7)}
    />,
  );
  expect(screen.queryByRole('button', { name: '批准申请' })).toBeNull();
});
it('retains the same request key on uncertain approval retry and reports the actual receipt under StrictMode', async () => {
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
                ...batch,
                status: 'approved',
                version: 2,
                decidedBy: id(8),
              }),
        );
      }
      return Promise.resolve(response());
    }),
  );
  render(
    <StrictMode>
      <ProjectResourceBatches
        locale="zh-CN"
        project={{ ...project, canManage: false }}
        viewerId={id(8)}
      />
    </StrictMode>,
  );
  await screen.findByText('公开水文资料');
  fireEvent.click(screen.getByRole('button', { name: '批准申请' }));
  fireEvent.change(screen.getByLabelText('办理原因'), {
    target: { value: '已核对资料范围与期限' },
  });
  fireEvent.click(screen.getByRole('button', { name: '提交办理' }));
  await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: '提交办理' }));
  await screen.findByText('办理回执');
  expect(new Headers(calls[0]?.headers).get('idempotency-key')).toBe(
    new Headers(calls[1]?.headers).get('idempotency-key'),
  );
  expect(JSON.parse(requestBody(calls[1]?.body))).toMatchObject({
    batchId: batch.id,
    expectedVersion: 1,
    decision: 'approve',
  });
  expect(screen.queryByRole('button', { name: '执行授权' })).toBeNull();
});
it('clears old project information when a late request resolves', async () => {
  let resolve: ((value: Response) => void) | undefined;
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) =>
      url.includes(id(1))
        ? new Promise<Response>((r) => {
            resolve = r;
          })
        : Promise.resolve(Response.json({ items: [], hasMore: false })),
    ),
  );
  const view = render(
    <ProjectResourceBatches
      locale="zh-CN"
      project={project}
      viewerId={id(8)}
    />,
  );
  view.rerender(
    <ProjectResourceBatches
      locale="zh-CN"
      project={{ ...project, projectId: id(9) }}
      viewerId={id(8)}
    />,
  );
  await screen.findByText('暂无符合条件的批次。');
  resolve?.(response());
  await waitFor(() => expect(screen.queryByText('公开水文资料')).toBeNull());
});
it.each(['web-console', 'agent-data'])(
  'selects explicit members, definitions and %s purpose for a preview',
  async (purpose) => {
    const calls: RequestInit[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        if (init?.method === 'POST') {
          calls.push(init);
          return Promise.resolve(
            calls.length === 1
              ? Response.json({ code: 'ACCESS_UNAVAILABLE' }, { status: 503 })
              : Response.json(batch),
          );
        }
        if (url.includes('/members?'))
          return Promise.resolve(
            Response.json({
              items: [
                {
                  actorId: id(7),
                  displayName: '研究成员',
                  email: 'reader@example.test',
                  status: 'active',
                  version: 1,
                  expiresAt: null,
                  protected: false,
                  roles: [],
                },
              ],
              hasMore: true,
            }),
          );
        if (url.includes('resource-definitions'))
          return Promise.resolve(
            Response.json({
              items: [
                url.includes('kind=package')
                  ? {
                      kind: 'package',
                      id: id(4),
                      version: 1,
                      name: '公开水文资料',
                      resourceCount: 2,
                      allowedActions: ['content.read'],
                      licenseBasis: '公开资料许可',
                    }
                  : {
                      kind: 'preset',
                      id: id(5),
                      version: 1,
                      name: '研究查阅',
                      actions: ['content.read'],
                      maxDays: 30,
                      approvalLevel: 'ordinary',
                    },
              ].map((x) => ({ ...x, createdAt: batch.startsAt })),
              hasMore: false,
              authorityRevision: 1,
            }),
          );
        return Promise.resolve(Response.json({ items: [], hasMore: false }));
      }),
    );
    render(
      <ProjectResourceBatches
        locale="zh-CN"
        project={project}
        viewerId={id(6)}
      />,
    );
    await screen.findByText('暂无符合条件的批次。');
    fireEvent.click(screen.getByRole('button', { name: '新建批量申请' }));
    await screen.findByRole('checkbox', { name: '研究成员' });
    fireEvent.click(screen.getByRole('checkbox', { name: '研究成员' }));
    fireEvent.change(screen.getByLabelText('访问用途'), {
      target: { value: purpose },
    });
    fireEvent.change(screen.getByLabelText('资源包'), {
      target: { value: id(4) },
    });
    fireEvent.change(screen.getByLabelText('权限预设'), {
      target: { value: id(5) },
    });
    fireEvent.change(screen.getByLabelText('办理原因'), {
      target: { value: '本课题研究资料查阅' },
    });
    fireEvent.click(screen.getByRole('button', { name: '生成授权预览' }));
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: '生成授权预览' }));
    await screen.findByText('办理回执');
    expect(calls).toHaveLength(2);
    expect(calls[1]?.body).toBe(calls[0]?.body);
    expect(new Headers(calls[1]?.headers).get('idempotency-key')).toBe(
      new Headers(calls[0]?.headers).get('idempotency-key'),
    );
    expect(JSON.parse(requestBody(calls[0]?.body))).toMatchObject({
      purpose,
      actorIds: [id(7)],
      packageId: id(4),
      packageVersion: 1,
      presetId: id(5),
      presetVersion: 1,
    });
  },
);

it('keeps page selection explicit, supports removal and cancellation, and validates duration', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      if (url.includes('/members?')) {
        const second = url.includes('offset=20');
        return Promise.resolve(
          Response.json({
            items: [
              {
                actorId: id(second ? 9 : 7),
                displayName: second ? '下一页成员' : '研究成员',
                email: 'reader@example.test',
                status: 'active',
                version: 1,
                expiresAt: null,
                protected: false,
                roles: [],
              },
            ],
            hasMore: !second,
          }),
        );
      }
      if (url.includes('resource-definitions'))
        return Promise.resolve(
          Response.json({
            items: [
              url.includes('kind=package')
                ? {
                    kind: 'package',
                    id: id(4),
                    version: 1,
                    name: '公开水文资料',
                    resourceCount: 2,
                    allowedActions: ['content.read'],
                    licenseBasis: '公开资料许可',
                  }
                : {
                    kind: 'preset',
                    id: id(5),
                    version: 1,
                    name: '研究查阅',
                    actions: ['content.read'],
                    maxDays: 30,
                    approvalLevel: 'ordinary',
                  },
            ].map((x) => ({ ...x, createdAt: batch.startsAt })),
            hasMore: false,
            authorityRevision: 1,
          }),
        );
      return Promise.resolve(Response.json({ items: [], hasMore: false }));
    }),
  );
  render(
    <ProjectResourceBatches
      locale="zh-CN"
      project={project}
      viewerId={id(6)}
    />,
  );
  await screen.findByText('暂无符合条件的批次。');
  fireEvent.click(screen.getByRole('button', { name: '新建批量申请' }));
  fireEvent.click(await screen.findByRole('checkbox', { name: '研究成员' }));
  fireEvent.click(
    within(screen.getByRole('group', { name: '接收成员' })).getByRole(
      'button',
      { name: '下一页' },
    ),
  );
  const nextMember = await screen.findByRole('checkbox', {
    name: '下一页成员',
  });
  if (!(nextMember instanceof HTMLInputElement))
    throw Error('Expected member checkbox');
  expect(nextMember.checked).toBe(false);
  fireEvent.click(screen.getByRole('checkbox', { name: '下一页成员' }));
  fireEvent.click(screen.getByRole('button', { name: '移除成员 研究成员' }));
  expect(
    screen.queryByRole('button', { name: '移除成员 研究成员' }),
  ).toBeNull();
  fireEvent.click(
    within(screen.getByRole('group', { name: '接收成员' })).getByRole(
      'button',
      { name: '上一页' },
    ),
  );
  await screen.findByRole('checkbox', { name: '研究成员' });
  fireEvent.change(screen.getByLabelText('成员姓名或邮箱'), {
    target: { value: '研究' },
  });
  fireEvent.change(screen.getByLabelText('资源包'), {
    target: { value: id(4) },
  });
  fireEvent.change(screen.getByLabelText('权限预设'), {
    target: { value: id(5) },
  });
  fireEvent.change(screen.getByLabelText('有效期（天）'), {
    target: { value: '31' },
  });
  fireEvent.change(screen.getByLabelText('办理原因'), {
    target: { value: '研究任务资料查阅' },
  });
  fireEvent.submit(
    screen.getByRole('button', { name: '生成授权预览' }).closest('form')!,
  );
  await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: '清空选择' }));
  expect(
    screen
      .getByRole('button', { name: '生成授权预览' })
      .hasAttribute('disabled'),
  ).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '取消办理' }));
  expect(screen.queryByLabelText('办理原因')).toBeNull();
});
it('filters batches, pages results, and lets an executor inspect and cancel a partial retry', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) =>
      Promise.resolve(
        url.includes('offset=20')
          ? Response.json({ items: [], hasMore: false })
          : Response.json({
              items: [
                {
                  ...batch,
                  status: 'partial',
                  version: 3,
                  decidedBy: id(8),
                  members: batch.members.map((m) => ({
                    ...m,
                    status: 'failed',
                    code: 'EXECUTION_FAILED',
                    attempts: 1,
                  })),
                },
              ],
              hasMore: true,
            }),
      ),
    ),
  );
  render(
    <ProjectResourceBatches
      locale="zh-CN"
      project={project}
      viewerId={id(6)}
    />,
  );
  await screen.findByText('公开水文资料');
  fireEvent.click(screen.getByRole('button', { name: '重试失败成员' }));
  expect(screen.getByRole('button', { name: '提交办理' })).toBeDefined();
  fireEvent.click(screen.getByRole('button', { name: '取消办理' }));
  fireEvent.click(screen.getByRole('button', { name: '下一页' }));
  await screen.findByText('暂无符合条件的批次。');
  fireEvent.click(screen.getByRole('button', { name: '上一页' }));
  await screen.findByText('公开水文资料');
  fireEvent.change(screen.getByLabelText('办理状态'), {
    target: { value: 'partial' },
  });
  await screen.findByText('公开水文资料');
  fireEvent.click(screen.getByRole('button', { name: '刷新批次' }));
  await screen.findByText('公开水文资料');
});
it('shows frozen per-member resource-action differences without calling historical grants current access', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve(
        Response.json({
          items: [
            {
              ...batch,
              members: [
                {
                  ...batch.members[0],
                  diff: {
                    added: 2,
                    extended: 1,
                    retained: 3,
                    removed: 0,
                    byAction: [
                      {
                        action: 'content.read',
                        added: 2,
                        extended: 1,
                        retained: 3,
                      },
                    ],
                  },
                },
              ],
            },
          ],
          hasMore: false,
        }),
      ),
    ),
  );
  render(
    <ProjectResourceBatches
      locale="zh-CN"
      project={project}
      viewerId={id(8)}
    />,
  );
  await screen.findByText('新增权限 · 2');
  expect(screen.getByText('扩展时段 · 1')).toBeDefined();
  expect(screen.getByText('全时段已有 · 3')).toBeDefined();
  expect(screen.getByText('撤销权限 · 0')).toBeDefined();
});
