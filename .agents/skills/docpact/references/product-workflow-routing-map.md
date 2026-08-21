# Product Workflow Routing Map

Map the user request to one of the three product workflow phases.

## Before Coding

Use when the user or agent asks:

- what should I read before I start?
- which docs are relevant for this path or module?
- what does this task probably touch in the documentation graph?

Default CLI:

- `docpact route`

Preferred inputs:

- `--paths`
- `--module`
- `--intent` only for controlled aliases already declared in config

## After Coding

Use when the user or agent asks:

- what docs should have been reviewed or updated?
- why did lint fail?
- what does this diagnostic mean?
- how do I mark review completion?

Default CLI sequence:

- `docpact lint`
- then `docpact diagnostics show` if drill-down is needed
- then `docpact review mark` if review was actually completed

## Ongoing

Use when the user or agent asks:

- are these docs stale?
- can I still trust this governed documentation?
- has review evidence gone stale or invalid?

Default CLI:

- `docpact freshness`

## Escalation to Maintainer Work

If the question becomes:

- how do we change config?
- how do we add or revise rules?
- how do we backfill governance gaps?
- how do we maintain routing aliases?

stop using this direct workflow skill as the primary guide and hand off to `docpact-governance`, which will load the relevant internal maintainer workflow reference.
