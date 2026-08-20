import { rm } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

import type { FastifyInstance } from 'fastify';

import { buildApp } from './app.js';
import { ExerciseServiceError } from './types.js';
import {
  writeV2LocalLabRuntimeBundle,
  type LocalLabRuntimeBundle,
} from './v2-local-lab-runtime.js';
import {
  createV2LocalLab,
  type CreateV2LocalLabOptions,
  type V2LocalLab,
} from './v2-local-lab.js';

export interface V2LocalLabServerConfig {
  readonly host: '127.0.0.1';
  readonly port: number;
  readonly apiBaseUrl: string;
  readonly runtimeDirectory: string;
}

export interface StartV2LocalLabServerOptions extends CreateV2LocalLabOptions {
  readonly config: V2LocalLabServerConfig;
}

export interface V2LocalLabServer {
  readonly app: FastifyInstance;
  readonly lab: V2LocalLab;
  readonly bundle: LocalLabRuntimeBundle;
  close(): Promise<void>;
}

function validationError(message: string): ExerciseServiceError {
  return new ExerciseServiceError('VALIDATION_FAILED', message);
}

export function resolveV2LocalLabServerConfig(
  environment: NodeJS.ProcessEnv = process.env,
): V2LocalLabServerConfig {
  if (environment['NODE_ENV'] === 'production') {
    throw validationError(
      '本地四智能体 Lab 不能在 production 启动。 / The local four-agent lab cannot run in production.',
    );
  }
  const host = environment['WISER_LAB_API_HOST'] ?? '127.0.0.1';
  if (host !== '127.0.0.1') {
    throw validationError(
      'WISER_LAB_API_HOST 必须是 127.0.0.1。 / WISER_LAB_API_HOST must be 127.0.0.1.',
    );
  }
  const port = Number(environment['WISER_LAB_API_PORT'] ?? '3101');
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw validationError(
      'WISER_LAB_API_PORT 必须是 1–65535 的整数。 / WISER_LAB_API_PORT must be an integer from 1 to 65535.',
    );
  }
  const runtimeDirectory = environment['WISER_LAB_RUNTIME_DIR'];
  if (runtimeDirectory === undefined || !isAbsolute(runtimeDirectory)) {
    throw validationError(
      'WISER_LAB_RUNTIME_DIR 必须是显式绝对路径。 / WISER_LAB_RUNTIME_DIR must be an explicit absolute path.',
    );
  }
  return {
    host,
    port,
    apiBaseUrl: `http://${host}:${port}/api/v2/`,
    runtimeDirectory,
  };
}

export async function startV2LocalLabServer(
  options: StartV2LocalLabServerOptions,
): Promise<V2LocalLabServer> {
  const lab = await createV2LocalLab(options);
  const bundle = await writeV2LocalLabRuntimeBundle(lab, {
    apiBaseUrl: options.config.apiBaseUrl,
    runtimeDirectory: options.config.runtimeDirectory,
  });
  const app = buildApp({
    logger: false,
    v2Service: lab.v2Service,
    authenticator: lab.authenticator,
  });
  try {
    await app.listen({ host: options.config.host, port: options.config.port });
  } catch (error) {
    await Promise.allSettled([
      app.close(),
      rm(options.config.runtimeDirectory, { force: true, recursive: true }),
    ]);
    throw error;
  }

  let closed = false;
  return {
    app,
    lab,
    bundle,
    async close() {
      if (closed) return;
      closed = true;
      await app.close();
      await rm(join(options.config.runtimeDirectory, 'credentials'), {
        force: true,
        recursive: true,
      });
    },
  };
}
