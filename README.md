---
title: WISER 项目入口
docType: overview
scope: repository
status: active
authoritative: true
owner: wiser
language: zh-CN
whenToUse:
  - 第一次了解、启动或进入 WISER 仓库时
whenToUpdate:
  - 系统边界、应用进程、启动命令或公开入口变化时
checkPaths:
  - apps/**
  - packages/**
  - examples/**
  - compose.yaml
  - package.json
lastReviewedAt: 2026-08-22
lastReviewedCommit: ccd874eda8e16f8fd9169ec2f2769ff17f287c48
---

# WISER · 水地图

[English](./README.en.md) · 中文（默认）

**wiser water, better future**

WISER 是承载水智能产品的多系统平台。仓库内的业务系统共享 Supabase Auth、Web Shell、API Host、MCP Gateway、文档站、设计语言和可观测性，但各自保留独立的领域契约、核心逻辑、Worker 与数据权威。

## 系统与入口

| 系统                       | 面向人的前端                                  | 对外后端入口                                           | 主要源码                                                                                                                                                                                  |
| -------------------------- | --------------------------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WISER Platform             | 登录、用户菜单与统一 Shell：`/zh-CN/login`    | 身份与委托：`/api/platform/v1`                         | `packages/platform-*`、`apps/api/src/platform`、`apps/web/src/components/app-shell.tsx`、`apps/web/src/components/current-user-control.tsx`、`apps/web/src/app/[locale]/auth`、`supabase` |
| Agent EXCON                | 场景与 Run：`/zh-CN/scenarios`、`/zh-CN/runs` | HTTP：`/api/v2`；MCP：`/mcp`                           | `packages/contracts`、`packages/core`、`packages/infra`、`packages/excon-scenarios`；`apps/worker` 仅属 v1 compatibility                                                                  |
| Data Foundation / 数据基座 | 数据工作区：`/zh-CN/data-foundation`          | REST：`/api/data/v1`；GraphQL：`/graphql`；MCP：`/mcp` | `packages/data-*`、`apps/api/src/data-foundation`、`apps/data-worker`、`infrastructure/data-foundation`                                                                                   |

所有浏览器、Skill 和 MCP 客户端都通过 HTTP 边界访问业务能力，不直连数据库、对象存储或投影。系统级说明见[平台架构](./apps/docs/src/content/docs/zh-CN/architecture/wiser-platform.md)。

`/mcp` 是共享 Gateway：Agent EXCON Tool 使用 `excon_*` 命名与 RunAgent credential，Data Tool 使用 `data_*` 命名与 Data API identity；两套下游身份不能互换。发现和调用流程见各自 MCP 协议页。

## 应用进程

| 路径                     | 类型        | 职责                                                                                             | 完整栈入口                            |
| ------------------------ | ----------- | ------------------------------------------------------------------------------------------------ | ------------------------------------- |
| `apps/web`               | 前端        | WISER 产品界面；中文默认，支持英文与深浅色主题                                                   | `http://127.0.0.1:3000/zh-CN`         |
| `apps/docs`              | 前端        | 全系统 Fumadocs 文档站                                                                           | `http://127.0.0.1:4321`               |
| `apps/api`               | 后端        | 统一 Fastify Host；组合 Platform、Agent EXCON、Data Foundation                                   | `http://127.0.0.1:3001`               |
| `apps/worker`            | 后端 Worker | PostgreSQL-backed v1 compatibility/testing Worker；默认 API 不 enqueue，v2 在 API service 内评价 | `http://127.0.0.1:3002/health/ready`  |
| `apps/data-worker`       | 后端 Worker | Data Foundation 入库、质量、发布与投影任务                                                       | `http://127.0.0.1:13003/health/ready` |
| `apps/mcp`               | 协议网关    | 将 Agent EXCON 与 Data Foundation MCP Tool 映射到 HTTP API                                       | `http://127.0.0.1:13004/mcp`          |
| `apps/telemetry-ingress` | 可选后端    | 认证、限流并脱敏外部 RunAgent 的 OTLP/HTTP 遥测                                                  | `http://127.0.0.1:14318`              |

Supabase Studio、数据库、对象存储、检索/GIS 与可观测性服务的完整端口表见[本机开发环境](./apps/docs/src/content/docs/zh-CN/development/local-environment.md)。

## 启动完整平台

需要 Node.js 24、Corepack、Docker Engine 与 Docker Compose。版本范围以 [`package.json`](./package.json) 为准。

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm stack:full:up
```

首次构建和 Data 端到端 smoke 会花费一些时间；命令成功返回后，默认服务和 Data 验证路径可用。Agent EXCON live Web/MCP 仍需要后文所述的专用 credential。打开：

- 产品界面：<http://127.0.0.1:3000/zh-CN>
- 文档：<http://127.0.0.1:4321>
- API 健康检查：<http://127.0.0.1:3001/health/ready>
- Supabase Studio：<http://127.0.0.1:56323>

本机种子账号仅供 fixture 使用：

```text
operator@agent-excon.test
WiserLocalOperator-2026!
```

停止服务并保留本机数据：

```bash
pnpm stack:down
```

第一次完整运行见[快速开始](./apps/docs/src/content/docs/zh-CN/quick-start.md)；分步运行、日志、全部端口与故障排查见[本机开发环境](./apps/docs/src/content/docs/zh-CN/development/local-environment.md)。`stack:down` 会保留命名卷和 `.wiser/local` 中的本机重放密钥；不要在仍需恢复 EXCON journal 时删除这些历史 key。

## 开发与验证

不启动完整基础设施时，使用本机兼容配置并行运行 API、Web 与文档：

```bash
pnpm dev
```

也可以在独立终端只运行需要的进程：

```bash
pnpm --filter @wiser/api dev
pnpm --filter @wiser/web dev
pnpm --filter @wiser/docs dev
```

这些模式不启用统一 Auth、EXCON PostgreSQL journal 或 Data Foundation；准确边界见[开发手册](./apps/docs/src/content/docs/zh-CN/development/index.md)。提交前的主验证入口是：

```bash
pnpm verify
```

它覆盖格式、type-aware lint、全部 workspace 类型/单元测试/build 与默认 Compose config；不包含数据库 reset/集成、Playwright、Data/observability smoke 或 Docpact。

数据库改动按权威边界追加门禁。`supabase:verify` 是真实 reset/pgTAP/RLS 验证并会清空本机 Supabase；`data:verify` 只做 Data 脚本/workspace/Compose 静态验证，真实 Data schema/存储/投影改动还要在可丢弃环境运行 `stack:full:up` 或开发手册中的 migrate/seed/smoke 顺序：

```bash
pnpm supabase:verify  # Supabase/Platform/EXCON database changes
pnpm data:verify      # Data static/workspace gate
pnpm stack:full:up    # Data live integration when required
```

仓库采用 Red → Green → Refactor、小提交和 Docpact 文档治理。完整流程见 [`CONTRIBUTING.md`](./CONTRIBUTING.md)。

## 仓库目录

```text
apps/           可运行的前端、API、协议网关与 Worker
packages/       平台和业务系统的契约、纯核心、适配器与运行时资产
examples/       按系统归属的可执行教程、Lab 与 Showcase
infrastructure/ Docker、Data Foundation 与可观测性基础设施
skills/         通过公开协议使用 WISER 的 Agent Skills
supabase/       统一 Auth、平台控制面与 Agent EXCON 数据库资产
tests/          跨应用、工具链与验收测试
```

依赖方向固定为 `platform contracts <- system contracts <- core <- application <- infra/apps`。新的业务系统应接入共享宿主，而不是从其他系统的 core 或 infra 取捷径。

## 文档

- [文档首页](./apps/docs/src/content/docs/zh-CN/index.mdx)
- [快速开始](./apps/docs/src/content/docs/zh-CN/quick-start.md)
- [开发手册](./apps/docs/src/content/docs/zh-CN/development/index.md)
- [数据库与迁移](./apps/docs/src/content/docs/zh-CN/development/databases.md)
- [测试与验证](./apps/docs/src/content/docs/zh-CN/development/testing.md)
- [平台架构](./apps/docs/src/content/docs/zh-CN/architecture/wiser-platform.md)
- [接口文档](./apps/docs/src/content/docs/zh-CN/protocols/meta.json)

每个文档站页面都有相同 slug 的英文版本。`apps/docs` 是面向人的权威文档系统；组件 README 只说明当前目录的职责与直接运行方式。

## 许可与安全

代码采用 [MIT License](./LICENSE)。场景数据和第三方材料遵循各自的 `PROVENANCE.md` 与数据许可。不要公开本机 Supabase、数据库、对象存储或开发默认凭据；安全报告方式见 [`SECURITY.md`](./SECURITY.md)。
