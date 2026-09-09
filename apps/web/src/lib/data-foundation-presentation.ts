import type { SearchResultDto } from './data-foundation';
import type { Dictionary } from './i18n';

export type DisplaySearchResult = SearchResultDto & {
  readonly resourceName?: string;
};

export const SOURCE_REGISTRATION_LIMITATION =
  'Source registration and file integrity only; analytical quality and scientific usability have not been assessed.';

export function isRegistrationExcerpt(excerpt: string | undefined): boolean {
  return (
    excerpt !== undefined &&
    /"(?:catalog|credential_ref|originalPath|preparedHash|sourceRegistration)"\s*:|"kind"\s*:\s*"(?:CATALOG_ENTRY|PROVIDER|FILE_COLLECTION)"|(?:^|\s)output\/[^\s]+[\s\S]*(?:sha256:|NOT_A_DATASET|page_or_entry_snapshot)/.test(
      excerpt,
    )
  );
}

export function sourceLimitationLabel(
  value: string,
  copy: Dictionary['dataFoundation']['presentation'],
): string {
  if (
    value ===
    'Source registration and file integrity only; analytical quality and scientific usability have not been assessed.'
  )
    return copy.registrationLimit;
  if (
    value ===
    'Access conditions, licensing, samples, partial downloads and unknown completeness retain their source declarations.'
  )
    return copy.accessLimit;
  if (
    value ===
    'Registry IDs found in file paths are discovery hints, not independently verified scientific lineage.'
  )
    return copy.lineageLimit;
  if (value.startsWith('excerpt_fields_redacted:'))
    return copy.restrictedExcerpt;
  return value;
}

export function namedCapability(
  id: string,
  labels: Readonly<Record<string, string>>,
  fallback: string,
): string {
  return Object.hasOwn(labels, id) ? labels[id] : fallback;
}
