import { buildApp } from './app.js';
import { StaticParticipantAuthenticator } from './auth.js';
import { InMemoryExerciseService } from './in-memory-service.js';
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

function participantToken(environment: NodeJS.ProcessEnv): string {
  const configured = environment['AGENT_EXCON_PARTICIPANT_TOKEN'];
  if (configured !== undefined && configured.trim() !== '') return configured;
  if (environment['NODE_ENV'] === 'production') {
    throw new ExerciseServiceError(
      'NOT_AUTHORIZED',
      '生产环境必须配置 AGENT_EXCON_PARTICIPANT_TOKEN。 / AGENT_EXCON_PARTICIPANT_TOKEN is required in production.',
    );
  }
  return 'local-demo-participant-token';
}

function participantVersionId(environment: NodeJS.ProcessEnv): string {
  return (
    environment['AGENT_EXCON_PARTICIPANT_VERSION_ID'] ??
    '40000000-0000-4000-8000-000000000001'
  );
}

async function main(): Promise<void> {
  const token = participantToken(process.env);
  const origins = process.env['API_CORS_ORIGIN']
    ?.split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  const app = buildApp({
    // Demo-only walking slice. Replace this adapter with PostgreSQL in durable deployments.
    service: new InMemoryExerciseService(),
    authenticator: new StaticParticipantAuthenticator({
      [token]: {
        id: 'local-demo-participant',
        participantVersionIds: [participantVersionId(process.env)],
      },
    }),
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
