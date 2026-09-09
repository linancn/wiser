import { beforeEach, expect, it, vi } from 'vitest';
const explore = vi.hoisted(() => vi.fn().mockResolvedValue(null));
vi.mock('../components/data-explorer', () => ({ DataExplorer: () => null }));
vi.mock('../lib/data-foundation-dal.server', () => ({
  getDataFoundationDal: () => Promise.resolve({ explore }),
  DataFoundationApiError: class extends Error {
    constructor(
      readonly kind: string,
      readonly status: number,
    ) {
      super(kind);
    }
  },
}));
vi.mock('../lib/data-foundation-page.server', () => ({
  handleDataPageError: vi.fn(),
  dataFoundationMetadata: vi.fn(),
}));
import ExplorePage from './[locale]/data-foundation/explore/page';

beforeEach(() => explore.mockClear());
const dataItem = '11111111-1111-4111-8111-111111111111';
const version = '22222222-2222-4222-8222-222222222222';
it('starts all exploration views from the exact version selected in a resource link', async () => {
  await ExplorePage({
    params: Promise.resolve({ locale: 'en' }),
    searchParams: Promise.resolve({ dataItem, version, view: 'graph' }),
  });
  expect(explore).toHaveBeenCalledWith({
    spec: { versions: [{ dataItemId: dataItem, versionId: version }] },
    view: 'resources',
    first: 25,
  });
});
it.each([
  { dataItem },
  { version },
  { dataItem, version: 'wrong' },
  { dataItem: [dataItem], version },
])(
  'does not widen a malformed version link into a query of all data: %j',
  async (searchParams) => {
    await ExplorePage({
      params: Promise.resolve({ locale: 'en' }),
      searchParams: Promise.resolve(searchParams),
    });
    expect(explore).not.toHaveBeenCalled();
  },
);
