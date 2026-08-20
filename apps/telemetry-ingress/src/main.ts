import { Pool } from 'pg';

import { buildTelemetryIngress } from './app.js';
import { OtlpHttpForwarder } from './forwarder.js';
import { PostgresTelemetryCredentialVerifier } from './postgres-credential-verifier.js';
import type {
  TelemetryCredentialVerifier,
  TelemetryPrincipal,
} from './types.js';

class StaticLocalCredentialVerifier implements TelemetryCredentialVerifier {
  constructor(
    private readonly token: string,
    private readonly principal: TelemetryPrincipal,
  ) {}

  authenticate(candidate: string): Promise<TelemetryPrincipal | null> {
    return Promise.resolve(candidate === this.token ? this.principal : null);
  }
}

const localToken = process.env['WISER_TELEMETRY_LOCAL_TOKEN'];
const databaseUrl = process.env['DATABASE_URL'];
const tokenPepper = process.env['WISER_TELEMETRY_TOKEN_PEPPER'];
let pool: Pool | undefined;
let credentialVerifier: TelemetryCredentialVerifier;

if (localToken !== undefined) {
  const runId = process.env['WISER_TELEMETRY_LOCAL_RUN_ID'];
  const runAgentId = process.env['WISER_TELEMETRY_LOCAL_RUN_AGENT_ID'];
  if (
    localToken.length < 32 ||
    runId === undefined ||
    runAgentId === undefined
  ) {
    throw new Error(
      'Local telemetry mode requires a 32+ character token, Run ID, and RunAgent ID.',
    );
  }
  credentialVerifier = new StaticLocalCredentialVerifier(localToken, {
    credentialId: 'local-telemetry-credential',
    runId,
    runAgentId,
    ...(process.env['WISER_TELEMETRY_LOCAL_ROLE'] === undefined
      ? {}
      : { role: process.env['WISER_TELEMETRY_LOCAL_ROLE'] }),
  });
} else {
  if (databaseUrl === undefined || tokenPepper === undefined) {
    throw new Error(
      'DATABASE_URL and WISER_TELEMETRY_TOKEN_PEPPER are required outside local demo mode.',
    );
  }
  pool = new Pool({ connectionString: databaseUrl, max: 5 });
  credentialVerifier = new PostgresTelemetryCredentialVerifier({
    database: pool,
    pepper: tokenPepper,
  });
}

const app = buildTelemetryIngress({
  credentialVerifier,
  forwarder: new OtlpHttpForwarder({
    endpoint:
      process.env['OTEL_COLLECTOR_INTERNAL_URL'] ?? 'http://127.0.0.1:4318',
  }),
});
const port = Number(process.env['TELEMETRY_INGRESS_PORT'] ?? 3003);
const host = process.env['TELEMETRY_INGRESS_HOST'] ?? '127.0.0.1';

await app.listen({ host, port });

async function shutdown(): Promise<void> {
  await app.close();
  await pool?.end();
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void shutdown().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  });
}
