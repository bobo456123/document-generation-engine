# AI Business Documentation Engine

从 Spring Boot + Vue/React/Umi 源码提取可追溯业务事实，生成带截图的业务操作文档，并在人工审核后幂等发布到飞书知识库。

`v0.1.1` 已完成并通过完整质量门；此前 `v0.1.0 MVP` 的三个真实 CRM 试点验收结论为 `GO`。当前状态见 [docs 文档中心](./docs/README.md)，MVP 证据见 [MVP 完成性审计](./docs/milestones/v0.1-mvp/validation/COMPLETION-AUDIT.md) 和 [试点验收报告](./docs/milestones/v0.1-mvp/validation/PILOT-REPORT.md)。

## 当前能力

- 只读分析 Spring Boot 后端和 Vue、React 或 Umi 前端项目。
- 关联页面操作、前端请求、Controller、Service、主要对象、字段、条件和结果。
- 使用证据模板或真实 AI 生成结构化文档及 Markdown。
- 手工导入已脱敏的 PNG、JPEG 或 WebP 截图，并绑定到指定操作步骤。
- 在本机预览，经过显式人工审核后发布到飞书测试知识空间。
- 保存分析快照、不可变文档修订、审核记录和飞书远端映射，重复发布不创建重复页面。

当前交互入口是 CLI。当前版本不包含 Web 管理端、自动登录和页面遍历截图、RAG、多租户或生产知识库发布。

## 环境要求

- Node.js 24+，版本由根目录 `.node-version` 锁定。
- pnpm 10.32.1。
- Git，用于记录被分析项目的 Commit。
- 可选安装 `jq`，便于从分析报告筛选候选功能；不安装也可以直接查看 JSON。

在引擎仓库安装依赖，并把开发版 CLI 链接到本机全局命令：

```bash
pnpm install --frozen-lockfile
pnpm link:cli
bizdoc --version
pnpm check
```

当前全局命令通过 `tsx` 直接加载本仓库源码，适合本地调试，源码修改后无需重新 link。它不是可发布的 npm 包；在线安装将在单独版本中提供。如果 pnpm 提示全局命令目录未配置，先执行 `pnpm setup` 并重新打开终端。

可选启动 NestJS HTTP 入口。它目前只提供健康检查，默认监听 `127.0.0.1:3000`：

```bash
pnpm dev:server
curl http://127.0.0.1:3000/health
```

## 工作目录

建议为每次文档任务单独建立一个工作目录，不要在 CRM 源码仓库中初始化。源码路径通过配置引用，分析器不会修改源码项目。

```bash
mkdir -p /absolute/path/to/bizdoc-sales-crm
cd /absolute/path/to/bizdoc-sales-crm
bizdoc init --system-name "销售 CRM"
```

初始化会创建：

```text
.bizdoc/
├── project.yaml       # 项目、AI 和飞书配置，不得写入密钥
├── bizdoc.db          # 分析快照、文档修订、审核和发布记录
├── assets/            # 导入后的截图资源
└── output/            # 分析报告和各修订的 Markdown
```

同一目录不能重复执行 `init`，以免覆盖已有配置和数据。后续命令从当前目录向上寻找最近的 `.bizdoc/project.yaml`，因此在业务目录或其子目录中都不需要再传工作目录。

## 项目配置

编辑当前业务目录中的 `.bizdoc/project.yaml`：

```yaml
version: 1
project:
  name: sales-crm
  display_name: 销售 CRM
sources:
  frontend:
    path: /absolute/path/to/sales-crm-web
    framework: umi # auto、react、vue 或 umi
  backend:
    path: /absolute/path/to/crm-backend
    framework: spring-boot
analysis:
  include:
    - src/**
  exclude:
    - "**/generated/**"
  mappings: []
ai:
  provider: anthropic
  model: your-model-name
  base_url: https://your-anthropic-compatible-host/v1
publishing:
  feishu:
    space_id: "your-test-space-id"
    default_module: 线索管理
    # parent_node_token: "optional-managed-root-node-token"
```

