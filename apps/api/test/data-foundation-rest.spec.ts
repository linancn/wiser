import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

import {
  DATA_CAPABILITY_IDS,
  DATA_CAPABILITY_REGISTRY,
  type DataCapabilityId,
} from '@wiser/data-contracts';
import type { PlatformRequestContext } from '@wiser/platform-contracts';

import { buildApp } from '../src/app.js';
import {
  DataCapabilityHandlerError,
  type ExecuteDataCapabilityInput,
} from '../src/data-foundation/capability-handler.js';
import { createDataFoundationModule } from '../src/data-foundation/plugin.js';
import {
  createDataFoundationRestModule,
  type DataFoundationRestCapabilityHandler,
} from '../src/data-foundation/rest-module.js';

const TENANT_ID = 'c2000000-0000-4000-8000-000000000001';
const PROJECT_ID = 'c2000000-0000-4000-8000-000000000002';
const ACTOR_ID = 'c2000000-0000-4000-8000-000000000003';
const SESSION_ID = 'c2000000-0000-4000-8000-000000000004';
const DATA_ITEM_ID = 'c2000000-0000-4000-8000-000000000005';
const VERSION_ID = 'c2000000-0000-4000-8000-000000000006';
const ASSET_ID = 'c2000000-0000-4000-8000-000000000007';
const UPLOAD_SESSION_ID = 'c2000000-0000-4000-8000-000000000008';
const INGESTION_ID = 'c2000000-0000-4000-8000-000000000009';
const OPERATION_ID = 'c2000000-0000-4000-8000-000000000010';
const IDEMPOTENCY_KEY = 'c2000000-0000-4000-8000-000000000011';
const EVENT_ID = 'c2000000-0000-4000-8000-000000000012';

const context: PlatformRequestContext = {
  principal: {
    actorType: 'human',
    actorId: ACTOR_ID,
    authUserId: ACTOR_ID,
    sessionId: SESSION_ID,
    authenticationMethod: 'supabase_jwt',
  },
  authorization: {
    tenantId: TENANT_ID,
    projectId: PROJECT_ID,
    roles: ['data-admin'],
    scopes: [
      'data.catalog.read',
      'data.query.execute',
      'data.search.execute',
      'data.knowledge.read',
      'data.graph.read',
      'data.geo.read',
      'data.ingestion.write',
      'data.operation.read',
      'data.publish',
    ],
    purpose: 'operate',
    maxSecurityLevel: 'L3_CONFIDENTIAL',
    authzVersion: 7,
  },
  traceId: 'c'.repeat(32),
};

const point = {
  type: 'Point',
  coordinates: [116.3, 39.9],
  crs: 'EPSG:4490',
};

