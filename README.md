# AI Business Documentation Engine

从 Spring Boot + Vue/React 源码提取可追溯业务事实，生成图文操作文档，并在人工审核后发布到飞书知识库。

## Requirements

- Node.js 24+
- pnpm 10.32.1

Node.js 版本由根目录 `.node-version` 锁定。

## Development

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm bizdoc --help
```

可选启动本地 NestJS HTTP 入口（默认仅监听 `127.0.0.1:3000`）：

```bash
pnpm dev:server
curl http://127.0.0.1:3000/health
```

初始化待分析项目配置：

```bash
pnpm bizdoc init /path/to/workspace
```

凭证仅通过环境变量提供，不得写入 `.bizdoc/project.yaml`。

核心流程：

```bash
pnpm bizdoc analyze /path/to/workspace
pnpm bizdoc generate /path/to/workspace --feature <feature-id>
pnpm bizdoc screenshot-add <document-id> <section-id> <image> --directory /path/to/workspace
pnpm bizdoc review-approve <document-id> <revision> --directory /path/to/workspace
FEISHU_APP_ID=... FEISHU_APP_SECRET=... pnpm bizdoc publish-feishu <document-id> --directory /path/to/workspace
```

真实模型生成需要在 `.bizdoc/project.yaml` 配置 `ai.provider` 与 `ai.model`，执行 `generate --ai`，并设置对应的 `OPENAI_API_KEY`、`DEEPSEEK_API_KEY`、`DASHSCOPE_API_KEY`、`ANTHROPIC_API_KEY` 或 `AI_API_KEY`。未指定 `--ai` 时生成带阻塞审核项的证据模板草稿。

飞书发布还需要在 `.bizdoc/project.yaml` 配置测试知识空间的 `space_id`，并可选配置 `parent_node_token`。首次真实写入前应确认目标空间。

## Documentation

- [MVP PRD](./docs/MVP-PRD.md)
- [Technical design](./docs/TECHNICAL-DESIGN.md)
- [Implementation goals](./docs/goals/GOAL-01-FOUNDATION.md)
