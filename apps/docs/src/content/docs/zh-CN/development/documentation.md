---
title: 文档开发与治理
description: WISER README、文档站和组件 README 的职责，以及双语、导航、Docpact 和读者验收规则。
docType: workflow
scope: wiser-documentation
status: active
authoritative: true
owner: wiser
language: zh-CN
whenToUse:
  - 新建、重写、移动或删除 WISER 文档时
whenToUpdate:
  - 文档职责、信息架构、双语、导航、版本来源、Docpact 或读者验收规则变化时
checkPaths:
  - README.md
  - README.en.md
  - AGENTS.md
  - CONTRIBUTING.md
  - apps/**/README.md
  - packages/**/README.md
  - infrastructure/**/README.md
  - apps/docs/src/content/**
  - .docpact/**
lastReviewedAt: 2026-08-22
lastReviewedCommit: c9b9047b81f84ad7a704f9d0806526a43a90d7f1
---

## 一条信息只设一个权威入口

| 文档层级                        | 回答的问题                                             | 应保留的内容                                                   | 不应承载的内容                                             |
| ------------------------------- | ------------------------------------------------------ | -------------------------------------------------------------- | ---------------------------------------------------------- |
| 根 `README.md` / `README.en.md` | WISER 是什么、有哪些系统、如何第一次跑起来、入口在哪里 | 简短系统地图、最短启动路径、前后端入口、验证命令、详细文档链接 | 完整协议、长篇架构说明、依赖版本清单、阶段交付日志         |
| `apps/docs` 文档站              | 系统当前如何工作，开发者如何设计、运行、测试和排障     | 架构、边界、协议、运行手册、安全、开发流程、可执行示例         | 已被替代的方案、里程碑复盘、仅对一次迁移有意义的叙事       |
| 组件 `README.md`                | 这个目录负责什么，如何单独运行和验证                   | 本组件边界、入口、专属配置、聚焦命令、指向权威文档的链接       | 跨系统架构副本、重复的根快速开始、从 manifest 抄录的版本表 |

`AGENTS.md` 是仓库交付合同，`CONTRIBUTING.md` 是贡献流程；二者不是产品介绍页。架构事实进入文档站，确定性治理事实进入 `.docpact` 配置，Git 保留历史。不要用新增 README 或“补充说明”重复现有权威来源。

## 当前态写作

文档用现在时描述当前可运行、可验证的系统。读者应能区分三类事实：

- **当前支持**：写出实际入口、前置条件、命令、可观察的成功结果和失败恢复动作。
- **当前不支持**：明确说明边界及安全失败行为，不用样例、兼容层或推测掩盖缺口。
- **未来计划**：只在确有必要时链接 issue 或决策记录，不把计划混进当前运行步骤。

删除“已经完成”“本轮交付”“从演练场演进而来”等不改变当前操作的历史叙事。保留设计理由的前提是它仍约束现在的实现或选择。命令必须从仓库根目录可复制执行；示例输出只保留读者判断成功所需的稳定信号。

每次修改都检查是否出现同一端口表、环境变量解释、协议字段或架构图的第二份副本。若多个页面需要同一事实，在权威页面保留完整内容，其余页面使用清晰链接和一句上下文。

## 双语、slug 与导航

- 中文是默认文档，位于 `apps/docs/src/content/docs/zh-CN`；英文位于同级 `en` 目录。
- 每个面向人的页面都有一对翻译文件，使用相同相对路径和 locale-free slug。中文 `/development/frontend/` 对应英文 `/en/development/frontend/`。
- 两种语言保持相同的信息、步骤、表格行、状态和链接目标。英文不是摘要版，中文也不夹带未翻译的叙述段落；协议名、命令、路径和代码标识保持原样。
- 新页面、重命名和删除必须同步修改两份相邻 `meta.json`，并在同一导航位置出现。不要依靠文件系统顺序产生侧栏。
- 从中文页面链接中文默认路由；从英文页面链接 `/en/...`。修改后通过站内导航、语言切换和搜索各打开一次。

## Frontmatter 合同

文档站内的治理文档必须提供完整 frontmatter：

```yaml
---
title: 面向读者的标题
description: 一句话说明页面解决的问题
docType: workflow
scope: repository-or-system
status: active
authoritative: true
owner: wiser
language: zh-CN
whenToUse:
  - 读者应在什么任务中打开它
whenToUpdate:
  - 哪些事实变化会使它过期
checkPaths:
  - 会触发复核的真实仓库路径
lastReviewedAt: YYYY-MM-DD
lastReviewedCommit: 完整提交 SHA
---
```

英文页面使用 `language: en`，其他治理字段与中文页面表达同一契约。`checkPaths` 只列真正影响页面的源路径，不能为了“看起来完整”覆盖整个仓库。`lastReviewedAt` 和 `lastReviewedCommit` 只在内容已经对照该提交复核后更新。

## Docpact 工作流

Docpact 是本机 Cargo 工具，不是 npm dependency。首次使用时安装仓库要求的版本，并确保 `~/.cargo/bin` 在 `PATH`：

```bash
cargo install docpact --version 0.1.9 --locked
```

### 1. 修改前路由

用实际准备修改的路径取得最小阅读集：

```bash
pnpm docpact:route --paths 'apps/docs/src/content/docs/zh-CN/development/**,apps/docs/src/content/docs/en/development/**'
```

阅读返回的权威文档后再起草。若结果提示没有 tracked path、rule 或 recommendation，先检查路径与治理配置；不能把告警理解成“无需阅读”。

### 2. 修改后 lint

```bash
pnpm docpact:check
```

该命令只以当前未提交 worktree 为差异来源，检查未覆盖变更、应复核文档与陈旧文档。必须在每个 Red/Green 提交前运行；提交后它不会再看到该切片。

保留多个小提交的分支在交接前还要运行 branch-wide lint，把 `<base-ref>` 替换为实际目标分支（通常 `main`）：

```bash
docpact lint --root . --merge-base <base-ref> \
  --mode enforce --fail-on-uncovered-change --fail-on-stale-docs
```

需要逐条排查 worktree finding 时保存完整报告，再按诊断 ID 查看：

```bash
docpact lint --root . --worktree --format json \
  --output .docpact/runs/latest.json
docpact diagnostics show \
  --report .docpact/runs/latest.json --id '<diagnostic-id>' --format json
```

只有真正完成复核后才能记录 review evidence；不能用 review mark 掩盖缺少规则或未覆盖变更。

### 3. 治理变更 validate

修改 `.docpact/config.yaml`、规则、ownership、routing 或 coverage 时运行：

```bash
pnpm docpact:validate
```

普通文案修改不需要伪造治理变更；但仍必须通过 lint。文档站内容同时运行 typecheck、build 和 Playwright，最后由根目录 `pnpm verify` 收敛。

## 版本与配置的真相来源

文档不维护“当前最新版本”表，也不手工复制锁文件内容。按对象读取真实来源：

| 对象                          | 权威来源                                                 |
| ----------------------------- | -------------------------------------------------------- |
| Node 与包管理器范围           | 根 `package.json`、`.nvmrc`、`.node-version`             |
| npm workspace 直接依赖        | 对应 `package.json`                                      |
| npm 解析结果与完整性          | `pnpm-lock.yaml`                                         |
| 容器 tag 与 digest            | `compose.yaml` 及被其引用的 Compose 配置                 |
| Supabase 本机配置与数据库结构 | `supabase/config.toml`、migrations、schemas、seed 与测试 |
| 环境变量目录                  | `.env.example` 与读取它们的配置代码                      |
| 可调用 HTTP/GraphQL/MCP 契约  | 生成的 schema/OpenAPI、协议实现和文档站协议页            |

升级依赖时在同一变更中更新 manifest、lockfile 或镜像 digest，并验证兼容性。文档只说明选择和兼容边界，不重复易过期的精确版本。

## 读者验收

完成写作后，让一位没有参与本次修改的人或一个无对话上下文的 agent 只凭文档完成阅读测试。至少验证它能准确回答：

1. WISER 当前有哪些系统，产品 Web、后端 API、MCP 和文档站分别从哪里进入？
2. 在干净 checkout 上应该运行哪个命令，看到什么才算启动成功？
3. 当前任务应该从哪个目录开始，最小验证命令是什么？
4. 统一 Auth、Agent EXCON 和 Data Foundation 的数据边界分别是什么？
5. 失败后应查看哪类日志或运行哪个恢复命令，哪些 reset 会丢失数据？
6. 一项事实的权威来源在哪里，其他页面是否只是链接而不是复制？

验收还包括：从文档首页最多两次导航到达目标页；中英文切换停留在同一 slug；所有内部链接可打开；命令可以复制；页面在浅色、深色、桌面和 390px 下无溢出；搜索能以读者会使用的词找到页面。

若读者需要猜测隐藏前提、从多个冲突页面拼答案，或把计划误认为现状，文档尚未通过验收。修正文档后重新测试，而不是在评审说明中补充口头背景。
