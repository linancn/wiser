---
title: WISER Design System
description: Agent EXCON 现有水系统控制台视觉如何成为所有 WISER 系统共用的 UI、双语与主题合同。
docType: design-system
scope: wiser-web
status: active
authoritative: true
owner: wiser
language: zh-CN
whenToUse:
  - 新建或修改任何 WISER 前端页面、组件、文案或主题时
whenToUpdate:
  - 颜色、字体、布局、组件、交互、语言或无障碍规则变化时
checkPaths:
  - apps/web/src/**
  - apps/docs/src/**
lastReviewedAt: 2026-08-22
lastReviewedCommit: 2b55ba6c5d4f88bc058588021169c713ad7f9c51
---

## 设计方向

WISER 面向水系统专家、导调人员和数据治理人员。界面的单一工作是：让使用者快速辨认权威事实、当前状态、风险、证据和下一步操作。

现有 Agent EXCON 的“水系统仪表台”视觉成为全 WISER 的设计基线。它不是通用 SaaS 面板：深水色表达权威与深度，河道青色表达流动关系，水位尺琥珀表达注意和人工门禁，等深线与流线只在一个签名背景层出现。所有新增系统沿用这一语言，不再另造品牌皮肤。

## 设计 Token

核心色来自当前 Web：

| 名称       | 基准色    | 用途                         |
| ---------- | --------- | ---------------------------- |
| Abyss      | `#071a21` | 深色画布、强信息区           |
| Channel    | `#0b303a` | 深色抬升面与渠道关系         |
| River      | `#087f8c` | 主交互、选中、流动关系       |
| Ripple     | `#5cc7d2` | 深色主题高亮与焦点           |
| Gauge      | `#dfa33e` | 注意、人工门禁、时间敏感状态 |
| Floodplain | `#edf5f6` | 浅色画布                     |

组件只能消费语义 Token：`canvas`、`surface`、`text-*`、`accent-*`、`success-*`、`warning-*`、`danger-*`、`border-*`、`shadow-*`。禁止在系统页面内部写新的品牌色或用颜色替代文字状态。

浅色与深色必须是同一信息层级的两种映射，而不是两个设计。主题使用 `wiser-theme` 持久化，首次访问尊重系统偏好，初始化脚本在 React hydration 前设置 `data-theme`，避免闪烁。

## 字体与信息层级

- Display：`Iowan Old Style` / 思源宋体一类克制的衬线字，只用于产品论点、页面主标题和重大阶段。
- Body：IBM Plex Sans / Noto Sans SC / 系统无衬线，用于任务、说明和操作。
- Utility：IBM Plex Mono / 系统等宽，用于 ID、时间、版本、哈希、指标和协议字段。
- 正文基准至少 16px，行高约 1.55；不能为了密度牺牲可读性。
- 中文是默认表达，协议字段保留英文；英文页面保持相同信息、路由、操作和状态。

## 布局合同

```text
┌ WISER brand ─ Systems ─ Context ─ Theme ─ Language ┐
├ system navigation / breadcrumbs / active project ──┤
│                                                    │
│ page thesis + authority/status strip              │
│                                                    │
│ primary workspace                                 │
│ evidence / operations / diagnostics               │
│                                                    │
└ source, authority, version, freshness ─────────────┘
```

- 全局 Shell、系统切换、Project 上下文、主题和语言在所有页面位置一致。
- 页面先说明用户面对的对象和当前权威状态，再展示指标或技术细节。
- 列表、目录和运行态使用相同的卡片、表格、过滤、分页、空态和错误态原语。
- 技术诊断可以更密，但不得污染管理和业务页面的第一视觉层。
- 宽屏最大内容宽度、窄屏 390px、键盘导航和 reduced-motion 都是强制验收面。

## 状态与组件

统一组件至少包括：AppShell、SystemSwitcher、ProjectSwitcher、PageHeader、AuthorityStrip、StatusBadge、MetricCell、DataTable、FilterBar、EmptyState、FailureState、OperationTimeline、EvidenceLink、VersionPicker、ThemeToggle 和 LocaleSwitcher。

- 成功、警告、失败、等待与未知状态同时使用文字、形状和颜色。
- 按钮使用动作动词；同一动作从按钮到 Toast 保持同名。
- 空态解释可以做什么；失败态说明发生了什么、影响范围和恢复动作。
- 所有可见文案必须同时进入 zh-CN 与 en 字典，禁止组件内散落硬编码双语三元表达。

## 系统适配

- Agent EXCON 的签名对象是 Run、Receipt、Barrier 和协作流线。
- Data Foundation 的签名对象是 DataItem、Version、Ingestion、Operation、Lineage 和地图图层。
- 两者共享 Shell、Token 和组件，但不伪装领域术语：同一种视觉状态可以承载不同领域对象。
- 地图、Trace、血缘图等高复杂度视图可以拥有专用画布，但主题、焦点、面板、图例和状态语义仍来自共享系统。

Data 地图把这一合同落实为可访问控件，而不是只靠画布颜色：DataItem 版本链接使用 `aria-current`，地图表单同时固定 bbox、不可变 Version 与 EPSG:4326/4490 source CRS；PostGIS authority、STAC extent、vector MVT、raster 四图层都用带文字的 checkbox，缺失图层保持 disabled。控制区持续显示 selectedVersion 与 `source CRS → EPSG:3857`，图层颜色从当前主题 token 读取，深浅色切换不改变权威层级。浏览器瓦片使用同源 Web 路径，服务器身份与内部 GIS origin 不出现在 UI。

## 验收

每个页面必须通过中文与英文、浅色与深色、桌面与 390px、键盘焦点、无浏览器错误、无横向溢出和 reduced-motion 检查。截图评审同时比较 EXCON 与 Data Foundation，任何看起来像第二套产品的局部 UI 都需要回收到共享 Token 或组件。
