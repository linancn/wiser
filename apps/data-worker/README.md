---
title: WISER Data Worker component guide
docType: component-guide
scope: apps/data-worker
status: active
authoritative: true
owner: wiser
language: bilingual
whenToUse:
  - when running or changing Data Foundation ingestion jobs or Outbox projection processing
whenToUpdate:
  - when Data Worker handlers, scheduling, projections, configuration, health, metrics, or verification changes
checkPaths:
  - apps/data-worker/**
  - packages/data-core/**
  - packages/data-infra/**
  - infrastructure/data-foundation/**
lastReviewedAt: 2026-09-09
lastReviewedCommit: d513c1fed81e36d1de9d769ec6182cadbf713ea0
---

# WISER Data Worker / 数据基座 Worker

## Responsibility / 职责

`apps/data-worker` 是 Data Foundation 的后台执行进程。它领取 durable jobs 并运行受控的 `data.ingestion.process.v1` pipeline，同时消费 authority Outbox：在权威 data-postgres/PostGIS 内建立受治理 spatial representation，并写入 Weaviate、OpenSearch、Neo4j 与 STAC 可重建外部投影；全部 ledger target 成功后再通过确定性 gate 完成 publication。

`apps/data-worker` is the Data Foundation background executor. It claims durable jobs and runs the controlled `data.ingestion.process.v1` pipeline while consuming authority Outbox events: it establishes governed spatial representations inside authoritative data-postgres/PostGIS and writes rebuildable external Weaviate, OpenSearch, Neo4j, and STAC projections. Publication passes through a deterministic gate only after every ledger target succeeds.

它负责租约、heartbeat、重试、dead letter、取消和优雅排空，但不提供公共业务 API、不建立第二套 Auth，也不把外部投影当作 authority。`catalog.spatial_extent` 等 data-postgres 权威记录不能按缓存处理。 / It owns leases, heartbeats, retries, dead letters, cancellation, and graceful draining, but exposes no public business API, creates no second Auth system, and never treats external projections as authority. Authoritative data-postgres rows such as `catalog.spatial_extent` are not caches.

## Entrypoints / 入口

- Process composition / 进程组合：`src/main.ts`
- Runtime composition / ingestion 与 projection 组合：`src/runtime/default-runtime.ts`
- Scheduler / durable job 调度：`src/scheduler.ts`
- Strict configuration / 严格配置：`src/config.ts`
- Package / workspace：`@wiser/data-worker`
- Compose service：`data-worker`（`data-foundation` profile；主机 `127.0.0.1:13003` 映射容器端口 `3003`）

## Run / 运行

推荐从仓库根目录使用完整栈，由脚本准备 Supabase、Data PostgreSQL、迁移、runtime roles、对象存储和投影服务： / Prefer the complete-stack workflow, which prepares Supabase, Data PostgreSQL, migrations, runtime roles, object storage, and projection services:

```bash
pnpm stack:full:up
```

仅在所有依赖已准备且完整的 canonical `DATA_*` 环境已注入时聚焦启动： / Start the process directly only after all dependencies are ready and the complete canonical `DATA_*` environment has been supplied:

```bash
pnpm --filter @wiser/data-worker dev
```

## Configuration boundary / 关键配置边界

配置由 `src/config.ts` 严格校验；缺失、越界或部分配置会启动失败。使用 canonical `DATA_*` 名称；保留的 `WISER_DATA_*` aliases 仅用于迁移兼容并会产生 warning。 / `src/config.ts` validates the entire environment strictly; missing, out-of-range, or partial configuration fails startup. Use canonical `DATA_*` names. Retained `WISER_DATA_*` aliases are migration-only and produce a warning.

| Group / 分组                 | Canonical variables / 关键变量                                                                                                     |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Authority and scope / 权威域 | `DATA_DATABASE_URL`, `DATA_TENANT_ID`, `DATA_PROJECT_ID`, `DATA_MAX_SECURITY_LEVEL`, `DATA_POLICY_VERSION`, `DATA_WORKER_ACTOR_ID` |
| Scheduling / 调度            | `DATA_WORKER_ID`, `DATA_WORKER_CLAIM_LIMIT`, `DATA_JOB_LEASE_SECONDS`, `DATA_JOB_HEARTBEAT_SECONDS`, `DATA_JOB_POLL_INTERVAL_MS`   |
| Ingestion / 摄取             | `DATA_S3_*`, `DATA_CLAMAV_*`, `DATA_TIKA_*`, `DATA_INGESTION_*`                                                                    |
| Projections / 投影           | `DATA_WEAVIATE_*`, `DATA_OPENSEARCH_*`, `DATA_NEO4J_*`, `DATA_STAC_*`, `DATA_PROJECTION_*`                                         |
| Status server / 状态服务     | `DATA_WORKER_HEALTH_HOST` (default `0.0.0.0`), `DATA_WORKER_HEALTH_PORT` (default `3003`)                                          |

检索投影按信号分工：OpenSearch `wiser-evidence-v2` 使用 ICU + 官方 SmartCN + CJK bigram 构建中文/多语正文词法召回；Weaviate `WiserEvidenceChunkV2` 只保存受版本治理的外部向量并执行纯 `nearVector`；Neo4j 写入前创建并等待同步的 `wiser_entity_name_cjk_v1` 实体名全文索引。索引/collection 名带版本，因为 analyzer、tokenization 与过滤索引变化必须从 data-postgres 权威面重放，而不能原地假装兼容。 / Retrieval projections separate signals: OpenSearch `wiser-evidence-v2` uses ICU, the official SmartCN plugin, and a CJK-bigram fallback for Chinese/multilingual document text; Weaviate `WiserEvidenceChunkV2` stores governed external vectors and runs pure `nearVector`; Neo4j creates and awaits the synchronous `wiser_entity_name_cjk_v1` entity-name full-text index before graph writes. Index and collection names are versioned because analyzer, tokenization, and filter-index changes require replay from data-postgres authority rather than pretending to be compatible in place.

运行时 DSN 必须使用 Data Foundation 的受限 Worker role，不得使用迁移 owner；Supabase 仍是唯一身份权威，Worker 只接收 Tenant/Project 等 scoped references。 / The runtime DSN must use the restricted Data Worker role, never the migration owner. Supabase remains the sole identity authority; this process receives only scoped Tenant/Project references.

Worker 的 authority 写入必须沿合法状态边且每次精确推进一个 `row_version`；review checkpoint 只有在 ID、plan、hash、状态、批准者、安全等级和 policy 全部相同时才允许幂等重放，批准转换使用独立的受控 SQL。数据库 trigger 会对 runtime role 再次执行这些约束。 / Worker authority writes must follow legal state edges and advance exactly one `row_version`. Review checkpoints permit idempotent replay only when identity, plan, hash, status, approver, security level, and policy all match; approval uses its dedicated guarded SQL. Database triggers enforce the same boundary for the runtime role.

## Health and metrics / 健康与指标

来源登记通过现有入库 Handler 执行扫描、指纹与严格清单核对，保留声明的样本/部分/空文件状态，生成 `METADATA_QUALITY` / `DECLARED` 版本；其质量只评价登记完整性。该流程不调用 Tika 或 AI 映射计划，受限来源仍等待有权限的复核，临时清单读取失败可以重试。 / Source registration uses the existing ingestion Handler for scanning, fingerprints and exact manifest reconciliation. It retains sample/partial/empty states and creates `METADATA_QUALITY` / `DECLARED` versions whose quality measures registration integrity. It calls neither Tika nor an AI mapping planner; restricted sources still require authorized review, and temporary manifest reads remain retryable.

不同来源路径可在逐项匹配大小和哈希后引用同一个内容资产，清单与证据保留这些路径别名；重复路径、未列出的资产或不匹配的别名会失败。 / Distinct source paths may reference one content asset after individual size/hash checks; the manifest and evidence retain those aliases. Duplicate paths, unlisted assets and mismatched aliases fail validation.

- `GET /health/live`: scheduler 未停止时为成功。 / Succeeds while the scheduler is not stopped.
- `GET /health/ready`: scheduler 运行且最近一次 job poll 成功后为成功；排空或 poll failure 时返回 `503`。 / Succeeds while running after a successful job poll; draining or a poll failure returns `503`.
- `GET /metrics`: Prometheus text，包含 job outcome、recovery、in-flight 与 readiness counters；它是运行指标，不是业务或 publication authority。 / Prometheus text for job outcomes, recovery, in-flight work, and readiness; it is operational telemetry, not business or publication authority.

## Verify / 验证

```bash
pnpm --filter @wiser/data-worker test
pnpm --filter @wiser/data-worker typecheck
pnpm --filter @wiser/data-worker build
pnpm data:verify
pnpm data:smoke
```

`data:smoke` 需要已启动、迁移并 seed 的完整依赖；通用仓库 gate 仍为 `pnpm verify`。 / `data:smoke` requires running, migrated, and seeded dependencies; `pnpm verify` remains the repository-wide gate.

权威说明 / Authoritative references：

- [后端开发](../docs/src/content/docs/zh-CN/development/backend.md) / [Backend development](../docs/src/content/docs/en/development/backend.md)
- [Data Foundation 架构](../docs/src/content/docs/zh-CN/architecture/data-foundation.md) / [Data Foundation architecture](../docs/src/content/docs/en/architecture/data-foundation.md)
- [数据库开发](../docs/src/content/docs/zh-CN/development/databases.md) / [Database development](../docs/src/content/docs/en/development/databases.md)
- [测试与验证](../docs/src/content/docs/zh-CN/development/testing.md) / [Testing and verification](../docs/src/content/docs/en/development/testing.md)

Version analysis jobs (`data.analysis.process`) read already admitted objects using their immutable version and content hash. CSV and GeoJSON parsing writes bounded batches into scoped analysis tables. Each asset retains a parse outcome independently of source completeness and registration quality. The worker checks its current job lease before committing; a lost lease rolls back the analysis. Unsupported formats retain unknown counts. The original assets are never replaced.

CSV/JSON analysis is bounded at 64 MiB and 2,000,000 records per asset. Capacity and unknown-CRS failures retain unknown counts with an `UNSUPPORTED` reason; malformed content and hash mismatches remain `INVALID`. / CSV/JSON 分析按资产限制为 64 MiB、2,000,000 条记录。容量或未知坐标系问题保留未知计数与 `UNSUPPORTED` 原因，格式错误或哈希不符仍为 `INVALID`。

独立解析适配器校验来源哈希、流式字段与完成总数，在本地绑定记录 ID；不完整结果必须回滚。 / The isolated parser adapter verifies source hashes, streamed schemas and completion totals, binds record IDs locally, and rejects incomplete results.

`DATA_ANALYSIS_PARSER_URL` 配置内部解析器根地址，完整 Data profile 自动连接。XLSX/XLS、文档与压缩包逐资产解析，部分结果保留原因，容量失败回滚记录。 / `DATA_ANALYSIS_PARSER_URL` configures the private parser origin and is supplied by the complete Data profile. Workbook, document and archive analysis retains partial reasons and rolls back records on capacity failure.

地理分析只读取同版本清单里的格式伴随文件，并逐文件核验哈希；ADF 头文件产生覆盖记录，其余成员保留为格式组附件。 / Geospatial analysis reads only same-version manifest companions and verifies each hash; the ADF header produces coverage records while other members remain accounted-for format companions.

## Embedding projection rebuild / 嵌入投影重建

`src/embedding-rebuild-cli.ts` reads the configured project's authority evidence and writes a separate model-profile Weaviate collection with a resumable checkpoint and advisory lock. It leaves original publication state and other projections unchanged. API and Worker share `DATA_EMBEDDING_*`; tests use fake, while production requires a real provider. Run the configured Worker command `pnpm --filter @wiser/data-worker exec tsx src/embedding-rebuild-cli.ts` with the current Compose/runtime files, including `compose.override.yaml`. See the [local environment guide](../docs/src/content/docs/en/development/local-environment.md) for staging, verification, cutover and rollback.

该 CLI 在明确的项目范围内从权威证据重建独立模型集合，以独立位点和 advisory lock 支持续跑；不修改原发布状态及其他投影。API 与 Worker 共用 `DATA_EMBEDDING_*`，测试保留 fake，生产要求真实 provider。切换前按[本机环境指南](../docs/src/content/docs/zh-CN/development/local-environment.md)完成重建和检索验收，保留旧集合供回退。

The live consumer has a separate checkpoint for each real embedding profile and configured consumer name. It replays Weaviate writes despite shared success ledgers, skips other successful targets, and advances only after projection and publication succeed. Its first activation traverses retained history independently of the rebuild CLI; later starts resume. Fake retains the legacy checkpoint. For cutover and rollback, let the selected Worker profile catch up and verify coverage before changing API reads.

持续消费者按真实嵌入配置和消费者名称使用独立位点，不把共享台账的成功视为当前集合已完成；仅重放 Weaviate，跳过其他成功投影，投影与发布成功后才推进位点。首次启用独立遍历保留的历史，之后续跑；fake 保留原位点。切换与回退都先让所选 Worker 配置追平并验收，再切换 API 查询。

## Business relation projection / 业务关系投影

The Worker also runs a bounded authority reconciliation for reviewed business relations through the shared Data infra adapter. Its cursor and labels are independent of legacy publication/provenance projections. Approval and source withdrawal change the next sweep's writes; API authority checks apply immediately. Failures leave the cursor unchanged. / Worker 使用共享 Data infra 适配器分批同步已审核业务关系，位点与标签独立于已有发布/溯源投影。审核及来源撤回影响下一轮写入，API 权限检查立即生效；失败保留进度。

To rebuild a configured business projection after it is removed, use the existing Worker environment and pinned Compose files, including `compose.override.yaml`, with `pnpm --filter @wiser/data-worker exec tsx src/business-rebuild-cli.ts`. It completes the retained sweep and one full sweep with a per-project/target lock, preserving assertion IDs, originals and reviews. Keep one change owner for the target; inspect and verify an isolated target before any shared cutover. / 重建使用已有 Worker 环境，保留本地 Compose override，并执行上述命令。它完成保留进度及一次完整扫描，以项目/目标锁避免相互覆盖，原断言、原件与审核记录保留；共享切换前先验证隔离目标。
