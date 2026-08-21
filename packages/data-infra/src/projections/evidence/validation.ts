import { EvidenceProjectionError } from './errors.js';
import type { EvidenceProjectionInput } from './types.js';

const INPUT_KEYS = Object.freeze([
  'acceptanceStatus',
  'assetId',
  'businessDomains',
  'channels',
  'chunkId',
  'chunkingStrategy',
  'content',
  'dataItemId',
  'documentId',
  'embeddingModel',
  'embeddingVersion',
  'evidenceId',
  'language',
  'limitations',
  'pageOrSection',
  'policyVersion',
  'projectId',
  'publicationStatus',
  'qualityGrade',
  'securityLevel',
  'sourceHash',
  'tenantId',
  'vector',
  'versionId',
]);

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const SAFE_KEY = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const LANGUAGE = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;
const VERSION = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const DATA_KEY = /^[a-z][a-z0-9-]*(?:[.:][a-z0-9][a-z0-9_-]*)*$/;

function invalid(message: string): never {
  throw new EvidenceProjectionError(
    'INVALID_EVIDENCE_PROJECTION_INPUT',
    message,
  );
}

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    invalid('Evidence projection input must be an object.');
  }
  return value as Record<string, unknown>;
}

function hasDisallowedControl(
  value: string,
  allowCommonWhitespace = false,
): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (
      code === 127 ||
      (code < 32 && !(allowCommonWhitespace && [9, 10, 13].includes(code)))
    ) {
      return true;
    }
  }
  return false;
}

function text(value: unknown, field: string, maximum: number): string {
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > maximum ||
    hasDisallowedControl(value)
  ) {
    invalid(`Evidence projection ${field} is invalid.`);
  }
  return value;
}

function contentText(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > 1_048_576 ||
    hasDisallowedControl(value, true)
  ) {
    invalid('Evidence projection content is invalid.');
  }
  return value;
}

function uuid(value: unknown, field: string): string {
  const candidate = text(value, field, 36);
  if (!UUID.test(candidate))
    invalid(`Evidence projection ${field} is invalid.`);
  return candidate;
}

function oneOf<const Values extends readonly string[]>(
  value: unknown,
  field: string,
  values: Values,
): Values[number] {
  if (typeof value !== 'string' || !values.includes(value)) {
    invalid(`Evidence projection ${field} is invalid.`);
  }
  return value;
}

function stringArray(
  value: unknown,
  field: string,
  maximum: number,
  pattern?: RegExp,
): readonly string[] {
  if (!Array.isArray(value) || value.length > maximum) {
    invalid(`Evidence projection ${field} is invalid.`);
  }
  const normalized = value.map((entry) => text(entry, field, 2_048));
  if (
    pattern !== undefined &&
    normalized.some((entry) => !pattern.test(entry))
  ) {
    invalid(`Evidence projection ${field} is invalid.`);
  }
  return Object.freeze([...new Set(normalized)]);
}

