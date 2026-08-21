import { describe, expect, it } from 'vitest';

import type {
  DataPostgresClient,
  DataPostgresPool,
  ProjectionEvent,
} from '@wiser/data-infra';

import {
  PostgresProjectionHydrationAuthority,
  PostgresProjectionPublicationGate,
} from '../src/runtime/postgres-projection-authority.js';
import type { ProjectionAuthorityIds } from '../src/runtime/projection-hydrator.js';

const event: ProjectionEvent = {
  outboxEventId: '71',
  eventId: '71000000-0000-4000-8000-000000000071',
  tenantId: '71000000-0000-4000-8000-000000000001',
  projectId: '71000000-0000-4000-8000-000000000002',
  dataItemId: '71000000-0000-4000-8000-000000000003',
  versionId: '71000000-0000-4000-8000-000000000004',
  eventType: 'data.version.committed',
  idempotencyKey: 'data.version.committed:71',
  securityLevel: 'L2_RESTRICTED',
  policyVersion: 7,
  payload: {},
  createdAt: '2026-08-22T05:00:00.000Z',
};

const ids: ProjectionAuthorityIds = {
  dataItemId: event.dataItemId,
  versionId: event.versionId,
  assetIds: ['71000000-0000-4000-8000-000000000005'],
  contentBlobIds: ['71000000-0000-4000-8000-000000000006'],
  evidenceFragmentIds: ['71000000-0000-4000-8000-000000000007'],
  spatialExtentIds: ['71000000-0000-4000-8000-000000000008'],
  checkRunId: '71000000-0000-4000-8000-000000000009',
  processRunId: '71000000-0000-4000-8000-000000000010',
};

class FakeClient implements DataPostgresClient {
  readonly queries: Array<{
    readonly text: string;
    readonly values?: readonly unknown[];
  }> = [];
  projectionReady = true;
  released = false;

  query(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ readonly rows: readonly Record<string, unknown>[] }> {
    this.queries.push(values === undefined ? { text } : { text, values });
    if (/projection-hydration\.item-version/.test(text)) {
      return Promise.resolve({
        rows: [
          {
            data_item_id: event.dataItemId,
            name: 'River flow',
            business_domains: ['river-flow'],
            item_security_level: event.securityLevel,
            item_policy_version: '7',
            version_id: event.versionId,
            version_source_hash: 'a'.repeat(64),
            quality_grade: 'A',
            acceptance_status: 'PASSED',
            publication_status: 'UNPUBLISHED',
            committed_at: new Date('2026-08-22T05:00:00.000Z'),
            version_security_level: event.securityLevel,
            version_policy_version: '7',
          },
        ],
      });
    }
    if (/projection-hydration\.assets/.test(text)) {
      return Promise.resolve({
        rows: [
          {
            asset_id: ids.assetIds[0],
            content_blob_id: ids.contentBlobIds[0],
            source_hash: 'b'.repeat(64),
            media_type: 'application/geo+json',
            byte_size: '512',
            storage_key: 'versions/fixture',
            ordinal: '0',
          },
        ],
      });
    }
    if (/projection-hydration\.evidence/.test(text)) {
      return Promise.resolve({
        rows: [
          {
            evidence_fragment_id: ids.evidenceFragmentIds[0],
            asset_id: ids.assetIds[0],
            locator: { ordinal: 0 },
            source_hash: 'b'.repeat(64),
            excerpt: null,
          },
        ],
      });
    }
    if (/projection-hydration\.spatial/.test(text)) {
      return Promise.resolve({
        rows: [
          {
            spatial_extent_id: ids.spatialExtentIds[0],
            source_crs: 'EPSG:4326',
            source_geojson: { type: 'Point', coordinates: [116, 40] },
            wgs84_geojson: { type: 'Point', coordinates: [116, 40] },
            bbox: [116, 40, 116, 40],
          },
        ],
      });
    }
    if (/projection-hydration\.quality/.test(text)) {
      return Promise.resolve({
        rows: [
          {
            check_run_id: ids.checkRunId,
            score: '1',
            quality_grade: 'A',
            acceptance_status: 'PASSED',
          },
        ],
      });
    }
    if (/projection-hydration\.lineage/.test(text)) {
      return Promise.resolve({
        rows: [
          {
            process_run_id: ids.processRunId,
            process_type: 'INGESTION_PIPELINE',
            implementation_version: 'v1',
          },
        ],
      });
    }
    if (/publication\.lock/.test(text)) {
      return Promise.resolve({
        rows: [
          {
            state: 'COMMITTED',
            session_row_version: '12',
            operation_id: '71000000-0000-4000-8000-000000000011',
            publication_status: 'UNPUBLISHED',
            item_row_version: '1',
            acceptance_status: 'PASSED',
            operation_status: 'RUNNING',
          },
        ],
      });
    }
    if (/publication\.projection-gate/.test(text)) {
      return Promise.resolve({
        rows: this.projectionReady
          ? ['POSTGIS', 'WEAVIATE', 'OPENSEARCH', 'NEO4J', 'STAC'].map(
              (projection_kind) => ({
                projection_kind,
                status: 'SUCCEEDED',
              }),
            )
          : [{ projection_kind: 'POSTGIS', status: 'FAILED' }],
      });
    }
    if (/set state = 'PROJECTING'/.test(text)) {
      return Promise.resolve({ rows: [{ row_version: '13' }] });
    }
    if (/set state = 'PUBLISHED'/.test(text)) {
      return Promise.resolve({ rows: [{ row_version: '14' }] });
    }
    if (/update catalog\.data_item/.test(text)) {
      return Promise.resolve({ rows: [{ row_version: '2' }] });
    }
    if (/select exists/.test(text)) {
      return Promise.resolve({ rows: [{ published: true }] });
    }
    return Promise.resolve({ rows: [] });
  }

