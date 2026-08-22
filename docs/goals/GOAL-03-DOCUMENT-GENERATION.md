# Goal 3：完成文档生成、截图与审核闭环

> 对应技术方案：AI Document Composer、Documentation Model、Markdown Renderer、Screenshot Manager、本地预览和人工审核  
> 前置条件：[Goal 2：完成代码解析闭环](./GOAL-02-CODE-ANALYSIS.md) 已通过确认  
> 后续 Goal：[Goal 4：完成飞书发布闭环](./GOAL-04-FEISHU-PUBLISHING.md)

## Goal

把一个带证据的 `BusinessFeature` 稳定转换为结构化、可追溯、可人工审核的业务操作文档，支持人工截图关联、本地预览和不可绕过的审核状态，并以 `DocumentationModel` 而不是 Markdown 作为权威内容。

## 结果

- 固化 `DocumentationModel`、`DocumentRevision`、`ReviewItem`、`OperationStep` 和截图资源引用的 TypeScript 类型及运行时 Schema。
- 完成 `DocumentComposer`：
  - 输入仅包含当前功能相关的最小业务事实和证据；
  - 使用结构化输出生成文档模型；
  - 区分事实、推断和未知；
  - 对角色、条件、字段、步骤和结果执行证据引用校验；
  - 无证据内容留空或进入 `reviewItems`。
- 使用 Vercel AI SDK 隔离模型供应商，至少支持一个主模型配置和一个测试用假实现。
- 完成 `MarkdownRenderer`，从 `DocumentationModel` 生成统一结构的 Markdown：
  - 功能简介、使用角色、使用场景、操作步骤；
  - 字段说明、操作结果、注意事项、FAQ 和相关功能；
  - 正确处理表格、列表、特殊字符和图片相对路径。
- 完成 `ScreenshotManager`：
  - 导入 PNG、JPEG、WebP；
  - 校验 MIME、文件大小和图片尺寸；
  - 计算哈希并识别重复资源；
  - 通过 `featureId + documentSectionId` 关联截图；
  - 资源复制到 `.bizdoc/assets/` 或明确的输出目录。
- 实现以下 CLI 流程：
  - `bizdoc generate [--feature <feature-id>]`；
  - `bizdoc screenshot add --feature <id> --section <id> <file>`；
  - `bizdoc preview`；
  - `bizdoc review approve --document <id>`。
- 本地预览能够展示 Markdown、截图、证据和待审核项，并只绑定 `127.0.0.1`。
- 文档修订不可变；重新生成创建新修订，不覆盖已审核版本。
- 新修订默认是 `draft` 或 `needs_review`，只有明确审核后才成为 `approved`。
- 建立 3 至 5 个业务功能的人工金标输入或评测样例，为事实准确率和人工修改量提供基线。

## 约束条件

- `DocumentationModel` 是权威数据源；Markdown 只是渲染结果，不得从 Markdown 反向恢复或修改权威内容。
- 不允许 AI 直接生成最终 Markdown 后绕过结构化模型。
- 模型输出必须通过 Zod 或 JSON Schema 校验，校验失败要有限重试并保留明确错误。
- Prompt 只能包含当前功能必要事实和最小源码摘录，不得默认发送整个仓库或完整文件。
- 不得把 `AI_INFERENCE` 标记成 `SOURCE_CODE`、`verified` 或已确认业务规则。
- AI 无法证明的步骤不能为了文档完整而编造。
- 测试默认使用确定性假模型，不依赖真实模型网络调用；真实模型评测作为显式、可选测试运行。
- 截图关联必须使用稳定 ID，不依赖文件名猜测。
- 不接受伪装为图片的文件；日志不记录图片二进制、模型密钥或大段源码。
- 本地预览不是正式 Web 产品，不增加用户系统、复杂权限、评论、搜索或在线编辑器。
- 不实现 Playwright 自动截图。
- 不在本 Goal 调用真实飞书 API；可定义后续发布需要的文档输入接口，但不实现飞书行为。
- `generate --publish` 即使存在，也必须在新修订未审核时停止，不能自动批准。

## 确认

- 模型和文档 Schema 测试覆盖必填字段、稳定 ID、证据引用、审核项和修订递增。
- 使用确定性假模型时，同一 BusinessFeature 能生成稳定的 DocumentationModel。
- 测试证明不存在证据的角色、条件、金额限制或结果不会被标记为代码事实。
- 注入包含无效证据 ID、错误字段类型或非结构化文本的模型结果时，系统拒绝持久化有效修订。
- Markdown 快照测试覆盖所有标准章节、表格转义、空章节策略和图片相对路径。
- PNG、JPEG、WebP 导入成功；错误 MIME、超限文件和损坏图片被拒绝。
- 同一截图重复导入不会产生不可控的重复资源。
- 截图关联到步骤后，本地预览和 Markdown 中的位置一致。
- 未审核修订无法进入发布用例；审核旧修订后生成新修订，新修订仍需重新审核。
- 本地预览仅监听 `127.0.0.1`，关闭命令后端口被释放。
- 对金标样例记录：事实一致性、步骤覆盖率、无证据陈述数、人工修改项数和评审意见。
- 根目录 `build`、`lint`、`typecheck`、`test` 全部通过。
- Goal 结束时列出模型配置要求、评测结果、已知文档质量缺口和进入 Goal 4 的前置条件。

## 完成边界

本 Goal 在“业务模型到已审核图文 Markdown”闭环成立后结束。不要提前建设独立帮助中心、自动截图或飞书生产发布。
