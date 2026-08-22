# Goal 2：完成代码解析闭环

> 对应技术方案：Project Scanner、Frontend Analyzer、Spring Boot Analyzer、Code Fact Model、Feature Linker、Business Model  
> 前置条件：[Goal 1：建立工程基座](./GOAL-01-FOUNDATION.md) 已通过确认  
> 后续 Goal：[Goal 3：文档生成与截图审核闭环](./GOAL-03-DOCUMENT-GENERATION.md)

## Goal

让系统能够对可重复的 Spring Boot + Vue/React Fixture 进行只读静态分析，并把页面入口、用户操作、前端请求、后端接口、Service 和主要业务对象关联成带证据、可信度和冲突信息的 `BusinessModelSnapshot`。

## 结果

- 完成 `ProjectScanner`：
  - 识别前端、后端、框架、模块、源文件和配置文件；
  - 应用 include/exclude 和默认忽略规则；
  - 若输入是 Git 仓库，记录当前 Commit；否则明确记录为无 Git 基线；
  - 全程只读，不执行目标项目代码。
- 定义并固化 `CodeFactModel`、`Evidence`、`BusinessFeature` 和 `BusinessModelSnapshot` 的 TypeScript 类型及运行时 Schema。
- 完成 `FrontendAnalyzer`：
  - 支持一个 React Fixture 和一个 Vue Fixture；
  - 提取显式路由、菜单/页面、按钮、表单字段与校验、API 请求、跳转、权限表达式和提示文案；
  - 每条事实保留文件、行号、符号和来源。
- 完成 `SpringAnalyzer`：
  - 提取 Spring Controller 的 Method、URL、参数和返回类型；
  - 提取 Bean Validation、Service 调用、DTO、Entity、枚举、Repository/Mapper 意图；
  - 提取显式条件、异常、权限注解和状态赋值；
  - 每条事实保留文件、行号、符号和来源。
- 完成 `FeatureLinker`：
  - 优先使用 HTTP Method + 规范化 URL 建立确定性关联；
  - 使用请求字段、响应类型和源码位置辅助匹配；
  - 支持项目配置中的人工显式映射；
  - 输出 `verified`、`inferred`、`conflicted` 和未关联项；
  - 人工映射优先于语义推断，但保留映射来源。
- 实现 `bizdoc analyze [project-path]`，持久化运行记录、代码事实和不可变业务模型快照。
- 输出便于人工检查的 JSON 分析报告，包含候选功能、证据、冲突、未关联前端操作和未关联后端接口。
- Fixture 至少覆盖一个完整链路：

```text
路由/菜单 → 页面 → 按钮 → 表单 → API 请求
→ Controller → Service → Repository → Entity
```

## 约束条件

- TypeScript/JavaScript 使用 `ts-morph`；Vue SFC 使用 `@vue/compiler-sfc`；Java 默认使用 Tree-sitter Java。
- 暂不以 JavaParser Sidecar 为默认实现。只有 Tree-sitter 无法满足已定义 Fixture 的关键符号关联，且有失败证据时，才暂停并提出 Sidecar 决策。
- 分析过程只允许静态、只读访问，不运行 Maven、Gradle、npm、pnpm、Vite、Webpack 或目标项目脚本。
- 不连接目标项目数据库、缓存、消息队列或远程业务服务。
- 各 Analyzer 只输出规范化事实，不生成业务操作文档。
- `FeatureLinker` 不允许仅因名称相似就把关系标记为 `verified`。
- 每个 `verified` 结论必须关联至少一个实际存在的证据；跨前后端关联必须能够说明匹配依据。
- 无法静态确定的动态路由、动态 URL 和复杂封装必须进入 `inferred` 或未关联清单，不得静默猜测。
- 不用 AI 代替 AST 解析或弥补静态分析缺口。
- 不保存完整 AST 或大段源码，只保存必要事实、位置和短摘录。
- 不在本 Goal 实现 AI Composer、截图、本地预览或飞书发布。
- 分析失败不得产生“成功”快照；成功历史快照不得被失败运行覆盖。

## 确认

- 为 Project Scanner、两个 Analyzer 和 Feature Linker 建立基于模块接口的契约测试。
- Fixture 测试能够稳定还原至少一条完整前后端业务路径。
- React 与 Vue Fixture 都至少验证：路由、页面、按钮、字段、API 请求和源码证据。
- Spring Fixture 至少验证：Controller、Service、DTO/Entity、校验、状态变化和数据访问事实。
- 测试证明 Method 相同但 URL 不同、URL 相同但 Method 不同的接口不会误关联。
- 测试证明人工显式映射可以解决已知未关联项，并记录 `MANUAL_INPUT` 来源。
- 测试覆盖 `verified`、`inferred`、`conflicted` 和 `unlinked` 四类结果。
- 每个输出证据的文件和行号均能在对应 Fixture 中定位；不存在悬空证据 ID。
- `bizdoc analyze` 连续执行两次生成独立运行记录和业务快照，不原地覆盖历史结果。
- 对格式错误或部分不可解析文件，系统输出明确诊断；除非关键链路不完整，否则允许记录局部失败并继续。
- 根目录 `build`、`lint`、`typecheck`、`test` 全部通过。
- Goal 结束时输出量化摘要：扫描文件数、代码事实数、候选功能数、四类关联数量、解析失败数和耗时。

## 完成边界

本 Goal 的权威产物是可审查的 `BusinessModelSnapshot`，不是 Markdown。解析闭环没有通过证据和契约测试前，不进入 AI 文档生成。
