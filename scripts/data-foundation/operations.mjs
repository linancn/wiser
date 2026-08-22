import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';

export const ROOT_DIRECTORY = fileURLToPath(new URL('../../', import.meta.url));

export const DATA_SERVICES = Object.freeze([
  'data-postgres',
  'seaweedfs',
  'weaviate',
  'opensearch',
  'opensearch-dashboards',
  'neo4j',
  'geoserver',
  'stac-api',
  'titiler',
  'martin',
  'tika',
  'clamav',
  'data-worker',
  'mcp-http',
]);

export const DATA_ALL_SERVICES = Object.freeze([
  'data-migrate',
  'data-object-store-init',
  'data-runtime-provision',
  'pgstac-migrate',
  'opensearch-icu-init',
  ...DATA_SERVICES,
]);

export const DATA_VOLUME_KEYS = Object.freeze([
  'data-postgres-data',
  'seaweedfs-data',
  'weaviate-data',
  'opensearch-data',
  'opensearch-dashboards-data',
  'opensearch-icu-plugin',
  'neo4j-data',
  'geoserver-data',
  'clamav-data',
]);

export const REQUIRED_CAPABILITY_IDS = Object.freeze([
  'data.catalog.search',
  'data.catalog.get',
  'data.query',
  'data.search.federated',
  'data.knowledge.search',
  'data.graph.expand',
  'data.graph.findPath',
  'data.geo.query',
  'data.geo.intersect',
  'data.ingestion.create',
  'data.ingestion.submit',
  'data.operation.get',
  'data.catalog.create',
  'data.catalog.versions.list',
  'data.catalog.versions.get',
  'data.uploadSession.create',
  'data.uploadSession.complete',
  'data.ingestion.get',
  'data.ingestion.approve',
  'data.ingestion.reject',
  'data.operation.cancel',
  'data.operation.events',
]);

const FIXTURES = Object.freeze({
  geojson: {
    path: join(
      ROOT_DIRECTORY,
      'tests/fixtures/data-foundation/sample-stations.geojson',
    ),
    sha256: '35361986ce6b364c99dbcefc56ac266c07dac5dbdff2a95dfe392c3eac9bc975',
  },
  evidence: {
    path: join(
      ROOT_DIRECTORY,
      'tests/fixtures/data-foundation/sample-evidence.md',
    ),
    sha256: '123afced4bc8e32ced1065c9d3d28d3118387f0a36b84e146cbbbbee861db930',
  },
});

export const SEED_IDENTIFIERS = Object.freeze({
  dataItemId: 'd1000000-0000-4000-8000-000000000001',
  tenantId: 'd1000000-0000-4000-8000-000000000101',
  projectId: 'd1000000-0000-4000-8000-000000000102',
});

function operationError(message) {
  return new Error(`Data Foundation operation failed: ${message}`);
}

export function isDirectExecution(metaUrl) {
  return (
    process.argv[1] !== undefined &&
    fileURLToPath(metaUrl) === resolve(process.argv[1])
  );
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function runCommand(
  command,
  args,
  { capture = true, input, environment = process.env } = {},
) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: ROOT_DIRECTORY,
      env: environment,
      shell: false,
      stdio: ['pipe', capture ? 'pipe' : 'inherit', 'inherit'],
    });
    const output = [];
    if (capture) {
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk) => output.push(chunk));
    }
    child.once('error', () =>
      reject(operationError(`${command} did not start`)),
    );
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolve(output.join(''));
        return;
      }
      reject(
        operationError(
          `${command} exited with ${code ?? `signal ${signal ?? 'unknown'}`}`,
        ),
      );
    });
    if (input === undefined) {
      child.stdin.end();
    } else {
      child.stdin.end(input);
    }
  });
}

export function runCompose(args, options) {
  return runCommand(
    'docker',
    ['compose', '--profile', 'data-foundation', ...args],
    options,
  );
}

export function runPostgresSql(sql) {
  return runCompose(
    [
      'exec',
      '-T',
      'data-postgres',
      'sh',
      '-ec',
      'exec psql -X -q -v ON_ERROR_STOP=1 --no-align --tuples-only --username "$POSTGRES_USER" --dbname "$POSTGRES_DB"',
    ],
    { input: sql },
  );
}

function composeServiceName(record) {
  if (record === null || typeof record !== 'object') return null;
  const value = record.Service ?? record.service;
  return typeof value === 'string' ? value : null;
}

export function parseComposePsOutput(output) {
  const trimmed = output.trim();
  if (trimmed.length === 0) return [];
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return parsed;
    if (parsed !== null && typeof parsed === 'object') return [parsed];
  } catch {
    // Docker Compose versions before JSON arrays emit one JSON object per line.
  }
  return trimmed
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));
}

