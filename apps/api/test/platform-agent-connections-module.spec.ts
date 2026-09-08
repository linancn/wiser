import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

import {
  AgentConnectionError,
  type AgentConnectionService,
} from '@wiser/platform-auth';
import type { PlatformAgentConnectionView } from '@wiser/platform-contracts';

import { buildApp } from '../src/app.js';
import { createPlatformAgentConnectionsModule } from '../src/platform/agent-connections-module.js';

const connection: PlatformAgentConnectionView = {
  connectionId: randomUUID(),
  clientId: randomUUID(),
  delegationId: randomUUID(),
  tenantId: randomUUID(),
  projectId: randomUUID(),
  scopes: ['data.catalog.read'],
  purpose: 'agent-data',
  maxSecurityLevel: 'L1_INTERNAL',
  status: 'active',
  expiresAt: '2027-01-01T00:00:00.000Z',
};
const authorizationId = randomUUID();
const exchange = {
  connection,
  token: `wdc1.wdc_${'k'.repeat(22)}.${'s'.repeat(43)}`,
  expiresAt: connection.expiresAt,
};
const openApps: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(openApps.splice(0).map((app) => app.close()));
});

function fixture() {
  const service = {
    inspect: vi.fn<AgentConnectionService['inspect']>(() =>
      Promise.resolve({
        authorizationId,
        clientId: connection.clientId,
        clientName: 'My Agent',
        redirectUri: 'http://127.0.0.1:49555/callback',
        resource: 'https://mcp.example.test/mcp',
        projects: [],
      }),
    ),
    authorize: vi.fn<AgentConnectionService['authorize']>(() =>
      Promise.resolve(connection),
    ),
    exchange: vi.fn<AgentConnectionService['exchange']>(() =>
      Promise.resolve(exchange),
    ),
    list: vi.fn<AgentConnectionService['list']>(() =>
      Promise.resolve([connection]),
    ),
    revoke: vi.fn<AgentConnectionService['revoke']>(() => Promise.resolve()),
  } satisfies AgentConnectionService;
  const app = buildApp({
    logger: false,
    modules: [createPlatformAgentConnectionsModule(service)],
  });
  openApps.push(app);
  return { app, service };
}

describe('Platform Agent HTTP boundary', () => {
  it('requires bearer credentials and idempotency for every mutation', async () => {
    const { app, service } = fixture();
    const missing = await app.inject({
      method: 'GET',
      url: '/api/platform/v1/agent-connections',
    });
    expect(missing.statusCode).toBe(401);
    const noKey = await app.inject({
      method: 'POST',
      url: '/api/platform/v1/agent-connections/exchange',
      headers: { authorization: 'Bearer oauth' },
      payload: {},
    });
    expect(noKey.statusCode).toBe(422);
    expect(noKey.headers['cache-control']).toContain('no-store');
    expect(service.exchange).not.toHaveBeenCalled();
    expect(service.list).not.toHaveBeenCalled();
  });

  it('inspects the authorization request without trusting caller project headers', async () => {
    const { app, service } = fixture();
    const response = await app.inject({
      method: 'GET',
      url: `/api/platform/v1/agent-authorizations/${authorizationId}`,
      headers: {
        authorization: 'Bearer human',
        'x-wiser-project-id': randomUUID(),
      },
    });
    expect(response.statusCode).toBe(200);
    expect(service.inspect).toHaveBeenCalledExactlyOnceWith({
      token: 'human',
      authorizationId,
    });
    expect(response.json()).not.toHaveProperty('token');
  });

  it('accepts only bounded consent commands and keeps secrets out of management views', async () => {
    const { app, service } = fixture();
    const command = {
      authorizationId,
      tenantId: connection.tenantId,
      projectId: connection.projectId,
      mode: 'query',
    };
    const idempotencyKey = randomUUID();
    const headers = {
      authorization: 'Bearer human',
      'idempotency-key': idempotencyKey,
    };
    const bad = await app.inject({
      method: 'POST',
      url: '/api/platform/v1/agent-connections',
      headers,
      payload: { ...command, scopes: ['data.publish'] },
    });
    expect(bad.statusCode).toBe(422);
    expect(service.authorize).not.toHaveBeenCalled();
    const allowed = await app.inject({
      method: 'POST',
      url: '/api/platform/v1/agent-connections',
      headers,
      payload: command,
    });
    expect(allowed.statusCode).toBe(201);
    expect(allowed.json()).toEqual(connection);
    expect(service.authorize).toHaveBeenCalledExactlyOnceWith({
      token: 'human',
      idempotencyKey,
      command: {
        ...command,
        maxSecurityLevel: 'L1_INTERNAL',
        expiresInSeconds: 3600,
      },
    });
    const list = await app.inject({
      method: 'GET',
      url: '/api/platform/v1/agent-connections',
      headers,
    });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toEqual({ connections: [connection] });
  });

  it('exchanges OAuth credentials with no caller-controlled project and revokes a connection', async () => {
    const { app, service } = fixture();
    const idempotencyKey = randomUUID();
    const headers = {
      authorization: 'Bearer oauth',
      'idempotency-key': idempotencyKey,
    };
    const bad = await app.inject({
      method: 'POST',
      url: '/api/platform/v1/agent-connections/exchange',
      headers,
      payload: { projectId: randomUUID() },
    });
    expect(bad.statusCode).toBe(422);
    const response = await app.inject({
      method: 'POST',
      url: '/api/platform/v1/agent-connections/exchange',
      headers,
      payload: {},
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(exchange);
    expect(response.headers['cache-control']).toContain('no-store');
    expect(service.exchange).toHaveBeenCalledExactlyOnceWith({
      token: 'oauth',
      idempotencyKey,
    });
    const revoked = await app.inject({
      method: 'POST',
      url: `/api/platform/v1/agent-connections/${connection.connectionId}/revoke`,
      headers: { ...headers, authorization: 'Bearer human' },
      payload: {},
    });
    expect(revoked.statusCode).toBe(204);
    expect(service.revoke).toHaveBeenCalledExactlyOnceWith({
      token: 'human',
      idempotencyKey,
      connectionId: connection.connectionId,
    });
  });

  it('returns controlled failures and rejects malformed service results without exposing secrets', async () => {
    const { app, service } = fixture();
    const input = {
      method: 'POST' as const,
      url: '/api/platform/v1/agent-connections/exchange',
      headers: {
        authorization: 'Bearer oauth',
        'idempotency-key': randomUUID(),
      },
      payload: {},
    };
    service.exchange.mockRejectedValueOnce(
      new AgentConnectionError('NOT_AUTHORIZED'),
    );
    expect((await app.inject(input)).statusCode).toBe(403);
    service.exchange.mockRejectedValueOnce(
      new Error('database-password-private-detail'),
    );
    const unavailable = await app.inject(input);
    expect(unavailable.statusCode).toBe(503);
    expect(unavailable.body).not.toContain('database-password');
    service.exchange.mockResolvedValueOnce({
      ...exchange,
      token: 'invalid-secret',
    });
    const malformed = await app.inject(input);
    expect(malformed.statusCode).toBe(503);
    expect(malformed.body).not.toContain('invalid-secret');
  });
});
