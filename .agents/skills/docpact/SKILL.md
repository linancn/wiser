---
name: docpact
description: Use `docpact` as the direct workflow entrypoint for agentic documentation governance. Use when an agent needs to decide what to read before coding, what docs should have been reviewed or updated after coding, how to drill into one lint finding, how to record completed review evidence, or how to check whether governed documents have gone stale.
---

# Docpact

Use `docpact` directly for the product's three main workflow phases:

- before coding
- after coding
- ongoing trust checks

This skill is the product-facing entrypoint. It is not the governance-maintainer router, and it is not a replacement for the CLI. Its job is to choose the correct existing `docpact` command first, then load the correct internal direct-workflow reference or escalate to `docpact-governance` only when the problem is no longer a normal task workflow.

## Modeling Boundary

Apply the product modeling boundary before treating a question as governance authoring work.

- deterministic governance facts belong in config
- explanatory material belongs in source docs
- `render` stays a read-only derived-view layer, not a new truth source

If the problem becomes "where should this information live?", apply those three checks first, then move to `docpact-governance` instead of inventing a new direct-workflow path.

## Workflow Map

### 1. Before coding: decide what to read

Use `route` when the agent is about to make a change and needs the minimum relevant reading set.

Choose the smallest stable input:

- `--paths <csv>` for explicit target files or path globs
- `--module <csv>` for a repo-relative module prefix
- `--intent <csv>` only after checking effective aliases with `render --view routing-summary`

Default commands:

```bash
docpact route --root <repo> --paths <csv> --format json
docpact route --root <repo> --module <prefix> --format json
docpact render --root <repo> --view routing-summary --format json
docpact route --root <repo> --intent <alias> --format json
```

Use `--detail full` only when you need the score breakdown, matched triggers, or provenance. Start with compact JSON for agent efficiency.

If route returns warnings such as `no-tracked-path-matches`, `no-rule-matches`, or `no-route-recommendations`, treat them as input/navigation ambiguity and inspect the target paths or routing configuration before assuming there are no documents to read.

If the task only needs a shorter derived summary over the existing navigation result, use `render` instead of inventing a new route shape:

```bash
docpact render --root <repo> --view navigation-summary --paths <csv> --format json
docpact render --root <repo> --view navigation-summary --module <prefix> --format text
```

Use `render` here only as a read-only summary layer over the same route pipeline. It does not replace `route` when full recommendation JSON or explanation detail is required.

If the repository does not have useful routing behavior yet, do not invent new route semantics here. Move to:

- `docpact-governance` with the routing-configuration workflow when the task is "define or fix controlled intent aliases"
- `docpact-governance` with the rule-authoring workflow when the route result is weak because the rule graph is weak

### 2. After coding: determine what should have changed

Use `lint` when the agent has made or plans to validate a concrete change.

`lint` always needs one explicit diff source:

- `--files <csv>`
- `--staged`
- `--worktree`
- `--merge-base <ref>`
- `--base <sha> --head <sha>`

Default command pattern:

```bash
docpact lint --root <repo> <diff-source-args> --format json --output .docpact/runs/latest.json
```

Use a saved report path whenever the result may need drill-down.

Treat `lint --format json` stdout as a paged `docpact.lint-report.v1` report. Treat `.docpact/runs/latest.json` as the full diagnostics artifact for drill-down. Do not assume stdout contains every diagnostic when pagination is active.

If `lint` returns findings and you need to inspect one exact result, move immediately to:

```bash
docpact diagnostics show --report .docpact/runs/latest.json --id <diagnostic_id> --format json
```

If the task becomes "repair this one finding," stay inside this skill and load [references/failure-repair-workflow.md](./references/failure-repair-workflow.md). Treat it as an internal remediation workflow, not as a separate entrypoint.

For rule-match debugging without a saved lint finding, use:

```bash
docpact explain <path> --root <repo> --format json
```

For config debugging, use:

```bash
docpact validate-config --root <repo> --strict --format json
```

### 3. After coding: record completed review evidence

Use `review mark` only after a review has actually been completed.

Prefer the diagnostics-driven form when the review comes from one explicit lint finding:

```bash
docpact review mark --root <repo> --report .docpact/runs/latest.json --id <diagnostic_id>
```

Use explicit path mode only when you genuinely know the document path without going through diagnostics:

```bash
docpact review mark --root <repo> --path docs/api.md
```

Do not use `review mark` for:

- uncovered-change
- missing rules
- speculative review completion

After recording review evidence, rerun `lint` with the same diff source.

### 4. Ongoing: check whether governed docs have gone stale

Use `freshness` when the task is not about one immediate code diff, but about whether governed documents still look trustworthy.

Default command:

```bash
docpact freshness --root <repo> --format json
```

Use this when:

- deciding whether docs are safe to trust before a broad task
- triaging stale governance debt
- checking whether review references are invalid

If the freshness result leads to stale-doc remediation, config work, or rule maintenance, that is no longer a direct workflow problem. Hand off to `docpact-governance` and select the appropriate maintainer workflow reference instead of forcing the direct workflow path.

### 5. Read-only summaries when you need compact context

Use `render` when you already know the question is about short derived context, not full governance evaluation.

Typical commands:

```bash
docpact render --root <repo> --view catalog-summary --format json
docpact render --root <repo> --view ownership-summary --format json
docpact render --root <repo> --view routing-summary --format json
docpact render --root <repo> --view workspace-summary --format text
```

Use this path when you need:

- deterministic repo entry and workflow pointers from `catalog`
- ownership-domain summary without running full route detail
- effective controlled route aliases before using `route --intent`
- a short workspace-facing summary over catalog and ownership facts

Do not use `render` as a replacement for:

- `route` when you still need the governed/advisory recommendation set
- `lint` when you need governance judgment
- `freshness` when you need stale-doc evaluation

## Handoff Rules

Stay in this direct workflow skill when the question is:

- what should I read first?
- what docs should this change have touched?
- what does this one finding mean?
- how do I record completed review evidence?
- are these governed docs stale?

If the task turns into a modeling-boundary question, classify it as config, source docs, or derived views first. Then move to `docpact-governance` rather than forcing the answer through `route`, `lint`, or `render`.

Move to `docpact-governance` when the question becomes:

- which governance-maintainer workflow should we use for this repository problem?
- how do we onboard this repository?
- how should we design or change rules?
- how should we turn uncovered hotspots into backlog?
- how should we maintain routing aliases?
- how healthy is the current rule graph?
- how should we remediate stale docs or invalid review references?
- how should we design or review CI integration?

For broad governance-maintainer work, hand off to `docpact-governance`. Do not expose separate selection for the sub-workflows; let the governance entrypoint route internally.

Read:

- [references/product-workflow-routing-map.md](./references/product-workflow-routing-map.md)
- [references/cli-handoff-guide.md](./references/cli-handoff-guide.md)

## Output Requirements

Always include:

- which workflow phase this task belongs to: `before-coding`, `after-coding`, or `ongoing`
- the first CLI command to run
- the minimum required inputs for that command
- whether a saved report artifact is needed
- whether the task should remain in direct workflow, use the internal failure-repair workflow, or hand off to `docpact-governance`

When the first command is `render`, state which derived view is the smallest correct one.

Use the templates in `assets/` instead of inventing a new output structure each time.
