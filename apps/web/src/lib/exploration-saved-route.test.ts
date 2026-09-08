import { afterEach, expect, it, vi } from 'vitest';
const { explorationView } = vi.hoisted(() => ({ explorationView: vi.fn() }));
vi.mock('./data-foundation-dal.server', () => ({
  getDataFoundationDal: () => Promise.resolve({ explorationView }),
  DataFoundationApiError: class extends Error {
    status = 503;
  },
}));
import { POST } from '../app/api/data-foundation/explore/views/[action]/route';
const call = (
  action: string,
  body: string,
  origin = 'http://localhost',
  key = '10000000-0000-4000-8000-000000000001',
) =>
  POST(
    new Request(
      'http://localhost/api/data-foundation/explore/views/' + action,
      {
        method: 'POST',
        headers: {
          host: 'localhost',
          origin,
          'content-type': 'application/json',
          'Idempotency-Key': key,
        },
        body,
      },
    ),
    { params: Promise.resolve({ action }) },
  );
afterEach(() => vi.resetAllMocks());
it('rejects cross-origin writes, unknown actions, malformed JSON and oversized bodies before the DAL', async () => {
  expect((await call('create', '{}', 'https://foreign.example')).status).toBe(
    403,
  );
  expect((await call('delete', '{}')).status).toBe(404);
  expect((await call('create', '{')).status).toBe(422);
  expect((await call('create', 'x'.repeat(131073))).status).toBe(413);
  expect(explorationView).not.toHaveBeenCalled();
});
it('preserves the client command key and emits private no-store responses without upstream errors', async () => {
  explorationView.mockResolvedValueOnce({ items: [] });
  const response = await call('list', '{}');
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(explorationView).toHaveBeenCalledWith(
    'list',
    {},
    '10000000-0000-4000-8000-000000000001',
  );
  explorationView.mockRejectedValueOnce(new Error('secret upstream'));
  const failed = await call('open', '{}');
  expect(failed.status).toBe(503);
  expect(await failed.text()).not.toContain('secret');
});
