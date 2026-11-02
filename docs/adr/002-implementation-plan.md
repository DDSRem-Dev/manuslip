# ADR 002: Manuslip implementation plan

Status: accepted; supersedes [ADR 001](001-initial-implementation-plan.md).

**Delivery priority updated 2026-10-31:** implement a deliverable application with all
features completed and a refined, elegant interface. Perfect performance is not required.
Use the existing functional Windows M1–M3 baseline to advance M4. Historical latency,
scheduling-duration and physical peak-memory targets remain measured improvement goals;
they do not block feature delivery by themselves. Preserve source fidelity, recovery,
security and the resource caps actually enforced by the application. Over-cap documents
must retain usable source editing and an explicit fallback. Do not relax limits, truncate
documents or change historical experiment results to claim acceptance. Other-platform,
physical input/AT and public distribution qualification remain separately tracked.

The contracts below govern implementation subject to that delivery priority. Resource
limits are collected under [Numeric limits](#numeric-limits). The unchecked historical
milestone gates retain their broader qualification scope; they do not prohibit M4 work
once the relevant functional flows pass.

## Starting point and intended outcome

At plan acceptance the repository contained product documentation, contribution and security
policies, Biome configuration, a Node 24 pin, and a CI workflow that skipped JavaScript checks
until `package.json` existed. Application code was not yet present. Current implementation and
verification evidence is tracked in [VALIDATION.md](../validation/implementation-history.md); unchecked gates remain open.

Implement the existing M1–M4 roadmap through small, runnable increments. The first usable
checkpoint is a desktop app that opens, edits, and safely saves a Markdown file. M1 adds
Live Preview; M2 adds workspace tools; M3 delivers the distinguishing translation experience.
Each milestone must work offline at runtime. Network access requires an explicit cloud
translation command or permission to load remote images for the document.

## Scope and sequencing

| Stage | Deliverable | Depends on | Completion gate |
| --- | --- | --- | --- |
| P0 | Installable workspace and secure desktop shell | None | Clean install, checks, tests, and packaged launch work |
| M1a | Source editor and reliable file lifecycle | P0 | Open → edit → save → reopen preserves content |
| M1b | Semantic pipeline and Live Preview | M1a | Editing and mode switching preserve text, selection, and undo |
| M2 | Workspaces, navigation, assets, HTML/PDF export | M1b | Multiple files and exports work without data loss |
| M3a | Translation pipeline and replacement preview | M1b, P0 settings foundation | Only eligible text is sent; results persist and cancel safely |
| M3b | Bilingual layouts and export | M3a, M2 export | Layouts stay aligned and export the chosen snapshot |
| M4 | Advanced extensions and distribution polish | Stable M1–M3 | Separate designs and acceptance gates per feature |

M2 and M3a can proceed independently after M1b; a file tree, global search, and export must
not delay validation of translation. Items 15–17 may therefore precede 11–14. Item 18 needs
both paths. Package directories and dependencies are introduced when first consumed; avoid
empty package scaffolds and speculative interfaces in P0.

The current functional baseline includes core editing, workspaces, export and structural
translation. Complete the remaining feature scope in M4: writing modes, extended Markdown
syntax and legacy diagrams, visual table operations, custom CSS/typography, presentation,
image export, Pandoc, plugins and sync. CommonMark/GFM/frontmatter/math/code and Mermaid
remain supported throughout. Exact historic semantic timings are not a sequencing gate.

## Architecture and package boundaries

Use the planned package boundaries below. Dependencies point from the app to packages; packages
must never import the desktop app or gain filesystem access through a renderer import.

| Path | Owns | Runtime |
| --- | --- | --- |
| `apps/desktop/src/main` | Windows, file sessions, watching, settings, translation transport/cache, export | Electron main; workers for blocking jobs |
| `apps/desktop/src/preload` | Narrow, validated contextBridge methods and event subscriptions | Sandboxed preload |
| `apps/desktop/src/shared` | IPC schemas, result types, channel constants | Main/preload; type imports in renderer |
| `apps/desktop/src/renderer` | Application composition, document sessions, menus and panels | Sandboxed renderer |
| `packages/core/src` | Semantic parsing, block descriptors, source positions, cache identity | Browser-compatible; semantic worker |
| `packages/editor/src` | CodeMirror setup, transactions, commands, Live Preview | Renderer |
| `packages/renderer/src` | mdast rendering, sanitization policy, lazy math/diagram rendering | App renderer or isolated rendering process |
| `packages/translate/src` | Extraction/reconstruction, provider contracts, scheduling, cache contracts | Pure shared logic; transport adapters in main |
| `packages/ui/src` | React controls, design tokens, light/dark themes | Renderer |

### Definitions

- `docRevision`: monotonically increasing integer per session, incremented on every document
  content change, including undo, redo, and reload. Selection, decoration, mode, and status
  changes do not increment it. Values are never reused or decremented.
- `savedBaseline`: immutable editor `Text` and file metadata captured by the last successful
  open, reload, or save. Dirty state compares current content and save-relevant metadata with
  this baseline; revision ordering alone cannot establish content equality.
- `translationSettingsRevision`: integer incremented only by settings that affect translation
  output (provider, endpoint, model, source/target language, glossary, formality, prompt/extractor
  version). Theme, layout, and other UI settings never change it.
- `sessionGeneration`: integer identifying a session's lifetime. Disposal invalidates all of
  its subscriptions; results from a disposed generation cannot update the UI.
- `cacheGeneration`: application-wide integer advanced when the translation cache is cleared.
  Cache reads and writes carry this value so late work cannot restore cleared entries.
- `settledDocRevision`: revision of the latest applied semantic snapshot. It is current only
  when equal to `docRevision`; otherwise the snapshot is stale. Consumers retain immutable
  snapshots rather than interpreting an old revision as current.
- `unitKey`: hash of the canonical extraction payload and reconstruction schema, source language
  (including explicit auto-detection), target language, `providerDescriptorHash`, glossary,
  formality, and prompt/extractor versions. Preserve meaningful whitespace and structure;
  canonical serialization must not merge distinct provider inputs. Secrets are never an input.
- `occurrenceId`: opaque, session-local identity for a source block or translation unit,
  independent of content hashes, document ordinals, and translation settings. Duplicate units
  have distinct occurrence IDs even when they share a `unitKey`.
- `providerDescriptorHash`: hash of adapter id/version, normalized base URL including its path
  and non-secret query configuration, model, non-secret account/profile identifier, and all
  output-affecting adapter options. URL normalization preserves routing semantics. Reject URL
  user information and credentials in query parameters; secrets use dedicated credential fields.
- `canonicalFileId`: platform-normalized file identity defined under the file contract, used for
  ownership, watch deduplication, and save queues.

### Document and parser contract

- CodeMirror `EditorState` owns editable Markdown. Zustand stores document IDs, mode,
  save status, settings, and UI state; it must not maintain another editable body.
- Give every session a monotonically increasing `docRevision` on document edits/reloads, not on
  selection, decoration, mode, or status changes. Derived semantic snapshots contain document
  ID, `docRevision`, mdast, `occurrenceId` values, content hashes, and source ranges. Apply
  semantic results only if their document and `docRevision` still match. Translation has a
  finer-grained unit identity rule below so unrelated edits do not discard useful work.
- Source and Live Preview share one editor state and undo history, switching extensions through
  compartments. Translated Preview is read-only. Switching back restores editor selection
  and viewport; switching modes does not rewrite Markdown.
- Use `unified` with `remark-parse` and the required remark extensions to obtain mdast.
  Micromark itself tokenizes Markdown; it does not directly expose the mdast used here.
  [Parser implementation reference](https://github.com/syntax-tree/mdast-util-from-markdown).
- M1b topology is a debounced, `docRevision`-tagged whole-document worker. Keep this
  implementation as the correctness oracle and fallback if incremental fragments are added.
  Lezer continues to provide incremental editor syntax and decoration ranges. Per-dirty-block
  micromark, synchronous main-thread parsing, and worker pools are not M1b behavior; the README
  "Parsing architecture" sections describe the pre-decision design. Correct both READMEs and
  the contribution architecture wording in the same PR as item 07.
- Before enabling dirty-block semantic parsing, implement document-wide reference/footnote
  tracking and dependency invalidation. References can resolve across block boundaries, so a
  source-slice hash alone cannot prove that a block's semantic output is unchanged.
  This refines the README's independent-block parsing design, based on
  [CommonMark's parsing strategy](https://spec.commonmark.org/0.31.2/#appendix-a-parsing-strategy).
- A conservative whole-source grammar check may omit GFM tokenizers only when no extension
  can occur: any pipe, tilde, at-sign, colon, bracket, entity/escape marker or case-insensitive
  `www.` selects the complete GFM grammar. Keep math/frontmatter enabled and preserve the
  task-list extension's null checked property for ordinary list items. Compare complete
  position-bearing roots with the full grammar across the official CommonMark corpus and
  extension/edit cases. Recheck this guard whenever parser dependencies change; this is not
  fragment parsing or a reduced product syntax mode.
- After complete block tokenization has resolved document-wide definitions, the application's
  pinned parser may postprocess and compile balanced event spans. A span must retain every
  forward-linked flow token, including links crossing container boundaries. Preserve one root,
  shared compiler data/listener state, complete list preparation and one final set of root
  transforms. The private option is reviewed for the fixed application extensions; other
  extension configurations retain the general compiler. This is one whole-source parse,
  not independent source fragments or incremental edit parsing. A span can still cover the
  whole document, so batching does not establish a memory bound or activate semantic transport.
- The synchronous whole-root application API drains the same pinned compiler used by the
  experimental block consumer. It retains every child and publishes only after the complete
  root succeeds. Audited gap-buffer inline resolution avoids repeated event-array shifts;
  the API still executes atomically and retains a complete native MDAST. Differential tests
  use a separate original whole-root entry so the application compiler cannot serve as its
  own oracle. This does not select packed transport or establish scheduling/memory acceptance.
- Treat Lezer boundaries as candidates. Reconcile them with semantic container boundaries,
  adjacent blocks, reference definitions, and parser-extension behavior. Fall back to a full
  worker parse when an edit cannot be invalidated confidently.
- Separate occurrence identity from content identity: identical paragraphs share cached work
  but need distinct IDs for scrolling and selection. Map existing occurrence ranges through
  CodeMirror changes and reconcile them with each accepted semantic snapshot. Preserve IDs for
  unambiguously unchanged occurrences, including those shifted by an insertion before them.
  Assign new IDs on creation, reload, split/merge, or ambiguous reconciliation; never match
  duplicates by hash alone. Result subscriptions require both occurrence ID and current unit
  key. Store relative positions in reusable fragments and derive current absolute offsets
  after edits. Use UTF-16 offsets consistently.
- Namespace parse/render caches by source hash, parser version/configuration, relevant document
  dependencies, and renderer/sanitizer version. Bound in-memory caches with an LRU budget.
  Verify source equality on non-cryptographic hash hits. Do not promise constant edit cost.
- Prepare occurrence indexes and widget models cooperatively, without exposing partial results.
  Check current document, revision and consumer before continuation and commit. Edits, reset,
  suspend, disposal and superseding render requests cancel preparation. Commit the complete
  index/model together; retain exact source comparison for identity reuse. Cache the prepared
  model for mode/asset changes instead of rebuilding the same identity map synchronously.

### Scheduling, rendering, and resource limits

- Start with one semantic worker per window, prioritized for its active document. Permit one
  running parse and one latest pending request; replace pending work rather than queuing every
  edit. Debounce is 150 ms; during continuous typing, publish the newest pending request at
  least every 1 s. This bounds scheduling, not execution: a pending request waits for the
  running parse. M1b does not preempt a running parse for edits or tab switches. Discard an
  obsolete result and immediately run the latest eligible request. A watchdog outside the worker
  terminates the worker after 5 s; crashes and timeouts allow at most 3 automatic restarts per
  rolling 60 s, then pause semantic work with a visible error and explicit Retry action.
  Window shutdown may terminate the worker without restarting it. Closing a document removes
  its pending request and invalidates its running result. Source editing remains usable.
  Measure freshness from the last edit through result application, including queueing,
  serialization, worker startup, parsing, transport, and application time.
- Start expensive semantic work only for an active consumer such as Live Preview, outline,
  counts, export, or translation. Opening Source mode must not wait for the worker. Invalidate
  changed live widgets immediately and reveal their current source while semantics catches up;
  never apply old offsets to hide or replace new text. Old translated output is visibly stale.
- A worker's source mirror is a derived, disposable snapshot. First measure full-source
  serialization and returned AST size separately from parsing. If copying breaks budgets,
  send batched CodeMirror changes with base/result revisions and request a full resync after
  any mismatch. Only then consider changed-block result messages or incremental semantic parsing.
  Enforce the message limit in both directions. If an AST exceeds it, return a small explicit
  limit error and retain Source mode; do not truncate semantic results. Chunked transport needs
  a separate measured implementation before it can replace this fallback.
  Messages clone data across realms; immutable object identity cannot be assumed to survive
  that boundary. [Structured-data reference](https://html.spec.whatwg.org/multipage/structured-data.html#safe-passing-of-structured-data).
- Returned semantic roots/projections use one lossless JSON UTF-8 ArrayBuffer transferred
  from the worker. Reserve 1,024 bytes for its validated identity/metadata envelope within
  the existing 8 MiB message cap; retain the same conservative doubled snapshot accounting.
  Validate actual buffer length, strict UTF-8, generation/document/revision identity and
  decoded source ranges before acceptance. The renderer decodes once instead of reserializing
  the AST for a size check. Worker cache entries retain a separately owned buffer, charged
  before admission; transferring an outgoing result must never detach cached data. No
  compression, truncation, chunking or semantic-node omission is introduced.
  The measured lossless packing experiment and the gates for a separate persistent/incremental
  design are recorded in [ADR 003](003-semantic-snapshot-packing.md). That experiment is not
  enabled in the application and does not supersede this JSON rule or its resource fallback.
- Keep hashing, full-document string creation, AST traversal, word counts, and file hashing
  out of per-keystroke UI callbacks. Schedule counts from semantic work. After content changes,
  mark the session provisionally dirty and schedule a comparison with `savedBaseline`, using
  `Text` identity/length fast paths before structural equality rather than creating strings.
  Tag deferred comparisons with the current revision and baseline identity; discard obsolete
  results. Undo or redo to saved content clears dirty state without decrementing `docRevision`.
  Complete the current comparison before a save or close decision; cancel obsolete pending
  auto-saves when the buffer is clean.
  Ignore selection-only transactions for parsing. React subscribes to small status slices;
  it does not rerender the document tree on each transaction.
- Stage plain-text paste from 262,144 UTF-16 units in cooperative tasks before one atomic
  editor transaction. Build immutable text in at most 65,536-unit normalization chunks,
  preserving CRLF and surrogate pairs across chunk boundaries; enforce normalized UTF-8
  size as well as the existing final document-byte filter. Cancel/Escape, tab suspension,
  composition, locking and disposal invalidate pending insertion. Track original selections
  through unrelated edits; overlapping selected-range edits reject instead of overwriting
  new text. Cancellation releases preparation and never exposes partial source. A successful
  paste is isolated as one undo step. The final atomic transaction is not preemptible.
- Route native search-panel Replace all through one cancellable job. Collect the captured
  immutable source cooperatively, match with public CodeMirror SearchQuery in a disposable
  browser worker, validate the complete result and cooperatively build a balanced ChangeSet
  before one isolated undoable transaction. Preserve native literal/regex/capture/whole-word
  behavior against an independent native-command oracle. Cancel/Escape, edits or query changes,
  tab suspension, composition, lock and disposal invalidate all staged results. Selection-only
  changes remain valid. No partial changes reach source, save, parsing or history. The final
  transaction is not preemptible. Native blocked-worker shutdown can lag UI cancellation by
  Chromium's approximately two-second forcible-termination delay; see VALIDATION.md.
- Use viewport-scoped inline decorations. Supply block/line-break replacement decorations
  directly from a CodeMirror state field, map ranges through edits, and update affected ranges.
  Do not implement layout-changing blocks in viewport-dependent decoration providers. Schedule
  DOM measurements through CodeMirror's measurement API and retain stable widget identity.
  Confirm these constraints against the [CodeMirror view implementation](https://github.com/codemirror/view/blob/main/src/editorview.ts) for the version chosen in item 01.
- Lazy-load math, diagrams, and uncommon highlighters; build heavy widget DOM only near the
  viewport. Keep lightweight block descriptors/height estimates in state. Bound concurrent
  heavy renders, replace obsolete pending jobs, and render source with an error state on
  timeout. For a renderer that blocks synchronously, an in-thread timer cannot interrupt it:
  constrain input size/complexity or isolate it in a terminable worker/process. Start in Source
  mode beyond the Live Preview limit (Numeric limits) and offer explicit preview activation.
- Render Mermaid in a dedicated, sandboxed Electron rendering process with DOM access, separate
  from the editor and print window. Mermaid's [render implementation](https://github.com/mermaid-js/mermaid/blob/develop/packages/mermaid/src/mermaidAPI.ts)
  requires a DOM; an ordinary Web Worker is not its rendering host. Main owns the job queue and
  timeout, terminates the isolated process on a hung job, and recreates it within the restart
  limit. Prove process isolation in packaged tests. Expose only validated render jobs and
  sanitized SVG results; deny network, navigation, file access, and document-controlled scripts.
  Diagram configuration cannot relax the app's security policy. On timeout, crash, or invalid
  output, retain source and report the failure; exports fail visibly or use an explicitly chosen
  source fallback. Cancel and clean up jobs when their consumer closes.
- Keep only the active editor view mounted; inactive tabs retain editor state and recovery
  metadata. Pause their derived rendering and evict derived caches before editable state.
  Start with a 64 MiB derived-cache budget per window and a 256 MiB disk translation-cache
  quota (Numeric limits). The 64 MiB covers renderer-side derived data only; the worker has
  separate source-size, message-size, and execution-time limits. Above the Live Preview limit
  the app opens in Source mode; exceeding the cache budget drops derived data before editable state.
  Calibrate these budgets on real heap measurements. Editable buffers/history need separate
  measurements; never evict unsaved content or silently truncate history to satisfy a cache
  budget.
- Run SQLite operations and migrations in one dedicated main-owned worker. Its synchronous
  API must not block Electron's main event loop. Batch writes, bound busy timeouts, parameterize
  SQL, and evict cache entries in small batches. Cache failure disables persistence with a
  visible status; editing and in-memory translations continue. Quarantine a corrupt database
  without overwriting recovery files. [SQLite API reference](https://nodejs.org/api/sqlite.html).

### Numeric limits

Diagram implementation budgets: 64 KiB UTF-8 source per job; 2 MiB serialized SVG output;
2,000 semantic nodes (database node collections and rendered node groups) and 20,000 SVG
elements; 4,000 edges. Main keeps one isolated host, one active and four pending jobs per
window, with a 3-second deadline including cold startup. Three automatic restarts are
allowed per rolling 60 seconds; manual Retry clears the pause. Renderer consumers are
bounded to 200 nearby widgets, send at most five jobs, and prioritize visible work.
Main SVG results use an 8 MiB LRU per window; source equality participates in cache keys.
Diagram SVG uses the existing mounted-widget budget. Host configuration and theme are
app-owned; document configuration directives/frontmatter are rejected with source fallback.
The host is an ephemeral, sandboxed session on a separate custom origin, with no network,
file protocol, permissions, navigation, popups, or editor/file bridge. SVG leaves the host
only after styles become constrained presentation attributes and active content is removed;
the editor repeats the final SVG sanitizer.

Clipboard/assets implementation budgets: HTML input is at most 1 MiB UTF-8, converted
off the UI thread with a 5-second deadline and a 4 MiB output cap; one conversion runs
at a time, with no waiting queue. Clipboard image capture retains one PNG per window
for at most 60 seconds, capped at 20 MiB, 16 million pixels and 8192 pixels per side.
Local raster reads are capped at 20 MiB, 16 million pixels and 8192 pixels per side,
with four concurrent operations and 32 waiting jobs. Their shared cache is limited to
64 MiB (compressed bytes plus an RGBA-size estimate) and 256 opaque capabilities. Paths are
relative to the document, confined to its captured workspace root (or parent folder
for a directly opened document), and checked against canonical directory identities.
Image imports exclusively create UUID-named PNG files in the document's `assets`
directory. Assets are never automatically deleted, including after undo or tab close.
Each HTML conversion worker has a 128 MiB old-generation and 16 MiB young-generation
heap limit and is terminated on completion, timeout, document close, or window loss.

Acceptance-gate values are collected here. A "bounded" statement without a row means the owning
item must add one before its gate can pass; do not leave the number implicit in code. Calibrate
on the recorded reference machine and amend this table before changing the surrounding prose.

| Limit | Value |
| --- | --- |
| Semantic parse debounce / maximum pending-request publication delay | 150 ms / 1 s; running work is not preempted |
| Semantic apply preparation | 1 ms scheduling target, generator checkpoints every 64 descriptors; native scheduler.yield between slices (timer fallback); measure final install in the same slice budget and total including scheduling waits |
| Editor inline syntax leaf | 32,768 UTF-16 units; longer leaves retain visible source without inline syntax styling, and image paste treats their code context as unknown; full worker semantics and source text are unchanged |
| Semantic concurrency | 1 running, 1 latest pending per window; 5 s watchdog; 3 automatic restarts per rolling 60 s |
| Concurrent heavy renders / worker message size | 4 / 8 MiB |
| Live Preview document limit | 2 MiB or 50,000 blocks, whichever comes first; above it, Source mode |
| Derived-cache budget (renderer) | 64 MiB per window |
| Packed preview status publication | At most 16 UI consumers and 8 retained packed publications per document; reserve 8 KiB coordinator/consumer metadata per packed publication, in the same owner as its independently retained model/input handles; acquire before model commit; overflow preserves native fallback |
| Renderer derived allocations | 32 MiB semantic snapshot accounting, 16 MiB mounted-widget accounting (markup × 4), 8 MiB math cache, 8 MiB reserve for range metadata and pending work; accounting is an enforced bound, not a claim about exact heap usage |
| Semantic snapshot cache (worker) | 16 MiB per window worker, independent of the renderer budget; source equality is verified on a cache hit |
| Disk translation-cache quota | 256 MiB including database and journal files; evict least recently used entries to 90% before further growth |
| Auto-save idle / maximum dirty interval | 750 ms / 5 s |
| Replacement-save retries | 3 retries after 50/150/400 ms; recheck the disk fingerprint before each attempt |
| Recovery checkpoint maximum interval | 2 s while dirty; 10 s above 1 MiB; skip when unchanged |
| Recovery storage / header / startup offers | 512 MiB of valid snapshots / 64 KiB header / 100 snapshots; preserve existing drafts and reject further growth visibly |
| Provider concurrency / retries / response size | 2 / 2 / 2 MiB |
| Provider job deadline | 60 s per unit batch |
| Translation extraction/reconstruction | Existing 2 MiB/50,000-block semantic source limit; at most 10,000 units, 256 nested levels and 256 placeholder tokens per unit; 64 KiB canonical UTF-8 payload per unit, 256 KiB translated output per unit, 16 MiB aggregate payload accounting and 16 MiB reconstructed prose; oversized individual units retain source with an explicit limit status; whole-plan limits reject instead of truncating |
| Translation identity/settings | SHA-256 over canonical payload/schema and all output-affecting settings; endpoint 8,192 UTF-16 units, 32 non-secret query/adapter options of at most 2,048 UTF-16 units each; model 256, profile 128, adapter/version 64 UTF-16 units; glossary at most 1,000 entries/64 KiB serialized UTF-8; no credentials in descriptors or cache identity |
| Workspace search results | 500 matches or 20 MiB raw output/retained-result accounting, explicit truncation; 50 results per IPC page and initial UI page; Show more adds 50; excerpts at most 2,048 UTF-16 units |
| Workspace search scheduling | 200 ms query debounce; one process running and one latest pending job per window; wait for process close before spawning its successor; two ripgrep threads; 15 s deadline; poll every 100 ms while running, drain existing pages without delay |
| Workspace search admission | 256 UTF-16 query units, literal matching; 2 MiB raw record; skip decoded match lines above 65,536 UTF-16 units; filename candidates at most 10,000 or 8 MiB accounting; Markdown/text extensions only, 50 MiB maximum file, no links/hidden paths/.git/node_modules; workspace ignore files apply, parent/global ignores disabled |
| Outline and counts | Current semantic revision only; active Source and Live consumers share the semantic worker/caps; outline initially mounts 200 headings and Show more adds 200; counts hide while stale; no parsing for inactive tabs |
| Offline spellcheck | Default off; Windows/Linux use only the packaged en-US dictionary (451,982 bytes, pinned SHA-256), macOS uses system languages; local-only dictionary URL; at most five native suggestions, corrections participate in editor undo |
| Workspace browsing | 200 items per page; scan at most 5,000 directory entries per expanded folder; 10,000 catalog nodes or 16 MiB accounting per window, 32 levels deep; one running listing and eight queued; explicit truncation; skip .git/node_modules and symlinks/junctions; Refresh replaces the catalog |
| Workspace persistence | 10 recent folders and 32 named session files; 8 MiB metadata file; one running atomic write and one latest pending state; renderer debounce 250 ms with explicit flush before window close; unavailable files retained until removed explicitly |
| Native file-open requests | 32 queued paths per app instance, at most 32 files per launch/drop burst, 32,768 characters per path; one running file read; duplicate queued paths coalesce; no document bodies in the request queue; failed requests await Retry/Dismiss; explicit window close dismisses its remaining requests |
| Editable document size | 50 MiB; reject larger files before loading and reject edits/pastes exceeding the cap without changing the buffer |
| Replace all | One current job; source/result document at most 50 MiB UTF-8; combined query text at most 8 Mi UTF-16 units; at most 262,144 disjoint change records (adjacent matches coalesce); complete encoded result plus 1,024-byte envelope reserve at most 8 MiB; five-second renderer deadline covers source collection, matching and result preparation; explicit retry only. Captured source, worker state, encoded result and staged changes are transient copies. Cancel requests native termination; a blocked Chromium worker can remain alive for approximately two more seconds. No partial result or source truncation. |
| Open document tabs | 32 per window; reject additional opens visibly; one mounted editor; inactive parsing paused and semantic snapshots/widgets released |
| File command queue | One active command and at most one pending window-close request; repeated close requests coalesce; other commands are disabled while busy |
| Math | 4 KiB TeX per expression, 200 expressions per viewport |
| Remote image proxy | Explicit permission per open document; HTTPS port 443 only, no credentials/cookies/referrer; 15 s total, 5 redirects, 20 MiB per image, 64 MiB in-memory asset cache, 4 requests globally, at most 32 queued; public IPs only with DNS validation and connection pinning on every redirect; raster PNG/JPEG/GIF/WebP only |
| Math worker | 1 running render, 200 queued viewport requests; 2 s per render; 3 automatic restarts per 60 s, then explicit Retry; 8 MiB cache charged to the renderer budget |
| Code widget highlighting | At most 64 KiB per code block; longer blocks retain escaped source without additional highlighting |
| Highlight jobs / math macros | 3 running lazy code highlights and at most 200 queued widget requests, alongside 1 math worker (4 total heavy renders); 1,000 TeX macro expansions per expression |
| Diagrams | 1 isolated process per window, 1 running and 4 pending jobs; 3 s per job including startup, 2,000 nodes; 3 automatic restarts per rolling 60 s |
| Export | 60 s total, 20 MiB per asset, 100 MiB total assets, 2,000 pages |
| Export admission and stages | One active export per window, no queue; immutable source up to 2 MiB/50,000 blocks; 16 MiB aggregate projected HTML plus rendered SVG, 1,200 math/diagram slots, 500 images; parse 5 s, each math 2 s, each diagram 3 s, print startup and each asset/font/decode stage 15 s; total 60 s excludes the native destination dialog |
| Export image/output bounds | PNG/JPEG/GIF/WebP only, at most 16 million pixels and 8,192 pixels per side; 128 MiB aggregate decoded-pixel estimate, 100 MiB aggregate compressed assets; worker old/young generation 256/32 MiB (external buffers are separate); self-contained output at most 160 MiB; A4/20 mm margins, print at most 2,001 pages and reject output above 2,000 pages; cancellation/close destroys export workers and print/diagram hosts and removes incomplete destination temporaries; native publication already begun may finish |

Document limits cover both input bytes and UTF-8 encoded editor content; exceeding either
limit triggers the stated fallback. Worker message limits apply to the serialized payload,
not source length alone. Limits do not imply that every below-limit input meets latency or
memory budgets. A timeout or resource fallback remains visible and is recorded in measurements.

### File and process contract

- Set `sandbox: true`, `contextIsolation: true`, and `nodeIntegration: false`. Validate IPC
  payloads and sender frames. Expose operation methods, never generic IPC or filesystem APIs.
  Apply a restrictive production CSP, block unexpected navigation/new windows, and allow only
  validated external links. Follow [Electron's security guidance](https://www.electronjs.org/docs/latest/tutorial/security).
- Main creates an opaque file-session ID after native open/save dialogs. Subsequent read,
  write, and watch operations use that ID and a main-owned canonical path. Renderer data
  cannot authorize arbitrary paths. Workspace operations additionally validate canonical
  containment and symlinks. Dispose watchers and event subscriptions on session close.
  Derive `canonicalFileId` from the resolved existing path and the filesystem's actual case
  behavior, including case-sensitive Windows directories and case-insensitive mounted volumes.
  Do not infer case sensitivity from the OS alone. Resolve junctions/symlinks and normalize UNC
  and extended-length Windows paths consistently. For a new Save As destination, resolve the
  existing parent first and finalize identity after successful creation. Keep display paths
  separate; aliases of the same supported path must resolve to one file record.
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
- Serialize saves per file. Capture `docRevision` and text, check the expected disk fingerprint,
  write a unique sibling temporary file, flush, then rename. On EPERM/EBUSY/EACCES retry the
  rename up to 3 times after 50/150/400 ms, repeating the fingerprint check before every attempt.
  If replacement still fails, keep the session path and buffer dirty, suspend automatic retries,
  and offer Retry or Save Copy. Save Copy creates a unique destination without overwriting an
  existing file and reports its path only after success. Acknowledge only the captured
  `docRevision` and advance `savedBaseline` to the content actually written. A newer revision
  remains dirty until a comparison proves that its content matches that baseline.
  Clean up failed temporary files; failures retain the original file and the editor buffer.
  Save Copy never switches the session path and never clears dirty state.
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
- Auto-save named files after a 750 ms idle delay (Numeric limits), with one in-flight write
  and the newest pending `docRevision`. Untitled files require Save As. Closing waits for
  pending saves or offers Save/Discard/Cancel. Keep `docRevision`-tagged recovery snapshots in
  app user data; offer recovery after an abnormal exit without silently replacing disk content.
- Add a 5 s maximum dirty interval so continuous typing cannot postpone auto-save indefinitely;
  suspend writes during conflicts, unsafe decoding, and incomplete IME composition. Recovery
  checkpoints use their own cadence (Numeric limits): skip the write when content is unchanged
  since the last checkpoint, and scale the interval with document size. Use atomic replacement.
  Failed checkpoints leave the prior checkpoint intact and show an error.
  On clean save/discard, remove obsolete checkpoints only after the final state is durable;
  retain recoverable drafts until user action. Recovery disk failures must not break editing.

### Translation contract

Replacement preview implementation budgets: one active translated snapshot per window. A
tab switch cancels subscriptions and releases that snapshot/worker; editable tab state stays.
The captured root is the current settled semantic AST. A dedicated translation worker extracts,
hashes, reconstructs and projects it, with one running operation and one latest render pending,
a 5 s watchdog and explicit retry after failure. Worker messages are at most 8 MiB. Its captured
plan and accumulated outputs together account for at most 32 MiB; the renderer retains at most
8 MiB of unit descriptors, 4 MiB of outputs and 8 MiB of translated projection accounting.
Translation-derived allocations charge the existing 32 MiB semantic snapshot allowance; the
current semantic snapshot plus those allocations must fit it. Mounted translated markup uses
the existing 16 MiB widget allowance shared with Live Preview, with at most 200 mounted math
and 200 mounted diagram widgets. Newly settled source semantics can release an older reading
copy when the shared allowance is exceeded. Progress publishes at most
every 100 ms and projections every 500 ms, plus a final render. Two unit requests cross IPC at
once, irrespective of document unit count. Missing/limited/failed units stay as source. Rendering
rejects overflow rather than silently dropping units; cancellation/size failure leaves Source
and Live Preview usable. No provider request starts from opening a mode or editing a document.

For bounded owned packed previews, capture the exact full root with an independent session
pin, serialize cooperatively and transfer the admitted binary buffer to the reading worker.
Count actual binary and envelope bytes against the same message limit. Validate source
identity, parser/renderer versions and every mdast field/range before expanding the root in
that worker. Bound validation-copy/arena and decoder retained/staging overlap within the
existing worker allowance. Release capture/work/output ownership on cancellation and every
failure; reject overflow without a partial plan. Other previews retain their native capture
path. This integration does not activate the main semantic worker's packed transport.

Owned Live Preview models copy only semantic descriptors whose exact source range occurs in
the complete rendered-widget list. Complete snapshot validation precedes selection. Keep
source order and coincident descriptors so existing identity/line-count lookup is preserved.
Reserve selection metadata before allocating it, and admit all copied values and model/index
work independently. The immutable captured document retains every semantic descriptor and
the complete root for reading/export; the full native-input adapter remains available.

Packed preview status remains independently owned through store publication and React use.
Reserve its lease before committing a new model; cancelled/unpublished candidates release it.
Each mounted status consumer acknowledges a committed publication in a layout effect. Retain
superseded publications until every consumer advances or unmounts. Native/empty publications
also advance acknowledgement, including at packed capacity and document close. Keep leased
outline arrays out of React's cached store snapshots; render outline rows directly and capture
only numeric source offsets in event handlers. Abandoned renders acquire no ownership.
This closes bounded status lifetimes, not aggregate snapshot/cache memory calibration.

Reading renders use immutable reconstruction: share untouched source/protected nodes and
rebuild only changed paths, preserving compact position descriptors. Charge new graph,
status/patch metadata and temporary validation/traversal workspace before allocation within
the worker's remaining allowance, retaining the existing message reserve. Reject capacity
without publishing a partial root, preserve per-unit source fallbacks and keep earlier
captures immutable. Native detached reconstruction remains the export/correctness oracle.

Ordinary immutable reading plans project translated inline children directly through the
public renderer state. Preflight each output, private binding and logical aggregate output
limit; retain only admitted occurrence indexes, compact statuses and output references.
Reconstruct one inline unit synchronously while converting it to HAST, then release those
temporary mdast children. Preserve source descriptors and all global reference/footnote
resolution, including table cells and footer definitions. Admit metadata plus one complete
unit workspace before allocation within the same remaining worker allowance; keep the
message/projection reserves unchanged. Do not build or retain translated ancestor paths.
Aliased unit nodes require the existing path-aware reconstruction. Detached reconstruction
and full native rendering remain the independent output oracle. This removes the exact
nested full-translation reconstruction limit; bilingual projection capacity is still separate.

Packed reading extraction may share canonical immutable provider payload/token storage while
preserving every occurrence's private bindings, paths and source ranges. Bound new unit/path/
binding/payload storage, exact pool keys, traversal and projection scratch before retaining;
logical unit, payload and depth limits continue to apply. Release the exclusive packed input
buffer after successful validation/decoding and before extraction. Count decoded storage plus
the admitted shared-plan footprint, future unit/block/map metadata and canonical job copies
against the existing worker allowance; retain actual message and renderer descriptor caps.
Reuse hashes only for internally trusted immutable canonical payloads.

Prepared reading responses retain every occurrence and reference an exact-value provider
payload table. Validate the complete table and all occurrence references before publication;
preserve independent occurrence identities and freeze shared payloads. Charge descriptor
metadata plus unique payload/token storage against the existing descriptor allowance instead
of expanding the shared graph through JSON. Keep logical aggregate payload/unit limits and
actual wire-message limits unchanged; failure to publish a prepare releases its worker plan.

Keep response unit records temporary in the reading worker. Index keys by trusted canonical
payload identity, retaining every occurrence and its private bindings in the captured plan;
ordinary mutable preparation continues to validate and map occurrences independently. Admit
extraction and later block/job/response allocation as separate phases before allocation.
The later phase reserves 2 MiB for one bounded settings/payload validation and hashing job,
plus a complete canonical-payload copy allowance. Release completed extraction scratch,
temporary response records and the input source's logical ownership before rendering; retain
language fields, key/job storage, blocks and the existing rendering reserve. This release does
not establish immediate physical string collection. The worker must post a prepared result
before admitting another operation. Resolve per-occurrence outputs on demand; translated-range
selection follows reconstruction's ordered statuses without copying occurrence maps.

Packed preparation retains block values in a lossless typed store: ten uint32 words per
block for UUID words, ranges, kind index and source-hash words; preserve the footnotes hash
sentinel exactly. Reserve 512 control bytes plus 64 KiB for bounded kind storage/construction
workspace before allocation. Temporary public block records remain charged at preparation.
The controller supplies its mapped records on render; standalone callers that omit them must
separately admit a complete 768-byte-per-block snapshot alongside the existing render reserve.
Do not retain the returned block records or weaken ID/hash/range equality.

Replacement reading uses one labelled language group around the complete projection. Keep
every block's identity and `dir="auto"`, with translated/source-fallback language overrides on
individual prose units. Bilingual layouts retain separate labelled original/translation groups.
This reduces repeated replacement markup; it does not raise projection or mounted-DOM caps.

Immutable packed reading plans may compact private bindings into occurrence-owned node
arrays plus the canonical token descriptions. Keep complete binding snapshots available
without retaining an object for every pair; reconstruct via direct private iteration.
Freeze compact plan/unit/path/snapshot metadata and private group arrays. Preserve ordinary
extraction as the independent oracle. Charge the private index/array/accessor and new generated
text pools before retention; count all occurrence edges and logical payload/output totals
despite sharing. Exact generated type/value text nodes may share immutable identity within
one reconstruction. Weighted admission does not replace runtime heap calibration.

Bilingual layouts use paired top-level semantic blocks, including whole lists/tables and
footnotes, with stable identities mapped through source edits. Side-by-side columns share one
native scroll surface and grid row heights; interlinear stacks each original/translation pair.
No visual line-count or proportional-document-scroll assumption is made. A block anchor and
offset survive projection/layout changes and asynchronous resource sizing. Both copies together
charge the existing 8 MiB projection and 16 MiB mounted-markup limits, with the same math/diagram
caps. Layout/theme changes never invalidate translation keys or start provider requests.

Large bilingual projections may retain an exact-value HTML row dictionary and complete ordered
occurrence/anchor indexes instead of a flattened string. Generate both sides through the same
whole-root reference/footnote renderer; factor only the generated outer pair anchor. Validate
every index/anchor, unique occurrence identity, slot and source range. Charge dictionary text,
all occurrence metadata, slots and block records against the unchanged 8 MiB projection cap;
keep actual serialized worker messages within 8 MiB too. Small projections retain their native
HTML shape. If dictionary construction rejects, preserve the ordinary native admission path.
Opted-in raw HTML keeps whole-fragment parsing, since tags may span logical row boundaries.

Indexed copies mount at most 64 whole logical rows around the native viewport. Reserve height/
anchor/index/reference metadata and independently mounted row markup against the existing
shared 16 MiB widget budget before allocation/mounting. Replace estimated offscreen geometry
with measured row heights; preserve exact block identity/offset across layout and sizing changes.
Sanitize every unique row value before retaining only its ID/slot metadata. Fixed per-side
namespaces and a complete target index allow footnote/reference navigation to offscreen rows.
Release row widgets on removal, preserve focus on the article when a focused row scrolls out,
and clear registrations/observers/ownership on close. Mount admission failure releases the copy
and exposes the existing size error while source editing remains available. Indexed transport
and viewport capacity do not establish ordinary large semantic admission or platform acceptance.
Translated export captures source, language, layout and completed unit outputs once. One pending
confirmation snapshot per document is bounded to 8 MiB of serialized request data, at most 10,000
indexed outputs, 256 KiB per output and 4 MiB aggregate output accounting. Stale captures and
missing units require an explicit export-this-copy/source-fallback choice. The isolated export
worker reparses captured source, validates each output against that source's extraction plan,
and renders both copies through the shared whole-root renderer. Existing export deadlines,
asset/page/output limits and cleanup apply to the combined artifact.

Item 16 transport budgets: two running requests, 32 waiting unique jobs, 128 subscriptions
across owners; one whole prose unit per request. Each request body is at most 256 KiB and
each response at most 2 MiB. The complete job (queue, credential access, cache and retries)
has a 60 s deadline. At most two retries use 250/500 ms backoff or Retry-After within that
deadline. Only 307/308 redirects preserve POST; at most three, always on the original origin.
The endpoint is the full chat URL, including its path/query, with no implicit route rewriting.
Adapters support only temperature (0–2) and maxOutputTokens (1–16,384); defaults 0 and 8,192.
The glossary/formality capability is prompt-based, not a claim of native provider enforcement.
No automatic model download, streaming, neighboring prose context or background translation.

SQLite uses one lazy 128 MiB-heap worker, at most 32 operations/8 MiB queued, 100 ms busy
timeout and a 5 s operation deadline. LRU batches remove at most 128 rows, with 20,000 rows
and a 96 MiB logical budget. The database is capped at 120 MiB; TRUNCATE journaling reserves
the remaining disk budget for its rollback journal. Retain at most one corruption quarantine;
its bytes reduce the new database budget so cache plus quarantine and journal stay within
256 MiB. Clearing closes/removes only the derived database, its sidecars and quarantine,
then opens an empty database without a space-intensive VACUUM. Persisted settings and keys are private
atomic JSON files, read only on explicit translation/settings actions. Key-store operations
have a 5 s deadline; persistent keys use Electron's asynchronous safeStorage API. Session keys
are memory-only, and credentials are bound to adapter, full endpoint and profile. Control
operations serialize with at most eight admitted calls; no provider or cache progress streams
are exposed. One completed result per subscribed unit is the bounded progress primitive.

- Extraction produces typed translation units from mdast; reconstruction replaces eligible
  text while retaining structural nodes. Provider output never becomes executable markup.
- Preserve code, inline code, math, URLs, frontmatter, and diagram source. Use opaque
  placeholders for protected inline spans, and validate placeholder count/identity before
  applying output. Do not send the hidden values to providers. Reject malformed results and
  keep the source block visible. Translate human-readable link labels while retaining targets.
  Canonicalize placeholder identifiers within each unit so equivalent requests can share cached
  work; keep protected values in a separate reconstruction map owned by each source occurrence.
- Transport runs in main with credentials retrieved there. Settings may submit a newly entered
  key through a write-only method, clear the input immediately, and receive only configured
  status afterward. Never return stored keys to the renderer or place them in Zustand.
  Redact credentials and document bodies from logs. Use `safeStorage` from the main process only,
  on explicit user action, never on a startup-critical or per-keystroke path; treat Linux
  `basic_text` and unavailable or locked key stores as unsuitable for persistence and offer
  session-only keys.
  [Credential storage reference](https://www.electronjs.org/docs/latest/api/safe-storage).
- Persist cache entries through a versioned SQLite adapter outside the typing path. Verify
  `node:sqlite` support in the selected Electron runtime before committing to the adapter;
  isolate a supported SQLite-library fallback if necessary.
- Cache identity is the `unitKey` defined in Definitions. Persist successful validated units
  only; keep secrets out of keys. Local translations are document-derived user data: support
  clearing the cache and document its storage location.
- Each subscription carries session identity, `sessionGeneration`, `cacheGeneration`,
  `translationSettingsRevision`, `unitKey`, `occurrenceId`, and cancellation state. Reconcile
  results with these values before updating a consumer. An unrelated edit may advance
  `docRevision` without invalidating unchanged units; changed units stay stale. When duplicate
  units share a request, cancel it only after its last subscriber cancels. Session disposal and
  provider/language changes invalidate subscriptions immediately.
- Start with two concurrent provider requests, provider-aware token/byte batch limits, bounded
  response sizes, and at most two retries for transient network/rate-limit/server failures.
  Do not retry authentication, invalid requests, or malformed structures automatically. Respect
  provider retry delays within a bounded job deadline. Stop issuing requests on cancellation;
  already submitted cloud requests may still incur charges. Keep streaming output provisional
  until a complete unit validates, and persist only validated output. Timeout/cancel aborts
  transport where supported. Reject redirects that change the configured endpoint origin.
- Include every prompt input that affects output in cache identity. If neighboring context
  is later added, include its hash and invalidate affected units; do not promise one-paragraph
  cost for context-dependent translation. Cache clearing advances `cacheGeneration`, invalidates
  old subscriptions, and clears displayed translations. Serialize the clear operation with
  database writes; check generations when work is applied, not just when it is queued. Reads,
  responses, and writes from an older generation cannot restore cleared data. Bound cache
  read/write queues and provider progress events before item 16 can pass its gate.
- Translation starts only on an explicit command. A later edit marks blocks stale; another
  explicit command refreshes missing/stale units. Loading a cached translation is network-free.
- A translated view owns an immutable source snapshot, translation settings revision, and
  validated results keyed by occurrence ID and unit key. Editing leaves its source panes frozen
  and visibly stale, even if background parsing produces a newer settled snapshot. An explicit
  Refresh captures the current settled snapshot, reuses matching validated units, and requests
  missing/stale units. If semantics are pending, wait for the requested revision or show a clear
  cancellation/error state; never silently submit an older snapshot. Unchanged in-flight units
  may serve the refreshed view only after subscription reconciliation. Provider/language changes
  invalidate the old translated view immediately. Export captures both source and validated
  translations immutably so late results cannot change an export in progress.

## Decision rationale and consequences

Whole-document worker parsing provides a correctness baseline for document-wide references
and extension syntax. It adds serialization cost and can delay the newest parse behind obsolete
work; measured end-to-end budgets determine whether transport or incremental parsing needs a
later design. A worker pool or fragment parser is not required to complete M1.

Content baselines, stable source identities, and separate cache keys serve different purposes:
undo can restore saved content at a newer revision, and unchanged units can reuse translations
without losing their source anchors. This requires explicit reconciliation and generation
checks rather than one global revision test.

Source editing remains available when parsing, rendering, translation, or cache persistence
fails. Isolated diagram rendering and bounded queues add lifecycle work, but contain failures
without blocking the editor. Delaying M2 workspace tools is acceptable when M3a can validate the
translation experience sooner.

Platform save semantics and performance remain unverified until implementation and measurement.
Fingerprint checks reduce external-edit races but are not an interprocess compare-and-swap;
atomic replacement does not itself guarantee power-loss durability.

## Ordered implementation work

Each numbered item is a PR-sized unit; split it further when it cannot be reviewed
or verified independently. Check items only after their completion gates pass.

### P0 — Runnable foundation

- [ ] **01. Dependency compatibility and workspace bootstrap.** Create the root and
  `apps/desktop` manifests only; add each `packages/*` manifest when its first consumer lands.
  Commit the npm lockfile, add the shared strict TypeScript configuration, and wire
  `postinstall: electron-builder install-app-deps` so native modules rebuild against Electron
  (`npm ci` alone does not). Supported matrix: Windows 10+ x64, macOS 13+ x64/arm64, Ubuntu
  22.04+ x64. Record CI runner architectures and make packaging targets explicit; verify both
  supported macOS architectures before release. Retain Node 24/npm 11. Verify available stable
  package versions and peer/engine compatibility rather than copying the README's unverified
  version numbers. Record selected versions and Electron's actual embedded Node in
  `docs/development/dependencies.md`. Validate the existing Biome configuration
  against the chosen binary. Install only dependencies required for this stage.
- [ ] **02. Desktop shell and shared contracts.** Add electron-vite main/preload/React entries,
  secure window configuration, runtime-validated IPC results, and a minimal accessible shell.
  Add English/Chinese i18next resources and versioned settings persistence immediately:
  electron-store with `schemaVersion: 1`, and an unknown newer version opens read-only after a
  timestamped backup. Secrets are `safeStorage` ciphertext only, never plain settings. This
  foundation stores theme/preferences; provider configuration arrives with M3a. Establish
  package import boundaries.
- [ ] **03. Development and packaging gates.** Implement the root script contract from
  `CONTRIBUTING.md`: dev, build, check, lint, format, format:check, typecheck, test, test:e2e,
  clean. `build` emits an unpacked app at a path E2E consumes, then installers. Add named
  IPC/window tests: a forged sender frame from a subframe is rejected, unknown channels and
  malformed payloads are rejected, `window.open` and unexpected navigation are blocked, and
  the effective production CSP excludes `unsafe-inline` and `unsafe-eval` for scripts. Add the
  dedicated Electron E2E job with Linux display setup and update `CONTRIBUTING.md` to match.
  Activate the existing three-OS CI matrix; keep packaging nonpublishing and independent of
  signing secrets. A packaged window must launch and load its preload/renderer assets. Update
  setup instructions in both READMEs.

P0 acceptance: a fresh checkout installs with `npm ci` on each OS in the matrix above (network
allowed; "offline" in this plan means runtime behavior, not install); `npm run dev` opens the
app; `npm run check`, `npm test`, and `npm run build` pass. Check unpacked launch on all target
OSes. Signed distribution and public publishing are later release work.

### M1a — Source editing and safe persistence

- [ ] **04. Source editor.** Mount one CodeMirror view with Markdown/GFM syntax, history,
  search/replace, multiple selections, keymaps, indentation, and bracket/quote completion.
  Add New/Open/Save/Save As commands and visible dirty/save/error states.
- [ ] **05. File sessions.** Implement the typed bridge, native dialogs, byte decoding,
  canonical file identity, atomic write path, and the `docRevision`-aware save queue above.
  Preserve BOM/newlines and surface uncertain encoding rather than silently corrupting text.
  Test lossless encoding round trips, replacement metadata, shared-file sessions, Save As while
  a previous save is in flight, case-variant paths resolving to one file record, and injected
  failures around the temp-write/replace boundary. Treat permission/ACL/link limitations as
  explicit outcomes.
- [ ] **06. Auto-save, watching, recovery.** Add conflict handling, close protection, recovery
  snapshots, maximum dirty/checkpoint intervals, and watcher cleanup. Watcher notifications must
  never overwrite dirty buffers. Deduplicate directory watchers and handle replacement events.

M1a acceptance: open/edit/save/reopen Unicode and CRLF fixtures; cancel native dialogs;
undo/redo to saved content clears dirty state at a newer revision; edit during a slow save
remains dirty unless it returns to the captured saved content; disk-full, permission,
locked-file, and external-edit cases preserve recoverable content. Verify a
crash-recovery flow and native shortcuts on Windows/macOS/Linux.
Continuous typing must produce saves/checkpoints within the limits above when storage is
healthy; invalid decoding, unrepresentable text, mixed newlines, and metadata failures never
silently overwrite the original. Inject process exits before/after replacement and distinguish
crash recovery from power-loss durability claims.

### M1b — Shared semantics and Live Preview

- [ ] **07. Semantic snapshots and render pipeline.** Add the whole-document worker,
  position-bearing mdast, outline metadata, block identities, and bounded caches. Render through
  one shared mdast → HTML pipeline with DOMPurify and an explicit URL/HTML policy: `https`, the
  app asset protocol, and raster `data:image/*` are allowed; SVG data URLs are excluded (generated
  math SVG is sanitized inline). `javascript:`, `file:`, and `vbscript:` are
  blocked; raw HTML is escaped unless the document opts in, then sanitized. Remote images are off
  by default; when allowed per document, they are fetched through a main-process proxy so the
  production CSP never changes. Validate proxy URLs and redirects, omit ambient cookies and
  credentials, and enforce asset byte/time limits. Implement latest-request scheduling, bounded
  caches, error recovery, and phase-level timing before optimizing the parser. Exports and
  translation request a specific current settled snapshot. Update parsing documentation in the
  same PR so every architecture description matches this decision.
- [ ] **08. Inline Live Preview.** Add cursor/selection-aware decorations for headings,
  emphasis, links, lists, task lists, and inline code. Hide markers only outside active ranges.
  Keep composition/IME text visible. Add the status-bar mode control. All editing actions
  dispatch CodeMirror transactions.
- [ ] **09. Block rendering.** Add source-revealing widgets for GFM tables, code fences,
  and lazy MathJax SVG with mhchem. Enforce the Numeric limits for TeX length and expression
  count. Task toggles modify source. Sanitize or constrain generated math/diagram output as well
  as Markdown HTML. Unsupported constructs remain editable source.
- [ ] **10. Performance and correctness gate.** Measure typing, worker transport, semantic
  freshness, widget updates, and retained memory. Keep the whole-document worker if it meets
  budgets. Fix viewport rendering, redundant scans, or transport first when those dominate.
  Add dependency-aware incremental fragments only for a demonstrated remaining parse bottleneck,
  with a separate design and equivalence tests against full parsing. Include reference-definition
  edits, footnote renumbering, nested containers, fence changes, duplicate paragraphs, and
  source-range shifts. Cached widgets do not depend on implementing a fragment parser.

  Local progress on 2026-10-24: reproducible packaged corpus, 50-cycle retained-resource,
  large-source and cold-widget benchmarks are in `test/benchmark/`. Profiling identified and
  bounded Lezer's non-interruptible long-inline parsing on the main thread. Dense-block
  preparation now yields with an atomic, cancellable install. Transferable whole-root results
  and conservative grammar selection improve dense freshness; nested resource fallback and
  remaining acceptance coverage still leave this gate unchecked. Exact-50-MiB editing and
  cancellation during large plain-text paste and replace-all preparation now have packaged
  evidence; broader lifecycle/platform coverage remains. Current
  evidence and limitations are in [VALIDATION.md](../validation/implementation-history.md).

M1 acceptance: Ctrl/Cmd+1 and +2 retain text, selection, scroll anchor, and undo history.
CommonMark and GFM parser fixtures pass independently of the application's deliberate HTML
sanitization policy; rendering-policy tests cover that difference. Chinese/Japanese IME,
multi-selection edits, paste, malformed math, and long lines remain editable. If incremental
parsing is introduced, results equal full parsing after each edit in representative edit sequences.
Worker failure leaves source editing, undo, saving, and recovery operational. Pending semantic
state is visible and never silently exported or submitted as though it were current.
Inserting text before repeated blocks preserves unambiguous occurrence IDs; duplicate creation,
split/merge, and ambiguous reconciliation never attach results to a different occurrence.

### M2 — Workspace and export

- [ ] **11. Multiple document sessions.** Add tabs, folder selection, a lazy file tree,
  recent workspaces, drag/drop and OS file-open events. Each tab retains its editor state,
  watcher, selection, and recovery state. Restore sessions without discarding unsaved drafts.
  Mount only the active view, pause inactive derived work, and reuse main-owned file/watch records.
- [ ] **12. Navigation and settings.** Add outline/heading jumps, counts, filename fuzzy search,
  cancellable ripgrep full-text search, themes, system spellcheck, and persisted settings.
  Define ignore rules, result limits (Numeric limits), missing-binary errors, and encoding
  behavior for search. Vendor the ripgrep binary as a per-architecture dependency, unpack it from
  the app bundle, and verify its path before spawning. Stream result batches with an explicit
  truncation limit; terminate prior searches on a new query and spawn ripgrep with an argument
  array and `shell: false`.
- [ ] **13. Clipboard and assets.** Convert clipboard HTML using Turndown/GFM; import pasted
  images with safe unique names and relative links. Resolve local assets through a controlled
  app protocol with canonical-path authorization. Avoid deleting potentially referenced assets.
  Add Mermaid through the isolated rendering process defined above. Apply the Numeric limits,
  replace pending jobs for the same occurrence, and prioritize visible consumers within the
  bounded queue. Discard obsolete jobs and schedule remaining visible work as capacity becomes
  available. Test a hung diagram without interrupting editor input, saving, or other windows.
- [ ] **14. HTML/PDF export.** Capture a current settled source snapshot, or obtain explicit
  confirmation to export a visibly identified stale translated snapshot. Use the shared
  renderer. Self-contained HTML bundles allowed local assets; PDF waits for fonts, math,
  diagrams, and images in an isolated print window. Provide clear missing-asset and export-failure
  states.
  Add cancellation, resource/total deadlines, asset byte limits, and a bounded page/image-size
  policy. A failed renderer cannot leave the print window or its temporary assets behind.

M2 acceptance: files with identical names in different folders stay distinct; switching or
closing tabs preserves pending edits; workspace search cancels cleanly; exports preserve
tables, Unicode, code, images, and math. Test keyboard-only use, both themes, and offline use.
Diagram timeout/crash tests prove process isolation, restart limits, cleanup, and source fallback
in packaged builds. Export tests cover cancellation and edits or late translations during export.

### M3 — Structural translation

- [x] **15. Offline translation harness.** Implement extraction/reconstruction, placeholder
  validation, capability flags, and deterministic fake-provider fixtures before network adapters.
  Cover lists, tables, emphasis, references, repeated units, partial failures, and malformed output.
- [x] **16. Transport, credentials, and persistent cache.** Implement provider settings,
  cancellation, bounded scheduling, SQLite migrations, cache clearing, and retry/error reporting.
  Add one OpenAI-compatible adapter first; support an Ollama adapter without a cloud account.
  Keep HTTP limited to explicitly configured loopback endpoints; require HTTPS for remote hosts.
- [x] **17. Replacement translated preview.** Add target-language selection, Translate/Cancel,
  block progress, Retry Failed, cached-offline rendering, and stale-result handling. Preserve
  the original editor buffer and show source fallback for missing/failed translations.
- [x] **18. Bilingual layouts and export.** Add side-by-side block anchors and block-interlinear
  original/translation pairs; avoid assuming visual line counts match across languages.
  Prevent scroll feedback loops and preserve anchors as translated heights change. Export a
  snapshot of language, layout, and translations; offer a choice when some units are missing.
- [x] **19. Additional providers.** DeepL is implemented and verified locally on Windows;
  Google Cloud/LibreTranslate remain optional follow-up adapters.
  DeepL implementation contract: main-only native HTTP with `DeepL-Auth-Key`, full translation
  endpoint preserved, XML v2 over canonical prose/token IDs only, and strict token validation
  before reconstruction. Never send source bindings, HTML, code, math or document metadata.
  Discover stable language/features using authenticated `/v3/languages?resource=translate_text`
  on explicit Load supported languages or a cache-miss Translate command; opening settings,
  reading and offline cache lookup must remain network-free. Metadata is at most 256 KiB/512
  languages, 10 s including retries, one explicit discovery plus the existing two unit jobs;
  retain only one connection's metadata for 15 minutes. Credential/settings changes cancel
  discovery and reject late results. Translation JSON is capped at 128 KiB; all existing unit,
  response, redirect, retry, deadline and generation barriers remain. Native formality follows
  target support; an existing glossary UUID requires explicit source and both languages'
  glossary support. No remote glossary creation or chat-only options. HTTP 456 is a distinct,
  non-retried quota failure. Configuration schema 2 reads schema 1; older apps preserve the
  new configuration as future data. Gate with loopback-only native transport, hostile XML,
  cancellation/race, offline restart and packaged settings/reading tests before checking 19.
  Each adapter declares supported glossary/formality/language options and passes shared contract
  tests. Hide unsupported settings instead of pretending all providers behave identically.
  Windows evidence: 1,681 tests pass (one POSIX-only skip), all 49 packaged flows pass, and
  a rebuilt unsigned NSIS artifact is recorded in VALIDATION.md. Real provider accounts and
  broader platform/release acceptance remain unverified.

M3 acceptance: provider payload inspection proves protected content is absent; source code,
math, links, and structure survive reconstruction; editing one independent paragraph requests
only its missing units; changing provider, endpoint path/query configuration, model, source/target
language, or glossary invalidates appropriate cache keys. UI-only settings preserve those keys.
Cache hits survive restart. Switching documents/languages or cancelling cannot apply stale
results. Tests use fake/local services; paid-provider checks are explicit opt-in runs.
Unrelated edits preserve in-flight unchanged units. Shared-request cancellation, partial streams,
token-limit responses, clear-cache races, locked key stores, database corruption, and storage
quota exhaustion have deterministic tests. No failure in these paths blocks source editing.
Test duplicate units with different protected inline values to prove reconstruction restores
each occurrence's own content. Cache clearing in one window invalidates queued work in every
window, and stale translated snapshots remain explicit until refreshed.

### M4 — Full feature completion

Proceed from the tested functional baseline. Give each feature a concrete design and
observable acceptance checks; preserve the source/editor/translation contracts above.

- [x] **20. Focus and typewriter writing modes.** Keep the active surface mounted, provide
  a visible keyboard-accessible exit, retain errors/save access, and center the main caret
  without rewriting source, selection or history. Allow manual scrolling. Synchronize
  pending input and verify Source/Live, document edges, resizing and document switches.
- [x] **21. Extended Markdown and legacy diagrams.** Add definition lists, sub/superscript
  and emoji shortcodes consistently in parsing, Live Preview, translation and export.
  Add explicit compatibility handling for legacy sequence/flowchart fences in the existing
  isolated diagram service. Preserve source text and show unsupported source truthfully.
- [x] **22. Visual table editing.** Add row/column insertion, removal, movement, alignment
  and keyboard navigation through source transactions with undo and selection preservation.
- [x] **23. Typography and custom themes.** Add per-document writing typography and local
  user-selected CSS with bounded import, validation, reset and usable fallback controls.
  Keep custom document styling separate from trusted application controls.
- [x] **24. Presentation and image export.** Present source-derived slides with keyboard
  navigation and exit. Export the selected source/reading snapshot to bounded raster images
  using the isolated export path; preserve assets, math, diagrams and bilingual choices.
- [x] **25. Optional Pandoc export.** Execute a user-selected local Pandoc binary with
  explicit format/profile choices, argument arrays, no shell, cancellation and deadlines.
  Report missing tools and failures without modifying the document.
- [x] **26. Plugins.** Define a stable, versioned, permission-scoped extension contract,
  installation/disable/removal and failure isolation. Keep renderer privileges narrow and
  require explicit grants for filesystem or network capabilities.
- [x] **27. Sync adapters.** Define connection scope, persistent baselines, conflicts,
  offline edits, retries and disconnect behavior. Never silently replace divergent local
  or remote content; expose reviewable conflict resolution and preserve recovery copies.
- [x] **28. Distribution polish.** Produce reviewable local packages, retain platform CI
  and installer smoke checks, and configure signing/update hooks separately from ordinary
  builds. Public signing, publication and account-specific deployment are release actions;
  an unsigned local deliverable does not require publication.

Focus/typewriter is verified on the Windows baseline (VALIDATION.md, iteration95).
Extended Markdown and the documented legacy-diagram subset are verified on the Windows
baseline (ADR006 and VALIDATION.md, iterations96–97). Visual table editing is verified
on the Windows baseline (ADR007 and VALIDATION.md, iteration98). Per-document typography
and bounded local CSS are verified on the Windows baseline (ADR008 and VALIDATION.md,
iteration99). Presentation and PNG/JPEG export are verified on the Windows baseline
(ADR009 and VALIDATION.md, iteration100). Optional local Pandoc export is verified on the
Windows baseline (ADR010 and VALIDATION.md, iteration101). Local command plugins are
verified on the Windows baseline (ADR011 and VALIDATION.md, iteration102). Explicit folder
and WebDAV file sync is verified on the Windows baseline (ADR012 and VALIDATION.md,
iteration103). Local distribution and separate release hooks are verified on the Windows
baseline (ADR013 and VALIDATION.md, iteration104). The Windows feature deliverable is
complete under the delivery priority above. Historical broader qualification gates retain
their scope; physical/platform/public release acceptance is not implied.

## Validation and release gates

Every code PR runs `npm run check`, `npm test`, and `npm run build` as already required.
Changes to full editing flows, IPC, or windows also run `npm run test:e2e`. Add a dedicated
Electron E2E job with the needed Linux display setup; retain three-OS packaging checks and
run native platform smoke tests before milestones. Documentation-only changes need link and
diff checks.
On Windows, `npm run test:installer` executes the built NSIS package in a fresh ignored
directory, exercises the installed app with an isolated profile, and uninstalls it. Require
exact installed runtime bytes, byte-preserving save/reopen and restored registry/shortcut/
default-association state. The Windows E2E job reuses the archived build for this check and
retains its evidence on failure. Interactive wizard/elevation and physical OS integration
remain separate acceptance checks.
Reuse built artifacts for E2E within each OS/job pipeline, and cache npm downloads using the
lockfile. Avoid rebuilding installers for each E2E scenario or running the same tests twice.
Keep release signing/publishing outside ordinary PR validation.

Test effort should focus on observable risks: byte preservation, revision races, parser
equivalence, source/preview synchronization, translation invariants, and packaged startup.
Keep malicious HTML/URL/SVG fixtures for both preview and export. Enforce the Numeric limits in
tests (over-cap document, oversized TeX, truncated search) and keep the named IPC/CSP tests from
item 03. Do not use snapshot-only tests as proof that edits or saves are correct.

Initial performance budgets, to be calibrated on a recorded reference machine. Metrics are
separated so a smooth editor cannot hide a stale preview, and slow paint cannot be confused with
slow parsing:

| Scenario | Target | Measurement |
| --- | --- | --- |
| Typing in a 1 MiB prose document | p95 input-to-paint under 50 ms | Scripted edits with Live Preview and semantic work enabled; include interference from background work |
| Status and selection callbacks | p95 under 8 ms per callback | No serialization, hashing, or AST work on this path |
| Semantic request callback | p95 under 25 ms | Debounced 1 MiB serialization, hash, and message post, off the keystroke path |
| Whole-AST apply | Yields to the event loop at least every 4 ms; 1 MiB total under 150 ms | Applied results only, measured separately from parse and transport |
| Semantic freshness after typing stops | p95 within 500 ms on the reference corpus | Last edit → current result applied, including obsolete-parse wait and all transport/application costs; report fallback frequency separately |
| Switch Source/Live Preview on that file | p95 under 100 ms | Selection and scroll retained; use only current valid decorations, otherwise reveal source while semantics catches up |
| Open a 1 MiB file | Editable source within 1 s | Local disk, packaged build; parsing may finish later |
| Large input stress | 5 MiB stays cancellable and editable; 50 MiB cap enforced | Paste, replace-all, long line, nested structure, exact-50-MiB UTF-8 open/edit/undo/save/reopen and over-cap file; completed-operation and in-flight-cancellation evidence remain distinct |
| Background backpressure | One parse running, at most one pending; final active document settles within 1.5 s on the reference corpus after interaction stops | Record obsolete-parse wait; separately inject slow/hung parsing to verify queue limits, watchdog, restart cap, and source fallback |
| Resource lifecycle | Retained memory grows under 10% and stays under 250 MB after warmup and 50 open/close cycles | Observe renderer/main/worker heap, watcher and listener counts; account for GC timing |

Record OS, CPU, memory, build, corpus, and cold/warm state with results. When budgets fail,
profile before adding worker pools or changing the document model. A 1 MiB single paragraph
needs its own stress case; block caching alone does not make that case cheap.
Include cold first use of math/diagrams, repeated identical paragraphs, mixed scripts and RTL,
many tiny blocks, and repeated tab switching. Track source input-to-paint and semantic freshness
separately so a smooth editor cannot hide an indefinitely stale preview. Track translation
requests/tokens as well as latency; repeating a cached request should make zero provider calls.
Report timeout, size-limit, and failure fallbacks alongside latency percentiles; a reference
corpus case that falls back to Source mode has not passed the Live Preview freshness gate.

## First implementation handoff

Start with items 01–03 only. Their reviewable output is the workspace, secure application shell,
working script/CI contract, tested packaged launch, and corrected setup documentation. Then
implement 04–06 to reach the first useful editor. At 10, record whether measurements justify
incremental semantic parsing; a passing whole-document worker is a valid M1 completion.
Then choose M2 or M3a without taking on the other's dependencies. Keep every increment runnable
and use the acceptance gates above to decide when a milestone is complete.
