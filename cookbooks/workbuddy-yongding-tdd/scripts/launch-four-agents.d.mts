import type { WorkBuddyRoleSlotId } from './render-workbuddy-config.mjs';

export interface LaunchWorkBuddyRolesOptions {
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly launchManifestPath: string;
  readonly maxOutputBytes?: number;
  readonly maxTurns?: number;
  readonly mode: 'fake' | 'workbuddy';
  readonly repositoryRoot: string;
  readonly timeoutMs?: number;
}

export interface WorkBuddyRoleResult {
  readonly roleSlotId: WorkBuddyRoleSlotId;
  readonly runAgentId: string;
  readonly status: 'completed' | 'blocked' | 'failed';
  readonly lastReceiptSeq: number | null;
  readonly submissionId: string | null;
  readonly summary: string;
  readonly processExitCode: number | null;
  readonly processSignal: NodeJS.Signals | null;
  readonly semanticSuccess: boolean;
  readonly sessionId: string | null;
  readonly diagnostic: string | null;
}

export interface WorkBuddyLaunchReport {
  readonly schemaVersion: 1;
  readonly profile: 'scripted-ci' | 'workbuddy-live-tdd';
  readonly protocolVersion: 'v2';
  readonly runId: string;
  readonly scenarioVersionId: string;
  readonly status: 'passed' | 'failed';
  readonly results: readonly WorkBuddyRoleResult[];
}

export interface WorkBuddyLaunchCommand {
  readonly roleSlotId: WorkBuddyRoleSlotId;
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
}

export interface WorkBuddyLaunchResult {
  readonly exitCode: 0 | 1;
  readonly report: WorkBuddyLaunchReport;
  readonly reportPath: string;
  readonly commands: readonly WorkBuddyLaunchCommand[];
}

export function launchWorkBuddyRoles(
  options: LaunchWorkBuddyRolesOptions,
): Promise<WorkBuddyLaunchResult>;
