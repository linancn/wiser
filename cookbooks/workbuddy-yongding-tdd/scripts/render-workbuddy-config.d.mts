export type WorkBuddyRoleSlotId =
  | 'water-evidence'
  | 'hydraulic-constraints'
  | 'ecological-target'
  | 'dispatch-coordination';

export interface RenderWorkBuddyRuntimeOptions {
  readonly labManifestPath: string;
  readonly nodeExecutable: string;
  readonly outputDirectory: string;
  readonly repositoryRoot: string;
  readonly workBuddyCli: string;
}

export interface RenderedWorkBuddyRole {
  readonly roleSlotId: WorkBuddyRoleSlotId;
  readonly runAgentId: string;
  readonly mcpConfigPath: string;
  readonly promptPath: string;
  readonly resultPath: string;
  readonly stderrPath: string;
}

export interface RenderedWorkBuddyRuntime {
  readonly schemaVersion: 1;
  readonly profile: 'workbuddy-four-process';
  readonly protocolVersion: 'v2';
  readonly workBuddyCli: string;
  readonly runId: string;
  readonly scenarioVersionId: string;
  readonly roles: readonly RenderedWorkBuddyRole[];
  readonly outputDirectory: string;
  readonly launchManifestPath: string;
}

export function renderWorkBuddyRuntime(
  options: RenderWorkBuddyRuntimeOptions,
): Promise<RenderedWorkBuddyRuntime>;
