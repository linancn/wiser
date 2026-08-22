---
title: Documentation development and governance
description: Responsibilities for WISER READMEs and Docs, plus locale, navigation, Docpact, version-source, and reader-acceptance rules.
docType: workflow
scope: wiser-documentation
status: active
authoritative: true
owner: wiser
language: en
whenToUse:
  - when creating, rewriting, moving, or deleting WISER documentation
whenToUpdate:
  - when documentation responsibilities, information architecture, locales, navigation, version sources, Docpact, or reader acceptance change
checkPaths:
  - README.md
  - README.en.md
  - AGENTS.md
  - CONTRIBUTING.md
  - apps/**/README.md
  - packages/**/README.md
  - infrastructure/**/README.md
  - apps/docs/src/content/**
  - .docpact/**
lastReviewedAt: 2026-08-22
lastReviewedCommit: c9b9047b81f84ad7a704f9d0806526a43a90d7f1
---

## Give each fact one authoritative home

| Documentation layer               | Question it answers                                                                         | Content to keep                                                                                                      | Content it must not carry                                                                               |
| --------------------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Root `README.md` / `README.en.md` | What is WISER, which systems exist, how do I start once, and where are the entrypoints?     | A compact system map, shortest startup path, frontend/backend entrypoints, verification command, and links to detail | Complete protocols, long architecture explanations, dependency-version inventories, or milestone logs   |
| `apps/docs` site                  | How does the current system work, and how do developers design, run, test, and diagnose it? | Architecture, boundaries, protocols, runbooks, security, development workflows, and executable examples              | Superseded proposals, milestone retrospectives, or narratives useful only during one migration          |
| Component `README.md`             | What does this directory own, and how can I run and verify it alone?                        | Component boundary, entrypoint, component-only configuration, focused commands, and links to authoritative guides    | Copies of cross-system architecture, the root quick start, or version tables transcribed from manifests |

`AGENTS.md` is the repository delivery contract, and `CONTRIBUTING.md` defines the contribution workflow; neither is a product landing page. Architecture facts belong in Docs, deterministic governance facts belong in `.docpact` configuration, and Git preserves history. Do not introduce another README or “supplement” that repeats an existing source of truth.

## Write the current state

Documentation uses present tense for the system that can be run and verified now. Readers must be able to distinguish three kinds of claims:

- **Supported now:** provide the real entrypoint, prerequisites, command, observable success result, and recovery action.
- **Unsupported now:** state the boundary and safe failure behavior explicitly; do not hide a gap with samples, compatibility behavior, or inference.
- **Future plan:** link an issue or decision record only when needed, and keep plans out of current run instructions.

Remove historical narration such as “already delivered,” “this milestone,” or “evolved from an agent playground” when it does not change a current action. Keep rationale only while it still constrains the implementation or a choice. Commands must be copyable from the repository root; example output contains only the stable signals a reader needs to recognize success.

For every edit, check whether it creates a second copy of a port table, environment-variable explanation, protocol field, or architecture diagram. Keep the complete fact on its authoritative page and use a clear link plus one sentence of context elsewhere.

## Locales, slugs, and navigation

- Chinese is the default corpus under `apps/docs/src/content/docs/zh-CN`; English is the sibling `en` corpus.
- Every human-facing page has a translation pair at the same relative path and locale-free slug. Chinese `/development/frontend/` corresponds to English `/en/development/frontend/`.
- Both languages preserve the same information, steps, table rows, states, and link targets. English is not a summary, and Chinese does not contain untranslated narrative paragraphs. Protocol names, commands, paths, and code identifiers remain unchanged.
- Adding, renaming, or deleting a page updates both adjacent `meta.json` files in the same change and at the same navigation position. Never rely on filesystem order to build the sidebar.
- Chinese pages link to default Chinese routes; English pages link to `/en/...`. After editing, open the page once through navigation, locale switching, and search.

## Frontmatter contract

Every governed Docs page supplies complete frontmatter:

```yaml
---
title: Reader-facing title
description: One sentence describing the problem this page solves
docType: workflow
scope: repository-or-system
status: active
authoritative: true
owner: wiser
language: en
whenToUse:
  - the task in which a reader should open this page
whenToUpdate:
  - the fact whose change makes this page stale
checkPaths:
  - real repository paths that require this page to be reviewed
lastReviewedAt: YYYY-MM-DD
lastReviewedCommit: full commit SHA
---
```

The Chinese page uses `language: zh-CN`; every other governance field expresses the same contract in both files. `checkPaths` lists only source paths that genuinely affect the page, rather than covering the repository for appearance. Update `lastReviewedAt` and `lastReviewedCommit` only after comparing the content with that commit.

## Docpact workflow

Docpact is a host-side Cargo tool, not an npm dependency. Install the repository-required version once and keep `~/.cargo/bin` on `PATH`:

```bash
cargo install docpact --version 0.1.9 --locked
```

### 1. Route before editing

Use the real intended paths to obtain the smallest reading set:

```bash
pnpm docpact:route --paths 'apps/docs/src/content/docs/zh-CN/development/**,apps/docs/src/content/docs/en/development/**'
```

Read the returned authoritative documents before drafting. If routing reports no tracked path, rule, or recommendation, inspect the input and governance configuration; never interpret the warning as “nothing needs reading.”

### 2. Lint after editing

```bash
pnpm docpact:check
```

This command uses the current worktree as its diff source and checks uncovered changes, required document reviews, and stale documents. When a finding needs investigation, save the complete report and inspect the diagnostic ID:

```bash
docpact lint --root . --worktree --format json \
  --output .docpact/runs/latest.json
docpact diagnostics show \
  --report .docpact/runs/latest.json --id '<diagnostic-id>' --format json
```

Record review evidence only after the review is genuinely complete. Never use review marking to hide missing rules or uncovered changes.

### 3. Validate governance changes

Run strict validation after changing `.docpact/config.yaml`, rules, ownership, routing, or coverage:

```bash
pnpm docpact:validate
```

An ordinary prose edit does not justify a fabricated governance change, but it still must pass lint. Docs content also runs typecheck, build, and Playwright; root `pnpm verify` closes the workflow.

## Sources of truth for versions and configuration

Documentation does not maintain a “current latest versions” table or manually reproduce lockfile content. Read the actual source for each object:

| Object                                              | Authoritative source                                                         |
| --------------------------------------------------- | ---------------------------------------------------------------------------- |
| Node and package-manager range                      | Root `package.json`, `.nvmrc`, and `.node-version`                           |
| Direct npm workspace dependencies                   | The corresponding `package.json`                                             |
| Resolved npm versions and integrity                 | `pnpm-lock.yaml`                                                             |
| Container tags and digests                          | `compose.yaml` and the Compose configuration it references                   |
| Local Supabase configuration and database structure | `supabase/config.toml`, migrations, schemas, seed, and tests                 |
| Environment-variable catalog                        | `.env.example` and the configuration code that reads it                      |
| Callable HTTP, GraphQL, and MCP contracts           | Generated schemas/OpenAPI, protocol implementations, and Docs protocol pages |

When upgrading a dependency, update its manifest, lockfile, or image digest in the same change and verify compatibility. Documentation explains the choice and compatibility boundary without duplicating exact versions that will become stale.

## Reader acceptance

After writing, ask a person who did not make the change or an agent with no conversation context to complete a reading test using only the documentation. At minimum, verify that they can answer accurately:

1. Which WISER systems exist now, and where do Product Web, backend API, MCP, and Docs start?
2. Which command should run on a clean checkout, and what observable result proves startup succeeded?
3. Which directory starts the current task, and what is its minimum verification command?
4. What are the data boundaries for unified Auth, Agent EXCON, and Data Foundation?
5. After failure, which logs or recovery command should be used, and which resets destroy data?
6. Where is a fact authoritative, and do other pages link to it instead of copying it?

Acceptance also requires reaching the target page from the Docs home in at most two navigation actions, staying on the same slug when switching locales, opening every internal link, copying each command, avoiding overflow in light/dark desktop and 390px views, and finding the page through terms a reader would search for.

If a reader must guess a hidden prerequisite, assemble an answer from conflicting pages, or mistakes a plan for current behavior, the documentation has not passed. Fix the page and repeat the test instead of adding oral context to the review.
