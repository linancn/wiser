// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { DataKnowledgeRelations } from './data-knowledge-relations';
vi.mock('./data-foundation-graph', () => ({
  KnowledgeGraphCanvas: () => <div data-testid="business-graph" />,
}));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it('separates candidate counts from the approved graph and preserves review retry identity', async () => {
  const row = {
    assertionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    dataItemId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    versionId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    version: 1,
    mappingVersion: 'v1',
    status: 'PENDING_REVIEW',
    confidence: null,
    createdAt: '2026-09-11T00:00:00Z',
    reviews: [],
    candidate: {
      subject: {
        key: 'enterprise',
        label: 'Enterprise',
        kind: 'ENTERPRISE',
        externalId: null,
      },
      predicate: 'HAS_DECLARED_MONITORING_POINT',
      object: {
        key: 'point',
        label: 'Point',
        kind: 'MONITORING_POINT',
        externalId: null,
      },
      qualifiers: {
        measure: null,
        unit: null,
        observedAt: null,
        missing: true,
        spatialScope: null,
        limitations: [],
        reportedConclusion: null,
      },
      generation: { method: 'SOURCE_TABLE', model: null },
      evidence: [
        {
          assetId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
          sourceHash: 'a'.repeat(64),
          locator: 'PDF page 1, row 1',
          excerpt: null,
          polarity: 'SUPPORTS',
        },
      ],
      supersedesId: null,
    },
  };
  const calls: RequestInit[] = [];
  let attempts = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, options: RequestInit) => {
      await Promise.resolve();
      if (url.endsWith('/review')) {
        calls.push(options);
        if (++attempts === 1) return new Response('{}', { status: 503 });
        return Response.json({
          assertion: { ...row, status: 'APPROVED', version: 2 },
        });
      }
      return Response.json({ items: [row], totalCount: 1 });
    }),
  );
  render(
    <DataKnowledgeRelations
      locale="zh-CN"
      dataItemId={row.dataItemId}
      versionId={row.versionId}
    />,
  );
  fireEvent.change(screen.getByLabelText('审核状态'), {
    target: { value: 'PENDING_REVIEW' },
  });
  fireEvent.click(screen.getByRole('button', { name: '查看业务关系' }));
  await screen.findByText(/PDF page 1, row 1/);
  expect(screen.queryByTestId('business-graph')).toBeNull();
  expect(screen.getByText('当前状态的关系数：1')).toBeTruthy();
  expect(
    screen.getByRole('link', { name: '查看原件' }).getAttribute('href'),
  ).toContain(row.versionId);
  fireEvent.change(screen.getByLabelText('审核说明'), {
    target: { value: '已对照原件位置' },
  });
  fireEvent.click(screen.getByRole('button', { name: '确认通过' }));
  await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: '确认通过' }));
  await waitFor(() => expect(calls).toHaveLength(2));
  expect(new Headers(calls[0]?.headers).get('Idempotency-Key')).toEqual(
    new Headers(calls[1]?.headers).get('Idempotency-Key'),
  );
});
