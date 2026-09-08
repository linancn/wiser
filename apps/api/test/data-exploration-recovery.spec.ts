import { describe, expect, it, vi } from 'vitest';
import { PostgresExplorationExecutor } from '../src/data-foundation/exploration-runtime.js';
import { queryAnalysisView } from '../src/data-foundation/exploration-views.js';
import type { DataCapabilityExecutionContext } from '../src/data-foundation/capability-handler.js';

const id = '10000000-0000-4000-8000-000000000001';
const other = '20000000-0000-4000-8000-000000000001';
const context: DataCapabilityExecutionContext = {
  principal: {
    actorId: id,
    actorType: 'human',
    authenticationMethod: 'supabase_jwt',
    authUserId: id,
    sessionId: id,
    expiresAt: '2099-01-01T00:00:00.000Z',
  },
  authorization: {
    tenantId: id,
    projectId: id,
    roles: ['data-steward'],
    scopes: ['data.query.execute', 'data.catalog.read'],
    purpose: 'test',
    maxSecurityLevel: 'L1_INTERNAL',
    authzVersion: 1,
  },
  effectiveMaxSecurityLevel: 'L1_INTERNAL',
  traceId: 'a'.repeat(32),
  auditLevel: 'DETAILED',
  timeoutMs: 30000,
  signal: new AbortController().signal,
};

describe('exploration recovery', () => {
  it.each(['40001', '40P01'])(
    'retries the entire transaction after %s and releases each connection',
    async (code) => {
      let attempts = 0;
      const release = vi.fn();
      const statements: string[] = [];
      const pool = {
        async connect() {
          await Promise.resolve();
          const attempt = ++attempts;
          return {
            release,
            async query(sql: string) {
              await Promise.resolve();
              statements.push(sql);
              if (sql.startsWith('select set_config') && attempt === 1)
                throw Object.assign(new Error('transient'), { code });
              if (sql.startsWith('select * from service.exploration_snapshot'))
                return {
                  rows: [
                    {
                      query_id: id,
                      spec: {},
                      version_refs: [],
                      created_at: '2026-09-08T00:00:00Z',
                      expires_at: '2026-09-08T00:30:00Z',
                    },
                  ],
                };
              if (sql.includes('count(*)::int as total'))
                return { rows: [{ total: 0 }] };
              return { rows: [] };
            },
          };
        },
      };
      await expect(
        new PostgresExplorationExecutor(pool).execute(
          { queryId: id, view: 'resources' },
          context,
        ),
      ).resolves.toMatchObject({ totalCount: 0 });
      expect(attempts).toBe(2);
      expect(release).toHaveBeenCalledTimes(2);
      expect(statements.filter((sql) => sql.startsWith('begin'))).toHaveLength(
        2,
      );
      expect(statements.filter((sql) => sql === 'rollback')).toHaveLength(1);
    },
  );

  it('bounds retries and does not retry a constraint violation', async () => {
    for (const [code, expected] of [
      ['40001', 3],
      ['23514', 1],
    ] as const) {
      const connect = vi.fn(() =>
        Promise.resolve({
          release() {},
          async query(sql: string) {
            await Promise.resolve();
            if (sql !== 'rollback')
              throw Object.assign(new Error('failure'), { code });
            return { rows: [] };
          },
        }),
      );
      await expect(
        new PostgresExplorationExecutor({ connect }).execute(
          { queryId: id, view: 'resources' },
          context,
        ),
      ).rejects.toMatchObject({ code: 'EXECUTION_FAILED' });
      expect(connect).toHaveBeenCalledTimes(expected);
    }
  });

  it('opens a content asset before a zero-record format companion', async () => {
    const client = {
      release() {},
      async query(sql: string) {
        await Promise.resolve();
        if (sql.includes('select asset_id,encode'))
          return {
            rows: [
              {
                asset_id: id,
                source_hash: 'a'.repeat(64),
                status: 'PARTIAL',
                record_count: 0,
                feature_count: 0,
                reason: 'FORMAT_COMPANION',
                columns: [],
                source_paths: [{ path: 'shape.shx' }],
              },
              {
                asset_id: other,
                source_hash: 'b'.repeat(64),
                status: 'PARTIAL',
                record_count: 10,
                feature_count: 0,
                reason: 'UNKNOWN_CRS',
                columns: [],
                source_paths: [{ path: 'shape.shp' }],
              },
            ],
          };
        if (sql.startsWith('select count')) return { rows: [{ total: '10' }] };
        if (sql.includes('coalesce(sum'))
          return { rows: [{ records: '10', features: '0' }] };
        return { rows: [] };
      },
    };
    const result = await queryAnalysisView(
      client,
      [{ dataItemId: id, versionId: id, analysisId: id }],
      id,
      { queryId: id, versionId: id, view: 'records', first: 20 },
    );
    expect(result).toMatchObject({ selectedAssetId: other, totalCount: 10 });
  });
});
