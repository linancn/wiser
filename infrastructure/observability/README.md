---
title: WISER local observability guide
docType: runbook
scope: infrastructure/observability
status: active
authoritative: true
owner: wiser
language: en
whenToUse:
  - when operating or changing the local telemetry stack
whenToUpdate:
  - when images, ports, trust boundaries, or smoke verification changes
checkPaths:
  - infrastructure/observability/**
  - apps/telemetry-ingress/**
  - compose.yaml
lastReviewedAt: 2026-08-21
lastReviewedCommit: cca05b0bfc076853dfba2dd8bfc7431eb767d1ee
---

# WISER local observability profile

This optional Compose profile provides a local technical drill-down stack:

```text
Participant OTLP/HTTP → Authenticated Telemetry Ingress ┐
Platform OTLP gRPC/HTTP ────────────────────────────────┴→ Collector
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

Grafana listens on <http://127.0.0.1:3300>. Participant OTLP/HTTP enters through <http://127.0.0.1:14318>; trusted platform OTLP uses loopback ports `4317` and `4318`. Prometheus listens on <http://127.0.0.1:9090>. Data persists in named volumes until explicitly removed.

## Trust boundary

The participant-facing ingress validates an opaque credential, binds it to one `run_agent_id`, overwrites identity attributes, applies body/record/request quotas, and rejects sensitive content before forwarding OTLP to the internal Collector. Compose uses an explicit local token; production verifies the HMAC token hash, expiry, revocation, Agent lifecycle, and `telemetry:write` scope against PostgreSQL.

The direct Collector ports remain available only for trusted local platform instrumentation. They bind to loopback and are not the participant endpoint.

The Collector deletes known prompt, completion, tool-body, submission, feedback, and hidden-outcome attributes as a second line of defense. Applications must still avoid emitting those values in the first place. Telemetry remains best-effort and never replaces PostgreSQL RunEvent/Receipt audit facts.
