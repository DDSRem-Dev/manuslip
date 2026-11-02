# Manuslip implementation plan

Status: reviewed proposal, ready to execute in dependency order. Performance budgets are
acceptance targets to measure, not claims about an implementation that already exists.

## Starting point and intended outcome

The repository currently contains product documentation, contribution and security policies,
Biome configuration, a Node 24 pin, and a CI workflow that skips JavaScript checks until
`package.json` exists. There are no workspace manifests, application sources, or tests yet.
The README's installation commands and feature list describe intended behavior.

Implement the existing M1–M4 roadmap through small, runnable increments. The first usable
checkpoint is a desktop app that opens, edits, and safely saves a Markdown file. M1 adds
Live Preview; M2 adds workspace tools; M3 delivers the distinguishing translation experience.
Each milestone must work offline except for an explicitly requested cloud translation.

## Scope and sequencing

| Stage | Deliverable | Depends on | Completion gate |
| --- | --- | --- | --- |
| P0 | Installable workspace and secure desktop shell | None | Clean install, checks, tests, and packaged launch work |
| M1a | Source editor and reliable file lifecycle | P0 | Open → edit → save → reopen preserves content |
| M1b | Semantic pipeline and Live Preview | M1a | Editing and mode switching preserve text, selection, and undo |
| M2 | Workspaces, navigation, assets, HTML/PDF export | M1b | Multiple files and exports work without data loss |
| M3a | Translation pipeline and replacement preview | M1b, P0 settings foundation | Only eligible text is sent; results persist and cancel safely |
| M3b | Bilingual layouts and export | M3a, M2 export | Layouts stay aligned and export the chosen revision |
| M4 | Advanced extensions and distribution polish | Stable M1–M3 | Separate designs and acceptance gates per feature |

M2 and M3a can proceed independently after M1b; a file tree, global search, and export must
not delay validation of translation. Items 15–17 may therefore precede 11–14. Item 18 needs
both paths. Package directories and dependencies are introduced when first consumed; avoid
empty package scaffolds and speculative interfaces in P0.

Prioritize a complete editing experience before additional providers or extension syntax.
Legacy diagrams, definition lists, sub/superscript, emoji expansion, advanced visual table
operations, custom CSS, Pandoc, plugins, presentation, and sync are subsequent work.
M1 supports CommonMark, GFM, frontmatter preservation, math, and highlighted code.
M2 adds Mermaid; legacy `sequence` and `flowchart` compatibility remains deferred.

## Architecture and decisions to settle first

Keep the existing package boundaries. Dependencies point from the app to packages; packages
must never import the desktop app or gain filesystem access through a renderer import.

| Path | Owns | Runtime |
| --- | --- | --- |
| `apps/desktop/src/main` | Windows, file sessions, watching, settings, translation transport/cache, export | Electron main; workers for blocking jobs |
| `apps/desktop/src/preload` | Narrow, validated contextBridge methods and event subscriptions | Sandboxed preload |
| `apps/desktop/src/shared` | IPC schemas, result types, channel constants | Main/preload; type imports in renderer |
| `apps/desktop/src/renderer` | Application composition, document sessions, menus and panels | Sandboxed renderer |
| `packages/core/src` | Semantic parsing, block descriptors, source positions, cache identity | Browser-compatible; semantic worker |
| `packages/editor/src` | CodeMirror setup, transactions, commands, Live Preview | Renderer |
| `packages/renderer/src` | mdast rendering, sanitization policy, lazy math/diagram rendering | Renderer or isolated export renderer |
| `packages/translate/src` | Extraction/reconstruction, provider contracts, scheduling, cache contracts | Pure shared logic; transport adapters in main |
| `packages/ui/src` | React controls, design tokens, light/dark themes | Renderer |

### Document and parser contract

- CodeMirror `EditorState` owns editable Markdown. Zustand stores document IDs, mode,
  save status, settings, and UI state; it must not maintain another editable body.
- Give every session a monotonically increasing revision on document edits/reloads, not on
  selection, decoration, mode, or status changes. Derived semantic snapshots contain
  document ID, revision, mdast, block occurrence IDs, content hashes, and source ranges.
  Apply semantic results only if their document and revision still match. Translation has a
  finer-grained unit identity rule below so unrelated edits do not discard useful work.
