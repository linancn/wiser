---
title: Security and data boundaries
description: Prevent fact leakage, unauthorized observations, credential spread, and unaudited changes.
---

## Separate three data classes

| Class                  | Examples                                  | Readers                              |
| ---------------------- | ----------------------------------------- | ------------------------------------ |
| Public observation     | Released monitoring data and instructions | The Episode participant              |
| Restricted state       | Future Injects and internal gates         | EXCON services and authorized admins |
| Facts and adjudication | Outcomes, hidden labels, full rules       | Workers and authorized reviewers     |

Never send full fact objects to a browser or participant and rely on the UI to hide fields. Isolation starts in the server-side query.

## Supabase and RLS

Enable RLS on every exposed table. Data API exposure and RLS are separate: new tables need deliberate grants as well as policies. Combine `TO authenticated` with ownership predicates; configure both `USING` and `WITH CHECK` for updates. Store authorization attributes in `app_metadata`, never user-editable metadata.

Frontend code receives only a publishable key. Views use security-invoker behavior, and privileged functions live in an unexposed schema with default public execution revoked. Run database advisors and tests as anonymous, authenticated, and service roles after migrations.

## Time and evidence authorization

An Inject is not an Observation. EXCON checks time and permissions before creating a participant-specific Observation and access event. A Submission may reference evidence only after that participant observed it.

## Credentials

Host-side Codex sign-in never enters shared containers. Do not bake `~/.codex`, access tokens, or API keys into images or Event payloads. CI defaults to the fake provider; opt-in online tests use a least-privilege secret.

Treat uploads and model output as untrusted content, not executable system instructions.

## Release checklist

- [ ] Future Injects cannot be inferred from APIs, logs, or errors.
- [ ] Idempotent retries do not duplicate work.
- [ ] Facts, rules, and human overrides retain actor, version, and trace ID.
- [ ] Downloads are short-lived and authorization-bound.
- [ ] RLS, locks, and negative state-machine tests pass on real PostgreSQL.
- [ ] Live AI calls are not required to merge a change.
