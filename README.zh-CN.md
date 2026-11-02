# Manuslip

<img src="apps/desktop/build/icon.svg" alt="Manuslip" width="96" height="96" />

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

**实现状态：** Manuslip 语法现已在实时预览、译文阅读与导出中支持 `~下标~`、`^上标^`（不含空格）
与离线 `:smile:` 短码，以及定义列表（术语行后接 `: 说明`），同时保留 `~~删除线~~` 和严格 CommonMark 模式。详见[语法设计（英文）](./docs/adr/006-extended-markdown.md)。
桌面应用已支持打开、编辑与安全保存 Markdown 文件，包括 CodeMirror 源码编辑器、
原生文件对话框、编码/BOM/换行符保留、自动保存、外部修改冲突处理、关闭保护与草稿恢复，
以及安全外壳和中英文偏好设置。Windows 构建与打包应用流程已测试，跨平台验收仍待完成。
实时预览已加入行内格式、表格、代码高亮、数学/化学公式、HTML 安全过滤与逐文档远程图片权限。
多文档标签页已支持保留选区、撤销历史与滚动位置，重复打开文件会激活已有标签页，取消关闭窗口会保留所有草稿。
文件夹工作区已支持按需加载文件树、最近的文件夹与重启后恢复已命名标签页；无法访问的文件可重试或从会话中移除。
拖入 Markdown/文本文件或通过系统启动请求打开文件时，会使用新标签页并保留已有草稿。
导航现已支持标题跳转、字词/字符计数、文件名模糊查找（`Ctrl/Cmd+P`），以及可取消的已保存文件全文搜索（`Ctrl/Cmd+Shift+F`）。
离线拼写检查可在偏好设置中启用：Windows/Linux 检查美式英语，macOS 使用系统语言。
纯文本/图片粘贴、本地位图资源、独立进程 Mermaid 图表和自包含 HTML/PDF 导出已实现。
翻译偏好设置已支持配置 OpenAI 兼容、Ollama 或 DeepL 接口、会话密钥或操作系统保护的密钥，以及清除缓存。
译文预览（`Ctrl/Cmd+3`）已支持选择阅读语言、翻译、取消、重试失败项、离线载入缓存，以及编辑后的过期提示和显式刷新。
只读副本保留原始编辑缓冲区，并恢复每处代码、公式、图表和链接。仅译文、左右对照与逐段对照布局使用稳定的段落锚点。
阅读副本 HTML/PDF 导出会捕获选定语言、布局与已完成译文；过期或不完整的副本需要明确确认。
DeepL 已支持显式载入语言、XML 占位符保护、原生语气控制与已有术语表 ID。Google Cloud 和 LibreTranslate 为可选后续适配器。
文档操作现已提供当前窗口的专注与打字机模式。专注模式保留保存、状态与可见的退出按钮，按 Esc 可返回完整工作区。
打字机模式在写作或移动选区时将主光标保持在视窗中央，同时允许手动滚动；两种模式均保留源码与撤销历史。
点击实时预览表格旁的“编辑表格”，或将光标放在表格内后从文档操作中打开。对话框支持单元格、行列与对齐操作，
所有更改作为一次可撤销的源码编辑应用，取消不会修改文档。键盘导航、源码保留与可视化编辑限制详见[表格编辑设计（英文）](./docs/adr/007-visual-tables.md)。
文档外观支持逐文档字体、字号、行距与写作宽度，以及显式导入本地 CSS，用于实时预览、译文阅读和 HTML/PDF 导出。
即使样式使正文难以阅读，仍可恢复默认或使用源码。已命名文档会在重启后恢复外观；详见[外观与支持的 CSS（英文）](./docs/adr/008-document-appearance.md)。
“演示文档”将快照显示为幻灯片，支持键盘导航与可见的退出按钮。PNG/JPEG 导出保存完整源码或选定阅读副本，
包含外观、图片、公式与图表；超过图片尺寸上限时会明确提示，仍可使用 HTML/PDF。
详见[幻灯片、操作与图片限制（英文）](./docs/adr/009-presentation-image-export.md)。
“通过 Pandoc 导出”支持 Word（.docx）、EPUB，以及包含图片的 LaTeX 源文件（.zip）。
请选择你信任的本地 Pandoc 3 应用程序，再选择“标准”或“标题编号及目录”。正文、表格和注释保持可编辑，
公式与图表保存为图片，各格式使用自身样式。编译 LaTeX 需要另行安装支持 Unicode 的 LaTeX 工具。
导出不会修改源码或阅读副本。Pandoc 为可选工具，不随应用附带；详见[工具选择、样式与限制（英文）](./docs/adr/010-optional-pandoc.md)。
“偏好设置 → 插件”支持审核权限并安装本地命令插件，以及启停、修改权限与移除。
从“文档操作 → 插件命令”对捕获的源码运行独立进程命令；建议修改需要审核后应用，且可一次撤销。
文件与网络访问均需明确授权。详见[插件 API 与可用示例（英文）](./docs/guides/plugins.md)。
“文档操作 → 同步”可将已保存文档连接至文件夹中的一个文件或 WebDAV 网址。
核对两端版本后，可发送、接收或保留两份。支持离线编辑、明确重试、恢复副本导出及断开连接。
详见[同步操作与限制（英文）](./docs/guides/sync.md)。
打开偏好设置、译文预览或切换布局不会发送翻译请求。
下方功能列表描述的是目标产品。详见[验证记录与待办事项（英文）](./docs/validation/implementation-history.md)。

