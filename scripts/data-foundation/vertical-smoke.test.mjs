import assert from 'node:assert/strict';
import test from 'node:test';

import {
  VERTICAL_SMOKE_STEP_IDS,
  VerticalSmokeError,
  runDataFoundationVerticalSmoke,
} from './vertical-smoke.mjs';

const TENANT_ID = 'b1000000-0000-4000-8000-000000000001';
const PROJECT_ID = 'b2000000-0000-4000-8000-000000000001';
const UPLOAD_SESSION_ID = 'a1000000-0000-4000-8000-000000000001';
const GEO_ASSET_ID = 'a1000000-0000-4000-8000-000000000002';
const EVIDENCE_ASSET_ID = 'a1000000-0000-4000-8000-000000000003';
const INGESTION_ID = 'a1000000-0000-4000-8000-000000000004';
const OPERATION_ID = 'a1000000-0000-4000-8000-000000000005';
const VERSION_ID = 'a1000000-0000-4000-8000-000000000006';

const projectionKinds = ['NEO4J', 'OPENSEARCH', 'POSTGIS', 'STAC', 'WEAVIATE'];

function jsonResponse(value, init = {}) {
  return new Response(JSON.stringify(value), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
}

function authorityEvidence() {
  return {
    dataItemId: INGESTION_ID,
    versionId: VERSION_ID,
    ingestionState: 'PUBLISHED',
    operationStatus: 'SUCCEEDED',
    itemPublicationStatus: 'PUBLISHED',
    versionPublicationStatus: 'PUBLISHED',
    assetCount: 2,
    scannedAssetCount: 2,
    fingerprintedAssetCount: 2,
    rawAssetCount: 2,
    contentBlobCount: 2,
    rawBlobCount: 2,
    agentRunCount: 2,
    agentActionCount: 2,
    transformPlanCount: 2,
    approvedReviewCount: 1,
    qualityCheckCount: 1,
    qualityScorecardCount: 1,
    dataItemCount: 1,
    versionCount: 1,
    evidenceCount: 2,
    spatialCount: 1,
    lineageCount: 1,
    outboxCount: 1,
    outboxEventId: 42,
    maxOutboxEventId: 42,
    checkpointEventId: 42,
    projections: projectionKinds.map((kind) => ({
      kind,
      status: 'SUCCEEDED',
      attemptCount: 1,
    })),
  };
}

function publishedItem() {
  return {
    item: {
      dataItemId: INGESTION_ID,
      name: `Ingestion ${INGESTION_ID}`,
      publicationStatus: 'PUBLISHED',
      securityLevel: 'L1_INTERNAL',
    },
    selectedVersion: { versionId: VERSION_ID, version: 1 },
  };
}

function createHarness() {
  const requests = [];
  const waits = [];
  const sql = [];
  let ingestionReads = 0;
  let operationReads = 0;

  const fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    requests.push({ url, init });

    if (url.origin === 'https://upload.invalid') {
      return new Response('', { status: 200, headers: { etag: 'fixture' } });
    }
    if (url.origin === 'http://web.test') {
      if (url.pathname === '/zh-CN/auth/login') {
        return new Response(null, {
          status: 303,
          headers: {
            location: `http://0.0.0.0:3000/zh-CN/data-foundation/catalog/${INGESTION_ID}`,
            'set-cookie': 'sb-local-auth-token=fixture; Path=/; HttpOnly',
          },
        });
      }
      return new Response(
        `<html><body>Ingestion ${INGESTION_ID} ${INGESTION_ID}</body></html>`,
        { status: 200, headers: { 'content-type': 'text/html' } },
      );
    }
    if (url.origin === 'http://mcp.test') {
      return jsonResponse({
        jsonrpc: '2.0',
        id: 1,
        result: {
          isError: false,
          structuredContent: { ok: true, data: publishedItem() },
        },
      });
    }

    if (url.pathname === '/api/data/v1/upload-sessions') {
      return jsonResponse(
        {
          uploadSession: {
            uploadSessionId: UPLOAD_SESSION_ID,
            assetIds: [GEO_ASSET_ID, EVIDENCE_ASSET_ID],
            status: 'OPEN',
            version: 1,
          },
          uploadTargets: [
            {
              assetId: GEO_ASSET_ID,
              method: 'PRESIGNED_PUT',
              uploadUrl: 'https://upload.invalid/geojson',
              headers: { 'content-type': 'application/geo+json' },
            },
            {
              assetId: EVIDENCE_ASSET_ID,
              method: 'PRESIGNED_PUT',
              uploadUrl: 'https://upload.invalid/evidence',
              headers: { 'content-type': 'text/markdown' },
            },
          ],
        },
        { status: 201 },
      );
    }
    if (
      url.pathname ===
      `/api/data/v1/upload-sessions/${UPLOAD_SESSION_ID}/complete`
    ) {
      return jsonResponse({
        uploadSession: {
          uploadSessionId: UPLOAD_SESSION_ID,
          assetIds: [GEO_ASSET_ID, EVIDENCE_ASSET_ID],
          status: 'COMPLETED',
          version: 2,
        },
      });
    }
    if (url.pathname === '/api/data/v1/ingestions') {
      return jsonResponse(
        {
          ingestionId: INGESTION_ID,
          operation: {
            operationId: OPERATION_ID,
            status: 'WAITING_INPUT',
            version: 1,
          },
        },
        { status: 202 },
      );
    }
    if (url.pathname === `/api/data/v1/ingestions/${INGESTION_ID}/submit`) {
      return jsonResponse(
        {
          operation: {
            operationId: OPERATION_ID,
            status: 'RUNNING',
            version: 2,
          },
        },
        { status: 202 },
      );
    }
    if (url.pathname === `/api/data/v1/ingestions/${INGESTION_ID}/approve`) {
      return jsonResponse(
        {
          operation: {
            operationId: OPERATION_ID,
            status: 'RUNNING',
            version: 4,
          },
        },
        { status: 202 },
      );
    }
    if (url.pathname === `/api/data/v1/ingestions/${INGESTION_ID}`) {
      ingestionReads += 1;
      const review = ingestionReads === 1;
      return jsonResponse({
        ingestion: {
          ingestionId: INGESTION_ID,
          operationId: OPERATION_ID,
          state: review ? 'REVIEW_REQUIRED' : 'PUBLISHED',
          version: review ? 11 : 16,
        },
      });
    }
    if (url.pathname === `/api/data/v1/operations/${OPERATION_ID}`) {
      operationReads += 1;
      return jsonResponse({
        operationId: OPERATION_ID,
        status: operationReads === 1 ? 'WAITING_REVIEW' : 'SUCCEEDED',
        version: operationReads === 1 ? 3 : 6,
      });
    }
    if (url.pathname === `/api/data/v1/catalog/data-items/${INGESTION_ID}`) {
      return jsonResponse(publishedItem());
    }
    if (url.pathname === '/api/data/v1/search') {
      return jsonResponse({
        items: [
          {
            dataItemId: INGESTION_ID,
            versionId: VERSION_ID,
            source: 'fulltext',
          },
        ],
      });
    }
    if (url.pathname === '/graphql') {
      return jsonResponse({
        data: {
          dataItem: {
            dataItemId: INGESTION_ID,
            name: `Ingestion ${INGESTION_ID}`,
            securityLevel: 'L1_INTERNAL',
            selectedVersion: { versionId: VERSION_ID, version: 1 },
          },
        },
      });
    }
    throw new Error(`Unexpected test URL ${url.pathname}`);
  };

  const postgresSql = async (statement) => {
    sql.push(statement);
    if (statement.includes('vertical-smoke.rewind-projection-checkpoint')) {
      return 'replayed\n';
    }
    if (statement.includes('vertical-smoke.projection-checkpoint')) {
      return '42\n';
    }
    return `${JSON.stringify(authorityEvidence())}\n`;
  };

  return {
    requests,
    waits,
    sql,
    options: {
      fetch,
      wait: async (milliseconds) => waits.push(milliseconds),
      postgresSql,
      auth: {
        bearerToken: 'test-operator-access-token-with-safe-length',
        tenantId: TENANT_ID,
        projectId: PROJECT_ID,
        purpose: 'data-foundation-smoke',
      },
      apiOrigin: 'http://api.test',
      mcpOrigin: 'http://mcp.test',
      mcpBearerToken: 'test-mcp-bearer-token',
      webOrigin: 'http://web.test',
      webCredentials: {
        email: 'operator@agent-excon.test',
        password: 'WiserLocalOperator-2026!',
      },
      pollIntervalMs: 1,
      maximumDurationMs: 30_000,
      requestTimeoutMs: 1_000,
    },
  };
}

