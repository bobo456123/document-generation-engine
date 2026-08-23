# Repository Agent Guide

本文件适用于整个仓库。面向使用者的操作说明见 [README](./README.md)，开发与交接事实以 [docs 文档中心](./docs/README.md)为入口。

## 开始任务前

依次阅读：

1. [当前开发状态](./docs/current/STATUS.md)
2. [当前交接](./docs/current/HANDOFF.md)
3. 交接中列出的活动 `WI-*`
4. 与任务相关的[当前需求](./docs/product/REQUIREMENTS.md)、[当前架构](./docs/architecture/OVERVIEW.md)和 [ADR](./docs/architecture/decisions/README.md)
5. [开发流程](./docs/development/WORKFLOW.md)、[测试规范](./docs/development/TESTING.md)和[安全规范](./docs/development/SECURITY.md)

如果没有活动工作项，先根据[文档治理规范](./docs/development/DOCUMENTATION.md)建立并登记 WI。路线图中的 `proposed` 内容不是已确认需求，不得据此自行扩大范围。

## 实施约束

- 以代码和自动化测试作为运行行为的最终事实；发现文档过期时在当前任务内同步修正。
- 保留工作树中不属于当前任务的已有改动，不回退其他开发者或 Agent 的工作。
- 运行时公共接口、数据模型或跨模块边界发生变化时，更新当前架构；形成长期决策时创建 ADR。
- 不在仓库中记录真实凭证、访问令牌、Cookie、企业源码内容、用户绝对路径或只能从当前机器获得的信息。
- 已关闭里程碑是历史档案，不随当前实现重写。需要勘误时注明日期、原因和影响。

## 结束任务前

1. 运行工作项约定的定向测试和完整 `pnpm check`。
2. 在工作项中记录实际验证证据和残余风险。
3. 同步更新 `docs/current/STATUS.md` 与 `docs/current/HANDOFF.md`。
4. 完成的 WI 移入 `docs/work-items/completed/`，并更新相应索引、里程碑和 `docs/CHANGELOG.md`。
5. 明确写出下一项可直接执行的动作及需要用户决定的事项。
6. 仅在用户明确要求时执行 Git commit 或 push。
