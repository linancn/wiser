import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { ROOT_DIRECTORY, runCommand, runPostgresSql } from './operations.mjs';
import {
  parseSupabaseStatusEnvironment,
  signInLocalOperator,
} from './supabase-runtime.mjs';

export const VERTICAL_SMOKE_STEP_IDS = Object.freeze([
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
]);

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PURPOSE_PATTERN = /^[a-z][a-z0-9-]{0,95}$/;
const CONSUMER_PATTERN = /^[a-z][a-z0-9-]{0,127}$/;
const EXPECTED_PROJECTIONS = Object.freeze([
  'NEO4J',
  'OPENSEARCH',
  'POSTGIS',
  'STAC',
  'WEAVIATE',
]);
const TERMINAL_INGESTION_FAILURES = new Set([
  'CANCELLED',
  'FAILED',
  'REJECTED',
]);
const TERMINAL_OPERATION_FAILURES = new Set(['CANCELLED', 'FAILED']);
const DEFAULT_TENANT_ID = 'b1000000-0000-4000-8000-000000000001';
const DEFAULT_PROJECT_ID = 'b2000000-0000-4000-8000-000000000001';
const DEFAULT_OPERATOR_EMAIL = 'operator@agent-excon.test';
const DEFAULT_OPERATOR_PASSWORD = 'WiserLocalOperator-2026!';
const DEFAULT_MCP_BEARER_TOKEN = 'wiser-local-mcp-bearer-74cc91ef';
const MAX_JSON_RESPONSE_BYTES = 4 * 1024 * 1024;
const MAX_WEB_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAX_UPLOAD_RESPONSE_BYTES = 64 * 1024;
const MAX_DATABASE_RESPONSE_BYTES = 1024 * 1024;

const FIXTURES = Object.freeze([
  {
    key: 'geojson',
    fileName: 'sample-stations.geojson',
    mediaType: 'application/geo+json',
    path: join(
      ROOT_DIRECTORY,
      'tests/fixtures/data-foundation/sample-stations.geojson',
    ),
    expectedSha256:
      '35361986ce6b364c99dbcefc56ac266c07dac5dbdff2a95dfe392c3eac9bc975',
  },
  {
    key: 'evidence',
    fileName: 'sample-evidence.md',
    mediaType: 'text/markdown',
    path: join(
      ROOT_DIRECTORY,
      'tests/fixtures/data-foundation/sample-evidence.md',
    ),
    expectedSha256:
      '123afced4bc8e32ced1065c9d3d28d3118387f0a36b84e146cbbbbee861db930',
  },
]);

export class VerticalSmokeError extends Error {
  constructor(stepId, code, status) {
    super(
      `Data Foundation vertical smoke failed at ${stepId}: ${code}${
        status === undefined ? '' : ` (HTTP ${status})`
      }.`,
    );
    this.name = 'VerticalSmokeError';
    this.stepId = stepId;
    this.code = code;
    this.status = status;
  }
}

function fail(stepId, code, status) {
  throw new VerticalSmokeError(stepId, code, status);
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function record(value, stepId, code = 'INVALID_RESPONSE') {
  if (!isRecord(value)) fail(stepId, code);
  return value;
}

function string(value, stepId, code = 'INVALID_RESPONSE') {
  if (typeof value !== 'string' || value.length === 0) fail(stepId, code);
  return value;
}

function uuid(value, stepId, code = 'INVALID_RESPONSE') {
  const candidate = string(value, stepId, code);
  if (!UUID_PATTERN.test(candidate)) fail(stepId, code);
  return candidate;
}

function positiveInteger(value, stepId, code = 'INVALID_RESPONSE') {
  if (!Number.isSafeInteger(value) || value < 1) fail(stepId, code);
  return value;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function safeToken(value, minimum, maximum) {
  return (
    typeof value === 'string' &&
    value.length >= minimum &&
    value.length <= maximum &&
    !/\s/.test(value) &&
    ![...value].some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127;
    })
  );
}

function origin(value, stepId, code) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    fail(stepId, code);
  }
  if (
    !['http:', 'https:'].includes(parsed.protocol) ||
    parsed.username.length > 0 ||
    parsed.password.length > 0 ||
    parsed.pathname !== '/' ||
    parsed.search.length > 0 ||
    parsed.hash.length > 0
  ) {
    fail(stepId, code);
  }
  return parsed.origin;
}

function numberOption(value, fallback, minimum, maximum, stepId) {
  const selected = value ?? fallback;
  if (
    !Number.isSafeInteger(selected) ||
    selected < minimum ||
    selected > maximum
  ) {
    fail(stepId, 'INVALID_SMOKE_CONFIGURATION');
  }
  return selected;
}

function defaultWait(milliseconds, signal) {
  if (signal?.aborted === true) return Promise.resolve();
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', finish);
      resolve();
    };
    const timer = setTimeout(finish, milliseconds);
    signal?.addEventListener('abort', finish, { once: true });
  });
}

function createRuntime(options) {
  const stepId = VERTICAL_SMOKE_STEP_IDS[0];
  const now = options.now ?? Date.now;
  const maximumDurationMs = numberOption(
    options.maximumDurationMs,
    180_000,
    1_000,
    900_000,
    stepId,
  );
  const requestTimeoutMs = numberOption(
    options.requestTimeoutMs,
    10_000,
    100,
    60_000,
    stepId,
  );
  const pollIntervalMs = numberOption(
    options.pollIntervalMs,
    250,
    1,
    10_000,
    stepId,
  );
  return Object.freeze({
    fetch: options.fetch ?? globalThis.fetch,
    wait: options.wait ?? defaultWait,
    postgresSql: options.postgresSql ?? runPostgresSql,
    randomUuid: options.randomUuid ?? randomUUID,
    environment: options.environment ?? process.env,
    now,
    deadline: now() + maximumDurationMs,
    requestTimeoutMs,
    pollIntervalMs,
  });
}

function remaining(runtime, stepId) {
  const value = runtime.deadline - runtime.now();
  if (!Number.isFinite(value) || value <= 0) fail(stepId, 'DEADLINE_EXCEEDED');
  return Math.max(1, Math.min(runtime.requestTimeoutMs, Math.floor(value)));
}

async function boundedText(response, maximumBytes, stepId) {
  const declared = response.headers.get('content-length');
  if (
    declared !== null &&
    (!/^\d+$/.test(declared) || Number(declared) > maximumBytes)
  ) {
    try {
      await response.body?.cancel();
    } catch {
      // The safe size error remains authoritative.
    }
    fail(stepId, 'RESPONSE_TOO_LARGE');
  }
  if (response.body === null) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let total = 0;
  let result = '';
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      if (!(chunk.value instanceof Uint8Array)) {
        fail(stepId, 'INVALID_RESPONSE');
      }
      total += chunk.value.byteLength;
      if (total > maximumBytes) {
        try {
          await reader.cancel();
        } catch {
          // The safe size error remains authoritative.
        }
        fail(stepId, 'RESPONSE_TOO_LARGE');
      }
      try {
        result += decoder.decode(chunk.value, { stream: true });
      } catch {
        fail(stepId, 'INVALID_RESPONSE_ENCODING');
      }
    }
    try {
      result += decoder.decode();
    } catch {
      fail(stepId, 'INVALID_RESPONSE_ENCODING');
    }
    return result;
  } finally {
    reader.releaseLock();
  }
}

