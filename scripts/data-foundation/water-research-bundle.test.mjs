import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

test('Compose can ingest the largest real-case file and respects an explicit Worker size bound', () => {
  const compose = fileURLToPath(new URL('../../compose.yaml', import.meta.url));
  const limit = (override) => {
    const environment = { ...process.env };
    delete environment.DATA_INGESTION_MAX_OBJECT_BYTES;
    if (override !== undefined)
      environment.DATA_INGESTION_MAX_OBJECT_BYTES = String(override);
    let output;
    try {
      output = execFileSync(
        'docker',
        [
          'compose',
          '--env-file',
          '/dev/null',
          '-f',
          compose,
          '--profile',
          'data-foundation',
          'config',
          '--format',
          'json',
        ],
        {
          env: environment,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
    } catch {
      assert.fail(
        'Compose configuration must resolve without starting services.',
      );
    }
    return Number(
      JSON.parse(output).services['data-worker'].environment
        .DATA_INGESTION_MAX_OBJECT_BYTES,
    );
  };
  assert.ok(
    limit() >= 36_378_636,
    'the Beijing hydrology CSV must fit the default object bound',
  );
  assert.equal(limit(50 * 1024 * 1024), 50 * 1024 * 1024);
});

test('the Skill reconciles source registries and safely inventories every bundled file', () => {
  const directory = fileURLToPath(
    new URL('../../.agents/skills/wiser-data-foundation/scripts/', import.meta.url),
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
