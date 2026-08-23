# AI Business Documentation Engine
## —— 从企业前后端代码自动生成业务操作文档

**文档版本：** V0.1 MVP  
**产品定位：** AI 驱动的企业业务文档生成与发布工具  
**目标形态：** Node.js Monorepo + CLI 优先，飞书知识库作为第一版文档展示载体

---

# 1. 产品背景

企业内部的 CRM、ERP、采购、营销等业务系统经过长期迭代后，通常存在一个普遍问题：

- 系统功能越来越多；
- 新功能上线后，业务操作手册更新不及时；
- 业务人员不知道某个功能是做什么的；
- 新员工需要依赖老员工口头培训；
- 产品、开发、测试对业务功能的理解分散在不同地方；
- 系统代码持续变化，但业务文档不会自动同步；
- 传统 Swagger 主要服务开发人员，无法很好地解释业务操作流程。

因此，希望构建一个 AI Business Documentation Engine：

> **让 AI 从企业前后端代码中理解业务功能，自动生成面向业务人员的图文操作文档，并发布到企业知识库。**

第一阶段不建设独立帮助中心，而是直接使用飞书知识库作为文档承载平台。

---

# 2. 产品目标

## 2.1 MVP 核心目标

在一个月内完成以下完整闭环：

```text
企业前后端代码
       ↓
代码解析
       ↓
业务模型构建
       ↓
AI 理解业务
       ↓
生成 Markdown 业务文档
       ↓
插入页面截图
       ↓
发布到飞书知识库
```

最终用户能够完成：

> “给我一个 Spring Boot + Vue 项目，我运行一次命令，就能得到一套业务操作文档，并自动发布到飞书。”

---

# 3. 非目标

MVP 阶段明确不做：

- ❌ 自研帮助中心门户
- ❌ RAG 知识库
- ❌ Multi-Agent
- ❌ LangGraph 工作流
- ❌ 自动生成 UI 图片
- ❌ 自动浏览整个系统并截图
- ❌ 自动理解所有企业业务规则
- ❌ 完整替代产品经理
- ❌ 自动修改代码
- ❌ 自动发布生产系统
- ❌ 完整企业权限体系
- ❌ 多租户 SaaS

这些作为后续产品路线。

---

# 4. 核心用户

## 4.1 第一用户：研发人员

研发人员负责：

- 提供代码仓库；
- 执行文档生成；
- 审核 AI 生成结果；
- 发布到飞书。

研发人员是 MVP 的主要使用者。

---

## 4.2 第二用户：业务人员

业务人员不需要了解：

- Java
- Vue
- API
- Controller
- Service
- 数据库

他们只看到：

> “这个功能是干什么的？”

> “谁可以使用？”

> “怎么操作？”

> “操作后会发生什么？”

> “有哪些注意事项？”

---

## 4.3 第三用户：产品/项目人员

后续可以利用生成的业务文档：

- 查看系统功能；
- 了解业务流程；
- 检查文档是否及时更新；
- 查看版本变化。

---

# 5. 核心产品理念

产品遵循一个非常重要的原则：

> **程序负责事实，AI 负责理解。**

不要直接：

```text
代码 → LLM → 文档
```

而应该：

```text
代码
 ↓
Code Parser
 ↓
Business Model
 ↓
AI Engine
 ↓
Documentation Model
 ↓
Markdown
 ↓
飞书
```

这样可以降低 AI 幻觉，并且让后续接入其他文档平台更加容易。

---

# 6. MVP 核心功能

MVP 只包含四项核心能力。

## 6.1 功能一：解析 Spring Boot + 前端项目

### 6.1.1 输入

支持 Git 项目目录：

```text
CRM Project
├── backend
│   └── Spring Boot
└── frontend
    └── Vue / React
```

第一版优先支持：

- Java
- Spring Boot
- Vue
- React

---

## 6.1.2 后端代码解析

重点解析：

### Controller

识别：

- API
- HTTP Method
- URL
- Controller
- 方法
- 参数
- 返回值

例如：

```text
POST /opportunity
OpportunityController.create()
```

---

### Service

识别：

- Service 方法
- 方法调用关系
- 业务处理流程
- 条件判断
- 状态变化

例如：

```text
Controller
   ↓
OpportunityService
   ↓
CustomerService
   ↓
OpportunityRepository
```

---

### Entity / DTO

识别：

- 业务对象
- 字段
- 字段类型
- 字段关系
- 枚举
- 状态

例如：

```text
Opportunity
├── customer
├── amount
├── stage
├── owner
└── status
```

---

### Repository / Mapper

