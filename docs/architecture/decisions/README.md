# 架构决策记录

本目录保存影响多个模块、公共契约、数据模型、安全边界或长期维护方式的决策。

## 规则

- 文件名使用 `ADR-0001-short-title.md`，编号全局唯一且只递增。
- 状态只能是 `proposed`、`accepted`、`superseded`、`rejected`。
- 已接受 ADR 不直接重写决策；需要改变时创建新 ADR，并用 `supersedes` 关联旧编号。
- 仅影响单个工作项的实现细节留在 WI 中，不创建 ADR。
- 创建时使用 [ADR 模板](../../templates/ADR.md)。

## 当前记录

暂无独立 ADR。MVP 阶段的历史设计决策保留在 [v0.1 技术方案](../../milestones/v0.1-mvp/TECHNICAL-DESIGN.md)；未来改变这些决策时再创建 ADR，而不伪造历史决策日期。
