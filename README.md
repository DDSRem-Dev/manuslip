# Manuslip

**Write in Markdown. Read in any language.**

Manuslip is a local-first, cross-platform Markdown editor built around one idea: a document is not just text — it is something you **write**, **read**, and **share across languages**. It combines seamless WYSIWYG editing with a rendering pipeline that can present every document in three forms: raw source, rendered preview, and translated preview.

[English](./README.md) | [简体中文](./README.zh-CN.md)

![Status](https://img.shields.io/badge/status-early%20development-orange)
![License](https://img.shields.io/badge/license-MIT-blue)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey)

---

## Why Manuslip

Most Markdown editors force a choice: a raw code editor with a detached preview pane, or a polished closed-source writing app. Manuslip is built on three convictions:

1. **Seamless editing should be open.** Formatting renders in place as you type — headings, tables, math, images — while the underlying text stays plain, portable Markdown. No lock-in, no proprietary format.
2. **The platform should serve the writing.** Manuslip builds on Electron's mature ecosystem — consistent rendering, full Node.js integration, and deep library compatibility — so engineering effort goes into the document experience rather than the framework.
3. **Writing crosses languages.** Reading a document in another language should not require copy-pasting into a translator. Translation is a first-class rendering mode, applied at the document-structure level so layout, code, and math survive intact.

## Features

### Core editing

- **Seamless live preview** — Markdown renders inline as you type; syntax markers reveal themselves only at the cursor position. One surface, zero mode friction.
- **Source mode** — a full-power code editor view with syntax highlighting, multi-cursor, search & replace, and bracket/quote autoclose.
- **CommonMark + GFM** — tables, task lists, strikethrough, autolinks, footnotes, definition lists, sub/superscript, emoji shortcodes, YAML frontmatter.
- **Math** — inline `$...$` and display `$$...$$` equations rendered by MathJax, with mhchem chemistry support.
- **Diagrams** — Mermaid fenced blocks (flowchart, sequence, gantt, class, state, and more), plus legacy `sequence` and `flowchart` blocks.
- **Code highlighting** — editor-native CodeMirror language modes, consistent across source, preview, and export.
- **Rich table editing** — visual table operations, keyboard navigation, column alignment.
- **Smart paste** — HTML from the clipboard converts to clean Markdown automatically; paste images directly to a managed asset folder.
- **Spellcheck** — system-level spellchecking with per-language dictionaries.
- **Outline & navigation** — auto-generated table of contents, heading jump, per-document word/character count.

### Workspace

- **File tree sidebar** with folder workspaces, tabs, drag-and-drop open, and `.md` file association.
- **Global fuzzy search** across files, plus in-document search & replace.
- **Auto-save** with atomic writes and live file-watching — external changes reload safely.
- **Encoding auto-detection** — legacy non-UTF-8 files open correctly.
- **Themes** — light/dark built-ins, custom CSS, per-document typography settings.
- **Focus & typewriter modes** for distraction-free long-form writing.
- **Export** — self-contained HTML, PDF, and image natively; Word (.docx), EPUB, LaTeX and more via optional Pandoc integration; bilingual export for translated documents.

### The headline: three rendering modes

See the next section.

## Three Rendering Modes

Every document in Manuslip can be viewed through three lenses. Switch instantly with `Ctrl/Cmd + 1 / 2 / 3` or the status-bar control.

| Mode | What you see | Use it for |
|---|---|---|
| **1 · Source** | Raw Markdown, syntax-highlighted | Precision editing, diffs, copy-paste interop |
| **2 · Live Preview** | The document rendered in place, editable | Everyday writing — the default |
| **3 · Translated Preview** | The rendered document in a target language | Reading, reviewing, sharing across languages |

### Translated Preview in depth

Translation in Manuslip is **structural, not textual**:

- **AST-level translation.** The pipeline walks the document tree and translates only translatable nodes — paragraphs, headings, list items, table cells, blockquotes, captions. Code blocks, inline code, math, URLs, frontmatter, and Mermaid diagrams are passed through untouched.
- **Block-level caching.** Every block is hashed (source text + target language + provider). Unchanged blocks are never re-translated, so editing a 10,000-word document costs the translation of one paragraph, not the whole file.
- **Provider-agnostic.** Bring your own key: OpenAI-compatible endpoints, DeepL, Google Cloud Translation, LibreTranslate, or fully local models via Ollama. Glossary and formality controls are part of the provider interface.
- **Three reading layouts.** *Replace* (target language only), *side-by-side* (Live Preview and Translated Preview in synchronized panes), and *interlinear* (original line above translation).
- **On-demand and offline-friendly.** Translation runs when you ask for it; results persist in a local cache. No document leaves your machine unless you configure a cloud provider.

## Tech Stack

| Layer | Technology | Rationale |
|---|---|---|
| Desktop shell | **Electron** | Mature cross-platform framework — consistent Chromium rendering, full Node.js integration, and a deep ecosystem of tooling and libraries |
| Desktop tooling | **electron-vite + electron-builder** | HMR-based development; packaging, signing, and auto-update for all three platforms |
| Editor core | **CodeMirror 6** | Decoration-based rendering makes seamless inline preview possible; the modern, modular generation of the editor family this category of apps was built on |
| Incremental parse | **@lezer/markdown** | Reparses only edited ranges — the foundation of smooth typing on long documents |
| Document AST | **unified / micromark (mdast)** | Spec-compliant CommonMark + GFM AST; the single source of truth for preview, translation, and export |
| Markdown extensions | **remark-gfm · remark-frontmatter · js-yaml · emojilib** | Tables and task lists, YAML frontmatter parsing, emoji shortcode data |
| UI | **React 18 + TypeScript + Vite** | Fast HMR development, large ecosystem, explicit-performance patterns |
| State | **Zustand** | Minimal, observable stores without boilerplate |
| Math | **MathJax 4** | TeX → SVG rendering with mhchem support; identical output in preview and export |
| Diagrams | **Mermaid · js-sequence-diagrams · flowchart.js** | Mermaid blocks plus legacy `sequence` and `flowchart` fenced blocks |
| Code highlighting | **@lezer/highlight + @codemirror/legacy-modes** | Editor-native language modes — the same highlighting in source, preview, and export |
| HTML safety | **DOMPurify + strict CSP** | Defense in depth against untrusted markup |
| Clipboard conversion | **Turndown** | Turns pasted HTML into clean Markdown |
| Spellcheck | **Electron spellchecker (Hunspell)** | System-level dictionaries on all three platforms |
| Encoding | **iconv-lite + jschardet** | Detects and opens non-UTF-8 files correctly |
| Fuzzy search | **nucleo-matcher** | Instant matching over thousands of files |
| File watching | **chokidar** | Cross-platform file watching in the main process |
| Translation cache | **better-sqlite3** | Synchronous, reliable SQLite access from the main process |
| Settings | **electron-store** | JSON persistence in the user-data directory |
| UI localization | **i18next** | JSON locale resources — separate from the document-translation pipeline |
| Export | **printToPDF · capturePage · Pandoc (optional)** | Native HTML/PDF/image; DOCX, EPUB, LaTeX and more via a user-installed Pandoc |
| IPC | **contextBridge + ipcMain** | Sandboxed renderer behind a typed, minimal API surface |
| Package management | **npm workspaces** | Ships with Node.js; the default toolchain of the Electron ecosystem, including native-module rebuilds |
| Testing | **Vitest + Playwright** | Unit and end-to-end coverage, including Electron automation |
| Lint/format | **Biome** | One fast toolchain for TS/JS |

## Architecture

```
┌────────────────────────────────────────────────────────────────┐
│                Renderer process (Chromium + TypeScript)        │
│                                                                │
│   ┌───────────┐    ┌───────────────┐    ┌──────────────────┐   │
│   │  SOURCE   │    │ LIVE PREVIEW  │    │    TRANSLATED    │   │
│   │  raw .md  │ ⇄  │ inline WYSIWYG│ ⇄  │     PREVIEW      │   │
│   └─────┬─────┘    └───────┬───────┘    └────────┬─────────┘   │
│         └──────────────────┼─────────────────────┘             │
│                CodeMirror 6 editor core                        │
│        (Lezer incremental parse + decorations)                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │        Document Core — mdast AST (single truth)          │  │
│  └───────────────┬───────────────────────┬──────────────────┘  │
│         ┌────────┴────────┐     ┌─────────┴──────────┐         │
│         │  Render engine  │     │ Translation        │         │
│         │  (safe HTML)    │     │ pipeline (AST)     │         │
│         └─────────────────┘     └────────────────────┘         │
├────────────────────────────────────────────────────────────────┤
│        Preload (contextBridge) — typed, minimal IPC API        │
├────────────────────────────────────────────────────────────────┤
│                    Main process (Node.js)                      │
│   fs IO · atomic save · file watch · SQLite cache · export     │
│   native menus · window management · auto-update               │
└────────────────────────────────────────────────────────────────┘
```

**Design principles**

- **One AST, three views.** Source, Live Preview, and Translated Preview are projections of a single mdast document model — never three copies of the text drifting apart.
- **The editor never blocks.** Parsing, preview rendering, highlighting, and translation run off the critical path (incremental, debounced, or in workers).
- **Strict process boundaries.** The renderer is sandboxed; all file-system and OS access flows through a typed contextBridge API in the main process.
- **Everything heavy is lazy and cached.** Mermaid, MathJax, legacy language modes, and translation results load once and memoize by content hash.

### Parsing architecture

Manuslip uses a **dual-parser scheme** — two parsers with two distinct jobs:

- **Lezer** (`@lezer/markdown`) lives inside the editor core. It reparses incrementally on every keystroke and drives what you feel: decorations, highlighting, folding, live-preview widgets. Its syntax tree also yields top-level block boundaries for free.
- **micromark** runs per dirty block only, producing spec-faithful mdast for rendering, translation, and export. Fragments splice into a persistent document AST with source offsets.

Between them sits the layer that makes performance a non-issue: **block-level caching keyed by one content hash**.

```
keystroke
  ▼
Lezer reparse (incremental) ─────► decorations · highlighting · folding
  ▼
block splitter (Lezer top level) ─► block { range, source slice }
  ▼
hash = xxhash64(slice)            ← one hash, three caches
  ├─► parse cache        ─► mdast fragment (micromark, dirty blocks only)
  ├─► render cache       ─► sanitized HTML per block
  └─► translation cache  ─► translated text per block
  ▼
persistent document AST: [ (hash, fragment, range), ... ]
unchanged blocks keep identity → render & translation reuse for free
```

- **One hash, three caches.** The same xxhash of a block's source serves the parse cache, the render cache, and the translation cache. Editing one paragraph costs one hash pass, one micromark call on ~1 KB, and one DOM patch — regardless of document size.
- **Structural sharing.** The document AST is an array of immutable fragments; unchanged blocks keep object identity, so downstream consumers (rendered HTML, translations, component props) are reused by reference, not re-diffed.
- **Workers only where they pay.** Single-block edits parse synchronously on the main thread (microseconds, no IPC). Bulk events — opening a large file, big pastes, replace-all — fan independent blocks out to a worker pool.
- **Correctness is gated.** The CommonMark spec suite and GFM tests run in CI; a cache that serves wrong output fast is still wrong.
- **Positions are first-class.** Every fragment keeps its source offsets — the foundation for scroll-sync, click-to-source, and block-aligned translated preview.

### Translation pipeline

```
edit ──► reparse changed ranges (Lezer)
     ──► diff mdast blocks
     ──► hash blocks (text + lang + provider)
     ──► cache hit? ── yes ──► reuse translation
                │
                no
                ▼
     batch translatable nodes ──► provider (stream)
     ──► persist to SQLite cache ──► render progressively
```

## Responsiveness

Manuslip's responsiveness comes from architecture rather than micro-optimization:

| Goal | Mechanism |
|---|---|
| Smooth typing on long documents | Lezer incremental reparse; block-level parse/render caches keyed by content hash; decorations render only viewport ranges |
| Instant mode switching | All three views derive from one cached AST — no reparse on switch |
| Reasonable startup and memory use | Heavy modules (Mermaid, MathJax, legacy language modes) are code-split and lazy-loaded |
| No repeated translation work | Content-hash block cache persists across sessions |
| Safe saves | Atomic write-then-rename in the main process; debounced watcher for external changes |

## Project Structure

```
manuslip/
├─ apps/
│  └─ desktop/          # Electron app — main process, preload, window, menus
├─ packages/
│  ├─ core/             # mdast document model, block hashing, document ops
│  ├─ editor/           # CodeMirror 6 setup, keymaps, live-preview decorations
│  ├─ renderer/         # mdast → sanitized HTML (MathJax, Mermaid, CM language modes)
│  ├─ translate/        # provider interface, block cache, glossary, batching
│  └─ ui/               # shared components, themes, design tokens
├─ package.json         # npm workspaces root
└─ README.md
```

## Getting Started

**Prerequisites:** Node.js 24 LTS (pinned in `.nvmrc`) with the bundled npm 11.

```bash
git clone https://github.com/<your-org>/manuslip.git
cd manuslip
npm install        # native modules rebuild against Electron automatically

# Run in development (HMR renderer + live main/preload reload)
npm run dev

# Type-check, lint, test
npm run check
npm test

# Production build → installers in apps/desktop/release
npm run build
```

## Roadmap

- **M1 — Editor core.** Source mode + Live Preview (CommonMark, GFM, tables, MathJax, code highlighting), file open/save, auto-save.
- **M2 — Workspace.** Sidebar file tree, tabs, outline, global search, themes, spellcheck, images/asset management, HTML/PDF export.
- **M3 — Translated Preview.** AST translation pipeline, block cache, provider interface (OpenAI-compatible + DeepL + local), side-by-side and interlinear layouts, bilingual export.
- **M4 — Extensibility & polish.** Plugin API, custom CSS themes, Pandoc export profiles, focus/typewriter mode, presentation mode, sync adapters.

## Contributing

Manuslip is in early development — the best time to shape it. Bug reports, design feedback, provider integrations, and translations of the UI are all welcome. Please open an issue before large pull requests so we can align on direction. See [CONTRIBUTING.md](./CONTRIBUTING.md) for setup, conventions, and review expectations; report vulnerabilities privately as described in [SECURITY.md](./SECURITY.md).

1. Fork the repo and create a feature branch.
2. `npm install && npm run dev` to run the app.
3. Keep `npm run check` and `npm test` green.
4. Open a PR with a clear description of the change.

## Acknowledgements

Manuslip stands on the shoulders of outstanding open-source projects: [Electron](https://www.electronjs.org), [CodeMirror](https://codemirror.net), [Lezer](https://lezer.codemirror.net), [unified](https://unifiedjs.com) / [micromark](https://github.com/micromark/micromark), [MathJax](https://www.mathjax.org), [Mermaid](https://mermaid.js.org), [js-sequence-diagrams](https://bramp.github.io/js-sequence-diagrams/), [flowchart.js](https://flowchart.js.org), [DOMPurify](https://github.com/cure53/DOMPurify), [Turndown](https://github.com/mixmark-io/turndown), [i18next](https://www.i18next.com), [chokidar](https://github.com/paulmillr/chokidar), [better-sqlite3](https://github.com/WiseLibs/better-sqlite3), [electron-store](https://github.com/sindresorhus/electron-store), [electron-vite](https://electron-vite.org), [electron-builder](https://www.electron.build), [nucleo](https://github.com/helix-editor/nucleo), and many more.

## License

[MIT](./LICENSE) © The Manuslip Authors
