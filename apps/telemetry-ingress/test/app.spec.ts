import { afterEach, describe, expect, it } from 'vitest';

import {
  buildTelemetryIngress,
  type TelemetryCredentialVerifier,
  type TelemetryForwarder,
  type TelemetryPrincipal,
  type TelemetrySignal,
} from '../src/index.js';

const token = 'participant-telemetry-token-with-enough-entropy';
const principal: TelemetryPrincipal = {
  credentialId: '5c000000-0000-4000-8000-000000000001',
  runId: '51000000-0000-4000-8000-000000000001',
  runAgentId: '53000000-0000-4000-8000-000000000001',
  role: 'water-evidence',
};

class StaticVerifier implements TelemetryCredentialVerifier {
  authenticate(candidate: string): Promise<TelemetryPrincipal | null> {
    return Promise.resolve(candidate === token ? principal : null);
  }
}

class RecordingForwarder implements TelemetryForwarder {
  readonly calls: Array<{ signal: TelemetrySignal; body: unknown }> = [];
  error: Error | undefined;

  forward(signal: TelemetrySignal, body: unknown): Promise<void> {
    if (this.error !== undefined) return Promise.reject(this.error);
    this.calls.push({ signal, body });
    return Promise.resolve();
  }
}

const closeCallbacks: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(closeCallbacks.splice(0).map((close) => close()));
});

function traceEnvelope(attributes: unknown[] = []) {
  return {
    resourceSpans: [
      {
        resource: {
          attributes: [
            {
              key: 'service.name',
              value: { stringValue: 'spoofed-excon-service' },
            },
            {
              key: 'wiser.exercise.run.id',
              value: { stringValue: 'spoofed-run' },
            },
            ...attributes,
          ],
        },
        scopeSpans: [
          {
            scope: { name: 'participant-runtime' },
            spans: [
              {
                traceId: 'a84719d8276348f59a6184c1b51d3001',
                spanId: 'a000000000000001',
                name: 'invoke_agent water-evidence',
                startTimeUnixNano: '1787216400000000000',
                endTimeUnixNano: '1787216400100000000',
                attributes: [
                  {
                    key: 'wiser.agent.session.id',
                    value: { stringValue: 'spoofed-span-agent' },
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
}

function app(options: { maxRequestsPerMinute?: number } = {}) {
  const forwarder = new RecordingForwarder();
  const instance = buildTelemetryIngress({
    credentialVerifier: new StaticVerifier(),
    forwarder,
    logger: false,
    ...options,
  });
  closeCallbacks.push(() => instance.close());
  return { instance, forwarder };
}

describe('authenticated participant OTLP ingress', () => {
  it('rejects missing or invalid bearer credentials without forwarding', async () => {
    const { instance, forwarder } = app();
    for (const authorization of [undefined, 'Bearer invalid-token']) {
      const response = await instance.inject({
        method: 'POST',
        url: '/v1/traces',
        ...(authorization === undefined ? {} : { headers: { authorization } }),
        payload: traceEnvelope(),
      });
      expect(response.statusCode).toBe(401);
      expect(response.json()).toMatchObject({
        error: { code: 'TELEMETRY_NOT_AUTHORIZED' },
      });
    }
    expect(forwarder.calls).toEqual([]);
  });

  it('overwrites spoofable identity attributes and forwards standard OTLP JSON', async () => {
    const { instance, forwarder } = app();
    const response = await instance.inject({
      method: 'POST',
      url: '/v1/traces',
      headers: { authorization: `Bearer ${token}` },
      payload: traceEnvelope(),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ partialSuccess: {} });
    expect(response.headers['x-wiser-accepted-records']).toBe('1');
    expect(forwarder.calls).toHaveLength(1);
    expect(forwarder.calls[0]?.signal).toBe('traces');
    const forwarded = JSON.stringify(forwarder.calls[0]?.body);
    expect(forwarded).not.toContain('spoofed-excon-service');
    expect(forwarded).not.toContain('spoofed-run');
    expect(forwarded).not.toContain('spoofed-span-agent');
    for (const expected of [
      principal.runId,
      principal.runAgentId,
      'wiser-participant-agent',
      'wiser.participant',
      'participant_exporter',
      'participant_reported',
      principal.role,
    ]) {
      expect(forwarded).toContain(expected);
    }
  });

  it('rejects sensitive GenAI/tool/outcome attributes before the Collector', async () => {
    const { instance, forwarder } = app();
    for (const key of [
      'gen_ai.prompt',
      'gen_ai.output.messages',
      'tool.arguments',
      'wiser.hidden.outcome',
      'GEN_AI.PROMPT',
    ]) {
      const response = await instance.inject({
        method: 'POST',
        url: '/v1/traces',
        headers: { authorization: `Bearer ${token}` },
        payload: traceEnvelope([
          { key, value: { stringValue: 'must-not-cross-ingress' } },
        ]),
      });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        error: { code: 'TELEMETRY_SENSITIVE_CONTENT' },
      });
    }
    expect(forwarder.calls).toEqual([]);
  });

  it('enforces per-credential request quotas', async () => {
    const { instance, forwarder } = app({ maxRequestsPerMinute: 1 });
    const request = {
      method: 'POST' as const,
      url: '/v1/traces',
      headers: { authorization: `Bearer ${token}` },
      payload: traceEnvelope(),
    };
    expect((await instance.inject(request)).statusCode).toBe(200);
    const limited = await instance.inject(request);
    expect(limited.statusCode).toBe(429);
    expect(limited.headers['retry-after']).toBeDefined();
    expect(forwarder.calls).toHaveLength(1);
  });

  it('returns a safe unavailable error when the internal Collector fails', async () => {
    const { instance, forwarder } = app();
    forwarder.error = new Error(
      'collector internal address and secret details',
    );
    const response = await instance.inject({
      method: 'POST',
      url: '/v1/traces',
      headers: { authorization: `Bearer ${token}` },
      payload: traceEnvelope(),
    });
    expect(response.statusCode).toBe(503);
    expect(response.body).not.toContain('internal address');
    expect(response.json()).toMatchObject({
      error: { code: 'TELEMETRY_COLLECTOR_UNAVAILABLE' },
    });
  });
});
