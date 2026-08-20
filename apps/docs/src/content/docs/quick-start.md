---
title: 快速开始
description: 在本机启动 Agent EXCON 的首个可运行闭环。
---

## 环境基线

| 工具             | 固定基线            | 用途                         |
| ---------------- | ------------------- | ---------------------------- |
| Node.js          | 24 LTS              | Web、API、Worker、SDK 和文档 |
| pnpm             | 11                  | workspace 和精确锁定依赖     |
| Docker + Compose | Compose v2+         | Supabase 与应用支持服务      |
| Codex CLI        | 已通过 ChatGPT 登录 | 本机开发和调试的默认 AI 算力 |

先确认本机状态：

```bash
node --version
pnpm --version
docker compose version
codex login status
```

## 安装并验证

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

单独运行文档站：

```bash
pnpm --filter @agent-excon/docs dev
```

## 启动支持服务

仓库使用 Compose 统一编排支持服务：

```bash
pnpm compose:up
```

Supabase 自托管组件必须作为一套固定版本升级。当前边界是 PostgreSQL 17、Envoy、Auth、PostgREST、Realtime、Storage 和 Studio；不要把旧教程里的 Kong 服务名或 PostgreSQL 15 override 带入新部署。

数据库迁移和类型生成使用仓库固定的 Supabase CLI：

```bash
pnpm exec supabase migration list --local
pnpm exec supabase gen types typescript --local
```

## 选择 AI 运行方式

### 本机开发：Codex 订阅

开发者在宿主机通过 Codex SDK/CLI 运行智能体，复用 ChatGPT 登录。Compose 中的应用服务不挂载 `~/.codex`，也不复制订阅凭据。

### 部署和受控集成：OpenAI-compatible API

服务端通过独立适配器接收 `baseURL`、API key 和固定模型名。CI 默认使用 fake provider；只有显式启用的 smoke test 才访问真实模型。

## 跑通首个业务闭环

演练由参训智能体加载仓库中的 `skills/agent-excon` 后，经 HTTP 或 MCP 完成；Web 仅展示案例、状态和 Trace，不提供提交或推进控件。

1. 创建“永定河生态补水与多水源联合调度”合成场景的一个 Episode。
2. 获取该虚拟时点已经释放的水源可用量、控制断面目标和监测 Observation。
3. 提交带证据引用的分阶段水源配置与下泄计划。
4. 等待确定性评价，并获取结构化 Feedback。
5. 查询 Event 流，确认每一步可以按顺序重放。

完整载荷见 [HTTP 协议](/protocols/http/)，验收规则见 [永定河联合调度案例](/scenarios/yongding-river-dispatch/)。

## 停止环境

```bash
pnpm compose:down
```

默认停止操作保留命名卷；清除数据必须使用显式、单独的维护命令，不能藏在普通 `down` 中。
