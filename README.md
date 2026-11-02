# Manuslip

<img src="apps/desktop/build/icon.svg" alt="Manuslip" width="96" height="96" />

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

**Implementation status:** the desktop app now opens, edits, and safely saves Markdown files.
Manuslip syntax also supports `~subscript~`, `^superscript^` (without spaces) and offline
`:smile:` shortcodes, plus definition lists (`Term` followed by `: Description`) in Live Preview, translated reading and export; `~~strikethrough~~`
and strict CommonMark remain available. See the [syntax decisions](./docs/adr/006-extended-markdown.md).
It includes a CodeMirror source editor, native file dialogs, encoding/BOM/newline preservation,
auto-save, external-change conflicts, close protection, and recoverable drafts, alongside the
secure shell and English/Chinese preferences. Windows build and packaged flows are tested;
cross-platform acceptance remains open. Live Preview now adds in-place formatting, tables,
highlighted code, math/chemistry, safe HTML opt-in and per-document remote-image permission.
Multiple document tabs preserve selection, undo history and scroll; reopening a file activates
its existing tab, and cancelling window close retains every draft. Folder workspaces now include
a lazy file browser, recent folders and automatic reopening of named tabs; unavailable files
can be retried or removed from the session. Markdown/text file drops and OS launch requests
also open tabs while retaining existing drafts. Navigation includes heading jumps, word/character
counts, fuzzy filename lookup (`Ctrl/Cmd+P`) and cancellable saved-file text search
(`Ctrl/Cmd+Shift+F`). Spellcheck is an optional offline setting: English (US) on Windows/Linux,
system languages on macOS. Plain-text and image paste, local raster assets, isolated Mermaid
diagrams, and self-contained HTML/PDF export are implemented. Translation preferences now
configure OpenAI-compatible, Ollama or DeepL endpoints, session/OS-protected keys, and cache
clearing. Translated preview (`Ctrl/Cmd+3`) now provides target-language selection, Translate,
Cancel, Retry failed, offline cache loading and an explicit stale/refresh notice after edits.
It preserves the editable source and restores protected code, math, diagrams and links in a
read-only copy. Translation-only, side-by-side and interlinear layouts share stable block anchors.
Reading HTML/PDF export captures the selected language, layout and completed translations;
stale or incomplete copies require an explicit choice. DeepL adds explicit language discovery,
XML placeholder protection, native formality and existing glossary IDs. Google Cloud and
LibreTranslate remain optional follow-up adapters.
Document actions also provides session focus and typewriter modes. Focus keeps Save, status
and a visible Exit while giving the document the window; Escape returns to the workspace.
Typewriter centers the primary caret as you write or move it, while allowing manual scrolling.
Choose Edit table beside a Live table, or in Document actions with the caret inside a table.
The dialog stages cell, row, column and alignment changes, then applies them as one undoable
source edit. Cancel leaves the document unchanged. See [table editing](./docs/adr/007-visual-tables.md)
for keyboard navigation, source preservation and visual-editor limits.
Document appearance adds per-document fonts, text size, line spacing and writing width, plus
explicit local CSS import for Live Preview, reading and HTML/PDF export. Reset and Source stay
available if a style makes content hard to read. Named documents retain appearance after restart;
see [appearance and supported CSS](./docs/adr/008-document-appearance.md).
Present document opens a captured slide deck with keyboard navigation and a visible Exit.
Export PNG/JPEG saves the complete source or selected reading copy, including its appearance,
images, formulas and diagrams. Oversized images fail with a useful message; HTML/PDF remain
available. See [slides, controls and image limits](./docs/adr/009-presentation-image-export.md).
Export with Pandoc adds Word (.docx), EPUB and LaTeX source with images (.zip).
Choose a trusted local Pandoc 3 application, then Standard or Numbered headings + contents.
Text, tables and notes remain editable; formulas and diagrams become images. Each format
uses its own styles. LaTeX compilation requires a separate Unicode-capable LaTeX installation.
The selected source or reading copy stays unchanged. Pandoc is optional and is not bundled;
see [tool selection, profiles and limits](./docs/adr/010-optional-pandoc.md).
Preferences → Plugins installs local command bundles with explicit permission review,
enable/disable, permission changes and removal. Document actions → Plugin commands runs
an isolated command on captured source; proposed edits require review and apply as one
undoable change. File and network access require grants. See the [API and working example](./docs/guides/plugins.md).
Document actions → Sync connects a saved document to one folder file or WebDAV URL.
Review both versions before sending, receiving or keeping both. Offline edits remain local;
explicit retry, durable recovery export and disconnect preserve your writing. See [sync](./docs/guides/sync.md).
Opening Preferences, translated preview or changing layout sends no provider request. The
feature list below describes the intended product. See
[validation and remaining work](./docs/validation/implementation-history.md).

