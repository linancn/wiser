import { readFileSync, statSync } from 'node:fs';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_REPORT_BYTES = 65_536;
const EXPECTED_STEPS = [
  'upload-session-created',
  'fixtures-uploaded',
  'ingestion-created',
  'clamav-security-scan',
  'sha256-fingerprints',
  'fixtures-parsed',
  'fake-ai-plan',
  'deterministic-transform',
  'quality-checks',
  'authority-version-committed',
  'raw-objects-promoted',
  'transactional-outbox-written',
  'five-projections-built',
  'projection-status-succeeded',
  'rest-query',
  'graphql-query',
  'mcp-query',
  'web-catalog',
] as const;

interface SmokeReport {
  readonly status?: unknown;
  readonly vertical?: unknown;
}

interface VerticalReport {
  readonly status?: unknown;
  readonly dataItemId?: unknown;
  readonly ingestionId?: unknown;
  readonly operationId?: unknown;
  readonly versionId?: unknown;
  readonly steps?: unknown;
}

export interface LiveDataFixture {
  readonly dataItemId: string;
  readonly ingestionId: string;
  readonly operationId: string;
  readonly versionId: string;
}

export interface LiveCredentials {
  readonly email: string;
  readonly password: string;
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required for authenticated browser tests.`);
  }
  return value;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function uuid(value: unknown, name: string): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw new Error(`Data smoke report ${name} must be a UUID.`);
  }
  return value;
}

export function loadLiveDataFixture(): LiveDataFixture {
  const path = requiredEnvironment('WISER_WEB_LIVE_SMOKE_REPORT');
  const size = statSync(path).size;
  if (size < 2 || size > MAX_REPORT_BYTES) {
    throw new Error('Data smoke report size is outside the safe boundary.');
  }
  let parsed: SmokeReport;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8')) as SmokeReport;
  } catch (error) {
    throw new Error('Data smoke report must contain one JSON document.', {
      cause: error,
    });
  }
  const vertical = record(parsed.vertical) as VerticalReport | null;
  if (
    parsed.status !== 'ok' ||
    vertical?.status !== 'ok' ||
    !Array.isArray(vertical.steps) ||
    JSON.stringify(vertical.steps) !== JSON.stringify(EXPECTED_STEPS)
  ) {
    throw new Error('Data smoke report is incomplete or untrusted.');
  }
  return Object.freeze({
    dataItemId: uuid(vertical.dataItemId, 'dataItemId'),
    ingestionId: uuid(vertical.ingestionId, 'ingestionId'),
    operationId: uuid(vertical.operationId, 'operationId'),
    versionId: uuid(vertical.versionId, 'versionId'),
  });
}

export function loadLiveCredentials(): LiveCredentials {
  const email = requiredEnvironment('WISER_WEB_LIVE_EMAIL');
  const password = requiredEnvironment('WISER_WEB_LIVE_PASSWORD');
  if (
    email.length > 320 ||
    !/^[^\s@]+@[^\s@]+$/.test(email) ||
    password.length < 6 ||
    password.length > 4_096
  ) {
    throw new Error('Authenticated browser test credentials are invalid.');
  }
  return Object.freeze({ email, password });
}