export function validateEvidenceProjectionInput(
  value: unknown,
): EvidenceProjectionInput {
  const candidate = object(value);
  const actualKeys = Object.keys(candidate).sort();
  if (
    actualKeys.length !== INPUT_KEYS.length ||
    actualKeys.some((key, index) => key !== INPUT_KEYS[index])
  ) {
    invalid('Evidence projection input contains missing or unknown fields.');
  }

  const vector = candidate.vector;
  if (!Array.isArray(vector) || vector.length < 1 || vector.length > 4_096) {
    invalid('Evidence projection vector is invalid.');
  }
  const normalizedVector: number[] = [];
  for (const item of vector as unknown[]) {
    if (typeof item !== 'number' || !Number.isFinite(item)) {
      invalid('Evidence projection vector is invalid.');
    }
    normalizedVector.push(item);
  }
  const sourceHash = text(candidate.sourceHash, 'sourceHash', 64);
  if (!SHA256.test(sourceHash)) {
    invalid('Evidence projection sourceHash is invalid.');
  }
  const language = text(candidate.language, 'language', 35);
  if (!LANGUAGE.test(language))
    invalid('Evidence projection language is invalid.');
  const chunkingStrategy = text(
    candidate.chunkingStrategy,
    'chunkingStrategy',
    128,
  );
  if (!SAFE_KEY.test(chunkingStrategy)) {
    invalid('Evidence projection chunkingStrategy is invalid.');
  }
  const embeddingModel = text(candidate.embeddingModel, 'embeddingModel', 128);
  if (!SAFE_KEY.test(embeddingModel)) {
    invalid('Evidence projection embeddingModel is invalid.');
  }
  const embeddingVersion = text(
    candidate.embeddingVersion,
    'embeddingVersion',
    64,
  );
  if (!VERSION.test(embeddingVersion)) {
    invalid('Evidence projection embeddingVersion is invalid.');
  }
  if (
    typeof candidate.policyVersion !== 'number' ||
    !Number.isSafeInteger(candidate.policyVersion) ||
    candidate.policyVersion < 1
  ) {
    invalid('Evidence projection policyVersion is invalid.');
  }

  return Object.freeze({
    tenantId: uuid(candidate.tenantId, 'tenantId'),
    projectId: uuid(candidate.projectId, 'projectId'),
    dataItemId: uuid(candidate.dataItemId, 'dataItemId'),
    versionId: uuid(candidate.versionId, 'versionId'),
    assetId: uuid(candidate.assetId, 'assetId'),
    chunkId: uuid(candidate.chunkId, 'chunkId'),
    evidenceId: uuid(candidate.evidenceId, 'evidenceId'),
    sourceHash,
    securityLevel: oneOf(candidate.securityLevel, 'securityLevel', [
      'L0_PUBLIC',
      'L1_INTERNAL',
      'L2_RESTRICTED',
      'L3_CONFIDENTIAL',
    ] as const),
    qualityGrade: oneOf(candidate.qualityGrade, 'qualityGrade', [
      'A',
      'B',
      'C',
    ] as const),
    acceptanceStatus: oneOf(candidate.acceptanceStatus, 'acceptanceStatus', [
      'PENDING',
      'PASSED',
      'CONDITIONALLY_PASSED',
      'CORRECTION_REQUIRED',
      'ARCHIVED_ONLY',
      'REJECTED',
    ] as const),
    publicationStatus: oneOf(candidate.publicationStatus, 'publicationStatus', [
      'UNPUBLISHED',
      'PUBLISHING',
      'PUBLISHED',
      'WITHDRAWN',
    ] as const),
    policyVersion: candidate.policyVersion,
    businessDomains: stringArray(
      candidate.businessDomains,
      'businessDomains',
      64,
      DATA_KEY,
    ),
    channels: Object.freeze(
      stringArray(candidate.channels, 'channels', 6).map((channel) =>
        oneOf(channel, 'channels', [
          'catalog',
          'fulltext',
          'semantic',
          'graph',
          'geo',
          'stac',
        ] as const),
      ),
    ),
    limitations: stringArray(candidate.limitations, 'limitations', 64),
    documentId: uuid(candidate.documentId, 'documentId'),
    pageOrSection: text(candidate.pageOrSection, 'pageOrSection', 512),
    language,
    chunkingStrategy,
    embeddingModel,
    embeddingVersion,
    content: contentText(candidate.content),
    vector: Object.freeze(normalizedVector),
  });
}

export function validateBaseUrl(value: unknown): string {
  if (typeof value !== 'string') {
    throw new EvidenceProjectionError(
      'INVALID_EVIDENCE_PROJECTION_CONFIG',
      'Projection base URL is invalid.',
    );
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch (error) {
    throw new EvidenceProjectionError(
      'INVALID_EVIDENCE_PROJECTION_CONFIG',
      'Projection base URL is invalid.',
      undefined,
      { cause: error },
    );
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username !== '' ||
    url.password !== '' ||
    url.search !== '' ||
    url.hash !== '' ||
    (url.pathname !== '' && url.pathname !== '/')
  ) {
    throw new EvidenceProjectionError(
      'INVALID_EVIDENCE_PROJECTION_CONFIG',
      'Projection base URL is invalid.',
    );
  }
  return url.origin;
}

export function validateSecret(value: unknown, field: string): string {
  if (
    typeof value !== 'string' ||
    value.length < 8 ||
    value.length > 8_192 ||
    hasDisallowedControl(value)
  ) {
    throw new EvidenceProjectionError(
      'INVALID_EVIDENCE_PROJECTION_CONFIG',
      `${field} is invalid.`,
    );
  }
  return value;
}

export function validateUsername(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > 128 ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value) ||
    hasDisallowedControl(value)
  ) {
    throw new EvidenceProjectionError(
      'INVALID_EVIDENCE_PROJECTION_CONFIG',
      'OpenSearch username is invalid.',
    );
  }
  return value;
}
