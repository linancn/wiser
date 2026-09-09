// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { SearchResultList } from './data-foundation-workspace';
import QualityPage from '../app/[locale]/data-foundation/quality/page';
import { getDataFoundationDal } from '../lib/data-foundation-dal.server';
import type { SearchResultDto } from '../lib/data-foundation';

vi.mock('server-only', () => ({}));
vi.mock('./data-foundation-graph', () => ({ DataFoundationGraph: () => null }));
vi.mock('../lib/data-foundation-dal.server', () => ({
  getDataFoundationDal: vi.fn(),
}));
vi.mock('../lib/data-foundation-page.server', () => ({
  dataFoundationMetadata: vi.fn(),
  handleDataPageError: (error: unknown) => {
    throw error;
  },
  invalidDataPageRequest: () => new Error('invalid request'),
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const result: SearchResultDto & { resourceName: string } = {
  dataItemId: '11111111-1111-4111-8111-111111111111',
  versionId: '22222222-2222-4222-8222-222222222222',
  evidenceId: '33333333-3333-4333-8333-333333333333',
  source: 'neo4j+opensearch',
  score: 0.049,
  resourceName: 'HydroATLAS',
  qualityGrade: 'A',
  acceptanceStatus: 'PASSED',
  securityLevel: 'L2_RESTRICTED',
  generatedAt: '2026-09-08T00:00:00Z',
  limitations: [
    'Source registration and file integrity only; analytical quality and scientific usability have not been assessed.',
  ],
  excerpt:
    'HydroATLAS {"catalog":{"credential_ref":"","notes":"manual_registration_required"},"kind":"CATALOG_ENTRY","name":"HydroATLAS"}',
};

it('opens the exact evidence version from a named search result', () => {
  render(<SearchResultList locale="zh-CN" items={[result]} title="检索结果" />);
  const link = screen.getByRole('link', { name: 'HydroATLAS' });
  expect(link.getAttribute('href')).toBe(
    `/zh-CN/data-foundation/catalog/${result.dataItemId}?version=${result.versionId}`,
  );
});

it('keeps registration manifests and ranking diagnostics out of the search preview while preserving source restrictions', () => {
  render(<SearchResultList locale="en" items={[result]} title="Results" />);
  const article = screen.getByRole('article');
  const preview = article.cloneNode(true) as HTMLElement;
  preview.querySelectorAll('details').forEach((node) => node.remove());
  expect(preview.textContent).not.toMatch(
    /credential_ref|manual_registration_required|neo4j|0\.049/,
  );
  expect(preview.textContent).toMatch(/registration|Registration/);
  expect(article.textContent).toMatch(
    /analytical quality and scientific usability have not been assessed/,
  );
});

it('paginates quality review with the same name filter', async () => {
  const catalog = vi
    .fn()
    .mockResolvedValue({ items: [], nextCursor: 'next-cursor' });
  vi.mocked(getDataFoundationDal).mockResolvedValue({
    catalog,
  } as unknown as Awaited<ReturnType<typeof getDataFoundationDal>>);
  render(
    await QualityPage({
      params: Promise.resolve({ locale: 'zh-CN' }),
      searchParams: Promise.resolve({ q: 'water', after: 'current-cursor' }),
    }),
  );
  expect(catalog).toHaveBeenCalledWith({
    first: 25,
    query: 'water',
    after: 'current-cursor',
  });
  expect(
    screen.getByRole('link', { name: '下一页' }).getAttribute('href'),
  ).toBe('/zh-CN/data-foundation/quality?q=water&after=next-cursor');
  expect(
    screen.getByRole('link', { name: '返回第一页' }).getAttribute('href'),
  ).toBe('/zh-CN/data-foundation/quality?q=water');
});