const validInputs = {
  'data.catalog.search': {
    query: 'station',
    businessDomains: ['water-monitoring'],
    first: 20,
  },
  'data.catalog.get': { dataItemId: DATA_ITEM_ID },
  'data.query': {
    dataItemId: DATA_ITEM_ID,
    fields: ['stationId'],
    first: 10,
  },
  'data.search.federated': { query: 'evidence', first: 10 },
  'data.knowledge.search': { query: 'ecological flow', first: 10 },
  'data.graph.expand': { entityId: 'station:001', maxDepth: 2, first: 10 },
  'data.graph.findPath': {
    fromEntityId: 'station:001',
    toEntityId: 'basin:yongding',
    maxDepth: 5,
  },
  'data.geo.query': {
    geometry: point,
    predicates: ['INTERSECTS'],
    first: 10,
  },
  'data.geo.intersect': {
    left: { dataItemId: DATA_ITEM_ID },
    right: { geometry: point },
    first: 10,
  },
  'data.ingestion.create': {
    assetIds: [ASSET_ID],
    ownerProjectId: PROJECT_ID,
    intendedUses: ['hydrology-analysis'],
    requestedSecurityLevel: 'L1_INTERNAL',
  },
  'data.ingestion.submit': { ingestionId: INGESTION_ID, expectedVersion: 4 },
  'data.operation.get': { operationId: OPERATION_ID },
  'data.catalog.create': {
    name: 'Station metadata draft',
    businessDomains: ['water-monitoring'],
    sourceNatures: ['observed'],
    sourceChannels: ['file-upload'],
    processingStage: 'RAW',
    intendedUses: ['hydrology-analysis'],
    ownerProjectId: PROJECT_ID,
    sourceOrganization: 'WISER fixture laboratory',
    authorizationScope: 'data.catalog.read',
    citationRequirements: [],
    unitDefinitions: [],
    missingValueRules: [],
    anomalyRules: [],
    generationMethod: 'OBSERVED',
    securityLevel: 'L1_INTERNAL',
    updateMode: 'SNAPSHOT',
  },
  'data.catalog.versions.list': { dataItemId: DATA_ITEM_ID, first: 25 },
  'data.catalog.versions.get': {
    dataItemId: DATA_ITEM_ID,
    versionId: VERSION_ID,
  },
  'data.uploadSession.create': {
    ownerProjectId: PROJECT_ID,
    objects: [
      {
        fileName: 'stations.geojson',
        mediaType: 'application/geo+json',
        sizeBytes: 4_096,
      },
    ],
  },
  'data.uploadSession.complete': {
    uploadSessionId: UPLOAD_SESSION_ID,
    expectedVersion: 2,
    objects: [
      {
        assetId: ASSET_ID,
        sizeBytes: 4_096,
        sha256:
          '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      },
    ],
  },
  'data.ingestion.get': { ingestionId: INGESTION_ID },
  'data.ingestion.approve': {
    ingestionId: INGESTION_ID,
    expectedVersion: 4,
    reviewNote: 'Approved.',
  },
  'data.ingestion.reject': {
    ingestionId: INGESTION_ID,
    expectedVersion: 4,
    reasonCode: 'QUALITY_GATE_FAILED',
    reason: 'Missing identifiers.',
  },
  'data.operation.cancel': {
    operationId: OPERATION_ID,
    expectedVersion: 3,
    reason: 'Superseded.',
  },
  'data.operation.events': { operationId: OPERATION_ID, first: 100 },
} satisfies Record<DataCapabilityId, Readonly<Record<string, unknown>>>;

const VERSIONED_COMMANDS = new Set<DataCapabilityId>([
  'data.ingestion.submit',
  'data.uploadSession.complete',
  'data.ingestion.approve',
  'data.ingestion.reject',
  'data.operation.cancel',
]);

function authHeaders() {
  return {
    authorization: 'Bearer verified-token',
    'x-wiser-tenant-id': TENANT_ID,
    'x-wiser-project-id': PROJECT_ID,
    'x-wiser-purpose': 'operate',
  };
}

function pathParameters(path: string) {
  return [...path.matchAll(/:([A-Za-z][A-Za-z0-9]*)/g)].map(
    (match) => match[1]!,
  );
}

function routeRequest(capabilityId: DataCapabilityId) {
  const definition = DATA_CAPABILITY_REGISTRY[capabilityId];
  const input: Readonly<Record<string, unknown>> = validInputs[capabilityId];
  const parameterNames = pathParameters(definition.restMapping.path);
  let url = definition.restMapping.path;
  for (const name of parameterNames) {
    url = url.replace(`:${name}`, encodeURIComponent(String(input[name])));
  }
  const remaining = Object.fromEntries(
    Object.entries(input).filter(([key]) => !parameterNames.includes(key)),
  );
  const headers: Record<string, string> = { ...authHeaders() };
  if (definition.kind === 'command') {
    headers['idempotency-key'] = IDEMPOTENCY_KEY;
  }
  if (VERSIONED_COMMANDS.has(capabilityId)) {
    headers['if-match'] = `"v${String(input['expectedVersion'])}"`;
  }
  if (definition.restMapping.method === 'GET') {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(remaining)) {
      query.set(key, Array.isArray(value) ? value.join(',') : String(value));
    }
    if ([...query].length > 0) url = `${url}?${query.toString()}`;
    return { method: 'GET' as const, url, headers, expectedInput: input };
  }
  return {
    method: 'POST' as const,
    url,
    headers,
    payload: remaining,
    expectedInput: input,
  };
}

const openApps: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(openApps.splice(0).map((app) => app.close()));
});

