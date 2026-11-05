# Manuslip

<img src="apps/desktop/build/icon.svg" alt="Manuslip" width="96" height="96" />

**用 Markdown 写作，以任何语言阅读。**

Manuslip 是一款本地优先的 Markdown 桌面编辑器，支持 Windows、macOS 和 Linux。
使用源码或实时预览模式写作，并在保留原文的同时阅读翻译副本。

[English](README.md) | [简体中文](README.zh-CN.md)

## 功能

- CommonMark、表格、任务列表、脚注、定义列表与代码高亮，以及可选的数学公式、
  化学公式、Mermaid 图表等 [Markdown 扩展](docs/guides/commonmark.md)。
- 原生文件对话框、自动保存、冲突处理与草稿恢复，并保留文件编码、字节序标记（BOM）
  和换行符。
- 文件夹工作区、文档标签页、大纲、文件名与内容搜索，以及离线拼写检查。
- 按需调用 OpenAI 兼容、Ollama 或 DeepL 服务翻译；复用已缓存的结果，
  支持仅译文、左右对照和逐段对照三种阅读布局。
- 可视化表格编辑、文档独立排版与受限的本地 CSS 导入。
- 导出自包含 HTML、PDF、PNG 或 JPEG，或将文档作为幻灯片演示。
  安装本地 Pandoc 3 后，还可导出 Word、EPUB 和 LaTeX 源码。
- 明确授权的本地命令插件，审核后应用文档修改；支持手动文件夹与 WebDAV 同步。
- 浅色与深色主题，以及英文和简体中文界面。

操作与限制见[桌面使用指南](docs/guides/desktop.md)、[插件指南](docs/guides/plugins.md)
和[同步指南](docs/guides/sync.md)（英文）。

## 开发

使用 Node.js 24（见 `.nvmrc`）与 npm 11。在仓库根目录安装依赖并启动开发应用：

```sh
npm ci
npm run dev
```

运行检查与桌面测试：

```sh
npm run check
npm test
npm run build:app
npm run test:e2e
```

`npm run build` 构建应用资源，并在 `apps/desktop/release/` 生成未签名安装包。
如已构建资源，可使用 `npm run package:dir` 直接打包。无显示服务的 Linux 桌面测试需要 Xvfb。
开发、测试与已安装应用各自使用独立的配置目录。

环境配置、原生工具链与发行命令见[贡献指南](CONTRIBUTING.md)、
[测试指南](docs/testing/testing.md)和[发行指南](docs/development/distribution.md)（英文）。
[架构说明](docs/architecture/desktop.md)、[架构决策记录（ADR）](docs/adr/index.md)
与[离线资源维护](docs/development/assets.md)提供设计与维护指导。

## 贡献与安全

大型 API 或架构修改请先开 Issue 讨论。保持修改范围集中，并运行相关检查后提交 PR。
请遵守[行为准则](CODE_OF_CONDUCT.md)，并按[安全策略](SECURITY.md)私下报告漏洞。

## 许可证

[MIT](LICENSE)。第三方依赖与资源保留各自的许可证。
应用包中包含 `THIRD-PARTY-NOTICES.txt`，详见
[资源维护指南](docs/development/assets.md#bundled-dependency-notices)（英文）。
