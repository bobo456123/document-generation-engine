# AI Business Documentation Engine

从 Spring Boot + Vue/React/Umi 源码提取可追溯业务事实，生成带截图的业务操作文档，并在人工审核后幂等发布到飞书知识库。

当前 MVP 已完成，真实 CRM 三个试点的最终验收结论为 `GO`。当前开发状态见 [docs 文档中心](./docs/README.md)，详细证据见 [MVP 完成性审计](./docs/milestones/v0.1-mvp/validation/COMPLETION-AUDIT.md) 和 [试点验收报告](./docs/milestones/v0.1-mvp/validation/PILOT-REPORT.md)。

## MVP 能力

- 只读分析 Spring Boot 后端和 Vue、React 或 Umi 前端项目。
- 关联页面操作、前端请求、Controller、Service、主要对象、字段、条件和结果。
- 使用证据模板或真实 AI 生成结构化文档及 Markdown。
- 手工导入已脱敏的 PNG、JPEG 或 WebP 截图，并绑定到指定操作步骤。
- 在本机预览，经过显式人工审核后发布到飞书测试知识空间。
- 保存分析快照、不可变文档修订、审核记录和飞书远端映射，重复发布不创建重复页面。

当前交互入口是 CLI。MVP 不包含 Web 管理端、自动截图、RAG、多租户或生产知识库发布。

## 环境要求

- Node.js 24+，版本由根目录 `.node-version` 锁定。
- pnpm 10.32.1。
- Git，用于记录被分析项目的 Commit。
- 可选安装 `jq`，便于从分析报告筛选候选功能；不安装也可以直接查看 JSON。

在引擎仓库安装依赖并验证环境：

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm bizdoc --help
```

可选启动 NestJS HTTP 入口。它目前只提供健康检查，默认监听 `127.0.0.1:3000`：

```bash
pnpm dev:server
curl http://127.0.0.1:3000/health
```

## 工作目录

建议为每次文档任务单独建立一个工作目录，不要在 CRM 源码仓库中初始化。源码路径通过配置引用，分析器不会修改源码项目。

```bash
export BIZDOC_ENGINE=/absolute/path/to/document-generation-engine
export BIZDOC_WORKSPACE=/absolute/path/to/bizdoc-sales-crm

mkdir -p "$BIZDOC_WORKSPACE"
cd "$BIZDOC_ENGINE"
pnpm bizdoc init "$BIZDOC_WORKSPACE"
```

初始化会创建：

```text
.bizdoc/
├── project.yaml       # 项目、AI 和飞书配置，不得写入密钥
├── bizdoc.db          # 分析快照、文档修订、审核和发布记录
├── assets/            # 导入后的截图资源
└── output/            # 分析报告和各修订的 Markdown
```

同一目录不能重复执行 `init`，以免覆盖已有配置和数据。

## 项目配置

编辑 `$BIZDOC_WORKSPACE/.bizdoc/project.yaml`：

```yaml
version: 1
project:
  name: sales-crm
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
    # parent_node_token: "optional-parent-node-token"
```

说明：

- 源码路径可以是绝对路径，也可以相对工作目录；前端和后端都必须存在且包含可分析文件。
- `analysis.include` 同时应用于两个源码根目录，并自动匹配多模块中的同名路径。
- 动态 URL 或特殊封装无法自动关联时，可在 `analysis.mappings` 中配置确定的前后端 Method + Path 映射。
- `ai` 可省略；此时不使用 `--ai`，系统生成带阻塞审核项的证据模板。
- `parent_node_token` 省略时，文档发布到知识空间根目录。
- API Key、App Secret 和访问令牌只能放在环境变量中，不得写入此文件。

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

AI 供应商与环境变量：

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

推荐通过 Shell 会话、密码管理器或 CI Secret 注入变量，不要把值写入命令脚本、配置、日志或 Git。

## 完整任务示例

下面以“生成并发布线索转化操作说明”为例。示例假设工作目录和配置已按上文准备，真实值以每条命令的 JSON 输出为准。

### 1. 分析前后端源码

```bash
cd "$BIZDOC_ENGINE"
pnpm bizdoc analyze "$BIZDOC_WORKSPACE"
```

命令返回 `runId`、分析报告 `output` 路径和文件数、事实数、候选数、未关联数等指标。查看候选功能：

```bash
export REPORT_PATH=/path/returned/in/output/business-model.json
jq -r '.features[] | [.id, .name, .confidence] | @tsv' "$REPORT_PATH"
```

人工选择与目标任务对应的候选，例如输出中的 `feature:abc123`。不要仅凭标题选择；同时检查该候选的 `frontendRefs`、`backendRefs`、`apiRefs`、证据和置信度。

### 2. 使用真实 AI 生成一篇文档

先在当前进程注入与 `ai.provider` 对应的 Key，然后执行：

```bash
export ANTHROPIC_API_KEY='<read-from-secret-manager>'
export FEATURE_ID=feature:abc123
pnpm bizdoc generate "$BIZDOC_WORKSPACE" --feature "$FEATURE_ID" --ai
```

此处以 `anthropic` 为例；其他供应商替换为上表对应的环境变量。占位符不能原样使用，也不要把真实值写入 README 或项目脚本。

输出会列出：

```json
{
  "count": 1,
  "documents": [
    {
      "id": "document:def456",
      "revision": 1,
      "path": "/path/to/revision-1/document.md",
      "steps": [
        { "id": "document:def456:step:1", "title": "处理客户" }
      ]
    }
  ]
}
```

记录 `document id` 和要插图步骤的 `step id`：

```bash
export DOCUMENT_ID=document:def456
export SECTION_ID=document:def456:step:1
```

省略 `--ai` 会生成证据模板，适合模型尚未配置或源码外发合规尚未确认的场景。无论是否使用 AI，新文档都必须人工审核。

### 3. 导入一张已脱敏截图

```bash
export SCREENSHOT_PATH=/absolute/path/to/redacted-lead-conversion.png
pnpm bizdoc screenshot add "$SCREENSHOT_PATH" \
  --document "$DOCUMENT_ID" \
  --section "$SECTION_ID" \
  --alt "线索转化客户处理页面" \
  --directory "$BIZDOC_WORKSPACE"
