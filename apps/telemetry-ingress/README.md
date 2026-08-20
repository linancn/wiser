# WISER Telemetry Ingress

Authenticated OTLP/HTTP boundary for telemetry reported by external RunAgents.

- accepts `POST /v1/traces`, `/v1/metrics`, and `/v1/logs`;
- verifies a short-lived credential with `telemetry:write` scope;
- rejects known prompt, completion, tool-body, feedback-body, and hidden-outcome attributes;
- overwrites Run, RunAgent, service, source, trust, and role identity attributes;
- enforces body, record, and per-credential request limits;
- forwards normalized OTLP JSON to the internal Collector;
- never changes Run state, authorization, Barriers, evaluations, or audit facts.

Production uses `DATABASE_URL` plus `WISER_TELEMETRY_TOKEN_PEPPER`. The stored `token_hash` is HMAC-SHA256 over the opaque bearer token. Trusted local Compose may instead set `WISER_TELEMETRY_LOCAL_TOKEN` together with fixed Run/RunAgent IDs.
