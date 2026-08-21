---
title: 统一身份与授权
description: 一套 Supabase Auth 如何为 WISER Platform、Agent EXCON 与 Data Foundation 提供身份、租户、项目和委托凭据。
docType: security-guide
scope: wiser-auth
status: active
authoritative: true
owner: wiser
language: zh-CN
whenToUse:
  - 修改登录、JWT、Session、租户、项目、Role、Scope 或 Agent 委托时
whenToUpdate:
  - 身份源、Membership、RLS、凭据或撤权语义变化时
checkPaths:
  - supabase/**
  - apps/api/**
  - apps/web/**
  - apps/mcp/**
  - apps/telemetry-ingress/**
lastReviewedAt: 2026-08-22
lastReviewedCommit: 0ccec4db0435f04becdd27c377b977f1e3f238f4
---

## 单一身份源

全 WISER 只使用现有 Supabase Auth、JWT signing keys/JWKS、Session 和 PostgreSQL 控制面。Data Foundation 的独立 data-postgres 不创建用户、Membership、Role 或 Token 权威表。

JWT 证明主体、认证强度与 Session；动态 Tenant、Project、Role 和 Scope 从 Supabase 控制面解析。`user_metadata` 可由用户修改，绝不参与授权；动态权限也不完整复制进 JWT，因为 claims 只有刷新 Token 后才变化。

当前已交付 `platform` / `platform_private` Schema、用户自动建档、Tenant/Project/Membership、Role/Scope/Binding、Delegation、私有 Credential/Audit/Outbox、最小权限与 50 项 pgTAP 控制面契约。框架无关的 `SupabaseJwtPrincipalResolver`、`getClaims` 结果验证器和单查询 PostgreSQL Membership loader 已能组合并 fail closed；委托凭据签发仍属于下一授权接线里程碑。

Fastify 已提供 `platform.identity` 模块和 `/api/platform/v1/me` 安全投影。`WISER_AUTH_MODE=supabase` 会在默认进程中创建最新稳定 `supabase-js` client、受限 PostgreSQL Pool 和 fail-closed Resolver；生产缺少任何必要配置时拒绝启动，进程关闭时释放 Pool。委托凭据签发仍是后续里程碑。

Web 已使用最新稳定 `@supabase/ssr` 建立 Browser/Server Client 与 Next.js 16 `proxy.ts`。Proxy 在响应产生前调用 `getClaims()`，刷新后的 Cookie 同时写回 request/response，并设置 `private, no-store`；登录、回调、退出页面和当前用户 Token 转发仍在后续纵切实现。

委托凭据的密码学边界现已可执行：严格解析 `wdc1.<key-id>.<secret>`，使用 Node 安全随机源分别生成 128-bit locator 与 256-bit secret，数据库只保存经过域隔离的 HMAC-SHA-256。JSON key ring 只接受至少 256-bit 的规范无填充 base64url key，指定一个 active key 负责新签发，同时保留旧 key 支持轮换期验证；任何配置错误都 fail closed，且不会回显秘密。数据库签发/轮换事务与 delegated principal Resolver 属于下一授权纵切。

## 控制面模型

```text
platform.actors
platform.user_profiles
platform.tenants
platform.tenant_memberships
platform.projects
platform.project_memberships
platform.roles
platform.role_scopes
platform.role_bindings
platform.delegations

platform_private.delegated_credentials
platform_private.authorization_audit_events
platform_private.control_outbox
```

- Actor 统一表示 human、agent 与 service；human actor 关联 `auth.users.id`。
- Tenant 是顶级隔离边界；Project 是业务资源所有权边界。
- Tenant Membership 不自动授予任意 Project 数据访问。
- Role 与 Scope 分开建模；Scope 使用 `platform.*`、`excon.*`、`data.*` 命名空间。每个 Role 还带 fail-closed 的 L0–L3 安全等级 ceiling；实时授权上下文取调用方 active bindings 中的最高 ceiling。
- 所有暴露表启用 RLS，并同时使用主体、Tenant、Project 和所有权谓词；`TO authenticated` 本身不构成授权。
- 特权函数进入未暴露 schema，固定安全 `search_path`，撤销默认 `PUBLIC EXECUTE`。

## 请求处理

```text
Bearer credential
→ Supabase JWT / delegated / local Resolver
→ 验证签名、issuer、audience、expiry、session 或 delegation
→ 查询 Supabase Membership/Role/Scope
→ PlatformPrincipal + AuthorizedContext（包含 maxSecurityLevel）
→ AuthorizationService(capability, purpose, resource, security level, fields, volume)
→ 系统 Handler
→ append-only 审计
```

JWT 失败后不得回退到 Local Token，防止 token confusion。Local Token 只允许在明确的 development/test 模式使用，生产环境检测到该配置必须拒绝启动。

## Web Session

Web 使用 Supabase SSR Cookie。Server Component 转发当前 Access Token，Fastify 再次验证并授权。浏览器只获得 Supabase URL 与 publishable key；service role、secret key、数据库连接、对象存储密钥和内部投影凭据均不得进入客户端。

`WISER_WEB_OPERATOR_TOKEN` 不再代表交互式用户。需要平台诊断的服务账户必须拥有明确 Scope，且只能在服务端使用。

## Agent 与 MCP 委托

用户或服务通过授权 API 为具体 Agent/Run/Project 签发短期 delegated credential。请求 Scope 与委托人实时 Scope 求交集，Purpose、安全等级上限和有效期固化在 Delegation 中。

- 委托链第一版最大深度为一。
- 明文 credential 只返回一次；数据库保存带服务器 Pepper 的 HMAC。
- 委托 Bearer Token 固定使用 `wdc1.<key-id>.<secret>` 封装；公开 key id 只定位私有记录，`hmac_key_id` 选择可轮换的服务端密钥且不会暴露密钥本身。
- 验证时只用公开 key id 定位记录，在进程内重算 HMAC 并执行固定长度的 timing-safe 比较；未知 key、畸形 Token 与 HMAC 不匹配使用同一失败表面。
- Delegation 带乐观版本；撤销和轮换保留旧 Credential 安全事实，删除 Tenant、Project 或 Delegation 不得级联擦除历史。
- 撤销委托人 Membership、Project、Agent 或 credential 后，下一次请求失败。
- MCP Tool 参数、Message、Artifact、日志与 Trace 不得包含凭据。
- EXCON 私有表只保留通用 credential 与 `runAgentId/runId` 的绑定。

## Data Foundation 跨库引用

data-postgres 只保存 Tenant、Project、Actor UUID 与策略版本，不复制 Supabase Session 或秘密。只读 `control_ref` 可帮助后台一致性检查，但绝不扩大权限。查询、下载、导出、审核和发布前，API 必须用 Supabase 权威上下文再次授权。

## 必测失败路径

- 错误签名、issuer、audience、过期、未生效、未知 key、错误 Session。
- 跨 Tenant/Project 替换 ID、Header 或资源引用。
- 已撤销 Membership、Delegation、Credential、Agent 或 Project。
- 越权 Scope、Purpose、安全等级、字段或导出量。
- RLS 对 anon、authenticated、API、Worker 和迁移角色的隔离。
- 浏览器、MCP、日志和 Telemetry 中不存在任何服务器秘密。
