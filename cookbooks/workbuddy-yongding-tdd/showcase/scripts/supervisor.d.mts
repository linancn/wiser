import type {
  RunWorkBuddyCookbookOptions,
  WorkBuddyCookbookReport,
} from '../../scripts/run-cookbook.mjs';

export type ShowcaseProfile = 'scripted' | 'rework' | 'workbuddy';

export interface ShowcaseOptions {
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly maxTurns?: number;
  readonly profile: ShowcaseProfile;
  readonly repositoryRoot: string;
  readonly stateDirectory: string;
  readonly timeoutMs?: number;
  readonly ttlMs?: number;
  readonly workBuddyCli?: string;
}

export interface ShowcaseSession {
  readonly schemaVersion: 1;
  readonly state:
    | 'STARTING'
    | 'RUNNING'
    | 'COMPLETED'
    | 'FAILED'
    | 'STOPPING'
    | 'STOPPED'
    | 'EXPIRED';
  readonly profile: ShowcaseProfile;
  readonly runId: string | null;
  readonly webUrl: string | null;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly reportPath: string | null;
  readonly diagnosticCode: string | null;
  readonly cleanup: {
    readonly childProcessesStopped: boolean;
    readonly credentialsRemoved: boolean;
    readonly mcpConfigsRemoved: boolean;
  };
}

export interface ShowcaseWebHandle {
  readonly pid: number;
  readonly url: string;
  readonly exited?: Promise<{
    readonly exitCode: number | null;
    readonly signal: NodeJS.Signals | null;
  }>;
  stop(reason: string): Promise<void>;
}

export interface ShowcaseDependencies {
  readonly allocatePort?: () => Promise<number>;
  readonly emit?: (value: unknown) => void;
  readonly now?: () => Date;
  readonly preflight?: ShowcasePreflightDependencies;
  readonly runCookbook?: (options: RunWorkBuddyCookbookOptions) => Promise<{
    readonly exitCode: number;
    readonly report?: {
      readonly status?: string;
      readonly diagnostic?: string | null;
    };
    readonly reportPath?: string;
  }>;
  readonly startWeb?: (context: {
    readonly environment: Readonly<Record<string, string>>;
    readonly port: number;
    readonly repositoryRoot: string;
  }) => Promise<ShowcaseWebHandle>;
  readonly waitForWeb?: (url: string) => Promise<void>;
}

export interface ShowcasePreflightDependencies {
  readonly access?: (path: string, mode?: number) => Promise<void>;
  readonly isProcessAlive?: (pid: number) => boolean;
  readonly workBuddyCli?: string;
}

export interface ShowcaseStatusDependencies {
  readonly isProcessAlive?: (pid: number) => boolean;
  readonly probe?: (
    url: string,
  ) => Promise<{ readonly ok: boolean; readonly status: number }>;
}

export interface ShowcaseStopDependencies {
  readonly isProcessAlive?: (pid: number) => boolean;
  readonly killProcess?: (pid: number, signal: NodeJS.Signals) => void;
  readonly pause?: () => Promise<void>;
}

export interface ShowcaseStatus extends ShowcaseSession {
  readonly active: boolean;
  readonly webReachable: boolean;
  readonly webStatus: number | null;
}

export function runShowcasePreflight(
  options: ShowcaseOptions,
  dependencies?: ShowcasePreflightDependencies,
): Promise<{
  readonly ok: boolean;
  readonly profile: ShowcaseProfile;
  readonly checks: readonly {
    readonly id: string;
    readonly ok: boolean;
    readonly detail: string;
  }[];
}>;

export function startShowcaseSupervisor(
  options: ShowcaseOptions,
  dependencies?: ShowcaseDependencies,
): Promise<{
  readonly reason: string;
  readonly report?: WorkBuddyCookbookReport;
  readonly reportPath?: string;
  readonly session: ShowcaseSession;
}>;

export function getShowcaseStatus(
  options: Pick<ShowcaseOptions, 'stateDirectory'>,
  dependencies?: ShowcaseStatusDependencies,
): Promise<
  | ShowcaseStatus
  | {
      readonly active: false;
      readonly state: 'absent';
      readonly webReachable: false;
    }
>;

export function requestShowcaseStop(
  options: Pick<ShowcaseOptions, 'stateDirectory'>,
  dependencies?: ShowcaseStopDependencies,
): Promise<
  | (ShowcaseSession & { readonly signalled: boolean })
  | { readonly state: 'absent'; readonly signalled: false }
>;

export function waitForHttpReady(
  url: string,
  options?: {
    readonly attempts?: number;
    readonly fetcher?: typeof fetch;
    readonly pause?: () => Promise<void>;
  },
): Promise<void>;

export function defaultShowcaseStateDirectory(repositoryRoot: string): string;