用于进一步判断：

- 数据对象
- 数据关系
- 查询行为
- 新增/修改/删除行为

---

# 7. 前端代码解析

第一版重点解析：

```text
路由
 ↓
菜单
 ↓
页面
 ↓
组件
 ↓
按钮
 ↓
API
```

例如：

```text
客户管理
 └── 客户详情
      └── 转为商机
            ↓
       POST /opportunity
```

需要识别：

- 路由
- 页面
- 菜单
- Button
- 表单
- 表格
- API 请求
- 页面跳转
- 权限信息

---

# 8. Business Model

这是系统最核心的中间层。

代码解析器不能直接生成最终文档，而是首先生成统一的业务模型。

示例：

```json
{
  "name": "创建商机",
  "module": "商机管理",
  "entry": {
    "page": "客户详情",
    "action": "转为商机"
  },
  "roles": [
    "销售人员"
  ],
  "frontend": {
    "page": "CustomerDetail",
    "button": "ConvertOpportunity"
  },
  "backend": {
    "controller": "OpportunityController",
    "service": "OpportunityService"
  },
  "entities": [
    "Customer",
    "Opportunity"
  ],
  "apis": [
    "POST /opportunity"
  ]
}
```

Business Model 的作用：

1. 隔离代码解析和 AI；
2. 降低 LLM 输入复杂度；
3. 提高生成稳定性；
4. 支持后续多种文档生成；
5. 支持未来版本差异分析。

---

# 9. 功能二：AI 生成业务操作文档

AI Engine 接收 Business Model。

## 9.1 文档目标

生成的文档不是技术文档，而是：

> **面向业务人员的系统使用说明。**

---

## 9.2 文档结构

第一版统一模板：

```text
# 功能名称

## 功能简介

这个功能是做什么的？

## 使用角色

哪些人员可以使用？

## 使用场景

什么时候应该使用？

## 操作步骤

1. 进入 XXX
2. 点击 XXX
3. 填写 XXX
4. 点击 XXX

## 字段说明

| 字段 | 是否必填 | 说明 |
|---|---|---|

## 操作结果

操作成功后会发生什么？

## 注意事项

需要注意什么？

## 常见问题

FAQ

## 相关功能

相关业务功能
```

---

# 10. AI 生成原则

AI 不允许为了让文档完整而随意猜测业务规则。

例如代码只能确定：

```text
amount 必填
```

则只能生成：

> “商机金额为必填项。”

不能擅自生成：

> “商机金额必须大于 10 万元。”

除非代码、配置或其他可信数据源中存在该规则。

---

# 11. 信息可信度

可以给 AI 生成的信息增加来源标记：

```text
SOURCE_CODE
SOURCE_CONFIG
SOURCE_COMMENT
AI_INFERENCE
```

其中：

### SOURCE_CODE

代码明确表达的信息。

可信度最高。

### SOURCE_CONFIG

配置文件、枚举、权限配置等。

### SOURCE_COMMENT

代码注释。

### AI_INFERENCE

AI 推断出的业务语义。

MVP 可以暂时不在最终文档中展示，但内部模型需要保留。

---

# 12. 人工审核

MVP 不追求“AI 100% 自动发布”。

生成流程：

```text
代码
 ↓
AI生成
 ↓
Markdown
 ↓
人工审核
 ↓
发布飞书
```

这样可以避免错误业务信息直接进入企业知识库。

---

# 13. 功能三：页面截图

## 13.1 MVP

第一版采用：

> **人工上传截图。**

原因：

- 开发成本低；
- 截图真实性高；
- 避免自动登录；
- 避免权限问题；
- 避免 AI 找错页面；
- 先验证业务文档价值。

---

## 13.2 截图关联

每个业务功能可以关联：

```text
BusinessFeature
     ↓
Screenshot[]
```

例如：

```text
创建商机
├── customer-detail.png
├── create-opportunity.png
└── opportunity-success.png
```

最终 Markdown：

```markdown
![客户详情](images/customer-detail.png)

点击「转为商机」进入创建页面。
```

---

# 14. 第二阶段：Playwright 自动截图

MVP 后增加：

```text
Business Model
      ↓
Page Locator
      ↓
Playwright
      ↓
自动打开页面
      ↓
自动截图
      ↓
关联文档
```

最终可以实现：

> AI 找到业务功能 → 自动找到页面 → 自动截图 → 自动插入文档。

但这不属于 MVP。

---

# 15. 功能四：发布到飞书知识库

## 15.1 产品原则

第一版不自己开发 Help Center。

直接利用飞书作为：

