import { describe, expect, it, vi } from 'vitest';

import { OtlpHttpForwarder, type TelemetrySignal } from '../src/index.js';

const SIGNALS: readonly TelemetrySignal[] = ['traces', 'metrics', 'logs'];

const COLLECTOR_INTERNAL_SECRET = 'collector-internal-body-detail';

function otlpBody(signal: TelemetrySignal) {
  return {
    resource: {
      attributes: [
        {
          key: 'service.name',
          value: { stringValue: 'wiser-participant-agent' },
        },
      ],
    },
    signalKind: signal,
  };
}

function collectorFetch(
  handler: (call: {
    readonly url: URL;
    readonly init: RequestInit;
  }) => Response | Promise<Response>,
) {
  const calls: Array<{ readonly url: URL; readonly init: RequestInit }> = [];
  const fetchSpy = vi.fn(
    (input: unknown, init?: RequestInit): Promise<Response> => {
      if (!(input instanceof URL)) {
        throw new Error('expected the forwarder to pass a URL target');
      }
      const call = { url: input, init: init ?? {} };
      calls.push(call);
      return Promise.resolve(handler(call));
    },
  );
  const fetch: typeof globalThis.fetch = fetchSpy;
  return { fetch, calls, fetchSpy };
}

function statusResponse(status: number, body: string | null = null): Response {
  return new Response(body, { status });
}

function forwarder(
  fetch: typeof globalThis.fetch,
  endpoint = 'http://collector.internal:4318',
  timeoutMs?: number,
): OtlpHttpForwarder {
  return new OtlpHttpForwarder({
    endpoint,
    fetch,
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  });
}

