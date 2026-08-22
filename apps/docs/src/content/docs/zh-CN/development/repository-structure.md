---
title: 仓库结构与依赖边界
description: WISER monorepo 的目录职责、系统包、共享宿主、依赖方向和代码放置规则。
docType: architecture
scope: repository
status: active
authoritative: true
owner: wiser
language: zh-CN
whenToUse:
  - 判断新代码、测试、数据或示例应放在哪里时
  - 修改包依赖或跨系统调用边界时
whenToUpdate:
  - workspace、系统清单、组合宿主或依赖方向变化时
checkPaths:
  - pnpm-workspace.yaml
  - package.json
  - apps/**
  - packages/**
  - infrastructure/**
  - scripts/**
  - supabase/**
  - skills/**
  - examples/**
lastReviewedAt: 2026-08-22
lastReviewedCommit: c9b9047b81f84ad7a704f9d0806526a43a90d7f1
---

## 先建立心智模型

WISER 是一个 pnpm monorepo。`apps` 是可启动、可部署的组合宿主，`packages` 是可复用的契约、领域与基础设施模块。WISER Platform 提供身份和宿主约定；Agent EXCON、Data Foundation 以及以后新增的系统都是平级业务系统。

```text
WISER Platform contracts + Auth
                │
        ┌───────┴────────┐
        │                │
  Agent EXCON      Data Foundation      future systems
        └────────┬───────┘
                 │ registered modules
       API / Web / MCP / Docs hosts
```

共享宿主不拥有业务事实。系统自己的 contracts、core、应用用例和权威数据仍由该系统负责。

## 顶层目录

| 路径                          | 责任                                                                  | 不应放入                       |
| ----------------------------- | --------------------------------------------------------------------- | ------------------------------ |
| `apps/`                       | 可运行进程和 UI：API、Web、Docs、Workers、MCP、Telemetry Ingress      | 可被多个宿主复用的领域规则     |
| `packages/`                   | 平台与系统的 contracts、纯 core、infra、运行时资产包                  | 页面路由和进程启动逻辑         |
| `supabase/`                   | 统一 Auth、控制面和 Agent EXCON 的 Supabase schema、迁移、seed、pgTAP | Data Foundation 独立数据库迁移 |
| `infrastructure/`             | Compose 支撑、Docker、可观测性和 Data Foundation 数据库迁移           | 产品页面或领域状态机           |
| `scripts/`                    | 根级可重复运行的运维、迁移、smoke 和栈编排脚本                        | 只能人工执行的一次性修补       |
| `skills/`                     | 通过公开 HTTP/MCP 使用系统能力的 Agent Skills                         | 数据库直连逻辑                 |
| `examples/`                   | 可运行的演示、cookbook 与操作样例                                     | 生产运行时场景资产             |
| `tests/`                      | 跨 workspace 的架构、工具链和仓库契约测试                             | 单包内部已有明确归属的单元测试 |
| `apps/docs/src/content/docs/` | 给开发者和操作者阅读的中英文文档源                                    | 生成后的站点文件               |

Agent EXCON 的生产运行时场景位于 `packages/excon-scenarios/scenarios/`，通过 `@agent-excon/scenarios` 的受校验 API 读取；面向人类的完整演示位于 `examples/agent-excon/`。不要重新建立根级 `scenarios/` 或 `cookbooks/`。

## 当前 workspace

### 共享平台

| 包                          | 责任                                                                                |
| --------------------------- | ----------------------------------------------------------------------------------- |
| `@wiser/platform-contracts` | Principal、Tenant、Project、Scope、Purpose、安全级别和请求上下文的公共类型与 schema |
| `@wiser/platform-auth`      | Supabase JWT、委托凭据、授权上下文与 PostgreSQL adapter                             |

### Agent EXCON

| 包或目录                 | 责任                                                       |
| ------------------------ | ---------------------------------------------------------- |
| `@agent-excon/contracts` | 对外 DTO、命令、事件和协议 schema                          |
| `@agent-excon/core`      | 确定性的 Scenario、Run、Task、Receipt、Feedback 与裁决规则 |
| `@agent-excon/infra`     | AI、PostgreSQL、Supabase 等外部 adapter                    |
| `@agent-excon/scenarios` | 经 schema 校验的运行时场景与测试 fixture API               |
| `apps/api/src/v2-*`      | 当前 EXCON v2 应用服务、持久化 journal 组合和 HTTP adapter |
| `apps/worker`            | 异步确定性评估 Worker                                      |

### Data Foundation

| 包或目录                       | 责任                                                   |
| ------------------------------ | ------------------------------------------------------ |
| `@wiser/data-contracts`        | Capability Registry、目录、入库、操作和上传协议        |
| `@wiser/data-core`             | 入库、发布、质量、安全和端口等纯领域规则               |
| `@wiser/data-infra`            | 独立迁移器、对象存储、任务库、搜索和投影 adapter       |
| `apps/api/src/data-foundation` | REST、GraphQL、资源、GIS 与 Capability 的 Fastify 模块 |
| `apps/data-worker`             | 入库、Outbox 消费和投影运行时                          |

### 共享宿主

| 应用                       | 组合责任                                                           |
| -------------------------- | ------------------------------------------------------------------ |
| `@wiser/api`               | Fastify 组合根；挂载 Platform、Agent EXCON 和 Data Foundation 模块 |
| `@wiser/web`               | 统一 Next.js 产品壳、系统导航、Supabase Session、双语和主题        |
| `@wiser/mcp`               | stdio/Streamable HTTP 网关；把系统 MCP 模块转成对 HTTP API 的调用  |
| `@wiser/docs`              | 统一 Fumadocs 文档站                                               |
| `@wiser/telemetry-ingress` | 认证、限流、清洗并转发参与者 OTLP/HTTP 遥测                        |

## 依赖方向

仓库的架构约束写作：

```text
platform contracts <- system contracts <- core <- application <- infra/apps
```

箭头表示右侧可以依赖左侧，反向依赖禁止。实际规则是：

1. 平台 contracts 不知道任何业务系统。
2. 系统 contracts 可以复用平台 Principal、Scope 和上下文，但不能依赖 core 或 adapter。
3. core 可以使用本系统 contracts；它必须保持纯函数和确定性，不能导入数据库、HTTP、框架、时钟、随机数、文件系统或 AI provider。
4. application 编排用例和事务，依赖 contracts/core，并通过端口请求外部能力。
5. infra 和 `apps` 实现端口、连接数据库和网络，并在进程入口完成组合。

一个系统需要另一个系统时，只能依赖对方的公共 contracts，或在运行时调用对方的 HTTP API。禁止导入对方的 core、infra、数据库表或投影存储。跨系统引用应保存不可变 ID、版本、哈希和授权快照，而不是在运行中隐式读取“最新值”。

浏览器、MCP 和 Skills 都从 HTTP API 进入，不能直读 PostgreSQL、S3、搜索索引或图数据库。

## 如何决定代码位置

| 代码内容                                     | 放置位置                                                     |
| -------------------------------------------- | ------------------------------------------------------------ |
| 可序列化 DTO、公开错误码、输入输出 schema    | 对应系统的 `*-contracts` 包                                  |
| 不接触 I/O 的状态转换、校验和确定性判断      | 对应系统的 `*-core` 包                                       |
| 用例编排、事务边界、端口接口                 | 对应系统的 application 层；规模增长时建立独立 workspace 包   |
| PostgreSQL、S3、HTTP、AI、搜索或消息 adapter | 对应系统的 `*-infra` 包或专用 app adapter                    |
| Fastify 路由和运行时依赖注入                 | `apps/api/src/<system>/`                                     |
| 后台任务循环和健康端点                       | `apps/<system>-worker/`                                      |
| 产品页面和 Server-only DAL                   | `apps/web/src/app/[locale]/<system>/` 与 `apps/web/src/lib/` |
| MCP Tool/Resource 映射                       | `apps/mcp/src/<system>/`，只调用 HTTP                        |
| 生产运行时静态资产                           | 由系统拥有、带校验 API 的 workspace 包                       |
| 教程、演示和 cookbook                        | `examples/<system>/`                                         |

`src/` 和 `test/` 是包的源代码与测试事实源。`dist/`、`.next/`、`.source/` 和生成的类型文件是构建产物，不直接编辑，也不把它们当作代码审查入口。

## 聚焦 workspace 工作

根目录命令负责全仓验证；开发时用 package filter 缩短反馈循环：

```bash
pnpm --filter @wiser/api test
pnpm --filter @wiser/data-core test
pnpm --filter @agent-excon/scenarios typecheck
pnpm --filter @wiser/web test
```

修改公开 contract 后，继续验证所有直接消费者；仅通过 contract 包自己的测试不足以证明兼容。交接前仍需运行 `pnpm verify`。

后端进程和健康入口见[后端开发](/development/backend/)，建立新业务边界见[新增 WISER 系统](/development/adding-a-system/)。
