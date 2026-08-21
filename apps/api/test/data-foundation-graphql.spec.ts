import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { buildSchema } from 'graphql';

import {
  DATA_CAPABILITY_IDS,
  DATA_CAPABILITY_REGISTRY,
} from '@wiser/data-contracts';
import type { PlatformRequestContext } from '@wiser/platform-contracts';

import { buildApp } from '../src/app.js';
import type { ExecuteDataCapabilityInput } from '../src/data-foundation/capability-handler.js';
import {
  DATA_FOUNDATION_GRAPHQL_SCHEMA,
  GRAPHQL_CAPABILITY_BY_FIELD,
  GRAPHQL_RESOLVER_FIELDS,
  createDataFoundationGraphqlModule,
  type DataFoundationGraphqlCapabilityHandler,
} from '../src/data-foundation/graphql-module.js';

const TENANT_ID = 'd2000000-0000-4000-8000-000000000001';
const PROJECT_ID = 'd2000000-0000-4000-8000-000000000002';
const ACTOR_ID = 'd2000000-0000-4000-8000-000000000003';
const SESSION_ID = 'd2000000-0000-4000-8000-000000000004';
const DATA_ITEM_ID = 'd2000000-0000-4000-8000-000000000005';
const INGESTION_ID = 'd2000000-0000-4000-8000-000000000006';
const OPERATION_ID = 'd2000000-0000-4000-8000-000000000007';
const IDEMPOTENCY_KEY = 'd2000000-0000-4000-8000-000000000008';

const requestContext: PlatformRequestContext = {
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
    roles: ['data-reader'],
    scopes: [
      'data.catalog.read',
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
  traceId: 'd'.repeat(32),
};

function headers(command = false) {
  return {
    authorization: 'Bearer verified-token',
    'x-wiser-tenant-id': TENANT_ID,
    'x-wiser-project-id': PROJECT_ID,
    'x-wiser-purpose': 'operate',
    ...(command ? { 'idempotency-key': IDEMPOTENCY_KEY } : {}),
  };
}

function responseErrors(response: { json(): unknown }): unknown {
  const body = response.json();
  return body !== null && typeof body === 'object'
    ? (body as Readonly<Record<string, unknown>>)['errors']
    : undefined;
}

const openApps: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(openApps.splice(0).map((app) => app.close()));
});

function operation(version = 4) {
  return {
    operationId: OPERATION_ID,
    tenantId: TENANT_ID,
    projectId: PROJECT_ID,
    capabilityId: 'data.ingestion.submit',
    status: 'RUNNING',
    resource: `operation://${OPERATION_ID}`,
    progressPercent: 25,
    version,
    createdAt: '2026-08-22T00:00:00.000Z',
    updatedAt: '2026-08-22T00:00:00.000Z',
  };
}

function appWith(
  options: {
    readonly production?: boolean;
    readonly context?: PlatformRequestContext | null;
    readonly maxComplexity?: number;
    readonly queryDepth?: number;
    readonly queryTimeoutMs?: number;
    readonly handler?: DataFoundationGraphqlCapabilityHandler;
  } = {},
) {
  const resolver = {
    resolve: vi.fn(() => Promise.resolve(options.context ?? requestContext)),
  };
  const handler =
    options.handler ??
    ({
      execute: vi.fn((request: ExecuteDataCapabilityInput) => {
        switch (request.capabilityId) {
          case 'data.catalog.search':
            return Promise.resolve({
              items: [
                {
                  dataItemId: DATA_ITEM_ID,
                  name: 'Yongding stations',
                  securityLevel: 'L1_INTERNAL',
                  sourceOrganization: 'restricted-source',
                },
              ],
              nextCursor: 'cursor-next',
            });
          case 'data.ingestion.get':
            return Promise.resolve({ ingestion: { version: 6 } });
          case 'data.operation.get':
            return Promise.resolve(operation(9));
          case 'data.ingestion.submit':
          case 'data.ingestion.approve':
            return Promise.resolve({ operation: operation() });
          case 'data.operation.cancel':
            return Promise.resolve(operation());
          default:
            return Promise.resolve({
              items: [],
              nodes: [],
              edges: [],
              features: [],
            });
        }
      }),
    } satisfies DataFoundationGraphqlCapabilityHandler);
  const app = buildApp({
    logger: false,
    modules: [
      createDataFoundationGraphqlModule({
        resolver,
        handler,
        production: options.production ?? false,
        maxComplexity: options.maxComplexity ?? 100,
        queryDepth: options.queryDepth ?? 8,
        queryTimeoutMs: options.queryTimeoutMs ?? 1_000,
      }),
    ],
  });
  openApps.push(app);
  return { app, handler, resolver };
}