  release(): void {
    this.released = true;
  }
}

class FakePool implements DataPostgresPool {
  readonly clients: FakeClient[] = [];
  end(): Promise<void> {
    return Promise.resolve();
  }
  connect(): Promise<DataPostgresClient> {
    const client = new FakeClient();
    this.clients.push(client);
    return Promise.resolve(client);
  }
}

describe('PostgreSQL projection authority', () => {
  it('hydrates every normalized authority fact under one four-GUC read transaction', async () => {
    const pool = new FakePool();
    const authority = new PostgresProjectionHydrationAuthority(pool);
    await expect(authority.load(event, ids)).resolves.toMatchObject({
      dataItem: { dataItemId: event.dataItemId },
      version: { versionId: event.versionId },
      assets: [{ contentBlobId: ids.contentBlobIds[0] }],
      evidence: [{ evidenceId: ids.evidenceFragmentIds[0] }],
      spatial: [{ spatialExtentId: ids.spatialExtentIds[0] }],
      quality: { checkRunId: ids.checkRunId },
      lineage: { processRunId: ids.processRunId },
    });
    const client = pool.clients[0]!;
    expect(client.queries.at(0)?.text).toContain('BEGIN READ ONLY');
    expect(
      client.queries.find(({ text }) => /set_config/.test(text))?.values,
    ).toEqual([
      event.tenantId,
      event.projectId,
      event.securityLevel,
      String(event.policyVersion),
    ]);
    expect(client.queries.at(-1)?.text).toBe('COMMIT');
    expect(client.released).toBe(true);
  });

  it('publishes only with five SUCCEEDED ledgers and leaves terminal Operation settlement to the job', async () => {
    const pool = new FakePool();
    const gate = new PostgresProjectionPublicationGate(
      pool,
      '71000000-0000-4000-8000-000000000012',
    );
    await gate.publish(event);
    const sql = pool.clients[0]!.queries.map(({ text }) => text).join('\n');
    expect(sql).toContain("state = 'PROJECTING'");
    expect(sql).toContain("state = 'PUBLISHED'");
    expect(sql).toContain("publication_status = 'PUBLISHED'");
    expect(sql).toMatch(/update catalog\.data_item_version/i);
    expect(sql).toMatch(/published_at = clock_timestamp\(\)/i);
    expect(sql).toMatch(/version\.publication_status = 'PUBLISHED'/i);
    expect(sql).toContain('PROJECTION_COMPLETED');
    expect(sql).not.toMatch(/update service\.operation set status/);

    const blockedPool = new FakePool();
    const blockedGate = new PostgresProjectionPublicationGate(
      blockedPool,
      '71000000-0000-4000-8000-000000000012',
    );
    const blockedClient = await blockedPool.connect();
    (blockedClient as FakeClient).projectionReady = false;
    blockedPool.connect = () => Promise.resolve(blockedClient);
    await expect(blockedGate.publish(event)).rejects.toThrow(
      'Projection authority transaction failed safely',
    );
    expect(
      (blockedClient as FakeClient).queries.map(({ text }) => text.trim()),
    ).toContain('ROLLBACK');
  });
});
