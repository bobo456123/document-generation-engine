# Goal 1：建立工程基座

> 对应技术方案：Monorepo 结构、NestJS 应用设计、数据持久化、错误处理与安全基线  
> 前置条件：以 [`../PRD.md`](../PRD.md) 和 [`../TECHNICAL-DESIGN.md`](../TECHNICAL-DESIGN.md) 为需求与架构基线  
> 后续 Goal：[Goal 2：代码解析闭环](./GOAL-02-CODE-ANALYSIS.md)

## Goal

建立一个可以持续开发、测试和扩展的 Node.js Monorepo 工程基座，使后续代码解析、文档生成和飞书发布都通过同一套 NestJS 应用用例接入，而不是形成相互独立的脚本。

## 结果

- 项目成为可安装、可构建、可测试的 `pnpm workspace + Turborepo` Monorepo。
- 创建以下应用入口：
  - `apps/cli`：提供 `bizdoc` 命令；
  - `apps/server`：提供 NestJS 启动入口，为未来 HTTP API 保留能力。
- 创建技术方案中定义的核心包，并明确依赖方向：
  - `application`、`project-scanner`、`analyzer-frontend`、`analyzer-spring`；
  - `feature-linker`、`business-model`、`ai-composer`、`document-model`；
  - `markdown-renderer`、`screenshot-manager`、`publisher`、`publisher-feishu`；
  - `persistence`、`config`、`observability`。
- CLI 能通过 Nest Application Context 调用应用用例，不需要先启动常驻服务器。
- 实现 `bizdoc --help` 和 `bizdoc init`：
  - `init` 可在指定目录生成 `.bizdoc/project.yaml`、`.bizdoc/assets/` 和 `.bizdoc/output/`；
  - 重复执行不会静默覆盖用户已有配置。
- 使用 Zod 校验项目配置，错误信息能指出具体字段和修复方式。
- 建立 SQLite + Drizzle 的基础设施和首个迁移，能够创建技术方案所列核心表；暂不要求填充所有业务数据。
- 建立统一错误类型、结构化日志和敏感字段脱敏机制。
- 建立一个可提交、可重复的最小 CRM Fixture 目录骨架，为后续解析测试提供输入。
- README 说明环境要求、安装、构建、测试和 CLI 使用方法。

## 约束条件

- 使用 Node.js 当前 LTS、TypeScript、pnpm workspace、Turborepo、NestJS、Commander.js、Zod、SQLite、Drizzle、pino 和 Vitest。
- 在根目录锁定 Node.js 与 pnpm 版本，并提交 lockfile，确保安装可复现。
- 采用 NestJS 模块化单体，不拆微服务。
- `apps/*` 只承担启动和协议适配，不承载核心业务逻辑。
- 核心模型包不得依赖 NestJS、数据库、CLI 或飞书 SDK。
- CLI 与未来 HTTP Controller 必须调用相同的应用用例接口。
- 不建立泛化的 `shared` 包；只有职责稳定的公共能力才能成为独立包。
- MVP 任务在当前进程内执行，不引入 Redis、BullMQ、Kafka 或其他任务系统。
- 不实现 Web 管理端、RAG、Agent、多租户、自动截图或真实 AI/飞书调用。
- 不实现假装可用的解析器、AI Composer 或飞书 Publisher；未实现模块应明确返回受控的 `NOT_IMPLEMENTED` 或不对外暴露命令。
- 不执行被分析项目的安装、构建或脚本。
- 密钥不得写入配置样例、SQLite、日志或测试 Fixture。
- 不擅自扩大 [`../PRD.md`](../PRD.md) 的 MVP 范围。
- 若当前目录尚未初始化 Git，可以完成工程文件，但不得自动提交；应在结果中明确提示版本管理状态。

## 确认

- 在全新检出目录中执行 `pnpm install --frozen-lockfile` 成功。
- 根目录的 `build`、`lint`、`typecheck` 和 `test` 命令全部通过。
- `bizdoc --help` 返回成功状态并列出已实现命令。
- 在临时目录执行 `bizdoc init` 后，生成的配置能够通过 Zod 校验。
- 对已存在 `.bizdoc/project.yaml` 的目录再次执行 `init`，不会覆盖文件，并返回可操作提示。
- SQLite 迁移可以在空目录创建数据库；重复运行迁移保持幂等。
- 自动化测试证明核心模型包没有导入 NestJS、Drizzle 或飞书 SDK。
- 日志脱敏测试证明 `token`、`secret`、`authorization` 等字段不会以明文输出。
- README 中列出的命令经过实际执行验证，而非仅作为示例编写。
- Goal 结束时给出：新增模块、公开接口、测试结果、未实现能力、遗留风险和进入 Goal 2 的前置条件。

## 完成边界

本 Goal 在工程骨架和质量门禁可靠后结束。不要为了展示端到端效果提前实现真实代码解析、AI 文档生成或飞书发布。
