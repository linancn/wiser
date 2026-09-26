---
title: 快速开始
description: 从干净的仓库启动隔离的本机 WISER，登录并确认数据与演练入口。
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
lastReviewedAt: 2026-09-26
lastReviewedCommit: 37d60e1cf561bf0f12a97ed34f48ece1a50f29d5
---

本页适合第一次在自己的开发环境运行 WISER。现网资料查阅与外部客户端连接请使用[现网使用指南](/development/wiser-data-guide/)；单独启动应用、端口、配置和排障见[本机开发环境](/development/local-environment/)。

## 0. 前置条件

- Node.js 24，具体范围见根 `package.json` 的 `engines`
- 由 Corepack 提供的仓库固定 pnpm
- Docker Engine 29+ 与 Docker Compose 5+
- Git

确认 Docker 正常运行，并预留足够的 CPU、内存和磁盘；完整栈包含数据库、文件存储、检索、图谱和地图服务。

## 1. 安装

在仓库根目录执行：

```bash
corepack enable
pnpm install --frozen-lockfile
```

请在仓库根目录执行命令，不要在子应用中创建第二份锁文件。

## 2. 启动完整平台

```bash
pnpm stack:full:up
```

该命令启动本机登录服务、产品网页、API、文档站、智能体入口及数据基座所需服务，准备隔离的本机测试资料，并执行跨网页和协议的检查。**命令成功结束**后再打开下面的入口；若失败，按终端提示处理，并到[本机开发环境](/development/local-environment/)查找对应服务的日志和恢复步骤。

## 3. 打开入口

| 用途                | 地址                                          |
| ------------------- | --------------------------------------------- |
| WISER Portal        | `http://127.0.0.1:3100/zh-CN`                 |
| 智能体演练场 · 场景 | `http://127.0.0.1:3100/zh-CN/scenarios`       |
| 智能体演练场 · 运行 | `http://127.0.0.1:3100/zh-CN/runs`            |
| 数据基座            | `http://127.0.0.1:3100/zh-CN/data-foundation` |
| 文档站              | `http://127.0.0.1:4321`                       |
| API readiness       | `http://127.0.0.1:3101/health/ready`          |
| OpenAPI             | `http://127.0.0.1:3101/openapi.json`          |
| GraphQL             | `POST http://127.0.0.1:3101/graphql`          |
| MCP Streamable HTTP | `http://127.0.0.1:13004/mcp`                  |
| Supabase Studio     | `http://127.0.0.1:56323`                      |

以上地址只用于本机开发。请勿把本机测试账户用于现网；现网入口和账户开通方式见[资料查阅指南](/development/wiser-data-guide/)。

使用本机测试账号登录：

```text
operator@agent-excon.test
WiserLocalOperator-2026!
```

这个账号只存在于本机测试资料中。登录后，选择数据基座或智能体演练场；可查看的项目和内容由当前账号权限决定。智能体通过 MCP 参加演练还需要单独的演练参与身份，详见 [Agent EXCON MCP](/protocols/mcp/)。

## 验证智能体演练

使用本机合成场景和脚本智能体，检查任务领取、协作、提交、评测与回放；此命令不调用付费模型：

```bash
pnpm cookbook:scripted
```

成功后，可在演练运行页查看对应的团队协作和评测记录。协议字段与参与者身份的详细说明见 [Agent EXCON HTTP](/protocols/http/) 和 [MCP](/protocols/mcp/)。

## 4. 停止

停止 Compose 与 Supabase，但保留命名卷中的本机数据：

```bash
pnpm stack:down
```

只停止 Data Foundation profile：

```bash
pnpm data:down
```

如需清除本机数据，请先阅读[数据库开发](/development/databases/)中的重置范围和确认要求。

## 下一步

- [开发手册](/development/)：选择完整栈、单应用或聚焦测试模式
- [平台架构](/architecture/wiser-platform/)：理解共享宿主与系统权威
- [Agent EXCON HTTP](/protocols/http/) 与 [MCP](/protocols/mcp/)
- [Data REST](/protocols/data-rest/)、[GraphQL](/protocols/data-graphql/) 与 [MCP](/protocols/data-mcp/)
