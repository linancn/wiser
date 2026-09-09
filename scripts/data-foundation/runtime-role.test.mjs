import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { promisify } from 'node:util';

import { ROOT_DIRECTORY } from './operations.mjs';

const sqlPath = new URL(
  '../../infrastructure/data-foundation/postgres/provision-runtime.sql',
  import.meta.url,
);

test('provisions isolated non-bypass API, Worker, and GIS identities', async () => {
  const sql = await readFile(sqlPath, 'utf8');
  for (const role of [
    'wiser_data_runtime',
    'wiser_data_api',
    'wiser_data_worker',
    'wiser_data_gis',
  ]) {
    assert.match(sql, new RegExp(`\\b${role}\\b`));
  }
  assert.match(sql, /wiser_data_runtime\s+NOLOGIN/i);
  assert.match(sql, /wiser_data_api\s+LOGIN/i);
  assert.match(sql, /wiser_data_worker\s+LOGIN/i);
  assert.match(sql, /wiser_data_gis\s+LOGIN/i);
  assert.match(sql, /NOSUPERUSER/i);
  assert.match(sql, /NOBYPASSRLS/i);
  assert.match(sql, /grant wiser_data_runtime to wiser_data_api/i);
  assert.match(sql, /grant wiser_data_runtime to wiser_data_worker/i);
  assert.doesNotMatch(sql, /grant wiser_data_runtime to wiser_data_gis/i);
  assert.match(
    sql,
    /grant execute on function service\.wiser_spatial_extent_mvt[\s\S]*?to wiser_data_gis/i,
  );
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
  assert.match(compose, /DATA_GIS_DATABASE_PASSWORD/);
  assert.match(
    compose,
    /data-worker:[\s\S]*?DATA_DATABASE_URL:\s*postgresql:\/\/wiser_data_worker:/,
  );
  assert.match(
    compose,
    /martin:[\s\S]*?DATABASE_URL:\s*postgresql:\/\/wiser_data_gis:/,
  );
  assert.match(
    compose,
    /data-worker:[\s\S]*?data-runtime-provision:[\s\S]*?condition:\s*service_completed_successfully/,
  );
  assert.equal(typeof ROOT_DIRECTORY, 'string');
});

test('serializes authority and pgSTAC migrations on a fresh database', async () => {
  const compose = await readFile(
    new URL('../../compose.yaml', import.meta.url),
    'utf8',
  );
  const start = compose.indexOf('\n  pgstac-migrate:');
  const end = compose.indexOf('\n  seaweedfs:', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const pgstacMigration = compose.slice(start, end);

  assert.match(
    pgstacMigration,
    /depends_on:[\s\S]*?data-migrate:[\s\S]*?condition:\s*service_completed_successfully/,
  );
  assert.doesNotMatch(
    pgstacMigration,
    /depends_on:[\s\S]*?data-postgres:[\s\S]*?condition:\s*service_healthy/,
  );
});

test('starts certificate consumers after initialization without enabling Data in the base stack', async () => {
  const compose = async (args) => {
    const { stdout } = await promisify(execFile)(
      'docker',
      ['compose', ...args, 'config', '--format', 'json'],
      { cwd: ROOT_DIRECTORY, maxBuffer: 1024 * 1024 },
    );
    return JSON.parse(stdout).services;
  };
  const services = await compose(['--profile', 'data-foundation']);
  const awaitsCertificate = (service) =>
    Object.entries(services[service].depends_on ?? {}).some(
      ([dependency, gate]) =>
        dependency === 'opensearch-icu-init'
          ? gate.condition === 'service_completed_successfully'
          : gate.condition === 'service_healthy' &&
            awaitsCertificate(dependency),
    );

  for (const consumer of ['api', 'data-worker']) {
    assert.ok(
      awaitsCertificate(consumer),
      `${consumer} must load its CA after certificate initialization completes`,
    );
  }

  const base = await compose([]);
  assert.ok(base.api);
  assert.equal(base['opensearch-icu-init'], undefined);
  assert.equal(base.opensearch, undefined);
});

test('restores reconciliation review-only grants after the common table grants', async () => {
  const sql = (await readFile(sqlPath, 'utf8')).toLowerCase();
  const common = sql.indexOf('grant select, insert, update on all tables');
  const revoke = sql.indexOf(
    'revoke update on service.observation_reconciliation from wiser_data_runtime',
  );
  assert.ok(
    revoke > common,
    'provisioning must remove inherited whole-row update permission',
  );
  const review =
    /grant update\(status,\s*row_version,\s*reviewed_at,\s*review_note\) on service\.observation_reconciliation to wiser_data_runtime/.exec(
      sql,
    );
  assert.ok(
    review && review.index > revoke,
    'only the four review fields may be updated',
  );
});