async function request(runtime, stepId, url, init, maximumBytes) {
  let response;
  try {
    response = await runtime.fetch(url, {
      ...init,
      redirect: init.redirect ?? 'error',
      signal: AbortSignal.timeout(remaining(runtime, stepId)),
    });
  } catch (error) {
    if (error instanceof VerticalSmokeError) throw error;
    fail(stepId, 'REQUEST_FAILED');
  }
  const text = await boundedText(response, maximumBytes, stepId);
  return { response, text };
}

function parseJson(text, stepId) {
  try {
    return JSON.parse(text);
  } catch {
    fail(stepId, 'INVALID_JSON_RESPONSE');
  }
}

async function jsonRequest(
  runtime,
  stepId,
  url,
  init,
  expectedStatuses,
  maximumBytes = MAX_JSON_RESPONSE_BYTES,
) {
  const { response, text } = await request(
    runtime,
    stepId,
    url,
    init,
    maximumBytes,
  );
  if (!expectedStatuses.includes(response.status)) {
    fail(stepId, 'HTTP_REQUEST_REJECTED', response.status);
  }
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes('application/json')) {
    fail(stepId, 'INVALID_RESPONSE_CONTENT_TYPE');
  }
  return parseJson(text, stepId);
}

async function resolveAuth(options, runtime, stepId) {
  const environment = runtime.environment;
  let auth = options.auth;
  if (auth === undefined) {
    const environmentToken = environment['DATA_API_BEARER_TOKEN'];
    if (safeToken(environmentToken, 24, 16_384)) {
      auth = {
        bearerToken: environmentToken,
        tenantId: environment['DATA_TENANT_ID'] ?? DEFAULT_TENANT_ID,
        projectId: environment['DATA_PROJECT_ID'] ?? DEFAULT_PROJECT_ID,
        purpose: environment['DATA_PURPOSE'] ?? 'data-foundation-smoke',
      };
    } else {
      let status;
      let bearerToken;
      try {
        const output = await runCommand(
          'pnpm',
          ['exec', 'supabase', 'status', '-o', 'env'],
          { environment },
        );
        status = parseSupabaseStatusEnvironment(output);
        bearerToken = await signInLocalOperator(status, {
          email:
            environment['WISER_LOCAL_OPERATOR_EMAIL'] ?? DEFAULT_OPERATOR_EMAIL,
          password:
            environment['WISER_LOCAL_OPERATOR_PASSWORD'] ??
            DEFAULT_OPERATOR_PASSWORD,
          fetch: runtime.fetch,
        });
      } catch {
        fail(stepId, 'AUTH_CONTEXT_UNAVAILABLE');
      }
      auth = {
        bearerToken,
        tenantId: environment['DATA_TENANT_ID'] ?? DEFAULT_TENANT_ID,
        projectId: environment['DATA_PROJECT_ID'] ?? DEFAULT_PROJECT_ID,
        purpose: environment['DATA_PURPOSE'] ?? 'data-foundation-smoke',
      };
    }
  }
  if (
    !safeToken(auth?.bearerToken, 24, 16_384) ||
    !UUID_PATTERN.test(auth?.tenantId ?? '') ||
    !UUID_PATTERN.test(auth?.projectId ?? '') ||
    !PURPOSE_PATTERN.test(auth?.purpose ?? '')
  ) {
    fail(stepId, 'INVALID_AUTH_CONTEXT');
  }
  return Object.freeze({ ...auth });
}

function apiHeaders(auth, extra = {}) {
  return {
    Accept: 'application/json',
    Authorization: `Bearer ${auth.bearerToken}`,
    'X-Wiser-Tenant-Id': auth.tenantId,
    'X-Wiser-Project-Id': auth.projectId,
    'X-Wiser-Purpose': auth.purpose,
    ...extra,
  };
}

async function apiJson(runtime, auth, apiOrigin, stepId, path, options = {}) {
  const method = options.method ?? 'GET';
  const headers = apiHeaders(auth, {
    ...(options.idempotencyKey === undefined
      ? {}
      : { 'Idempotency-Key': options.idempotencyKey }),
    ...(options.ifMatch === undefined
      ? {}
      : { 'If-Match': `"v${options.ifMatch}"` }),
    ...(options.body === undefined
      ? {}
      : { 'Content-Type': 'application/json' }),
  });
  return jsonRequest(
    runtime,
    stepId,
    new URL(path, `${apiOrigin}/`),
    {
      method,
      headers,
      ...(options.body === undefined
        ? {}
        : { body: JSON.stringify(options.body) }),
    },
    options.expectedStatuses ?? [200],
  );
}

async function loadFixtures(stepId) {
  let loaded;
  try {
    loaded = await Promise.all(
      FIXTURES.map(async (fixture) => {
        const content = await readFile(fixture.path);
        const digest = sha256(content);
        if (digest !== fixture.expectedSha256) {
          fail(stepId, 'FIXTURE_CHECKSUM_DRIFT');
        }
        return Object.freeze({ ...fixture, content, sha256: digest });
      }),
    );
  } catch (error) {
    if (error instanceof VerticalSmokeError) throw error;
    fail(stepId, 'FIXTURE_UNAVAILABLE');
  }
  return Object.freeze(loaded);
}

function uploadPlan(output, fixtures, stepId) {
  const document = record(output, stepId);
  const session = record(document.uploadSession, stepId);
  const uploadSessionId = uuid(session.uploadSessionId, stepId);
  const version = positiveInteger(session.version, stepId);
  if (
    session.status !== 'OPEN' ||
    !Array.isArray(session.assetIds) ||
    session.assetIds.length !== fixtures.length ||
    !Array.isArray(document.uploadTargets) ||
    document.uploadTargets.length !== fixtures.length
  ) {
    fail(stepId, 'INVALID_UPLOAD_SESSION');
  }
  const assets = session.assetIds.map((value) => uuid(value, stepId));
  if (new Set(assets).size !== assets.length) {
    fail(stepId, 'INVALID_UPLOAD_SESSION');
  }
  const targets = new Map();
  for (const rawTarget of document.uploadTargets) {
    const target = record(rawTarget, stepId);
    const assetId = uuid(target.assetId, stepId);
    if (
      target.method !== 'PRESIGNED_PUT' ||
      targets.has(assetId) ||
      !assets.includes(assetId) ||
      !isRecord(target.headers)
    ) {
      fail(stepId, 'INVALID_UPLOAD_TARGET');
    }
    let uploadUrl;
    try {
      uploadUrl = new URL(string(target.uploadUrl, stepId));
    } catch {
      fail(stepId, 'INVALID_UPLOAD_TARGET');
    }
    if (
      !['http:', 'https:'].includes(uploadUrl.protocol) ||
      uploadUrl.username.length > 0 ||
      uploadUrl.password.length > 0
    ) {
      fail(stepId, 'INVALID_UPLOAD_TARGET');
    }
    const headers = new Headers();
    for (const [name, value] of Object.entries(target.headers)) {
      if (
        typeof value !== 'string' ||
        name.length < 1 ||
        name.length > 128 ||
        value.length > 4_096 ||
        name.toLowerCase() === 'authorization'
      ) {
        fail(stepId, 'INVALID_UPLOAD_TARGET');
      }
      headers.set(name, value);
    }
    targets.set(assetId, Object.freeze({ uploadUrl, headers }));
  }
  return Object.freeze({ uploadSessionId, version, assets, targets });
}

