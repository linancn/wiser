import { Buffer } from 'node:buffer';

import type {
  SearchAcceptanceStatus,
  SearchBackendHit,
  SearchBackendRequest,
  SearchChannel,
  SearchExcerptFragment,
  SearchQualityGrade,
  SearchSecurityLevel,
} from '../index.js';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DOMAIN_PATTERN = /^[a-z][a-z0-9-]{0,127}$/;
const FIELD_PATTERN = /^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/;
const REQUEST_KEYS = Object.freeze([
  'acceptanceStatuses',
  'businessDomains',
  'channels',
  'limit',
  'maxSecurityLevel',
  'maximumPolicyVersion',
  'projectId',
  'publicationStatuses',
  'query',
  'securityLevels',
  'tenantId',
  'versionIds',
]);

const HIT_KEYS = new Set([
  'tenantId',
  'projectId',
  'dataItemId',
  'versionId',
  'evidenceId',
  'qualityGrade',
  'acceptanceStatus',
  'publicationStatus',
  'securityLevel',
  'policyVersion',
  'excerptFragments',
  'limitations',
]);

const SECURITY_RANK: Readonly<Record<SearchSecurityLevel, number>> = {
  L0_PUBLIC: 0,
  L1_INTERNAL: 1,
  L2_RESTRICTED: 2,
  L3_CONFIDENTIAL: 3,
};

export type SearchBackendAdapterErrorCode =
  | 'INVALID_CONFIGURATION'
  | 'INVALID_REQUEST'
  | 'BACKEND_UNAVAILABLE'
  | 'INVALID_RESPONSE'
  | 'EMBEDDING_UNAVAILABLE';

const ERROR_MESSAGES: Readonly<Record<SearchBackendAdapterErrorCode, string>> =
  {
    INVALID_CONFIGURATION: 'Search backend configuration is invalid.',
    INVALID_REQUEST: 'Structured search backend request is invalid.',
    BACKEND_UNAVAILABLE: 'Search backend is unavailable.',
    INVALID_RESPONSE: 'Search backend returned an invalid response.',
    EMBEDDING_UNAVAILABLE: 'Search embedding provider is unavailable.',
  };

export class SearchBackendAdapterError extends Error {
  constructor(readonly code: SearchBackendAdapterErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = 'SearchBackendAdapterError';
  }
}

export type SearchBackendFetch = typeof globalThis.fetch;

export function adapterError(code: SearchBackendAdapterErrorCode) {
  return new SearchBackendAdapterError(code);
}

export function isRecord(
  value: unknown,
): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(
  value: Readonly<Record<string, unknown>>,
  keys: readonly string[],
) {
  const actual = Object.keys(value).sort();
  return (
    actual.length === keys.length &&
    actual.every((key, index) => key === keys[index])
  );
}

function safeString(value: unknown, minimum: number, maximum: number) {
  return (
    typeof value === 'string' &&
    value.length >= minimum &&
    value.length <= maximum &&
    ![...value].some((character) => {
      const code = character.charCodeAt(0);
      return code <= 31 || code === 127;
    })
  );
}

export function safeEndpoint(value: string): URL {
  try {
    const endpoint = new URL(value);
    if (
      (endpoint.protocol !== 'http:' && endpoint.protocol !== 'https:') ||
      endpoint.username.length > 0 ||
      endpoint.password.length > 0 ||
      endpoint.search.length > 0 ||
      endpoint.hash.length > 0 ||
      (endpoint.pathname !== '' && endpoint.pathname !== '/')
    ) {
      throw adapterError('INVALID_CONFIGURATION');
    }
    return new URL(endpoint.origin);
  } catch (error) {
    if (error instanceof SearchBackendAdapterError) throw error;
    throw adapterError('INVALID_CONFIGURATION');
  }
}

export function requiredSecret(value: string): string {
  if (!safeString(value, 1, 4_096)) {
    throw adapterError('INVALID_CONFIGURATION');
  }
  return value;
}

export function basicAuthorization(username: string, password: string) {
  if (username.includes(':')) throw adapterError('INVALID_CONFIGURATION');
  return `Basic ${Buffer.from(
    `${requiredSecret(username)}:${requiredSecret(password)}`,
  ).toString('base64')}`;
}

export function requiredFetch(value: SearchBackendFetch): SearchBackendFetch {
  if (typeof value !== 'function') {
    throw adapterError('INVALID_CONFIGURATION');
  }
  return value;
}

function stringArray(
  value: unknown,
  maximum: number,
  predicate: (value: string) => boolean,
): value is readonly string[] {
  return (
    Array.isArray(value) &&
    value.length <= maximum &&
    value.every(
      (entry: unknown) => typeof entry === 'string' && predicate(entry),
    )
  );
}

function securityLevel(value: unknown): value is SearchSecurityLevel {
  return typeof value === 'string' && Object.hasOwn(SECURITY_RANK, value);
}

function securityLevelArray(
  value: unknown,
): value is readonly SearchSecurityLevel[] {
  return (
    Array.isArray(value) &&
    value.length <= 4 &&
    value.every((entry: unknown) => securityLevel(entry))
  );
}

