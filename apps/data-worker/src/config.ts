import type { DataJobScope } from '@wiser/data-infra';

export interface DataWorkerRuntimeConfig {
  readonly databaseUrl: string;
  readonly scope: DataJobScope;
  readonly workerId: string;
  readonly claimLimit: number;
  readonly leaseMs: number;
  readonly heartbeatIntervalMs: number;
  readonly pollIntervalMs: number;
  readonly healthHost: string;
  readonly healthPort: number;
  readonly deprecatedAliases: readonly string[];
}

interface ResolvedValue {
  readonly value: string | undefined;
  readonly alias?: string;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SECURITY_LEVELS = new Set<DataJobScope['maxSecurityLevel']>([
  'L0_PUBLIC',
  'L1_INTERNAL',
  'L2_RESTRICTED',
  'L3_CONFIDENTIAL',
]);

function invalid(name: string): Error {
  return new Error(`Invalid Data Worker configuration: ${name}.`);
}

function resolveValue(
  environment: Readonly<Record<string, string | undefined>>,
  canonical: string,
  aliases: readonly string[] = [],
): ResolvedValue {
  if (environment[canonical] !== undefined) {
    return { value: environment[canonical] };
  }
  for (const alias of aliases) {
    if (environment[alias] !== undefined) {
      return { value: environment[alias], alias };
    }
  }
  return { value: undefined };
}

function required(value: ResolvedValue, name: string): string {
  if (value.value === undefined || value.value.length === 0)
    throw invalid(name);
  return value.value;
}

function integer(
  value: ResolvedValue,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (value.value === undefined) return fallback;
  const parsed = Number(value.value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw invalid(name);
  }
  return parsed;
}

function postgresUrl(value: string): string {
  try {
    const url = new URL(value);
    if (
      (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') ||
      url.hostname.length === 0 ||
      url.pathname.length < 2
    ) {
      throw invalid('DATA_DATABASE_URL');
    }
    return value;
  } catch {
    throw invalid('DATA_DATABASE_URL');
  }
}

export function loadDataWorkerConfig(
  environment: Readonly<Record<string, string | undefined>>,
): DataWorkerRuntimeConfig {
  const usedAliases: string[] = [];
  const value = (canonical: string, aliases: readonly string[] = []) => {
    const resolved = resolveValue(environment, canonical, aliases);
    if (resolved.alias !== undefined) usedAliases.push(resolved.alias);
    return resolved;
  };
  const legacyValue = (alias: string): ResolvedValue => {
    const legacy = environment[alias];
    if (legacy !== undefined) usedAliases.push(alias);
    return { value: legacy };
  };

  const databaseUrl = postgresUrl(
    required(value('DATA_DATABASE_URL'), 'DATA_DATABASE_URL'),
  );
  const tenantId = required(
    value('DATA_TENANT_ID', ['WISER_DATA_TENANT_ID']),
    'DATA_TENANT_ID',
  );
  const projectId = required(
    value('DATA_PROJECT_ID', ['WISER_DATA_PROJECT_ID']),
    'DATA_PROJECT_ID',
  );
  if (!UUID_PATTERN.test(tenantId)) throw invalid('DATA_TENANT_ID');
  if (!UUID_PATTERN.test(projectId)) throw invalid('DATA_PROJECT_ID');

  const maxSecurityLevel = required(
    value('DATA_MAX_SECURITY_LEVEL', ['WISER_DATA_MAX_SECURITY_LEVEL']),
    'DATA_MAX_SECURITY_LEVEL',
  ) as DataJobScope['maxSecurityLevel'];
  if (!SECURITY_LEVELS.has(maxSecurityLevel)) {
    throw invalid('DATA_MAX_SECURITY_LEVEL');
  }
  const policyVersion = integer(
    value('DATA_POLICY_VERSION', ['WISER_DATA_POLICY_VERSION']),
    'DATA_POLICY_VERSION',
    1,
    1,
    Number.MAX_SAFE_INTEGER,
  );
  const workerId = required(
    value('DATA_WORKER_ID', ['WISER_DATA_WORKER_ID']),
    'DATA_WORKER_ID',
  );
  if (
    workerId.length > 128 ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(workerId)
  ) {
    throw invalid('DATA_WORKER_ID');
  }

  const claimLimit = integer(
    value('DATA_WORKER_CLAIM_LIMIT', ['WISER_DATA_CLAIM_LIMIT']),
    'DATA_WORKER_CLAIM_LIMIT',
    8,
    1,
    1_000,
  );
  const canonicalLeaseSeconds = value('DATA_JOB_LEASE_SECONDS');
  const legacyLeaseMs =
    canonicalLeaseSeconds.value === undefined
      ? legacyValue('WISER_DATA_LEASE_MS')
      : { value: undefined };
  const leaseMs =
    canonicalLeaseSeconds.value !== undefined
      ? integer(
          canonicalLeaseSeconds,
          'DATA_JOB_LEASE_SECONDS',
          120,
          1,
          86_400,
        ) * 1_000
      : integer(
          legacyLeaseMs,
          'DATA_JOB_LEASE_SECONDS',
          120_000,
          1,
          86_400_000,
        );
  const canonicalHeartbeatSeconds = value('DATA_JOB_HEARTBEAT_SECONDS');
  const legacyHeartbeatMs =
    canonicalHeartbeatSeconds.value === undefined
      ? legacyValue('WISER_DATA_HEARTBEAT_MS')
      : { value: undefined };
  const heartbeatIntervalMs =
    canonicalHeartbeatSeconds.value !== undefined
      ? integer(
          canonicalHeartbeatSeconds,
          'DATA_JOB_HEARTBEAT_SECONDS',
          30,
          1,
          86_400,
        ) * 1_000
      : integer(
          legacyHeartbeatMs,
          'DATA_JOB_HEARTBEAT_SECONDS',
          30_000,
          1,
          86_400_000,
        );
  if (heartbeatIntervalMs >= leaseMs) {
    throw invalid('DATA_JOB_HEARTBEAT_SECONDS');
  }
  const pollIntervalMs = integer(
    value('DATA_JOB_POLL_INTERVAL_MS', ['WISER_DATA_POLL_MS']),
    'DATA_JOB_POLL_INTERVAL_MS',
    1_000,
    1,
    60_000,
  );
  const healthHost = value('DATA_WORKER_HEALTH_HOST').value ?? '0.0.0.0';
  if (
    healthHost.length > 253 ||
    !/^[A-Za-z0-9][A-Za-z0-9.-]*$/.test(healthHost)
  ) {
    throw invalid('DATA_WORKER_HEALTH_HOST');
  }
  const healthPort = integer(
    value('DATA_WORKER_HEALTH_PORT', ['DATA_WORKER_PORT']),
    'DATA_WORKER_HEALTH_PORT',
    3_003,
    1,
    65_535,
  );

  return {
    databaseUrl,
    scope: { tenantId, projectId, maxSecurityLevel, policyVersion },
    workerId,
    claimLimit,
    leaseMs,
    heartbeatIntervalMs,
    pollIntervalMs,
    healthHost,
    healthPort,
    deprecatedAliases: [...new Set(usedAliases)].sort(),
  };
}
