import { describe, expect, it, vi } from 'vitest';

import type { PlatformRequestContext } from '@wiser/platform-contracts';

import {
  DataFoundationResourceError,
  PostgresDataFoundationResourcePort,
} from '../src/data-foundation/postgres-resource-port.js';

const TENANT_ID = 'db000000-0000-4000-8000-000000000001';
const PROJECT_ID = 'db000000-0000-4000-8000-000000000002';
const ACTOR_ID = 'db000000-0000-4000-8000-000000000003';
const SESSION_ID = 'db000000-0000-4000-8000-000000000004';
const EVIDENCE_ID = 'db000000-0000-4000-8000-000000000005';
const DATA_ITEM_ID = 'db000000-0000-4000-8000-000000000006';
const VERSION_ID = 'db000000-0000-4000-8000-000000000007';
const COLLECTION_ID = `wiser-${'a'.repeat(32)}`;
const ITEM_ID = `wiser-${'b'.repeat(48)}`;
const SOURCE_HASH = 'c'.repeat(64);

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
  traceId: 'd'.repeat(32),
};

function authorityRow() {
  return {
    evidence_fragment_id: EVIDENCE_ID,
    data_item_id: DATA_ITEM_ID,
    version_id: VERSION_ID,
    asset_id: null,
    locator: { section: 'observations' },
    content_hash: SOURCE_HASH,
    excerpt: 'governed evidence',
    security_level: 'L1_INTERNAL',
    policy_version: '7',
    row_version: '1',
    created_at: '2026-08-22T08:00:00.000Z',
    publication_status: 'PUBLISHED',
    acceptance_status: 'PASSED',
  };
}

function fixture() {
  const queries: Array<{ text: string; values?: readonly unknown[] }> = [];
  const client = {
    query(text: string, values?: readonly unknown[]) {
      queries.push(values === undefined ? { text } : { text, values });
      if (/data\.resource\.evidence\.lookup/.test(text)) {
        return Promise.resolve({ rows: [authorityRow()] });
      }
      if (/data\.resource\.stac\.authorize/.test(text)) {
        return Promise.resolve({ rows: [authorityRow()] });
      }
      return Promise.resolve({ rows: [] });
    },
    release: vi.fn(),
  };
  const fetcher = vi.fn(() =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          stac_version: '1.1.0',
          stac_extensions: [],
          type: 'Feature',
          id: ITEM_ID,
          collection: COLLECTION_ID,
          bbox: [116.1, 39.7, 116.1, 39.7],
          geometry: { type: 'Point', coordinates: [116.1, 39.7] },
          properties: {
            datetime: '2026-08-22T08:00:00.000Z',
            title: 'Yongding governed asset',
            description: 'Published WISER STAC evidence.',
            tenantId: TENANT_ID,
            projectId: PROJECT_ID,
            dataItemId: DATA_ITEM_ID,
            versionId: VERSION_ID,
            evidenceId: EVIDENCE_ID,
            securityLevel: 'L1_INTERNAL',
            policyVersion: 7,
            sourceHash: SOURCE_HASH,
            qualityGrade: 'A',
            acceptanceStatus: 'PASSED',
            publicationStatus: 'PUBLISHED',
            businessDomains: ['water-monitoring'],
            channels: ['stac'],
            limitations: [],
          },
          links: [{ rel: 'self', href: 'http://stac-api:8080/internal' }],
          assets: {
            source: {
              href: `http://api:3001/api/data/v1/tenants/${TENANT_ID}/projects/${PROJECT_ID}/versions/${VERSION_ID}/assets/source`,
              type: 'application/geo+json',
              roles: ['data'],
              'file:checksum': `sha256:${SOURCE_HASH}`,
              'file:size': 1024,
            },
          },
          internal_secret: 'must-not-pass-through',
        }),
        { status: 200, headers: { 'Content-Type': 'application/geo+json' } },
      ),
    ),
  );
  const port = new PostgresDataFoundationResourcePort({
    pool: {
      connect: () => Promise.resolve(client),
      end: () => Promise.resolve(),
    },
    stac: {
      baseUrl: 'http://stac-api:8080',
      bearerToken: 'stac-resource-secret',
      publicApiOrigin: 'http://api:3001',
      fetch: fetcher,
      timeoutMs: 2_000,
      maxResponseBytes: 262_144,
    },
  });
  return { port, client, queries, fetcher };
}