说明：

- 源码路径可以是绝对路径，也可以相对工作目录；前端和后端都必须存在且包含可分析文件。
- `analysis.include` 同时应用于两个源码根目录，并自动匹配多模块中的同名路径。
- 动态 URL 或特殊封装无法自动关联时，可在 `analysis.mappings` 中配置确定的前后端 Method + Path 映射。
- 配置 `ai` 后，`bizdoc generate` 默认使用真实 AI；显式传 `--template` 才使用证据模板。省略 `ai` 时默认使用模板。
- `default_module` 是非交互生成时的业务模块默认值，也可以在生成命令中用 `--module` 覆盖。
- `parent_node_token` 表示可选的托管根；系统节点创建在其下，业务文档不会直接写到知识空间或托管根。
- API Key、App Secret 和访问令牌只能放在系统钥匙串或环境变量中，不得写入此文件。

人工映射示例：

```yaml
analysis:
  include:
    - src/**
  exclude: []
  mappings:
    - frontend:
        method: POST
        path: /api/lead/save
      backend:
        method: POST
        path: /api/lead/save
      label: 线索保存
```

## 凭证与权限

在交互式终端中主动配置凭证，值会以隐藏输入保存到 macOS Keychain：

```bash
bizdoc auth set anthropic
bizdoc auth set feishu
bizdoc auth status
```

`auth status` 只显示 `keychain`、`environment` 或 `missing`，不会输出真实值。CI 和服务器仍可使用环境变量，并且环境变量优先于钥匙串：

| `ai.provider` | 必需环境变量 | 备注 |
|---|---|---|
| `anthropic` | `ANTHROPIC_API_KEY` | `base_url` 可用于 Anthropic Messages 兼容服务 |
| `openai` | `OPENAI_API_KEY` | `base_url` 可选 |
| `deepseek` | `DEEPSEEK_API_KEY` | 未配置 `base_url` 时使用官方地址 |
| `qwen` | `DASHSCOPE_API_KEY` | 未配置 `base_url` 时使用兼容模式地址 |
| `openai-compatible` | `AI_API_KEY` | 未在配置中写 `base_url` 时还需要 `AI_BASE_URL` |

飞书发布需要 `FEISHU_APP_ID` 和 `FEISHU_APP_SECRET`。应用必须已在目标测试企业生效，并同时满足：

- 开通 `wiki:wiki` 和 `docx:document`；包含截图时还需 `docs:document.media:upload`。
- 目标知识空间单独授权给应用；只有开放平台 API Scope、没有知识空间授权仍无法访问。
- 权限变更后发布新应用版本，或确认变更已对当前测试企业生效。
- 只使用明确授权的测试知识空间，不要把 MVP 指向生产知识库。

非 macOS 环境当前只支持环境变量。不要把凭证写入命令参数、项目配置、日志或 Git。

## 完整任务示例

下面以“生成并发布线索转化操作说明”为例。先进入已经初始化并完成配置的业务目录：

```bash
cd /absolute/path/to/bizdoc-sales-crm
bizdoc doctor
```

### 1. 分析前后端源码

```bash
bizdoc analyze
bizdoc features
```

`analyze` 返回运行 ID、报告路径和统计指标；`features` 以表格列出业务功能。需要查看完整证据时使用 `bizdoc features --json` 或打开分析报告。

### 2. 使用真实 AI 生成一篇文档

```bash
bizdoc generate --module "线索管理"
```

如果有多个功能，命令会显示名称供选择，不要求手工复制 Feature ID。配置了 `ai` 和对应凭证时自动使用真实 AI；源码外发合规尚未确认时执行 `bizdoc generate --template --module "线索管理"`。

输出会列出：

```json
{
  "count": 1,
  "documents": [
    {
      "id": "document:def456",
      "title": "线索转化",
      "classification": {
        "system": { "id": "system:...", "name": "销售 CRM" },
        "module": { "id": "module:...", "name": "线索管理" }
      },
      "revision": 1,
      "path": "/path/to/revision-1/document.md",
      "steps": [
        { "id": "document:def456:step:1", "title": "处理客户" }
      ]
    }
  ]
}
```