describe('OtlpHttpForwarder', () => {
  describe('endpoint construction', () => {
    it.each([
      'ftp://collector.internal:4318',
      'file:///var/run/collector.sock',
    ])('rejects a non-HTTP(S) endpoint %s', (endpoint) => {
      expect(() => new OtlpHttpForwarder({ endpoint })).toThrow(
        /OTLP Collector endpoint must use HTTP\(S\)\./,
      );
    });

    it.each([
      'http://operator:secret@collector.internal:4318',
      'https://access-token@collector.internal',
      'http://collector.internal:4318@spoofed.host',
    ])('rejects an endpoint carrying credentials %s', (endpoint) => {
      expect(() => new OtlpHttpForwarder({ endpoint })).toThrow(
        /OTLP Collector endpoint must not contain credentials\./,
      );
    });

    it('rejects an unparseable endpoint at construction', () => {
      expect(() => new OtlpHttpForwarder({ endpoint: 'not a url' })).toThrow();
    });
  });

  describe('forwarded request shape', () => {
    it.each(SIGNALS)(
      'posts %s as JSON to the versioned OTLP path with an abort signal',
      async (signal) => {
        const body = otlpBody(signal);
        const collector = collectorFetch(() => statusResponse(200));
        const instance = forwarder(collector.fetch);

        await expect(instance.forward(signal, body)).resolves.toBeUndefined();

        expect(collector.fetchSpy).toHaveBeenCalledTimes(1);
        const call = collector.calls[0];
        if (call === undefined) throw new Error('expected one collector call');
        expect(call.url).toBeInstanceOf(URL);
        expect(call.url.href).toBe(
          `http://collector.internal:4318/v1/${signal}`,
        );
        expect(call.init.method).toBe('POST');
        expect(call.init.headers).toEqual({
          'content-type': 'application/json',
        });
        expect(call.init.body).toBe(JSON.stringify(body));
        expect(call.init.signal).toBeInstanceOf(AbortSignal);
        expect(call.init.signal?.aborted).toBe(false);
      },
    );

    it.each([
      [
        'http://collector.internal:4318',
        'http://collector.internal:4318/v1/metrics',
      ],
      [
        'http://collector.internal:4318/',
        'http://collector.internal:4318/v1/metrics',
      ],
      [
        'https://collector.internal/otlp',
        'https://collector.internal/otlp/v1/metrics',
      ],
      [
        'https://collector.internal/otlp/',
        'https://collector.internal/otlp/v1/metrics',
      ],
      [
        'https://collector.internal/otlp/v2',
        'https://collector.internal/otlp/v2/v1/logs',
      ],
    ])(
      'keeps the configured base path for endpoint %s',
      async (endpoint, expectedHref) => {
        const collector = collectorFetch(() => statusResponse(200));
        const instance = forwarder(collector.fetch, endpoint);
        const signal: TelemetrySignal = /logs$/.test(expectedHref)
          ? 'logs'
          : 'metrics';

        await instance.forward(signal, otlpBody(signal));

        expect(collector.calls[0]?.url.href).toBe(expectedHref);
      },
    );
  });

  describe('collector responses', () => {
    it.each([200, 201, 204, 299])('accepts HTTP %i', async (status) => {
      const collector = collectorFetch(() => statusResponse(status));
      const instance = forwarder(collector.fetch);

      await expect(
        instance.forward('traces', otlpBody('traces')),
      ).resolves.toBeUndefined();
    });

    it.each([
      [400, 'traces'],
      [404, 'metrics'],
      [429, 'logs'],
      [500, 'traces'],
      [503, 'logs'],
    ] as const)(
      'fails safely on HTTP %i for %s without leaking the response body',
      async (status, signal) => {
        const collector = collectorFetch(() =>
          statusResponse(status, COLLECTOR_INTERNAL_SECRET),
        );
        const instance = forwarder(collector.fetch);

        const error = await instance
          .forward(signal, otlpBody(signal))
          .catch((caught: unknown) => caught);

        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toBe(
          `Collector rejected ${signal} with HTTP ${status}.`,
        );
        expect((error as Error).message).not.toContain(
          COLLECTOR_INTERNAL_SECRET,
        );
        expect(collector.fetchSpy).toHaveBeenCalledTimes(1);
      },
    );

    it.each([200, 503])(
      'releases the Collector response body after HTTP %i',
      async (status) => {
        const cancel = vi.fn();
        const collector = collectorFetch(
          () => new Response(new ReadableStream({ cancel }), { status }),
        );
        const instance = forwarder(collector.fetch);

        const completion = instance.forward('logs', otlpBody('logs'));
        if (status < 300) await expect(completion).resolves.toBeUndefined();
        else await expect(completion).rejects.toThrow(/HTTP 503/);
        expect(cancel).toHaveBeenCalledOnce();
      },
    );

    it.each([200, 503])(
      'preserves HTTP %i semantics when response cancellation fails',
      async (status) => {
        const cancellationSecret = 'collector-cancel-internal-detail';
        const cancel = vi.fn(() =>
          Promise.reject(new Error(cancellationSecret)),
        );
        const collector = collectorFetch(
          () => new Response(new ReadableStream({ cancel }), { status }),
        );
        const instance = forwarder(collector.fetch);

        const completion = instance.forward('traces', otlpBody('traces'));
        if (status < 300) await expect(completion).resolves.toBeUndefined();
        else {
          const error = await completion.catch((caught: unknown) => caught);
          expect(error).toBeInstanceOf(Error);
          expect((error as Error).message).toBe(
            'Collector rejected traces with HTTP 503.',
          );
          expect((error as Error).message).not.toContain(cancellationSecret);
        }
        expect(cancel).toHaveBeenCalledOnce();
      },
    );
  });

  describe('failure and timeout semantics', () => {
    it('propagates the original fetch rejection unchanged', async () => {
      const rejection = new Error('connect ECONNREFUSED 10.0.0.9:4318');
      const collector = collectorFetch(() => Promise.reject(rejection));
      const instance = forwarder(collector.fetch);

      await expect(instance.forward('traces', otlpBody('traces'))).rejects.toBe(
        rejection,
      );
    });

    it('aborts a hanging forward after the configured timeout', async () => {
      const collector = collectorFetch(
        (call) =>
          new Promise<Response>((_resolve, reject) => {
            call.init.signal?.addEventListener('abort', () => {
              reject(
                new DOMException(
                  'Collector request timed out.',
                  'TimeoutError',
                ),
              );
            });
          }),
      );
      const instance = forwarder(collector.fetch, undefined, 25);

      await expect(
        instance.forward('metrics', otlpBody('metrics')),
      ).rejects.toMatchObject({ name: 'TimeoutError' });
    });

    it('arms an independent abort signal per forwarded request', async () => {
      const collector = collectorFetch(() => statusResponse(200));
      const instance = forwarder(collector.fetch);

      await instance.forward('traces', otlpBody('traces'));
      await instance.forward('logs', otlpBody('logs'));

      expect(collector.calls).toHaveLength(2);
      expect(collector.calls[0]?.init.signal).toBeInstanceOf(AbortSignal);
      expect(collector.calls[1]?.init.signal).toBeInstanceOf(AbortSignal);
      expect(collector.calls[0]?.init.signal).not.toBe(
        collector.calls[1]?.init.signal,
      );
    });
  });
});
