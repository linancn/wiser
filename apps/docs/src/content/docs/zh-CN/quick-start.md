---
title: 快速开始
description: 从干净 checkout 安装依赖、启动完整 WISER、登录并确认默认服务与 Data 验证路径。
docType: workflow
scope: repository
status: active
authoritative: true
owner: wiser
language: zh-CN
whenToUse:
  - 第一次安装或启动本机完整 WISER 平台时
whenToUpdate:
  - 前置工具、完整栈命令、登录方式或主要入口变化时
checkPaths:
  - package.json
  - compose.yaml
  - .env.example
  - scripts/data-foundation/**
lastReviewedAt: 2026-08-22
lastReviewedCommit: 2fff614988729e9594f436bce759df08f2cf43d5
---

本页只覆盖第一次完整运行。日常的前后端单独启动、所有端口、环境变量和故障排查见[本机开发环境](/development/local-environment/)。

## 0. 前置条件

- Node.js 24，具体范围见根 `package.json` 的 `engines`
- 由 Corepack 提供的仓库固定 pnpm
- Docker Engine 29+ 与 Docker Compose 5+
- Git

确认 Docker 正常运行，并给 Docker Desktop 预留足够的 CPU、内存和磁盘；Data Foundation 会启动数据库、对象存储、检索、图谱和 GIS 服务。

## 1. 安装

在仓库根目录执行：

```bash
corepack enable
pnpm install --frozen-lockfile
```

不要在子应用中创建第二份 lockfile。npm 包版本以各 `package.json` 和根 `pnpm-lock.yaml` 为准；容器版本以 `compose.yaml` 与 `infrastructure/data-foundation/versions.env` 为准。

## 2. 启动完整平台

```bash
pnpm stack:full:up
```

该命令会：

1. 启动本机 Supabase Auth、控制面 PostgreSQL、Storage 与 Studio；
2. 创建被 Git 忽略的本机运行密钥；
3. 构建并启动 API、Web、Agent EXCON v1 compatibility/testing Worker 和文档站；该 Worker 只提供兼容进程健康，不执行默认 v2 评价；
4. 启动 Data Foundation profile，执行 checksum migration 与确定性 seed；
5. 启动 Data Worker、MCP Gateway 和数据基础设施；
6. 运行跨 Data REST、GraphQL、MCP 和登录 Web 的端到端 smoke。

命令成功返回才表示默认完整栈可用。它不会读取或挂载 `~/.codex/auth.json`，也不会把 Supabase service-role key 注入应用。

## 3. 打开入口

| 用途                | 地址                                          |
| ------------------- | --------------------------------------------- |
| WISER Portal        | `http://127.0.0.1:3000/zh-CN`                 |
| 智能体演练场 · 场景 | `http://127.0.0.1:3000/zh-CN/scenarios`       |
| 智能体演练场 · 运行 | `http://127.0.0.1:3000/zh-CN/runs`            |
| 数据基座            | `http://127.0.0.1:3000/zh-CN/data-foundation` |
| 文档站              | `http://127.0.0.1:4321`                       |
| API readiness       | `http://127.0.0.1:3001/health/ready`          |
| OpenAPI             | `http://127.0.0.1:3001/openapi.json`          |
| GraphQL             | `POST http://127.0.0.1:3001/graphql`          |
| MCP Streamable HTTP | `http://127.0.0.1:13004/mcp`                  |
| Supabase Studio     | `http://127.0.0.1:56323`                      |

使用本机 fixture 账号登录：

```text
operator@agent-excon.test
WiserLocalOperator-2026!
```

这个账号和密码只能用于本机 seed，不能复制到共享或生产环境。

完整栈会为 Data Foundation Web 与 Data MCP 注入真实的本机 Supabase 身份。共享 MCP 进程同时收到一个只够完成 EXCON client 配置的本机占位值；Data Tool 不使用它，但任何 `excon_*` 调用都会因没有绑定 RunAgent 的真实 credential 而鉴权失败。Agent EXCON Web 的 live 读模型也仍需要服务端 operator credential；缺失或无效时显式显示 unavailable，不回退伪造数据。

## 验证 Agent EXCON 协议闭环

使用隔离的本机 Lab 和四个确定性脚本 RunAgent 验证 EXCON HTTP/MCP、Receipt、Barrier、协作和评价，不产生模型用量：

```bash
pnpm cookbook:scripted
```

该命令验证 Agent EXCON 系统，但不把完整栈 Web 的占位 credential 升级成 live operator/RunAgent 身份。真实 EXCON live 客户端仍必须从受信任的 Run 编组或 operator workflow 获得专用 credential。

## 4. 停止

停止 Compose 与 Supabase，但保留命名卷中的本机数据：

```bash
pnpm stack:down
```

只停止 Data Foundation profile：

```bash
pnpm data:down
```

删除 Data Foundation 命名卷是破坏性操作，必须显式确认：

```bash
WISER_DATA_RESET_CONFIRM=reset-wiser-data-foundation pnpm data:reset
```

## 下一步

- [开发手册](/development/)：选择完整栈、单应用或聚焦测试模式
- [平台架构](/architecture/wiser-platform/)：理解共享宿主与系统权威
- [Agent EXCON HTTP](/protocols/http/) 与 [MCP](/protocols/mcp/)
- [Data REST](/protocols/data-rest/)、[GraphQL](/protocols/data-graphql/) 与 [MCP](/protocols/data-mcp/)