完整 ID 会保留在 JSON 输出中供脚本使用，但后续交互命令可以按文档标题和步骤标题选择。无论是否使用 AI，新文档都必须人工审核。

`v0.1.0` 已审核文档不需要重新生成。先为旧文档补充业务分类；命令会原样复制正文、证据和截图，创建一个新的待审核修订：

```bash
bizdoc documents classify --module "线索管理"
bizdoc preview
bizdoc review approve
```

分类迁移不会修改旧修订，也不会继承旧修订的审核状态；确认系统和业务模块后才能再次批准。该操作不调用 AI 或飞书 API，但会先检查旧文档引用的截图记录和本地文件，资源不完整时不会创建新修订。非交互环境有多个候选时，使用 `--document <id>` 明确选择。

### 3. 导入一张已脱敏截图

```bash
bizdoc screenshot add
```

该命令依次选择文档、操作步骤和本机图片。省略图片路径时，macOS 会打开系统文件选择器；其他系统使用 `bizdoc screenshot add <file>`。也可以直接进行 macOS 区域截图：

```bash
bizdoc screenshot capture
```

两种方式都不会自动脱敏，必须先确认页面或图片已经脱敏。截图必须是有效 PNG、JPEG 或 WebP，不超过 10 MB、单边不超过 12,000 像素且总像素不超过 50,000,000；导入后创建新的待审核修订。

### 4. 本地预览并人工审核

```bash
bizdoc preview
```

打开命令输出的本机 URL，检查标题、角色、场景、操作顺序、字段、结果、异常分支、证据和截图脱敏情况。预览进程会持续运行，检查完成后按 `Ctrl+C` 停止。

确认最终修订正确后批准：

```bash
bizdoc review approve
```

命令按标题选择文档并默认批准其最新修订；批准前仍必须先完成浏览器中的人工检查。后续重新生成或添加截图会产生新修订，新修订必须再次审核。

### 5. 发布到飞书测试知识空间

确认 `.bizdoc/project.yaml` 中的 `space_id`、系统名称、模块名称和可选托管根无误：

```bash
bizdoc publish feishu
```

命令只列出已批准文档，并在交互终端显示最终路径后确认：

```text
知识空间/销售 CRM/线索管理/线索转化
```

系统、模块和文档节点都使用本地稳定映射复用；既有根目录文档会移动到模块下而不是重建，因此链接保持不变。

完成标准：命令返回 `nodeToken`、`documentToken` 和 URL；在飞书中人工确认目录层级、标题、表格、图片位置和正文，并至少重复发布一次验证幂等性。

## 命令速查

| 命令 | 作用 |
|---|---|
| `bizdoc init [--system-name <name>]` | 在当前目录初始化项目和 SQLite |
| `bizdoc auth set <target>` | 交互配置一个 AI 供应商或飞书凭证 |
| `bizdoc auth status` | 查看各项凭证来自环境变量、钥匙串还是尚未配置 |
| `bizdoc auth remove <target>` | 从系统钥匙串删除指定凭证，不改变环境变量 |
| `bizdoc doctor` | 检查源码路径以及已启用服务的配置和凭证 |
| `bizdoc analyze` | 分析源码并生成不可变业务快照和 JSON 报告 |
| `bizdoc features [--json]` | 查看最新业务功能候选 |
| `bizdoc generate [--feature <id>] [--module <name>] [--template]` | 选择功能并生成带系统/模块分类的新修订 |
| `bizdoc documents [--json]` | 查看每篇文档的最新修订和审核状态 |
| `bizdoc documents classify [--document <id>] --module <name>` | 为已审核的 v0.1 旧文档创建补充系统/模块分类的待审核修订 |
| `bizdoc screenshot add [file]` | 选择图片、文档和步骤后创建新修订 |
| `bizdoc screenshot capture [--ack-redaction]` | 在 macOS 截图并直接创建新修订；非交互调用必须确认已脱敏 |
| `bizdoc preview [--port <number>]` | 预览最近生成的 Markdown |
| `bizdoc review approve` | 选择并批准经过人工检查的最新修订 |
| `bizdoc publish feishu` | 按系统/模块层级发布已批准文档 |
| `bizdoc status` | 查看当前工作空间、分析、文档和凭证状态 |