async function uploadFixtures(runtime, fixtures, plan, stepId) {
  const completed = [];
  for (const [index, fixture] of fixtures.entries()) {
    const assetId = plan.assets[index];
    const target = plan.targets.get(assetId);
    if (target === undefined) fail(stepId, 'INVALID_UPLOAD_TARGET');
    const { response } = await request(
      runtime,
      stepId,
      target.uploadUrl,
      {
        method: 'PUT',
        headers: target.headers,
        body: fixture.content,
      },
      MAX_UPLOAD_RESPONSE_BYTES,
    );
    if (![200, 201, 204].includes(response.status)) {
      fail(stepId, 'UPLOAD_REJECTED', response.status);
    }
    const etag = response.headers.get('etag');
    if (etag !== null && (etag.length < 1 || etag.length > 1_024)) {
      fail(stepId, 'INVALID_UPLOAD_RESPONSE');
    }
    completed.push({
      assetId,
      sizeBytes: fixture.content.byteLength,
      sha256: fixture.sha256,
      ...(etag === null ? {} : { etag }),
    });
  }
  return Object.freeze(completed);
}

function ingestionProjection(value, expectedIngestionId, stepId) {
  const envelope = record(value, stepId);
  const ingestion = record(envelope.ingestion, stepId);
  const ingestionId = uuid(ingestion.ingestionId, stepId);
  if (ingestionId !== expectedIngestionId) fail(stepId, 'INVALID_INGESTION');
  return Object.freeze({
    ingestionId,
    operationId: uuid(ingestion.operationId, stepId),
    state: string(ingestion.state, stepId),
    version: positiveInteger(ingestion.version, stepId),
  });
}

function operationProjection(value, expectedOperationId, stepId) {
  const candidate = record(value, stepId);
  const operation = isRecord(candidate.operation)
    ? candidate.operation
    : candidate;
  const operationId = uuid(operation.operationId, stepId);
  if (operationId !== expectedOperationId) fail(stepId, 'INVALID_OPERATION');
  return Object.freeze({
    operationId,
    status: string(operation.status, stepId),
    version: positiveInteger(operation.version, stepId),
  });
}

async function pause(runtime, stepId) {
  const timeoutMs = Math.min(
    remaining(runtime, stepId),
    runtime.requestTimeoutMs,
  );
  const signal = AbortSignal.timeout(timeoutMs);
  let rejectGuard;
  const guard = new Promise((_, reject) => {
    rejectGuard = () => reject(new Error('bounded wait expired'));
    signal.addEventListener('abort', rejectGuard, { once: true });
  });
  try {
    await Promise.race([runtime.wait(runtime.pollIntervalMs, signal), guard]);
  } catch {
    fail(stepId, 'WAIT_FAILED');
  } finally {
    signal.removeEventListener('abort', rejectGuard);
  }
  remaining(runtime, stepId);
}

async function boundedWork(runtime, stepId, work) {
  const signal = AbortSignal.timeout(
    Math.min(remaining(runtime, stepId), runtime.requestTimeoutMs),
  );
  let rejectGuard;
  const guard = new Promise((_, reject) => {
    rejectGuard = () => reject(new Error('bounded work expired'));
    signal.addEventListener('abort', rejectGuard, { once: true });
  });
  try {
    return await Promise.race([work, guard]);
  } finally {
    signal.removeEventListener('abort', rejectGuard);
  }
}

async function waitForPublication(
  runtime,
  auth,
  apiOrigin,
  ingestionId,
  operationId,
  approveKey,
) {
  const stepId = VERTICAL_SMOKE_STEP_IDS[3];
  let approved = false;
  while (true) {
    const [rawIngestion, rawOperation] = await Promise.all([
      apiJson(
        runtime,
        auth,
        apiOrigin,
        stepId,
        `/api/data/v1/ingestions/${ingestionId}`,
      ),
      apiJson(
        runtime,
        auth,
        apiOrigin,
        stepId,
        `/api/data/v1/operations/${operationId}`,
      ),
    ]);
    const ingestion = ingestionProjection(rawIngestion, ingestionId, stepId);
    const operation = operationProjection(rawOperation, operationId, stepId);
    if (TERMINAL_INGESTION_FAILURES.has(ingestion.state)) {
      fail(stepId, 'INGESTION_TERMINATED');
    }
    if (TERMINAL_OPERATION_FAILURES.has(operation.status)) {
      fail(stepId, 'OPERATION_TERMINATED');
    }
    if (
      ingestion.state === 'REVIEW_REQUIRED' &&
      operation.status === 'WAITING_REVIEW' &&
      !approved
    ) {
      const approval = await apiJson(
        runtime,
        auth,
        apiOrigin,
        stepId,
        `/api/data/v1/ingestions/${ingestionId}/approve`,
        {
          method: 'POST',
          body: {
            reviewNote: 'Approved by the deterministic vertical smoke.',
          },
          idempotencyKey: approveKey,
          ifMatch: ingestion.version,
          expectedStatuses: [202],
        },
      );
      operationProjection(approval, operationId, stepId);
      approved = true;
    }
    if (ingestion.state === 'PUBLISHED' && operation.status === 'SUCCEEDED') {
      if (!approved) fail(stepId, 'REVIEW_GATE_NOT_OBSERVED');
      return Object.freeze({ ingestion, operation, approved });
    }
    await pause(runtime, stepId);
  }
}

