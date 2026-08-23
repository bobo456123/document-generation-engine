# 开发文档中心

本目录是 AI Business Documentation Engine 的开发事实库，用于记录产品从 MVP 到后续扩展的完整生命周期，并让新的开发者或 Agent 可以在不依赖历史聊天记录的情况下继续工作。

面向使用者的安装、配置和完整任务示例仍以根目录 [README](../README.md) 为准。

## 开始阅读

新的开发者或 Agent 按以下顺序读取：

1. [当前状态](./current/STATUS.md)：确认已完成内容、当前里程碑和活动工作项。
2. [当前交接](./current/HANDOFF.md)：确认最后验证基线、下一步行动和阻塞项。
3. `current/HANDOFF.md` 指向的活动工作项；没有活动工作项时，不得自行把候选路线图当作已确认需求。
4. 与任务相关的[当前需求](./product/REQUIREMENTS.md)、[当前架构](./architecture/OVERVIEW.md)和[架构决策](./architecture/decisions/README.md)。
5. [开发流程](./development/WORKFLOW.md)和对应的测试、安全规范。

## 信息结构

| 区域 | 作用 | 更新方式 |
|---|---|---|
| [`current/`](./current/STATUS.md) | 当前状态、候选路线图和唯一交接入口 | 每项工作结束前更新 |
| [`product/`](./product/VISION.md) | 当前有效的产品愿景和需求 | 产品能力或边界变化时更新 |
| [`architecture/`](./architecture/OVERVIEW.md) | 当前实现架构、领域模型和 ADR | 架构变化时同步更新 |
| [`development/`](./development/WORKFLOW.md) | 开发、测试、安全和文档治理规则 | 流程变化时更新 |
| [`work-items/`](./work-items/README.md) | 功能、修复和改进的实施记录 | 一个有意义的变更对应一个 WI |
| [`milestones/`](./milestones/v0.1-mvp/README.md) | 已确认版本的目标、实施历史和验收证据 | 里程碑关闭后冻结 |
| [`templates/`](./templates/WORK-ITEM.md) | 里程碑、工作项、ADR 和交接模板 | 字段规范变化时更新 |
| [CHANGELOG](./CHANGELOG.md) | 已交付版本的用户可见能力摘要 | 里程碑完成时追加 |

## 事实优先级

出现描述冲突时，按以下顺序判断：

1. 当前代码、自动化测试和数据库 Schema 是运行行为的最终事实。
2. 已接受且未被取代的 ADR 是架构约束的事实。
3. `product/` 和 `architecture/` 是当前有效的产品与设计说明。
4. 活动工作项是当前已确认的变更范围。
5. `current/ROADMAP.md` 仅是候选方向，不构成实施授权。
6. 已关闭里程碑记录的是当时事实，不自动代表当前行为。

## 生命周期

```text
候选想法（ROADMAP: proposed）
  -> 用户确认版本范围
  -> 建立里程碑说明和 WI（ready）
  -> 开发与验证（in_progress）
  -> 记录验收证据（done）
  -> 移入 completed 并更新当前事实
  -> 关闭并冻结里程碑
```

具体状态、文件移动规则和结束工作前的更新清单见[文档治理规范](./development/DOCUMENTATION.md)。
