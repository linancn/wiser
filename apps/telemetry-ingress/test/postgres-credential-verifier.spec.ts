import { describe, expect, it } from 'vitest';

import {
  PostgresTelemetryCredentialVerifier,
  type TelemetryCredentialQuery,
} from '../src/index.js';

class RecordingDatabase implements TelemetryCredentialQuery {
  readonly calls: Array<{ text: string; values: readonly unknown[] }> = [];
  rows: readonly Record<string, unknown>[] = [];

  query<T>(
    text: string,
    values: readonly unknown[],
  ): Promise<{ readonly rows: readonly T[] }> {
    this.calls.push({ text, values });
    return Promise.resolve({ rows: this.rows as readonly T[] });
  }
}

describe('Postgres telemetry credential verification', () => {
  it('queries by a peppered token hash and enforces active telemetry scope', async () => {
    const database = new RecordingDatabase();
    database.rows = [
      {
        credential_id: '5c000000-0000-4000-8000-000000000001',
        run_id: '51000000-0000-4000-8000-000000000001',
        run_agent_id: '53000000-0000-4000-8000-000000000001',
        role_key: 'water-evidence',
      },
    ];
    const verifier = new PostgresTelemetryCredentialVerifier({
      database,
      pepper: 'test-only-pepper-with-enough-entropy',
    });
    const rawToken = 'opaque-participant-token-that-must-not-enter-sql';

    await expect(verifier.authenticate(rawToken)).resolves.toEqual({
      credentialId: '5c000000-0000-4000-8000-000000000001',
      runId: '51000000-0000-4000-8000-000000000001',
      runAgentId: '53000000-0000-4000-8000-000000000001',
      role: 'water-evidence',
    });
    expect(database.calls).toHaveLength(1);
    const call = database.calls[0];
    expect(call).toBeDefined();
    if (!call) throw new Error('expected one database call');
    expect(call.text).toContain("'telemetry:write' = any");
    expect(call.text).toContain('credential.revoked_at is null');
    expect(call.text).toContain("agent_identity.lifecycle_state = 'active'");
    const digest = call.values[0];
    expect(digest).toBeInstanceOf(Buffer);
    expect(digest).not.toBe(rawToken);
    expect((digest as Buffer).byteLength).toBe(32);
  });

  it('returns null for an unknown hash and refuses a weak pepper', async () => {
    const database = new RecordingDatabase();
    const verifier = new PostgresTelemetryCredentialVerifier({
      database,
      pepper: 'test-only-pepper-with-enough-entropy',
    });
    await expect(
      verifier.authenticate('unknown-token-with-enough-entropy'),
    ).resolves.toBeNull();
    expect(
      () =>
        new PostgresTelemetryCredentialVerifier({
          database,
          pepper: 'short',
        }),
    ).toThrow(/at least 16/);
  });
});
