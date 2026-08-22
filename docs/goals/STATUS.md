# Goal 执行状态

更新时间：2026-08-22

| Goal | 状态 | 说明 |
|---|---|---|
| Goal 1：工程基座 | 已完成 | 安装、构建、lint、类型检查、测试、CLI init、HTTP health 和 SQLite 迁移均通过 |
| Goal 2：代码解析 | 已完成 | React/Vue/Spring Fixture 契约和真实 CRM 静态分析通过，复杂 Java 文件降级被显式计量 |
| Goal 3：文档生成 | 部分完成 | 结构化文档、真实 AI、Markdown、截图、预览和审核门禁已实现；真实截图与人工审核待补充 |
| Goal 4：飞书发布 | 部分完成 | 修订 8 已首次真实发布，远端 22 个 Block 与本地 completed 审计通过；待重复发布和人工排版验收 |
| Goal 5：真实试点 | 进行中 | 已完成真实 CRM 分析和单个 AI 样例；模型结构化输出稳定性、截图、人工审核和飞书试发待完成 |

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
- 真实 AI 生成修订 7 成功并保持 `needs_review`；扩充证据后的 3 次请求因 Schema 不匹配或无响应被拒绝且未落库。
- AI Prompt 包含限量代码事实并移除仓库绝对路径；AI 输出无论模型自带审核项与否都会增加 blocking 人工复核项。
- 未配置真实模型时使用证据模板生成待审核文档，不冒充 AI 已完成业务理解。
- 真实 CRM“线索转化”聚合候选文档已生成修订 5，状态为 `needs_review`；另有 4 个建议试点候选修订。
- 新修订记录来源业务快照和前后端 Commit。
- Markdown 渲染和仅绑定 `127.0.0.1` 的本地预览已实际验证。
- PNG/JPEG/WebP 内容、尺寸、大小、哈希和重复资源处理已有测试。
- 新文档和截图修订均包含 blocking review item，不能绕过人工审核。

## Goal 4 本地验证

- InMemory Publisher 幂等契约测试通过。
- DocumentationModel 到飞书 Block 的转换测试通过，不依赖 Markdown 反向解析。
- Feishu HTTP Client 实现令牌缓存、429/5xx 有限指数退避和错误分类。
- CLI 真实发布路径使用飞书官方 Node SDK，写入前验证空间/父节点，并以 descendant Block 创建字段表格。
- 远端节点已创建但正文失败时保存部分映射，重试复用节点。
- 发布用例拒绝非 approved 修订，并持久化成功或失败记录。
- 修订 8 已复用先前空节点完成正文写入，未创建重复节点；远端读取返回 22 个 Block，本地发布记录为 completed。
- 2026-08-22 使用应用凭证完成只读认证、空间列表和指定空间详情查询，均返回成功。

## Goal 1 验证

- `pnpm install`：通过，已生成锁文件。
- `pnpm typecheck`：通过。
- `pnpm build`：通过。
- `pnpm lint`：通过。
- Goal 1 当时的基线为 4 个测试文件、5 个测试通过；当前全量门禁见下方。
- `pnpm bizdoc --help`：通过。
- `bizdoc init`：配置生成、重复执行保护和 SQLite 幂等迁移通过自动化测试。
- 当前目录已初始化为本地 Git 仓库，分支为 `main`；尚未暂存、提交或推送。

## Goal 2 验证

- Fixture：React 页面、按钮、POST 请求、Spring Controller、Service、Repository、Entity 与必填校验关联通过。
- Method 不一致不会误关联；重复后端端点输出显式冲突。
- 真实 CRM：扫描 2,762 个文件，提取 15,565 条去重事实（包含新增条件和状态常量），按前端调用上下文聚合得到 179 个候选功能。
- 候选置信度：62 个 `verified`、117 个 `inferred`、0 个 `conflicted`。
- 未关联前端请求 13 个，未关联后端端点 255 个。
- 41 个复杂 Java 文件触发 Tree-sitter 降级，相关端点不会标为 verified。
- 同一页面操作涉及的多个 API 会聚合为一个候选；例如“线索转化”聚合客户、线索、转换记录和项目四个写接口，不再拆成四篇接口文档。
- 前端 Commit：`b38dfdc1351b7f323219cf710fa8d8b807458f2c`。
- 后端 Commit：`8473d3ee6fcf87b0f351341a875b3d36ebc51ba6`。
- `pnpm check`：2026-08-22 最新完整运行中，16 个测试文件、39 个测试及全部质量门禁通过；最新证据筛选调整另通过类型检查和聚焦测试。
