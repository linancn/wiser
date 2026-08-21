import { pathToFileURL } from 'node:url';

import { buildApp } from './app.js';
import { StaticParticipantAuthenticator } from './auth.js';
import {
  createDataFoundationRuntimeFromEnvironment,
  type DataFoundationRuntime,
  type DataFoundationRuntimeFactories,
} from './data-foundation/runtime.js';
import { InMemoryExerciseService } from './in-memory-service.js';
import {
  createPlatformAuthRuntimeFromEnvironment,
  type PlatformAuthRuntime,
  type PlatformAuthRuntimeFactories,
} from './platform/auth-runtime.js';
import type { WiserApiModule } from './platform/modules.js';
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

export interface DefaultApiRuntimeFactories {
  createPlatformAuthRuntime(
    environment: NodeJS.ProcessEnv,
    factories?: PlatformAuthRuntimeFactories,
  ): PlatformAuthRuntime;
  createDataFoundationRuntime(
    environment: NodeJS.ProcessEnv,
    platformAuth: PlatformAuthRuntime,
    factories?: DataFoundationRuntimeFactories,
  ): DataFoundationRuntime;
}

const defaultRuntimeFactories: DefaultApiRuntimeFactories = {
  createPlatformAuthRuntime: createPlatformAuthRuntimeFromEnvironment,
  createDataFoundationRuntime: createDataFoundationRuntimeFromEnvironment,
};

export function createDefaultApiModules(
  environment: NodeJS.ProcessEnv,
  factories: DefaultApiRuntimeFactories = defaultRuntimeFactories,
): readonly WiserApiModule[] {
  const platformAuth = factories.createPlatformAuthRuntime(environment);
  const data = factories.createDataFoundationRuntime(environment, platformAuth);
  return Object.freeze([
    ...(platformAuth.module === null ? [] : [platformAuth.module]),
    ...data.modules,
  ]);
}

export async function main(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const origins = environment['API_CORS_ORIGIN']
    ?.split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  const app = buildApp({
    // Demo-only walking slice. Replace this adapter with PostgreSQL in durable deployments.
    service: new InMemoryExerciseService(),
    authenticator: new StaticParticipantAuthenticator(
      runtimePrincipalMap(environment),
    ),
    modules: createDefaultApiModules(environment),
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
    host: environment['API_HOST'] ?? '0.0.0.0',
    port: port(environment['API_PORT']),
  });
  app.log.warn(
    'using the demo/test in-memory exercise service; episode state is not durable',
  );
}

const entrypoint = process.argv[1];
if (
  entrypoint !== undefined &&
  import.meta.url === pathToFileURL(entrypoint).href
) {
  void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  });
}