describe('PostgreSQL-backed Data Resource port', () => {
  it('reads one Evidence fragment under RLS and appends hash-only audit metadata', async () => {
    const { port, client, queries } = fixture();

    await expect(
      port.readEvidence({ context, evidenceId: EVIDENCE_ID }),
    ).resolves.toMatchObject({
      evidenceId: EVIDENCE_ID,
      dataItemId: DATA_ITEM_ID,
      versionId: VERSION_ID,
      contentHash: SOURCE_HASH,
      securityLevel: 'L1_INTERNAL',
      policyVersion: 7,
    });

    const sql = queries.map(({ text }) => text).join('\n');
    expect(sql).toContain("set_config('wiser.tenant_id'");
    expect(sql).toContain("set_config('wiser.max_security_level'");
    expect(sql).toContain("set_config('statement_timeout'");
    expect(sql).toContain('security.authorized_row');
    expect(sql).toContain('security.audit_event');
    expect(sql).toContain('data.evidence.read');
    expect(sql).toContain('referenceHash');
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('uses a fixed STAC origin, reauthorizes returned authority IDs, and strips upstream internals', async () => {
    const { port, queries, fetcher } = fixture();

    const result = await port.readStacItem({
      context,
      collectionId: COLLECTION_ID,
      itemId: ITEM_ID,
    });

    const [input, init] = fetcher.mock.calls[0]!;
    expect(new URL(String(input)).origin).toBe('http://stac-api:8080');
    expect(new URL(String(input)).pathname).toBe(
      `/collections/${COLLECTION_ID}/items/${ITEM_ID}`,
    );
    expect(new Headers(init?.headers).get('authorization')).toBe(
      'Bearer stac-resource-secret',
    );
    expect(JSON.stringify(result)).not.toContain('internal_secret');
    expect(JSON.stringify(result)).not.toContain('/internal');
    expect(result).toMatchObject({
      id: ITEM_ID,
      collection: COLLECTION_ID,
      properties: {
        versionId: VERSION_ID,
        evidenceId: EVIDENCE_ID,
      },
    });
    const sql = queries.map(({ text }) => text).join('\n');
    expect(sql).toContain('data.resource.stac.authorize');
    expect(sql).toContain("publication_status = 'PUBLISHED'");
    expect(sql).toContain('data.stac-item.read');
  });

  it('rejects cross-tenant collections before fetch and maps hidden rows to the same safe not-found error', async () => {
    const { port, fetcher } = fixture();
    const wrongCollection = `wiser-${'f'.repeat(32)}`;
    const collectionError = await port
      .readStacItem({
        context,
        collectionId: wrongCollection,
        itemId: ITEM_ID,
      })
      .catch((error: unknown) => error);
    expect(collectionError).toBeInstanceOf(DataFoundationResourceError);
    expect(collectionError).toMatchObject({ code: 'NOT_FOUND' });
    expect(fetcher).not.toHaveBeenCalled();

    const hidden = fixture();
    hidden.queries.splice(0);
    const originalQuery = hidden.client.query;
    hidden.client.query = (text: string, values?: readonly unknown[]) => {
      if (/data\.resource\.evidence\.lookup/.test(text)) {
        return Promise.resolve({ rows: [] });
      }
      return originalQuery(text, values);
    };
    const hiddenError = await hidden.port
      .readEvidence({ context, evidenceId: EVIDENCE_ID })
      .catch((error: unknown) => error);
    expect(hiddenError).toBeInstanceOf(DataFoundationResourceError);
    expect(hiddenError).toMatchObject({ code: 'NOT_FOUND' });
    expect(String(hiddenError)).not.toContain(EVIDENCE_ID);
  });
});