### 核心编辑

- **无缝实时预览** —— Markdown 边输入边就地渲染；语法标记仅在光标所在行显现。一个界面，零模式切换成本。
- **源码模式** —— 全功能代码编辑器视图：语法着色、多光标、搜索替换，输入保持原始文本。
- **CommonMark + GFM** —— 表格、任务列表、删除线、自动链接、脚注、定义列表、上下标、emoji 短代码、YAML frontmatter。
- **数学公式** —— 行内 `$...$` 与块级 `$$...$$`，由 MathJax 渲染，支持 mhchem 化学式。
- **图表** —— Mermaid 代码块（流程图、时序图、甘特图、类图、状态图等），并兼容传统的 `sequence` 与 `flowchart` 代码块。
- **代码高亮** —— 编辑器原生 CodeMirror 语言模式，在源码、预览与导出中保持一致。
- **富表格编辑** —— 可视化表格操作、键盘导航、列对齐。
- **纯文本粘贴** —— 剪贴板文字保持原样；仅有图片时导入受管资源目录。
- **拼写检查** —— 系统级拼写检查，支持按语言加载词典。
- **大纲与导航** —— 自动生成目录、标题跳转、单文档字数/字符统计。

### 工作区

- **文件树侧边栏**：文件夹工作区、多标签页、拖拽打开、`.md` 文件关联。
- **全局模糊搜索**：跨文件检索，以及文档内搜索替换。
- **自动保存**：原子写入 + 文件监听——外部修改可安全重载。
- **编码自动识别**：正确打开非 UTF-8 编码的旧文件。
- **主题**：内置明暗主题、自定义 CSS、单文档排版设置。
- **专注与打字机模式**：为长文写作消除干扰。
- **导出**：原生自包含 HTML、PDF、PNG 与 JPEG；Word（.docx）、EPUB 及包含图片的 LaTeX 源文件通过可选的 Pandoc 工具导出；翻译文档支持双语导出。

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
- **块级缓存。** 每个块按源文本、目标语言、翻译服务、模型、术语表/正式度与提示词/抽取器版本共同寻址。未改动的翻译单元永不重复翻译——在万字文档中改一句话，只会重译真正变化的单元。
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
| Markdown 扩展 | **remark-gfm · remark-frontmatter · remark-math · 定义列表工具 · gemoji** | 表格、任务列表、frontmatter、数学、带源码位置的定义列表与离线表情短码 |
| UI | **React 19 + TypeScript 7 + Vite 8** | HMR 开发体验、庞大生态、可预期的性能模式 |
| 状态管理 | **Zustand 5** | 极简、可观察的 UI 状态；文档本身存放在 CodeMirror 的 `EditorState` 中 |
| 数学渲染 | **MathJax 4.1** | TeX → SVG，支持换行与无障碍；预览与导出输出一致；mhchem 需显式启用 |
| 图表 | **Mermaid 12 · 独立进程旧语法转换** | Mermaid 代码块，以及已明确支持的传统 `sequence` 与 `flowchart` 语法子集；dagre/classic 渲染 |
| 代码高亮 | **@lezer/highlight + @codemirror/legacy-modes** | 编辑器原生语言模式——源码、预览与导出中的高亮完全一致 |
| HTML 安全 | **DOMPurify 3.4 + 严格 CSP** | 在 MathJax/Mermaid 渲染前消毒 Markdown 派生的 HTML；严格 CSP 与沙箱化渲染进程 |
| HTML 转换工具 | **Turndown 7 + GFM 插件** | 本地安全的 HTML → Markdown 转换工具；普通粘贴保留纯文本 |
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
- **语义解析** —— unified/remark 在 Worker 中解析完整文档，生成带源码位置的 mdast，保留引用链接与脚注的整文档上下文。
- **派生缓存** —— 有界语义与渲染快照以源码和解析/渲染配置为键。块身份跟随映射后未改动的区间，重复内容仍有独立身份。翻译使用包含全部输出相关设置的独立缓存键。
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

