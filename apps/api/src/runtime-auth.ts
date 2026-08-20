import type { ParticipantPrincipal } from './types.js';
import { ExerciseServiceError } from './types.js';

function bearerToken(
  environment: NodeJS.ProcessEnv,
  name: 'AGENT_EXCON_PARTICIPANT_TOKEN' | 'AGENT_EXCON_OPERATOR_TOKEN',
  developmentFallback: string,
): string {
  const configured = environment[name]?.trim();
  if (configured !== undefined && configured.length > 0) return configured;
  if (environment['NODE_ENV'] === 'production') {
    throw new ExerciseServiceError(
      'NOT_AUTHORIZED',
      `生产环境必须配置 ${name}。 / ${name} is required in production.`,
    );
  }
  return developmentFallback;
}

export function runtimePrincipalMap(
  environment: NodeJS.ProcessEnv,
): Readonly<Record<string, ParticipantPrincipal>> {
  const participantToken = bearerToken(
    environment,
    'AGENT_EXCON_PARTICIPANT_TOKEN',
    'local-demo-participant-token',
  );
  const operatorToken = bearerToken(
    environment,
    'AGENT_EXCON_OPERATOR_TOKEN',
    'local-demo-operator-token',
  );
  if (participantToken === operatorToken) {
    throw new ExerciseServiceError(
      'VALIDATION_FAILED',
      '参训者与导调员必须使用不同的 bearer token。 / Participant and operator bearer tokens must be distinct.',
    );
  }

  return {
    [participantToken]: {
      id: 'local-demo-participant',
      participantVersionIds: [
        environment['AGENT_EXCON_PARTICIPANT_VERSION_ID'] ??
          '40000000-0000-4000-8000-000000000001',
      ],
      roles: [],
    },
    [operatorToken]: {
      id: 'local-demo-operator',
      participantVersionIds: [],
      roles: ['operator'],
    },
  };
}
