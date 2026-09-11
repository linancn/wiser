import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { preflightFiles } from '../../scripts/data-foundation/intake-preflight.mts';
it('reuses parsed profiles only for the same original and labels results as provider self-checks', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'wiser-preflight-'));
  try {
    const bytes = 'station,value\nA,2\n',
      hash = createHash('sha256').update(bytes).digest('hex');
    const source = join(dir, 'source.csv'),
      profile = join(dir, 'profile.json');
    await writeFile(source, bytes);
    await writeFile(
      profile,
      JSON.stringify({
        declaration: {
          kind: 'TABLE',
          target: 'DATASET',
          expectedSourceHash: hash,
          entry: 'UNCHECKED',
          access: 'UNKNOWN',
          acquisition: 'ORIGINAL_ACQUIRED',
          coverage: 'SAMPLE',
          evidence: 'Original header',
          metadata: {},
        },
        facts: {
          sourceHash: hash,
          mediaType: 'text/csv',
          byteSize: bytes.length,
          parserVersion: 'local-profile-v1',
          status: 'READY',
          columns: ['station', 'value'],
          recordCount: 1,
          featureCount: 0,
          reason: null,
          sourceRegistered: false,
        },
      }),
    );
    const first = await preflightFiles(source, profile);
    expect(first.kind).toBe('PROVIDER_SELF_CHECK');
    expect(first.selfCheck).toEqual({
      ruleVersion: 'wiser.intake.v1',
      sourceHash: hash,
    });
    expect(first.result.findings.map((f) => f.code)).toContain('UNIT_UNKNOWN');
    await writeFile(source, '<!doctype html><html>Sign in</html>');
    const second = await preflightFiles(source, profile);
    expect(second.result.sourceHash).not.toBe(hash);
    expect(second.result.acquisition).toBe('REGISTERED_ONLY');
    expect(second.result.findings.map((f) => f.code)).toContain(
      'SOURCE_CHANGED',
    );
    expect(second.profileReused).toBe(false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
