---
title: 数据库开发
description: 在 WISER 的 Supabase 控制面与独立 Data Foundation 数据库之间选择正确的迁移、RLS、种子和验证流程。
docType: workflow
scope: repository-databases
status: active
authoritative: true
owner: wiser
language: zh-CN
whenToUse:
  - 修改 Auth、平台控制面、Agent EXCON 或 Data Foundation 数据模型时
  - 编写迁移、RLS、种子、事务或 Outbox 逻辑时
whenToUpdate:
  - 数据库边界、迁移 runner、runtime role、种子或验证命令变化时
checkPaths:
  - supabase/**
  - infrastructure/data-foundation/postgres/**
  - packages/data-infra/src/migrations/**
  - scripts/data-foundation/**
  - compose.yaml
lastReviewedAt: 2026-08-22
lastReviewedCommit: c9b9047b81f84ad7a704f9d0806526a43a90d7f1
---

## 先区分两个 PostgreSQL 边界

WISER 使用同一套 Supabase Auth 作为身份权威，但不把所有业务数据放进同一个数据库。两套 PostgreSQL 的职责和迁移历史必须保持独立。

| 边界                                      | 拥有的数据                                                                                                                     | 规范位置                                                                                  | 迁移与验证                                                                     |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Supabase Auth 与控制面                    | `auth.users`、Session、Actor、Tenant、Project、Membership、Role、Scope、Delegation，以及 Agent EXCON 事实和私有 journal/outbox | `supabase/migrations`、`supabase/schemas`、`supabase/seed.sql`、`supabase/tests/database` | Supabase CLI、declarative schema、seed、pgTAP、lint、advisor                   |
| Data Foundation `data-postgres` / PostGIS | DataItem、Version、Asset、Ingestion、Quality、Lineage、Knowledge、Operation、Audit、Outbox 与空间权威事实                      | `infrastructure/data-foundation/postgres/migrations`                                      | WISER checksum runner、PostgreSQL advisory lock、确定性 seed、脚本与纵向 smoke |

Data Foundation 只保存经过授权上下文限定的主体、Tenant 和 Project 引用。它不创建用户、Session、Membership、Role 或 Token 权威。Supabase migration 也不能创建 Data Foundation 的业务表。两边不共享 migration ledger，也不能声称一次数据库事务能够同时覆盖两边。

## 如何选择变更位置

- 用户登录、Session、Tenant/Project、Membership、Role/Scope、委托凭据或 Agent EXCON Run 的持久化变化属于 `supabase`。
- Data catalog、入库、质量、血缘、知识、Operation、投影协调或 PostGIS 权威事实属于 `data-postgres`。
- 如果一个用例横跨两边，先在拥有事实的数据库内提交权威变化与 Outbox，再由幂等消费者传播。不要在应用代码中实现伪造的跨库事务。
- S3、Weaviate、OpenSearch、Neo4j、STAC 等外部存储是对象或投影目标，不是身份或发布权威；它们的写入不应被包装成 PostgreSQL 已经原子提交的一部分。

## Supabase 变更流程

Supabase 的四类文件必须同步：顺序 migration 是可重放历史，declarative schema 描述当前结构，seed 建立确定性本机身份与案例，pgTAP 证明结构、安全和数据不变量。

1. 启动本机 Supabase：

   ```bash
   pnpm supabase:start
   ```

2. 先在 `supabase/tests/database` 增加会因目标行为尚不存在而失败的 pgTAP 用例。
3. 使用仓库固定的 Supabase CLI 创建 migration，不手写时间戳文件名：

   ```bash
   pnpm exec supabase migration new <descriptive_name>
   ```

4. 在新 migration 中实现变化，并把最终结构同步到正确的 declarative schema：

   - `00_agent_excon.sql`：v1 Agent EXCON 关系；
   - `01_multi_agent_run.sql`：v2 Run、Task、Receipt、journal 与 EXCON 私有事实；
   - `02_platform_auth.sql`：统一身份、Tenant/Project、授权与委托。

5. 若本机开发身份或确定性案例需要新数据，同步更新 `supabase/seed.sql`。Seed 必须可重复、无真实凭据，并与 pgTAP 断言一致。
6. 运行完整门禁：

   ```bash
   pnpm supabase:verify
   ```

`supabase:verify` 会先对本机数据库执行 `db reset --local`，随后运行 pgTAP、数据库 lint 和全部 advisor。它会删除本机 Supabase 数据；不要把它指向共享或生产数据库。已经进入历史的 migration 不得改名、重排或改写，应追加新的 migration。

## Data Foundation 变更流程

`infrastructure/data-foundation/postgres/migrations` 是 Data Foundation 唯一的业务 schema 历史。文件名必须是连续、唯一的 `NNNN_descriptive_name.sql`，且只能追加。

1. 为目标不变量增加失败测试。SQL 结构、runner 和 repository 测试位于 `packages/data-infra/test`；部署流程测试位于 `scripts/data-foundation/*.test.mjs`。
2. 追加 migration。Runner 按四位版本排序，对每个文件计算 SHA-256，在 session advisory lock 下逐文件开启事务，并把版本、文件名和 checksum 记录到 `public.schema_migrations`。
3. 启动 profile 后应用 migration：

   ```bash
   pnpm data:up
   pnpm data:migrate
   ```

   `data:migrate` 依次运行 WISER authority migration、固定版本的 pyPgSTAC migration 和 runtime role provisioning。已执行文件缺失、改名、checksum 改变或不再构成连续前缀时，runner 会失败关闭。

4. 若固定案例需要变化，更新 `tests/fixtures/data-foundation` 中有来源说明的合成 fixture、对应 checksum 和 seed 构建逻辑，然后运行：

   ```bash
   pnpm data:seed
   ```

5. 先运行静态与 workspace 门禁，再运行真实纵向验证：

   ```bash
   pnpm data:verify
   pnpm data:smoke
   ```

`data:verify` 检查 migration/运维脚本测试、四个 Data workspace 的 test/typecheck/build 和 Compose 配置；它不会启动数据库、应用 migration 或执行纵向 smoke。`data:smoke` 要求完整服务已经健康、migration 已应用且 seed 已写入。需要从空环境证明整条路径时，可直接运行 `pnpm stack:full:up`。

## RLS 与 runtime role

仅有 `authenticated` 身份不构成授权。策略必须检查对象归属和实时作用域；隐藏结果、凭据、job、审计、幂等与 Outbox 放在私有 schema，并继续以 RLS、最小 grant 和不可变约束做纵深防御。

Supabase 中的 EXCON journal 由非超级用户、`NOBYPASSRLS` 的 `wiser_excon_api` 通过 `wiser_excon_runtime` 最小权限组访问。浏览器使用 Supabase Session；service-role 或数据库凭据只能留在可信服务端。

Data Foundation 的部署脚本创建四个明确角色：

| Role                 | 用途与限制                                                     |
| -------------------- | -------------------------------------------------------------- |
| `wiser_data_runtime` | 无登录的共同权限组；只有需要的 schema、表、序列和函数权限      |
| `wiser_data_api`     | API 登录；继承 runtime 权限，非超级用户且不能绕过 RLS          |
| `wiser_data_worker`  | Worker 登录；继承 runtime 权限，使用独立密码和超时             |
| `wiser_data_gis`     | 隔离的 GIS 登录；不继承通用 runtime，只能执行受控 MVT function |

Data 的每个数据库事务必须以 transaction-local `set_config` 设置并验证 `wiser.tenant_id`、`wiser.project_id`、`wiser.max_security_level` 和 `wiser.policy_version`。缺少或不匹配上下文时应返回零行或失败，不能退化为无租户查询。所有角色保持 `NOSUPERUSER`、`NOBYPASSRLS`，应用不得使用 migration owner 作为 runtime 连接。

## 事务、并发与 Outbox

需要同时成立的权威变化必须放在一个明确的 PostgreSQL 事务中：设置授权上下文，锁定或检查版本，写业务状态，追加 Event/Audit/Outbox，然后提交；任何一步失败都回滚。

- 竞争式领取使用行锁、`FOR UPDATE SKIP LOCKED`、lease 或乐观版本，而不是进程内互斥量。
- 重试安全由唯一约束、稳定 idempotency key 和请求 hash 保证。
- Event、Audit、Receipt、版本和 Outbox 等历史记录保持 append-only；更正通过追加新事实表达。
- Data 权威提交将 Version、质量/血缘、Operation event、Audit 与 Outbox 放入同一 `data-postgres` 事务。
- Outbox consumer 使用单调 checkpoint 和逐目标 ledger。投影写成功但 checkpoint 尚未推进时可以安全重试，已成功目标会被跳过。
- 跨 Supabase、`data-postgres`、S3 和投影存储的流程采用 Outbox、幂等和补偿；不存在跨这些系统的 ACID 承诺。

## 停止与重置

停止服务通常不需要删除数据：

```bash
pnpm data:down
pnpm stack:down
```

以下命令会删除本机状态：

```bash
pnpm supabase:reset
WISER_DATA_RESET_CONFIRM=reset-wiser-data-foundation pnpm data:reset
```

`data:reset` 只有在确认值正确时才会继续，并只删除脚本解析和校验过的 WISER Data Foundation named volumes；这些数据仍不可恢复。执行前先确认没有需要保留的本机上传、版本、对象或投影。重置后使用 `pnpm stack:full:up` 重建、迁移、seed 并 smoke。
