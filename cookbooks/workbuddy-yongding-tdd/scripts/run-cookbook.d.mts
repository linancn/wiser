import type { WorkBuddyLaunchReport } from './launch-four-agents.mjs';

export interface RunWorkBuddyCookbookOptions {
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly faultInjection?: 'water-evidence-schema-once';
  readonly maxTurns?: number;
  readonly mode: 'scripted' | 'workbuddy';
  readonly outputDirectory: string;
  readonly repositoryRoot: string;
  readonly timeoutMs?: number;
  readonly workBuddyCli?: string;
  readonly onLabReady?: (context: {
    readonly apiBaseUrl: string;
    readonly operatorToken: string;
    readonly runId: string;
    readonly scenarioVersionId: string;
    readonly roster: readonly {
      readonly roleSlotId: string;
      readonly runAgentId: string;
      readonly agentVersionId: string;
      readonly instanceKey: string;
    }[];
  }) => void | Promise<void>;
  readonly onObservationReady?: (context: {
    readonly evaluations: WorkBuddyCookbookReport['authoritative']['evaluations'];
    readonly events: {
      readonly eventCount: number;
      readonly lastRunSeq: number | null;
      readonly releasedBarriers: readonly string[];
    };
    readonly interactions: WorkBuddyCookbookReport['authoritative']['interactions'];
    readonly participantResults: WorkBuddyLaunchReport['results'];
    readonly runId: string;
  }) => void | Promise<void>;
}

export interface WorkBuddyCookbookReport {
  readonly schemaVersion: 1;
  readonly cookbookId: 'workbuddy-yongding-four-agent-tdd';
  readonly profile: 'scripted-ci' | 'workbuddy-live-tdd';
  readonly protocolVersion: 'v2';
  readonly status: 'passed' | 'failed';
  readonly runId: string | null;
  readonly scenarioVersionId: string | null;
  readonly participantResults: WorkBuddyLaunchReport['results'];
  readonly authoritative: {
    readonly evaluations: readonly {
      readonly evaluationId: string;
      readonly roleSlotId: string;
      readonly targetScope: string;
      readonly verdict: string;
      readonly issueCodes: readonly string[];
      readonly submissionId: string;
      readonly deterministic: boolean;
      readonly evaluatorVersion: string;
      readonly createdRunSeq: number;
      readonly createdAt: string;
    }[];
    readonly releasedBarriers: readonly string[];
    readonly eventCount: number;
    readonly lastRunSeq: number | null;
    readonly interactions: {
      readonly interactionCount: number;
      readonly handoffCount: number;
      readonly requestCount: number;
      readonly responseCount: number;
      readonly openRequestCount: number;
      readonly acknowledgedDeliveryCount: number;
    };
  };
  readonly tddCycle: {
    readonly injectedFault: 'water-evidence-schema-once' | null;
    readonly reworkObserved: boolean;
    readonly greenAccepted: boolean;
  };
  readonly artifacts: {
    readonly participantReport: string | null;
    readonly roleResultsDirectory: string;
    readonly rolePromptsDirectory: string;
  };
  readonly diagnostic: string | null;
}

export function runWorkBuddyCookbook(
  options: RunWorkBuddyCookbookOptions,
): Promise<{
  readonly exitCode: 0 | 1;
  readonly report: WorkBuddyCookbookReport;
  readonly reportPath: string;
}>;

export function collectOperatorEvents<T extends { readonly runSeq: number }>(
  readPage: (
    after: number,
    limit: number,
  ) => Promise<{ readonly items: readonly T[] }>,
): Promise<{ readonly items: readonly T[] }>;
