---
title: 本机开发环境
description: WISER 完整栈、单应用开发、端口、身份、日志、停止与重置参考。
docType: runbook
scope: repository
status: active
authoritative: true
owner: wiser
language: zh-CN
whenToUse:
  - 选择本机运行模式或排查服务启动问题时
whenToUpdate:
  - Compose profile、端口、脚本或环境变量变化时
checkPaths:
  - package.json
  - compose.yaml
  - .env.example
  - scripts/data-foundation/**
lastReviewedAt: 2026-08-22
lastReviewedCommit: ccd874eda8e16f8fd9169ec2f2769ff17f287c48
---

## 运行模式

| 模式         | 命令                      | 能证明什么                                                                 |
| ------------ | ------------------------- | -------------------------------------------------------------------------- |
| 完整平台     | `pnpm stack:full:up`      | 统一 Auth、持久 EXCON API、Data Foundation、Data MCP 与登录 Web 的默认集成 |
| 基础栈       | `pnpm stack:up`           | Supabase + 默认 Compose；API 使用本机兼容配置，不启用 Data profile         |
| Data profile | `pnpm data:up`            | 在已可用的本机 Supabase 身份上启动默认服务和全部 Data 基础设施             |
| 可观测性     | `pnpm observability:up`   | 在共享应用镜像已构建后启动 Telemetry Ingress 与 OTel/Grafana 栈            |
| 单应用       | 使用下面的 workspace 命令 | 纯 UI、协议或单元测试循环                                                  |

`data:up` 不是脱离平台的独立数据栈：它读取运行中的本机 Supabase 状态、登录 seed operator，并通过 Compose profile 连同默认应用服务一起收敛。干净机器应优先使用 `stack:full:up`。

## 主要端口

| 服务                                         | 本机入口                                             |
| -------------------------------------------- | ---------------------------------------------------- |
| Web                                          | `http://127.0.0.1:3000`                              |
| API / OpenAPI                                | `http://127.0.0.1:3001` / `/openapi.json`            |
| Agent EXCON Worker health                    | `http://127.0.0.1:3002/health/ready`                 |
| Docs                                         | `http://127.0.0.1:4321`                              |
| Data Worker health                           | `http://127.0.0.1:13003/health/ready`                |
| MCP HTTP                                     | `http://127.0.0.1:13004/mcp`                         |
| Supabase API / PostgreSQL / Studio / Mailpit | `56321` / `56322` / `56323` / `56324`                |
| data-postgres                                | `127.0.0.1:55432`                                    |
| SeaweedFS S3                                 | `http://127.0.0.1:18333`                             |
| Weaviate                                     | `http://127.0.0.1:18080`                             |
| OpenSearch / Dashboards                      | `https://127.0.0.1:19200` / `http://127.0.0.1:15601` |
| Neo4j HTTP                                   | `http://127.0.0.1:17474`                             |
| Tika / ClamAV                                | `http://127.0.0.1:19998` / `127.0.0.1:13310`         |
| Telemetry ingress / Grafana / Prometheus     | `14318` / `3300` / `9090`                            |
| OTel gRPC / HTTP / health                    | `4317` / `4318` / `13133`                            |

GeoServer、STAC API、TiTiler 与 Martin 没有 host port；只能由统一 Auth 后的 API 代理访问。

## 单应用命令

在不同终端中按需启动：

```bash
pnpm --filter @wiser/api dev
pnpm --filter @wiser/web dev
pnpm --filter @wiser/docs dev
```

也可以用 `pnpm dev` 并行启动这三个进程：Web 固定在 `3000`，API 默认使用 `3001`，Docs 固定在 `4321`。API 在缺少生产配置时使用 Auth off、Agent EXCON memory、Data Foundation off 的本机兼容模式。这个模式适合协议和 UI 循环，不验证统一 Auth、数据库持久化或 Data 功能。

## 身份边界

Data Foundation Web 使用 Supabase SSR Session，完整栈会为 Data smoke 和 Data MCP 注入本机 operator JWT。Agent EXCON live Web 仍从服务端 `WISER_WEB_OPERATOR_TOKEN` 读取 operator credential；EXCON MCP 仍需要绑定具体 RunAgent 的 `AGENT_EXCON_API_KEY`。因此“进程健康”不等于这两个 EXCON 客户端已经获得有效身份，失败时必须保留显式 unavailable/鉴权错误。

共享 MCP 进程总会初始化 EXCON HTTP client；即使只开发 Data MCP，也必须提供有效的 `AGENT_EXCON_API_KEY`，同时再提供完整 `DATA_*` 配置。不要把 Compose 的本机占位 token 当成统一 Auth 凭据。

## 环境变量与秘密

`.env.example` 是变量目录，不是可直接用于生产的配置。完整栈会把本机生成的秘密保存在被 Git 忽略的 `.wiser/local/runtime-secrets.json`。不要提交 `.env`、数据库 URL、S3 key、Supabase service-role、HMAC key、MCP token 或 Codex 登录文件。

浏览器只能接收 `NEXT_PUBLIC_SUPABASE_URL` 与 publishable key；数据库、对象存储、投影与 operator credential 必须保留在服务端。

## 日志、停止与重置

```bash
pnpm data:logs
pnpm observability:smoke
pnpm data:down
pnpm stack:down
```

若完整栈失败，先检查 Docker 资源、端口占用和失败服务日志，再重新运行可幂等收敛的 `pnpm stack:full:up`。`pnpm supabase:verify` 会重置本机 Supabase；只有确定要丢弃 Data Foundation 本机数据时，才使用快速开始中的确认式 `data:reset`。
