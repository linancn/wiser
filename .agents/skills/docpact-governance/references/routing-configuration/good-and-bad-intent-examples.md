# Good and Bad Intent Examples

## Good: stable domain alias

```yaml
routing:
  intents:
    payments:
      paths:
        - src/payments/**
        - docs/payments.md
```

Why it works:

- clear domain boundary
- durable path family
- likely to be reused often
- route output should be predictable

## Good: root governance alias

```yaml
routing:
  intents:
    governance:
      paths:
        - .docpact/**
        - docs/**
        - .github/**
```

Why it works:

- ties together one operational governance surface
- still deterministic

## Bad: catch-all alias

```yaml
routing:
  intents:
    everything:
      paths:
        - src/**
        - docs/**
        - .github/**
```

Why it is bad:

- too broad
- not a coherent task family
- adds little value beyond raw `--paths`

## Bad: free-text disguised as aliasing

```yaml
routing:
  intents:
    improve-user-experience:
      paths:
        - src/**
```

Why it is bad:

- the alias name implies free-text semantics the engine does not implement
- the path scope is too broad for one stable task family

## Bad: duplicate inherited alias with unclear ownership

Bad pattern:

- workspace profile defines `payments`
- child repo redefines `payments` without deciding whether that should be `merge` or `replace`

Why it is bad:

- creates ambiguity about whether the alias is shared or local
- tends to drift from the shared profile without clear intent

Preferred fix:

- choose explicit `overrides.routing.mode`
- then either replace the inherited alias deliberately or add a distinct child-only alias
