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
lastReviewedAt: 2026-08-22
lastReviewedCommit: ed36c7913b5dd2b2542adf1aa1ce1e5d9a70029f
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

## Prerequisite

The telemetry ingress uses the shared `agent-excon-dev:local` application image.
On a clean checkout, build that image before starting this profile. Starting either
application stack builds it as part of the normal workflow:

```bash
pnpm stack:up
# or
pnpm stack:full:up
```

To build only the shared image without starting the application stack, run:

```bash
docker compose build api
```

The exact image tags, digests, build context, and profile membership live in
[compose.yaml](../../compose.yaml); it is the version source of truth for this
runbook.

## Operate

Validate the resolved Compose configuration, start the profile, verify it, and stop
it with:

```bash
pnpm observability:config
pnpm observability:up
pnpm observability:smoke
pnpm observability:down
```

`observability:down` stops the profile services. Telemetry data remains in named
volumes until those volumes are explicitly removed.

## Local endpoints

| Surface                       | Address                  | Intended caller            |
| ----------------------------- | ------------------------ | -------------------------- |
| Grafana                       | <http://127.0.0.1:3300>  | Local operator             |
| Participant OTLP/HTTP ingress | <http://127.0.0.1:14318> | Participant agents         |
| Trusted platform OTLP/gRPC    | `127.0.0.1:4317`         | Local platform processes   |
| Trusted platform OTLP/HTTP    | <http://127.0.0.1:4318>  | Local platform processes   |
| Prometheus                    | <http://127.0.0.1:9090>  | Local operator and Grafana |

## Trust boundary

The participant-facing ingress validates an opaque credential, binds it to one `run_agent_id`, overwrites identity attributes, applies body/record/request quotas, and rejects sensitive content before forwarding OTLP to the internal Collector. Compose uses an explicit local token; production verifies the HMAC token hash, expiry, revocation, Agent lifecycle, and `telemetry:write` scope against PostgreSQL.

The direct Collector ports remain available only for trusted local platform instrumentation. They bind to loopback and are not the participant endpoint.

The Collector deletes known prompt, completion, tool-body, submission, feedback, and hidden-outcome attributes as a second line of defense. Applications must still avoid emitting those values in the first place. Telemetry remains best-effort and never replaces PostgreSQL RunEvent/Receipt audit facts.

## Verification

Run `pnpm observability:smoke` after the profile reports healthy. The smoke check
waits for the ingress and Collector, sends traces, logs, and metrics, confirms they
are queryable through Tempo, Loki, and Prometheus, and verifies identity
normalization plus both ingress rejection and Collector redaction of sensitive
attributes. A successful run prints a JSON object whose `status` is `ok`; any
failed assertion exits non-zero.
