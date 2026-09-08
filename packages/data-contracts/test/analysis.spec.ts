import { describe, expect, it } from 'vitest';
import {
  CreateAnalysisInputSchema,
  AnalysisAssetResultSchema,
} from '../src/analysis/index.ts';

const version = {
  dataItemId: '0aaa32a4-6d76-479b-a33a-91775d426d50',
  versionId: '3c9220e3-a5dc-5254-b134-4cc0f6944108',
};
describe('governed analysis contracts', () => {
  it('requires a published version reference, never a client supplied source or identity', () => {
    expect(CreateAnalysisInputSchema.parse(version)).toEqual(version);
    for (const extra of [
      { url: 'https://example.test/data.csv' },
      { tenantId: version.dataItemId },
      { sql: 'select 1' },
      { storageKey: 'private/source' },
    ]) {
      expect(
        CreateAnalysisInputSchema.safeParse({ ...version, ...extra }).success,
      ).toBe(false);
    }
    expect(
      CreateAnalysisInputSchema.safeParse({ dataItemId: version.dataItemId })
        .success,
    ).toBe(false);
  });
  it('distinguishes an empty parsed source from an unsupported or failed source', () => {
    const base = {
      assetId: version.dataItemId,
      status: 'EMPTY',
      recordCount: 0,
      featureCount: 0,
      reason: null,
    };
    expect(AnalysisAssetResultSchema.safeParse(base).success).toBe(true);
    expect(
      AnalysisAssetResultSchema.safeParse({
        ...base,
        status: 'UNSUPPORTED',
        recordCount: null,
        featureCount: null,
        reason: 'FORMAT_UNSUPPORTED',
      }).success,
    ).toBe(true);
    expect(
      AnalysisAssetResultSchema.safeParse({
        ...base,
        status: 'INVALID',
        reason: 'INVALID_CONTENT',
      }).success,
    ).toBe(false);
    expect(
      AnalysisAssetResultSchema.safeParse({ ...base, recordCount: 3 }).success,
    ).toBe(false);
    expect(
      AnalysisAssetResultSchema.safeParse({
        ...base,
        status: 'READY',
        recordCount: 1,
        featureCount: 2,
      }).success,
    ).toBe(false);
  });
});