> **第一版帮助中心。**

流程：

```text
Markdown
   ↓
Markdown Parser
   ↓
飞书文档结构
   ↓
Feishu Open API
   ↓
飞书知识库
```

---

# 16. 飞书发布能力

MVP 支持：

- 创建文档；
- 创建目录；
- 上传图片；
- 写入正文；
- 更新文档；
- 建立文档层级。

最终形成：

```text
CRM 帮助中心
│
├── 客户管理
│   ├── 新建客户
│   ├── 编辑客户
│   └── 客户转商机
│
├── 商机管理
│   ├── 创建商机
│   ├── 编辑商机
│   └── 商机阶段管理
│
└── 项目管理
    ├── 创建项目
    └── 项目审批
```

---

# 17. CLI

MVP 推荐 CLI 优先。

例如：

```bash
bizdoc init
```

初始化项目。

```bash
bizdoc analyze ./crm
```

解析项目。

```bash
bizdoc generate
```

生成业务文档。

```bash
bizdoc preview
```

本地预览。

```bash
bizdoc publish feishu
```

发布飞书。

最终：

```bash
bizdoc generate --publish feishu
```

一条命令完成：

```text
解析
 ↓
AI理解
 ↓
生成
 ↓
发布
```

---

# 18. 技术架构

```text
                    ┌──────────────┐
                    │ Git Project  │
                    └──────┬───────┘
                           │
             ┌─────────────┴─────────────┐
             ↓                           ↓
      Frontend Parser              Backend Parser
      Vue / React                  Spring Boot
             │                           │
             └─────────────┬─────────────┘
                           ↓
                    Business Model
                           ↓
                      AI Engine
                           ↓
                Documentation Model
                           ↓
                  Markdown Generator
                       ↙       ↘
                 Screenshot    Markdown
                       \       /
                         ↓
                    Feishu Adapter
                         ↓
                   Feishu Knowledge
```

---

# 19. 技术栈

## Runtime

- Node.js
- TypeScript

## Monorepo

- pnpm
- Turborepo

## Code Parser

Java：

- JavaParser 或 Tree-sitter

TypeScript / JavaScript：

- ts-morph
- Babel AST

MVP 优先：

> JavaParser/Tree-sitter + ts-morph

---

## AI

推荐：

- Vercel AI SDK 或 LangChain.js

模型采用可配置模式：

- DeepSeek
- Qwen
- OpenAI
- Claude

第一版不绑定具体模型。

---

## Screenshot

- Playwright

MVP：

> 手动上传

后续：

> Playwright 自动截图

---

## Document

- Markdown
- MDX

Markdown 作为核心中间格式。

---

## Database

MVP：

- SQLite
- Drizzle ORM

后续：

- PostgreSQL

---

## Feishu

- Feishu Open API

通过 Adapter 隔离：

```text
Document
   ↓
Publisher Interface
   ├── FeishuPublisher
   ├── GitBookPublisher
   └── HelpCenterPublisher
```

这样未来不需要修改 AI 和文档生成逻辑。

---

# 20. Monorepo 项目结构

```text
ai-business-doc/
│
├── apps/
│   ├── cli/
│   └── web/
│
├── packages/
│   ├── code-parser/
│   ├── frontend-parser/
│   ├── backend-parser/
│   ├── business-model/
│   ├── ai-engine/
│   ├── doc-generator/
│   ├── screenshot/
│   ├── feishu/
│   ├── database/
│   └── shared/
│
├── examples/
│   └── crm-demo/
│
├── package.json
├── pnpm-workspace.yaml
└── turbo.json
```

MVP 可以暂时不开发：

```text
apps/web
```

先把 CLI 跑通。

---

# 21. MVP 用户流程

```text
Step 1
用户指定项目目录

       ↓

Step 2
系统扫描项目

       ↓

Step 3
解析前端/后端代码

       ↓

Step 4
建立 Business Model

       ↓

Step 5
AI 分析业务功能

       ↓

Step 6
生成 Markdown

       ↓

Step 7
用户上传截图

       ↓

Step 8
本地预览

       ↓

Step 9
人工审核

       ↓

Step 10
发布飞书知识库
```

---

# 22. MVP Demo

技术分享建议只选择一个真实功能。

例如：

> **CRM：创建商机**

Demo：

### 第一步

输入 CRM 项目：

```bash
bizdoc generate ./crm
```

### 第二步

系统解析：

```text
CustomerDetail.vue
        ↓
ConvertOpportunity.vue
        ↓
POST /opportunity
        ↓
OpportunityController
        ↓
OpportunityService
        ↓
Opportunity
```

