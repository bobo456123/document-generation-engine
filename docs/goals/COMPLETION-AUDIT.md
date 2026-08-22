# MVP Goal 完成性审计

> 审计日期：2026-08-22  
> 结论：`IN_PROGRESS / CONDITIONAL_GO`  
> 原则：只把有当前文件、运行结果或外部验收记录证明的项目标记为完成。

## Goal 1：工程基座

状态：本地完成。

- pnpm workspace、Turborepo、Node 24 版本文件和锁文件已建立，`pnpm install --frozen-lockfile` 通过。
- CLI 使用 Nest Application Context；Nest HTTP Server 的 `/health` 已实际启动并返回 `{"status":"ok"}`。
- SQLite 迁移可重复执行，核心表及发布审计新增列均有自动化测试。
- 核心模型依赖边界和日志明文脱敏有直接测试。
- 当前引擎目录已初始化为本地 Git 仓库，分支为 `main`；尚未暂存、提交或推送。

## Goal 2：代码解析

状态：本地完成，保留静态分析限制。

- React、Vue 和 Spring Fixture 契约覆盖页面、路由、按钮、字段、请求、跳转、提示、权限、Controller、DTO、校验、Service、状态变化、异常和数据访问。
- `analysis.include` 支持根目录及多模块 `src`；空前端或后端不会记录成功运行。
- 页面跳转不再误识别为 HTTP API；业务快照拒绝悬空证据 ID。
- 连续两次分析生成独立运行和快照，已有自动化验证。
- 真实 CRM 权威运行：`run:ce2fffb1-60a6-4d11-8de0-98d66e616b2f`，快照 `snapshot:6ee3f33bca72121b`。
- 真实项目仍有 41 个 Tree-sitter 降级文件和 255 个未关联后端端点；这些项目未被隐藏或提升为 verified。

## Goal 3：文档生成、截图和审核

状态：部分完成。

- 结构化 `DocumentationModel`、证据校验、来源快照/Commit、Markdown、截图导入、本地预览、不可变修订和审核状态已实现。
- 本地预览显示证据 ID 和 blocking review item；批准旧修订不会使后续新修订自动获批。
- 已生成 5 个真实 CRM 候选修订，全部为 `needs_review`；线索转化已有一份人工金标草案。
- Anthropic Messages 兼容接口已真实生成线索转换修订 7；Prompt 移除绝对仓库路径，AI 修订强制阻塞审核。
- 修订 7 覆盖主要写入和失败分支，但遗漏允许状态、客户 ID 缺失和项目跳过；扩充证据后的请求暴露结构化输出稳定性问题。
- 未完成：3 至 5 个样例的研发/业务金标评审、真实截图及人工修改耗时测量。

## Goal 4：飞书发布

状态：部分完成。

- Publisher 接口、内存适配器、飞书 Block 转换、图片上传、有限重试、错误分类、审核门禁和发布审计已实现。
- CLI 真实发布路径使用飞书官方 Node SDK；发布写入前验证知识空间及可选父节点权限。
- 字段说明使用 Table → TableCell → Text 的 descendant Block 层级，并按顶层 Block 分批写入。
- 节点创建后正文失败会保存部分远端映射，重试复用节点，避免重复创建。
- CLI 发布前展示空间、父节点、标题、修订和图片数量。
- 真实 Wiki/Docx 权限和测试空间访问已通过；修订 8 首次发布成功，复用部分失败留下的节点并写入 22 个 Block，本地审计为 completed。

## Goal 5：真实项目验收

状态：进行中。

- 已固定指标算法并建立 5 个待用户确认候选；所有候选来自同一源码快照和两个已记录 Commit。
- 已验证静态分析、业务聚合、结构化文档、Markdown、审核门禁及本地发布契约。
- 未完成：用户确认最终样例、研发/业务评审、每篇真实截图、其余 AI 样例、飞书首次及重复发布。
- 在上述外部验证完成前，最终结论保持 `CONDITIONAL_GO`，MVP Goal 不得标记 complete。

## 当前外部阻塞

1. 当前 Anthropic Messages 兼容服务对较长结构化证据输入不稳定；还需确认企业源码摘录的合规范围。
2. 明确确认首次写入；如不希望发布到空间根目录，还需提供可选父节点。
3. 用户确认 3 至 5 个试点功能，以及 CRM 研发/业务评审人。
4. 每个最终试点功能至少一张已脱敏的真实页面截图。