Lezer 为编辑器语法高亮与视口装饰提供增量解析。独立的 unified/remark Worker 解析**完整文档**，保留源码位置与全局定义，为预览、后续翻译和导出提供语义快照。不会根据 Lezer 块边界拼接独立解析的语义碎片。

```
编辑 → CodeMirror 状态 + Lezer 增量语法
       └→ 防抖（空闲 150 ms / 最长 1 s 发布最新请求）
          → 一个执行中的语义解析 + 一个最新待处理请求
          → 完整 mdast + 渲染投影
          → 校验会话代次、文档修订与渲染配置
          → 映射块身份 + 经安全过滤的视口组件
```

源码模式无需等待语义解析即可编辑。切换模式仅重新配置同一个编辑器状态，保留文本、选区、滚动锚点与撤销历史。内容更改立即使旧组件失效；过期 Worker 结果不能更新当前文档。

语义 Worker 设有 5 s 超时监控，60 s 内最多自动重启三次，随后显示源码回退与手动重试。预览上限为 2 MiB 或 50,000 块，Worker 消息上限为 8 MiB。Worker 快照缓存上限为 16 MiB，与渲染进程的 64 MiB 派生数据预算分别计算。这些是强制资源上限；性能验收目标仍需按 [ADR 002](./docs/adr/002-implementation-plan.md) 实测。

渲染先在完整根节点中解析引用，再提取组件片段。所有 HTML/SVG DOM 写入均经过 DOMPurify。原始 HTML 默认转义，明确启用后仍进行安全过滤。图片不能隐式加载远程地址。块替换直接由 CodeMirror StateField 提供，行内装饰仅遍历可见区间。

实时预览在输入或选择文字时也会隐藏已完成的强调、删除线、行内代码、标题和引用标记。
格式仅应用于解析后的内容，光标移动会跳过隐藏标记；源码模式保留所有原始字符。

### 剪贴板与本地图片（已实现）

源码与实时预览均按原样插入输入的括号、引号、制表符和换行。
普通粘贴使用剪贴板中的纯文本，即使剪贴板同时提供 HTML 或图片表示。
Ctrl/⌘ V、Ctrl/⌘ Shift V 和“编辑 → 粘贴”行为一致；替换选中文字时也不会自动创建链接。
达到 262,144 个 UTF-16 单元的纯文本会分段准备；插入前可点击“取消粘贴”或按 Escape，
成功插入后仍可一次撤销。

