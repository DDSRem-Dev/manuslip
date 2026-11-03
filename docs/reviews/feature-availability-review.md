# Feature availability review

Reviewed on 2026-11-03 against the current source build on Windows. This review
covers the Markdown conventions and their interaction with the desktop app's
editing, reading, saving and export features. Availability means that an actual
user path exists and its behavior has automated coverage; external services and
optional applications still require the configuration described below.

## Issues corrected

- **Inline footnotes:** `^[Note body]` now shares named-footnote numbering and return
  navigation. Bodies support inline formatting, links, code, math and soft breaks.
  Generated definitions retain their original source ranges; editor identities,
  translation units and export indices follow source order. Live Preview provides
  a source-edit button on each generated note body. Reference links now scroll to
  and focus the displayed note, including when CodeMirror has not mounted the
  destination yet; return links focus the precise reference without revealing its
  markup. Enter activation works for notes in prose, lists and tables.
  Plain note rows expose source editing for named definitions as well. Return links
  from other notes preserve the rendered footer placement of their target.
- **Inline formula alignment:** preserve MathJax's mathematical baseline and depth
  in Live Preview, reading and native HTML/PDF export styling. The previous SVG-box
  centering shifted asymmetric expressions. A shared helper reconstructs the native
  baseline from sanitized SVG geometry without admitting style attributes. Offsets
  scale with local font size; scripts, fractions and integrals share the prose baseline.
  Preview/reading SVGs retain overhanging ink; only expressions wider than the line
  become scroll containers. Scrollbars use the theme tokens and retain keyboard access.
- **Test-profile startup:** resolve relative profile paths before passing them to
  Electron, preventing the main-process “Path must be absolute” exception. A desktop
  regression launches successfully with a relative profile directory.
- **Disclosure markup removed:** document `<details>` and `<summary>` tags remain
  literal with HTML opt-in both off and on. They no longer swallow following
  Markdown as an HTML block or render collapsible content.
- **Task checkbox layout jump:** every source edit previously discarded all live
  semantic widgets, including unrelated tables and formulas. A frame-by-frame
  desktop regression reproduced 196.40625 CSS pixels of movement on one toggle.
  Verified task-marker changes now update their checkbox state locally while the
  worker rebuilds the authoritative semantics. Other edits still invalidate the
  model. The same regression checks position, document height and scroll throughout
  the update at 1144px and 400px widths, with less than one CSS pixel of variation.
- **Task control availability during document locks:** checkboxes inside semantic
  lists and quotes previously remained enabled during a pending close decision.
  They now follow the editor's read-only state without replacing their DOM.
- **Native spelling suggestions:** selecting a suggested correction could leave
  the misspelling unchanged after CodeMirror repainted its selection. Suggestions
  now cross a bounded bridge and replace only the matching, focused selection in
  an editable document. Correction and undo pass with networking disabled.
- **Reading copies after convention changes:** a captured translation could be
  exported with the current parser settings rather than those used to create it.
  Reading copies now retain their conventions through layout changes and export.
  Changing conventions marks the copy stale; an explicit refresh captures the new
  grammar without modifying the source.
- **Regression suite freshness:** menu helpers now check the native popover's open
  state rather than an exit animation's visibility. File-command tests follow the
  existing compact desktop control sizes and current footer, preserving their
  keyboard, focus, contrast, cancellation and source-history checks.

Task regressions also exercise native label clicks, keyboard toggles, nested and
ordered lists, projected quotes, undo/redo, forced colors, retained embedded math
and the exact resulting Markdown. Tests reject retaining semantic HTML for ordinary
text edits, malformed markers, literal code or a mixed batch of unrelated edits.

## Markdown availability