export function assertComposeServicesHealthy(records) {
  const byService = new Map(
    records
      .map((record) => [composeServiceName(record), record])
      .filter(([name]) => name !== null),
  );
  for (const service of DATA_SERVICES) {
    const record = byService.get(service);
    if (record === undefined) {
      throw operationError(`${service} is absent from docker compose ps`);
    }
    const state = record.State ?? record.state;
    const health = record.Health ?? record.health;
    if (state !== 'running' || health !== 'healthy') {
      throw operationError(
        `${service} is not healthy (state=${String(state)}, health=${String(health)})`,
      );
    }
  }
}

export function assertDataHealth(document) {
  if (
    document === null ||
    typeof document !== 'object' ||
    document.status !== 'ready' ||
    document.system !== 'data-foundation' ||
    document.authority?.database !== true ||
    document.authority?.objectStore !== true ||
    document.worker !== true ||
    document.projections !== 'rebuildable'
  ) {
    throw operationError('Data Foundation API is not ready');
  }
}

export function validateCapabilities(document) {
  if (
    document === null ||
    typeof document !== 'object' ||
    document.registryVersion !== '1.0.0' ||
    !Array.isArray(document.capabilities)
  ) {
    throw operationError('Capability response has an invalid envelope');
  }
  const ids = document.capabilities.map((capability) => capability?.id);
  if (new Set(ids).size !== ids.length) {
    throw operationError('Capability response contains duplicate ids');
  }
  for (const capabilityId of REQUIRED_CAPABILITY_IDS) {
    if (!ids.includes(capabilityId)) {
      throw operationError(`missing required capability ${capabilityId}`);
    }
  }
}

export async function fetchJson(url, { timeoutMs = 10_000 } = {}) {
  let response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  } catch {
    throw operationError(`request to ${url} failed`);
  }
  if (!response.ok) {
    throw operationError(`${url} returned HTTP ${response.status}`);
  }
  try {
    return await response.json();
  } catch {
    throw operationError(`${url} returned invalid JSON`);
  }
}

export async function verifyFixtureBundle() {
  const [geojsonText, evidenceText] = await Promise.all([
    readFile(FIXTURES.geojson.path, 'utf8'),
    readFile(FIXTURES.evidence.path, 'utf8'),
  ]);
  const geojsonHash = sha256(geojsonText);
  const evidenceHash = sha256(evidenceText);
  if (
    geojsonHash !== FIXTURES.geojson.sha256 ||
    evidenceHash !== FIXTURES.evidence.sha256
  ) {
    throw operationError('deterministic fixture checksum drift detected');
  }

  let geojson;
  try {
    geojson = JSON.parse(geojsonText);
  } catch {
    throw operationError('GeoJSON fixture is invalid JSON');
  }
  if (
    geojson?.type !== 'FeatureCollection' ||
    !Array.isArray(geojson.features) ||
    geojson.features.length !== 2 ||
    !geojson.features.every(
      (feature) =>
        feature?.type === 'Feature' &&
        feature.geometry?.type === 'Point' &&
        Array.isArray(feature.geometry.coordinates) &&
        feature.geometry.coordinates.length === 2,
    )
  ) {
    throw operationError('GeoJSON fixture structure drift detected');
  }
  if (
    !evidenceText.includes('# Deterministic Yongding River evidence fixture') ||
    !evidenceText.includes('securityLevel: L0_PUBLIC') ||
    !evidenceText.includes('generationMethod: SYNTHETIC')
  ) {
    throw operationError('evidence fixture structure drift detected');
  }

  return Object.freeze({
    geojsonSha256: geojsonHash,
    evidenceSha256: evidenceHash,
    stationCount: geojson.features.length,
  });
}

async function expectedMigrations() {
  const directory = join(
    ROOT_DIRECTORY,
    'infrastructure/data-foundation/postgres/migrations',
  );
  const filenames = (await readdir(directory))
    .filter((filename) => /^\d{4}_[a-z][a-z0-9_]*\.sql$/.test(filename))
    .sort();
  if (filenames.length === 0) {
    throw operationError('no Data Foundation migrations were discovered');
  }
  return Promise.all(
    filenames.map(async (filename) => {
      const sql = await readFile(join(directory, filename), 'utf8');
      return {
        version: filename.slice(0, 4),
        filename,
        checksum: sha256(sql),
      };
    }),
  );
}

