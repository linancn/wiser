import { randomBytes } from 'node:crypto';

const collectorUrl =
  process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://127.0.0.1:4318';
const grafanaUrl = process.env.WISER_GRAFANA_URL ?? 'http://127.0.0.1:3300';
const grafanaUser = process.env.WISER_GRAFANA_ADMIN_USER ?? 'admin';
const grafanaPassword =
  process.env.WISER_GRAFANA_ADMIN_PASSWORD ?? 'local-observability-only';
const prometheusUrl =
  process.env.WISER_PROMETHEUS_URL ?? 'http://127.0.0.1:9090';
const traceId = randomBytes(16).toString('hex');
const spanId = randomBytes(8).toString('hex');
const serviceName = `wiser-observability-smoke-${traceId.slice(0, 8)}`;
const sensitiveSentinel = `must-be-removed-${randomBytes(8).toString('hex')}`;
const now = BigInt(Date.now()) * 1_000_000n;
const end = now + 250_000_000n;
const auth = `Basic ${Buffer.from(`${grafanaUser}:${grafanaPassword}`).toString('base64')}`;

const resource = {
  attributes: [
    { key: 'service.name', value: { stringValue: serviceName } },
    {
      key: 'wiser.exercise.run.id',
      value: { stringValue: 'observability-smoke-run' },
    },
  ],
};

async function postOtlp(signal, body) {
  const response = await fetch(`${collectorUrl}/v1/${signal}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(
      `${signal} ingest failed with HTTP ${response.status}: ${await response.text()}`,
    );
  }
}

async function poll(label, operation, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await operation();
      if (value !== undefined && value !== false) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(
    `${label} was not observable before timeout${lastError instanceof Error ? `: ${lastError.message}` : ''}`,
  );
}

await Promise.all([
  postOtlp('traces', {
    resourceSpans: [
      {
        resource,
        scopeSpans: [
          {
            scope: { name: 'wiser-observability-smoke' },
            spans: [
              {
                traceId,
                spanId,
                name: 'wiser.observability.smoke',
                kind: 1,
                startTimeUnixNano: String(now),
                endTimeUnixNano: String(end),
                attributes: [
                  {
                    key: 'wiser.telemetry.trust',
                    value: { stringValue: 'platform_observed' },
                  },
                  {
                    key: 'gen_ai.prompt',
                    value: { stringValue: sensitiveSentinel },
                  },
                ],
                status: { code: 1 },
              },
            ],
          },
        ],
      },
    ],
  }),
  postOtlp('logs', {
    resourceLogs: [
      {
        resource,
        scopeLogs: [
          {
            scope: { name: 'wiser-observability-smoke' },
            logRecords: [
              {
                timeUnixNano: String(now),
                severityNumber: 9,
                severityText: 'INFO',
                body: { stringValue: 'WISER observability smoke log' },
                traceId,
                spanId,
                attributes: [
                  {
                    key: 'wiser.event.id',
                    value: { stringValue: 'smoke-event' },
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  }),
  postOtlp('metrics', {
    resourceMetrics: [
      {
        resource,
        scopeMetrics: [
          {
            scope: { name: 'wiser-observability-smoke' },
            metrics: [
              {
                name: 'wiser_observability_smoke',
                unit: '1',
                gauge: {
                  dataPoints: [{ timeUnixNano: String(now), asDouble: 1 }],
                },
              },
            ],
          },
        ],
      },
    ],
  }),
]);

const trace = await poll('Tempo trace', async () => {
  const response = await fetch(
    `${grafanaUrl}/api/datasources/proxy/uid/wiser-tempo/api/traces/${traceId}`,
    {
      headers: { authorization: auth },
    },
  );
  if (response.status === 404) return undefined;
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
});

if (JSON.stringify(trace).includes(sensitiveSentinel)) {
  throw new Error('Collector leaked the sensitive test attribute into Tempo.');
}

const lokiResultCount = await poll('Loki log', async () => {
  const url = new URL(
    '/api/datasources/proxy/uid/wiser-loki/loki/api/v1/query_range',
    grafanaUrl,
  );
  url.searchParams.set('query', `{service_name="${serviceName}"}`);
  const response = await fetch(url, { headers: { authorization: auth } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload = await response.json();
  return payload.data?.result?.length > 0
    ? payload.data.result.length
    : undefined;
});

const metricResultCount = await poll('Prometheus metric', async () => {
  const url = new URL('/api/v1/query', prometheusUrl);
  url.searchParams.set(
    'query',
    `{__name__=~"wiser_observability_smoke.*",service_name="${serviceName}"}`,
  );
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload = await response.json();
  return payload.data?.result?.length > 0
    ? payload.data.result.length
    : undefined;
});

process.stdout.write(
  `${JSON.stringify({ status: 'ok', serviceName, traceId, spanId, lokiResultCount, metricResultCount, sensitiveAttributeRemoved: true })}\n`,
);