### Core editing

- **Seamless live preview** — Markdown renders inline as you type; syntax markers reveal themselves only at the cursor position. One surface, zero mode friction.
- **Source mode** — a full-power code editor view with syntax colors, multi-cursor, search & replace, and literal text input.
- **CommonMark + GFM** — tables, task lists, strikethrough, autolinks, footnotes, definition lists, sub/superscript, emoji shortcodes, YAML frontmatter.
- **Math** — inline `$...$` and display `$$...$$` equations rendered by MathJax, with mhchem chemistry support.
- **Diagrams** — Mermaid fenced blocks (flowchart, sequence, gantt, class, state, and more), plus legacy `sequence` and `flowchart` blocks.
- **Code highlighting** — editor-native CodeMirror language modes, consistent across source, preview, and export.
- **Rich table editing** — visual table operations, keyboard navigation, column alignment.
- **Plain-text paste** — clipboard text stays literal; image-only paste imports to a managed asset folder.
- **Spellcheck** — system-level spellchecking with per-language dictionaries.
- **Outline & navigation** — auto-generated table of contents, heading jump, per-document word/character count.

### Workspace

- **File tree sidebar** with folder workspaces, tabs, drag-and-drop open, and `.md` file association.
- **Global fuzzy search** across files, plus in-document search & replace.
- **Auto-save** with atomic writes and live file-watching — external changes reload safely.
- **Encoding auto-detection** — legacy non-UTF-8 files open correctly.
- **Themes** — light/dark built-ins, custom CSS, per-document typography settings.
- **Focus & typewriter modes** for distraction-free long-form writing.
- **Export** — self-contained HTML, PDF, PNG and JPEG natively; Word (.docx), EPUB and LaTeX source with images via optional Pandoc; bilingual export for translated documents.

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
- **Block-level caching.** Every block is keyed by source text, target language, provider, model, glossary/formality, and prompt/extractor schema version. Unchanged units are never re-translated, so editing one paragraph in a 10,000-word document re-translates only the changed units.
- **Provider-agnostic.** Bring your own key: OpenAI-compatible endpoints, DeepL, Google Cloud Translation, LibreTranslate, or fully local models via Ollama. Glossary and formality controls are part of the provider interface.
- **Three reading layouts.** *Replace* (target language only), *side-by-side* (aligned original/translation blocks in one scroll surface), and *interlinear* (each original block followed by its translation).
- **On-demand and offline-friendly.** Translation runs when you ask for it; results persist in a local cache. No document leaves your machine unless you configure a cloud provider.

## Tech Stack

| Layer | Technology | Rationale |
|---|---|---|
| Desktop shell | **Electron 45** | Latest supported Electron (Chromium 156, Node 24.22) — consistent cross-platform rendering, native modules, `printToPDF`, and spellcheck |
| Desktop tooling | **electron-vite 6 + electron-builder 26** | Vite 8 HMR; packaging, signing, and auto-update for all three platforms |
| Editor core | **CodeMirror 6** | Decoration-based rendering makes seamless inline preview possible; CM6 is the modern, maintained generation of the editor |
| Incremental parse | **@lezer/markdown 1.8** | Editor-time incremental parse: block boundaries, decorations, folding, and highlighting — not a semantic AST |
| Document AST | **unified 11 / micromark 4 (mdast)** | Spec-compliant CommonMark + GFM AST; the semantic source of truth for preview, translation, and export |
| Markdown extensions | **remark-gfm · remark-frontmatter · remark-math · definition-list utilities · gemoji** | Tables, task lists, frontmatter, math, positioned definition lists and offline emoji shortcode data |
| UI | **React 19 + TypeScript 7 + Vite 8** | Fast HMR development, large ecosystem, explicit-performance patterns |
| State | **Zustand 5** | Minimal, observable UI stores; the document itself lives in CodeMirror's `EditorState` |
| Math | **MathJax 4.1** | TeX → SVG with line breaking and accessibility; identical output in preview and export; enable mhchem explicitly |
| Diagrams | **Mermaid 12 · isolated legacy conversion** | Mermaid blocks plus a documented subset of legacy `sequence` and `flowchart` fences; dagre/classic rendering |
| Code highlighting | **@lezer/highlight + @codemirror/legacy-modes** | Editor-native language modes — the same highlighting in source, preview, and export |
| HTML safety | **DOMPurify 3.4 + strict CSP** | Sanitize Markdown-derived HTML before MathJax/Mermaid render; strict CSP and a sandboxed renderer |
| HTML conversion utility | **Turndown 7 + GFM plugin** | Local sanitized HTML → Markdown conversion; ordinary paste preserves plain text |
| Spellcheck | **Electron built-in spellchecker (Hunspell on Windows/Linux)** | System-level dictionaries on all three platforms; self-host the dictionary URL for offline use |
| Encoding | **iconv-lite 0.6 + jschardet 3.1** | Detects and opens non-UTF-8 files correctly |
| Fuzzy search | **fuzzysort + @vscode/ripgrep** | Instant file-name matching; ripgrep for full-text search across large workspaces |
| File watching | **@parcel/watcher** | Native recursive watching for large vaults; debounced reload on external changes |
| Translation cache | **node:sqlite** | Built-in SQLite in Electron's Node runtime; no native rebuild; keyed by block hash |
| Settings | **electron-store 12** | Typed JSON persistence in the user-data directory; secrets use Electron `safeStorage` |
| UI localization | **i18next 26** | JSON locale resources — separate from the document-translation pipeline |
| Export | **printToPDF · capturePage · Pandoc (optional, external)** | Native HTML/PDF/image; DOCX, EPUB, LaTeX and more via a user-installed Pandoc |
| IPC | **contextBridge + ipcMain** | Sandboxed renderer behind a typed, minimal API surface |
| Package management | **npm workspaces** | Ships with Node.js; the default toolchain of the Electron ecosystem, including native-module rebuilds |
| Testing | **Vitest 5 + Playwright 1.64** | Unit and end-to-end coverage, including Electron automation |
| Lint/format | **Biome 2** | One fast toolchain for TS/JS |