| Feature | Availability and behavior | Evidence |
| --- | --- | --- |
| CommonMark 0.31.2 | Available by default, including indented code, both fence styles, nested containers, references, escapes and ordered-list numbering. | All 652 official examples through parser, renderer and editor integration; desktop CommonMark regressions. |
| Tables and fenced code | Always available; visual table edits remain staged and undoable; known code languages highlight, unknown languages stay readable. | Table editing, code rendering, literal input and export tests. |
| Footnotes | Always available, including `^[inline notes]`, named definitions, repeated references, Unicode IDs and return navigation. Inline and named notes share numbering. | Parser/source-range tests; live editing and undo; translated/bilingual reading, protected bindings and export fragment checks; all 32 plugin combinations. |
| Document HTML | Sanitized HTML remains opt-in. `<details>` and `<summary>` are always literal and do not consume their Markdown body. | Core/editor recognition checks and desktop preview, translated reading and export with HTML enabled. |
| Strikethrough, scripts and typography | `~~text~~`, superscript, subscript, smart punctuation and heading attributes remain available with every plugin off. Code, math and destinations stay literal. | Base grammar checks in all 32 plugin combinations; literal input and source preservation tests. |
| Task lists | Always available with mouse and keyboard; one-character source edits retain layout, focus and undo. Reading and export retain read-only checkboxes. | Task control regressions, source-history tests and plugin combination tests. |
| Opt | On by default; controls `==highlight==`. Base strikethrough remains available when Opt is off. | Nested/escaped/multiline parsing, 32 combinations and persisted settings. |
| LaTeX | On by default; dollar, bracket and math-fence forms; bundled MathJax packages render offline SVG with native baseline alignment. | Full formula gallery; malformed-input and failure tests; measured alignment in wide/narrow Live Preview, reading and actual HTML export, plus CJK/headings/tables and zoom. |
| Mermaid | On by default; local isolated rendering, theme changes, source preservation, failures and retries. Off retains a readable code fence. | Diagram families, hung-process isolation, nested export slots and all plugin combinations. |
| GitHub | Off by default; enables bare URL/email autolinks and five named alert types. | Parser and renderer tests, all combinations, themed accessibility and export checks. |
| Typora | Off by default; recognizes leading YAML front matter as literal metadata excluded from translation and rendered content. Nested TOC links use stable heading IDs, including explicit IDs and Unicode. Translated TOC labels follow translated headings. | YAML toggle/cache and live source-preservation tests; all 32 plugin combinations through translation and export; heading/TOC navigation and export fragment checks. |
| Other existing syntax | TOML front matter, definition lists, emoji and legacy diagram fences remain available. | Block Markdown, raw input and cross-mode desktop tests. |

The combination matrix checks all five independent switches across preview,
translated reconstruction and export, including syntax nested inside quotes. It
checks that disabling optional syntax leaves the basic extensions available.

## Desktop feature paths

| Area | Available user paths reviewed |
| --- | --- |
| Editing | Source/Live/Translated modes, formatted text editing, selections, multiple cursors, find/replace, clipboard text and images, undo/redo, composition handoff and large paste cancellation. |
| Documents | New/Open, Save/Save As/Save Copy, autosave, encoding/BOM/newline preservation, external-change conflicts, pending dialogs, recoverable drafts and restart recovery. |
| Workspace | Named tabs, document cycling, independent selection/history/scroll, folders, file search, saved-content search, outline, file drops and OS launch requests. |
| Preferences | English/Chinese labels and search, persisted appearance/editor settings, isolated Markdown switches, reset, failed writes and read-only future settings. |
| Spelling | Opt-in offline checking, native suggestions, undo and persisted enable/disable. Windows/Linux use the bundled US English dictionary; macOS uses system languages. |
| Reading | Explicit translation, language discovery, cancellation/retry, offline cached copies, stale/partial copy choices and three reading layouts. Protected syntax and editable source remain intact. |
| Assets | Authorized local raster images, explicit remote-image permission, failed asset retry, and sanitized HTML opt-in. |
| Sharing | Native HTML/PDF and PNG/JPEG export, captured reading exports, local appearance, presentation navigation, export cancellation and failure recovery. |
| Local command plugins | Installation, permission review, enable/disable/removal, isolated execution, reviewable results and undoable source changes. |
| Sync | Explicit folder/WebDAV connection, comparison, send/receive/keep-both, offline retry, races and recovery. |
| Accessibility and layout | Keyboard focus, light/dark themes, Chinese copy, narrow windows, native zoom and forced colors, with automated accessibility checks and retained screenshots. |

## Configuration requirements and remaining qualification

- OpenAI-compatible, Ollama and DeepL translation adapters are implemented.
  Network translation requires an explicitly configured endpoint and any required
  model/key. Protocol, error, cache and privacy paths use local test servers;
  this review does not certify an external account or provider's availability.
- Google Cloud Translation and LibreTranslate adapters remain unimplemented.
- Pandoc export is optional and requires a separately selected Pandoc 3 application.
  A retained local Pandoc 3.13 executable was selected explicitly for this review.
  All 12 native conversions passed, covering Word/EPUB/LaTeX, English/Chinese,
  both profiles, editable text/tables and exact embedded media. Missing/invalid-tool
  behavior is also covered. Compiling LaTeX needs a separate TeX installation.
- The LaTeX feature is MathJax's mathematical TeX dialect. It does not compile a
  complete LaTeX document or fetch external packages. Macros remain local to each
  expression; size and rendering limits continue to apply.
- Existing reading copies retain their captured conventions. Refresh the copy
  after changing plugin settings to use the new grammar.
- Functional large-document editing is covered, but the separate packaged
  performance gates still have unresolved nested-document capacity limits. This
  review does not establish full nested Live Preview capacity or peak memory
  acceptance. Configurable document conventions use the full native parser rather
  than the experimental packed fast path; see [the benchmark record](../testing/benchmarks.md).
- Builds and installers remain unsigned local artifacts. There is no installed
  automatic-update runtime; signing, notarization and publication remain separate
  release work. This review exercises the current source build and does not
  regenerate or certify an installer.
- The executed desktop checks use Windows Electron. macOS/Linux installation,
  physical IME input and assistive-technology walkthroughs require their own runs.
  Automated accessibility results do not replace those checks.