function authorityEvidenceSql(auth, ingestionId, consumerName) {
  return `
/* vertical-smoke.authority-evidence */
select json_build_object(
  'dataItemId', '${ingestionId}'::uuid,
  'versionId', (
    select version_id::text from catalog.data_item_version
    where tenant_id = '${auth.tenantId}'::uuid
      and project_id = '${auth.projectId}'::uuid
      and data_item_id = '${ingestionId}'::uuid
    order by version_number desc limit 1
  ),
  'ingestionState', (
    select state from ingestion.session
    where tenant_id = '${auth.tenantId}'::uuid
      and project_id = '${auth.projectId}'::uuid
      and ingestion_id = '${ingestionId}'::uuid
  ),
  'operationStatus', (
    select operation.status from service.operation as operation
    join ingestion.session as session
      on session.tenant_id = operation.tenant_id
     and session.project_id = operation.project_id
     and session.operation_id = operation.operation_id
    where session.tenant_id = '${auth.tenantId}'::uuid
      and session.project_id = '${auth.projectId}'::uuid
      and session.ingestion_id = '${ingestionId}'::uuid
  ),
  'itemPublicationStatus', (
    select publication_status from catalog.data_item
    where tenant_id = '${auth.tenantId}'::uuid
      and project_id = '${auth.projectId}'::uuid
      and data_item_id = '${ingestionId}'::uuid
  ),
  'versionPublicationStatus', (
    select publication_status from catalog.data_item_version
    where tenant_id = '${auth.tenantId}'::uuid
      and project_id = '${auth.projectId}'::uuid
      and data_item_id = '${ingestionId}'::uuid
    order by version_number desc limit 1
  ),
  'assetCount', (select count(*) from ingestion.input_asset
    where tenant_id = '${auth.tenantId}'::uuid
      and project_id = '${auth.projectId}'::uuid
      and ingestion_id = '${ingestionId}'::uuid),
  'scannedAssetCount', (select count(*) from ingestion.input_asset
    where tenant_id = '${auth.tenantId}'::uuid
      and project_id = '${auth.projectId}'::uuid
      and ingestion_id = '${ingestionId}'::uuid and scan_status = 'CLEAN'),
  'fingerprintedAssetCount', (select count(*) from ingestion.input_asset
    where tenant_id = '${auth.tenantId}'::uuid
      and project_id = '${auth.projectId}'::uuid
      and ingestion_id = '${ingestionId}'::uuid and fingerprint is not null),
  'rawAssetCount', (select count(*) from catalog.asset as asset
    join ingestion.input_asset as input
      on input.tenant_id = asset.tenant_id
     and input.project_id = asset.project_id and input.asset_id = asset.asset_id
    where input.tenant_id = '${auth.tenantId}'::uuid
      and input.project_id = '${auth.projectId}'::uuid
      and input.ingestion_id = '${ingestionId}'::uuid
      and asset.lifecycle_state = 'RAW' and asset.version_id is not null),
  'contentBlobCount', (select count(*) from catalog.content_blob as blob
    join catalog.asset as asset
      on asset.tenant_id = blob.tenant_id
     and asset.project_id = blob.project_id
     and asset.content_blob_id = blob.content_blob_id
    join ingestion.input_asset as input
      on input.tenant_id = asset.tenant_id
     and input.project_id = asset.project_id and input.asset_id = asset.asset_id
    where input.tenant_id = '${auth.tenantId}'::uuid
      and input.project_id = '${auth.projectId}'::uuid
      and input.ingestion_id = '${ingestionId}'::uuid),
  'rawBlobCount', (select count(*) from catalog.content_blob as blob
    join catalog.asset as asset
      on asset.tenant_id = blob.tenant_id
     and asset.project_id = blob.project_id
     and asset.content_blob_id = blob.content_blob_id
    join ingestion.input_asset as input
      on input.tenant_id = asset.tenant_id
     and input.project_id = asset.project_id and input.asset_id = asset.asset_id
    where input.tenant_id = '${auth.tenantId}'::uuid
      and input.project_id = '${auth.projectId}'::uuid
      and input.ingestion_id = '${ingestionId}'::uuid
      and blob.lifecycle_state = 'RAW' and blob.raw_storage_key is not null),
  'agentRunCount', (select count(*) from ingestion.agent_run
    where tenant_id = '${auth.tenantId}'::uuid
      and project_id = '${auth.projectId}'::uuid
      and ingestion_id = '${ingestionId}'::uuid and status = 'SUCCEEDED'),
  'agentActionCount', (select count(*) from ingestion.agent_action as action
    join ingestion.agent_run as run
      on run.tenant_id = action.tenant_id
     and run.project_id = action.project_id
     and run.agent_run_id = action.agent_run_id
    where run.tenant_id = '${auth.tenantId}'::uuid
      and run.project_id = '${auth.projectId}'::uuid
      and run.ingestion_id = '${ingestionId}'::uuid),
  'transformPlanCount', (select count(*) from ingestion.transform_plan
    where tenant_id = '${auth.tenantId}'::uuid
      and project_id = '${auth.projectId}'::uuid
      and ingestion_id = '${ingestionId}'::uuid),
  'approvedReviewCount', (select count(*) from ingestion.review
    where tenant_id = '${auth.tenantId}'::uuid
      and project_id = '${auth.projectId}'::uuid
      and ingestion_id = '${ingestionId}'::uuid and decision = 'APPROVED'),
  'qualityCheckCount', (select count(*) from quality.check_run
    where tenant_id = '${auth.tenantId}'::uuid
      and project_id = '${auth.projectId}'::uuid
      and ingestion_id = '${ingestionId}'::uuid and status = 'SUCCEEDED'),
  'qualityScorecardCount', (select count(*) from quality.scorecard as scorecard
    join quality.check_run as check_run
      on check_run.tenant_id = scorecard.tenant_id
     and check_run.project_id = scorecard.project_id
     and check_run.check_run_id = scorecard.check_run_id
    where check_run.tenant_id = '${auth.tenantId}'::uuid
      and check_run.project_id = '${auth.projectId}'::uuid
      and check_run.ingestion_id = '${ingestionId}'::uuid),
  'dataItemCount', (select count(*) from catalog.data_item
    where tenant_id = '${auth.tenantId}'::uuid
      and project_id = '${auth.projectId}'::uuid
      and data_item_id = '${ingestionId}'::uuid),
  'versionCount', (select count(*) from catalog.data_item_version
    where tenant_id = '${auth.tenantId}'::uuid
      and project_id = '${auth.projectId}'::uuid
      and data_item_id = '${ingestionId}'::uuid),
  'evidenceCount', (select count(*) from knowledge.evidence_fragment
    where tenant_id = '${auth.tenantId}'::uuid
      and project_id = '${auth.projectId}'::uuid
      and data_item_id = '${ingestionId}'::uuid),
  'spatialCount', (select count(*) from catalog.spatial_extent
    where tenant_id = '${auth.tenantId}'::uuid
      and project_id = '${auth.projectId}'::uuid
      and data_item_id = '${ingestionId}'::uuid),
  'lineageCount', (select count(*) from lineage.process_run
    where tenant_id = '${auth.tenantId}'::uuid
      and project_id = '${auth.projectId}'::uuid
      and ingestion_id = '${ingestionId}'::uuid and status = 'SUCCEEDED'),
  'outboxCount', (select count(*) from event.outbox_event
    where tenant_id = '${auth.tenantId}'::uuid
      and project_id = '${auth.projectId}'::uuid
      and event_type = 'data.version.committed'
      and payload ->> 'dataItemId' = '${ingestionId}'),
  'outboxEventId', (select outbox_event_id::text from event.outbox_event
    where tenant_id = '${auth.tenantId}'::uuid
      and project_id = '${auth.projectId}'::uuid
      and event_type = 'data.version.committed'
      and payload ->> 'dataItemId' = '${ingestionId}'
    order by outbox_event_id desc limit 1),
  'maxOutboxEventId', (select coalesce(max(outbox_event_id), 0)::text
    from event.outbox_event
    where tenant_id = '${auth.tenantId}'::uuid
      and project_id = '${auth.projectId}'::uuid
      and event_type = 'data.version.committed'),
  'checkpointEventId', (select last_outbox_event_id::text
    from event.consumer_checkpoint
    where tenant_id = '${auth.tenantId}'::uuid
      and project_id = '${auth.projectId}'::uuid
      and consumer_name = '${consumerName}'
      and partition_key = 'data.version.committed'),
  'projections', coalesce((select json_agg(json_build_object(
      'kind', projection_kind,
      'status', status,
      'attemptCount', attempt_count
    ) order by projection_kind)
    from service.projection_status
    where tenant_id = '${auth.tenantId}'::uuid
      and project_id = '${auth.projectId}'::uuid
      and data_item_id = '${ingestionId}'::uuid), '[]'::json)
)::text;
`;
}

