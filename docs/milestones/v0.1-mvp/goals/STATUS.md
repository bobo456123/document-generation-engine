# Goal 执行状态

更新时间：2026-08-23

| Goal | 状态 | 说明 |
|---|---|---|
| Goal 1：工程基座 | 已完成 | 安装、构建、lint、类型检查、测试、CLI init、HTTP health 和 SQLite 迁移均通过 |
| Goal 2：代码解析 | 已完成 | React/Vue/Spring Fixture 契约和真实 CRM 静态分析通过，复杂 Java 文件降级被显式计量 |
| Goal 3：文档生成 | 已完成 | 三个真实 AI 样例均完成截图整合和批准；18 条逐条人工判定均为正确 |
| Goal 4：飞书发布 | 已完成 | 修订 12 已携带原生字段表格和两张图片稳定覆盖同一节点；最新只读验证为 29 个顶层 Block |
| Goal 5：真实试点 | 已完成 | 3 个试点均完成真实 AI、逐条人工评审、真实截图、批准和飞书页面验收 |

## 外部输入

- CRM 后端路径：已提供（不在本文记录具体用户目录）。
- CRM 前端路径：已提供（不在本文记录具体用户目录）。
- 飞书应用凭证：已提供，仅允许通过进程环境使用，不写入仓库。
- 飞书测试知识空间：已配置；未指定父节点，默认发布到空间根目录。
- AI 模型：已配置 Anthropic Messages 兼容服务与 `glm-5.3`；凭证仅用于进程环境，未持久化。
- 飞书应用只读认证：凭证有效，Wiki 权限与目标知识空间访问均已验证，空间列表返回 1 条。

## Goal 3 验证

- Vercel AI SDK 的结构化 Composer 接口已实现，模型输出执行 Schema 与证据 ID 校验。
- 已实现 Anthropic、OpenAI、DeepSeek、Qwen 和通用 OpenAI-compatible 模型适配，Key 仅从环境变量读取。
- 真实 AI 已恢复：修订 9 成功生成并保持 `needs_review`。诊断确认接口和 Anthropic 工具调用正常；Composer 现可有限重试 Schema 失败、机械补齐空数组/步骤标题，并允许引用实际发送给模型的补充证据，未发送的证据 ID 仍会被拒绝。
- AI Prompt 包含限量代码事实并移除仓库绝对路径；AI 输出无论模型自带审核项与否都会增加 blocking 人工复核项。
- 代码事实进入 Analyzer 输出、业务快照、SQLite 和 AI Prompt 前均执行统一脱敏；针对旧数据的一次性安全迁移已清理 103,144 条历史事实所在数据库，最新结构化复核覆盖 20 份 JSON 报告且未发现未脱敏凭证。
- 未配置真实模型时使用证据模板生成待审核文档，不冒充 AI 已完成业务理解。
- 真实 CRM“线索转化”修订 12、项目发起评审修订 10、角色维护修订 9 均已整合脱敏截图并批准；另有 2 个未选候选修订。
- 新修订记录来源业务快照和前后端 Commit。
- Markdown 渲染和仅绑定 `127.0.0.1` 的本地预览已实际验证。
- PNG/JPEG/WebP 内容、尺寸、大小、哈希和重复资源处理已有测试。
- 新文档和截图修订均包含 blocking review item，不能绕过人工审核。
- `bizdoc screenshot add` 支持稳定 Feature ID 或 Document ID；`bizdoc preview` 可从项目目录定位最新修订，也保留显式 Markdown 路径模式。

## Goal 4 本地验证

