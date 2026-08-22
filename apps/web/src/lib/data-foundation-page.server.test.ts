import { beforeEach, describe, expect, it, vi } from 'vitest';

const { notFound, redirect } = vi.hoisted(() => ({
  notFound: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('next/navigation', () => ({ notFound, redirect }));

import { DataFoundationApiError } from './data-foundation-dal.server';
import { handleDataPageError } from './data-foundation-page.server';

beforeEach(() => {
  redirect.mockReset();
  notFound.mockReset();
  redirect.mockImplementation(() => {
    throw new Error('NEXT_REDIRECT');
  });
  notFound.mockImplementation(() => {
    throw new Error('NEXT_NOT_FOUND');
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

  it('uses the Next not-found boundary for an authenticated missing resource', () => {
    expect(() =>
      handleDataPageError(
        new DataFoundationApiError('not-found', 404),
        'en',
        '/en/data-foundation/catalog/missing',
      ),
    ).toThrow('NEXT_NOT_FOUND');
    expect(notFound).toHaveBeenCalledOnce();
  });
});
