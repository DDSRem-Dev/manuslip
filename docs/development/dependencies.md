# Dependency compatibility

P0 dependencies were checked against npm metadata on 2026-10-23. Exact versions are
committed in `package.json` and `package-lock.json`; use `npm ci` to reproduce them.
Only the desktop workspace is introduced in P0. Feature packages are added when consumed.
M1a introduces `packages/editor`, consumed by the desktop source editor.
M1b introduces `packages/core` and `packages/renderer`, consumed by the semantic worker and
Live Preview. Worker resolution selects pure worker exports (the entity decoder's default
browser export requires a DOM); the installed packaged worker is exercised by Electron E2E.

| Component | Selected | Compatibility |
| --- | --- | --- |
| Development Node / npm | 24.x / 11.x | `.nvmrc` and root engines; local checks use Node 24.18.1 / npm 11.16.0 |
| Electron | 45.0.0 | Requires development Node >=22.12; launched runtime: Node 24.22.0, Chromium 156.0.8078.48 |
| electron-vite | 6.0.0 | Node ^20.19 or >=22.12; accepts Vite ^6, ^7, ^8 |
| Vite / React plugin | 8.3.5 / 6.1.2 | Node ^20.19 or >=22.12; React Fast Refresh in development |
| electron-builder | 26.15.3 | Node >=14; packages the exact binary installed by the Electron package |
| TypeScript | 7.0.2 | Strict, no emit, DOM and Node types; process boundaries use type-only imports |
| Babel parser | 8.0.7 | Tooling-only AST import-boundary checks; TypeScript 7 no longer exports its legacy compiler API |
| React / React DOM | 19.3.1 | Matching runtime versions; types 19.3.0 |
| i18next | 26.5.6 | Bundled English/Chinese resources; no runtime network loader |
| electron-store | 12.0.0 | Node >=22; used only by main for versioned preferences |
| CodeMirror | state 6.7.6, view 6.43.15, commands 6.11.1 | One immutable editor body/history per session; incremental UTF-8 byte accounting |
| CodeMirror Markdown / language | 6.5.2 / 6.13.1 | GFM source syntax; language-data 6.5.2 loads fenced-code languages locally on demand |
| CodeMirror search / autocomplete | 6.7.2 / 6.20.4 | Source find/replace and language support; automatic input expansion is disabled |
| Lezer highlighting | 1.2.5 | Theme-aware source and lazy code-widget colors |
| Unified / remark | 11.0.5 / parse 11.0.0 | Whole-document, position-bearing mdast in a terminable semantic worker |
| Remark extensions | GFM 4.0.1, frontmatter 5.0.0, math 6.0.0 | Tables/tasks/references, preserved YAML/TOML and TeX nodes |
| mdast-util-to-hast / hast-util-to-html | 13.2.1 / 9.0.5 | Shared full-root render projection with global reference resolution |
| DOMPurify | 3.4.17 | Final HTML/SVG DOM admission; explicit element, attribute and URL policy |
| MathJax / TeX SVG font | @mathjax/src 4.1.3 / @mathjax/mathjax-tex-font 4.1.3 | Lazy isolated worker, locally bundled font paths, mhchem; no network font loader |
| Mermaid | 12.2.0 | Lazy DOM renderer in a separate sandboxed Electron process/session; dagre/classic, strict security, document configuration rejected, bounded main-owned queue/watchdog |
| hast-util-from-html | 2.0.3 (test only) | Normalized HTML comparison for all 652 official CommonMark 0.31.2 examples |
| Zustand | 5.0.16 | Renderer metadata/status store; document bodies remain in CodeMirror |
| iconv-lite / jschardet | 0.7.3 / 4.0.0 | Main-only byte conversion and detection; uncertain legacy encodings require explicit confirmation |
| @vscode/ripgrep | 1.18.0 | Per-platform optional native package, ripgrep 15.0.0; direct runtime-architecture resolution, unpacked from ASAR, no PATH/config/shell lookup |
| fuzzysort | 4.0.2 | Bounded filename/path matching over up to 10,000 ripgrep-listed candidates |
| Offline Hunspell dictionary | Electron 45.0.0 en-US-10-2.bdic | Exact release artifact, 451,982 bytes; size/SHA-256 checked; source/checksums/notices preserved in desktop vendor directory |
| Turndown / GFM plugin | 7.2.4 / 1.0.2 | HTML clipboard conversion in a terminable Node worker; local DOM parser, no browser resource loading; active HTML removed and URLs constrained |
| image-size | 2.0.4 | Header-only dimensions for local rasters and native PNG captures before browser decoding; no file/URL API used |
| pdf-lib | 1.17.1 | Parses generated PDFs in a terminable Node worker to enforce the page cap; packaged runtime dependency, no network |
| Vitest | 5.0.5 | Supports Node ^22.12, ^24, >=26 |
| Playwright test | 1.64.1 | Electron automation; Chromium browser download is unnecessary |
| Biome | 2.6.2 | Existing schema validated by this binary; lint and format gates enabled |

