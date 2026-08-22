import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  isDirectExecution,
  ROOT_DIRECTORY,
  runCommand,
  runCompose,
} from './operations.mjs';
import {
  buildSupabaseComposeEnvironment,
  parseSupabaseStatusEnvironment,
  signInLocalOperator,
} from './supabase-runtime.mjs';

const LOCAL_OPERATOR_EMAIL = 'operator@agent-excon.test';
const LOCAL_OPERATOR_PASSWORD = 'WiserLocalOperator-2026!';

function ephemeralKeyRing() {
  return {
    activeKeyId: 'local-ephemeral',
    keys: { 'local-ephemeral': randomBytes(32).toString('base64url') },
  };
}

const LOCAL_STATE_DIRECTORY = join(ROOT_DIRECTORY, '.wiser/local');
const LOCAL_STATE_PATH = join(LOCAL_STATE_DIRECTORY, 'runtime-secrets.json');

function validLocalSecrets(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    value.version === 1 &&
    typeof value.exconJournalPassword === 'string' &&
    /^[A-Za-z0-9_-]{32,128}$/.test(value.exconJournalPassword) &&
    value.exconLeaseHmacKeys !== null &&
    typeof value.exconLeaseHmacKeys === 'object' &&
    value.delegatedCredentialHmacKeys !== null &&
    typeof value.delegatedCredentialHmacKeys === 'object'
  );
}

async function localRuntimeSecrets() {
  try {
    const parsed = JSON.parse(await readFile(LOCAL_STATE_PATH, 'utf8'));
    if (!validLocalSecrets(parsed)) throw new Error('invalid local state');
    return parsed;
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw new Error('Local WISER runtime secret state is invalid.');
    }
  }
  const created = {
    version: 1,
    exconJournalPassword: randomBytes(32).toString('base64url'),
    exconLeaseHmacKeys: ephemeralKeyRing(),
    delegatedCredentialHmacKeys: ephemeralKeyRing(),
  };
  await mkdir(LOCAL_STATE_DIRECTORY, { recursive: true, mode: 0o700 });
  await writeFile(LOCAL_STATE_PATH, `${JSON.stringify(created)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600,
  }).catch(async (error) => {
    if (error?.code !== 'EEXIST') throw error;
  });
  const persisted = JSON.parse(await readFile(LOCAL_STATE_PATH, 'utf8'));
  if (!validLocalSecrets(persisted)) {
    throw new Error('Local WISER runtime secret state is invalid.');
  }
  return persisted;
}

async function provisionExconRuntime(password, environment) {
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(password)) {
    throw new Error('Local EXCON runtime password is invalid.');
  }
  await runCommand(
    'docker',
    [
      'exec',
      '-i',
      'supabase_db_wiser',
      'psql',
      '-X',
      '-v',
      'ON_ERROR_STOP=1',
      '--username',
      'postgres',
      '--dbname',
      'postgres',
    ],
    {
      environment,
      input: `alter role wiser_excon_api with login password '${password}';\n`,
    },
  );
}

export async function startDataFoundation(environment = process.env) {
  const statusOutput = await runCommand(
    'pnpm',
    ['exec', 'supabase', 'status', '-o', 'env'],
    { environment },
  );
  const status = parseSupabaseStatusEnvironment(statusOutput);
  const localSecrets = await localRuntimeSecrets();
  await provisionExconRuntime(localSecrets.exconJournalPassword, environment);
  const accessToken = await signInLocalOperator(status, {
    email: environment['WISER_LOCAL_OPERATOR_EMAIL'] ?? LOCAL_OPERATOR_EMAIL,
    password:
      environment['WISER_LOCAL_OPERATOR_PASSWORD'] ?? LOCAL_OPERATOR_PASSWORD,
  });
  const auth = buildSupabaseComposeEnvironment(status, {
    accessToken,
    delegatedCredentialHmacKeyRing:
      environment['WISER_DELEGATED_CREDENTIAL_HMAC_KEYS'] ??
      JSON.stringify(localSecrets.delegatedCredentialHmacKeys),
  });
  const tenantId =
    environment['DATA_TENANT_ID'] ?? 'b1000000-0000-4000-8000-000000000001';
  const projectId =
    environment['DATA_PROJECT_ID'] ?? 'b2000000-0000-4000-8000-000000000001';
  await runCompose(['up', '-d', '--build', '--wait'], {
    capture: false,
    environment: {
      ...environment,
      ...auth,
      DATA_FOUNDATION_MODE: 'enabled',
      DATA_TENANT_ID: tenantId,
      DATA_PROJECT_ID: projectId,
      WISER_DATA_TENANT_ID: tenantId,
      WISER_DATA_PROJECT_ID: projectId,
      WISER_DATA_API_INTERNAL_URL: 'http://api:3001',
      WISER_DATA_PURPOSE: 'data-steward-console',
      EXCON_V2_MODE: 'postgres',
      EXCON_JOURNAL_DATABASE_URL: `postgresql://wiser_excon_api:${localSecrets.exconJournalPassword}@host.docker.internal:56322/postgres`,
      EXCON_LEASE_HMAC_KEYS:
        environment['EXCON_LEASE_HMAC_KEYS'] ??
        JSON.stringify(localSecrets.exconLeaseHmacKeys),
      EXCON_TENANT_ID: tenantId,
      EXCON_PROJECT_ID: projectId,
      EXCON_PURPOSE: 'excon-api',
    },
  });
}

if (isDirectExecution(import.meta.url)) {
  await startDataFoundation();
}