export async function assertMigrationsApplied() {
  const expected = await expectedMigrations();
  const output = await runPostgresSql(`
select version || '|' || filename || '|' || checksum
from public.schema_migrations
order by version;
`);
  const actual = output
    .trim()
    .split(/\r?\n/)
    .filter((line) => line.length > 0)
    .map((line) => {
      const [version, filename, checksum] = line.split('|');
      return { version, filename, checksum };
    });
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw operationError('database migration history is incomplete or drifted');
  }
  return expected;
}

export async function assertPgStacMigrated() {
  const output = await runPostgresSql(`
select (
  to_regclass('pgstac.collections') is not null
  and to_regclass('pgstac.items') is not null
)::text;
`);
  if (output.trim() !== 'true') {
    throw operationError('pgSTAC migrations are incomplete');
  }
}

export async function assertRuntimeRoles() {
  const roles = await runPostgresSql(`
select rolname || '|' || rolsuper || '|' || rolbypassrls || '|' || rolcanlogin
from pg_catalog.pg_roles
where rolname in ('wiser_data_runtime', 'wiser_data_api', 'wiser_data_worker', 'wiser_data_gis')
order by rolname;
`);
  const expected = [
    'wiser_data_api|false|false|true',
    'wiser_data_gis|false|false|true',
    'wiser_data_runtime|false|false|false',
    'wiser_data_worker|false|false|true',
  ].join('\n');
  if (roles.trim() !== expected) {
    throw operationError(
      'least-privilege Data Foundation runtime roles are invalid',
    );
  }

  const wrongScope = await runPostgresSql(`
begin;
set local role wiser_data_worker;
set local wiser.tenant_id = '11111111-1111-4111-8111-111111111111';
set local wiser.project_id = '22222222-2222-4222-8222-222222222222';
set local wiser.max_security_level = 'L3_CONFIDENTIAL';
set local wiser.policy_version = '1';
select count(*) from catalog.data_item;
rollback;
`);
  if (!/^0(?:\s|$)/.test(wrongScope.trim())) {
    throw operationError('Data Foundation runtime role crossed its RLS scope');
  }

  const fixtureScope = await runPostgresSql(`
begin;
set local role wiser_data_worker;
set local wiser.tenant_id = '${SEED_IDENTIFIERS.tenantId}';
set local wiser.project_id = '${SEED_IDENTIFIERS.projectId}';
set local wiser.max_security_level = 'L3_CONFIDENTIAL';
set local wiser.policy_version = '1';
select count(*)
from catalog.data_item
where data_item_id = '${SEED_IDENTIFIERS.dataItemId}'::uuid;
rollback;
`);
  if (!/^1(?:\s|$)/.test(fixtureScope.trim())) {
    throw operationError(
      'Data Foundation runtime role cannot read its seeded scope',
    );
  }
  return Object.freeze({ api: true, worker: true, rls: true });
}

export function buildSeedSql(fixture) {
  for (const hash of [fixture.geojsonSha256, fixture.evidenceSha256]) {
    if (!/^[a-f0-9]{64}$/.test(hash)) {
      throw operationError('fixture hash is invalid');
    }
  }
  return `
begin;

set local wiser.tenant_id = '${SEED_IDENTIFIERS.tenantId}';
set local wiser.project_id = '${SEED_IDENTIFIERS.projectId}';
set local wiser.max_security_level = 'L3_CONFIDENTIAL';
set local wiser.policy_version = '1';

insert into catalog.data_item (
  data_item_id,
  tenant_id,
  project_id,
  owner_project_id,
  name,
  business_domains,
  source_natures,
  source_channels,
  processing_stage,
  intended_uses,
  source_organization,
  source_contact,
  authorization_scope,
  citation_requirements,
  generation_method,
  quality_grade,
  acceptance_status,
  publication_status,
  security_level,
  update_mode
) values (
  '${SEED_IDENTIFIERS.dataItemId}',
  '${SEED_IDENTIFIERS.tenantId}',
  '${SEED_IDENTIFIERS.projectId}',
  '${SEED_IDENTIFIERS.projectId}',
  'WISER deterministic smoke fixture',
  array['water-monitoring'],
  array['synthetic'],
  array['fixture'],
  'RAW',
  array['integration-testing'],
  'WISER fixture laboratory',
  jsonb_build_object(
    'geojsonSha256', '${fixture.geojsonSha256}',
    'evidenceSha256', '${fixture.evidenceSha256}',
    'stationCount', ${fixture.stationCount}
  ),
  'data.catalog.read',
  array['Cite the immutable deterministic fixture hash.'],
  'SYNTHETIC',
  'C',
  'PENDING',
  'UNPUBLISHED',
  'L0_PUBLIC',
  'SNAPSHOT'
)
on conflict (data_item_id) do nothing;

do $seed$
begin
  if not exists (
    select 1
    from catalog.data_item
    where data_item_id = '${SEED_IDENTIFIERS.dataItemId}'::uuid
      and tenant_id = '${SEED_IDENTIFIERS.tenantId}'::uuid
      and project_id = '${SEED_IDENTIFIERS.projectId}'::uuid
      and name = 'WISER deterministic smoke fixture'
      and source_contact ->> 'geojsonSha256' = '${fixture.geojsonSha256}'
      and source_contact ->> 'evidenceSha256' = '${fixture.evidenceSha256}'
      and (source_contact ->> 'stationCount')::integer = ${fixture.stationCount}
  ) then
    raise exception 'deterministic Data Foundation seed conflicts with existing state';
  end if;
end;
$seed$;

commit;
`;
}

