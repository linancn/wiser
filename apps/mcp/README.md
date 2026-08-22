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

当前共享 Server 注册 EXCON 与可选 Data 模块。Tool、Resource 与工作流的完整清单只在文档站维护。 / The shared server currently registers EXCON and the optional Data module. Complete Tool, Resource, and workflow catalogs live only in the documentation site.

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

独立 HTTP 默认端口是 `3100`；`POST /mcp` 是 MCP 入口，`GET /health/live` 与 `GET /health/ready` 是无认证健康检查。 / Standalone HTTP defaults to port `3100`; `POST /mcp` is the MCP endpoint, while `GET /health/live` and `GET /health/ready` are unauthenticated health checks.

## 配置边界 / Configuration boundary

- Gateway 总会初始化 EXCON client；只使用 Data 模块时也必须配置非空 `AGENT_EXCON_API_KEY`，但只有调用 `excon_*` 才要求它是绑定 RunAgent 的真实 credential。`AGENT_EXCON_API_URL` 仍必须与 protocol version 一致。 / The Gateway always initializes the EXCON client, so Data-only use still configures a non-empty key. It must be a real RunAgent-bound credential only when invoking `excon_*`.
- Data 模块要求 `DATA_API_URL`、`DATA_API_BEARER_TOKEN`、`DATA_TENANT_ID`、`DATA_PROJECT_ID` 与 `DATA_PURPOSE` 五项全部存在；全部缺失时不注册 Data，部分配置时启动失败。 / The Data module requires all five values; no Data configuration omits the module, while partial configuration fails startup.
- HTTP transport 要求 `DATA_MCP_BEARER_TOKEN`；`DATA_MCP_HOST` 与 `DATA_MCP_PORT` 只配置监听边界。 / HTTP transport requires `DATA_MCP_BEARER_TOKEN`; host and port configure only its listener.
- 两层 bearer 不可互换：`DATA_MCP_BEARER_TOKEN` 只认证 `/mcp` 网关边界，`DATA_API_BEARER_TOKEN` 作为统一 WISER identity 发送到 Data API；EXCON 另用绑定 RunAgent 的 API credential。
- The two bearer layers are not interchangeable: `DATA_MCP_BEARER_TOKEN` authenticates only `/mcp`, while `DATA_API_BEARER_TOKEN` carries unified WISER identity downstream; EXCON uses its own RunAgent-bound API credential.
- 所有 token 都留在进程环境，禁止进入 Tool 参数、Resource URI、日志、遥测或 Git。 / Keep every token in the process environment; never place one in Tool arguments, Resource URIs, logs, telemetry, or Git.

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
