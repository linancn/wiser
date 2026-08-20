import { yongdingScenario } from './scenario';

export interface ExerciseSession {
  id: string;
  source: 'api' | 'fixture';
  scenarioId: string;
  status:
    | 'waiting_for_submission'
    | 'evaluation_queued'
    | 'evaluating'
    | 'feedback_available'
    | 'completed';
  virtualTime: string;
  currentEventSequence: number;
}

const demoFixture: ExerciseSession = {
  id: 'demo-session',
  source: 'fixture',
  scenarioId: yongdingScenario.id,
  status: 'feedback_available',
  virtualTime: 'T+12:00',
  currentEventSequence: 4,
};

interface ExerciseClientOptions {
  baseUrl?: '/api/v1';
  signal?: AbortSignal;
}

export function createExerciseClient(options: ExerciseClientOptions = {}) {
  const baseUrl = options.baseUrl ?? '/api/v1';

  return {
    async getSession(id: string): Promise<ExerciseSession> {
      try {
        const response = await fetch(
          `${baseUrl}/episodes/${encodeURIComponent(id)}`,
          {
            headers: { Accept: 'application/json' },
            signal: options.signal,
          },
        );

        if (!response.ok) return demoFixture;

        const payload = (await response.json()) as {
          episode: {
            id: string;
            scenarioVersionId: string;
            state: ExerciseSession['status'];
            virtualTime: string;
            version: number;
          };
        };
        return {
          id: payload.episode.id,
          source: 'api',
          scenarioId: payload.episode.scenarioVersionId,
          status: payload.episode.state,
          virtualTime: payload.episode.virtualTime,
          currentEventSequence: payload.episode.version,
        };
      } catch {
        return demoFixture;
      }
    },
  };
}

export { demoFixture };
