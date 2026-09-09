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
lastReviewedAt: 2026-09-09
lastReviewedCommit: 5c98d03e974cb590afa9d2738caace27e5cf08a4
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
   - `02_platform_auth.sql`：统一身份、Tenant/Project、授权与委托；
   - `03_agent_connections.sql`：私有 Agent 连接、不可变的 OAuth credential 绑定、token hook，以及暴露表的直接 Session 限制。

5. 若本机开发身份或确定性案例需要新数据，同步更新 `supabase/seed.sql`。Seed 必须可重复、无真实凭据，并与 pgTAP 断言一致。
6. 运行完整门禁：

   ```bash
   pnpm supabase:verify
   ```

`supabase:verify` 会先对本机数据库执行 `db reset --local`，随后运行 pgTAP、数据库 lint 和全部 advisor。它会删除本机 Supabase 数据；不要把它指向共享或生产数据库。已经进入历史的 migration 不得改名、重排或改写，应追加新的 migration。

Agent 授权与交换集成测试通过 `WISER_AGENT_TEST_DATABASE_URL` 连接已迁移并加载 seed 的一次性 Supabase 数据库。设置该变量后运行 `pnpm exec vitest run apps/api/test/platform-agent-connections.integration.spec.ts`。测试会创建合成 OAuth Session、client、consent 与 Agent Membership；应在 pgTAP 之后运行，不能与种子数量断言并发执行。未设置变量时跳过该集成套件，普通单元测试仍不依赖数据库与 AI provider。

## Data Foundation 变更流程

`0010_source_registration.sql` 在 `ingestion.session` 中增加不可变的来源登记 JSON，复用现有强制 RLS。状态转换不能修改来源身份与声明限制；正式版本清单也冻结该描述。聚焦测试 `packages/data-infra/test/migrations/source-registration.spec.ts` 使用 `WISER_DATA_PG_INTEGRATION=1`，并将 `DATA_TEST_DATABASE_URL` 指向可丢弃且已迁移的数据库，验证无 BYPASSRLS 的角色、跨项目不可见、合法转换和描述修改拒绝。真实研究材料不进入 seed 或 Git。

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

表级 grant 不代表可以绕过领域权威。`service.operation`、`ingestion.session`、`ingestion.job` 与 `ingestion.transform_plan` 的数据库 trigger 检查每一次整行更新，而不只检查显式写出状态列的语句；非法生命周期边、identity/scope 重绑、policy 修改、安全降级、终态结果或冻结计划修改、不合法的同态 lease/content 变化，以及不等于 `old.row_version + 1` 的乐观版本变化都会被拒绝。合法转换变化时必须同步 application/core policy 与这些数据库 guard。

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

仓库当前没有保留现有命名卷同时创建临时 Data 数据库的标准命令。“从空库重放”应在 CI 或可丢弃的本机环境中，以确认式 `data:reset → stack:full:up` 证明；需要保留本机数据时停止，不要把破坏性 reset 当普通测试步骤。

## 探索清单

`0011_exploration_queries.sql` 增加私有 `service.exploration_snapshot` 缓存，具有强制所属用户 RLS、不可变清单、最长 30 分钟有效期、有界版本引用，以及用户和过期索引。查询事务额外设置 `wiser.actor_id`、`wiser.purpose`；授权版本与安全上限必须精确匹配。Runtime provisioning 仅为此缓存授予删除并撤销更新权限，不放宽历史表的只追加约束。建立新查询会清理同一可见用户与上下文的过期或超额清单。不活跃上下文留下的过期清单可由特权运维通过过期索引清理；过期不代表已经物理删除。

设置 `WISER_DATA_PG_INTEGRATION=1` 和指向已迁移数据库的 `DATA_TEST_DATABASE_URL`，运行 `apps/api/test/data-exploration.integration.spec.ts`。合成数据和临时不可绕过 RLS 的角色均处于最终回滚的事务内，验证稳定分页、新旧固定版本、历史版本查询、空结果、用户/项目/租户/Purpose/授权版本/安全上限隔离及过期处理。

迁移 `0012_analysis.sql` 在独立数据底座数据库中增加按作用域与版本绑定的分析批次、逐资产结果及 PostGIS 记录。使用校验和迁移工具升级，不重置已登记的源数据。