function count(evidence, key, stepId) {
  const value = evidence[key];
  if (!Number.isSafeInteger(value) || value < 0) {
    fail(stepId, 'INVALID_AUTHORITY_EVIDENCE');
  }
  return value;
}

function eventId(value, stepId) {
  const normalized =
    typeof value === 'number' && Number.isSafeInteger(value)
      ? String(value)
      : value;
  if (typeof normalized !== 'string' || !/^[1-9]\d*$/.test(normalized)) {
    fail(stepId, 'INVALID_AUTHORITY_EVIDENCE');
  }
  return normalized;
}

async function readAuthorityEvidence(
  runtime,
  auth,
  ingestionId,
  consumerName,
  stepId,
) {
  let output;
  try {
    output = await boundedWork(
      runtime,
      stepId,
      runtime.postgresSql(
        authorityEvidenceSql(auth, ingestionId, consumerName),
      ),
    );
  } catch {
    fail(stepId, 'AUTHORITY_EVIDENCE_UNAVAILABLE');
  }
  if (
    typeof output !== 'string' ||
    Buffer.byteLength(output) > MAX_DATABASE_RESPONSE_BYTES
  ) {
    fail(stepId, 'INVALID_AUTHORITY_EVIDENCE');
  }
  const evidence = record(parseJson(output.trim(), stepId), stepId);
  const versionId = uuid(
    evidence.versionId,
    stepId,
    'INVALID_AUTHORITY_EVIDENCE',
  );
  if (
    evidence.dataItemId !== ingestionId ||
    evidence.ingestionState !== 'PUBLISHED' ||
    evidence.operationStatus !== 'SUCCEEDED' ||
    evidence.itemPublicationStatus !== 'PUBLISHED' ||
    evidence.versionPublicationStatus !== 'PUBLISHED' ||
    count(evidence, 'assetCount', stepId) !== 2 ||
    count(evidence, 'scannedAssetCount', stepId) !== 2 ||
    count(evidence, 'fingerprintedAssetCount', stepId) !== 2 ||
    count(evidence, 'rawAssetCount', stepId) !== 2 ||
    count(evidence, 'contentBlobCount', stepId) !== 2 ||
    count(evidence, 'rawBlobCount', stepId) !== 2 ||
    count(evidence, 'agentRunCount', stepId) < 1 ||
    count(evidence, 'agentActionCount', stepId) < 1 ||
    count(evidence, 'transformPlanCount', stepId) < 1 ||
    count(evidence, 'approvedReviewCount', stepId) !== 1 ||
    count(evidence, 'qualityCheckCount', stepId) !== 1 ||
    count(evidence, 'qualityScorecardCount', stepId) !== 1 ||
    count(evidence, 'dataItemCount', stepId) !== 1 ||
    count(evidence, 'versionCount', stepId) !== 1 ||
    count(evidence, 'evidenceCount', stepId) !== 2 ||
    count(evidence, 'spatialCount', stepId) < 1 ||
    count(evidence, 'lineageCount', stepId) !== 1 ||
    count(evidence, 'outboxCount', stepId) !== 1 ||
    !Array.isArray(evidence.projections) ||
    evidence.projections.length !== EXPECTED_PROJECTIONS.length
  ) {
    fail(stepId, 'AUTHORITY_INVARIANT_FAILED');
  }
  const projections = evidence.projections.map((raw) => {
    const projection = record(raw, stepId, 'INVALID_AUTHORITY_EVIDENCE');
    return Object.freeze({
      kind: string(projection.kind, stepId, 'INVALID_AUTHORITY_EVIDENCE'),
      status: string(projection.status, stepId, 'INVALID_AUTHORITY_EVIDENCE'),
      attemptCount: positiveInteger(
        projection.attemptCount,
        stepId,
        'INVALID_AUTHORITY_EVIDENCE',
      ),
    });
  });
  if (
    projections.some(
      (projection, index) =>
        projection.kind !== EXPECTED_PROJECTIONS[index] ||
        projection.status !== 'SUCCEEDED',
    )
  ) {
    fail(stepId, 'PROJECTION_GATE_FAILED');
  }
  const outboxEventId = eventId(evidence.outboxEventId, stepId);
  const maxOutboxEventId = eventId(evidence.maxOutboxEventId, stepId);
  const checkpointEventId = eventId(evidence.checkpointEventId, stepId);
  if (
    BigInt(outboxEventId) !== BigInt(maxOutboxEventId) ||
    BigInt(checkpointEventId) < BigInt(outboxEventId)
  ) {
    fail(stepId, 'OUTBOX_CHECKPOINT_NOT_CURRENT');
  }
  return Object.freeze({
    raw: evidence,
    versionId,
    outboxEventId,
    projections: Object.freeze(projections),
  });
}

function rewindCheckpointSql(auth, consumerName, outboxEventId) {
  const previous = BigInt(outboxEventId) - 1n;
  return `
/* vertical-smoke.rewind-projection-checkpoint */
update event.consumer_checkpoint
set last_outbox_event_id = ${previous},
    row_version = row_version + 1,
    updated_at = clock_timestamp()
where tenant_id = '${auth.tenantId}'::uuid
  and project_id = '${auth.projectId}'::uuid
  and consumer_name = '${consumerName}'
  and partition_key = 'data.version.committed'
  and last_outbox_event_id = ${outboxEventId}
returning 'replayed';
`;
}

function checkpointSql(auth, consumerName) {
  return `
/* vertical-smoke.projection-checkpoint */
select last_outbox_event_id::text
from event.consumer_checkpoint
where tenant_id = '${auth.tenantId}'::uuid
  and project_id = '${auth.projectId}'::uuid
  and consumer_name = '${consumerName}'
  and partition_key = 'data.version.committed';
`;
}