function appWith(
  requestContext: PlatformRequestContext | null = context,
  handlerOverride?: DataFoundationRestCapabilityHandler,
) {
  const resolver = {
    resolve: vi.fn(() => Promise.resolve(requestContext)),
  };
  const handler =
    handlerOverride ??
    ({
      execute: vi.fn((request: ExecuteDataCapabilityInput) => {
        if (request.capabilityId === 'data.operation.events') {
          return Promise.resolve({
            items: [
              {
                eventId: EVENT_ID,
                operationId: OPERATION_ID,
                sequence: 1,
                eventType: 'PROGRESS_REPORTED',
                status: 'RUNNING',
                progressPercent: 50,
                operationVersion: 3,
                occurredAt: '2026-08-22T04:00:00.000Z',
                message: 'Halfway.',
              },
            ],
            nextCursor: 'next-operation-cursor',
          });
        }
        return Promise.resolve({
          capabilityId: request.capabilityId,
          input: request.input,
          version: 3,
        });
      }),
    } satisfies DataFoundationRestCapabilityHandler);
  const app = buildApp({
    logger: false,
    modules: [
      createDataFoundationModule({
        readiness: () =>
          Promise.resolve({ database: true, objectStore: true, worker: true }),
      }),
      createDataFoundationRestModule({ resolver, handler }),
    ],
  });
  openApps.push(app);
  return { app, handler, resolver };
}

