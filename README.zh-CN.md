# Manuslip

<img src="apps/desktop/build/icon.svg" alt="Manuslip" width="96" height="96" />

**用 Markdown 写作，以任何语言阅读。**

Manuslip 是一款本地优先的 Markdown 桌面编辑器，支持 Windows、macOS 和 Linux。
使用源码或实时预览模式写作，在不修改原文的前提下阅读翻译副本。

[English](README.md) | [简体中文](README.zh-CN.md)

## 功能

- CommonMark 与可选的表格、任务列表、脚注、定义列表、数学/化学公式、Mermaid、
  代码高亮及其他 [Markdown 约定](docs/guides/commonmark.md)。
- 原生文件对话框，保留编码、BOM 和换行符，支持自动保存、冲突处理与草稿恢复。
- 文件夹工作区、多标签、大纲、文件名/内容搜索与离线拼写检查。
- 通过 OpenAI 兼容、Ollama 或 DeepL 服务翻译，支持缓存、仅译文、左右对照和逐段对照。
  仅在明确操作后发起翻译请求。
- 表格编辑、文档独立排版与受限的本地 CSS 导入。
- 自包含 HTML/PDF、PNG/JPEG 导出与幻灯片演示；可选的本地 Pandoc 3
  支持 Word、EPUB 和 LaTeX 源码导出。
- 本地命令插件需明确授权并审核修改；支持手动文件夹/WebDAV 同步。
- 明暗主题与英文/简体中文界面。

操作与限制见[桌面使用指南](docs/guides/desktop.md)、[插件指南](docs/guides/plugins.md)
和[同步指南](docs/guides/sync.md)（英文）。

## 开发

使用 Node.js 24（见 `.nvmrc`）与 npm 11，在仓库根目录运行：

```sh
npm ci
npm run dev
```

```sh
npm run check
npm test
npm run build:app
npm run test:e2e
```

`npm run build` 同时在 `apps/desktop/release/` 生成未签名安装包。
`npm run package:dir` 打包已有应用资源。无显示服务的 Linux 桌面测试需要 Xvfb。
开发和测试配置目录与已安装应用的写作配置目录相互独立。

环境配置、原生工具链与发行命令见[贡献指南](CONTRIBUTING.md)、
[测试指南](docs/testing/testing.md)和[发行指南](docs/development/distribution.md)（英文）。
[架构说明](docs/architecture/desktop.md)、[架构决策记录（ADR）](docs/adr/index.md)
与[离线资源维护](docs/development/assets.md)提供设计与维护指导。

## 贡献与安全

大型 API 或架构修改请先开 Issue 讨论。保持修改范围集中，并运行相关检查后提交 PR。
请遵守[行为准则](CODE_OF_CONDUCT.md)，并按[安全策略](SECURITY.md)私下报告漏洞。

## 许可证

[MIT](LICENSE)。第三方资源保留各自的许可证与声明。
