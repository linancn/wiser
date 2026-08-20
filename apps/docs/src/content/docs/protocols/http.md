---
title: HTTP API
description: Agent EXCON v1 的资源、幂等、状态与错误约定。
---

## 协议角色

HTTP API 是唯一业务协议底座。Web、客户端 SDK、Skill 脚本和 MCP Server 都调用它，不直接访问领域表。

基础路径为 `/api/v1`。破坏性字段或语义变化必须发布新主版本；新增可选字段不改变 v1。

## 核心资源

| 方法   | 路径                                     | 作用                            |
| ------ | ---------------------------------------- | ------------------------------- |
| `POST` | `/episodes`                              | 从固定 ScenarioVersion 创建演练 |
| `GET`  | `/episodes/{episodeId}`                  | 获取状态与当前虚拟时间          |
| `GET`  | `/episodes/{episodeId}/observations`     | 获取当前参与者已经获得的观察    |
| `POST` | `/episodes/{episodeId}/submissions`      | 创建不可变提交版本              |
| `GET`  | `/submissions/{submissionId}/evaluation` | 获取评价状态与结果              |
| `GET`  | `/episodes/{episodeId}/feedback`         | 获取当前可见反馈                |
| `POST` | `/episodes/{episodeId}/advance`          | 授权推进虚拟时间或阶段          |
| `POST` | `/episodes/{episodeId}/finalize`         | 锁定最终提交                    |
| `GET`  | `/episodes/{episodeId}/events`           | 分页读取可见事件流              |

## 创建 Episode

```http
POST /api/v1/episodes
Authorization: Bearer <participant-token>
Idempotency-Key: 91a8f390-...
Content-Type: application/json
```

```json
{
  "scenarioVersionId": "018f...",
  "participantVersion": "dispatch-agent@1.3.0",
  "mode": "exercise"
}
```

成功返回 `201`；相同主体、路径和幂等键重试返回同一资源。幂等键复用但请求体不同，返回 `409`。

## 响应与错误

成功响应直接返回类型化资源。错误使用稳定 envelope：

```json
{
  "error": {
    "code": "EVIDENCE_NOT_OBSERVED",
    "message": "提交引用了当前参与者尚未获得的证据。",
    "traceId": "01J...",
    "details": {
      "claimId": "release-plan-01"
    }
  }
}
```

`details` 只能包含调用方已经有权知道的信息。对于未释放对象，响应不能确认它是否存在。

| 状态码 | 含义                             |
| ------ | -------------------------------- |
| `400`  | Schema 或字段范围错误            |
| `401`  | 缺少或无效身份                   |
| `403`  | 已知资源上的操作不被允许         |
| `404`  | 资源不存在或调用方无权知道其存在 |
| `409`  | 状态转换、版本或幂等冲突         |
| `422`  | 载荷有效，但违反领域规则         |
| `429`  | 限流；附 `Retry-After`           |

## 并发和一致性

写操作在数据库事务内锁定 Episode 当前版本。响应包含版本/ETag；需要防止覆盖的管理操作使用 `If-Match`。状态变化与 Event 写入同一事务。

列表接口使用稳定 cursor，不使用会因新事件插入而漂移的页码。

## 认证

Web 用户使用 Supabase Auth 会话；外部智能体使用可撤销、可散列存储、带作用域的 token。任何 service-role 或数据库凭据都不能交给参训智能体。

常用 scope 示例：`episode:create`、`observation:read`、`submission:create`、`feedback:read`。管理员推进和人工裁决使用独立 scope。
