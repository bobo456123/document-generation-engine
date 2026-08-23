# 工作项

工作项记录一个可独立验收的功能、修复或技术改进。它是 Agent 执行任务的直接契约，不替代产品需求或架构文档。

## 目录

- [`active/`](./active/README.md)：`proposed`、`ready`、`in_progress` 或 `blocked` 的工作项。
- [`completed/`](./completed/README.md)：`done` 或 `cancelled` 的工作项。

## 创建方式

1. 从 [工作项模板](../templates/WORK-ITEM.md)创建 `WI-0001-short-title.md`。
2. 使用下一个未占用编号，不按里程碑重新计数。
3. 填写结果和可验证验收标准后才能进入 `ready`。
4. 开始实施时在[当前状态](../current/STATUS.md)和[当前交接](../current/HANDOFF.md)登记编号。

MVP 开发发生在本规则建立之前，其历史执行记录保存在 [v0.1 goals](../milestones/v0.1-mvp/goals/STATUS.md)，不倒填为 WI。