describe('Data Foundation REST module', () => {
  it('maps every Registry REST route to the same authenticated Capability Handler', async () => {
    const { app, handler } = appWith();

    for (const capabilityId of DATA_CAPABILITY_IDS) {
      const definition = DATA_CAPABILITY_REGISTRY[capabilityId];
      const request = routeRequest(capabilityId);
      const response = await app.inject(request);

      expect(response.statusCode, capabilityId).toBe(
        definition.restMapping.successStatus,
      );
      expect(response.headers['cache-control'], capabilityId).toContain(
        'no-store',
      );
      if (capabilityId !== 'data.operation.events') {
        expect(response.headers.etag, capabilityId).toBe('"v3"');
      }
      expect(handler.execute).toHaveBeenLastCalledWith({
        capabilityId,
        input: request.expectedInput,
        requestContext: context,
        ...(definition.kind === 'command'
          ? { idempotencyKey: IDEMPOTENCY_KEY }
          : {}),
      });
    }
  });

  it('normalizes bounded GET query values and strictly rejects path/body collisions', async () => {
    const { app, handler } = appWith();
    const search = await app.inject({
      method: 'GET',
      url: '/api/data/v1/catalog/data-items?businessDomains=water-monitoring,hydrology&first=25',
      headers: authHeaders(),
    });
    expect(search.statusCode).toBe(200);
    expect(handler.execute).toHaveBeenLastCalledWith(
      expect.objectContaining({
        input: {
          businessDomains: ['water-monitoring', 'hydrology'],
          first: 25,
        },
      }),
    );

    const collision = await app.inject({
      method: 'POST',
      url: `/api/data/v1/operations/${OPERATION_ID}/cancel`,
      headers: {
        ...authHeaders(),
        'idempotency-key': IDEMPOTENCY_KEY,
        'if-match': '"v3"',
      },
      payload: { operationId: OPERATION_ID, expectedVersion: 3 },
    });
    expect(collision.statusCode).toBe(422);
    expect(collision.json()).toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('requires authentication context, command idempotency, and If-Match for versioned commands', async () => {
    const { app, handler } = appWith();
    const missingAuth = await app.inject({
      method: 'GET',
      url: '/api/data/v1/catalog/data-items',
    });
    const missingIdempotency = await app.inject({
      method: 'POST',
      url: '/api/data/v1/ingestions',
      headers: authHeaders(),
      payload: validInputs['data.ingestion.create'],
    });
    const missingMatch = await app.inject({
      method: 'POST',
      url: `/api/data/v1/ingestions/${INGESTION_ID}/submit`,
      headers: { ...authHeaders(), 'idempotency-key': IDEMPOTENCY_KEY },
      payload: { expectedVersion: 4 },
    });

    expect(missingAuth.statusCode).toBe(401);
    expect(missingIdempotency.statusCode).toBe(422);
    expect(missingMatch.statusCode).toBe(422);
    expect(handler.execute).not.toHaveBeenCalled();
  });

  it('returns 403 when the resolver denies the requested project context', async () => {
    const { app, handler } = appWith(null);
    const response = await app.inject({
      method: 'GET',
      url: '/api/data/v1/catalog/data-items',
      headers: authHeaders(),
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: 'NOT_AUTHORIZED' });
    expect(handler.execute).not.toHaveBeenCalled();
  });

  it.each([
    ['FORBIDDEN', 403],
    ['SECURITY_LEVEL_EXCEEDED', 403],
    ['VALIDATION_FAILED', 422],
    ['IDEMPOTENCY_KEY_REQUIRED', 422],
  ] as const)(
    'maps handler %s without leaking details',
    async (code, status) => {
      const handler: DataFoundationRestCapabilityHandler = {
        execute: () => Promise.reject(new DataCapabilityHandlerError(code)),
      };
      const { app } = appWith(context, handler);
      const response = await app.inject({
        method: 'GET',
        url: '/api/data/v1/catalog/data-items',
        headers: authHeaders(),
      });
      expect(response.statusCode).toBe(status);
      expect(response.body).not.toContain('stack');
    },
  );

  it('maps allowlisted optimistic conflicts to 409 and hides arbitrary exception messages', async () => {
    const secret = 'private database detail';
    const conflictError = Object.assign(new Error(secret), {
      code: 'VERSION_CONFLICT',
    });
    const conflict = appWith(context, {
      execute: () => Promise.reject(conflictError),
    }).app;
    const failed = appWith(context, {
      execute: () => Promise.reject(new Error(secret)),
    }).app;

    const conflictResponse = await conflict.inject({
      method: 'GET',
      url: `/api/data/v1/operations/${OPERATION_ID}`,
      headers: authHeaders(),
    });
    const failedResponse = await failed.inject({
      method: 'GET',
      url: `/api/data/v1/operations/${OPERATION_ID}`,
      headers: authHeaders(),
    });
    expect(conflictResponse.statusCode).toBe(409);
    expect(conflictResponse.json()).toMatchObject({ code: 'CONFLICT' });
    expect(conflictResponse.body).not.toContain(secret);
    expect(failedResponse.statusCode).toBe(500);
    expect(failedResponse.body).not.toContain(secret);
  });

  it('emits a bounded SSE operation-event snapshot preserving id, type, data, and cursor', async () => {
    const { app } = appWith();
    const response = await app.inject(routeRequest('data.operation.events'));

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/event-stream');
    expect(response.headers['x-next-cursor']).toBe('next-operation-cursor');
    expect(response.body).toContain(`id: ${EVENT_ID}\n`);
    expect(response.body).toContain('event: PROGRESS_REPORTED\n');
    expect(response.body).toContain(
      `data: ${JSON.stringify({
        eventId: EVENT_ID,
        operationId: OPERATION_ID,
        sequence: 1,
        eventType: 'PROGRESS_REPORTED',
        status: 'RUNNING',
        progressPercent: 50,
        operationVersion: 3,
        occurredAt: '2026-08-22T04:00:00.000Z',
        message: 'Halfway.',
      })}\n\n`,
    );
  });

  it('composes existing health/capability endpoints without duplicate routes', async () => {
    const { app } = appWith();
    const [health, capabilities] = await Promise.all([
      app.inject({ method: 'GET', url: '/api/data/v1/health' }),
      app.inject({ method: 'GET', url: '/api/data/v1/capabilities' }),
    ]);
    expect(health.statusCode).toBe(200);
    expect(capabilities.statusCode).toBe(200);
  });

  it('projects the Zod capability contracts into generated OpenAPI operations', async () => {
    const { app } = appWith();
    const response = await app.inject({ method: 'GET', url: '/openapi.json' });
    const document = response.json<{
      info: { title: string };
      tags?: readonly { name: string }[];
      paths: Record<
        string,
        Record<
          string,
          {
            requestBody?: unknown;
            parameters?: readonly unknown[];
            responses?: Record<string, unknown>;
            security?: readonly unknown[];
          }
        >
      >;
    }>();

    expect(response.statusCode).toBe(200);
    expect(document.info.title).toBe('WISER Platform API');
    expect(document.tags).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'data-foundation' }),
        expect.objectContaining({ name: 'exercise' }),
      ]),
    );
    const query = document.paths['/api/data/v1/query']?.['post'];
    expect(query?.requestBody).toBeDefined();
    expect(query?.responses?.['200']).toHaveProperty(
      'content.application/json.schema',
    );
    expect(query?.security).toEqual([{ bearerAuth: [] }]);

    const catalog = document.paths['/api/data/v1/catalog/data-items']?.['get'];
    expect(catalog?.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'first', in: 'query' }),
      ]),
    );
    const version =
      document.paths[
        '/api/data/v1/catalog/data-items/{dataItemId}/versions/{versionId}'
      ]?.['get'];
    expect(version?.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'dataItemId',
          in: 'path',
          required: true,
        }),
        expect.objectContaining({
          name: 'versionId',
          in: 'path',
          required: true,
        }),
      ]),
    );
  });
});