- InMemory Publisher 幂等契约测试通过。
- DocumentationModel 到飞书 Block 的转换测试通过，不依赖 Markdown 反向解析。
- Feishu HTTP Client 实现令牌缓存、429/5xx 有限指数退避和错误分类。
- CLI 真实发布路径使用飞书官方 Node SDK，写入前验证空间/父节点；字段使用 Table → TableCell → Text 的嵌套 Block，其中 TableCell 显式携带飞书要求的 `table_cell` 属性。
- 远端节点已创建但正文失败时保存部分映射，重试复用节点。
- 发布用例拒绝非 approved 修订，并持久化成功或失败记录。
- 发布用例同时拒绝仍有未解决 blocking 审核项的已批准修订；显式批准将解决状态存入独立表，不修改文档修订；AI_INFERENCE 证据不能被 Composer 输出升级为 verified。
- 本地截图映射和文件存在性在任何远端正文删除前完成预检；三次本地发布序列证明同一修订重复发布及新修订更新均复用一个远端映射。
- 修订 8 已复用先前空节点完成正文写入，未创建重复节点；远端读取返回 22 个 Block，本地发布记录为 completed。
- `docs:document.media:upload` 权限生效后，修订 12 已稳定重复写入同一节点；2026-08-23 最新远端读取返回 29 个顶层 Block、2 个图片 Block、1 个原生表格和 0 个正文一级标题，没有重复知识库节点。修订 12 最近 6 次发布均为 completed。
- 已在登录态飞书页面完成视觉复核：页面原生标题唯一，目录和各章节完整，两张截图正常显示，字段表格列宽和表头可读。
- 飞书 SDK 的默认详细日志已关闭，失败只通过本地分类错误输出，避免 Authorization Header 或访问令牌进入终端日志。
- SDK 正文和图片上传异常均只保留裁剪后的业务错误；带伪造 Authorization 内容的图片异常回归未泄漏原始消息。
- 2026-08-22 使用应用凭证完成只读认证、空间列表和指定空间详情查询，均返回成功。

## Goal 1 验证

- `pnpm install`：通过，已生成锁文件。
- `pnpm typecheck`：通过。
- `pnpm build`：通过。
- `pnpm lint`：通过。
- Goal 1 当时的基线为 4 个测试文件、5 个测试通过；当前全量门禁见下方。
- `pnpm bizdoc --help`：通过。
- `bizdoc init`：配置生成、重复执行保护和 SQLite 幂等迁移通过自动化测试。
- 当前目录已初始化为 Git 仓库；首次提交为 `9722d73`，当前 `main` 与 `origin/main` 对齐。Codex 未执行 push。

## Goal 2 验证

- Fixture：React 页面、按钮、POST 请求、Spring Controller、Service、Repository、Entity 与必填校验关联通过。
- Method 不一致不会误关联；重复后端端点输出显式冲突。
- 最新安全重跑：`run:d9b67553-4b90-4699-9be6-b320c0049b2b`，快照 `snapshot:4ebbeb2fbfaa4d96`；扫描 2,762 个文件，提取 15,988 条去重事实，按前端调用上下文聚合得到 179 个候选功能。
- 候选置信度：62 个 `verified`、117 个 `inferred`、0 个 `conflicted`。
- 未关联前端请求 13 个，未关联后端端点 255 个。
- 41 个复杂 Java 文件触发 Tree-sitter 降级，相关端点不会标为 verified。
- 同一页面操作涉及的多个 API 会聚合为一个候选；例如“线索转化”聚合客户、线索、转换记录和项目四个写接口，不再拆成四篇接口文档。
- 前端 Commit：`b38dfdc1351b7f323219cf710fa8d8b807458f2c`。
- 后端 Commit：`8473d3ee6fcf87b0f351341a875b3d36ebc51ba6`。
- `pnpm check`：2026-08-23 最新完整运行中，16 个测试文件、67 个测试及全部质量门禁通过。
- 三个试点共 155 条后端引用的源码文件、Commit 和行号全部有效；方法级链路扩展的两次过度关联尝试被真实重跑发现并收紧，未作为安全基线。
- 脱敏回归覆盖敏感常量/Setter、源码摘录、模型输入、JSON 报告、SQLite 历史迁移和幂等重跑；最新真实 CRM 快照结构化复核为 0 条残留。
- 四个未确认试点候选已分别完成独立分析运行并生成修订 4，重复分析耗时为 3,791～4,005 ms；修订均保持 `needs_review`。
- 从提交基线导出的干净临时目录中，`pnpm install --frozen-lockfile`、`pnpm check` 和 `bizdoc --help` 均通过。
- 另在独立临时数据目录完成真实 CRM `analyze → generate → screenshot add → preview`：CLI 阶段耗时 8,342 / 1,442 / 1,450 / 1,396 ms，预览 HTTP 200，截图修订仍为 `needs_review`；临时目录已清理。