## Verification results

| Check | Result |
| --- | --- |
| Full unit/integration suite after the local renderer-source polish | 21,453 passed across 268 files; one POSIX permission test skipped on Windows. |
| Desktop renderer-source polish | All 38 cases passed, including ordinary/overflowing inline math, keyboard scrolling, wide/narrow/wide resizing, references inside note bodies, named-note source editing and the existing feature regressions. See the [source comparison](renderer-polish-review.md). |
| Packaged renderer-source polish | Five smoke tests passed against the rebuilt Windows executable, including formula resizing, note navigation, named-note editing/undo, reading and HTML export. |
| Full unit/integration suite after the baseline/navigation follow-up, with local Pandoc 3.13 enabled | 21,452 passed across 268 files; one POSIX permission test skipped on Windows. |
| Desktop baseline/navigation follow-up | 36 distinct cases passed, including the long-document note/return test, relative-profile startup, formula geometry, source editing, settings, offline exports and task controls. The five convention cases were rerun after replacing an obsolete caret-position assertion with rendered-target scrolling and focus assertions. |
| Packaged Windows application | Three smoke tests passed against the rebuilt executable: relative-profile startup, long-document note navigation, source edits/undo, formula geometry, translated reading and actual HTML export. |
| Full unit/integration suite after the inline-syntax patch, with local Pandoc 3.13 enabled | 21,437 passed across 266 files; one POSIX permission test skipped on Windows. |
| Desktop regressions after the initial inline-syntax patch | 29 passed with no skips, covering inline notes, formulas, literal disclosure tags, CommonMark, all convention settings, raw input and task controls. |
| Earlier full desktop availability review | 231 passed; three optional Pandoc cases skipped before selecting the local tool. |
| Final desktop reading, conventions and export checks with Pandoc enabled | 14 passed with no skips, including all three optional desktop conversion cases and the new captured-convention regression. |
| Final native spelling correction and undo | Passed on the updated build with networking disabled. |
| Lint, formatting, runtime boundaries and TypeScript | Passed. |
| Production application build | Passed. |

The final reading/export changes have dedicated unit coverage for retained plugin
settings, stale copies, layout changes, explicit refresh and immutable exports.
The final desktop follow-up verifies these changes on the latest production build,
including bilingual layouts, partial/stale export choices, offline formulas,
English/Chinese settings, reading cache/retry and real Pandoc output.
The full desktop run also passed all four task-control cases, including the two
per-frame layout regressions. Evidence is retained under `test/artifacts/logs/feature-review-*`,
`test/artifacts/logs/spelling-corrected.log` and their desktop attachment directories.

The inline-syntax patch has 35 new unit/integration cases. Its desktop test covers
inline-note source navigation, edit/undo, mixed note numbering, protected translation,
bilingual fragment links and reading export. The follow-up verifies actual scrolling
and focus across unmounted editor viewports, repeated named notes, list/table notes
and Enter activation. Formula geometry is measured against the adjacent prose
baseline in wide/narrow Live Preview, translated reading and an actual exported HTML
window; the error stays below 0.75 CSS pixels. The baseline gallery also covers tall
expressions, CJK, headings, quotes and tables, 21px text, dark theme and 125% zoom.
Screenshots were reviewed
at both window widths and in reading/export. All 32 plugin combinations also cover
inline notes and literal disclosures. The full unit run includes the experimental
parser's differential and transport checks, preserving its canonical output.

The raw-input test now uses the editor's native Select All command when replacing
rendered content, ensuring that hidden source participates in the selection. Final
patch evidence is retained under `test/artifacts/logs/inline-feature-*` and the desktop test's
screenshot attachments. The design detector found no issues in the added formula
alignment rules; its existing stylesheet advisories are outside this patch.
Follow-up evidence is retained under `test/artifacts/logs/inline-polish-*`, including the full
unit/check/build logs, desktop screenshots and the convention-group rerun. The
new math-layout unit cases compare the reconstructed offset to MathJax's native
vertical alignment for asymmetric expressions and reject invalid geometry.
The final packaged run is under `test/artifacts/logs/inline-polish-packaged-complete*`; its
export fixture opens a painted window so screenshot capture also works in
packaged Electron.

## Reproduce

```sh
npm test
npm run check
npm run build:app
npm run test:e2e --
npx vitest run packages/renderer/test/unit/convention-availability.test.ts packages/editor/test/unit/live-task-changes.test.ts
npm run test:e2e -- test/e2e/inline-markdown.spec.ts
```

The task tests attach per-frame measurements and screenshots. Set
`MANUSLIP_TEST_PANDOC` to an explicitly selected local Pandoc 3 executable to enable
the twelve real conversion unit cases and three desktop conversion cases; otherwise
those tests explain their skips. See
[the convention guide](../guides/commonmark.md) for supported syntax and
[the broader validation record](../validation/implementation-history.md) for platform and distribution scope.
