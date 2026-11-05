# Manuslip

<img src="apps/desktop/build/icon.svg" alt="Manuslip" width="96" height="96" />

**Write in Markdown. Read in any language.**

Manuslip is a local-first Markdown desktop editor for Windows, macOS and Linux.
Write in Source or Live Preview, then read a translated copy while preserving your original text.

[English](README.md) | [简体中文](README.zh-CN.md)

## Features

- CommonMark, tables, task lists, footnotes, definition lists and syntax highlighting,
  with optional math, chemistry, Mermaid and other [Markdown conventions](docs/guides/commonmark.md).
- Native file dialogs, autosave, conflict handling and recoverable drafts, with file encoding,
  byte-order marks (BOM) and line endings preserved.
- Folder workspaces, document tabs, outlines, filename and content search, and offline spelling.
- On-demand translation through OpenAI-compatible, Ollama or DeepL providers. Reuse cached
  results in translation-only, side-by-side or interlinear reading layouts.
- Visual table editing, per-document typography and restricted local CSS imports.
- Export to self-contained HTML, PDF, PNG or JPEG, or present a document as slides.
  An optional local Pandoc 3 installation adds Word, EPUB and LaTeX source exports.
- Local command plugins with explicit permissions and reviewed document changes;
  manual folder and WebDAV sync.
- Light and dark themes, with English and Simplified Chinese interfaces.

See the [desktop guide](docs/guides/desktop.md), [plugin guide](docs/guides/plugins.md)
and [sync guide](docs/guides/sync.md) for controls and limits.

## Development

Use Node.js 24 (`.nvmrc`) and npm 11. Install dependencies and start the development app
from the repository root:

```sh
npm ci
npm run dev
```

Run checks and desktop tests:

```sh
npm run check
npm test
npm run build:app
npm run test:e2e
```

`npm run build` builds application assets and unsigned installers in `apps/desktop/release/`.
To package assets you have already built, use `npm run package:dir`. Headless Linux desktop
tests require Xvfb. Development and test profiles are separate from the installed app's profile.

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

[MIT](LICENSE). Third-party dependencies and assets retain their own licenses.
Packaged bundles include `THIRD-PARTY-NOTICES.txt`; see the
[asset guide](docs/development/assets.md#bundled-dependency-notices) for details.
