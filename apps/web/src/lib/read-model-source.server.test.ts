import { afterEach, describe, expect, it, vi } from 'vitest';

const { connection } = vi.hoisted(() => ({
  connection: vi.fn(() => Promise.resolve()),
}));

vi.mock('server-only', () => ({}));
vi.mock('next/server', () => ({ connection }));

const originalMode = process.env.AGENT_EXCON_WEB_DATA_MODE;
const originalOrigin = process.env.AGENT_EXCON_API_INTERNAL_URL;
const originalToken = process.env.WISER_WEB_OPERATOR_TOKEN;

function restoreEnvironment(
  key:
    | 'AGENT_EXCON_WEB_DATA_MODE'
    | 'AGENT_EXCON_API_INTERNAL_URL'
    | 'WISER_WEB_OPERATOR_TOKEN',
  value: string | undefined,
) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

afterEach(() => {
  restoreEnvironment('AGENT_EXCON_WEB_DATA_MODE', originalMode);
  restoreEnvironment('AGENT_EXCON_API_INTERNAL_URL', originalOrigin);
  restoreEnvironment('WISER_WEB_OPERATOR_TOKEN', originalToken);
  connection.mockClear();
  vi.resetModules();
});

describe('server read-model selection', () => {
  it('waits for a request before reading runtime live-mode configuration', async () => {
    process.env.AGENT_EXCON_WEB_DATA_MODE = 'reference';
    vi.resetModules();
    const module = await import('./read-model-source.server');

    process.env.AGENT_EXCON_WEB_DATA_MODE = 'live';
    process.env.AGENT_EXCON_API_INTERNAL_URL = 'http://api:3001';
    process.env.WISER_WEB_OPERATOR_TOKEN = 'operator-secret';

    await expect(module.getWebDataMode()).resolves.toBe('live');
    await expect(module.getWebReadModelSource()).resolves.toMatchObject({
      mode: 'live',
    });
    expect(connection).toHaveBeenCalledTimes(2);
  });
});
