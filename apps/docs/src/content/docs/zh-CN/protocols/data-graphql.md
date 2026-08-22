---
title: Data GraphQL API
description: Data Foundation schema-first GraphQL 的字段、统一 Handler、身份、上限与 mutation 语义。
docType: protocol-reference
scope: data-graphql-api
status: active
authoritative: true
owner: wiser
language: zh-CN
whenToUse:
  - 实现或调用 Data Foundation GraphQL API 时
whenToUpdate:
  - SDL、resolver、Capability mapping、身份、上限或错误语义变化时
checkPaths:
  - apps/api/src/data-foundation/schema.graphql
  - apps/api/src/data-foundation/graphql-module.ts
  - packages/data-contracts/src/capability/**
lastReviewedAt: 2026-08-22
lastReviewedCommit: 4fcb9d65d26ea998e9e043ac7c55d581aae6f0aa
---

## 入口与权威契约

Data GraphQL 运行在共享 Fastify API：

```text
POST /graphql
Content-Type: application/json
```

实现使用 Mercurius 的 schema-first SDL，不使用 decorator 或 TypeScript AST 扫描。GraphQL field 只是 22 项 Capability 的投影；resolver 与 REST 调用同一个 `DataCapabilityHandler`，因此输入/输出 Zod 校验、Scope、安全 ceiling、Purpose、timeout、幂等和 audit 语义一致。

GraphQL 与 Mercurius 的精确兼容版本由 `apps/api/package.json` 和根 lockfile 定义，并由 API typecheck/build 验证。协议文档不复制会随依赖升级变化的版本清单。

SDL 位于 `apps/api/src/data-foundation/schema.graphql`，运行时同一常量有回归测试。Capability 的完整 JSON Schema 与版本仍以 `GET /api/data/v1/capabilities` 为权威发现入口。

## 身份 Header

每个 GraphQL 请求都必须携带：

```http
Authorization: Bearer <supabase-jwt-or-wdc1-delegated-credential>
X-Wiser-Tenant-Id: <tenant-uuid>
X-Wiser-Project-Id: <project-uuid>
X-Wiser-Purpose: <bounded-purpose>
```

API 重新解析 Supabase Membership/Role/Scope 并验证 Tenant/Project 与返回上下文完全一致。未认证返回 HTTP `401` 和 `NOT_AUTHENTICATED`；字段不存在与越权仍遵循相应 Capability 的 fail-closed 语义。

每个 mutation HTTP 请求还要求 UUID：

```http
Idempotency-Key: <uuid>
```

一个请求只允许一个 mutation field，因此一个 key 只对应一条 command。重试必须使用完全相同的 operation name、variables、身份上下文和 key。

## Query fields

| Field                 | Capability                   | 作用                                                     |
| --------------------- | ---------------------------- | -------------------------------------------------------- |
| `dataCatalog`         | `data.catalog.search`        | 游标目录 connection                                      |
| `dataItem`            | `data.catalog.get`           | 一个 DataItem 与可选版本                                 |
| `dataQuery`           | `data.query`                 | 结构化字段/过滤查询                                      |
| `dataSearch`          | `data.search.federated`      | 多后端 RRF 综合检索                                      |
| `knowledgeSearch`     | `data.knowledge.search`      | 证据/知识检索                                            |
| `graphExpand`         | `data.graph.expand`          | 有界实体邻域                                             |
| `graphFindPath`       | `data.graph.findPath`        | 有界关系路径                                             |
| `geoQuery`            | `data.geo.query`             | 受控空间谓词                                             |
| `geoIntersect`        | `data.geo.intersect`         | 两个受控空间目标相交                                     |
| `dataOperation`       | `data.operation.get`         | 一个 Operation                                           |
| `dataItemVersions`    | `data.catalog.versions.list` | 版本 connection                                          |
| `dataItemVersion`     | `data.catalog.versions.get`  | 精确不可变版本                                           |
| `dataIngestion`       | `data.ingestion.get`         | 入库会话、质量/Agent/投影摘要                            |
| `dataOperationEvents` | `data.operation.events`      | 有界 Operation event page；GraphQL 返回 JSON，不使用 SSE |

Connection 返回 `nodes` 与 `pageInfo { endCursor hasNextPage }`。其余分页结果保留 `nextCursor`。Cursor 是不透明、scope-bound 的；不能从 REST、另一个 Tenant/Project 或旧授权版本复制。

## Mutation fields

| Field                       | Capability                    | 结果                                  |
| --------------------------- | ----------------------------- | ------------------------------------- |
| `createDataIngestion`       | `data.ingestion.create`       | 创建异步 Operation                    |
| `createDataItem`            | `data.catalog.create`         | 创建目录 DataItem                     |
| `createDataUploadSession`   | `data.uploadSession.create`   | 生成受控上传计划                      |
| `completeDataUploadSession` | `data.uploadSession.complete` | 核对并完成上传                        |
| `submitDataIngestion`       | `data.ingestion.submit`       | 读取当前版本后提交持久任务            |
| `approveDataIngestion`      | `data.ingestion.approve`      | 消费显式 `expectedVersion` 的审核批准 |
| `rejectDataIngestion`       | `data.ingestion.reject`       | 消费显式 `expectedVersion` 的拒绝     |
| `cancelDataOperation`       | `data.operation.cancel`       | 读取当前版本后请求取消                |

GraphQL 没有隐式“成功即发布”。长任务返回统一 `Operation`，调用方继续用 `dataOperation`/`dataOperationEvents` 对账。upload Session 返回的预签名 URL 仍由客户端直接 PUT/上传分片；GraphQL 进程不代理大文件正文。

## 查询示例

```bash
curl --fail http://127.0.0.1:3001/graphql \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $DATA_API_BEARER_TOKEN" \
  -H "X-Wiser-Tenant-Id: $DATA_TENANT_ID" \
  -H "X-Wiser-Project-Id: $DATA_PROJECT_ID" \
  -H 'X-Wiser-Purpose: data-steward-console' \
  --data-binary '{
    "query":"query Item($id: ID!, $version: ID) { dataItem(id: $id, version: $version) { dataItemId name securityLevel selectedVersion { versionId version sourceHash } } }",
    "variables":{"id":"00000000-0000-4000-8000-000000000000"}
  }'
```

真实 ID 必须来自已授权目录结果。不要把 bearer 写入 query/variables、GraphQL 日志或客户端缓存。

## Mutation 示例

```bash
curl --fail http://127.0.0.1:3001/graphql \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $DATA_API_BEARER_TOKEN" \
  -H "X-Wiser-Tenant-Id: $DATA_TENANT_ID" \
  -H "X-Wiser-Project-Id: $DATA_PROJECT_ID" \
  -H 'X-Wiser-Purpose: data-steward-console' \
  -H "Idempotency-Key: $(uuidgen | tr '[:upper:]' '[:lower:]')" \
  --data-binary '{
    "query":"mutation Create($input: CreateIngestionInput!) { createDataIngestion(input: $input) { operationId status progressPercent version } }",
    "variables":{"input":{"assetIds":["00000000-0000-4000-8000-000000000000"],"ownerProjectId":"00000000-0000-4000-8000-000000000000","intendedUses":["catalog"],"requestedSecurityLevel":"L1_INTERNAL"}}
  }'
```

示例中的 UUID 是占位值。实际 `assetIds` 必须来自当前 Project 中已完成的 upload Session，`ownerProjectId` 必须等于授权 Project。

## 资源与执行上限

运行时固定：

- query depth 默认最大 8；
- complexity 默认最大 500；带 `first` 的高成本 field 按最多 100 倍计权；
- HTTP query timeout 默认 30 秒；Capability 自身还受 Registry timeout 约束；
- 禁止 batched queries；
- 禁止 subscription；
- 禁止一个 mutation operation 选择多个 mutation field；
- GraphiQL 关闭；生产关闭 introspection；
- query 文本最大 100,000 字符；
- 响应 `private, no-store`。

`CapabilityLoader` 在单请求内按 `capabilityId + canonical input` 复用相同查询 Promise；`DataItem.selectedVersion` 使用 Mercurius loader 批量解析。Loader 只优化同一已授权请求，不跨身份或请求缓存授权结果。

## 字段级授权

`DataItem.sourceOrganization` 只有在实时 Scope 包含 `data.catalog.sensitive.read` 时返回；否则为 `null`。其余字段仍经过 Capability 输出 schema 与底层 RLS/脱敏。客户端不能用 fragment、alias、introspection 或错误差异推断不可见字段。

Graph、Geo、Search field 始终使用结构化输入和服务端参数化 adapter，不暴露通用 SQL/Cypher/DSL scalar。

## 错误与安全重试

GraphQL validation/execution error 返回固定安全 message，`extensions.code` 保留稳定类别；底层 SQL、对象存储、投影正文、Scope 清单或资源存在性不会进入错误：

```json
{
  "data": null,
  "errors": [
    {
      "message": "GraphQL request failed.",
      "extensions": { "code": "IDEMPOTENCY_KEY_REQUIRED" }
    }
  ]
}
```

无效/过大的请求通常返回 HTTP `400`；身份缺失返回 `401`；成功进入 GraphQL 执行但 field 失败时响应通常为 HTTP `200` 加 `errors`。调用方必须同时检查 HTTP 与 GraphQL envelope。

Query 可按相同 cursor 安全重试。Mutation 只能以相同身份、operation、variables 与 `Idempotency-Key` 重试；同 key 不同 variables 是冲突。之后通过 `dataOperation` 或最小资源 Query 对账。
