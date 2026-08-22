import { pathToFileURL } from 'node:url';

import type { FastifyInstance } from 'fastify';

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
import {
  registerWiserApiModules,
  type WiserApiModule,
} from './platform/modules.js';
import {
  PlatformParticipantAuthenticator,
  loadPlatformParticipantContext,
} from './platform/participant-authenticator.js';
import { runtimePrincipalMap } from './runtime-auth.js';
import {
  ExerciseServiceError,
  type ParticipantAuthenticator,
} from './types.js';
import {
  createV2RuntimeFromEnvironment,
  type V2Runtime,
} from './v2-runtime.js';

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

export interface DefaultApiModuleFactories {
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

export interface DefaultApiRuntimeFactories extends DefaultApiModuleFactories {
  createV2Runtime?(environment: NodeJS.ProcessEnv): Promise<V2Runtime>;
}

const defaultRuntimeFactories: DefaultApiRuntimeFactories = {
  createPlatformAuthRuntime: createPlatformAuthRuntimeFromEnvironment,
  createDataFoundationRuntime: createDataFoundationRuntimeFromEnvironment,
  createV2Runtime: createV2RuntimeFromEnvironment,
};

export function createDefaultApiModules(
  environment: NodeJS.ProcessEnv,
  factories: DefaultApiModuleFactories = defaultRuntimeFactories,
): readonly WiserApiModule[] {
  const platformAuth = factories.createPlatformAuthRuntime(environment);
  const data = factories.createDataFoundationRuntime(environment, platformAuth);
  return Object.freeze([
    ...(platformAuth.module === null ? [] : [platformAuth.module]),
    ...data.modules,
  ]);
}

function corsOrigins(
  environment: NodeJS.ProcessEnv,
): readonly string[] | undefined {
  const origins = environment['API_CORS_ORIGIN']
    ?.split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  return origins === undefined || origins.length === 0 ? undefined : origins;
}

function participantAuthenticator(
  environment: NodeJS.ProcessEnv,
  platformAuth: PlatformAuthRuntime,
): ParticipantAuthenticator {
  if (platformAuth.resolver === null) {
    const authMode =
      environment['WISER_AUTH_MODE'] ??
      (environment['NODE_ENV'] === 'production' ? 'supabase' : 'off');
    if (authMode !== 'off' || platformAuth.module !== null) {
      throw new Error(
        'Agent EXCON requires unified Auth when platform Auth is enabled.',
      );
    }
    return new StaticParticipantAuthenticator(runtimePrincipalMap(environment));
  }
  return new PlatformParticipantAuthenticator({
    resolver: platformAuth.resolver,
    context: loadPlatformParticipantContext(environment),
  });
}

async function closeBeforeAppComposition(
  platformAuth: PlatformAuthRuntime | null,
  v2Runtime: V2Runtime,
): Promise<void> {
  if (platformAuth === null || platformAuth.module === null) {
    await v2Runtime.service.close().catch(() => undefined);
    return;
  }
  try {
    const cleanupApp = buildApp({
      logger: false,
      service: new InMemoryExerciseService(),
      v2Service: v2Runtime.service,
      authenticator: new StaticParticipantAuthenticator({}),
      modules: Object.freeze([platformAuth.module]),
    });
    await cleanupApp.close();
  } catch {
    await v2Runtime.service.close().catch(() => undefined);
  }
}

export async function createDefaultApiApp(
  environment: NodeJS.ProcessEnv,
  factories: DefaultApiRuntimeFactories = defaultRuntimeFactories,
): Promise<FastifyInstance> {
  const v2Runtime = await (factories.createV2Runtime === undefined
    ? createV2RuntimeFromEnvironment(environment)
    : factories.createV2Runtime(environment));
  let app: FastifyInstance | null = null;
  let platformAuth: PlatformAuthRuntime | null = null;
  try {
    platformAuth = factories.createPlatformAuthRuntime(environment);
    const authenticator = participantAuthenticator(environment, platformAuth);
    const origins = corsOrigins(environment);
    app = buildApp({
      logger: environment['NODE_ENV'] !== 'test',
      service: new InMemoryExerciseService(),
      v2Service: v2Runtime.service,
      authenticator,
      modules:
        platformAuth.module === null
          ? []
          : Object.freeze([platformAuth.module]),
      ...(origins === undefined ? {} : { corsOrigin: origins }),
    });

    const data = factories.createDataFoundationRuntime(
      environment,
      platformAuth,
    );
    registerWiserApiModules(app, data.modules);
    await app.ready();
    return app;
  } catch (error) {
    if (app === null) {
      await closeBeforeAppComposition(platformAuth, v2Runtime);
    } else {
      await app.close().catch(() => undefined);
    }
    throw error;
  }
}

export async function main(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const app = await createDefaultApiApp(environment);
  let closing = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (closing) return;
    closing = true;
    app.log.info({ signal }, 'graceful shutdown started');
    await app.close();
  };
  try {
    await app.listen({
      host: environment['API_HOST'] ?? '0.0.0.0',
      port: port(environment['API_PORT']),
    });
    process.once('SIGINT', () => void shutdown('SIGINT'));
    process.once('SIGTERM', () => void shutdown('SIGTERM'));
    app.log.warn(
      'using the demo/test in-memory v1 exercise compatibility service; v1 episode state is not durable',
    );
  } catch (error) {
    await app.close().catch(() => undefined);
    throw error;
  }
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
