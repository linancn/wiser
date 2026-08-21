# Rule Smell Patterns

These are common patterns worth flagging during a rule audit.

## Dead Rule

Signal:

- the rule appears in `coverage.rule_coverage.dead_rules`

Likely next step:

- delete it
- or fix its trigger if it is intended to remain live

## Duplicate or Near-Duplicate Rules

Signal:

- two rules use overlapping trigger families and very similar required docs

Why it matters:

- creates redundant matches
- makes lint and route harder to explain

Likely next step:

- merge or replace with one clearer rule

## Over-Broad Trigger

Signal:

- one rule owns a large path surface that likely contains unrelated governance domains

Why it matters:

- hides contract boundaries
- produces noisy review requirements

Likely next step:

- split the rule into smaller stable domains

## Over-Narrow or Fragmented Rules

Signal:

- many tiny sibling rules differ only in minor path details but point to the same docs

Why it matters:

- creates maintenance overhead
- makes the graph brittle

Likely next step:

- merge into a single more stable domain rule

## Weak Required Doc Binding

Signal:

- required docs look redundant, generic, or not clearly connected to the trigger domain

Why it matters:

- governance obligations become noisy without improving clarity

Likely next step:

- revise required docs instead of trigger paths

## Inheritance Smell

Signal:

- child repo overrides replace inherited rules frequently without a clear local reason

Why it matters:

- shared governance becomes harder to reason about

Likely next step:

- move logic back into the workspace profile
- or simplify child-local overrides
