# Controlled Intent Principles

Use `routing.intents` as a stable alias layer over existing route behavior.

## What an Intent Is

An intent is a named alias that expands to configured repo-relative path patterns.

It is not:

- free-text semantic search
- a replacement for `--paths`
- a replacement for `--module`
- a new scoring or weighting mechanism

## When an Intent Is Worth Adding

Add an intent only when:

- the task family is repeated often enough to deserve a stable name
- the paths represent one coherent work surface
- the alias improves usability over raw `--paths` or `--module`
- the alias stays consistent with the current rule graph

## Good Intent Characteristics

- short, stable name
- narrow but useful path family
- clear relationship to real work domains
- predictable route output

## Bad Intent Characteristics

- broad "miscellaneous" aliases
- aliases that overlap heavily without clear reason
- aliases that encode free-text intent guesses
- aliases that point to unstable or temporary path families

## Relationship to the Rule Graph

An intent should guide users into existing routing behavior, not override it.

Ask:

- does the alias point at one coherent set of route-driving paths?
- will `route --intent <alias>` recommend docs that make sense given current rules?
- should the real fix be in rules rather than in routing aliases?

If route recommendations are wrong because the rule graph is wrong, fix the rules first.
