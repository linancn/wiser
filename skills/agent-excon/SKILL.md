---
name: agent-excon
description: Run or resume an auditable Agent EXCON exercise through its HTTP or MCP interface, including staged observation, evidence-backed submission, feedback handling, virtual-time advance, and trace retrieval. Use for participating in an exercise; do not use it to administer the database or operate the read-only Web visualization.
---

# Agent EXCON

Treat the exercise service as the environment and this Skill as the participant behavior layer. The Web interface is a read-only case and trace visualization; do not attempt to exercise through browser controls.

## Run the loop

1. Read [interaction-protocol.md](references/interaction-protocol.md) before the first live call in a task. Resolve the API base URL, participant credential, scenario version, and current Episode from explicit input or environment; never guess production targets.
2. Start or resume one Episode. Preserve its ID, virtual time, state, and optimistic `version` across every call.
3. Observe through the API/MCP tool and retrieve the full current Observation records, not IDs alone. Build the working evidence set from their payloads, timestamps, provenance, and supersession links. Do not use future Injects, private outcomes, repository fixtures, or another participant's trace as evidence.
4. For the default Jing-Jin-Ji water-system exercise, read [yongding-allocation.md](references/yongding-allocation.md), construct a plan from the current rule Observation, and run `node scripts/validate-allocation-plan.mjs <plan.json> <current-rules.json>` before submitting. Validation without the rules file is structural only and emits a warning.
5. Submit with a fresh idempotency key and the current Episode version. A retry must reuse the same key and byte-equivalent request; otherwise stop and reconcile the prior response.
6. Poll or retrieve Evaluation and Feedback without busy waiting. Follow only actions listed in `allowedActions`; feedback can guide a revision but cannot change deterministic facts or constraints.
7. Advance virtual time only when allowed. Observe again after advancing because released information and the optimistic version have changed.
8. Stop when the Episode is completed, the user asks to stop, authorization is missing, or a stable error requires operator action. Retrieve the participant-safe Event trace for the handoff.

## Non-negotiable boundaries

- Use HTTP or MCP only. Never connect to PostgreSQL, use a Supabase service-role key, or read `excon_private` data.
- Keep `event_time`, `observed_time`, `ingested_time`, `released_time`, and `accessed_time` distinct. Evidence eligibility depends on release, access, Episode membership, and submission virtual time.
- Treat submissions as immutable. Revisions create new submissions linked to the previous one.
- Never let an LLM overwrite deterministic scores or verdicts. AI-written summaries are explanatory only.
- Do not retry a write under a new idempotency key after an ambiguous timeout.
- Surface stable API error codes and the next safe action. Do not expose internal errors or hidden labels.

Read [feedback-and-errors.md](references/feedback-and-errors.md) when a submission is rejected, evaluation is pending, or feedback controls the next step. Read [evidence-rules.md](references/evidence-rules.md) when deciding whether a fact may support a plan.
