---
title: WISER MCP Gateway component guide
description: Bilingual process guide for running, configuring, and verifying the shared WISER MCP adapter.
docType: component-guide
scope: apps/mcp
status: active
authoritative: true
owner: wiser
language: bilingual
whenToUse:
  - when changing, running, integrating, or locating transport and system-module boundaries in the shared MCP Gateway
whenToUpdate:
  - when MCP entrypoints, transports, module composition, or credential boundaries change
checkPaths:
  - apps/mcp/**
  - apps/api/**
  - packages/contracts/**
  - packages/data-contracts/**
  - skills/agent-excon/**
  - skills/wiser-data-foundation/**
  - .env.example
  - compose.yaml
lastReviewedAt: 2026-08-22
lastReviewedCommit: ed36c7913b5dd2b2542adf1aa1ce1e5d9a70029f
---

# WISER MCP Gateway / WISER MCP 网关

## 职责 / Responsibility

`@wiser/mcp` 把 Agent EXCON 与 Data Foundation 的公开 HTTP 能力适配为同一个 MCP Server。业务 Tool 与动态 Resource 只调用 `@wiser/api`，不导入 application service，也不读取数据库、journal 或投影。唯一例外是 `scenario-resource.ts` 中编译进进程的静态双语场景说明；它不含 Run 状态或权威数据，场景包与文档站仍是事实来源。 / Business Tools and dynamic Resources call only `@wiser/api`. The sole exception is a compiled static bilingual scenario guide in `scenario-resource.ts`; it carries no Run state or authority data, and the scenario package/docs remain authoritative.

## 入口 / Entrypoints

- stdio: `apps/mcp/src/index.ts`
- Streamable HTTP: `apps/mcp/src/http-main.ts`
- shared server composition: `apps/mcp/src/server.ts`
- Agent EXCON HTTP adapter: `apps/mcp/src/http-client.ts`
- Data Foundation module: `apps/mcp/src/data-foundation/`

固定凭据模式注册 EXCON 与可选 Data 模块；OAuth 模式注册当前用户和项目授权的数据能力及安全连接上下文。Tool、Resource 与工作流的完整清单只在文档站维护。 / Static mode registers EXCON and optional Data modules; OAuth mode registers project-bound Data capabilities and safe connection context. Complete catalogs live in the documentation site.

## 运行 / Run

完整平台会在 `http://127.0.0.1:13004/mcp` 启动 HTTP Gateway / The full platform starts the HTTP Gateway at `http://127.0.0.1:13004/mcp`:

```bash
pnpm stack:full:up
```

本机 stdio / Local stdio:

```bash
pnpm --filter @wiser/mcp build
pnpm --filter @wiser/mcp start
```

独立 HTTP 开发 / Standalone HTTP development:

```bash
pnpm --filter @wiser/mcp dev:http
```

独立 HTTP 默认端口是 `3004`；`POST /mcp` 是 MCP 入口，`GET /health/live` 与 `GET /health/ready` 是无认证健康检查。 / Standalone HTTP defaults to port `3004`; `POST /mcp` is the MCP endpoint, while `GET /health/live` and `GET /health/ready` are unauthenticated health checks.

## 配置边界 / Configuration boundary

`WISER_MCP_AUTH_MODE=oauth` 要求 `DATA_API_URL`、`WISER_AGENT_MCP_RESOURCE` 与 `WISER_AGENT_AUTH_ISSUER`，并要求 API 已启用对应 Agent 模块。每个请求通过 HTTP 向 API 交换最长 60 秒的受限 credential，再建立独立 Data handler；不初始化 EXCON，也不使用共享 transport/API credential。`wiser_connection` Tool 与 `wiser://connection` Resource 只返回安全的项目和授权 metadata。 / OAuth mode requires these three values and the API Agent module. Every request exchanges its OAuth bearer over HTTP for a bounded credential and builds an isolated Data handler. Connection discovery contains no secrets.

OAuth 模式公开 `/.well-known/oauth-protected-resource/mcp`（以及根目录别名），并在 `401` challenge 中提供发现地址。resource 与 issuer 必须精确匹配公开地址；非回环地址要求 HTTPS。携带无关 `Origin` 的浏览器请求被拒绝，交换请求禁止重定向并限制响应大小与超时。 / OAuth resource metadata and the `401` challenge support client discovery. Public resource/issuer values require HTTPS outside loopback; unrelated browser Origins are rejected, and exchanges enforce redirect, timeout and response-size bounds.

省略模式时保留 `WISER_MCP_AUTH_MODE=static` 的兼容行为。以下固定配置适用于该模式及 stdio。 / The default remains static compatibility; the fixed configuration below applies to static HTTP and stdio.

- HTTP host 支持固定 bearer 与逐请求 `authorize` 两种互斥配置。逐请求授权返回仅绑定当前调用的 handler，每次调用重新授权；授权依赖失败返回无敏感内容的 `503`，授权拒绝返回 `401`，健康检查独立可用。两种模式的 MCP 响应都禁止缓存。 / The HTTP host accepts mutually exclusive fixed-bearer or per-request `authorize` configuration. Each authorization returns a handler bound only to that request and is rechecked on every call. Authorization dependency failures return a private `503`, denials return `401`, and health probes remain independent. MCP responses in both modes are non-cacheable.
- Gateway 总会初始化 EXCON client；只使用 Data 模块时也必须配置非空 `AGENT_EXCON_API_KEY`，但只有调用 `excon_*` 才要求它是绑定 RunAgent 的真实 credential。`AGENT_EXCON_API_URL` 仍必须与 protocol version 一致。 / The Gateway always initializes the EXCON client, so Data-only use still configures a non-empty key. It must be a real RunAgent-bound credential only when invoking `excon_*`.
- Data 模块要求 `DATA_API_URL`、`DATA_API_BEARER_TOKEN`、`DATA_TENANT_ID`、`DATA_PROJECT_ID` 与 `DATA_PURPOSE` 五项全部存在；全部缺失时不注册 Data，部分配置时启动失败。 / The Data module requires all five values; no Data configuration omits the module, while partial configuration fails startup.
- HTTP transport 要求 `DATA_MCP_BEARER_TOKEN`；`DATA_MCP_HOST` 与 `DATA_MCP_PORT` 只配置监听边界。 / HTTP transport requires `DATA_MCP_BEARER_TOKEN`; host and port configure only its listener.
- 两层 bearer 不可互换：`DATA_MCP_BEARER_TOKEN` 只认证 `/mcp` 网关边界，`DATA_API_BEARER_TOKEN` 作为统一 WISER identity 发送到 Data API；EXCON 另用绑定 RunAgent 的 API credential。
- The two bearer layers are not interchangeable: `DATA_MCP_BEARER_TOKEN` authenticates only `/mcp`, while `DATA_API_BEARER_TOKEN` carries unified WISER identity downstream; EXCON uses its own RunAgent-bound API credential.
- 固定 token 留在进程环境；OAuth 与交换 token 仅存于当前请求内存和授权传输中，禁止进入 Tool 参数、Resource URI、日志、遥测或 Git。 / Static tokens stay in process configuration; OAuth and exchanged tokens stay in request memory and authenticated transport, never Tool arguments, Resource URIs, logs, telemetry or Git.

## 验证 / Verify

```bash
pnpm --filter @wiser/mcp test
pnpm --filter @wiser/mcp typecheck
pnpm --filter @wiser/mcp build
pnpm verify
```

## 权威文档 / Authoritative documentation

- [后端开发](../docs/src/content/docs/zh-CN/development/backend.md) / [Backend development](../docs/src/content/docs/en/development/backend.md)
- [Agent EXCON MCP](../docs/src/content/docs/zh-CN/protocols/mcp.md) / [Agent EXCON MCP](../docs/src/content/docs/en/protocols/mcp.md)
- [Data Foundation MCP](../docs/src/content/docs/zh-CN/protocols/data-mcp.md) / [Data Foundation MCP](../docs/src/content/docs/en/protocols/data-mcp.md)
- [本机开发环境](../docs/src/content/docs/zh-CN/development/local-environment.md) / [Local environment](../docs/src/content/docs/en/development/local-environment.md)
