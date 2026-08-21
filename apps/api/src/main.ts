import { buildApp } from './app.js';
import { StaticParticipantAuthenticator } from './auth.js';
import { InMemoryExerciseService } from './in-memory-service.js';
import { createPlatformAuthModuleFromEnvironment } from './platform/auth-runtime.js';
import { runtimePrincipalMap } from './runtime-auth.js';
import { ExerciseServiceError } from './types.js';

function port(value: string | undefined): number {
  const parsed = Number(value ?? '3001');
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new ExerciseServiceError(
      'VALIDATION_FAILED',
      'API_PORT 必须是 1–65535 的整数。 / API_PORT must be an integer from 1 to 65535.',
    );
  }
  return parsed;
}

async function main(): Promise<void> {
  const origins = process.env['API_CORS_ORIGIN']
    ?.split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  const platformAuthModule = createPlatformAuthModuleFromEnvironment(
    process.env,
  );
  const app = buildApp({
    // Demo-only walking slice. Replace this adapter with PostgreSQL in durable deployments.
    service: new InMemoryExerciseService(),
    authenticator: new StaticParticipantAuthenticator(
      runtimePrincipalMap(process.env),
    ),
    modules: platformAuthModule === null ? [] : [platformAuthModule],
    ...(origins === undefined || origins.length === 0
      ? {}
      : { corsOrigin: origins }),
  });
  let closing = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (closing) return;
    closing = true;
    app.log.info({ signal }, 'graceful shutdown started');
    await app.close();
  };
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  await app.listen({
    host: process.env['API_HOST'] ?? '0.0.0.0',
    port: port(process.env['API_PORT']),
  });
  app.log.warn(
    'using the demo/test in-memory exercise service; episode state is not durable',
  );
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
