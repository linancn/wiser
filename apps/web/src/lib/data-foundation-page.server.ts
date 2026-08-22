import 'server-only';

import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';

import {
  DataFoundationApiError,
  type DataFoundationApiErrorKind,
} from './data-foundation-dal.server';
import { getDictionary, type Locale } from './i18n';

export function dataFoundationMetadata(
  locale: Locale,
  title: string,
): Metadata {
  const dictionary = getDictionary(locale);
  return {
    title,
    description: dictionary.dataFoundation.description,
  };
}

export function invalidDataPageRequest(): DataFoundationApiError {
  return new DataFoundationApiError('invalid-request', 422);
}

export function handleDataPageError(
  error: unknown,
  locale: Locale,
  returnPath: string,
): DataFoundationApiError {
  const normalized =
    error instanceof DataFoundationApiError
      ? error
      : new DataFoundationApiError('unavailable', 503);
  if (normalized.kind === 'authentication') {
    const query = new URLSearchParams({ next: returnPath });
    redirect(`/${locale}/login?${query.toString()}`);
  }
  if (normalized.kind === 'not-found') notFound();
  return normalized;
}

export function dataPageFailure(
  kind: DataFoundationApiErrorKind,
  status: number,
): DataFoundationApiError {
  return new DataFoundationApiError(kind, status);
}
