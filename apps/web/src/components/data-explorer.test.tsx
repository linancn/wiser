// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  ExplorationResultSchema,
  type ExplorationResult,
} from '@wiser/data-contracts';
import { DataExplorer } from './data-explorer';

const firstId = '10000000-0000-4000-8000-000000000001';
const secondId = '10000000-0000-4000-8000-000000000002';
function result(
  queryId: string,
  name: string,
  text: string,
): ExplorationResult {
  const now = Date.now();
  return ExplorationResultSchema.parse({
    queryId,
    spec: { text },
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 1800000).toISOString(),
    view: 'resources',
    totalCount: 1,
    resources: [
      {
        dataItemId: '20000000-0000-4000-8000-000000000001',
        versionId: '30000000-0000-4000-8000-000000000001',
        name,
        provider: 'Fixture provider',
        kind: 'CATALOG_ENTRY',
        assetCount: 1,
        recordCount: null,
        featureCount: null,
        limitations: [],
        readiness: {
          records: 'NOT_PARSED',
          spatial: 'NOT_PARSED',
          graph: 'NOT_PARSED',
        },
      },
    ],
  });
}
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
describe('exploration query navigation', () => {
  it('restores authorized query conditions from browser history without embedding filters in the URL', async () => {
    window.history.replaceState(
      { framework: 'preserved' },
      '',
      '/zh-CN/data-foundation/explore?q=first',
    );
    const first = result(firstId, 'First source', 'first');
    const second = result(secondId, 'Second source', 'second');
    const fetch = vi.fn((_url: unknown, init?: RequestInit) => {
      const input = JSON.parse(String(init?.body)) as { queryId?: string };
      return Promise.resolve(
        Response.json(input.queryId === firstId ? first : second),
      );
    });
    vi.stubGlobal('fetch', fetch);
    const user = userEvent.setup();
    render(
      <DataExplorer
        locale="zh-CN"
        initialResult={first}
        initialFailure={null}
        initialText="first"
      />,
    );
    await user.click(screen.getByRole('button', { name: 'First source' }));
    expect(
      within(screen.getByTestId('explorer-inspector')).getByText(
        'Fixture provider',
      ),
    ).toBeTruthy();
    const before = window.history.length;
    await user.clear(screen.getByLabelText('查询数据'));
    await user.type(screen.getByLabelText('查询数据'), 'second');
    await user.click(screen.getByRole('button', { name: '查询' }));
    await screen.findByRole('button', { name: 'Second source' });
    expect(window.history.length).toBe(before + 1);
    expect(new URL(window.location.href).searchParams.get('q')).toBeNull();
    expect(window.history.state).toMatchObject({ framework: 'preserved' });
    window.history.back();
    await screen.findByRole('button', { name: 'First source' });
    await waitFor(() =>
      expect(
        (screen.getByLabelText('查询数据') as HTMLInputElement).value,
      ).toBe('first'),
    );
    expect(screen.getByTestId('explorer-inspector').textContent).not.toContain(
      'Fixture provider',
    );
  });
});
