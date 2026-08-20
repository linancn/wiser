---
title: 安全与数据边界
description: 防止事实泄露、越权观察、凭据扩散和不可审计修改。
---

## 三类数据必须分开

| 数据层     | 示例                            | 访问主体                     |
| ---------- | ------------------------------- | ---------------------------- |
| 公开观察   | 当前已释放的监测数据、任务说明  | 对应 Episode 的参与者        |
| 受限状态   | 未释放 Inject、内部阶段条件     | 导调领域服务、授权管理员     |
| 事实与裁决 | Outcome、隐藏标签、完整评价规则 | Worker、裁决服务、授权评审者 |

浏览器和参训智能体永远不能接收完整事实对象，再依赖前端隐藏字段。服务端必须从查询源头隔离数据。

## Supabase 与 RLS

- 所有暴露 schema 的表启用 RLS。
- 新表不会天然暴露给 Data API；`GRANT` 和 RLS 是两个独立步骤。
- 策略使用 `TO authenticated` 加所有权谓词，不能只验证角色。
- `UPDATE` 同时配置 `USING` 和 `WITH CHECK`，并提供需要的 `SELECT` policy。
- 授权数据放在 `app_metadata`，不能使用用户可修改的 `user_metadata`。
- 前端只使用 publishable key；secret/service-role key 仅限服务端。
- View 使用 `security_invoker`，特权函数放入未暴露 schema 并撤销默认 `PUBLIC EXECUTE`。

每次 migration 后运行数据库安全 advisor，并以真实 `anon`、`authenticated` 和服务角色分别做集成测试。

## 时间与证据授权

Observation 不是 Inject 的别名。系统先判断该参与者在当前虚拟时间是否有权访问，再生成独立 Observation 和访问事件。提交引用证据时，必须验证该证据已经成为同一参与者的 Observation。

这条约束同时阻止越权访问和历史回放中的时间穿越。

## Codex 和 API 凭据

- 本机 Codex 登录只用于开发者宿主机。
- 不把 `~/.codex`、访问 token 或 API key 烘焙进镜像、挂载到共享容器或写入事件 payload。
- CI 使用 fake provider；显式的在线测试使用最小权限 secret。
- 日志记录供应商、模型、耗时和 token 数，不记录原始凭据。
- 用户上传和模型输出都视为不可信内容，不能当成系统指令执行。

## Compose 安全

官方 Supabase 镜像作为一个版本集合锁定；使用 Envoy 当前配置，不复用旧 Kong 配置。真实 `.env` 不提交 Git。数据库和 Studio 默认只绑定本机或受控网络，公开部署必须增加 TLS、备份、密钥轮换和网络策略。

普通 `docker compose down` 保留数据；删除卷必须由操作者显式确认。

## 发布前检查

- [ ] 未释放的 Inject 无法通过 API、日志或错误详情推断。
- [ ] 幂等重试不会重复创建提交或评价。
- [ ] 事实、规则和人工覆盖均有 actor、版本与 trace ID。
- [ ] 下载链接短期有效并绑定对象权限。
- [ ] RLS、SQL 事务和状态机负向测试在真实 PostgreSQL 上通过。
- [ ] 在线 AI 测试不是合并请求的必需条件。
