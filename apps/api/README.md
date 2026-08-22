---
title: WISER shared HTTP API component guide
description: Bilingual process guide for running, configuring, and verifying the shared WISER Fastify API host.
docType: component-guide
scope: apps/api
status: active
authoritative: true
owner: wiser
language: bilingual
whenToUse:
  - when changing, running, or locating the owning module for a public boundary in the shared WISER HTTP API process
whenToUpdate:
  - when API entrypoints, route prefixes, runtime modes, or focused commands change
checkPaths:
  - apps/api/**
  - packages/contracts/**
  - packages/platform-*/**
  - packages/data-*/**
  - packages/excon-scenarios/**
  - .env.example
  - compose.yaml
lastReviewedAt: 2026-08-22
lastReviewedCommit: ed36c7913b5dd2b2542adf1aa1ce1e5d9a70029f
---

# WISER API / WISER 共享 API

## 职责 / Responsibility

`@wiser/api` 是 WISER Platform、Agent EXCON 与 Data Foundation 的共享 Fastify 组合宿主。它负责 HTTP、统一身份上下文、模块注册、健康检查和 OpenAPI 边界；系统业务规则仍属于各自的 core/application，客户端不得绕过 API 直读数据库。 / `@wiser/api` is the shared Fastify composition host for WISER Platform, Agent EXCON, and Data Foundation. It owns HTTP, unified identity context, module registration, health checks, and OpenAPI; system rules remain in their core/application layers, and clients must not bypass the API to read databases.

## 入口 / Entrypoints

- 进程入口 / process entry: `apps/api/src/main.ts`
- Fastify 组合根 / composition root: `apps/api/src/app.ts`
- Platform 模块 / Platform modules: `apps/api/src/platform/`
- Agent EXCON v2 / Agent EXCON v2: `apps/api/src/v2-routes.ts`
- Data Foundation 模块 / Data Foundation modules: `apps/api/src/data-foundation/`

| 公共边界 / Public boundary                       | 所属系统 / Owner                                        |
| ------------------------------------------------ | ------------------------------------------------------- |
| `/api/platform/v1/*`                             | WISER Platform identity and delegation                  |
| `/api/v1/*`, `/api/v2/*`                         | Agent EXCON compatibility and current protocol          |
| `/api/data/v1/*`                                 | Data Foundation REST, resources, and governed GIS proxy |
| `/graphql`                                       | Data Foundation GraphQL                                 |
| `/health/live`, `/health/ready`, `/openapi.json` | Shared process operations and API discovery             |

完整路由、请求结构和授权语义以文档站的协议参考为准，不在组件 README 中维护第二份清单。 / The documentation-site protocol references are authoritative for routes, payloads, and authorization semantics; this component guide does not duplicate them.

## 运行 / Run

包含统一 Auth 和两个系统依赖的推荐入口 / Recommended entry with unified Auth and both systems:

```bash
pnpm stack:full:up
```

仅做 API 协议或单元开发 / API-only protocol or unit development:

```bash
pnpm --filter @wiser/api dev
```

默认监听 `http://127.0.0.1:3001`。独立开发模式可使用 Auth off、EXCON memory、Data off，因此不能证明完整集成。生产构建使用 `pnpm --filter @wiser/api build` 后运行 `pnpm --filter @wiser/api start`。 / The default endpoint is `http://127.0.0.1:3001`. Standalone development may use Auth off, EXCON memory, and Data off, so it does not prove full integration. For a production build, run `pnpm --filter @wiser/api build` and then `pnpm --filter @wiser/api start`.

## 配置边界 / Configuration boundary

- `API_HOST`, `API_PORT`, and `API_CORS_ORIGIN` configure only the HTTP process boundary.
- `WISER_AUTH_MODE` selects unified Auth; Supabase URL/key and the control-plane database remain server-only.
- `EXCON_V2_MODE` selects the EXCON runtime; persistent journal and lease-key settings remain server-only.
- `DATA_FOUNDATION_MODE` enables Data Foundation only with unified Auth and its complete database, object-store, Worker, and internal-service configuration.
- `.env.example`, `compose.yaml`, and runtime config loaders are the variable sources of truth; do not copy secrets, version pins, or persistence algorithms into this README.

## 验证 / Verify

```bash
pnpm --filter @wiser/api test
pnpm --filter @wiser/api typecheck
pnpm --filter @wiser/api build
pnpm verify
```

涉及 Supabase、RLS 或 Data PostgreSQL 时，另运行 `pnpm supabase:verify` 或 `pnpm data:verify`。 / For Supabase, RLS, or Data PostgreSQL changes, also run `pnpm supabase:verify` or `pnpm data:verify`.

## 权威文档 / Authoritative documentation

- [后端开发](../docs/src/content/docs/zh-CN/development/backend.md) / [Backend development](../docs/src/content/docs/en/development/backend.md)
- [统一 Auth 与 Platform HTTP](../docs/src/content/docs/zh-CN/architecture/unified-auth.md) / [Unified Auth and Platform HTTP](../docs/src/content/docs/en/architecture/unified-auth.md)
- [本机开发环境](../docs/src/content/docs/zh-CN/development/local-environment.md) / [Local environment](../docs/src/content/docs/en/development/local-environment.md)
- [Agent EXCON HTTP](../docs/src/content/docs/zh-CN/protocols/http.md) / [Agent EXCON HTTP](../docs/src/content/docs/en/protocols/http.md)
- [Data REST](../docs/src/content/docs/zh-CN/protocols/data-rest.md) / [Data REST](../docs/src/content/docs/en/protocols/data-rest.md); [Data GraphQL](../docs/src/content/docs/zh-CN/protocols/data-graphql.md) / [Data GraphQL](../docs/src/content/docs/en/protocols/data-graphql.md)
