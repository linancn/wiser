---
title: Agent EXCON v1 compatibility worker component guide
docType: component-guide
scope: apps/worker
status: active
authoritative: true
owner: wiser
language: bilingual
whenToUse:
  - when running or changing the PostgreSQL-backed Agent EXCON v1 compatibility worker
whenToUpdate:
  - when evaluation job claims, leases, deterministic evaluation, health, configuration, or verification changes
checkPaths:
  - apps/worker/**
  - packages/core/**
  - supabase/migrations/**
  - supabase/schemas/**
lastReviewedAt: 2026-08-22
lastReviewedCommit: ed36c7913b5dd2b2542adf1aa1ce1e5d9a70029f
---

# Agent EXCON v1 Compatibility Worker / v1 兼容 Worker

## Responsibility / 职责

`apps/worker` 从 Supabase 管理的 PostgreSQL `excon_private.evaluation_jobs` 领取 **v1 Episode compatibility/testing** 评价任务，读取 `public.episodes` 与 `public.submissions`，调用 `@agent-excon/core` 的纯确定性评估器，并事务性写回评价、反馈与事件。它负责租约恢复、有限并发、重试/死信与优雅排空。

`apps/worker` claims **v1 Episode compatibility/testing** evaluation jobs from Supabase-managed `excon_private.evaluation_jobs`, reads `public.episodes` and `public.submissions`, invokes the pure deterministic evaluator in `@agent-excon/core`, and transactionally records evaluation, feedback, and events. It also owns lease recovery, bounded concurrency, retry/dead-letter handling, and graceful draining.

默认 API 的 v1 使用进程内 `InMemoryExerciseService`，v2 在 API service/journal replay 内同步评价；两者都不会向该 Worker enqueue。因此完整 Compose 虽启动本进程并检查 health，它不是默认 v2 评价执行器。它不提供业务 API、不调用 AI，也不处理 Data Foundation ingestion。 / Default API v1 uses the in-process `InMemoryExerciseService`, while v2 evaluates inside the API service/journal replay; neither enqueues this Worker. Compose starts it for compatibility health, but it is not the default v2 evaluator. It exposes no business API, calls no AI, and does not process Data Foundation ingestion.

## Entrypoints / 入口

- Process composition / 进程组合：`src/main.ts`
- Worker loop / 领取与执行循环：`src/worker.ts`
- PostgreSQL adapter / 数据库适配：`src/postgres-repository.ts`
- Package / workspace：`@agent-excon/worker`
- Compose service：`worker`（主机 `127.0.0.1:3002` 映射容器 health port `8081`）

## Run / 运行

需要完整的 Auth、数据库与 API 环境时，从仓库根目录启动完整栈： / Start the complete stack from the repository root when the worker needs the normal Auth, database, and API environment:

```bash
pnpm stack:full:up
```

聚焦运行必须提供可访问的 EXCON 控制面数据库： / A focused run requires an accessible EXCON control-plane database:

```bash
export DATABASE_URL=<postgresql-connection-url>
pnpm --filter @agent-excon/worker dev
```

构建产物使用 `pnpm --filter @agent-excon/worker build` 后运行 `pnpm --filter @agent-excon/worker start`。 / For compiled execution, build first and then use the workspace `start` command.

## Configuration boundary / 关键配置边界

| Variable                  | Requirement and default / 要求与默认值                  |
| ------------------------- | ------------------------------------------------------- |
| `DATABASE_URL`            | Required; server-side PostgreSQL DSN / 必填、仅服务端   |
| `WORKER_ID`               | Optional unique instance ID / 可选实例 ID               |
| `WORKER_CLAIM_LIMIT`      | Jobs per claim; default `4`, maximum `100` / 单次领取数 |
| `WORKER_LEASE_MS`         | Lease duration; default `120000` / 租约时长             |
| `WORKER_POLL_INTERVAL_MS` | Poll interval; default `1000` / 轮询间隔                |
| `WORKER_HEALTH_HOST`      | Health bind host; default `0.0.0.0` / 健康服务监听地址  |
| `WORKER_HEALTH_PORT`      | Health port; default `8081` / 健康服务端口              |

数据库凭据不得进入浏览器、日志或提交记录。评估规则必须留在 pure core；Worker 只做调度、输入投影与持久化。 / Database credentials never enter browsers, logs, or commits. Evaluation rules stay in pure core; this process only schedules, projects safe inputs, and persists outcomes.

## Health and metrics / 健康与指标

- `GET /health/live`: 进程未停止时为成功。 / Succeeds while the process is not stopped.
- `GET /health/ready`: Worker 进入运行态、至少成功轮询一次且连续轮询失败少于三次时为成功。 / Succeeds after a successful poll while running and before three consecutive poll failures.
- 响应包含 phase、in-flight、领取/完成/失败与租约恢复计数。此进程当前没有 `/metrics`。 / Responses include phase, in-flight, claim/completion/failure, and recovered-lease counters. This process currently has no `/metrics` endpoint.

## Verify / 验证

```bash
pnpm --filter @agent-excon/worker test
pnpm --filter @agent-excon/worker typecheck
pnpm --filter @agent-excon/worker build
pnpm verify
```

权威说明 / Authoritative references：

- [后端开发](../docs/src/content/docs/zh-CN/development/backend.md) / [Backend development](../docs/src/content/docs/en/development/backend.md)
- [Agent EXCON 架构](../docs/src/content/docs/zh-CN/architecture/agent-excon.md) / [Agent EXCON architecture](../docs/src/content/docs/en/architecture/agent-excon.md)
- [测试与验证](../docs/src/content/docs/zh-CN/development/testing.md) / [Testing and verification](../docs/src/content/docs/en/development/testing.md)
- [数据库开发](../docs/src/content/docs/zh-CN/development/databases.md) / [Database development](../docs/src/content/docs/en/development/databases.md)
