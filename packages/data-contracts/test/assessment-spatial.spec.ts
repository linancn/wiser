import { expect, it } from 'vitest';
import {
  ListAssessmentsInputSchema,
  DATA_CAPABILITY_REGISTRY,
} from '../src/index.ts';
it('requests the latest assessment for each exact source file without replacing history', () => {
  const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  expect(
    ListAssessmentsInputSchema.parse({
      dataItemId: id,
      versionId: id,
      assetId: id,
      latestPerAsset: true,
    }),
  ).toMatchObject({ assetId: id, latestPerAsset: true });
  expect(
    ListAssessmentsInputSchema.parse({ dataItemId: id, versionId: id }),
  ).not.toHaveProperty('latestPerAsset');
  expect(DATA_CAPABILITY_REGISTRY['data.assessment.list'].version).toBe(
    '1.1.0',
  );
});