Electron 45's npm package downloads its executable explicitly via `install-electron`.
The root postinstall runs this before Electron dependency rebuilding. The package's bundled
checksums remain enabled even when an operator supplies `ELECTRON_MIRROR`.
Packaging reuses that installed executable through `electronDist`; it does not download a
different runtime. There are no application native modules to rebuild in P0.

Semantic transport uses native UTF-8 encoding/decoding, JSON and ArrayBuffer transfer; no
compression/serialization dependency was added. A conservative marker-absence check skips
GFM tokenizers for documents with no possible GFM syntax, retaining math/frontmatter and
ordinary list-item properties. Full-root equality against the complete installed GFM grammar
is checked for all 652 CommonMark inputs plus extension/edit cases. Re-run and review this
equivalence suite whenever remark/micromark/GFM dependencies change; do not assume new syntax
has the same marker requirements. The worker still parses the complete document on each request.

Preferences use main-owned electron-store with `schemaVersion: 1` and serialized writes.
Failed writes leave application state unchanged. Invalid data is backed up before reset;
future-schema data stays read-only and receives a timestamped backup before opening.
The store is never instantiated against future data, so defaults cannot rewrite it.
Translation configuration is separate private atomic JSON. Session keys stay in main-process
memory; optional persistent keys use Electron 45's asynchronous safeStorage API and are never
returned through IPC. Unavailable/locked key stores and Linux basic_text refuse persistence.
No extra keychain/native SQLite dependency is added. Electron's actual Node 24.22.0 SQLite
3.53.4 passed a Unicode transaction before adapter implementation; the dedicated cache worker
uses node:sqlite DatabaseSync with parameterized SQL, migrations and bounded disk accounting.
Provider adapters use Node HTTP/HTTPS and the configured full endpoint; there is no
OpenAI/Ollama/DeepL SDK dependency or model download. The OpenAI-compatible endpoint must support
Chat Completions with max_completion_tokens and temperature (the current adapter's defaults
are 8,192 and 0). Adapter compatibility with every hosted model is not claimed.

DeepL uses native authentication, XML v2, and bounded dynamic stable-language metadata;
formality and existing glossary IDs are native options. Its XML codec has no DOM/XML dependency
and accepts only synthetic root/format/atom tags plus standard character entities. Provider
discovery and translation share the existing bounded native transport. The implementation was
checked against the official [translation API](https://developers.deepl.com/api-reference/translate/request-translation),
[XML guidance](https://developers.deepl.com/docs/translate/translating-xml), and
[language metadata](https://developers.deepl.com/docs/languages/using-the-languages-api) on
2026-10-24. Tests use loopback fakes and dummy keys; real account compatibility is not claimed.

Replace all adds no dependency. The pure `@manuslip/editor/replace` subpath uses the installed
CodeMirror SearchQuery public cursor and EditorState/ChangeSet. Replacement/capture semantics
are checked against the independent public native replaceAll command, including escaped text,
Unicode precision, zero-width matches and optional captures. The native panel's
`.cm-search button[name=replaceAll]` is a small version-sensitive capture adapter: rerun both
oracle tests and packaged mouse/keyboard activation after upgrading search. Matching stays
in a disposable browser worker; no main-process authority or network access is added.

Translated preview adds no dependency. A lazy browser worker uses the existing shared semantic,
translation and renderer packages for extraction, hashing, reconstruction and projection. It
receives a settled whole AST rather than parsing Markdown again. The read-only DOM surface reuses
the existing sanitizer, image capabilities, math worker and isolated diagram service; it shares
their mounted-markup limits with Live Preview.

Bilingual layouts and translated export add no runtime dependency. The shared whole-root renderer
pairs logical blocks; a ResizeObserver preserves block offsets within one native scroller. The
export worker re-extracts and validates captured prose outputs using the existing translation core.
The DOM sanitizer scopes each copy's IDs, fragment links and accessibility references after its
named-property policy, including optional raw HTML. Both copies share existing resource limits.

Supported release targets: Windows 10+ x64 (NSIS), Ubuntu 22.04+ x64 (AppImage),
macOS 13+ x64/arm64 (DMG). CI uses `windows-latest` x64, `ubuntu-22.04` x64,
`macos-15-intel` x64, and `macos-15` arm64; it checks the actual Node architecture.
macOS packages the host architecture so `electronDist` always matches the installed runtime;
both architectures build and launch in separate matrix entries. Local cross-compilation
against a different architecture's installed distribution is not supported.
Runner labels were checked against [GitHub's runner reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners).

References: [Electron installation](https://www.electronjs.org/docs/latest/tutorial/installation),
[Electron security](https://www.electronjs.org/docs/latest/tutorial/security),
[electron-vite guide](https://electron-vite.org/guide/),
and the installed packages' `engines` / `peerDependencies` metadata.
