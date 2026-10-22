# Manuslip

**用 Markdown 写作，用任何语言阅读。**

Manuslip 是一款本地优先的跨平台 Markdown 编辑器，围绕一个理念构建：文档不只是文字——它需要你**书写**、**阅读**、并**跨语言分享**。它将无缝所见即所得编辑与一套渲染管线结合在一起，让每篇文档都能以三种形态呈现：原始源码、渲染预览、翻译预览。

[English](./README.md) | [简体中文](./README.zh-CN.md)

![状态](https://img.shields.io/badge/status-early%20development-orange)
![许可证](https://img.shields.io/badge/license-MIT-blue)
![平台](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey)

---

## 为什么是 Manuslip

大多数 Markdown 编辑器迫使你在两者之间做选择：要么是一个带割裂预览窗格的代码编辑器，要么是一个精致但闭源的写作应用。Manuslip 建立在三个信念之上：

1. **无缝编辑应当是开放的。** 输入时格式就地渲染——标题、表格、公式、图片——而底层文本始终保持为纯粹、可移植的 Markdown。没有锁定，没有私有格式。
2. **平台应当服务于写作。** Manuslip 构建于 Electron 成熟的生态之上——一致的渲染、完整的 Node.js 集成与深厚的库兼容性——让工程精力投入在文档体验上，而不是消耗在框架本身。
3. **写作是跨语言的。** 用另一种语言阅读文档，不应该需要复制粘贴到翻译软件里。翻译是一等公民的渲染模式，在文档结构层面应用，因此版式、代码和公式都能完整保留。

## 功能特性

### 核心编辑

- **无缝实时预览** —— Markdown 边输入边就地渲染；语法标记仅在光标所在行显现。一个界面，零模式切换成本。
- **源码模式** —— 全功能代码编辑器视图：语法高亮、多光标、搜索替换、括号引号自动闭合。
- **CommonMark + GFM** —— 表格、任务列表、删除线、自动链接、脚注、定义列表、上下标、emoji 短代码、YAML frontmatter。
- **数学公式** —— 行内 `$...$` 与块级 `$$...$$`，由 MathJax 渲染，支持 mhchem 化学式。
- **图表** —— Mermaid 代码块（流程图、时序图、甘特图、类图、状态图等），并兼容传统的 `sequence` 与 `flowchart` 代码块。
- **代码高亮** —— 编辑器原生 CodeMirror 语言模式，在源码、预览与导出中保持一致。
- **富表格编辑** —— 可视化表格操作、键盘导航、列对齐。
- **智能粘贴** —— 剪贴板中的 HTML 自动转换为干净的 Markdown；图片直接粘贴到受管资源目录。
- **拼写检查** —— 系统级拼写检查，支持按语言加载词典。
- **大纲与导航** —— 自动生成目录、标题跳转、单文档字数/字符统计。

### 工作区

- **文件树侧边栏**：文件夹工作区、多标签页、拖拽打开、`.md` 文件关联。
- **全局模糊搜索**：跨文件检索，以及文档内搜索替换。
- **自动保存**：原子写入 + 文件监听——外部修改可安全重载。
- **编码自动识别**：正确打开非 UTF-8 编码的旧文件。
- **主题**：内置明暗主题、自定义 CSS、单文档排版设置。
- **专注与打字机模式**：为长文写作消除干扰。
- **导出**：原生自包含 HTML、PDF 与图片；Word（.docx）、EPUB、LaTeX 等格式经可选的 Pandoc 集成；翻译文档支持双语导出。

### 招牌功能：三种渲染模式

见下一节。

## 三种渲染模式

Manuslip 中的每篇文档都有三重视角。使用 `Ctrl/Cmd + 1 / 2 / 3` 或状态栏控件即时切换。

| 模式 | 你看到的内容 | 适用场景 |
|---|---|---|
| **1 · 源码** | 带语法高亮的原始 Markdown | 精确编辑、对比 diff、复制粘贴互通 |
| **2 · 实时预览** | 就地渲染、可直接编辑的文档 | 日常写作——默认模式 |
| **3 · 翻译预览** | 以目标语言渲染的文档 | 跨语言阅读、审校与分享 |

### 深入翻译预览

Manuslip 的翻译是**结构化的，而非纯文本的**：

- **AST 级翻译。** 管线遍历文档语法树，只翻译可翻译节点——段落、标题、列表项、表格单元格、引用块、图注。代码块、行内代码、公式、URL、frontmatter 和 Mermaid 图表原样保留，绝不触碰。
- **块级缓存。** 每个块按（源文本 + 目标语言 + 翻译服务）计算哈希。未改动的块永不重复翻译——在万字文档中改一句话，翻译成本只有那一段，而不是整个文件。
- **服务商无关。** 自带密钥即可：OpenAI 兼容端点、DeepL、Google Cloud Translation、LibreTranslate，或通过 Ollama 使用完全本地的模型。术语表与正式度控制是服务商接口的一部分。
- **三种阅读版式。** *替换视图*（仅目标语言）、*双语对照*（实时预览与翻译预览双窗格滚动同步）、*逐行对照*（原文在上、译文在下）。
- **按需触发，离线友好。** 翻译只在你请求时运行；结果持久化在本地缓存中。除非你主动配置了云端服务商，否则文档永远不会离开你的机器。

## 技术栈

| 层级 | 技术选型 | 选型理由 |
|---|---|---|
| 桌面外壳 | **Electron 45** | 当前受支持的最新 Electron（Chromium 156、Node 24.22）——一致的跨平台渲染、原生模块、`printToPDF` 与拼写检查 |
| 桌面工具链 | **electron-vite 6 + electron-builder 26** | Vite 8 HMR；面向三个平台的打包、签名与自动更新 |
| 编辑器内核 | **CodeMirror 6** | 基于 Decoration 的渲染让无缝内联预览成为可能；CM6 是该编辑器家族现代且持续维护的一代 |
| 增量解析 | **@lezer/markdown 1.8** | 编辑器时增量解析：块边界、Decoration、折叠与高亮——不是语义 AST |
| 文档 AST | **unified 11 / micromark 4（mdast）** | 符合 CommonMark + GFM 规范的语义语法树；预览、翻译与导出的语义事实来源 |
| Markdown 扩展 | **remark-gfm · remark-frontmatter · remark-math · remark-directive · yaml · emojilib** | 表格与任务列表、frontmatter、数学、自定义指令、YAML 解析、emoji 短代码数据 |
| UI | **React 19 + TypeScript 7 + Vite 8** | HMR 开发体验、庞大生态、可预期的性能模式 |
| 状态管理 | **Zustand 5** | 极简、可观察的 UI 状态；文档本身存放在 CodeMirror 的 `EditorState` 中 |
| 数学渲染 | **MathJax 4.1** | TeX → SVG，支持换行与无障碍；预览与导出输出一致；mhchem 需显式启用 |
| 图表 | **Mermaid 12 · js-sequence-diagrams · flowchart.js** | Mermaid 代码块，外加传统的 `sequence` 与 `flowchart` 代码块；固定 dagre/classic 渲染以保证输出稳定 |
| 代码高亮 | **@lezer/highlight + @codemirror/legacy-modes** | 编辑器原生语言模式——源码、预览与导出中的高亮完全一致 |
| HTML 安全 | **DOMPurify 3.4 + 严格 CSP** | 在 MathJax/Mermaid 渲染前消毒 Markdown 派生的 HTML；严格 CSP 与沙箱化渲染进程 |
| 剪贴板转换 | **Turndown 7 + GFM 插件** | 将粘贴的 HTML 转换为干净的 Markdown，包含表格 |
| 拼写检查 | **Electron 内置拼写检查器（Windows/Linux 为 Hunspell）** | 三个平台统一的系统级词典；离线场景请自托管词典 URL |
| 编码识别 | **iconv-lite 0.6 + jschardet 3.1** | 正确检测并打开非 UTF-8 文件 |
| 模糊搜索 | **fuzzysort + @vscode/ripgrep** | 文件名瞬时匹配；ripgrep 负责大工作区的全文搜索 |
| 文件监听 | **@parcel/watcher** | 面向大型笔记库的原生递归监听；外部变更时防抖重载 |
| 翻译缓存 | **node:sqlite** | Electron Node 运行时内置的 SQLite；无需原生重编译；按块哈希索引 |
| 设置存储 | **electron-store 12** | 用户数据目录中的类型化 JSON 持久化；密钥使用 Electron `safeStorage` |
| 界面本地化 | **i18next 26** | JSON 语言资源——与文档翻译管线相互独立 |
| 导出 | **printToPDF · capturePage · Pandoc（可选，外部）** | 原生 HTML/PDF/图片；DOCX、EPUB、LaTeX 等由用户自行安装的 Pandoc 提供 |
| IPC | **contextBridge + ipcMain** | 渲染进程沙箱化，仅暴露类型化、最小化的 API 面 |
| 包管理 | **npm workspaces** | 随 Node.js 自带；Electron 生态的默认工具链，原生模块重构建开箱即用 |
| 测试 | **Vitest 5 + Playwright 1.64** | 单元与端到端覆盖，含 Electron 自动化 |
| 代码规范 | **Biome 2** | TS/JS 一体化工具链 |

**技术栈定义**

- **实时文档** —— CodeMirror 的 `Text`/`EditorState`。它是唯一事实来源，所有视图都由它派生。
- **编辑器时解析** —— Lezer 语法树。负责块边界、Decoration、折叠与高亮，不是语义 AST。
- **语义解析** —— micromark → mdast，仅对脏块运行，服务预览、翻译与导出。
- **块缓存** —— `hash(源码切片) → mdast 碎片 / 消毒 HTML / 译文`。未改动的块保持字节级不变。
- **实时预览** —— CM6 的 Decoration 与组件：光标处显示 Markdown 标记，其余位置渲染结果。行内装饰按视口计算；块级组件由 State 计算并按块缓存。

## 架构

```
┌────────────────────────────────────────────────────────────────┐
│                 渲染进程（Chromium + TypeScript）               │
│                                                                │
│   ┌───────────┐    ┌───────────────┐    ┌──────────────────┐   │
│   │   源码    │    │   实时预览    │    │    翻译预览      │   │
│   │  raw .md  │ ⇄  │ 内联所见即所得│ ⇄  │  目标语言渲染    │   │
│   └─────┬─────┘    └───────┬───────┘    └────────┬─────────┘   │
│         └──────────────────┼─────────────────────┘             │
│                 CodeMirror 6 编辑器内核                        │
│          （Lezer 增量解析 + Decoration 装饰渲染）              │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │          文档核心 —— mdast 语义语法树（派生）            │  │
│  └───────────────┬───────────────────────┬──────────────────┘  │
│         ┌────────┴────────┐     ┌─────────┴──────────┐         │
│         │   渲染引擎      │     │   翻译管线（AST）  │         │
│         │  （安全 HTML）  │     │                    │         │
│         └─────────────────┘     └────────────────────┘         │
├────────────────────────────────────────────────────────────────┤
│         Preload（contextBridge）—— 类型化、最小化 IPC API       │
├────────────────────────────────────────────────────────────────┤
│                      主进程（Node.js）                         │
│    文件 IO · 原子保存 · 文件监听 · SQLite 缓存 · 导出          │
│    原生菜单 · 窗口管理 · 自动更新                              │
└────────────────────────────────────────────────────────────────┘
```

**设计原则**

- **一个源，三个视图。** 源码、实时预览、翻译预览都是同一份 Markdown 文档的投影——绝不是三份逐渐漂移的文本副本。
- **编辑器永不阻塞。** 解析、预览渲染、高亮与翻译全部运行在关键路径之外（增量、防抖或 Worker）。
- **严格的进程边界。** 渲染进程沙箱化；所有文件系统与操作系统访问都经过主进程中类型化的 contextBridge API。
- **一切重资源皆懒加载、皆缓存。** Mermaid、MathJax、传统语言模式与翻译结果只加载一次，按内容哈希记忆化。

### 解析架构

Manuslip 采用**双解析器方案**——两个解析器各司其职：

- **Lezer**（`@lezer/markdown`）驻留在编辑器内核中。每次击键都增量重解析，驱动你能感知到的一切：Decoration、高亮、折叠、实时预览组件。它的语法树还免费提供顶层块边界。
- **micromark** 只对脏块运行，产出严格符合规范的 mdast，用于渲染、翻译与导出。Lezer 提供块边界；源码切片是身份单位。块碎片带着源码偏移拼接进持久化语义 AST。

两者之间是让性能不再是问题的那一层：**以同一份内容哈希为键的块级缓存**。

```
击键
  ▼
Lezer 增量重解析 ─────► Decoration · 高亮 · 折叠
  ▼
块切分器（Lezer 顶层）─► 块 { 区间, 源码切片 }
  ▼
hash = xxhash64（切片）       ← 一份哈希，三级缓存
  ├─► 解析缓存   ─► mdast 碎片（micromark，仅脏块）
  ├─► 渲染缓存   ─► 逐块消毒 HTML
  └─► 翻译缓存   ─► 逐块译文
  ▼
持久化语义 AST：[ (hash, fragment, range), ... ]
未改动块保持对象标识 → 渲染与翻译零成本复用
```

- **一份哈希，三级缓存。** 块源码的同一份 xxhash 同时服务解析缓存、渲染缓存与翻译缓存。编辑一个段落的成本是一次哈希、一次针对约 1 KB 文本的 micromark 调用、一次 DOM 补丁——与文档大小无关。
- **结构共享。** 文档 AST 是不可变碎片组成的数组；未改动块保持对象标识，下游消费者（渲染 HTML、译文、组件 props）按引用直接复用，而非重新 diff。
- **Worker 只用在刀刃上。** 单块编辑在主线程同步解析（微秒级，无 IPC）。批量事件——打开大文件、大段粘贴、全部替换——把相互独立的块分发到 Worker 池。
- **正确性是底线。** CommonMark 规范测试套件与 GFM 测试在 CI 中运行；缓存再快，返回错误结果依然是错。
- **位置信息是一等公民。** 每个碎片都保留源码偏移——这是滚动同步、点击定位源码、以及翻译预览块级对齐的地基。

### 翻译管线

```
编辑 ──► 增量重解析（Lezer）
     ──► diff mdast 块
     ──► 块哈希（文本 + 语言 + 服务商）
     ──► 命中缓存？ ── 是 ──► 直接复用译文
                │
                否
                ▼
     批量提交可翻译节点 ──► 服务商（流式返回）
     ──► 写入 SQLite 缓存 ──► 渐进式渲染
```

## 响应性

Manuslip 的流畅来自架构设计，而非微优化：

| 目标 | 实现机制 |
|---|---|
| 长文档流畅输入 | Lezer 增量重解析；以内容哈希为键的块级解析/渲染缓存；Decoration 只渲染视口区间 |
| 即时模式切换 | 三个视图共享同一份缓存 AST——切换时零重解析 |
| 合理的启动与内存占用 | 重模块（Mermaid、MathJax、传统语言模式）代码分割、懒加载 |
| 无重复翻译开销 | 内容哈希块级缓存跨会话持久化 |
| 安全保存 | 主进程先写临时文件再原子重命名；防抖外部变更监听 |

## 项目结构

```
manuslip/
├─ apps/
│  └─ desktop/          # Electron 应用 —— 主进程、preload、窗口、菜单
├─ packages/
│  ├─ core/             # Markdown 文档模型、块哈希、mdast 语义投影
│  ├─ editor/           # CodeMirror 6 配置、快捷键、实时预览 Decoration
│  ├─ renderer/         # mdast → 消毒 HTML（MathJax、Mermaid、CM 语言模式）
│  ├─ translate/        # 服务商接口、块缓存、术语表、批量调度
│  └─ ui/               # 共享组件、主题、设计令牌
├─ package.json         # npm workspaces 根
└─ README.md
```

## 快速开始

**前置要求：** Node.js 24 LTS（版本固定在 `.nvmrc`），自带 npm 11。

```bash
git clone https://github.com/<your-org>/manuslip.git
cd manuslip
npm install        # 原生模块会自动针对 Electron 重新构建

# 开发模式运行（渲染进程 HMR + 主进程/preload 实时重载）
npm run dev

# 类型检查、lint、测试
npm run check
npm test

# 生产构建 → 安装包位于 apps/desktop/release
npm run build
```

## 路线图

- **M1 —— 编辑器内核。** 源码模式 + 实时预览（CommonMark、GFM、表格、MathJax、代码高亮）、文件打开/保存、自动保存。
- **M2 —— 工作区。** 侧边栏文件树、多标签、大纲、全局搜索、主题、拼写检查、图片资源管理、HTML/PDF 导出。
- **M3 —— 翻译预览。** AST 翻译管线、块缓存、服务商接口（OpenAI 兼容 + DeepL + 本地模型）、双语对照与逐行对照版式、双语导出。
- **M4 —— 扩展性与打磨。** 插件 API、自定义 CSS 主题、Pandoc 导出配置、专注/打字机模式、演示模式、同步适配器。

## 参与贡献

Manuslip 正处于早期开发阶段——这是塑造它的最佳时机。欢迎 Bug 报告、设计反馈、翻译服务商集成，以及 UI 多语言翻译。大型 PR 之前请先开 Issue 对齐方向。开发环境、提交规范与评审流程见 [CONTRIBUTING.md](./CONTRIBUTING.md)（英文）；安全漏洞请按 [SECURITY.md](./SECURITY.md) 私下报告。

1. Fork 本仓库并创建特性分支。
2. `npm install && npm run dev` 运行应用。
3. 保持 `npm run check` 与 `npm test` 全绿。
4. 提交 PR，并清晰描述改动内容。

## 致谢

Manuslip 站在众多杰出开源项目的肩膀上：[Electron](https://www.electronjs.org)、[CodeMirror](https://codemirror.net)、[Lezer](https://lezer.codemirror.net)、[unified](https://unifiedjs.com) / [micromark](https://github.com/micromark/micromark)、[MathJax](https://www.mathjax.org)、[Mermaid](https://mermaid.js.org)、[js-sequence-diagrams](https://bramp.github.io/js-sequence-diagrams/)、[flowchart.js](https://flowchart.js.org)、[DOMPurify](https://github.com/cure53/DOMPurify)、[Turndown](https://github.com/mixmark-io/turndown)、[i18next](https://www.i18next.com)、[fuzzysort](https://github.com/farzher/fuzzysort)、[ripgrep](https://github.com/BurntSushi/ripgrep)、[@parcel/watcher](https://github.com/parcel-bundler/watcher)、[node:sqlite](https://nodejs.org/api/sqlite.html)、[electron-store](https://github.com/sindresorhus/electron-store)、[electron-vite](https://electron-vite.org)、[electron-builder](https://www.electron.build)，以及更多项目。

## 许可证

[MIT](./LICENSE) © Manuslip 作者团队
