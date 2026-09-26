---
title: WISER data review and black-odor water sample trial entry
description: Public web links, trial ingestion limits, and AI/MCP OAuth integration status.
docType: runbook
scope: repository
status: active
authoritative: true
owner: wiser
language: en
whenToUse:
  - reviewing WISER data or preparing black-odor water sample trial entry
  - connecting an external MCP client to the public WISER service
whenToUpdate:
  - public entrypoints, data permissions, or OAuth end-to-end acceptance status change
checkPaths:
  - apps/web/src/app/**/oauth/**
  - apps/mcp/src/**
  - supabase/config.toml
lastReviewedAt: 2026-09-26
lastReviewedCommit: b842f324611ce7d8dfacf4ab522c4adb604d2a71
---

## Web links

These five links use public HTTPS port `7100`. Sign in with your existing WISER account; the application shows only Projects and data that account may access.

| Purpose                    | Web page                                                                                  |
| -------------------------- | ----------------------------------------------------------------------------------------- |
| WISER Portal               | [Open Portal](https://wiser.thuenv.tiangong.world:7100/en)                                |
| Published data catalog     | [Browse catalog](https://wiser.thuenv.tiangong.world:7100/en/data-foundation/catalog)     |
| Cross-source search        | [Search data](https://wiser.thuenv.tiangong.world:7100/en/data-foundation/search)         |
| Explore and check evidence | [Explore data](https://wiser.thuenv.tiangong.world:7100/en/data-foundation/explore)       |
| Trial ingestion operations | [View ingestions](https://wiser.thuenv.tiangong.world:7100/en/data-foundation/ingestions) |

For black-odor water data, confirm your organization and Project, then check source, version, license, security level, and quality state. Trial ingestion is limited to sources approved for your Project and account. Review the resulting operation and quality feedback. Upload or parsing does not publish a source or establish a validated scientific conclusion.

## External AI/MCP connection

**Personal-client end-to-end status: BLOCKED (2026-09-26; deferred by the user).** Public protocol and authorization checks passed with existing synthetic ordinary accounts, real Chromium and the official MCP TypeScript SDK 1.30.0. This does not replace personal-client acceptance or establish compatibility with every third-party client.

An MCP client supporting OAuth 2.1 authorization code and PKCE S256 connects in this order:

1. Configure Streamable HTTP MCP URL `https://mcp.wiser.thuenv.tiangong.world:7100/mcp`, not the old loopback address.
2. Read protected resource metadata from the 401 `WWW-Authenticate` challenge, discover issuer `https://auth.wiser.thuenv.tiangong.world:7100/auth/v1`, and dynamically register the client's callback. The authorization request needs the exact `resource`, `redirect_uri`, and PKCE S256 challenge.
3. Sign in with your existing personal WISER account in the browser. Review the client and callback host, then explicitly choose one eligible Project, query or ingestion mode, maximum data level, and a 15-minute or one-hour term before approving. You can also deny. Google, GitHub, and other social sign-in providers are not part of this flow.
4. The client receives the authorization code, exchanges it at the public Auth token endpoint, and sends the OAuth Bearer token in the MCP request header. Do not place passwords, codes, or tokens in chat, Tool arguments, or logs.
5. Open “AI/MCP connections” from the account menu to disconnect an owned connection and clear its saved client consent. After expiry or a resource-scope change, disconnect first, then restart authorization and explicitly consent in the original client. Discarding client tokens alone does not force this server to show consent again. Managed Projects require separately approved Web and AI/MCP resource purposes.
6. Personal acceptance must still record the client name, selected Project and call outcomes, including allowed reads, denied cross-Project/unapproved operations, denial, expiry and revocation. Do not provide passwords, codes or tokens. If disconnection is partial, access has stopped; follow the page's retry action to clear saved consent.

### Independent checks completed

Public `:7100` checks on 2026-09-26 used existing synthetic ordinary identities, without administrative keys for business access:

| Check                           | Evidence obtained                                                                                                                                                                                                                                                                                                                |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Discovery and challenge         | Correct public MCP resource, HTTPS issuer and authorization/token endpoints; unauthenticated requests return 401 with the correct `WWW-Authenticate`.                                                                                                                                                                            |
| Complete authorization protocol | Real password login, explicit Project approval and successful PKCE S256 code exchange; official SDK initialization, tool listing and actual data calls. Browser denial yields `access_denied` without a code.                                                                                                                    |
| Resource and Project bounds     | Independently approved A and its two records are readable; unapproved B, another Project and unapproved export are denied. New B is excluded from the old delegation and becomes readable only after revoking prior consent and explicitly consenting again.                                                                     |
| Revocation and expiry           | The same unexpired OAuth token loses A immediately after revocation. B stops being readable at actual wall-clock expiry. Original delegation expiry and original OAuth JWT expiry both yield 401; that delegation had already expired when the JWT expired, so these are not claimed as isolated proofs of each rejection cause. |
| Existing features and entries   | An ordinary password session still reads the original 2,409-resource Project; cross-Project and revoked-session reads are denied. Thirty other container IDs, images and start times are unchanged. Existing HAProxy sections are preserved; 7770/7800 HTTPS responses match their configured backends.                          |
| Routing and registration        | Auth still denies REST, Storage and gateway status routes. Registration settings and denial are recorded below.                                                                                                                                                                                                                  |

Changes and verification are recorded in [PR #87](https://github.com/linancn/wiser/pull/87), [PR #88](https://github.com/linancn/wiser/pull/88), [PR #89](https://github.com/linancn/wiser/pull/89) and [PR #90](https://github.com/linancn/wiser/pull/90). All six CI lanes and the aggregate gate passed for each change. The deployment maintainer retains JSON acceptance receipts and rollback configuration; authentication materials are not published in this guide. Test resources are explicitly synthetic permission fixtures, not scientific black-odor water data or professional review conclusions.

### Self-registration status

Public self-registration was disabled on 2026-09-26 at the deployment owner's explicit request. Production `/auth/v1/settings` returns `disable_signup=true`; persistent GoTrue configuration sets `GOTRUE_DISABLE_SIGNUP=true`, matching `[auth] enable_signup=false` in the repository. A public `POST /auth/v1/signup` returned `422 signup_disabled`. The check contained no password and created no test account.

Email/password sign-in for existing accounts remains enabled. Account, Session, Project and membership counts were unchanged. Contact the Project maintainer for an authorized account-provisioning or invitation workflow; account activation does not grant Project access automatically. These checks do not replace personal sign-in, email invitation or real MCP client end-to-end acceptance.
