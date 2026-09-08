import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

test('the Skill reconciles source registries and safely inventories every bundled file', () => {
  const directory = fileURLToPath(
    new URL('../../skills/wiser-data-foundation/scripts/', import.meta.url),
  );
  const result = execFileSync(
    'python3',
    ['-B', '-m', 'unittest', '-v', 'test_water_bundle', 'test_water_import'],
    {
      cwd: directory,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  assert.equal(result, '');
});
