# Workflow Snippet Library

## PR Lint

```yaml
name: docpact-pr-lint

on:
  pull_request:

jobs:
  docpact:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: your-org/docpact@v1
        with:
          version: 0.1.0
          args: >
            lint
            --root .
            --base ${{ github.event.pull_request.base.sha }}
            --head ${{ github.sha }}
            --mode enforce
```

## PR Lint With Adoption Controls

```yaml
- uses: your-org/docpact@v1
  with:
    version: 0.1.0
    args: >
      lint
      --root .
      --base ${{ github.event.pull_request.base.sha }}
      --head ${{ github.sha }}
      --mode enforce
      --baseline .docpact/baseline.json
      --waivers .docpact/waivers.yaml
```

## Coverage Audit

```yaml
name: docpact-coverage

on:
  push:
    branches: [main]
  workflow_dispatch:

jobs:
  coverage:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: your-org/docpact@v1
        with:
          version: 0.1.0
          args: >
            coverage
            --root .
            --format json
```

## Freshness Audit

```yaml
name: docpact-freshness

on:
  schedule:
    - cron: "0 9 * * 1"
  workflow_dispatch:

jobs:
  freshness:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: your-org/docpact@v1
        with:
          version: 0.1.0
          args: >
            freshness
            --root .
            --format json
```
