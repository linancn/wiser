import { beforeEach, describe, expect, it, vi } from 'vitest';

const { redirect } = vi.hoisted(() => ({ redirect: vi.fn() }));

vi.mock('server-only', () => ({}));
vi.mock('next/navigation', () => ({ redirect }));

import { DataFoundationApiError } from './data-foundation-dal.server';
import { handleDataPageError } from './data-foundation-page.server';

beforeEach(() => {
  redirect.mockReset();
  redirect.mockImplementation(() => {
    throw new Error('NEXT_REDIRECT');
  });
});

describe('Data Foundation page error policy', () => {
  it('redirects a 401 to the localized login without exposing a token', () => {
    expect(() =>
      handleDataPageError(
        new DataFoundationApiError('authentication', 401),
        'zh-CN',
        '/zh-CN/data-foundation/catalog',
      ),
    ).toThrow('NEXT_REDIRECT');
    expect(redirect).toHaveBeenCalledWith(
      '/zh-CN/login?next=%2Fzh-CN%2Fdata-foundation%2Fcatalog',
    );
  });

  it('returns an explicit non-authentication failure to the server page', () => {
    const failure = new DataFoundationApiError('authorization', 403);
    expect(
      handleDataPageError(failure, 'en', '/en/data-foundation/catalog'),
    ).toBe(failure);
    expect(redirect).not.toHaveBeenCalled();
  });
});
