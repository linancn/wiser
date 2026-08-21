# WorkBuddy 与 WISER 展示动线

## 准备

在仓库根目录运行 `pnpm showcase:preflight`。要求它确认依赖、本机
WorkBuddy CLI、展示端口和遗留会话状态；preflight 不得以一次付费模型
请求探测额度。

`scripted` 与 `rework` 只代表四个参训进程不调用模型。通过 WorkBuddy
GUI 新建 Lead 任务仍可能消耗当前 WorkBuddy 订阅。若用户禁止一切模型
调用，不要打开 WorkBuddy；直接运行确定性 supervisor 或交付人工命令，
并明确说明没有执行 GUI 展示。

真实 WorkBuddy 运行还需要用户确认 WorkBuddy 已登录且额度可用。如果
WorkBuddy 显示登录、订阅或 macOS 自动化权限界面，暂停并交还用户处理。

## 启动 WorkBuddy Lead

1. 使用 Computer Use 打开 `/Applications/WorkBuddy.app`。
2. 在 WorkBuddy 中打开 `/Users/davidli/projects/wiser`，创建一个新的顶层
   Lead 任务。不要恢复旧参训会话。
3. 将
   `cookbooks/workbuddy-yongding-tdd/showcase/WORKBUDDY_LEAD_SHOWCASE_TASK.md`
   的内容和所选 profile 交给 Lead。一个 Lead 只控制生命周期，不调用
   参训 MCP。
4. 等待 Lead 报告脱敏的 `showcase-session.json` 绝对路径。可用
   `pnpm showcase:status` 对照其 `runId`、`state`、`webUrl` 和
   `expiresAt`，不要打开 `lab/credentials` 或 `workbuddy/mcp`。

每个 profile 使用四个独立顶层进程。不得启用 WorkBuddy Agent Team、
`--swarm` 或共享 token 环境。

## 展示协作

使用浏览器打开 session 返回的 URL，规范路径为：

```text
http://127.0.0.1:<port>/zh-CN/runs/<runId>/collaboration
```

按以下动线展示，不通过 WorkBuddy mailbox 传递案例事实：

1. 确认四个 RunAgent、四个角色和当前 Task 状态。
2. 查看三个专业角色向协调角色发送的 Message、不可变 ArtifactVersion
   和各收件人的 issued/acknowledged Receipt。
3. 查看带 `threadId`、请求/回复关系和相关资源的交互链。
4. 查看 `analysis-ready` 后协调角色发布团队方案。
5. 查看三名专业角色恢复精确修订、独立背书以及
   `endorsement-ready`。
6. 在 rework profile 中查看首次拒绝、scoped grant、immutable revision 2
   和最终接受。
7. 单独说明 OTel coverage；它不改变 Event、Receipt、评价或 Barrier。

切换 profile 前，先要求同一个 Lead 执行 `pnpm showcase:stop`，并确认上
一会话清理完成。推荐顺序是 scripted、rework，最后才是得到明确授权的
workbuddy。

## 结束

演示结束后通过 WorkBuddy Lead 执行 `pnpm showcase:stop`，再运行
`pnpm showcase:status` 确认子进程已停止、凭据与 MCP 配置已删除。TTL
为十五分钟；即使浏览器或 WorkBuddy GUI 被关闭，监督器也必须在 TTL
到期时清理。

## English

Use Computer Use to create one WorkBuddy host-controller task, then use the
browser to present the exact Run's `/collaboration` route. Stop and clean each
profile before starting the next one. Four isolated participant processes—not
the Lead—perform the exercise.
