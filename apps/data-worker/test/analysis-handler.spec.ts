import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  AnalysisContentError,
  type ClaimedDataJob,
  type DataPostgresPool,
} from '@wiser/data-infra';
import { createAnalysisHandler } from '../src/handlers/analysis.js';

const tenantId = 'b1000000-0000-4000-8000-000000000001';
const projectId = 'b2000000-0000-4000-8000-000000000001';
const analysisId = 'b3000000-0000-4000-8000-000000000001';
const assetId = 'b4000000-0000-4000-8000-000000000001';
const versionId = '3c9220e3-a5dc-5254-b134-4cc0f6944108';
const itemId = '0aaa32a4-6d76-479b-a33a-91775d426d50';
const job: ClaimedDataJob = {
  jobId: analysisId,
  tenantId,
  projectId,
  operationId: assetId,
  jobType: 'data.analysis.process',
  payload: { analysisId },
  attemptCount: 1,
  maxAttempts: 3,
  leaseOwner: 'analysis-test',
  leaseExpiresAt: '2099-01-01T00:00:00Z',
  rowVersion: 2,
  cancelRequested: false,
  securityLevel: 'L2_RESTRICTED',
  policyVersion: 1,
};
const bytes = new TextEncoder().encode(
  JSON.stringify({
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        id: 'USGS-01646500',
        properties: { identifier: 'USGS-01646500', name: 'POTOMAC' },
        geometry: { type: 'Point', coordinates: [-77.12763889, 38.94977778] },
      },
    ],
  }),
);

function fixture(leaseValid = true, inputBytes = bytes, readError?: Error) {
  const calls: { sql: string; values: readonly unknown[] }[] = [];
  const pool: DataPostgresPool = {
    async connect() {
      await Promise.resolve();
      return {
        async query(sql, values = []) {
          await Promise.resolve();
          calls.push({ sql, values });
          if (sql.includes('analysis.load-run'))
            return {
              rows: [
                {
                  version_id: versionId,
                  data_item_id: itemId,
                  status: 'PENDING',
                  parser_version: '1.0.0',
                  asset_manifest: { assetIds: [assetId] },
                },
              ],
            };
          if (sql.includes('analysis.load-assets'))
            return {
              rows: [
                {
                  asset_id: assetId,
                  source_hash: createHash('sha256').update(bytes).digest('hex'),
                  media_type: 'application/geo+json',
                  byte_size: String(bytes.length),
                },
              ],
            };
          if (sql.includes('analysis.lease-fence'))
            return { rows: leaseValid ? [{ job_id: analysisId }] : [] };
          return { rows: [], rowCount: 1 };
        },
        release() {},
      };
    },
    async end() {},
  };
  return {
    calls,
    handler: createAnalysisHandler({
      pool,
      read: () =>
        readError ? Promise.reject(readError) : Promise.resolve(inputBytes),
    }),
  };
}

describe('version analysis worker', () => {
  it('classifies parser resource limits separately from invalid source content', async () => {
    const value = fixture(
      true,
      bytes,
      new AnalysisContentError('RECORD_LIMIT'),
    );
    expect(await value.handler(job)).toMatchObject({
      status: 'SUCCEEDED',
      result: {
        unsupportedAssetCount: 1,
        invalidAssetCount: 0,
        recordCount: 0,
      },
    });
    const finalized = value.calls.find((call) =>
      call.sql.includes('analysis.finish-asset'),
    );
    expect(finalized?.values.slice(2, 6)).toEqual([
      'UNSUPPORTED',
      'RECORD_LIMIT',
      null,
      null,
    ]);
  });
  it('persists source-bound records and verified geometry before settling a job', async () => {
    const value = fixture();
    expect(await value.handler(job)).toMatchObject({
      status: 'SUCCEEDED',
      result: { analysisId, recordCount: 1, featureCount: 1 },
    });
    const batch = value.calls.find((call) =>
      call.sql.includes('analysis.insert-records'),
    );
    expect(batch).toBeDefined();
    expect(JSON.stringify(batch?.values)).toContain('USGS-01646500');
    expect(JSON.stringify(batch?.values)).toContain('-77.12763889');
    expect(value.calls.at(-1)?.sql).toBe('commit');
  });
  it('rolls back the whole analysis when its lease was lost during parsing', async () => {
    const value = fixture(false);
    await expect(value.handler(job)).rejects.toMatchObject({
      category: 'ANALYSIS_LEASE_LOST',
    });
    expect(value.calls.at(-1)?.sql).toBe('rollback');
    expect(value.calls.some((call) => call.sql === 'commit')).toBe(false);
  });
  it('records a hash failure as invalid with unknown counts, without publishing any records', async () => {
    const value = fixture(true, new TextEncoder().encode('{}'));
    expect(await value.handler(job)).toMatchObject({
      status: 'SUCCEEDED',
      result: { analysisId, invalidAssetCount: 1, recordCount: 0 },
    });
    expect(
      value.calls.some((call) => call.sql.includes('analysis.insert-records')),
    ).toBe(false);
    expect(JSON.stringify(value.calls)).toContain('HASH_MISMATCH');
  });
});
