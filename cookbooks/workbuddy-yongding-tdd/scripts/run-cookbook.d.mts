import type { WorkBuddyLaunchReport } from './launch-four-agents.mjs';

export interface RunWorkBuddyCookbookOptions {
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly maxTurns?: number;
  readonly mode: 'scripted' | 'workbuddy';
  readonly outputDirectory: string;
  readonly repositoryRoot: string;
  readonly timeoutMs?: number;
  readonly workBuddyCli?: string;
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