- Source and Live Preview share one editor state and undo history, switching extensions through
  compartments. Translated Preview is read-only. Switching back restores editor selection
  and viewport; switching modes does not rewrite Markdown.
- Use `unified` with `remark-parse` and the required remark extensions to obtain mdast.
  Micromark itself tokenizes Markdown; it does not directly expose the mdast used here.
  [Parser implementation reference](https://github.com/syntax-tree/mdast-util-from-markdown).
- Start semantic parsing with a debounced, revision-tagged whole-document worker. Keep this
  implementation as the correctness oracle and fallback if incremental fragments are added.
  Lezer continues to provide incremental editor syntax and decoration ranges.
- Before enabling dirty-block semantic parsing, implement document-wide reference/footnote
  tracking and dependency invalidation. References can resolve across block boundaries, so a
  source-slice hash alone cannot prove that a block's semantic output is unchanged.
  This is a proposed refinement of the README's independent-block parsing design, based on
  [CommonMark's parsing strategy](https://spec.commonmark.org/0.31.2/#appendix-a-parsing-strategy).
  Update both READMEs and the contribution architecture wording when implementing this decision.
- Treat Lezer boundaries as candidates. Reconcile them with semantic container boundaries,
  adjacent blocks, reference definitions, and parser-extension behavior. Fall back to a full
  worker parse when an edit cannot be invalidated confidently.
- Separate occurrence identity from content identity: identical paragraphs share cached work
  but need distinct IDs for scrolling and selection. Store relative positions in reusable
  fragments and derive current absolute offsets after edits. Use UTF-16 offsets consistently.
- Namespace parse/render caches by source hash, parser version/configuration, relevant document
  dependencies, and renderer/sanitizer version. Bound in-memory caches with an LRU budget.
  Verify source equality on non-cryptographic hash hits. Do not promise constant edit cost.

### Scheduling, rendering, and resource limits

- Start with one semantic worker shared by the window, prioritized for its active document.
  Permit one running parse and one latest pending request; replace pending work rather than
  queuing every edit. Proposed debounce: 150 ms with a 1 s maximum scheduling delay during
  continuous typing. A synchronous parse cannot process a cancellation message while running:
  discard obsolete results and start the newest request; terminate/restart only on a watchdog
  timeout or session shutdown. Bound restart attempts and retain usable Source mode on failure.
- Start expensive semantic work only for an active consumer such as Live Preview, outline,
  counts, export, or translation. Opening Source mode must not wait for the worker. Invalidate
  changed live widgets immediately and reveal their current source while semantics catches up;
  never apply old offsets to hide or replace new text. Old translated output is visibly stale.
- A worker's source mirror is a derived, disposable snapshot. First measure full-source
  serialization and returned AST size separately from parsing. If copying breaks budgets,
  send batched CodeMirror changes with base/result revisions and request a full resync after
  any mismatch. Only then consider changed-block result messages or incremental semantic parsing.
  Messages clone data across realms; immutable object identity cannot be assumed to survive
  that boundary. [Structured-data reference](https://html.spec.whatwg.org/multipage/structured-data.html#safe-passing-of-structured-data).
- Keep hashing, full-document string creation, AST traversal, word counts, and file hashing
  out of per-keystroke UI callbacks. Schedule counts from semantic work; compare a buffer to
  its saved baseline only after relevant edits/undo, using a cheap equality fast path first.
  Ignore selection-only transactions for parsing. React subscribes to small status slices;
  it does not rerender the document tree on each transaction.
- Use viewport-scoped inline decorations. Supply block/line-break replacement decorations
  directly from a CodeMirror state field, map ranges through edits, and update affected ranges.
  Do not implement layout-changing blocks in viewport-dependent decoration providers. Schedule
  DOM measurements through CodeMirror's measurement API and retain stable widget identity.
  Confirm these constraints against the pinned [CodeMirror view implementation](https://github.com/codemirror/view/blob/main/src/editorview.ts).
- Lazy-load math, diagrams, and uncommon highlighters; build heavy widget DOM only near the
  viewport. Keep lightweight block descriptors/height estimates in state. Bound concurrent
  heavy renders, replace obsolete pending jobs, and render source with an error state on
  timeout. For a renderer that blocks synchronously, an in-thread timer cannot interrupt it:
  constrain input size/complexity or isolate it in a terminable worker/process. Start in Source
  mode for inputs beyond measured Live Preview limits and offer explicit preview activation.
- Keep only the active editor view mounted; inactive tabs retain editor state and recovery
  metadata. Pause their derived rendering and evict derived caches before editable state.
  Start with a proposed 64 MiB combined derived-cache budget per window and 256 MiB disk
  translation-cache quota, accounting for retained AST/source/HTML/SVG data. Calibrate these
  budgets on real heap measurements. Editable buffers/history need separate measurements;
  never evict unsaved content or silently truncate history to satisfy a cache budget.
- Run SQLite operations and migrations in one dedicated main-owned worker. Its synchronous
  API must not block Electron's main event loop. Batch writes, bound busy timeouts, parameterize
  SQL, and evict cache entries in small batches. Cache failure disables persistence with a
  visible status; editing and in-memory translations continue. Quarantine a corrupt database
  without overwriting recovery files. [SQLite API reference](https://nodejs.org/api/sqlite.html).

### File and process contract

- Set `sandbox: true`, `contextIsolation: true`, and `nodeIntegration: false`. Validate IPC
  payloads and sender frames. Expose operation methods, never generic IPC or filesystem APIs.
  Apply a restrictive production CSP, block unexpected navigation/new windows, and allow only
  validated external links. Follow [Electron's security guidance](https://www.electronjs.org/docs/latest/tutorial/security).
- Main creates an opaque file-session ID after native open/save dialogs. Subsequent read,
  write, and watch operations use that ID and a main-owned canonical path. Renderer data
  cannot authorize arbitrary paths. Workspace operations additionally validate canonical
  containment and symlinks. Dispose watchers and event subscriptions on session close.
- Grant each session to its owning window and revoke it on close. Maintain one main-owned
  file record/save queue per canonical file across windows, and deduplicate workspace watcher
  subscriptions. For replacement saves, watch the parent directory and reconcile the target;
  recheck disk state on window focus and before saving in case notifications were missed.
- File snapshots carry a disk fingerprint, encoding, BOM, and newline metadata. Normalize
  editor line endings and restore the recorded style on save; leave an unopened/unedited
  file untouched. Add explicit encoding selection when detection is uncertain.
- Before writing a legacy encoding, round-trip the encoded bytes back to text and reject
  unrepresentable characters; offer Save As UTF-8. Invalid decoding must not auto-save
  replacement characters over the original. For mixed newline files, disable auto-save until
  the user explicitly chooses normalization or saves a copy. Keep this policy visible.
- Serialize saves per file. Capture document revision/text, check the expected disk fingerprint,
  write a unique sibling temporary file, flush, then rename using platform-tested behavior.
  Acknowledge only the captured revision. Edits made during a save must remain dirty.
  Clean up failed temporary files; failures retain the original file and the editor buffer.
- Recheck the fingerprint immediately before replacement as well as before preparing the
  temporary file. Never unlink the original as a rename-error workaround. Specify and test
  file-mode/ACL preservation and symlink/hard-link behavior; use Save Copy when semantics
  cannot be preserved safely. Atomic visibility and power-loss durability are separate:
  flush file data and directory metadata where supported, and document filesystem limits.
  Save As changes the session path only after success. Serialize recovery writes separately
  and ignore late acknowledgements from the old path. [Filesystem API reference](https://nodejs.org/docs/latest-v24.x/api/fs.html).
- Detect external changes using watcher notifications plus content fingerprints. Reload clean
  buffers; dirty buffers enter a conflict state with Reload, Save Copy, and explicit Overwrite.
  A pre-save check reduces races but cannot lock out unrelated editors; document that limit.
  Handle deletion, rename, permissions, locked files, watcher errors, and self-save events.
- Auto-save named files after a proposed 750 ms idle delay, with one in-flight write and the
  newest pending revision. Untitled files require Save As. Closing waits for pending saves
  or offers Save/Discard/Cancel. Keep revision-tagged recovery snapshots in app user data;
  offer recovery after an abnormal exit without silently replacing disk content.
- Add a proposed 5 s maximum dirty interval so continuous typing cannot postpone auto-save
  indefinitely; suspend writes during conflicts, unsafe decoding, and incomplete IME composition.
  Recovery checkpoints have their own bounded cadence, proposed at 2 s while dirty, and use
  atomic replacement. Failed checkpoints leave the prior checkpoint intact and show an error.
  On clean save/discard, remove obsolete checkpoints only after the final state is durable;
  retain recoverable drafts until user action. Recovery disk failures must not break editing.

### Translation contract

- Extraction produces typed translation units from mdast; reconstruction replaces eligible
  text while retaining structural nodes. Provider output never becomes executable markup.
- Preserve code, inline code, math, URLs, frontmatter, and diagram source. Use opaque
  placeholders for protected inline spans, and validate placeholder count/identity before
  applying output. Do not send the hidden values to providers. Reject malformed results and
  keep the source block visible. Translate human-readable link labels while retaining targets.
- Transport runs in main with credentials retrieved there. Settings may submit a newly entered
  key through a write-only method, clear the input immediately, and receive only configured
  status afterward. Never return stored keys to the renderer or place them in Zustand.
  Redact credentials and document bodies from logs. Use the protected, nonblocking `safeStorage`
  API supported by the pinned Electron version; treat Linux `basic_text` and unavailable or
  locked key stores as unsuitable for persistence and offer session-only keys.
  [Credential storage reference](https://www.electronjs.org/docs/latest/api/safe-storage).
- Persist cache entries through a versioned SQLite adapter outside the typing path. Verify
  `node:sqlite` support in the selected Electron runtime before committing to the adapter;
  isolate a supported SQLite-library fallback if necessary.
- Cache identity includes source/unit structure, source/target languages, provider instance
  and endpoint identity, model, glossary/formality, and prompt/extractor schema versions.
  Persist successful validated units only. Keep secrets out of keys. Local translations are
  document-derived user data: support clearing the cache and document its storage location.
- Each job carries document/session generation, settings revision, unit/cache keys, and
  cancellation state. Reconcile results with current unit keys and occurrence IDs. An unrelated
  edit may advance the document revision without invalidating unchanged units; changed units
  stay stale. When duplicate units share a request, cancel it only after its last subscriber
  cancels. Session disposal and provider/language changes invalidate subscriptions immediately.
- Start with two concurrent provider requests, provider-aware token/byte batch limits, bounded
  response sizes, and at most two retries for transient network/rate-limit/server failures.
  Do not retry authentication, invalid requests, or malformed structures automatically. Respect
  provider retry delays within a bounded job deadline. Stop issuing requests on cancellation;
  already submitted cloud requests may still incur charges. Keep streaming output provisional
  until a complete unit validates, and persist only validated output. Timeout/cancel aborts
  transport where supported. Reject redirects that change the configured endpoint origin.
- Include every prompt input that affects output in cache identity. If neighboring context
  is later added, include its hash and invalidate affected units; do not promise one-paragraph
  cost for context-dependent translation. Cache clearing advances a generation so late jobs
  cannot repopulate cleared entries. Bound cache read/write queues and provider progress events.
- Translation starts only on an explicit command. A later edit marks blocks stale; another
  explicit command refreshes missing/stale units. Loading a cached translation is network-free.

## Review findings and implementation decisions

| Priority | Risk in the initial plan | Decision and proof required |
| --- | --- | --- |
| High | Incremental semantics is a mandatory M1 dependency with difficult cross-block correctness | Ship measured whole-document worker parsing first; implement fragments only after a recorded bottleneck and equivalence coverage |
| High | Background work can accumulate, or copying a full AST can still stall the UI | Bound queues and message sizes; measure serialization, parse, apply, and paint separately under continuous edits |
| High | Rename-based saves can lose metadata; legacy encoding and idle-only saving can lose work | Verify replacement semantics, reject lossy conversion, add maximum save/checkpoint intervals, and inject failures around replacement |
| High | Whole-document revision checks discard valid translations; cancellation can affect shared work | Match current unit identities/settings and track subscribers; prove unrelated edits do not restart unchanged units |
| Medium | Hidden tabs, widgets, caches, SQLite, and watcher duplication grow resource use | Mount the active view only; bound derived data and queues; centralize file records and isolate database work |
| Medium | All of M2 delays testing the product's distinguishing translation feature | Establish minimal settings in P0; allow replacement translation after M1b; require export only for M3b |

These choices reduce expected risk; actual performance and platform file behavior remain
unverified until the corresponding implementation and measurements exist. Keep external-edit
races visible: the final fingerprint check is still not an interprocess compare-and-swap.

## Ordered implementation work

Each numbered item is a proposed PR-sized unit; split it further when it cannot be reviewed
or verified independently. Check items only after their completion gates pass.

### P0 — Runnable foundation

- [ ] **01. Dependency compatibility and workspace bootstrap.** Create root/workspace manifests,
  a committed npm lockfile, shared strict TypeScript configuration, and exports for consumed packages.
  Retain Node 24/npm 11. Verify available stable package versions and peer/engine compatibility
  rather than copying the README's unverified version numbers. Record selected versions
  and Electron's actual embedded Node in `docs/development/dependencies.md`. Validate the existing Biome
  configuration against the chosen binary. Install only dependencies required for this stage.
- [ ] **02. Desktop shell and shared contracts.** Add electron-vite main/preload/React entries,
  secure window configuration, runtime-validated IPC results, and a minimal accessible shell.
  Add English/Chinese i18next resources and minimal versioned settings persistence immediately.
  This foundation stores theme/preferences; provider configuration arrives with M3a. Establish
  package import boundaries.
- [ ] **03. Development and packaging gates.** Implement the root script contract from
  `CONTRIBUTING.md`: dev, build, check, lint, format, typecheck, test, test:e2e, clean.
  Add initial meaningful IPC/window tests. Activate the existing three-OS CI matrix; keep
  packaging nonpublishing and independent of signing secrets. A packaged window must launch
  and load its preload/renderer assets. Update setup instructions in both READMEs.

P0 acceptance: a fresh checkout installs with `npm ci`; `npm run dev` opens the app;
`npm run check`, `npm test`, and `npm run build` pass. Check unpacked launch on all target OSes.
Signed distribution and public publishing are later release work.

### M1a — Source editing and safe persistence

- [ ] **04. Source editor.** Mount one CodeMirror view with Markdown/GFM syntax, history,
  search/replace, multiple selections, keymaps, indentation, and bracket/quote completion.
  Add New/Open/Save/Save As commands and visible dirty/save/error states.
- [ ] **05. File sessions.** Implement the typed bridge, native dialogs, byte decoding,
  canonical file identity, atomic write path, and the revision-aware save queue above.
  Preserve BOM/newlines and surface uncertain encoding rather than silently corrupting text.
  Test lossless encoding round trips, replacement metadata, shared-file sessions, and Save As
  while a previous save is in flight. Treat permission/ACL/link limitations as explicit outcomes.
- [ ] **06. Auto-save, watching, recovery.** Add conflict handling, close protection, recovery
  snapshots, maximum dirty/checkpoint intervals, and watcher cleanup. Watcher notifications must
  never overwrite dirty buffers. Deduplicate directory watchers and handle replacement events.

M1a acceptance: open/edit/save/reopen Unicode and CRLF fixtures; cancel native dialogs;
undo to saved content clears dirty state; edit during a slow save remains dirty; disk-full,
permission, locked-file, and external-edit cases preserve recoverable content. Verify a
crash-recovery flow and native shortcuts on Windows/macOS/Linux.
Continuous typing must produce saves/checkpoints within the proposed limits when storage is
healthy; invalid decoding, unrepresentable text, mixed newlines, and metadata failures never
silently overwrite the original. Inject process exits before/after replacement and distinguish
crash recovery from power-loss durability claims.

### M1b — Shared semantics and Live Preview

- [ ] **07. Semantic snapshots and render pipeline.** Add the whole-document worker,
  position-bearing mdast, outline metadata, block identities, and bounded caches. Render through
  one shared mdast → HTML pipeline with DOMPurify and an explicit URL/HTML policy.
  Default to no remote image requests; provide an explicit document action to allow them.
  Implement latest-request scheduling, bounded caches, error recovery, and phase-level timing
  before optimizing the parser. Exports/translation request a specific settled semantic revision.
- [ ] **08. Inline Live Preview.** Add cursor/selection-aware decorations for headings,
  emphasis, links, lists, task lists, and inline code. Hide markers only outside active ranges.
  Keep composition/IME text visible. All editing actions dispatch CodeMirror transactions.
- [ ] **09. Block rendering.** Add source-revealing widgets for GFM tables, code fences,
  and lazy MathJax SVG with mhchem. Task toggles modify source. Sanitize or constrain generated
  math/diagram output as well as Markdown HTML. Unsupported constructs remain editable source.
- [ ] **10. Performance and correctness gate.** Measure typing, worker transport, semantic
  freshness, widget updates, and retained memory. Keep the whole-document worker if it meets
  budgets. Fix viewport rendering, redundant scans, or transport first when those dominate.
  Add dependency-aware incremental fragments only for a demonstrated remaining parse bottleneck,
  with a separate design and equivalence tests against full parsing. Include reference-definition
  edits, footnote renumbering, nested containers, fence changes, duplicate paragraphs, and
  source-range shifts. Cached widgets do not depend on implementing a fragment parser.

M1 acceptance: Ctrl/Cmd+1 and +2 retain text, selection, scroll anchor, and undo history.
CommonMark and GFM parser fixtures pass independently of the application's deliberate HTML
sanitization policy; rendering-policy tests cover that difference. Chinese/Japanese IME,
multi-selection edits, paste, malformed math, and long lines remain editable. If incremental
parsing is introduced, results equal full parsing after each edit in representative edit sequences.
Worker failure leaves source editing, undo, saving, and recovery operational. Pending semantic
state is visible and never silently exported or submitted as though it were current.

### M2 — Workspace and export

- [ ] **11. Multiple document sessions.** Add tabs, folder selection, a lazy file tree,
  recent workspaces, drag/drop and OS file-open events. Each tab retains its editor state,
  watcher, selection, and recovery state. Restore sessions without discarding unsaved drafts.
  Mount only the active view, pause inactive derived work, and reuse main-owned file/watch records.
- [ ] **12. Navigation and settings.** Add outline/heading jumps, counts, filename fuzzy search,
  cancellable ripgrep full-text search, themes, system spellcheck, and persisted settings.
  Define ignore rules, bounded results, missing-binary errors, and encoding behavior for search.
  Stream result batches with an explicit truncation limit; terminate prior searches on a new
  query and spawn ripgrep with an argument array and `shell: false`.
- [ ] **13. Clipboard and assets.** Convert clipboard HTML using Turndown/GFM; import pasted
  images with safe unique names and relative links. Resolve local assets through a controlled
  app protocol with canonical-path authorization. Avoid deleting potentially referenced assets.
  Add Mermaid with restrictive configuration, lazy loading, and failure fallback to source.
- [ ] **14. HTML/PDF export.** Export an immutable document revision through the shared renderer.
  Self-contained HTML bundles allowed local assets; PDF waits for fonts, math, diagrams, and
  images in an isolated print window. Provide clear missing-asset and export-failure states.
  Add cancellation, resource/total deadlines, asset byte limits, and a bounded page/image-size
  policy. A failed renderer cannot leave the print window or its temporary assets behind.

M2 acceptance: files with identical names in different folders stay distinct; switching or
closing tabs preserves pending edits; workspace search cancels cleanly; exports preserve
tables, Unicode, code, images, and math. Test keyboard-only use, both themes, and offline use.

### M3 — Structural translation

- [ ] **15. Offline translation harness.** Implement extraction/reconstruction, placeholder
  validation, capability flags, and deterministic fake-provider fixtures before network adapters.
  Cover lists, tables, emphasis, references, repeated units, partial failures, and malformed output.
- [ ] **16. Transport, credentials, and persistent cache.** Implement provider settings,
  cancellation, bounded scheduling, SQLite migrations, cache clearing, and retry/error reporting.
  Add one OpenAI-compatible adapter first; support an Ollama adapter without a cloud account.
  Keep HTTP limited to explicitly configured loopback endpoints; require HTTPS for remote hosts.
- [ ] **17. Replacement translated preview.** Add target-language selection, Translate/Cancel,
  block progress, Retry Failed, cached-offline rendering, and stale-result handling. Preserve
  the original editor buffer and show source fallback for missing/failed translations.
- [ ] **18. Bilingual layouts and export.** Add side-by-side block anchors and block-interlinear
  original/translation pairs; avoid assuming visual line counts match across languages.
  Prevent scroll feedback loops and preserve anchors as translated heights change. Export a
  snapshot of language, layout, and translations; offer a choice when some units are missing.
- [ ] **19. Additional providers.** Add DeepL, then Google Cloud/LibreTranslate if needed.
  Each adapter declares supported glossary/formality/language options and passes shared contract
  tests. Hide unsupported settings instead of pretending all providers behave identically.

M3 acceptance: provider payload inspection proves protected content is absent; source code,
math, links, and structure survive reconstruction; editing one independent paragraph requests
only its missing units; changing provider/model/glossary invalidates appropriate cache keys.
Cache hits survive restart. Switching documents/languages or cancelling cannot apply stale
results. Tests use fake/local services; paid-provider checks are explicit opt-in runs.
Unrelated edits preserve in-flight unchanged units. Shared-request cancellation, partial streams,
token-limit responses, clear-cache races, locked key stores, database corruption, and storage
quota exhaustion have deterministic tests. No failure in these paths blocks source editing.

### M4 — Separate proposals after core stability

Design custom CSS and themes, Pandoc process execution, plugin permissions/lifecycle,
focus/typewriter modes, presentation, image export, sync/conflict semantics, and signed updates
as independent features. Do not commit to a plugin API before core contracts have stabilized.
Public releases require platform installer smoke tests and a configured signing/update process.

## Validation and release gates

Every code PR runs `npm run check`, `npm test`, and `npm run build` as already required.
Changes to full editing flows, IPC, or windows also run `npm run test:e2e`. Add a dedicated
Electron E2E job with the needed Linux display setup; retain three-OS packaging checks and
run native platform smoke tests before milestones. Documentation-only changes need link and
diff checks; the current repository cannot run npm scripts until P0 lands.
Reuse built artifacts for E2E within each OS/job pipeline, and cache npm downloads using the
lockfile. Avoid rebuilding installers for each E2E scenario or running the same tests twice.
Keep release signing/publishing outside ordinary PR validation.

Test effort should focus on observable risks: byte preservation, revision races, parser
equivalence, source/preview synchronization, translation invariants, and packaged startup.
Keep malicious HTML/URL/SVG fixtures for both preview and export. Do not use snapshot-only
tests as proof that edits or saves are correct.

Proposed initial performance budgets, to be calibrated on a recorded reference machine:

| Scenario | Target | Measurement |
| --- | --- | --- |
| Typing in a 1 MiB prose document | p95 input-to-paint under 50 ms | Scripted edits with semantic work enabled |
| Renderer update/transport callbacks | p95 under 8 ms per measured callback | Include source serialization, hashing, AST application, and status updates |
| Semantic freshness after typing stops | p95 within 500 ms on the 1 MiB corpus | Last edit → current semantic result applied; excludes deliberate source-only fallback |
| Switch Source/Live Preview on that file | p95 under 100 ms | Warm caches; selection and scroll retained |
| Open a 1 MiB file | Editable source within 1 s | Local disk, packaged build; parsing may finish later |
| Large input stress | 5 MiB remains cancellable and editable | Paste, replace-all, long line, nested structure |
| Background backpressure | One parse running, at most one pending | Artificially slow parsing plus continuous edits and tab switching |
| Resource lifecycle | Stable retained memory after warmup across 50 open/close cycles | Observe renderer/main/worker heap, watcher and listener counts; account for GC timing |

Record OS, CPU, memory, build, corpus, and cold/warm state with results. When budgets fail,
profile before adding worker pools or changing the document model. A 1 MiB single paragraph
needs its own stress case; block caching alone does not make that case cheap.
Include cold first use of math/diagrams, repeated identical paragraphs, mixed scripts and RTL,
many tiny blocks, and repeated tab switching. Track source input-to-paint and semantic freshness
separately so a smooth editor cannot hide an indefinitely stale preview. Track translation
requests/tokens as well as latency; repeating a cached request should make zero provider calls.

## First implementation handoff

Start with items 01–03 only. Their reviewable output is the workspace, secure application shell,
working script/CI contract, tested packaged launch, and corrected setup documentation. Then
implement 04–06 to reach the first useful editor. At 10, record whether measurements justify
incremental semantic parsing; a passing whole-document worker is a valid M1 completion.
Then choose M2 or M3a without taking on the other's dependencies. Keep every increment runnable
and use the acceptance gates above to decide when a milestone is complete.