```

截图必须是有效 PNG、JPEG 或 WebP，不超过 10 MB、单边不超过 12,000 像素且总像素不超过 50,000,000。导入截图会创建新修订并输出新的 `revision` 和 Markdown 路径；添加多张截图时，以最后一次输出的修订号为准。

### 4. 本地预览并人工审核

```bash
pnpm bizdoc preview --directory "$BIZDOC_WORKSPACE" --port 4173
```

打开命令输出的本机 URL，检查标题、角色、场景、操作顺序、字段、结果、异常分支、证据和截图脱敏情况。预览进程会持续运行，检查完成后按 `Ctrl+C` 停止。

确认最终修订正确后批准。假设截图命令返回修订 2：

```bash
export REVISION=2
pnpm bizdoc review approve \
  --document "$DOCUMENT_ID" \
  --revision "$REVISION" \
  --directory "$BIZDOC_WORKSPACE"
```

`review approve` 会批准指定修订并解决该修订的审核项。它不是交互式审核页面，因此只能在人工检查完成后执行。后续重新生成或添加截图会产生新修订，新修订必须再次审核。

### 5. 发布到飞书测试知识空间

确认 `.bizdoc/project.yaml` 中的 `space_id`、可选父节点和文档清单无误，并确保飞书凭证已经注入当前进程：

```bash
export FEISHU_APP_ID='<read-from-secret-manager>'
export FEISHU_APP_SECRET='<read-from-secret-manager>'
pnpm bizdoc publish feishu \
  --document "$DOCUMENT_ID" \
  --directory "$BIZDOC_WORKSPACE"
```

该命令会先输出目标空间、父节点、标题、修订和图片数量，随后立即执行真实外部写入，不会再弹出交互确认。首次成功会保存远端节点映射；再次执行同一命令会更新原页面，不会按标题创建重复文档。

完成标准：命令返回 `nodeToken`、`documentToken` 和 URL；在飞书中人工确认目录层级、标题、表格、图片位置和正文，并至少重复发布一次验证幂等性。

## 命令速查

| 命令 | 作用 |
|---|---|
| `pnpm bizdoc init [directory]` | 初始化工作目录和 SQLite |
| `pnpm bizdoc analyze [directory]` | 分析源码并生成不可变业务快照和 JSON 报告 |
| `pnpm bizdoc generate [directory] --feature <id> [--ai]` | 为一个候选生成新文档修订 |
| `pnpm bizdoc screenshot add <file> --document <id> --section <step-id> --directory <path>` | 导入截图并创建新修订；也可用 `--feature <id>` 代替 `--document` |
| `pnpm bizdoc preview --directory <path> [--port <number>]` | 预览最近生成的 Markdown |
| `pnpm bizdoc review approve --document <id> --revision <n> --directory <path>` | 明确批准指定修订 |
| `pnpm bizdoc publish feishu --document <id> --directory <path>` | 发布已批准的最新修订到飞书测试空间 |

## 产物与状态规则

- 分析报告：`.bizdoc/output/run-*/business-model.json`。
- Markdown：`.bizdoc/output/documents/document-*/revision-*/document.md`。
- 截图资源：`.bizdoc/assets/`。
- 权威数据源是 SQLite 中的结构化 `DocumentationModel`，Markdown 只是渲染产物；直接编辑 Markdown 不会修改权威文档或发布内容。
- 每次分析、生成和截图导入都会保留新记录或新修订，不原地覆盖历史版本。
- 只有最新修订状态为 `approved` 且不存在未解决的 blocking 审核项时才能发布，否则返回 `REVIEW_REQUIRED`。
- 发布前会检查全部截图文件；更新远端时先完整写入新内容和图片，成功后才删除旧内容，失败不会清空已发布正文。

## 常见问题

### `No analyzable source files found`

检查 `sources.*.path` 是否存在，以及 `analysis.include` 是否能匹配两个源码根目录下的 `src` 或多模块 `src`。

### `Feature not found`

`generate` 只读取最近一次分析快照。重新查看该次 `business-model.json` 的 `features`，不要使用更早运行中的 Feature ID。

### `Document section not found`

截图的 `--section` 必须使用 `generate` 输出中 `steps[].id` 的完整值，不能使用步骤标题或序号。

### `REVIEW_REQUIRED`

批准最新修订。注意添加截图和重新生成都会增加修订号，并使新修订重新进入待审核状态。

### 飞书返回权限错误

依次检查应用凭证、API Scope、应用版本是否已在测试企业生效、知识空间是否单独授权给应用，以及图片权限 `docs:document.media:upload`。

### 预览端口被占用

使用其他端口，例如 `pnpm bizdoc preview --directory "$BIZDOC_WORKSPACE" --port 4174`。

调试时可临时设置 `BIZDOC_VERBOSE=1` 查看错误堆栈，但不要把含企业路径或业务信息的日志提交或外发。

## 安全边界

- 分析前确认企业源码摘录可以发送给所配置的模型供应商；未确认时不要使用 `--ai`。
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
