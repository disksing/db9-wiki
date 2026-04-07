# db9-wiki

基于 [DB9](https://db9.io) 的 Agent 原生 LLM Wiki。灵感来自 [Karpathy 的 LLM Wiki 模式](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f)。

不做传统 RAG，而是让 LLM 增量构建和维护一个持久化的 wiki —— 一组结构化、互相链接的 markdown 文件。db9-wiki 本身不调用 LLM，而是生成 `AGENTS.md` + skill 文件，让任意 AI agent（Claude Code、Cursor、Windsurf 等）直接操作 wiki。

## 为什么使用 DB9

- DB9 内建了对 Vector 的支持，适合直接为知识库提供向量索引和语义检索能力。
- 可以通过分享 DB9 实例的方式共享知识库，让团队更方便地共享页面、索引和备份后的知识资产。

```
用户 ↔ AI Agent (Claude Code / Cursor / ...)
         │  读取 AGENTS.md 了解角色和规则
         │  使用 skill: ingest, query, lint
         │  直接读写本地 markdown 文件
         ▼
    本地文件系统 (主存储)
    ├── wiki/       ← wiki 页面
    ├── sources/    ← 原始来源
    └── log.md      ← 编辑记录
         │
         │  db9-wiki sync
         ▼
    DB9 数据库
    ├── wiki_index   ← 向量搜索索引
    ├── wiki_page_sources ← 页面与来源引用关系
    ├── fs9:/wiki/   ← 页面备份
    └── fs9:/sources/← 来源备份
```

## 快速开始

```bash
# 创建 DB9 数据库
db9 create --name my-wiki

# 创建 API token
db9 token create --name wiki-agent

# 初始化 wiki
cd my-knowledge-base
db9-wiki init --db <database-id> --token <api-token>
```

生成的目录结构：

```
my-knowledge-base/
├── AGENTS.md          # Agent 指令（通用，不绑定特定 agent）
├── .agents/
│   └── skills/
│       ├── ingest.md  # 摄入：将来源处理成 wiki 页面
│       ├── query.md   # 查询：搜索 + 合成回答
│       └── lint.md    # 检查：wiki 健康检查
├── .claude/
│   └── skills -> ../.agents/skills
├── db9-wiki.toml      # 配置（含 DB9 凭证，自动加入 .gitignore）
├── log.md             # 编辑记录（append-only）
├── wiki/              # Wiki 页面（markdown）
└── sources/           # 原始来源文件
```

用你的 AI agent 打开项目，开始使用 skill 操作 wiki。

## CLI 命令

```bash
db9-wiki init --db <id> --token <token>   # 初始化项目 + DB9 schema
db9-wiki sync                              # 同步本地文件 → DB9（向量索引 + fs9 备份）
db9-wiki search "查询内容"                  # 语义搜索 wiki 页面
db9-wiki index                             # 列出所有页面（slug、标题、描述、标签）
db9-wiki status                            # Wiki 统计信息
```

## Skill 说明

### ingest（摄入）

将新的来源材料处理成 wiki 页面。Agent 读取来源内容，复制到 `sources/YYYY-MM-DD/`，尽量保留原始文件名或目录名，重名时自动重命名，在 `wiki/` 中创建或更新页面，维护 Obsidian 风格的交叉引用，最后运行 `db9-wiki sync`。

### query（查询）

基于 wiki 内容回答问题。Agent 先用 `db9-wiki search` 找到相关页面，读取后合成回答。有价值的回答会被写回 wiki 作为新页面，让每次探索都能积累知识。

### lint（检查）

Wiki 健康检查。Agent 扫描所有页面，检查断裂链接、因重名导致的短 wikilink 歧义、孤立页面、缺失 frontmatter、过期内容、重复主题，以及 `sources/` 下未被任何页面引用的来源文件。输出报告，经用户确认后执行修复。

## Wiki 页面格式

```markdown
---
title: JavaScript 闭包
description: JavaScript 中闭包的概念、用法和常见模式
tags: [javascript, functions, scope]
sources: [2026-04-07/mdn-closures.md]
updated: 2026-04-07
---

# JavaScript 闭包

闭包是一个函数和其词法环境的组合。

## 相关

- [[scope]]
- [[javascript/functions]]
```

`sources` 字段里的路径使用相对于 `sources/` 的路径，不要带 `sources/` 前缀。Wiki 页面之间的链接使用 Obsidian 风格的最短唯一文件名；如果文件名重名，就改用相对于 `wiki/` 的完整路径。

## 编辑记录

每次操作都记录在 `log.md` 中：

```markdown
## [2026-04-07] ingest | MDN 闭包文章
- created `javascript/closures` — 从 2026-04-07/mdn-closures.md 提取
- updated `javascript/scope` — 新增 [[javascript/closures]] 引用

## [2026-04-07] query | 什么是闭包？
- created `javascript/closures-explained` — 将查询回答存为新页面
```

## Sync 工作原理

`db9-wiki sync` 对比本地文件和 DB9 记录：

1. 扫描 `wiki/`、`sources/` 和 `log.md`
2. 计算内容哈希，与 DB9 记录对比
3. 变更的 wiki 页面：通过 DB9 内置 `embedding()` 生成向量，upsert 到 `wiki_index`
4. 根据页面 frontmatter 中的 `sources` 重建 `wiki_page_sources`
5. 所有文件备份到 DB9 的 fs9 文件系统

## 开发

```bash
npm install
npm run dev -- sync           # 开发模式运行命令
npm run build                 # 用 tsup 构建
npm run typecheck             # 类型检查
npx vitest run                # 运行集成测试（默认实时创建临时 DB9 实例）
```

如果账号已达到 DB9 数据库数量上限，可以设置 `DB9_WIKI_TEST_DB_ID` 指向一个专门用于测试、可安全复用的数据库；也可以设置 `DB9_WIKI_TEST_TOKEN` 显式提供测试 token。

## License

BSD-3-Clause