async function replayProjectionDelivery(
  runtime,
  auth,
  consumerName,
  outboxEventId,
  stepId,
) {
  let replayed;
  try {
    replayed = await boundedWork(
      runtime,
      stepId,
      runtime.postgresSql(
        rewindCheckpointSql(auth, consumerName, outboxEventId),
      ),
    );
  } catch {
    fail(stepId, 'PROJECTION_REPLAY_FAILED');
  }
  if (replayed.trim() !== 'replayed') {
    fail(stepId, 'PROJECTION_REPLAY_CONFLICT');
  }
  while (true) {
    let checkpoint;
    try {
      checkpoint = await boundedWork(
        runtime,
        stepId,
        runtime.postgresSql(checkpointSql(auth, consumerName)),
      );
    } catch {
      fail(stepId, 'PROJECTION_REPLAY_FAILED');
    }
    const value = checkpoint.trim();
    if (/^[1-9]\d*$/.test(value) && BigInt(value) >= BigInt(outboxEventId)) {
      return;
    }
    await pause(runtime, stepId);
  }
}

function assertPublishedItem(value, dataItemId, versionId, stepId) {
  const envelope = record(value, stepId);
  const item = record(envelope.item, stepId);
  const selectedVersion = record(envelope.selectedVersion, stepId);
  if (
    item.dataItemId !== dataItemId ||
    item.publicationStatus !== 'PUBLISHED' ||
    selectedVersion.versionId !== versionId
  ) {
    fail(stepId, 'PUBLISHED_ITEM_NOT_FOUND');
  }
  return Object.freeze({
    dataItemId,
    versionId,
    name: string(item.name, stepId),
  });
}

function assertSearchResult(value, dataItemId, versionId, stepId) {
  const envelope = record(value, stepId);
  if (!Array.isArray(envelope.items)) fail(stepId, 'INVALID_SEARCH_RESPONSE');
  const matches = envelope.items.filter(
    (item) =>
      isRecord(item) &&
      item.dataItemId === dataItemId &&
      item.versionId === versionId,
  );
  if (matches.length !== 1) fail(stepId, 'SEARCH_DEDUPLICATION_FAILED');
}

async function queryRest(runtime, auth, apiOrigin, dataItemId, versionId) {
  const stepId = VERTICAL_SMOKE_STEP_IDS[14];
  const item = await apiJson(
    runtime,
    auth,
    apiOrigin,
    stepId,
    `/api/data/v1/catalog/data-items/${dataItemId}?versionId=${versionId}`,
  );
  const projection = assertPublishedItem(item, dataItemId, versionId, stepId);
  const search = await apiJson(
    runtime,
    auth,
    apiOrigin,
    stepId,
    '/api/data/v1/search',
    {
      method: 'POST',
      body: { query: `Ingestion ${dataItemId}`, first: 50 },
    },
  );
  assertSearchResult(search, dataItemId, versionId, stepId);
  return projection;
}

async function queryGraphql(runtime, auth, apiOrigin, dataItemId, versionId) {
  const stepId = VERTICAL_SMOKE_STEP_IDS[15];
  const document = await jsonRequest(
    runtime,
    stepId,
    new URL('/graphql', `${apiOrigin}/`),
    {
      method: 'POST',
      headers: apiHeaders(auth, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        operationName: 'VerticalSmokeDataItem',
        query:
          'query VerticalSmokeDataItem($id: ID!, $version: ID!) { dataItem(id: $id, version: $version) { dataItemId name securityLevel selectedVersion { versionId version } } }',
        variables: { id: dataItemId, version: versionId },
      }),
    },
    [200],
  );
  const envelope = record(document, stepId);
  if (Array.isArray(envelope.errors) && envelope.errors.length > 0) {
    fail(stepId, 'GRAPHQL_QUERY_FAILED');
  }
  const data = record(envelope.data, stepId);
  const item = record(data.dataItem, stepId);
  const selectedVersion = record(item.selectedVersion, stepId);
  if (
    item.dataItemId !== dataItemId ||
    selectedVersion.versionId !== versionId
  ) {
    fail(stepId, 'GRAPHQL_ITEM_NOT_FOUND');
  }
  return Object.freeze({
    dataItemId,
    versionId,
    name: string(item.name, stepId),
  });
}