**Stack definitions**

- **Live document** — CodeMirror's `Text`/`EditorState`. It is the only source of truth; every view is derived from it.
- **Editor-time parse** — the Lezer tree. It owns block boundaries, decorations, folding, and highlighting. It is not a semantic AST.
- **Semantic parse** — unified/remark parses the whole document into position-bearing mdast in a worker. Whole-document context preserves reference links and footnotes.
- **Derived caches** — bounded semantic/render snapshots use source plus parser/render configuration. Block occurrence IDs follow unchanged mapped ranges; duplicate content has distinct identities. Translation has its own output-affecting cache key.
- **Live preview** — CM6 decorations and widgets that reveal Markdown markers at the cursor and render everything else. Inline decorations are viewport-scoped; block widgets are state-scoped and cached per block.

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
│  │        Document Core — mdast semantic AST (derived)      │  │
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

- **One source, three views.** Source, Live Preview, and Translated Preview are projections of a single Markdown document — never three copies of the text drifting apart.
- **The editor never blocks.** Parsing, preview rendering, highlighting, and translation run off the critical path (incremental, debounced, or in workers).
- **Strict process boundaries.** The renderer is sandboxed; all file-system and OS access flows through a typed contextBridge API in the main process.
- **Everything heavy is lazy and cached.** Mermaid, MathJax, legacy language modes, and translation results load once and memoize by content hash.

### Parsing architecture

Lezer incrementally parses editor syntax for highlighting and viewport decorations. A separate unified/remark worker parses the **whole document**, retaining source positions and global definitions for preview, future translation, and export. Lezer boundaries never splice independent semantic fragments.

```
edit → CodeMirror state + incremental Lezer syntax
       └→ debounce (150 ms idle / 1 s maximum publication delay)
          → one running semantic parse + one newest pending request
          → whole-document mdast + render projection
          → validate generation, revision and render configuration
          → mapped occurrence IDs + sanitized viewport widgets
```

Source mode opens without waiting for semantic work. Mode changes reconfigure the same editor state and preserve text, selection, scroll anchor, and undo history. Content changes invalidate old widgets immediately; obsolete worker results cannot update the current document.

The semantic worker has a 5 s watchdog and at most three automatic restarts in 60 s, followed by a visible Source fallback and manual Retry. Preview is limited to 2 MiB or 50,000 blocks; worker messages are capped at 8 MiB. The worker snapshot cache is limited to 16 MiB, separately from the renderer's 64 MiB derived-data budget. These are enforced resource limits; performance acceptance targets still require the measurements in [ADR 002](./docs/adr/002-implementation-plan.md).

Rendering resolves references against the complete root before selecting widget fragments. DOMPurify sanitizes every HTML/SVG DOM sink. Raw HTML is escaped by default; its explicit opt-in still sanitizes output. Images cannot load remote URLs implicitly. Block replacements come directly from a CodeMirror StateField, while inline decorations visit visible ranges only.

