# Manuslip

<img src="apps/desktop/build/icon.svg" alt="Manuslip" width="96" height="96" />

**Write in Markdown. Read in any language.**

Manuslip is a local-first Markdown desktop editor for Windows, macOS and Linux.
Write in Source or Live Preview and read translated copies without changing the original.

[English](README.md) | [简体中文](README.zh-CN.md)

## Features

- CommonMark with optional tables, tasks, footnotes, definition lists, math/chemistry,
  Mermaid, syntax highlighting and other [Markdown conventions](docs/guides/commonmark.md).
- Native file dialogs, encoding/BOM/newline preservation, autosave, conflict handling
  and recoverable drafts.
- Folder workspaces, document tabs, outlines, filename/content search and offline spelling.
- Translation through OpenAI-compatible, Ollama or DeepL providers, with cached results,
  translation-only, side-by-side and interlinear reading layouts. Requests are explicit.
- Table editing, per-document typography and restricted local CSS imports.
- Self-contained HTML/PDF, PNG/JPEG and slide presentation. Optional local Pandoc 3
  adds Word, EPUB and LaTeX source export.
- Local command plugins with explicit permissions and reviewed edits; explicit folder/WebDAV sync.
- Light/dark themes and English/Simplified Chinese interfaces.

See the [desktop guide](docs/guides/desktop.md), [plugin guide](docs/guides/plugins.md)
and [sync guide](docs/guides/sync.md) for controls and limits.

## Development

Use Node.js 24 (`.nvmrc`) and npm 11. From the repository root:

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

`npm run build` also produces unsigned installers in `apps/desktop/release/`.
`npm run package:dir` packages existing application assets. Headless Linux desktop
tests need Xvfb. Development and test profiles are separate from the installed writing profile.

See [contributing](CONTRIBUTING.md), [testing](docs/testing/testing.md) and
[distribution](docs/development/distribution.md) for setup, native toolchains and release commands.
[Architecture](docs/architecture/desktop.md), [ADRs](docs/adr/index.md) and
[offline assets](docs/development/assets.md) cover design and maintenance guidance.

## Contributing and security

Discuss large API or architecture changes in an issue first. Keep changes focused and
run the relevant checks before submitting a pull request. Follow the
[Code of Conduct](CODE_OF_CONDUCT.md) and report vulnerabilities through the
[security policy](SECURITY.md).

## License

[MIT](LICENSE). Third-party assets retain their own licenses and notices.