迁移 `0013_analysis_query_scope.sql` 保留分析记录的强制 RLS 及相同的租户、项目、安全等级、策略版本条件，将请求内恒定的辅助函数改为每条语句计算一次。记录分页按选定分析批次和文件的索引顺序读取；总数仍统计获授权的记录，不以更宽范围的资产元数据代替。真实 361,379 行水库来源纳入有界分页的浏览器性能测试。

内部查询瓦片源 `service.wiser_exploration_mvt`（迁移 `0014_exploration_tiles.sql`）绑定租户、项目、用户、查询、用途、安全上限及授权版本七项服务端参数。GIS 角色只能执行函数，不能读取业务表。函数先重新检查全部固定成员，拒绝过期或失效查询，再按空间范围选取记录。每张瓦片将点聚合到最多 4,096 个网格，计数只包含授权范围内记录；单要素携带记录、文件、分析批次、版本和资源身份，原始字段通过记录查询回查。线面按瓦片裁切。Web Mercator 表示不覆盖其纬度范围外的极区；超过 3 MiB 的瓦片明确失败，不静默丢弃要素。可回滚的真实 PostgreSQL 集成测试解码 MVT，核对十万个点的聚类计数、响应大小、跨范围拒绝、过期和成员失效。

探索契约 1.5 增加可选的地图整体 `spatial.bounds`（WGS84；空结果为 null）及 `mercatorFeatureCount`，由同一授权记录集合计算，不受分页影响。浏览器只请求一条初始记录与范围摘要，定位整个结果范围，再按视口加载同源查询瓦片。点选单要素通过 1.4 的精确记录回查获取详情，点选聚合点继续放大。地图分别标明视口要素／聚合点数与可上图记录总数。追加迁移 `0015_exploration_tile_boundaries.sql` 明确接缝点的唯一瓦片归属，防止重复计数。1.4 契约仍保留在归档中。

迁移 `0016_exploration_record_queries.sql` 增加确定性数值转换和共享记录条件，并更新查询瓦片函数，在聚合前应用不可变文件范围与条件。既有迁移保持不变。可回滚集成验证覆盖类型转换、排序分页、列选择、精确记录与图谱回查，以及解码后的筛选瓦片计数。

迁移 `0017_exploration_predicate_compilation.sql` 保持类型化比较语义，并将最多八条条件的表达式交给 PostgreSQL 规划。数值转换采用带格式边界的精确 SQL/JSON 数值解析。记录查询在限定文件范围内只计算一次每个类型化字段，物化记录标识与比较值，在同一关系上完成计数和排序分页，最后仅按当前页标识读取原始内容。空值排序及来源序号的稳定并列顺序保持不变。集成测试先对比 187 组旧、新标量条件结果，再验证 RLS、分页和筛选后的瓦片。

迁移 `0020_exploration_saved_views.sql` 创建强制 RLS 的保存配置，支持本人私有或显式项目可见。内容不可变，仅允许单向设置 `revoked_at`；运行角色配置在通用授权后恢复仅撤销列的更新权限。复用现有命令事务，原子写入幂等、审计与 Outbox。保存表不承担身份或成员权限权威。

迁移 `0021_amap_display.sql` 保持 WGS84 分析记录只追加，另建带空间索引的 `service.analysis_amap_geometry` 显示投影。在合法记录插入后派生一次显示几何，迁移回填也只写投影。投影 RLS 继承来源作用域，不授予 runtime 或 GIS 角色直接表权限。共享瓦片鉴权逻辑选择原始或高德显示平面；通过 lateral 主键查询读取记录，避免投影统计信息尚未刷新时出现低效关联。线、面非线性转换会加密显示顶点，原始坐标不变。

`0022_observation_reconciliation.sql` 增加不可变候选与审核证据，强制所有者/范围 RLS、单向乐观版本审核及最小列权限。`pnpm test:postgres:data-api` 包含 `data-reconciliation.integration.spec.ts`，仅在已迁移的隔离测试数据库运行；使用无 BYPASSRLS 角色验证来源重新授权、幂等、分页、审核冲突及原记录不变。
