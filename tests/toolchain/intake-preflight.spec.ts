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

async function checkSavedHtml(
  target: 'DESCRIPTION_PAGE' | 'DOWNLOAD_FILE' | 'DATASET',
  profileState: 'ready' | 'stale' | 'invalid' = 'ready',
) {
  const dir = await mkdtemp(join(tmpdir(), 'wiser-html-preflight-'));
  try {
    const bytes = Buffer.from(
      '<!doctype html><html><body><p>已保存的来源说明。</p></body></html>',
    );
    const hash = createHash('sha256').update(bytes).digest('hex');
    const source = join(dir, 'source.html');
    const profile = join(dir, 'profile.json');
    await writeFile(source, bytes);
    await writeFile(
      profile,
      JSON.stringify({
        declaration: {
          kind: 'DOCUMENT',
          target,
          expectedSourceHash: hash,
          entry: 'VALID',
          access: 'AUTHORIZED',
          acquisition: 'ORIGINAL_ACQUIRED',
          coverage: 'COMPLETE',
          evidence: 'Saved page, paragraph 1',
          metadata: {
            source: 'Self-authored test document',
            authorization: 'Test fixture use',
            locator: 'Paragraph 1',
          },
        },
        facts: {
          sourceHash: profileState === 'stale' ? 'a'.repeat(64) : hash,
          // The actual bytes identify HTML even when the supplied MIME is wrong.
          mediaType: 'text/plain',
          byteSize: bytes.length,
          parserVersion: 'local-profile-v1',
          status: profileState === 'invalid' ? 'INVALID' : 'READY',
          columns: ['c1'],
          recordCount: profileState === 'invalid' ? null : 1,
          featureCount: profileState === 'invalid' ? null : 0,
          reason: profileState === 'invalid' ? 'INVALID_CONTENT' : null,
          sourceRegistered: false,
        },
      }),
    );
    return await preflightFiles(source, profile);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

it.each(['DESCRIPTION_PAGE', 'DOWNLOAD_FILE'] as const)(
  'retains the parsed HTML profile for the saved %s without calling it invalid',
  async (target) => {
    const result = await checkSavedHtml(target);
    expect(result.profileReused).toBe(true);
    expect(result.result.acquisition).toBe('ORIGINAL_ACQUIRED');
    expect(result.result.findings).toEqual([]);
    expect(result.result.nextAction).toBe('REVIEW_EVIDENCE');
  },
);

it('keeps a parsed HTML page separate from acquisition of its described dataset', async () => {
  const result = await checkSavedHtml('DATASET');
  expect(result.result.acquisition).toBe('REGISTERED_ONLY');
  expect(result.result.findings.map((finding) => finding.code)).toContain(
    'TARGET_NOT_ACQUIRED',
  );
});

it('requires parsing the saved HTML original again when its profile is stale', async () => {
  const result = await checkSavedHtml('DESCRIPTION_PAGE', 'stale');
  expect(result.profileReused).toBe(false);
  expect(result.result.nextAction).toBe('PARSE_SAVED_ORIGINAL');
  expect(result.result.findings.map((finding) => finding.code)).toContain(
    'CONTENT_NOT_PARSED',
  );
});

it('does not promote an invalid parser result because a saved page looks like HTML', async () => {
  const result = await checkSavedHtml('DESCRIPTION_PAGE', 'invalid');
  expect(result.result.findings.map((finding) => finding.code)).toContain(
    'CONTENT_NOT_PARSED',
  );
  expect(result.result.nextAction).toBe('COMPLETE_METADATA');
});