export function validateBackendRequest(
  value: SearchBackendRequest,
  allowedChannels: ReadonlySet<SearchChannel>,
): SearchBackendRequest {
  const candidate: unknown = value;
  if (!isRecord(candidate) || !exactKeys(candidate, REQUEST_KEYS)) {
    throw adapterError('INVALID_REQUEST');
  }
  const maxSecurityLevel = candidate['maxSecurityLevel'];
  const securityLevels = candidate['securityLevels'];
  if (
    !safeString(candidate['query'], 1, 2_048) ||
    !UUID_PATTERN.test(String(candidate['tenantId'])) ||
    !UUID_PATTERN.test(String(candidate['projectId'])) ||
    !securityLevel(maxSecurityLevel) ||
    !Number.isSafeInteger(candidate['maximumPolicyVersion']) ||
    Number(candidate['maximumPolicyVersion']) < 1 ||
    !Number.isSafeInteger(candidate['limit']) ||
    Number(candidate['limit']) < 1 ||
    Number(candidate['limit']) > 10_000 ||
    !stringArray(candidate['versionIds'], 256, (entry) =>
      UUID_PATTERN.test(entry),
    ) ||
    !stringArray(candidate['businessDomains'], 64, (entry) =>
      DOMAIN_PATTERN.test(entry),
    ) ||
    !securityLevelArray(securityLevels) ||
    securityLevels.some(
      (level) => SECURITY_RANK[level] > SECURITY_RANK[maxSecurityLevel],
    ) ||
    !stringArray(
      candidate['acceptanceStatuses'],
      2,
      (entry) => entry === 'PASSED' || entry === 'CONDITIONALLY_PASSED',
    ) ||
    !stringArray(
      candidate['publicationStatuses'],
      1,
      (entry) => entry === 'PUBLISHED',
    ) ||
    !stringArray(candidate['channels'], 6, (entry) =>
      allowedChannels.has(entry as SearchChannel),
    )
  ) {
    throw adapterError('INVALID_REQUEST');
  }
  return value;
}

function parseExcerptFragments(
  value: unknown,
): readonly SearchExcerptFragment[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 256) return null;
  const result: SearchExcerptFragment[] = [];
  for (const entry of value as readonly unknown[]) {
    if (!isRecord(entry)) return null;
    const field = entry['field'];
    const text = entry['text'];
    if (
      typeof field !== 'string' ||
      !FIELD_PATTERN.test(field) ||
      typeof text !== 'string' ||
      text.length > 8_192
    ) {
      return null;
    }
    result.push({ field, text });
  }
  return result;
}

function parseLimitations(value: unknown): readonly string[] | null {
  if (value === undefined) return [];
  if (
    !Array.isArray(value) ||
    value.length > 64 ||
    !(value as readonly unknown[]).every(
      (entry) =>
        typeof entry === 'string' && entry.length >= 1 && entry.length <= 2_048,
    )
  ) {
    return null;
  }
  return [...(value as readonly string[])];
}

function qualityGrade(value: unknown): value is SearchQualityGrade {
  return value === 'A' || value === 'B' || value === 'C';
}

function acceptanceStatus(value: unknown): value is SearchAcceptanceStatus {
  return value === 'PASSED' || value === 'CONDITIONALLY_PASSED';
}

export function parseSearchBackendHit(
  value: unknown,
  request: SearchBackendRequest,
): SearchBackendHit {
  if (
    !isRecord(value) ||
    Object.keys(value).some((key) => !HIT_KEYS.has(key))
  ) {
    throw adapterError('INVALID_RESPONSE');
  }
  const excerpts = parseExcerptFragments(value['excerptFragments']);
  const limitations = parseLimitations(value['limitations']);
  const hitSecurity = value['securityLevel'];
  const hitAcceptance = value['acceptanceStatus'];
  const policyVersion = value['policyVersion'];
  if (
    value['tenantId'] !== request.tenantId ||
    value['projectId'] !== request.projectId ||
    typeof value['dataItemId'] !== 'string' ||
    !UUID_PATTERN.test(value['dataItemId']) ||
    typeof value['versionId'] !== 'string' ||
    !UUID_PATTERN.test(value['versionId']) ||
    typeof value['evidenceId'] !== 'string' ||
    !UUID_PATTERN.test(value['evidenceId']) ||
    !qualityGrade(value['qualityGrade']) ||
    !acceptanceStatus(hitAcceptance) ||
    !request.acceptanceStatuses.includes(hitAcceptance) ||
    value['publicationStatus'] !== 'PUBLISHED' ||
    !securityLevel(hitSecurity) ||
    !request.securityLevels.includes(hitSecurity) ||
    SECURITY_RANK[hitSecurity] > SECURITY_RANK[request.maxSecurityLevel] ||
    typeof policyVersion !== 'number' ||
    !Number.isSafeInteger(policyVersion) ||
    policyVersion < 1 ||
    policyVersion > request.maximumPolicyVersion ||
    (request.versionIds.length > 0 &&
      !request.versionIds.includes(value['versionId'])) ||
    excerpts === null ||
    limitations === null
  ) {
    throw adapterError('INVALID_RESPONSE');
  }
  return {
    tenantId: request.tenantId,
    projectId: request.projectId,
    dataItemId: value['dataItemId'],
    versionId: value['versionId'],
    evidenceId: value['evidenceId'],
    qualityGrade: value['qualityGrade'],
    acceptanceStatus: hitAcceptance,
    publicationStatus: 'PUBLISHED',
    securityLevel: hitSecurity,
    policyVersion,
    excerptFragments: excerpts,
    limitations,
  };
}

export async function fetchJson(
  fetcher: SearchBackendFetch,
  url: URL,
  init: RequestInit,
  timeoutMs: number,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetcher(url, {
      ...init,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw adapterError('BACKEND_UNAVAILABLE');
  }
  if (!response.ok) throw adapterError('BACKEND_UNAVAILABLE');
  try {
    return await response.json();
  } catch {
    throw adapterError('INVALID_RESPONSE');
  }
}
