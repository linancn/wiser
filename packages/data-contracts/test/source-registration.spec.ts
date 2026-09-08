import { describe, expect, it } from 'vitest';
import {
  CreateIngestionInputSchema,
  DATA_CAPABILITY_REGISTRY,
} from '../src/index.js';

const assetId = '10000000-0000-4000-8000-000000000001';
const sourceRegistration = {
  sourceId: 'DS-0409',
  kind: 'DATASET_INTERFACE',
  name: 'HydroATLAS bounded source sample',
  bundleId: 'water-research-20260908',
  providerName: 'HydroSHEDS',
  accessStatus: 'bounded_sample_only',
  completeness: 'PARTIAL',
  manifestAssetId: assetId,
  manifestSha256: 'a'.repeat(64),
  limitations: [
    'Source registration only; partial bytes are not an analytically validated dataset.',
  ],
};
const input = {
  assetIds: [assetId],
  ownerProjectId: '10000000-0000-4000-8000-000000000002',
  intendedUses: ['source-registration'],
  requestedSecurityLevel: 'L1_INTERNAL',
  sourceRegistration,
};

describe('research source registration through ingestion', () => {
  it('retains stable source identity and explicitly limited completeness', () => {
    expect(CreateIngestionInputSchema.parse(input)).toEqual(input);
    expect(DATA_CAPABILITY_REGISTRY['data.ingestion.create'].version).toBe(
      '1.1.0',
    );
  });

  it('rejects an unbound manifest, duplicate inputs and caller-issued quality verdicts', () => {
    expect(
      CreateIngestionInputSchema.safeParse({
        ...input,
        sourceRegistration: {
          ...sourceRegistration,
          manifestAssetId: input.ownerProjectId,
        },
      }).success,
    ).toBe(false);
    expect(
      CreateIngestionInputSchema.safeParse({
        ...input,
        assetIds: [assetId, assetId],
      }).success,
    ).toBe(false);
    expect(
      CreateIngestionInputSchema.safeParse({
        ...input,
        sourceRegistration: { ...sourceRegistration, qualityGrade: 'A' },
      }).success,
    ).toBe(false);
    expect(
      CreateIngestionInputSchema.safeParse({
        ...input,
        sourceRegistration: { ...sourceRegistration, completeness: 'COMPLETE' },
      }).success,
    ).toBe(false);
  });
});