原有显式目录参数、`screenshot-add`、`review-approve` 和 `publish-feishu` 在本版本继续兼容，供现有脚本迁移。

## 产物与状态规则

- 分析报告：`.bizdoc/output/run-*/business-model.json`。
- Markdown：`.bizdoc/output/documents/document-*/revision-*/document.md`。
- 截图资源：`.bizdoc/assets/`。
- 权威数据源是 SQLite 中的结构化 `DocumentationModel`，Markdown 只是渲染产物；直接编辑 Markdown 不会修改权威文档或发布内容。
- 每次分析、生成和截图导入都会保留新记录或新修订，不原地覆盖历史版本。
- `v0.1.0` 生成且没有系统/模块分类的旧文档仍可查看；使用 `documents classify` 保留原正文、截图和历史审核记录并创建分类修订，系统不会把技术 Controller 名称自动当作业务模块。
- 只有最新修订状态为 `approved` 且不存在未解决的 blocking 审核项时才能发布，否则返回 `REVIEW_REQUIRED`。
- 发布前会检查全部截图文件；更新远端时先完整写入新内容和图片，成功后才按索引删除旧内容。该删除不会自动重试，响应丢失时也不会重放并误删新正文。

## 常见问题

### `No analyzable source files found`

检查 `sources.*.path` 是否存在，以及 `analysis.include` 是否能匹配两个源码根目录下的 `src` 或多模块 `src`。

### `Feature not found`

`generate` 只读取最近一次分析快照。运行 `bizdoc features` 重新选择，不要使用更早运行中的 Feature ID。

### `Document section not found`

交互使用 `bizdoc screenshot add` 可以按步骤标题选择。脚本模式传入的 `--section` 仍必须使用 `generate` 输出中 `steps[].id` 的完整值。

### `REVIEW_REQUIRED`

批准最新修订。注意添加截图和重新生成都会增加修订号，并使新修订重新进入待审核状态。

### `DOCUMENT_CLASSIFICATION_REQUIRED`

当前批准修订来自 v0.1 且没有系统/模块分类。执行 `bizdoc documents classify --module "业务模块名称"`，预览并批准新修订后再发布；无需重新分析或重新调用 AI。

### 飞书返回权限错误

依次检查应用凭证、API Scope、应用版本是否已在测试企业生效、知识空间是否单独授权给应用，以及图片权限 `docs:document.media:upload`。

### 预览端口被占用

使用其他端口，例如 `bizdoc preview --port 4174`。

调试时可临时设置 `BIZDOC_VERBOSE=1` 查看错误堆栈，但不要把含企业路径或业务信息的日志提交或外发。

## 安全边界

- 分析前确认企业源码摘录可以发送给所配置的模型供应商；未确认时使用 `bizdoc generate --template`，或从项目配置中移除 `ai`。
- 分析器会在事实进入业务快照、SQLite 和 AI Prompt 前脱敏常见密钥、令牌、密码和授权头，但脱敏不能替代企业合规审批。
- 截图必须在导入前人工脱敏；系统只校验格式、尺寸、大小和哈希，不理解图片中的业务敏感信息。
- 发布仅限用户明确授权的飞书测试知识空间。
- 不要提交 `.bizdoc`、环境变量文件、API Key、App Secret、访问令牌或包含敏感内容的日志。

## 开发文档

- [开发文档中心](./docs/README.md)
- [当前开发状态](./docs/current/STATUS.md)
- [当前交接](./docs/current/HANDOFF.md)
- [当前路线图](./docs/current/ROADMAP.md)
- [当前系统架构](./docs/architecture/OVERVIEW.md)
- [v0.1 MVP 历史档案](./docs/milestones/v0.1-mvp/README.md)
