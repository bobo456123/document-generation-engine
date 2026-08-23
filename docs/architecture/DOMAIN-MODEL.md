# 领域模型

## 核心术语

| 术语 | 含义 | 生命周期 |
|---|---|---|
| Project | 一组前端、后端和输出配置 | 初始化工作目录时创建 |
| Analysis Run | 一次源码分析执行及其指标、Commit 和结果 | 每次分析新建，不覆盖 |
| Code Fact | 从源码或配置中提取的最小可追溯事实 | 从属于 Analysis Run |
| Business Snapshot | 某次运行中经关联后的业务功能集合 | 创建后不可变 |
| Business Feature | 可生成一篇业务操作文档的功能候选 | 从属于 Snapshot |
| Documentation Model | 与输出平台无关的结构化文档内容 | 每个修订保存一份 |
| Document Revision | 一篇文档的一次生成或截图变更结果 | 不可变；状态独立审核 |
| Review Item | 需要人工确认的问题，blocking 项阻止发布 | 批准修订时显式解决 |
| Screenshot Asset | 经格式、尺寸、大小和哈希校验的本地图片 | 可被多个修订引用 |
| Publication | 一次发布尝试及远端映射、状态和错误分类 | 每次尝试留审计记录 |

## 数据流与不变量

```text
Project
  -> Analysis Run
  -> Code Facts
  -> Business Snapshot / Features
  -> Document / Revisions
  -> Review
  -> Publication
```

- 证据置信度分为 `verified`、`inferred`、`conflicted`；AI 推断不能升级为源码已验证事实。
- Markdown 是 Documentation Model 的派生产物，手工修改 Markdown 不改变权威数据。
- 新修订不会继承旧修订的批准状态。
- Publication 只能引用已批准且不存在未解决 blocking 项的最新修订。
- 远端节点和文档 Token 持久化后用于重复发布，避免按标题创建重复页面。
