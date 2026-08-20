# WISER local observability profile

This optional Compose profile provides a local technical drill-down stack:

```text
OTLP gRPC/HTTP → OpenTelemetry Collector
                 ├─ traces  → Tempo
                 ├─ metrics → Prometheus
                 └─ logs    → Loki

Grafana ← Tempo + Prometheus + Loki
```

The pinned images are the latest stable releases verified from the upstream release APIs on 2026-08-20:

- OpenTelemetry Collector Contrib `0.159.0`
- Tempo `3.0.3` in monolithic `target=all` mode
- Prometheus `3.14.0`
- Loki `3.7.6`
- Grafana `13.2.0`

Start and stop it independently from the application stack:

```bash
pnpm observability:config
pnpm observability:up
pnpm observability:smoke
pnpm observability:down
```

Grafana listens on <http://127.0.0.1:3300>. OTLP listens on loopback ports `4317` and `4318`. Prometheus listens on <http://127.0.0.1:9090>. Data persists in named volumes until explicitly removed.

## Trust boundary

This profile is for trusted local development only. Loopback binding prevents LAN exposure, but the Collector endpoint itself is not the production authentication boundary. Production participant telemetry must first pass through the WISER Telemetry Ingress, which binds a short-lived credential to `run_agent_id`, overwrites identity attributes, applies quotas, and rejects sensitive content.

The Collector deletes known prompt, completion, tool-body, submission, feedback, and hidden-outcome attributes as a second line of defense. Applications must still avoid emitting those values in the first place. Telemetry remains best-effort and never replaces PostgreSQL RunEvent/Receipt audit facts.
