---
title: WISER Telemetry Ingress component guide
docType: component-guide
scope: apps/telemetry-ingress
status: active
authoritative: true
owner: wiser
language: bilingual
whenToUse:
  - when running or changing the participant-facing OTLP HTTP ingress
whenToUpdate:
  - when telemetry authentication, filtering, identity normalization, forwarding, endpoints, health, or verification changes
checkPaths:
  - apps/telemetry-ingress/**
  - infrastructure/observability/**
  - compose.yaml
lastReviewedAt: 2026-08-22
lastReviewedCommit: ed36c7913b5dd2b2542adf1aa1ce1e5d9a70029f
---

# WISER Telemetry Ingress / 参与者遥测入口

## Responsibility / 职责

`apps/telemetry-ingress` 是外部 RunAgent 上报遥测的受认证 OTLP/HTTP JSON 边界。它验证 participant telemetry credential，拒绝敏感字段，覆盖所有受保护的 Run、RunAgent、service、source、trust 与 role identity attributes，再将规范化 traces、metrics 和 logs 转发到内部 OpenTelemetry Collector。

`apps/telemetry-ingress` is the authenticated OTLP/HTTP JSON boundary for telemetry reported by external RunAgents. It verifies a participant telemetry credential, rejects sensitive fields, overwrites protected Run, RunAgent, service, source, trust, and role identity attributes, and forwards normalized traces, metrics, and logs to the internal OpenTelemetry Collector.

遥测始终是 best-effort diagnostics：它不能改变 Run、授权、Barrier、evaluation 或 audit facts，也不能替代 Domain Events 和 Receipts。 / Telemetry is always best-effort diagnostics. It cannot change Runs, authorization, Barriers, evaluations, or audit facts, and cannot replace Domain Events or Receipts.

## Entrypoints / 入口

- Process composition / 进程组合：`src/main.ts`
- HTTP policy / 请求验证与规范化：`src/app.ts`
- Collector adapter / Collector 转发：`src/forwarder.ts`
- Package / workspace：`@wiser/telemetry-ingress`
- Compose service：`telemetry-ingress`（`observability` profile；主机 `127.0.0.1:14318` 映射容器端口 `3003`）

## Run / 运行

本机联调推荐启动完整 observability profile： / For local integration, start the complete observability profile:

```bash
pnpm observability:up
```

聚焦运行可选择一种 credential mode，并保证 Collector 可达： / For a focused run, select exactly one credential mode and provide a reachable Collector:

```bash
# Trusted local demo mode / 可信本机演示模式
export WISER_TELEMETRY_LOCAL_TOKEN=<opaque-token-at-least-32-characters>
export WISER_TELEMETRY_LOCAL_RUN_ID=<run-uuid>
export WISER_TELEMETRY_LOCAL_RUN_AGENT_ID=<run-agent-uuid>
export OTEL_COLLECTOR_INTERNAL_URL=http://127.0.0.1:4318
pnpm --filter @wiser/telemetry-ingress dev
```

生产/共享环境不得启用 local token mode。仓库提供 PostgreSQL verifier，但**没有** `excon_private.run_agent_credentials` 的签发、轮换或撤销 API/CLI；除 seed fixture 外，数据库模式需要部署方提供受信任 provisioning/revocation workflow。在该流程存在并经过测试前，不得把本仓库描述为可独立运营生产 participant telemetry credential。 / Production/shared environments cannot use local mode. The repository has a PostgreSQL verifier but no issuance, rotation, or revocation API/CLI for these EXCON credentials. Apart from seed fixtures, deployment must supply and test trusted provisioning; until then the repository is not independently operable for production participant telemetry credentials.

## Configuration boundary / 关键配置边界

| Variable / 变量                      | Boundary / 边界                                                                    |
| ------------------------------------ | ---------------------------------------------------------------------------------- |
| `DATABASE_URL`                       | Required outside local demo mode / 非本机演示模式必填                              |
| `WISER_TELEMETRY_TOKEN_PEPPER`       | Required with `DATABASE_URL`; minimum 16 characters / 数据库模式必填，至少 16 字符 |
| `WISER_TELEMETRY_LOCAL_TOKEN`        | Trusted local mode only; minimum 32 characters / 仅可信本机，至少 32 字符          |
| `WISER_TELEMETRY_LOCAL_RUN_ID`       | Required with local token / local mode 必填                                        |
| `WISER_TELEMETRY_LOCAL_RUN_AGENT_ID` | Required with local token / local mode 必填                                        |
| `WISER_TELEMETRY_LOCAL_ROLE`         | Optional role bound by the ingress / 可选，由入口绑定                              |
| `OTEL_COLLECTOR_INTERNAL_URL`        | Internal Collector origin; default `http://127.0.0.1:4318` / 内部 Collector 地址   |
| `TELEMETRY_INGRESS_HOST` / `_PORT`   | Bind address; defaults `127.0.0.1:3003` / 监听地址                                 |

数据库模式不签发第二套身份。它验证 Supabase 管理的 `excon_private.run_agent_credentials` 中独立的 EXCON RunAgent capability token；该 token 不等于 Platform `wdc1.` delegated credential。Ingress 检查 token、RunAgent、AgentVersion 与 AgentIdentity 生命周期，但不重新解析 Platform Delegation 或 Tenant/Project Membership。平台 Membership 撤销需要部署方同时撤销 EXCON token 或移除 RunAgent；本仓库尚无可执行的 token 管理命令。 / Database mode verifies a separate EXCON RunAgent capability token, not a Platform `wdc1.` credential. It checks token and EXCON lifecycle but not Platform Delegation or memberships. Deployment must pair Platform revocation with token revocation or RunAgent removal; this repository has no executable token-management command yet.

## OTLP, health, and metrics / OTLP、健康与指标

- `POST /v1/traces`, `POST /v1/metrics`, `POST /v1/logs`: require `Authorization: Bearer …`; accept bounded OTLP JSON only.
- `GET /health/live`, `GET /health/ready`: unauthenticated process checks / 无需 bearer 的进程检查。
- 请求会限制 body、record 数与每 credential 每分钟请求数，并拒绝 prompt、completion、Tool body、feedback body 与 hidden outcomes。 / Requests enforce body, record, and per-credential rate limits and reject prompts, completions, Tool bodies, feedback bodies, and hidden outcomes.
- 当前没有 `GET /metrics`；`POST /v1/metrics` 是参与者 metric ingestion，不是该进程自身的 Prometheus endpoint。 / There is no `GET /metrics`; `POST /v1/metrics` ingests participant metrics and is not a Prometheus endpoint for this process.

## Verify / 验证

```bash
pnpm --filter @wiser/telemetry-ingress test
pnpm --filter @wiser/telemetry-ingress typecheck
pnpm --filter @wiser/telemetry-ingress build
pnpm observability:config
pnpm observability:smoke
```

`observability:smoke` 需要已运行的 profile；仓库级 gate 为 `pnpm verify`。 / `observability:smoke` requires the running profile; the repository-wide gate is `pnpm verify`.

权威说明 / Authoritative references：

- [后端开发](../docs/src/content/docs/zh-CN/development/backend.md) / [Backend development](../docs/src/content/docs/en/development/backend.md)
- [多智能体控制与可观测性](../docs/src/content/docs/zh-CN/architecture/multi-agent-observability.md) / [Multi-agent control and observability](../docs/src/content/docs/en/architecture/multi-agent-observability.md)
- [测试与验证](../docs/src/content/docs/zh-CN/development/testing.md) / [Testing and verification](../docs/src/content/docs/en/development/testing.md)
- [本机 observability runbook](../../infrastructure/observability/README.md) / [Local observability runbook](../../infrastructure/observability/README.md)
