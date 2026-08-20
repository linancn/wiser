export type TelemetrySignal = 'traces' | 'metrics' | 'logs';

export interface TelemetryPrincipal {
  readonly credentialId: string;
  readonly runId: string;
  readonly runAgentId: string;
  readonly role?: string;
}

export interface TelemetryCredentialVerifier {
  authenticate(token: string): Promise<TelemetryPrincipal | null>;
}

export interface TelemetryForwarder {
  forward(signal: TelemetrySignal, body: unknown): Promise<void>;
}
