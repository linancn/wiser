import { describe, expect, it } from 'vitest';
import { calculateExplorationReadiness } from '../src/exploration-readiness.js';

const base = {
  analyzed: true,
  partial: false,
  legacyRecordCount: 0,
  legacyFeatureCount: 0,
};
describe('analytical readiness is distinct from source registration and geometry suitability', () => {
  it('keeps metadata-only, unparsed and parsed empty sources distinct', () => {
    expect(
      calculateExplorationReadiness({ ...base, assets: [] }),
    ).toMatchObject({
      records: 'METADATA_ONLY',
      spatial: 'METADATA_ONLY',
      recordCount: null,
      featureCount: null,
    });
    expect(
      calculateExplorationReadiness({ ...base, analyzed: false, assets: [] }),
    ).toMatchObject({ records: 'NOT_PARSED', spatial: 'NOT_PARSED' });
    expect(
      calculateExplorationReadiness({
        ...base,
        assets: [
          { status: 'EMPTY', reason: null, recordCount: 0, featureCount: 0 },
        ],
      }),
    ).toMatchObject({
      records: 'EMPTY',
      spatial: 'NO_SPATIAL_DATA',
      recordCount: 0,
    });
  });
  it('does not call unknown CRS a format failure or invent mapped features', () => {
    expect(
      calculateExplorationReadiness({
        ...base,
        partial: true,
        assets: [
          {
            status: 'PARTIAL',
            reason: 'UNKNOWN_CRS',
            recordCount: 171,
            featureCount: 0,
          },
        ],
      }),
    ).toMatchObject({
      records: 'PARTIAL',
      spatial: 'CRS_UNVERIFIED',
      recordCount: 171,
      featureCount: 0,
    });
    expect(
      calculateExplorationReadiness({
        ...base,
        assets: [
          { status: 'READY', reason: null, recordCount: 100, featureCount: 0 },
        ],
      }),
    ).toMatchObject({ records: 'READY', spatial: 'NO_SPATIAL_DATA' });
  });
  it('retains unknown counts and a specific unavailable state', () => {
    for (const status of ['INVALID', 'RESTRICTED', 'UNSUPPORTED'] as const) {
      expect(
        calculateExplorationReadiness({
          ...base,
          partial: true,
          assets: [
            {
              status,
              reason: 'INVALID_CONTENT',
              recordCount: null,
              featureCount: null,
            },
          ],
        }),
      ).toMatchObject({
        records: status,
        spatial: status,
        recordCount: null,
        featureCount: null,
      });
    }
  });
  it('excludes companion-only metadata from analytical counts', () => {
    expect(
      calculateExplorationReadiness({
        ...base,
        partial: true,
        assets: [
          {
            status: 'PARTIAL',
            reason: 'FORMAT_COMPANION',
            recordCount: 0,
            featureCount: 0,
          },
          {
            status: 'UNSUPPORTED',
            reason: 'MISSING_COMPANION',
            recordCount: null,
            featureCount: null,
          },
        ],
      }),
    ).toMatchObject({
      records: 'UNSUPPORTED',
      recordCount: null,
      featureCount: null,
    });
  });
});