“全部替换”也会先准备更改，再一次性写入；一次撤销即可恢复。准备期间可点击“取消替换”
或按 Escape，编辑文档或切换标签页也会取消。超过五秒则停止，原文保持不变。
资源限制见 ADR 002。

粘贴图片时会先捕获 PNG。未命名文档会打开“另存为”，取消后文档保持原样。
图片以不覆盖已有文件的 `assets/pasted-<UUID>.png` 保存于文档旁，并插入相对链接。
撤销、删除链接或关闭标签页均不会自动删除图片文件。相对 PNG/JPEG/GIF/WebP 图片
通过受控资源协议读取，不需要开启远程图片；缺失图片提供重试。
路径仅限打开文档时授予的工作区，或直接打开文档的父文件夹。
资源上限与验证记录见 [ADR 002](./docs/adr/002-implementation-plan.md) 和
[验证记录](./docs/validation/implementation-history.md)。

### Mermaid 图表（已实现）

Mermaid 代码块按需在独立沙箱进程中渲染，随应用主题切换。流程图、时序图、类图、
状态图、实体关系图、饼图和甘特图已有集成测试。源码与撤销历史保持不变；语法错误、
超出上限或渲染超时后保留源码并提供重试。主进程监控会终止卡住的图表进程，
编辑与保存仍可继续。文档中的配置指令和前置配置无法覆盖应用策略。
传统 `sequence`/`seq` 与 `flowchart`/`flow` 代码块已支持[文档列出的语法子集](./docs/adr/006-extended-markdown.md)，包括参与者、消息、注释、标准流程节点与条件分支。暂不支持的语法保留完整源码并显示修改提示。上限与验证范围见
[验证记录](./docs/validation/implementation-history.md)。

### HTML 和 PDF 导出（已实现）

打开“文档操作”，选择“导出 HTML…”或“导出 PDF…”，也可以使用“文件”菜单。
“保存”始终显示在文档标题旁。“文档操作”还包含新建、打开、另存为、保存副本，
以及需要主动启用的 HTML 和远程图片预览选项。
导出会捕获点击时的源码，包括尚未保存的修改。导出期间可以继续编辑；完成提示会说明后续修改未包含在副本中。
HTML 内嵌获准读取的位图和经过安全过滤的公式/图表 SVG；PDF 使用 A4 纸张、20 毫米页边距，
并在独立打印进程中等待字体、图片、公式和图表就绪。两种格式都使用固定的浅色纸张样式，保留代码但不添加语法着色。

在译文预览中，选择“导出阅读副本 HTML…”或“导出阅读副本 PDF…”，会捕获该副本的语言、布局与已完成译文。
左右对照以完整区块（包括列表与表格）对齐，逐段对照依次显示原文与译文；小屏幕会将左右对照改为上下排列。
译文或资源高度变化时保留阅读锚点。若原文已更改或部分正文未翻译，需要选择“导出此副本”，
使用捕获的原文并为缺失译文保留原文；也可以取消，先完成翻译或刷新。后续译文和编辑不会改变已捕获的副本。
源码或实时预览中的导出仍使用当前源码。

本地图片使用捕获时文档的文件夹/工作区授权，远程图片需要当前文档的许可。
缺失、被阻止或无效的图片会使整次导出失败，已有目标文件会保留。
取消导出不会修改源码；已经进入原生文件发布操作的写入可能完成。
每个窗口最多同时导出一次，选择目标后限时 60 秒，源码上限 2 MiB、位图最多 500 张、PDF 最多 2,000 页。
详细资源上限与尚未完成的平台验证见 [VALIDATION.md（英文）](./docs/validation/implementation-history.md)。

### 翻译管线（OpenAI 兼容、Ollama 与 DeepL）

