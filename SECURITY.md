---
title: WISER security policy
docType: policy
scope: repository
status: active
authoritative: true
owner: wiser
language: bilingual
whenToUse:
  - when reporting a vulnerability or handling security-sensitive development data
whenToUpdate:
  - when reporting channels, supported boundaries, or secret-handling rules change
checkPaths:
  - SECURITY.md
  - apps/docs/src/content/docs/*/architecture/security.md
  - supabase/**
  - infrastructure/**
lastReviewedAt: 2026-08-22
lastReviewedCommit: 9b08f11b30895f78063d42881a16e62bb3ffc054
---

# Security policy / 安全策略

WISER is pre-1.0 software. Its local Supabase, databases, object storage, projection services, observability endpoints, seeded accounts, and Compose defaults are development fixtures and must not be exposed to the public internet. / WISER 尚处于 1.0 之前；本机 Supabase、数据库、对象存储、投影服务、可观测性端点、种子账号和 Compose 默认值都只能用于开发，不能暴露到公网。

## Report privately / 私下报告

Do not open a public issue for a suspected vulnerability. Use a private GitHub repository security advisory until the maintainers publish a dedicated security address. Include the affected commit/version, boundary, impact, and the smallest safe reproduction. / 怀疑存在漏洞时不要创建公开 Issue；在维护者公布专用安全邮箱前，请使用 GitHub 仓库的私有 Security Advisory，并说明受影响提交/版本、边界、影响和最小安全复现。

Never attach real credentials, participant or personal data, hidden outcomes, production objects, raw prompts/completions, database dumps, or production logs. Redact request IDs and traces if they can identify a person or secret. / 不要附带真实凭据、参训者或个人数据、隐藏 Outcome、生产对象、原始 prompt/completion、数据库转储或生产日志；可能识别个人或秘密的 request ID/trace 也要脱敏。

## Secrets and trust boundaries / 秘密与信任边界

- Never commit Supabase service-role keys, JWTs, database passwords, S3 keys, HMAC key rings, MCP/API tokens, Task lease tokens, or `.env` files. / 不提交上述任何密钥或 `.env`。
- Never mount or copy `~/.codex/auth.json` into a container, fixture, log, artifact, or issue. / 不把 Codex 登录文件放进容器、fixture、日志、工件或 Issue。
- Browser code receives only publishable Supabase values and safe DTOs. Database, object-store, projection, operator, and delegated credentials remain server-side. / 浏览器只接收 publishable Supabase 值和安全 DTO。
- Telemetry is best-effort diagnostic data and must not contain prompts, completions, tool bodies, feedback bodies, hidden outcomes, or credentials. / Telemetry 不能携带敏感正文或凭据。
- Data projections are rebuildable and never become authorization, acceptance, publication, or identity authority. / 可重建投影不承担授权、验收、发布或身份权威。

Security fixes should add a regression test whenever disclosure risk permits and must verify fail-closed behavior for malformed, missing, expired, revoked, or cross-scope identity. The detailed security model is in the bilingual [architecture guide](./apps/docs/src/content/docs/en/architecture/security.md) / [安全架构](./apps/docs/src/content/docs/zh-CN/architecture/security.md).