test('executes the exact 18-step authenticated vertical slice and proves replay idempotency', async () => {
  const harness = createHarness();
  const report = await runDataFoundationVerticalSmoke(harness.options);

  assert.deepEqual(
    report.steps.map(({ id }) => id),
    VERTICAL_SMOKE_STEP_IDS,
  );
  assert.equal(report.dataItemId, INGESTION_ID);
  assert.equal(report.versionId, VERSION_ID);
  assert.equal(report.ingestionId, INGESTION_ID);
  assert.equal(report.operationId, OPERATION_ID);
  assert.equal(report.projectionCount, 5);
  assert.equal(report.duplicateDeliveryVerified, true);
  assert.equal(report.duplicateQueriesVerified, true);

  const createUpload = harness.requests.find(
    ({ url }) => url.pathname === '/api/data/v1/upload-sessions',
  );
  assert.equal(JSON.parse(createUpload.init.body).objects.length, 2);
  assert.equal(
    harness.requests.filter(
      ({ url }) =>
        url.pathname === `/api/data/v1/ingestions/${INGESTION_ID}/submit`,
    ).length,
    2,
  );
  assert.equal(
    harness.requests.filter(
      ({ url }) =>
        url.pathname === `/api/data/v1/ingestions/${INGESTION_ID}/approve`,
    ).length,
    1,
  );
  assert.ok(
    harness.sql.some((statement) =>
      statement.includes('vertical-smoke.rewind-projection-checkpoint'),
    ),
  );
  assert.ok(harness.waits.length >= 1);
});

test('bounds responses and never leaks a remote failure body', async () => {
  const harness = createHarness();
  harness.options.fetch = async () =>
    new Response('private storage credential detail', {
      status: 503,
      headers: {
        'content-type': 'application/json',
        'content-length': '99999999',
      },
    });

  await assert.rejects(
    runDataFoundationVerticalSmoke(harness.options),
    (error) => {
      assert.ok(error instanceof VerticalSmokeError);
      assert.equal(error.stepId, 'upload-session-created');
      assert.doesNotMatch(error.message, /private|credential|storage/i);
      return true;
    },
  );
});

test('bounds an injected wait implementation that never settles', async () => {
  const harness = createHarness();
  harness.options.wait = () => new Promise(() => undefined);
  harness.options.requestTimeoutMs = 100;
  const startedAt = Date.now();

  await assert.rejects(
    runDataFoundationVerticalSmoke(harness.options),
    (error) => {
      assert.ok(error instanceof VerticalSmokeError);
      assert.equal(error.stepId, 'clamav-security-scan');
      assert.equal(error.code, 'WAIT_FAILED');
      return true;
    },
  );
  assert.ok(Date.now() - startedAt < 1_000);
});
