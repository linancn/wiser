# 展示安全边界

## 权限与身份

- Codex 是展示导演，WorkBuddy Lead 是宿主控制器；两者都不计入四个
  RunAgent，也不调用 `agent-excon` 参训工具。
- 四个参训者必须是四个独立顶层进程，每个进程只有自己的 0600 MCP
  配置和一个 bearer token。
- 禁止 `--swarm`、`-y`、`bypassPermissions`、共享 token 环境，以及用
  WorkBuddy mailbox 传递业务事实。
- 新业务内容只通过 WISER `/sync` 发放。Message 创建不等于收件人已
  获知；以 issued/acknowledged Receipt 为准。

## 真实模型授权

scripted 和 rework 的四个参训进程不调用模型；但 WorkBuddy Lead 仍可能
使用已登录订阅。只有用户明确要求 Codex 操作 WorkBuddy，或另外授权 Lead
用量时，才可创建 GUI Lead 任务。若用户要求全程零模型调用，必须绕过
WorkBuddy GUI，直接运行确定性 supervisor，并说明没有操作 WorkBuddy。

workbuddy profile 还会让四个参训者产生真实 WorkBuddy 用量，必须在当前
任务中得到用户明确授权后，才可执行：

```bash
WORKBUDDY_LIVE=1 pnpm showcase:start --profile workbuddy
```

不得从“演示一下”“检查配置”或过去的授权推断许可。仓库保留的历史
live 报告中，最近一次四个角色都收到 `429` 额度耗尽；这不是当前额度
状态的证明，也不能通过付费探测绕过。当前运行遇到 429 时立即停止，
不切换模型、不自动重试、不伪装成 scripted 成功。

## 机密与报告

只读取 0600 的脱敏 session/report 和角色进程摘要。不要打开、截图、
复制或报告以下内容：

- `lab/credentials/`
- `workbuddy/mcp/`
- bearer token、operator token 或 lease token
- 角色私有 Receipt 正文、MCP 配置或完整 stderr

最终成功必须由四个最新确定性 `ACCEPTED` 与 `analysis-ready`、
`endorsement-ready` 两个权威 Barrier 同时证明。Agent 自报、退出码和
OpenTelemetry 都只能用于诊断。

## 立即停止条件

遇到以下任一情况，停止当前 profile，保留脱敏诊断并执行清理：

- WorkBuddy 未登录、额度不足/429，或出现需要用户决定的订阅界面；
- Computer Use 或浏览器控制不可用；
- 身份、Run、RoleSlot 或 Receipt 链不匹配；
- lease 过期、fencing 失败、稳定 401/403/409，或 bounded wait 耗尽；
- session manifest 校验失败、Web 指向不同 Run，或事件链未验证；
- 任一角色失败、缺少权威评价或缺少任一 Barrier；
- TTL 到期、用户要求停止，或 Codex/WorkBuddy 被中断。

停止时运行 `pnpm showcase:stop`，再用 `pnpm showcase:status` 确认四个
角色、Lab 与 Web 子进程都已结束，`lab/credentials/` 和
`workbuddy/mcp/` 已删除。清理失败本身是失败状态，不能报告完成。

## English

Live model use is a separate, current-turn authorization. Stop without retry
on quota errors or any identity, Receipt, lease, replay, or authoritative-gate
failure. Never expose credentials, and verify cleanup rather than assuming the
TTL or a closed GUI performed it.
