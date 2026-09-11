import { afterEach, expect, it, vi } from 'vitest';
const { assess } = vi.hoisted(() => ({ assess: vi.fn() }));
vi.mock('./data-foundation-dal.server', () => ({
  getDataFoundationDal: () => Promise.resolve({ assess }),
  DataFoundationApiError: class extends Error {
    constructor(readonly status: number) {
      super('private upstream diagnostic');
    }
  },
}));
import { DataFoundationApiError } from './data-foundation-dal.server';
import { POST } from '../app/api/data-foundation/assessment/[action]/route';
const key = '10000000-0000-4000-8000-000000000001';
const call = (
  action: string,
  body?: BodyInit,
  origin = 'http://localhost',
  commandKey: string | null = key,
) =>
  POST(
    new Request('http://localhost/api/data-foundation/assessment/' + action, {
      method: 'POST',
      headers: {
        host: 'localhost',
        origin,
        ...(commandKey ? { 'Idempotency-Key': commandKey } : {}),
      },
      ...(body === undefined ? {} : { body }),
    }),
    { params: Promise.resolve({ action }) },
  );
afterEach(() => vi.resetAllMocks());
it('rejects cross-origin, unknown, missing, malformed and oversized inputs before accessing the DAL', async () => {
  expect((await call('create', '{}', 'https://foreign.example')).status).toBe(
    403,
  );
  expect((await call('delete', '{}')).status).toBe(404);
  expect((await call('create')).status).toBe(422);
  expect((await call('create', '{')).status).toBe(422);
  expect((await call('create', new Uint8Array([0xff]))).status).toBe(422);
  expect((await call('create', 'x'.repeat(131073))).status).toBe(413);
  expect(assess).not.toHaveBeenCalled();
});
it.each(['create', 'get', 'list'])(
  'forwards %s with its command identity and private response',
  async (action) => {
    assess.mockResolvedValue({ items: [] });
    const response = await call(action, '{"batchId":"example"}');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(assess).toHaveBeenCalledWith(action, { batchId: 'example' }, key);
  },
);
it('permits keyless reads and preserves access-denial status without disclosing upstream diagnostics', async () => {
  // The route preserves the real DAL error prototype; only its public status is exposed.
  const error = Object.create(
    DataFoundationApiError.prototype,
  ) as DataFoundationApiError;
  Object.assign(error, { status: 403, message: 'private upstream diagnostic' });
  assess.mockRejectedValueOnce(error);
  const denied = await call('get', '{}', 'http://localhost', null);
  expect(denied.status).toBe(403);
  expect(await denied.text()).not.toContain('private');
  expect(assess).toHaveBeenCalledWith('get', {}, undefined);
  assess.mockRejectedValueOnce(new Error('private upstream diagnostic'));
  const unavailable = await call('create', '{}');
  expect(unavailable.status).toBe(503);
  expect(await unavailable.text()).not.toContain('private');
});