async function mcpMessage(runtime, mcpOrigin, bearerToken, stepId, message) {
  return jsonRequest(
    runtime,
    stepId,
    new URL('/mcp', `${mcpOrigin}/`),
    {
      method: 'POST',
      headers: {
        Accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${bearerToken}`,
        'Content-Type': 'application/json',
        'MCP-Protocol-Version': '2025-06-18',
      },
      body: JSON.stringify(message),
    },
    [200],
  );
}

async function queryMcp(
  runtime,
  mcpOrigin,
  bearerToken,
  dataItemId,
  versionId,
  initialize,
) {
  const stepId = VERTICAL_SMOKE_STEP_IDS[16];
  if (initialize) {
    const initialized = record(
      await mcpMessage(runtime, mcpOrigin, bearerToken, stepId, {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'wiser-data-smoke', version: '1.0.0' },
        },
      }),
      stepId,
    );
    if (!isRecord(initialized.result)) fail(stepId, 'MCP_INITIALIZE_FAILED');
  }
  const response = record(
    await mcpMessage(runtime, mcpOrigin, bearerToken, stepId, {
      jsonrpc: '2.0',
      id: initialize ? 2 : 3,
      method: 'tools/call',
      params: {
        name: 'data_catalog_get',
        arguments: { dataItemId, versionId },
      },
    }),
    stepId,
  );
  const result = record(response.result, stepId);
  const structured = record(result.structuredContent, stepId);
  if (result.isError === true || structured.ok !== true) {
    fail(stepId, 'MCP_TOOL_FAILED');
  }
  return assertPublishedItem(structured.data, dataItemId, versionId, stepId);
}

function appendCookies(jar, response, stepId) {
  const values =
    typeof response.headers.getSetCookie === 'function'
      ? response.headers.getSetCookie()
      : [response.headers.get('set-cookie')].filter(Boolean);
  for (const value of values) {
    if (
      typeof value !== 'string' ||
      value.length > 16_384 ||
      /[\r\n]/.test(value)
    ) {
      fail(stepId, 'INVALID_WEB_SESSION');
    }
    const first = value.split(';', 1)[0];
    const separator = first.indexOf('=');
    if (separator < 1) fail(stepId, 'INVALID_WEB_SESSION');
    jar.set(first.slice(0, separator), first.slice(separator + 1));
  }
}

function cookieHeader(jar) {
  return [...jar.entries()]
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');
}

async function queryWeb(
  runtime,
  webOrigin,
  credentials,
  dataItemId,
  expectedName,
) {
  const stepId = VERTICAL_SMOKE_STEP_IDS[17];
  if (
    typeof credentials.email !== 'string' ||
    credentials.email.length > 320 ||
    !/^[^\s@]+@[^\s@]+$/.test(credentials.email) ||
    typeof credentials.password !== 'string' ||
    credentials.password.length < 6 ||
    credentials.password.length > 4_096
  ) {
    fail(stepId, 'INVALID_WEB_CREDENTIALS');
  }
  const detailPath = `/zh-CN/data-foundation/catalog/${dataItemId}`;
  const loginBody = new URLSearchParams({
    email: credentials.email,
    password: credentials.password,
    next: detailPath,
  });
  const login = await request(
    runtime,
    stepId,
    new URL('/zh-CN/auth/login', `${webOrigin}/`),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: loginBody,
      redirect: 'manual',
    },
    MAX_UPLOAD_RESPONSE_BYTES,
  );
  if (login.response.status !== 303) {
    fail(stepId, 'WEB_LOGIN_REJECTED', login.response.status);
  }
  const jar = new Map();
  appendCookies(jar, login.response, stepId);
  if (jar.size === 0) fail(stepId, 'WEB_SESSION_MISSING');
  const location = login.response.headers.get('location');
  let pageUrl;
  try {
    pageUrl = new URL(string(location, stepId), `${webOrigin}/`);
  } catch {
    fail(stepId, 'INVALID_WEB_REDIRECT');
  }
  if (pageUrl.pathname !== detailPath) {
    fail(stepId, 'INVALID_WEB_REDIRECT');
  }
  pageUrl = new URL(`${pageUrl.pathname}${pageUrl.search}`, `${webOrigin}/`);
  let page;
  for (let redirects = 0; redirects < 3; redirects += 1) {
    page = await request(
      runtime,
      stepId,
      pageUrl,
      {
        method: 'GET',
        headers: { Accept: 'text/html', Cookie: cookieHeader(jar) },
        redirect: 'manual',
      },
      MAX_WEB_RESPONSE_BYTES,
    );
    appendCookies(jar, page.response, stepId);
    if (![301, 302, 303, 307, 308].includes(page.response.status)) break;
    const next = page.response.headers.get('location');
    try {
      const redirected = new URL(string(next, stepId), pageUrl);
      if (!redirected.pathname.startsWith('/zh-CN/')) {
        fail(stepId, 'INVALID_WEB_REDIRECT');
      }
      pageUrl = new URL(
        `${redirected.pathname}${redirected.search}`,
        `${webOrigin}/`,
      );
    } catch {
      fail(stepId, 'INVALID_WEB_REDIRECT');
    }
  }
  if (page === undefined || page.response.status !== 200) {
    fail(stepId, 'WEB_CATALOG_UNAVAILABLE', page?.response.status);
  }
  const contentType = page.response.headers.get('content-type') ?? '';
  if (
    !contentType.toLowerCase().includes('text/html') ||
    !page.text.includes(dataItemId) ||
    !page.text.includes(expectedName)
  ) {
    fail(stepId, 'WEB_CATALOG_ITEM_NOT_RENDERED');
  }
}

function comparableEvidence(evidence) {
  return JSON.stringify({
    dataItemId: evidence.raw.dataItemId,
    versionId: evidence.versionId,
    versionCount: evidence.raw.versionCount,
    outboxCount: evidence.raw.outboxCount,
    projections: evidence.projections,
  });
}

export async function runDataFoundationVerticalSmoke(options = {}) {
  const runtime = createRuntime(options);
  const firstStep = VERTICAL_SMOKE_STEP_IDS[0];
  const auth = await resolveAuth(options, runtime, firstStep);
  const apiOrigin = origin(
    options.apiOrigin ??
      runtime.environment['DATA_API_ORIGIN'] ??
      'http://127.0.0.1:3001',
    firstStep,
    'INVALID_API_ORIGIN',
  );
  const mcpOrigin = origin(
    options.mcpOrigin ??
      runtime.environment['DATA_MCP_ORIGIN'] ??
      'http://127.0.0.1:13004',
    VERTICAL_SMOKE_STEP_IDS[16],
    'INVALID_MCP_ORIGIN',
  );
  const webOrigin = origin(
    options.webOrigin ??
      runtime.environment['DATA_WEB_ORIGIN'] ??
      'http://127.0.0.1:3000',
    VERTICAL_SMOKE_STEP_IDS[17],
    'INVALID_WEB_ORIGIN',
  );
  const mcpBearerToken =
    options.mcpBearerToken ??
    runtime.environment['DATA_MCP_BEARER_TOKEN'] ??
    DEFAULT_MCP_BEARER_TOKEN;
  if (!safeToken(mcpBearerToken, 16, 8_192)) {
    fail(VERTICAL_SMOKE_STEP_IDS[16], 'INVALID_MCP_AUTH_CONTEXT');
  }
  const webCredentials =
    options.webCredentials ??
    Object.freeze({
      email:
        runtime.environment['WISER_LOCAL_OPERATOR_EMAIL'] ??
        DEFAULT_OPERATOR_EMAIL,
      password:
        runtime.environment['WISER_LOCAL_OPERATOR_PASSWORD'] ??
        DEFAULT_OPERATOR_PASSWORD,
    });
  const consumerName =
    options.consumerName ??
    runtime.environment['DATA_PROJECTION_CONSUMER_NAME'] ??
    'data-worker-projection-v1';
  if (!CONSUMER_PATTERN.test(consumerName)) {
    fail(firstStep, 'INVALID_PROJECTION_CONSUMER');
  }
  const completedSteps = [];
  const complete = (id) => {
    if (id !== VERTICAL_SMOKE_STEP_IDS[completedSteps.length]) {
      fail(id, 'SMOKE_STEP_ORDER_VIOLATION');
    }
    completedSteps.push(
      Object.freeze({ number: completedSteps.length + 1, id, status: 'ok' }),
    );
  };
  const nextKey = () =>
    uuid(runtime.randomUuid(), firstStep, 'INVALID_ID_FACTORY');

  const fixtures = await loadFixtures(firstStep);
  const uploadCreateKey = nextKey();
  const uploadOutput = await apiJson(
    runtime,
    auth,
    apiOrigin,
    firstStep,
    '/api/data/v1/upload-sessions',
    {
      method: 'POST',
      body: {
        ownerProjectId: auth.projectId,
        preferredMode: 'PRESIGNED_PUT',
        objects: fixtures.map((fixture) => ({
          fileName: fixture.fileName,
          mediaType: fixture.mediaType,
          sizeBytes: fixture.content.byteLength,
          sha256: fixture.sha256,
        })),
      },
      idempotencyKey: uploadCreateKey,
      expectedStatuses: [201],
    },
  );
  const plan = uploadPlan(uploadOutput, fixtures, firstStep);
  complete(firstStep);

  const uploaded = await uploadFixtures(
    runtime,
    fixtures,
    plan,
    VERTICAL_SMOKE_STEP_IDS[1],
  );
  const uploadCompleteKey = nextKey();
  const completedUpload = await apiJson(
    runtime,
    auth,
    apiOrigin,
    VERTICAL_SMOKE_STEP_IDS[1],
    `/api/data/v1/upload-sessions/${plan.uploadSessionId}/complete`,
    {
      method: 'POST',
      body: { objects: uploaded },
      idempotencyKey: uploadCompleteKey,
      ifMatch: plan.version,
      expectedStatuses: [200],
    },
  );
  const completedSession = record(
    record(completedUpload, VERTICAL_SMOKE_STEP_IDS[1]).uploadSession,
    VERTICAL_SMOKE_STEP_IDS[1],
  );
  if (
    completedSession.uploadSessionId !== plan.uploadSessionId ||
    completedSession.status !== 'COMPLETED' ||
    completedSession.version !== plan.version + 1
  ) {
    fail(VERTICAL_SMOKE_STEP_IDS[1], 'UPLOAD_COMPLETION_FAILED');
  }
  complete(VERTICAL_SMOKE_STEP_IDS[1]);

  const ingestionCreateKey = nextKey();
  const ingestionOutput = record(
    await apiJson(
      runtime,
      auth,
      apiOrigin,
      VERTICAL_SMOKE_STEP_IDS[2],
      '/api/data/v1/ingestions',
      {
        method: 'POST',
        body: {
          assetIds: plan.assets,
          ownerProjectId: auth.projectId,
          intendedUses: ['vertical-smoke'],
          requestedSecurityLevel: 'L1_INTERNAL',
        },
        idempotencyKey: ingestionCreateKey,
        expectedStatuses: [202],
      },
    ),
    VERTICAL_SMOKE_STEP_IDS[2],
  );
  const ingestionId = uuid(
    ingestionOutput.ingestionId,
    VERTICAL_SMOKE_STEP_IDS[2],
  );
  const createdOperation = operationProjection(
    ingestionOutput.operation,
    uuid(
      record(ingestionOutput.operation, VERTICAL_SMOKE_STEP_IDS[2]).operationId,
      VERTICAL_SMOKE_STEP_IDS[2],
    ),
    VERTICAL_SMOKE_STEP_IDS[2],
  );
  const operationId = createdOperation.operationId;
  complete(VERTICAL_SMOKE_STEP_IDS[2]);

  const submitKey = nextKey();
  const submit = await apiJson(
    runtime,
    auth,
    apiOrigin,
    VERTICAL_SMOKE_STEP_IDS[3],
    `/api/data/v1/ingestions/${ingestionId}/submit`,
    {
      method: 'POST',
      body: {},
      idempotencyKey: submitKey,
      ifMatch: 1,
      expectedStatuses: [202],
    },
  );
  operationProjection(submit, operationId, VERTICAL_SMOKE_STEP_IDS[3]);
  const replayedSubmit = await apiJson(
    runtime,
    auth,
    apiOrigin,
    VERTICAL_SMOKE_STEP_IDS[3],
    `/api/data/v1/ingestions/${ingestionId}/submit`,
    {
      method: 'POST',
      body: {},
      idempotencyKey: submitKey,
      ifMatch: 1,
      expectedStatuses: [202],
    },
  );
  operationProjection(replayedSubmit, operationId, VERTICAL_SMOKE_STEP_IDS[3]);

  const approveKey = nextKey();
  await waitForPublication(
    runtime,
    auth,
    apiOrigin,
    ingestionId,
    operationId,
    approveKey,
  );
  const initialEvidence = await readAuthorityEvidence(
    runtime,
    auth,
    ingestionId,
    consumerName,
    VERTICAL_SMOKE_STEP_IDS[3],
  );
  for (let index = 3; index <= 13; index += 1) {
    complete(VERTICAL_SMOKE_STEP_IDS[index]);
  }

  const firstRest = await queryRest(
    runtime,
    auth,
    apiOrigin,
    ingestionId,
    initialEvidence.versionId,
  );
  const secondRest = await queryRest(
    runtime,
    auth,
    apiOrigin,
    ingestionId,
    initialEvidence.versionId,
  );
  if (JSON.stringify(firstRest) !== JSON.stringify(secondRest)) {
    fail(VERTICAL_SMOKE_STEP_IDS[14], 'REST_QUERY_NOT_IDEMPOTENT');
  }
  complete(VERTICAL_SMOKE_STEP_IDS[14]);

  const firstGraphql = await queryGraphql(
    runtime,
    auth,
    apiOrigin,
    ingestionId,
    initialEvidence.versionId,
  );
  const secondGraphql = await queryGraphql(
    runtime,
    auth,
    apiOrigin,
    ingestionId,
    initialEvidence.versionId,
  );
  if (JSON.stringify(firstGraphql) !== JSON.stringify(secondGraphql)) {
    fail(VERTICAL_SMOKE_STEP_IDS[15], 'GRAPHQL_QUERY_NOT_IDEMPOTENT');
  }
  complete(VERTICAL_SMOKE_STEP_IDS[15]);

  const firstMcp = await queryMcp(
    runtime,
    mcpOrigin,
    mcpBearerToken,
    ingestionId,
    initialEvidence.versionId,
    true,
  );
  const secondMcp = await queryMcp(
    runtime,
    mcpOrigin,
    mcpBearerToken,
    ingestionId,
    initialEvidence.versionId,
    false,
  );
  if (JSON.stringify(firstMcp) !== JSON.stringify(secondMcp)) {
    fail(VERTICAL_SMOKE_STEP_IDS[16], 'MCP_QUERY_NOT_IDEMPOTENT');
  }
  complete(VERTICAL_SMOKE_STEP_IDS[16]);

  await replayProjectionDelivery(
    runtime,
    auth,
    consumerName,
    initialEvidence.outboxEventId,
    VERTICAL_SMOKE_STEP_IDS[17],
  );
  const replayEvidence = await readAuthorityEvidence(
    runtime,
    auth,
    ingestionId,
    consumerName,
    VERTICAL_SMOKE_STEP_IDS[17],
  );
  if (
    comparableEvidence(initialEvidence) !== comparableEvidence(replayEvidence)
  ) {
    fail(VERTICAL_SMOKE_STEP_IDS[17], 'PROJECTION_REPLAY_CREATED_DUPLICATES');
  }
  await queryWeb(
    runtime,
    webOrigin,
    webCredentials,
    ingestionId,
    firstRest.name,
  );
  complete(VERTICAL_SMOKE_STEP_IDS[17]);

  if (completedSteps.length !== VERTICAL_SMOKE_STEP_IDS.length) {
    fail(firstStep, 'INCOMPLETE_SMOKE_REPORT');
  }
  return Object.freeze({
    status: 'ok',
    ingestionId,
    operationId,
    dataItemId: ingestionId,
    versionId: initialEvidence.versionId,
    projectionCount: initialEvidence.projections.length,
    duplicateDeliveryVerified: true,
    duplicateQueriesVerified: true,
    fixtureSha256: Object.freeze(
      Object.fromEntries(
        fixtures.map((fixture) => [fixture.key, fixture.sha256]),
      ),
    ),
    steps: Object.freeze(completedSteps),
  });
}