describe('Data Foundation schema-first GraphQL transport', () => {
  it('declares every required field and maps it to one Registry capability', () => {
    const schema = buildSchema(DATA_FOUNDATION_GRAPHQL_SCHEMA);
    const queryFields = schema.getQueryType()?.getFields() ?? {};
    const mutationFields = schema.getMutationType()?.getFields() ?? {};
    for (const capabilityId of DATA_CAPABILITY_IDS) {
      const mapping = DATA_CAPABILITY_REGISTRY[capabilityId].graphqlMapping;
      const fields =
        mapping.operationType === 'query' ? queryFields : mutationFields;
      expect(fields[mapping.field], capabilityId).toBeDefined();
      expect(GRAPHQL_CAPABILITY_BY_FIELD[mapping.field]).toBe(capabilityId);
      expect(GRAPHQL_RESOLVER_FIELDS[mapping.operationType]).toContain(
        mapping.field,
      );
    }
    expect(Object.keys(GRAPHQL_CAPABILITY_BY_FIELD)).toHaveLength(
      DATA_CAPABILITY_IDS.length,
    );
    expect(DATA_FOUNDATION_GRAPHQL_SCHEMA).not.toMatch(/SQL|Cypher|DSL/);
    expect(
      readFileSync(
        new URL('../src/data-foundation/schema.graphql', import.meta.url),
        'utf8',
      ).trim(),
    ).toBe(DATA_FOUNDATION_GRAPHQL_SCHEMA.trim());
  });

  it('maps cursor arguments and enforces field-level authorization', async () => {
    const { app, handler } = appWith();
    const response = await app.inject({
      method: 'POST',
      url: '/graphql',
      headers: headers(),
      payload: {
        query: `query {
          dataCatalog(filter: { query: "station" }, first: 2, after: "cursor-1") {
            nodes { dataItemId name securityLevel sourceOrganization }
            pageInfo { endCursor hasNextPage }
          }
        }`,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      data: {
        dataCatalog: {
          nodes: [
            {
              dataItemId: DATA_ITEM_ID,
              name: 'Yongding stations',
              securityLevel: 'L1_INTERNAL',
              sourceOrganization: null,
            },
          ],
          pageInfo: { endCursor: 'cursor-next', hasNextPage: true },
        },
      },
    });
    expect(vi.mocked(handler.execute)).toHaveBeenCalledWith({
      capabilityId: 'data.catalog.search',
      input: { query: 'station', first: 2, after: 'cursor-1' },
      requestContext,
    });
  });

  it('resolves live versions before minimal submit/cancel mutations', async () => {
    const { app, handler } = appWith();
    const submit = await app.inject({
      method: 'POST',
      url: '/graphql',
      headers: headers(true),
      payload: {
        query: `mutation { submitDataIngestion(id: "${INGESTION_ID}") { operationId version } }`,
      },
    });
    const cancel = await app.inject({
      method: 'POST',
      url: '/graphql',
      headers: headers(true),
      payload: {
        query: `mutation { cancelDataOperation(id: "${OPERATION_ID}") { operationId version } }`,
      },
    });
    expect(submit.statusCode).toBe(200);
    expect(cancel.statusCode).toBe(200);
    expect(responseErrors(submit)).toBeUndefined();
    expect(responseErrors(cancel)).toBeUndefined();
    expect(vi.mocked(handler.execute).mock.calls.map(([call]) => call)).toEqual(
      [
        {
          capabilityId: 'data.ingestion.get',
          input: { ingestionId: INGESTION_ID },
          requestContext,
        },
        {
          capabilityId: 'data.ingestion.submit',
          input: { ingestionId: INGESTION_ID, expectedVersion: 6 },
          requestContext,
          idempotencyKey: IDEMPOTENCY_KEY,
        },
        {
          capabilityId: 'data.operation.get',
          input: { operationId: OPERATION_ID },
          requestContext,
        },
        {
          capabilityId: 'data.operation.cancel',
          input: { operationId: OPERATION_ID, expectedVersion: 9 },
          requestContext,
          idempotencyKey: IDEMPOTENCY_KEY,
        },
      ],
    );
  });

  it('rejects multiple top-level mutation fields before handler execution', async () => {
    const { app, handler } = appWith();
    const response = await app.inject({
      method: 'POST',
      url: '/graphql',
      headers: headers(true),
      payload: {
        query: `mutation {
          submitDataIngestion(id: "${INGESTION_ID}") { operationId }
          cancelDataOperation(id: "${OPERATION_ID}") { operationId }
        }`,
      },
    });
    expect(responseErrors(response)).toBeDefined();
    expect(handler.execute).not.toHaveBeenCalled();
  });

  it('cannot hide multiple commands behind fragments or variable page sizes', async () => {
    const mutationRuntime = appWith();
    const fragmentedMutation = await mutationRuntime.app.inject({
      method: 'POST',
      url: '/graphql',
      headers: headers(true),
      payload: {
        query: `mutation Commands {
          ...TwoCommands
        }
        fragment TwoCommands on Mutation {
          submitDataIngestion(id: "${INGESTION_ID}") { operationId }
          cancelDataOperation(id: "${OPERATION_ID}") { operationId }
        }`,
      },
    });
    expect(responseErrors(fragmentedMutation)).toBeDefined();
    expect(mutationRuntime.handler.execute).not.toHaveBeenCalled();

    const complexityRuntime = appWith({ maxComplexity: 50 });
    const variablePage = await complexityRuntime.app.inject({
      method: 'POST',
      url: '/graphql',
      headers: headers(),
      payload: {
        query: `query VariablePage($first: Int) {
          dataCatalog(first: $first) { nodes { dataItemId } pageInfo { hasNextPage } }
        }`,
        variables: { first: 100 },
      },
    });
    expect(responseErrors(variablePage)).toBeDefined();
    expect(complexityRuntime.handler.execute).not.toHaveBeenCalled();
  });

  it('exposes only POST and rejects missing request context before execution', async () => {
    const { app, handler } = appWith({ context: null });
    expect(
      (await app.inject({ method: 'GET', url: '/graphql' })).statusCode,
    ).toBe(404);
    const response = await app.inject({
      method: 'POST',
      url: '/graphql',
      payload: { query: '{ dataOperation(id: "x") { operationId } }' },
    });
    expect(response.statusCode).toBe(401);
    expect(response.body).not.toContain('verified-token');
    expect(handler.execute).not.toHaveBeenCalled();
  });

  it('enforces depth, complexity, production introspection, and redacts failures', async () => {
    const secret = 'upstream-secret-detail';
    const handler: DataFoundationGraphqlCapabilityHandler = {
      execute: vi.fn(() => Promise.reject(new Error(secret))),
    };
    const { app } = appWith({
      production: true,
      queryDepth: 2,
      maxComplexity: 3,
      handler,
    });
    for (const query of [
      '{ __schema { types { fields { name } } } }',
      `{ dataCatalog(first: 100) { nodes { dataItemId name securityLevel } pageInfo { endCursor } } }`,
      `{ dataCatalog { nodes { selectedVersion { versionId } } } }`,
    ]) {
      const response = await app.inject({
        method: 'POST',
        url: '/graphql',
        headers: headers(),
        payload: { query },
      });
      expect(response.body).not.toContain(secret);
      expect(responseErrors(response)).toBeDefined();
    }
  });
});
