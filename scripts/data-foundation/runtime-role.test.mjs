import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import { ROOT_DIRECTORY } from './operations.mjs';

const sqlPath = new URL(
  '../../infrastructure/data-foundation/postgres/provision-runtime.sql',
  import.meta.url,
);

test('provisions separate non-bypass API and Worker identities through one NOLOGIN grant role', async () => {
  const sql = await readFile(sqlPath, 'utf8');
  for (const role of [
    'wiser_data_runtime',
    'wiser_data_api',
    'wiser_data_worker',
  ]) {
    assert.match(sql, new RegExp(`\\b${role}\\b`));
  }
  assert.match(sql, /wiser_data_runtime\s+NOLOGIN/i);
  assert.match(sql, /wiser_data_api\s+LOGIN/i);
  assert.match(sql, /wiser_data_worker\s+LOGIN/i);
  assert.match(sql, /NOSUPERUSER/i);
  assert.match(sql, /NOBYPASSRLS/i);
  assert.match(sql, /grant wiser_data_runtime to wiser_data_api/i);
  assert.match(sql, /grant wiser_data_runtime to wiser_data_worker/i);
  assert.doesNotMatch(sql, /grant\s+all\s+privileges/i);
  assert.doesNotMatch(sql, /password\s+'[^:]/i);
});

test('keeps provisioning one-shot and gates authority runtimes on it', async () => {
  const compose = await readFile(
    new URL('../../compose.yaml', import.meta.url),
    'utf8',
  );
  assert.match(compose, /data-runtime-provision:/);
  assert.match(compose, /provision-runtime\.sql:ro/);
  assert.match(compose, /DATA_API_DATABASE_PASSWORD/);
  assert.match(compose, /DATA_WORKER_DATABASE_PASSWORD/);
  assert.match(
    compose,
    /data-worker:[\s\S]*?DATA_DATABASE_URL:\s*postgresql:\/\/wiser_data_worker:/,
  );
  assert.match(
    compose,
    /data-worker:[\s\S]*?data-runtime-provision:[\s\S]*?condition:\s*service_completed_successfully/,
  );
  assert.equal(typeof ROOT_DIRECTORY, 'string');
});
