import { randomBytes } from 'node:crypto';

const collectorUrl =
  process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://127.0.0.1:4318';
const ingressUrl =
  process.env.WISER_TELEMETRY_INGRESS_URL ?? 'http://127.0.0.1:14318';
const ingressToken =
  process.env.WISER_TELEMETRY_LOCAL_TOKEN ??
  'local-participant-telemetry-token-0001';
const grafanaUrl = process.env.WISER_GRAFANA_URL ?? 'http://127.0.0.1:3300';
const grafanaUser = process.env.WISER_GRAFANA_ADMIN_USER ?? 'admin';
const grafanaPassword =
  process.env.WISER_GRAFANA_ADMIN_PASSWORD ?? 'local-observability-only';
const prometheusUrl =
  process.env.WISER_PROMETHEUS_URL ?? 'http://127.0.0.1:9090';
const traceId = randomBytes(16).toString('hex');
const spanId = randomBytes(8).toString('hex');
const redactionTraceId = randomBytes(16).toString('hex');
const redactionSpanId = randomBytes(8).toString('hex');
const smokeId = `smoke-${traceId.slice(0, 8)}`;
const sensitiveSentinel = `must-be-removed-${randomBytes(8).toString('hex')}`;
const now = BigInt(Date.now()) * 1_000_000n;
const end = now + 250_000_000n;
const auth = `Basic ${Buffer.from(`${grafanaUser}:${grafanaPassword}`).toString('base64')}`;

const participantResource = {
  attributes: [
    { key: 'service.name', value: { stringValue: 'spoofed-excon-service' } },
    { key: 'wiser.exercise.run.id', value: { stringValue: 'spoofed-run' } },
    { key: 'wiser.smoke.id', value: { stringValue: smokeId } },
  ],
};
const redactionResource = {
  attributes: [
    { key: 'service.name', value: { stringValue: 'wiser-redaction-probe' } },
    { key: 'wiser.hidden.outcome', value: { stringValue: sensitiveSentinel } },
  ],
};

function traceEnvelope(
  resource,
  currentTraceId,
  currentSpanId,
  attributes = [],
) {
  return {
    resourceSpans: [
      {
        resource,
        scopeSpans: [
          {
            scope: { name: 'wiser-observability-smoke' },
            spans: [
              {
                traceId: currentTraceId,
                spanId: currentSpanId,
                name: 'wiser.observability.smoke',
                kind: 1,
                startTimeUnixNano: String(now),
                endTimeUnixNano: String(end),
                attributes,
                status: { code: 1 },
              },
            ],
          },
        ],
      },
    ],
  };
}

async function postOtlp(endpoint, signal, body, token) {
  const response = await fetch(`${endpoint}/v1/${signal}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
    },
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
  postOtlp(
    ingressUrl,
    'traces',
    traceEnvelope(participantResource, traceId, spanId),
    ingressToken,
  ),
  postOtlp(
    ingressUrl,
    'logs',
    {
      resourceLogs: [
        {
          resource: participantResource,
          scopeLogs: [
            {
              scope: { name: 'wiser-observability-smoke' },
              logRecords: [
                {
                  timeUnixNano: String(now),
                  severityNumber: 9,
                  severityText: 'INFO',
                  body: {
                    stringValue: `WISER observability smoke log ${traceId}`,
                  },
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
    },
    ingressToken,
  ),
  postOtlp(
    ingressUrl,
    'metrics',
    {
      resourceMetrics: [
        {
          resource: participantResource,
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
    },
    ingressToken,
  ),
  postOtlp(
    collectorUrl,
    'traces',
    traceEnvelope(redactionResource, redactionTraceId, redactionSpanId, [
      { key: 'gen_ai.prompt', value: { stringValue: sensitiveSentinel } },
    ]),
  ),
]);

const rejectedSensitive = await fetch(`${ingressUrl}/v1/traces`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    authorization: `Bearer ${ingressToken}`,
  },
  body: JSON.stringify(
    traceEnvelope(
      participantResource,
      randomBytes(16).toString('hex'),
      randomBytes(8).toString('hex'),
      [{ key: 'tool.arguments', value: { stringValue: sensitiveSentinel } }],
    ),
  ),
});
if (rejectedSensitive.status !== 400) {
  throw new Error(
    `Telemetry Ingress accepted a sensitive payload with HTTP ${rejectedSensitive.status}.`,
  );
}
const rejectedPayload = await rejectedSensitive.json();
if (rejectedPayload.error?.code !== 'TELEMETRY_SENSITIVE_CONTENT') {
  throw new Error(
    'Telemetry Ingress returned the wrong sensitive-content error.',
  );
}

async function readTempoTrace(currentTraceId) {
  return poll(`Tempo trace ${currentTraceId}`, async () => {
    const response = await fetch(
      `${grafanaUrl}/api/datasources/proxy/uid/wiser-tempo/api/traces/${currentTraceId}`,
      { headers: { authorization: auth } },
    );
    if (response.status === 404) return undefined;
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  });
}

const trace = await readTempoTrace(traceId);
const serializedTrace = JSON.stringify(trace);
for (const expected of [
  'wiser-participant-agent',
  'wiser.participant',
  '51000000-0000-4000-8000-000000000001',
  '53000000-0000-4000-8000-000000000001',
  'participant_exporter',
  'participant_reported',
  'water-evidence',
]) {
  if (!serializedTrace.includes(expected)) {
    throw new Error(`Normalized participant trace is missing ${expected}.`);
  }
}
if (
  serializedTrace.includes('spoofed-run') ||
  serializedTrace.includes('spoofed-excon-service')
) {
  throw new Error(
    'Telemetry Ingress did not overwrite spoofed identity attributes.',
  );
}

const redactionTrace = await readTempoTrace(redactionTraceId);
if (JSON.stringify(redactionTrace).includes(sensitiveSentinel)) {
  throw new Error('Collector leaked the sensitive test attribute into Tempo.');
}

const lokiResults = await poll('Loki log', async () => {
  const url = new URL(
    '/api/datasources/proxy/uid/wiser-loki/loki/api/v1/query_range',
    grafanaUrl,
  );
  url.searchParams.set(
    'query',
    `{service_name="wiser-participant-agent"} |= "${traceId}"`,
  );
  const response = await fetch(url, { headers: { authorization: auth } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload = await response.json();
  return payload.data?.result?.length > 0 ? payload.data.result : undefined;
});

const metricResultCount = await poll('Prometheus metric', async () => {
  const url = new URL('/api/v1/query', prometheusUrl);
  url.searchParams.set(
    'query',
    `{__name__=~"wiser_observability_smoke.*",wiser_smoke_id="${smokeId}"}`,
  );
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload = await response.json();
  return payload.data?.result?.length > 0
    ? payload.data.result.length
    : undefined;
});

process.stdout.write(
  `${JSON.stringify({ status: 'ok', smokeId, traceId, spanId, lokiResultCount: lokiResults.length, metricResultCount, ingressIdentityOverwritten: true, ingressSensitivePayloadRejected: true, collectorSensitiveAttributeRemoved: true })}\n`,
);
