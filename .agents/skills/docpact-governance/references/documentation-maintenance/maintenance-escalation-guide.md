# Maintenance Escalation Guide

Use this guide when stale-doc maintenance stops being “just fix the document”.

## Escalate to `rule-authoring`

Use when:

- the stale doc is the wrong governed target
- a required doc should be replaced or newly introduced
- the rule graph no longer matches the real ownership boundary

## Escalate to `routing-configuration`

Use when:

- the stale signal exposed weak or misleading `route --intent` aliases
- agents are reading the wrong doc because routing aliases drifted from the rule graph

## Escalate to `rule-audit`

Use when:

- multiple stale docs point to overlapping or dead rules
- workspace inheritance makes rule ownership hard to explain
- the broader rule graph looks redundant or fragmented

## Stay in Documentation Maintenance

Stay here when:

- the main action is substantive doc review
- the main action is review evidence refresh after real review
- the main action is fixing metadata or structure so review tracking works again

## Optional Supporting Commands

```bash
docpact list-rules --root <repo> --format json
docpact coverage --root <repo> --format json
docpact route --root <repo> --paths <csv> --format json --detail full
```

Use these to explain why the maintenance action should remain document-focused or be escalated.
