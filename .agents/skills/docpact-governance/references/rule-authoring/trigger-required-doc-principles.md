# Trigger and Required Doc Design Principles

## Core Split

Treat the rule as two linked but different pieces:

- `triggers`: which changed paths should activate governance
- `requiredDocs`: which documents must carry the resulting review obligation

Do not collapse these into the same mental model.

## Trigger Principles

- Triggers should describe the changed code, config, or contract area that activates governance.
- Trigger paths must be repo-relative globs.
- Prefer the smallest path family that shares one governance contract.
- Trigger `kind` is descriptive only. Do not rely on it to change matching behavior.

Good trigger questions:

- Which paths actually belong to the same contract surface?
- Will a maintainer understand why these paths are grouped together?
- Would broadening this trigger create noisy downstream lint or route recommendations?

## Required Doc Principles

- A required doc should exist because it carries the review contract, not because it is easy to touch.
- Reuse an existing document when the target paths already belong to that document's contract.
- Add a new required doc only when a distinct, durable doc boundary really exists.
- Keep the set small. Each extra required doc increases governance cost.

## Mode Selection Principles

Choose the weakest mode that still expresses the real requirement.

- `review_or_update`
  - default choice when a document must be revisited as part of the change
- `body_update_required`
  - use when substantive doc content must change, not only review metadata
- `metadata_refresh_required`
  - use when the document itself is the reviewed evidence and review metadata must refresh
- `must_exist`
  - use only when existence is the contract and a diff touch is not required

Do not use a stronger mode just to make the rule feel stricter.

## Relationship to Coverage

- Coverage answers whether a changed path is governed at all.
- `requiredDocs` does not participate in the covered/uncovered decision.
- If an uncovered path exists, fix the trigger graph first. Do not try to solve it by adding more required docs.

## Workspace Inheritance Principles

- Shared defaults belong in `workspace.profiles.<name>.rules`.
- Child-specific new contracts belong in `overrides.rules.add`.
- Child-specific changes to inherited contracts belong in `overrides.rules.replace`.
- Child configs with inheritance enabled must not reintroduce top-level `rules`.