export async function assertSeedFixture(fixture) {
  const output = await runPostgresSql(`
begin;
set local wiser.tenant_id = '${SEED_IDENTIFIERS.tenantId}';
set local wiser.project_id = '${SEED_IDENTIFIERS.projectId}';
set local wiser.max_security_level = 'L3_CONFIDENTIAL';
set local wiser.policy_version = '1';
select json_build_object(
  'dataItemId', data_item_id,
  'tenantId', tenant_id,
  'projectId', project_id,
  'name', name,
  'geojsonSha256', source_contact ->> 'geojsonSha256',
  'evidenceSha256', source_contact ->> 'evidenceSha256',
  'stationCount', (source_contact ->> 'stationCount')::integer
)::text
from catalog.data_item
where data_item_id = '${SEED_IDENTIFIERS.dataItemId}'::uuid;
commit;
`);
  let projection;
  try {
    projection = JSON.parse(output.trim());
  } catch {
    throw operationError('deterministic seed projection is absent or invalid');
  }
  const expected = {
    dataItemId: SEED_IDENTIFIERS.dataItemId,
    tenantId: SEED_IDENTIFIERS.tenantId,
    projectId: SEED_IDENTIFIERS.projectId,
    name: 'WISER deterministic smoke fixture',
    geojsonSha256: fixture.geojsonSha256,
    evidenceSha256: fixture.evidenceSha256,
    stationCount: fixture.stationCount,
  };
  if (JSON.stringify(projection) !== JSON.stringify(expected)) {
    throw operationError(
      'deterministic seed projection does not match fixtures',
    );
  }
  return projection;
}

export async function composeHealthCheck() {
  const output = await runCompose(['ps', '--format', 'json']);
  const records = parseComposePsOutput(output);
  assertComposeServicesHealthy(records);
  return records;
}

export async function apiContractCheck(
  apiOrigin = process.env.DATA_API_ORIGIN ?? 'http://127.0.0.1:3001',
) {
  const origin = new URL(apiOrigin);
  if (
    (origin.protocol !== 'http:' && origin.protocol !== 'https:') ||
    origin.username.length > 0 ||
    origin.password.length > 0 ||
    origin.pathname !== '/'
  ) {
    throw operationError('DATA_API_ORIGIN must be a credential-free origin');
  }
  const [live, health, capabilities] = await Promise.all([
    fetchJson(new URL('/health/live', origin)),
    fetchJson(new URL('/api/data/v1/health', origin)),
    fetchJson(new URL('/api/data/v1/capabilities', origin)),
  ]);
  if (live?.status !== 'ok' || live?.live !== true) {
    throw operationError('WISER API liveness contract failed');
  }
  assertDataHealth(health);
  validateCapabilities(capabilities);
  return { health, capabilityCount: capabilities.capabilities.length };
}

export async function resolveDataVolumeNames() {
  const output = await runCompose(['config', '--format', 'json']);
  let config;
  try {
    config = JSON.parse(output);
  } catch {
    throw operationError('docker compose config returned invalid JSON');
  }
  if (config?.name !== 'wiser') {
    throw operationError('refusing reset outside the explicit wiser project');
  }
  const names = DATA_VOLUME_KEYS.map((key) => config?.volumes?.[key]?.name);
  if (
    names.some((name, index) => name !== `wiser_${DATA_VOLUME_KEYS[index]}`)
  ) {
    throw operationError('Data Foundation named volume contract is incomplete');
  }
  return names;
}

export function requireResetConfirmation(environment = process.env) {
  const expected = 'reset-wiser-data-foundation';
  if (environment.WISER_DATA_RESET_CONFIRM !== expected) {
    throw operationError(
      `set WISER_DATA_RESET_CONFIRM=${expected} to remove Data Foundation volumes`,
    );
  }
}