Completed emphasis, strikethrough, inline code, heading and quote markers stay hidden in Live
Preview while typing or selecting text. Formatting applies to content between parsed markers;
cursor movement skips hidden marker ranges. Source mode preserves every original character.

### Clipboard and local images — implemented

Typing inserts literal text in Source and Live Preview, including brackets, quotes, tabs
and newlines. Paste uses the clipboard's plain text in both modes, including when HTML
or an image representation is also available. Ctrl/⌘ V, Ctrl/⌘ Shift V and Edit → Paste
share this behavior; selected text is replaced literally, including URL text.
Large plain-text pastes are prepared in short tasks.
Use Cancel paste or Escape before insertion; a completed paste remains one undo step.
Replace all also prepares changes before one undoable edit. Cancel replacement or Escape
discards pending changes; editing or switching tabs cancels them too. A five-second deadline
leaves the text unchanged on timeout. Resource bounds are documented in ADR 002.

Native image paste captures a PNG, asks for Save As for an untitled document, and creates
an exclusive `assets/pasted-<UUID>.png` beside the document with a relative Markdown link.
Cancelling Save As leaves the document unchanged. Undo, source deletion, and closing a tab
retain image files. Relative PNG/JPEG/GIF/WebP images use the controlled asset protocol,
independently of remote-image permission; missing images offer retry. Paths stay within
the captured workspace or, for direct opens, the document's parent. Limits and validation
are recorded in [ADR 002](./docs/adr/002-implementation-plan.md) and
[the validation record](./docs/validation/implementation-history.md).

### Mermaid diagrams — implemented

Mermaid fences render on demand in a separate sandboxed process. Flowcharts, sequence,
class, state, entity, pie and Gantt diagrams have integration coverage. Diagrams follow
the selected theme; source and undo history stay intact. Invalid, oversized or timed-out
diagrams retain their source and offer Retry. A main-process watchdog terminates a hung
diagram without blocking editing or saving. Document configuration directives and
frontmatter cannot override the rendering policy. Legacy `sequence`/`seq` and `flowchart`/`flow`
fences support the [documented subset](./docs/adr/006-extended-markdown.md), including participants,
messages, notes, standard flow nodes and condition branches. Unsupported syntax retains its
complete source with editing guidance. See [validation](./docs/validation/implementation-history.md) for limits and tested scope.

### HTML and PDF export — implemented

Open **Document actions** and choose **Export HTML…** or **Export PDF…**, or use the File menu.
**Save** stays visible in the document header. **Document actions** also holds New, Open,
Save As, Save a copy, and the opt-in HTML and remote-image preview settings.
Export captures the source when clicked, including unsaved edits. You can keep editing;
the completion message identifies when those later edits are absent from the copy.
HTML embeds allowed raster images and sanitized math/diagram SVG. PDF uses A4 paper with
20 mm margins and waits for fonts, images, math and diagrams in a separate print process.
Both formats use a fixed light paper style; code is preserved without syntax coloring.

In Translated preview, choose **Export reading HTML…** or **Export reading PDF…** to capture
that copy's language, layout and completed translations. Side-by-side rows align whole blocks,
including lists and tables; interlinear pairs stack them. Small screens stack side-by-side rows.
The copy stays anchored when translation or resource heights change. If the source has changed,
or some prose remains untranslated, confirm **Export this copy** to retain the captured source
and use original text for missing units, or Cancel to finish/refresh first. Later translation
results and edits do not change that capture. Source/Live Preview exports capture current source.

Local images use the document's captured folder/workspace grant. Remote images require the
open document's permission. Missing, blocked or invalid assets fail the whole export and
retain an earlier destination. Cancel stops the export without changing the source; native
file publication already in progress can finish. Export allows one job per window, 60 seconds
after destination selection, 2 MiB source, 500 raster images and 2,000 PDF pages. Detailed
resource limits and outstanding platform checks are in [VALIDATION.md](./docs/validation/implementation-history.md).

### Translation pipeline — OpenAI-compatible, Ollama and DeepL

In Translated preview, choose the target language and **Translate**. Open **Reading options**
for the layout, **Load cached**, translation settings and help. Cancellation, retry, progress
and errors stay beside the reading copy; changing modes closes the reading options.