在译文预览中选择阅读语言并点击“翻译”。“阅读选项”包含阅读布局、“载入缓存”、翻译设置和帮助。
取消、重试、进度和错误提示始终显示在阅读副本旁；切换模式会关闭阅读选项。

纯逻辑[翻译核心（英文）](./docs/architecture/translation.md)已支持规范化文本单元提取、受保护内容本地保留、
占位符校验、仅文本 AST 重建，以及包含服务商和设置的缓存标识。
离线测试包含全部 652 个 CommonMark 示例。OpenAI 兼容、Ollama 与 DeepL 接口、凭据、SQLite 缓存和三种阅读布局已集成。
只有“翻译”“刷新译文”和“重试失败项”明确允许发送服务请求；“载入缓存”保持离线。
打开文件、编辑或切换布局不会自动翻译。代码、公式、图表、链接地址与原始 HTML 保留在本地。
DeepL 使用方式：保存完整翻译接口地址并设置 API 密钥后，在“偏好设置 → 翻译”中选择“载入支持的语言”。
这项需要身份验证的请求不会发送文档正文；“翻译”也会在缓存未命中时检查语言支持。
API Free 使用 `api-free.deepl.com`，API Pro 使用 `api.deepl.com`。
专用选项随所选语言对更新；术语表 ID 指向已有的 DeepL 术语表，并要求明确原文语言。应用不会创建远程术语表。
语言信息仅在内存中保留 15 分钟；重启后无需密钥或服务连接即可“载入缓存”。
可选服务适配器以及更广泛的性能与跨平台验收仍待完成。

```
编辑 ──► 当前完整文档 mdast 快照（语义 Worker）
     ──► 提取可翻译单元与映射后的实例区间
     ──► 单元键（内容 + 服务商/设置 + 重建模式版本）
     ──► 命中缓存？ ── 是 ──► 直接复用译文
                │
                否
                ▼
     有界正文单元 ──► 服务商（完整且通过校验的响应）
     ──► 写入 SQLite 缓存 ──► 渐进式渲染
```

## 响应性

Manuslip 的流畅来自架构设计，而非微优化：

| 目标 | 实现机制 |
|---|---|
| 长文档流畅输入 | Lezer 增量重解析；整文档语义 Worker 防抖与有界队列/缓存；行内装饰仅处理视口 |
| 流畅的模式切换 | 源码始终可编辑；复用当前已完成的快照，或在解析最新修订时显示待处理状态 |
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
npm ci             # 安装锁定版本的 Electron 二进制，并重建原生模块

# 开发模式运行（渲染进程 HMR + 主进程/preload 实时重载）
npm run dev

# 类型检查、lint、测试
npm run check
npm test

# 生产构建 → 安装包位于 apps/desktop/release
npm run build

# 对已有构建运行 Electron 启动测试（无需下载浏览器）
npm run test:e2e
```

`npm run build:app` 仅构建应用资源；`npm run package:dir` 将已有资源打包为未封装安装程序的应用目录。
构建不签名，也不会自动发布。Linux 上的 Electron 测试需要显示服务（CI 使用
`xvfb-run --auto-servernum npm run test:e2e`）。开发环境与已安装应用使用独立的偏好设置目录。
依赖版本与运行时信息见 [DEPENDENCIES.md（英文）](./docs/development/dependencies.md)。
`npm run test:performance` 单独运行打包应用的性能验收。目前复杂嵌套文档仍会达到预览资源上限；
测试方法与定向分析命令见 [docs/testing/benchmarks.md（英文）](./docs/testing/benchmarks.md)。

Windows 可运行 `npm run test:installer`，验证安装后的应用并在卸载后检查安装状态恢复。
独立的签名与更新元数据构建入口为 `npm run package:release -- --plan`；
详见[构建与审核发行包](./docs/development/distribution.md)。

## 路线图

实现顺序、架构决策与验收标准见[实施计划（英文）](./docs/adr/002-implementation-plan.md)。

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
