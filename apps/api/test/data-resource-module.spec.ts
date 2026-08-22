import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

import type { PlatformRequestContext } from '@wiser/platform-contracts';

import { buildApp } from '../src/app.js';
import {
  DataFoundationResourceError,
  createDataFoundationResourceModule,
} from '../src/data-foundation/resource-module.js';

const TENANT_ID = 'da000000-0000-4000-8000-000000000001';
const PROJECT_ID = 'da000000-0000-4000-8000-000000000002';
const ACTOR_ID = 'da000000-0000-4000-8000-000000000003';
const SESSION_ID = 'da000000-0000-4000-8000-000000000004';
const EVIDENCE_ID = 'da000000-0000-4000-8000-000000000005';
const DATA_ITEM_ID = 'da000000-0000-4000-8000-000000000006';
const VERSION_ID = 'da000000-0000-4000-8000-000000000007';
const COLLECTION_ID = `wiser-${'a'.repeat(32)}`;
const ITEM_ID = `wiser-${'b'.repeat(48)}`;

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
    roles: ['data-steward'],
    scopes: ['data.knowledge.read', 'data.geo.read'],
    purpose: 'analysis',
    maxSecurityLevel: 'L2_RESTRICTED',
    authzVersion: 7,
  },
  traceId: 'c'.repeat(32),
};

const headers = {
  authorization: 'Bearer verified-supabase-token',
  'x-wiser-tenant-id': TENANT_ID,
  'x-wiser-project-id': PROJECT_ID,
  'x-wiser-purpose': 'analysis',
};

const openApps: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(openApps.splice(0).map((app) => app.close()));
});

function appWith(options: {
  readonly resolved?: PlatformRequestContext | null;
  readonly readEvidence?: () => Promise<unknown>;
  readonly readStacItem?: () => Promise<unknown>;
}) {
  const resources = {
    readEvidence: vi.fn(
      options.readEvidence ??
        (() =>
          Promise.resolve({
            evidenceId: EVIDENCE_ID,
            dataItemId: DATA_ITEM_ID,
            versionId: VERSION_ID,
            locator: { section: 'observations' },
            contentHash: 'a'.repeat(64),
            excerpt: '永定河生态补水证据',
            securityLevel: 'L1_INTERNAL',
            policyVersion: 7,
            rowVersion: 1,
            createdAt: '2026-08-22T08:00:00.000Z',
          })),
    ),
    readStacItem: vi.fn(
      options.readStacItem ??
        (() =>
          Promise.resolve({
            stac_version: '1.1.0',
            type: 'Feature',
            id: ITEM_ID,
            collection: COLLECTION_ID,
            bbox: [116.1, 39.7, 116.1, 39.7],
            geometry: { type: 'Point', coordinates: [116.1, 39.7] },
            properties: {
              datetime: '2026-08-22T08:00:00.000Z',
              'wiser:tenant_id': TENANT_ID,
              'wiser:project_id': PROJECT_ID,
              'wiser:data_item_id': DATA_ITEM_ID,
              'wiser:version_id': VERSION_ID,
              'wiser:evidence_id': EVIDENCE_ID,
            },
            links: [],
            assets: {
              source: {
                href: `http://api:3001/api/data/v1/tenants/${TENANT_ID}/projects/${PROJECT_ID}/versions/${VERSION_ID}/assets/source`,
                type: 'application/geo+json',
                roles: ['data'],
              },
            },
          })),
    ),
  };
  const app = buildApp({
    logger: false,
    modules: [
      createDataFoundationResourceModule({
        resolver: {
          resolve: () => Promise.resolve(options.resolved ?? context),
        },
        resources,
      }),
    ],
  });
  openApps.push(app);
  return { app, resources };
}

describe('Data Foundation governed resource routes', () => {
  it('reauthorizes Evidence and STAC reads through unified Auth context', async () => {
    const { app, resources } = appWith({});

    const evidence = await app.inject({
      method: 'GET',
      url: `/api/data/v1/evidence/fragments/${EVIDENCE_ID}`,
      headers,
    });
    expect(evidence.statusCode).toBe(200);
    expect(evidence.headers['cache-control']).toContain('no-store');
    expect(evidence.json()).toMatchObject({
      evidenceId: EVIDENCE_ID,
      versionId: VERSION_ID,
    });
    expect(resources.readEvidence).toHaveBeenCalledWith({
      context,
      evidenceId: EVIDENCE_ID,
    });

    const stac = await app.inject({
      method: 'GET',
      url: `/api/data/v1/stac/collections/${COLLECTION_ID}/items/${ITEM_ID}`,
      headers,
    });
    expect(stac.statusCode).toBe(200);
    expect(stac.json()).toMatchObject({
      id: ITEM_ID,
      collection: COLLECTION_ID,
      type: 'Feature',
    });
    expect(resources.readStacItem).toHaveBeenCalledWith({
      context,
      collectionId: COLLECTION_ID,
      itemId: ITEM_ID,
    });
  });

  it('fails closed before resource I/O for missing auth, invalid references, or missing scopes', async () => {
    const restrictedContext: PlatformRequestContext = {
      ...context,
      authorization: { ...context.authorization, scopes: [] },
    };
    const { app, resources } = appWith({ resolved: restrictedContext });

    const missing = await app.inject({
      method: 'GET',
      url: `/api/data/v1/evidence/fragments/${EVIDENCE_ID}`,
    });
    expect(missing.statusCode).toBe(401);

    const invalid = await app.inject({
      method: 'GET',
      url: '/api/data/v1/evidence/fragments/not-a-uuid',
      headers,
    });
    expect(invalid.statusCode).toBe(422);

    const forbidden = await app.inject({
      method: 'GET',
      url: `/api/data/v1/stac/collections/${COLLECTION_ID}/items/${ITEM_ID}`,
      headers,
    });
    expect(forbidden.statusCode).toBe(403);
    expect(resources.readEvidence).not.toHaveBeenCalled();
    expect(resources.readStacItem).not.toHaveBeenCalled();
  });

  it('uses safe stable errors and never returns backend details or oversized payloads', async () => {
    const secret = 'postgresql://admin:secret@authority/internal-row';
    const failed = appWith({
      readEvidence: () =>
        Promise.reject(
          new DataFoundationResourceError('UNAVAILABLE', new Error(secret)),
        ),
      readStacItem: () => Promise.resolve({ value: 'x'.repeat(300_000) }),
    });
    const unavailable = await failed.app.inject({
      method: 'GET',
      url: `/api/data/v1/evidence/fragments/${EVIDENCE_ID}`,
      headers,
    });
    expect(unavailable.statusCode).toBe(503);
    expect(unavailable.body).not.toContain('postgresql');
    expect(unavailable.body).not.toContain('secret');

    const tooLarge = await failed.app.inject({
      method: 'GET',
      url: `/api/data/v1/stac/collections/${COLLECTION_ID}/items/${ITEM_ID}`,
      headers,
    });
    expect(tooLarge.statusCode).toBe(413);
    expect(tooLarge.body).not.toContain('xxxxx');
  });
});