The pure [translation core](./docs/architecture/translation.md) now extracts canonical prose units,
keeps protected values local, validates placeholders, reconstructs text-only AST output, and
computes provider/settings-aware cache keys. Its offline fixtures include all 652 CommonMark
examples. OpenAI-compatible, Ollama and DeepL endpoints, credentials, SQLite cache, and three reading
layouts are integrated. Translate, Refresh translation and Retry failed explicitly allow provider
requests; Load cached stays offline. Opening a file, editing or changing layout never translates
automatically. Protected code, formulas, diagrams, URLs and raw HTML stay local. For DeepL, save
the full translation endpoint and set an API key, then choose Load supported languages in
Preferences → Translation. This authenticated metadata request sends no document text; Translate
also checks support on a cache miss. API Free uses `api-free.deepl.com`, API Pro uses
`api.deepl.com`. Native options follow the selected language pair; glossary IDs refer to existing
DeepL glossaries and require an explicit source. No remote glossary is created. Metadata is kept
in memory for 15 minutes; Load cached works after restart without a key or provider connection.
Optional adapters and the wider performance/platform acceptance gates remain open.

```
edit ──► current whole-document mdast snapshot (semantic worker)
     ──► extract eligible units and mapped occurrence ranges
     ──► unit key (payload + provider/settings + reconstruction schema)
     ──► cache hit? ── yes ──► reuse translation
                │
                no
                ▼
     bounded prose units ──► provider (complete validated response)
     ──► persist to SQLite cache ──► render progressively
```

## Responsiveness

Manuslip's responsiveness comes from architecture rather than micro-optimization:

| Goal | Mechanism |
|---|---|
| Smooth typing on long documents | Lezer incremental reparse; debounced whole-document semantic worker with bounded queue/cache; viewport inline decorations |
| Responsive mode switching | Source stays editable; reuse a current settled snapshot or show pending semantics while the latest revision is parsed |
| Reasonable startup and memory use | Heavy modules (Mermaid, MathJax, legacy language modes) are code-split and lazy-loaded |
| No repeated translation work | Content-hash block cache persists across sessions |
| Safe saves | Atomic write-then-rename in the main process; debounced watcher for external changes |

## Project Structure

```
manuslip/
├─ apps/
│  └─ desktop/          # Electron app — main process, preload, window, menus
├─ packages/
│  ├─ core/             # Markdown document model, block hashing, mdast projection
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
npm ci             # installs the pinned Electron binary and rebuilds native modules

# Run in development (HMR renderer + live main/preload reload)
npm run dev

# Type-check, lint, test
npm run check
npm test

# Production build → installers in apps/desktop/release
npm run build

# Run Electron launch tests against the existing build (no browser download needed)
npm run test:e2e
```

`npm run build:app` builds application assets without installers. `npm run package:dir`
packages those existing assets into an unpacked application. Builds are unsigned and never
publish automatically. Linux Electron tests need a display (`xvfb-run --auto-servernum npm
run test:e2e` in CI). Development uses a separate preferences directory from installed builds.
Windows `npm run test:installer` verifies the installed application and restores installer
state after uninstalling. Separate signing/update metadata hooks are available through
`npm run package:release -- --plan`; see [building and reviewing a release](./docs/development/distribution.md).
Selected dependency versions and runtime details are in [DEPENDENCIES.md](./docs/development/dependencies.md).
`npm run test:performance` runs the separate packaged performance gates. It currently exposes
unresolved nested-document capacity; methods and focused profiling commands are in
[docs/testing/benchmarks.md](./docs/testing/benchmarks.md).

## Roadmap

For implementation order, architecture decisions, and acceptance criteria, see the
[implementation plan](./docs/adr/002-implementation-plan.md).

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

Manuslip stands on the shoulders of outstanding open-source projects: [Electron](https://www.electronjs.org), [CodeMirror](https://codemirror.net), [Lezer](https://lezer.codemirror.net), [unified](https://unifiedjs.com) / [micromark](https://github.com/micromark/micromark), [MathJax](https://www.mathjax.org), [Mermaid](https://mermaid.js.org), [js-sequence-diagrams](https://bramp.github.io/js-sequence-diagrams/), [flowchart.js](https://flowchart.js.org), [DOMPurify](https://github.com/cure53/DOMPurify), [Turndown](https://github.com/mixmark-io/turndown), [i18next](https://www.i18next.com), [fuzzysort](https://github.com/farzher/fuzzysort), [ripgrep](https://github.com/BurntSushi/ripgrep), [@parcel/watcher](https://github.com/parcel-bundler/watcher), [node:sqlite](https://nodejs.org/api/sqlite.html), [electron-store](https://github.com/sindresorhus/electron-store), [electron-vite](https://electron-vite.org), [electron-builder](https://www.electron.build), and many more.

## License

[MIT](./LICENSE) © The Manuslip Authors
