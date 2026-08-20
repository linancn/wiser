# Agent EXCON Docs

Astro 7 + Starlight bilingual documentation. Simplified Chinese is served at the root URL and English under `/en`.

The app declares exact dependency versions in its own `package.json`. Install it from the repository root so the workspace keeps one shared lockfile; do not generate an app-specific lockfile:

```bash
pnpm install
pnpm --filter @agent-excon/docs dev
```

Verification commands:

```bash
pnpm --filter @agent-excon/docs typecheck
pnpm --filter @agent-excon/docs build
```

Documentation lives in `src/content/docs/`. Every root-locale page should have a corresponding page in `src/content/docs/en/` with the same locale-free slug.