### 第三步

AI 得到：

```text
BusinessFeature:
创建商机
```

### 第四步

生成：

```text
创建商机.md
```

### 第五步

插入：

```text
创建商机页面截图
```

### 第六步

发布：

```text
飞书知识库
  ↓
CRM帮助中心
  ↓
商机管理
  ↓
创建商机
```

这个 Demo 就足够支撑一小时分享。

---

# 23. MVP 验收标准

必须满足：

### 代码解析

能够从真实项目中解析：

- 前端路由；
- 页面；
- Button；
- API；
- Controller；
- Service；
- Entity。

---

### AI 理解

至少能够识别：

- 功能名称；
- 功能入口；
- 操作步骤；
- 业务对象；
- 字段；
- 操作结果；
- 注意事项。

---

### 文档生成

能够自动生成：

- Markdown；
- 标题；
- 操作步骤；
- 字段说明；
- FAQ；
- 图片。

---

### 飞书

能够：

- 创建知识库目录；
- 创建文档；
- 写入内容；
- 插入图片。

---

### 完整闭环

必须能够：

```text
真实项目
 ↓
解析
 ↓
AI
 ↓
Markdown
 ↓
截图
 ↓
飞书
```

完整跑通。

---

# 24. 后续版本规划

## V0.2：自动截图

增加：

- Playwright；
- 自动登录；
- 页面定位；
- 自动截图；
- 图片压缩；
- 图片与业务功能自动关联。

---

# 25. V0.3：代码变更分析

增加 Git Diff：

```text
Git Commit
     ↓
Code Diff
     ↓
Business Model Diff
     ↓
影响功能分析
     ↓
更新相关文档
```

例如：

```text
Commit：

新增商机阶段管理
```

AI 自动识别：

```text
影响：

商机管理
├── 创建商机
├── 编辑商机
└── 商机阶段管理
```

---

# 26. V0.4：Change Log

自动生成：

```text
2026-09-01

新增：
- 商机阶段管理

修改：
- 商机创建流程增加阶段字段

影响用户：
- 销售人员

业务影响：
- 创建商机时需要选择商机阶段
```

这将成为产品非常重要的能力。

---

# 27. V0.5：知识库增强

接入：

- PRD；
- Wiki；
- 数据库；
- API；
- 企业制度；
- 产品资料。

形成：

```text
代码
PRD
Wiki
数据库
Git
     ↓
统一 Context
     ↓
AI
     ↓
业务文档
```

此时再考虑 RAG。

---

# 28. V1.0：独立 Help Center

当验证业务文档确实有价值后，再从：

> “飞书发布插件”

升级为：

> **AI Help Center**

实现：

- Web 帮助中心；
- 搜索；
- 分类；
- 权限；
- 文档版本；
- 文档审核；
- 文档评论；
- AI 问答；
- FAQ；
- 用户行为分析。

---

# 29. 商业化方向

最终产品不应该只是：

> “AI 帮你写文档。”

而应该定位为：

> **让企业业务系统拥有一个能够持续理解系统变化的 AI 帮助中心。**

商业价值来自：

### ① 降低文档维护成本

代码更新 → 文档自动发现变化。

### ② 降低培训成本

新员工可以直接通过帮助中心学习系统。

### ③ 降低业务咨询成本

业务人员可以自助查询。

### ④ 降低系统交付成本

项目上线时自动生成操作手册。

### ⑤ 建立企业业务知识资产

代码中的业务逻辑逐步转换为企业可理解的业务知识。

---

# 30. MVP 最大原则

整个项目必须坚持：

> **先验证“AI 能不能从代码理解业务”，而不是先做一个漂亮的平台。**

所以 MVP 不需要：

- 独立 Web；
- RAG；
- Agent；
- 自动截图；
- 多模型协作；
- 复杂权限；
- 多租户；
- 完整 SaaS。

只需要：

```text
代码解析
   ↓
业务理解
   ↓
业务文档
   ↓
截图
   ↓
飞书
```

**这五个节点真正跑通，你的产品就已经成立。**

---

# 31. 最终产品一句话

> **AI Business Documentation Engine：从企业前后端代码中自动理解业务功能，生成面向业务人员的图文操作文档，并持续同步到企业知识库。**

而你这次技术分享，可以把整个故事讲成：

> **“如果让 AI 自己读懂一个 CRM 系统，它能不能自动给业务人员写出一套操作手册？”**

然后现场从代码开始，一路跑到飞书帮助中心。

这个故事线会比单纯讲“我调用大模型生成 Markdown”有意思得多。
