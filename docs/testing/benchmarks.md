# Packaged performance gates

Build first with `npm run build`, or `npm run build:app` then `npm run package:dir`.
Run without concurrent builds/tests:

```sh
npm run test:performance
npm run test:performance -- --grep corpus
npm run test:performance -- --case single-paragraph --grep corpus
npm run test:performance -- --grep retained
npm run test:performance -- --grep "source stress"
npm run test:performance -- --grep "exact 50 MiB"
npm run test:performance -- --grep "cold math"
npm run test:performance -- --grep "continuous dense"
npm run test:performance -- --profile
```

The runner selects the packaged executable for this OS/architecture. The profiler is
diagnostic and runs only with `--profile`; it does not assert a latency budget. All runs use
temporary writing profiles and generated documents, and delete those profiles on completion.
They make no translation requests and use no real credentials. Synthetic paste leaves the
OS clipboard unchanged. These tests do not install, sign or publish the app.

Reports, attachments and failure traces live in distinct ignored
`test/benchmark/results/<run-id>/` directories; subsequent runs retain earlier reports. JSON
records OS, CPU, logical cores, installed/free RAM, runtime versions, date and SHA-256 of
both executable and app.asar. Hashes identify the tested bundle; an Electron executable alone
does not identify its application assets. Run IDs distinguish repetitions without implying
equivalent cold/warm OS caches. Raw CPU/timeline profiles can be loaded in Chromium DevTools.

## Corpus

Native event replay can be compared independently of the other parser patches:

```sh
node test/benchmark/profiles/compare-parser-lifetimes.mjs --event-copy
```

Four fresh processes compare hash-verified original/patched subtokenizer sources under
default/development exports, keeping all other patches constant. Each compares 1,642 complete
document/render hashes and nine raw-event fixtures, including a list above the old splice
chunk boundary. The report is `test/artifacts/logs/parser-replay-compatibility.json`. The pinned direct-copy
patch reduces sampled cumulative nested Node allocation by about 13%; the minified Electron
producer still observes approximately 323/316 MB additional private commitment. Neither
sampled allocation nor this physical observation closes native/aggregate admission or nested
Live acceptance. See [patch provenance](../patches/micromark-replay.md).

The application now opts into native event-span compilation. The 13% allocation comparison
above predates that change. Compare the current span path against the previous whole-event
compiler without editing installed dependencies:

```sh
node --expose-gc test/benchmark/profiles/profile-parser-constructs.mjs --child guarded --profile-prefix spans-current
node --expose-gc test/benchmark/profiles/profile-parser-constructs.mjs --child guarded --whole-events --profile-prefix spans-whole
```

Each child emits a JSON report to stdout and writes separately named CPU/heap profiles under
`test/artifacts/logs/`. Redirect stdout into that directory to preserve the report. `--whole-events`
reconstructs the exact previous paired lifetime patch through load hooks; all other parser
patches and grammar guards remain identical. Reports record installed/executed compiler
hashes and assert actual loaded export paths. Both paths must match the complete recorded
nested root and descriptor count; compare their complete semantic digests too. Add
`--conditions=development` before the script to inspect
that export. The parent grammar-comparison command also forwards `--whole-events` and uses
a separate default profile prefix for it. CPU/endpoint/allocation samples remain diagnostics,
not physical admission, UI freshness or semantic activation evidence. The span path retains
global definitions, one compiler state and whole-root transforms; a span may still cover the
entire document. See [native lifetime/span provenance](../patches/parser-lifetimes.md).

The production parser now counts source code points without expanding the source into an
array. Its numeric UTF-16 scan preserves paired and lone surrogates and original-source
counts, including BOM/CRLF. Fragment metadata uses the same constant-space counter; packed
validation retains its independent cooperative count. Compare the original array path with:

```sh
node --expose-gc test/benchmark/profiles/profile-parser-constructs.mjs --child guarded --profile-prefix source-count-array --source-count-array > test/artifacts/logs/source-count-array.json
node --expose-gc test/benchmark/profiles/profile-parser-constructs.mjs --child guarded --profile-prefix source-count-scan > test/artifacts/logs/source-count-scan.json
```

The array substitution occurs only inside the diagnostic Vite transform. Complete semantic
digests except timings must match; recorded root/hash/count assertions remain. Each child
also samples eight isolated character counts with collected allocations included, after the
separate complete-parser allocation sample. On the 1,048,669-code-point nested source,
counting samples report 67,114,944 allocated bytes for the array path and zero sampled bytes
for the scan. Profiles under `test/artifacts/logs/` retain both allocation records. Zero sampled allocation
is not an assertion about all runtime initialization or total parser memory. The complete
Electron producer still samples roughly 280/258 MB additional private commitment on
first/repeated nested admission, so native/aggregate physical admission and transport
activation remain open. `node test/benchmark/profiles/profile-packed-renderer-memory.mjs --process-memory
--producer` measures that full producer separately; save reports before repeating it.

UTF-8 size-only checks now use an exact numeric scan through the pure
`@manuslip/core/text` entry point. Semantic/message admission, file snapshots/save/recovery,
export, diagram/translation guards and editor/replacement accounting avoid full encoded
copies. Editor byte accounting walks CodeMirror rope pieces without joining the document;
it preserves surrogate pairs across pieces and the original expanded edit windows. The
actual wire encoders and bounded paste/serialization chunks retain their existing behavior.

```sh
node test/benchmark/profiles/profile-text-size.mjs
```

This launches fresh encoder/scan processes, compares complete byte lengths with native
`TextEncoder` and writes `test/artifacts/logs/text-size-profile.json`. Four size checks of the 50 MiB
fixture allocate 209,715,200 encoded bytes in the original path and none through an encoder
in the scan path. Total measured CPU time is 167.8 versus 191.2 ms in one observation; larger
ASCII scans trade CPU work for avoiding the temporary buffer. The probe also covers complete
2 MiB source, mixed Unicode and an 8 MiB JSON envelope. It records actual encoder output
sizes, helper source hash and endpoint process memory. These are not physical peaks or UI
latency results. JSON spelling, JavaScript string flattening, actual output encoding and
native parser/renderer allocations remain separate costs. Packaged corpus and exact 50 MiB
tests still govern application acceptance.

The application span compiler also has a source-shape diagnostic:

```sh
node test/benchmark/profiles/profile-parser-spans.mjs
node test/benchmark/profiles/profile-parser-spans.mjs --development
node test/benchmark/profiles/profile-parser-spans.mjs --natural
node test/benchmark/profiles/profile-parser-spans.mjs --development --natural
node test/benchmark/profiles/profile-parser-spans.mjs --fixture quote
```

Fresh processes compare whole/span compilation for complete approximately 1 MiB repeated
nested containers, one quote, one list and one inline-rich paragraph. Whole semantic document
hashes and both raw-HTML policy render hashes must agree. It checks actual loaded exports,
raw-event conservation and master-array release and reports maximum raw/resolved/list-prepared
span lengths. Reports are `test/artifacts/logs/parser-span-shapes-{default,development}[-natural].json`;
a selected fixture adds its name to the filename. Run comparisons before replacing reports
if retaining a predecessor measurement is required. All dependency inputs remain unchanged.

The observer retains only numeric samples. Default mode forces three GCs at endpoints and
strictly larger event counts per phase; natural mode collects only before parsing. Samples
can miss peaks and invalidate timing. The whole-event observer keeps its original input
through compilation; that stage includes observer-imposed retention. Neither path establishes
physical admission. A single container or forward-linked flow may still cover the entire
source, even when the repeated nested fixture produces many small spans. The private compiler
clears its redundant resolved input after list preparation, before constructing nodes; the
preceding lexer/postprocessing peak remains. See VALIDATION.md for exact source/patch hashes.

The native postprocessing phases have a separate graph diagnostic:

```sh
node test/benchmark/profiles/profile-parser-phases.mjs
node test/benchmark/profiles/profile-parser-phases.mjs --development
node test/benchmark/profiles/profile-parser-phases.mjs --natural
node test/benchmark/profiles/profile-parser-phases.mjs --development --natural
```

Each launches a fresh Node process and instruments exact hash-verified installed sources
through load hooks. It explicitly reconstructs the whole-event compiler path; the application's
private span compiler is outside this diagnostic. Only the complete private `fromMarkdown` event array is sampled; recursive
child content resolution is excluded. Reports are
`test/artifacts/logs/parser-postprocess-phases-{default,development}[-natural].json`. The full nested source
and position-bearing root hashes and all 31,492 descriptors must match the independent oracle.
The requested export paths and completion/compaction invariants are asserted.

Default mode forces three GCs at every phase. `--natural` collects only before parsing and
records uncollected endpoints. Both deliberately retain the complete event array through
compilation. Numeric context counting allocates temporary Sets after each sample, so natural
samples also include observer allocation. These are diagnostic Node graph/process endpoints;
they can miss synchronous peaks and do not measure valid latency, Electron physical admission
or simultaneous application ownership. No installed dependency is modified. See the native
postprocessing checkpoint in VALIDATION.md for measurements and rejected release prototypes.

Encoder construction has a separate diagnostic:

```sh
node test/benchmark/profiles/profile-packed-encoder-budget.mjs
# With a preserved pre-change codec in test/artifacts/logs/packed-position-key-baseline/:
node test/benchmark/profiles/profile-packed-encoder-budget.mjs --baseline
```

It writes `test/artifacts/logs/packed-encoder-budget.json`, comparing exact byte-only encoder output and
complete decoded snapshots against the optional live construction ledger. `--baseline`
instead loads the archived pre-position-key encoder, compares all CommonMark examples in
both grammars, and records the oracle source hash. That mode requires the ignored archive;
it fails if the archive is unavailable. The large 256 MiB / 4M-visit
run quantifies weights only; a separate attempt uses the owned preview's 32 MiB / 800k-visit /
512-depth limits. Source/native input and the legacy oracle remain live. Reported weights
are not measured heap/process bytes or a portable memory bound. The encoder charges its
tables, frames/reference arrays, native key spellings, writer chunks and final output, and
releases completed scratch. Key enumeration remains atomic and is admitted after its result
exists, before filtering/shape construction. The two-argument experimental codec retains its
existing byte-only contract; callers must opt into construction limits. Production bounded
preview preparation does so and retains its complete native fallback on capacity rejection.
This diagnostic does not enable semantic transport or close aggregate ownership/calibration.
Position and array/object records use a typed index of hash, record ID and emitted body offset.
Hashes select candidates; exact tags, array lengths and all uint32 coordinates/references
are compared against immutable body bytes before sharing an ID. Full hash collisions do not
merge distinct records. Hashing and comparison yield every 256 values, and rehashing yields
every 256 old slots/probes. Growth admits overlapping old/new tables before allocation;
cancellation releases the candidate table. Explicit construction limits also cap probing at
256 slots, while byte-only callers retain their previous contract. The complete nested
diagnostic now fits the existing 32 MiB encoder allowance; this does not establish its
application readiness or aggregate process memory use. Completed records emit straight
into body chunks; their record objects and completed child arrays are not retained. Root
resolution precedes dropping intern lookup tables. Header chunks, body chunks and one
combined final output are admitted independently under one actual message-byte cap.
Shape lists stay charged; the construction report records both peak and final weights.
Explicitly bounded encoding also rotates its completed-object identity memo after 4,096
entries. Exact value interning preserves wire IDs after eviction; revisits consume normal
traversal admission. Active cycle detection is independent. Byte-only experimental callers
retain the previous memo behavior. Repeated sharing may exhaust the visit allowance sooner
with the bounded memo, even when a full unbounded identity memo would avoid those visits.
This is storage accounting,
not a process-memory measurement or activation evidence.

Six generated UTF-8 files of approximately 1 MiB: prose, one long paragraph, mixed CJK/RTL,
identical short paragraphs, many small paragraphs and nested containers with references.
Each report records fixture byte length and SHA-256. One process opens/closes them in order;
the semantic worker is cold only for the first file, and source/cache misses are distinct.
`--case` selects one shape and starts a fresh process; never compare that run as though it
had the same worker warm state as its position in the full corpus.

Each ready file receives 20 edits, each waiting for the current semantic result, then 20
selection moves and 20 Source/Live transitions. Exact saved text and cursor status are checked.
Each mode transition waits for its completed frame measurement before issuing the next
shortcut, so a fast reversal cannot censor an unfinished sample.
These are settled-edit samples, not continuous-typing/backpressure measurements. Initial or
later Source fallback is counted explicitly and fails the Live Preview acceptance gate.
Sample-count assertions prevent missing work from passing. An oversized AST remains a
failure of the corpus gate even though Source fallback correctly protects editing.

Input timing runs from captured browser keydown to the second animation frame. This is an
estimate of the next painted frame, not compositor presentation. Open timing starts at the
Open command's browser click and ends after the editable content appears and an animation
frame runs; native user dialog dwell is mocked out. Phase measures cover editor callbacks,
debounced request flattening/post, response decoding/validation, cooperative apply and worker timings.
Freshness includes debounce, queues, worker parsing/rendering, transport, validation and apply.
Worker phase summaries and cold results are reported separately. Percentiles use nearest rank.

Returned results now transfer one UTF-8 JSON buffer. Serialization includes JSON encoding and
UTF-8 creation; renderer validation includes fatal UTF-8 decoding, JSON parsing and range checks.
`transportOutMs` now stops at renderer message arrival, before decoding/validation. Historical
measurements included validation in this field; do not directly compare those fields without
that distinction. End-to-end freshness retains all of those costs. The wire limit and doubled
snapshot accounting include a 1,024-byte reserve for the identity/metadata envelope. No root
nodes, references, positions or rendering data are omitted to reduce a payload.

Apply preparation now runs in cooperative slices, with one complete install. Each accepted
snapshot records its maximum uninterrupted slice, slice count and summed active time in
`semantic-apply` details; the total measure also includes scheduling waits. The final install
and status update are included in its slice. Diagnostic bookkeeping follows the timed body.
The gate asserts at most 4 ms for every accepted snapshot's maximum and under 150 ms total,
independently of freshness. Individual `semantic-apply-slice` traces are capped at 200 entries;
per-snapshot maxima retain evidence even if earlier trace entries are cleared. Cancelled
preparation may produce slice traces but never an accepted apply or a passed sample count.
No production diagnostic IPC or editable buffer duplicate is introduced.

Bounded owned-preview candidates now include renderer-side MSP2 encoding and arena indexing
in this same cooperative apply task and its per-snapshot maxima. The native path continues
for larger inputs. Encoding yields during traversal, string emission and output copying;
native key enumeration, source admission, structural keys and contiguous allocation remain
atomic. This does not enable MSP2 transport or prove all packed slices meet 4 ms.
`node --expose-gc test/benchmark/profiles/profile-packed-encoding.mjs` separately checks cancelled/completed
encoder input collection while closed work handles remain retained, writing
`test/artifacts/logs/packed-encoding-profile.json`. Its Node step timings are diagnostics, not packaged gates.

Packaged correctness E2E separately holds native task continuations, edits the document while
its first preparation is pending, then releases those continuations. It asserts that only the
newest complete snapshot becomes current, counts include the edits and exact saved content
survives. It does not establish throughput under arbitrary continuous input or rapid tab changes.

## Lifecycle

Ten approximately 100 KiB mixed-script files warm the source/semantic path. Fifty subsequent
open → semantic ready → close cycles sample memory every ten cycles. Each checkpoint runs
main-process Node-inspector GC and Chromium HeapProfiler GC on the renderer and attached
semantic worker targets. Isolate IDs avoid double counting shared targets. Snapshots retain
heap-used, external/embedder/backing storage and process RSS as separate fields.
Each checkpoint waits at most five seconds for `FSReq*` filesystem requests to reach zero
before recording its snapshot. The report retains every observed pending count in
`filesystemPendingSamples`; requests that never settle fail the test. Native watcher counts
are still compared exactly and must be absent after closing files. This prevents a completed
temporary filesystem request from being treated as a watcher-count change.

The aggregate retained measurement is main heap-used + external storage plus each unique
renderer/worker isolate's used heap, embedder heap and backing storage. It is an estimate of
tracked allocations, not total RSS or all native allocations; process metrics remain visible
in the report. This test asserts less than 10% growth and an aggregate below 250,000,000 bytes
(250 MB, following ADR 002), stable watcher resource counts, listener counts and target counts,
no remaining native file watchers, and presence of the semantic
worker. It does not establish lifecycle budgets for math, diagrams, translation or export.
Probes use local inspector/CDP APIs via test automation, not application IPC or a network
debugging listener. The long-lived semantic worker is intentionally reused between files.

## Stress and cold widgets

The separate development diagnostic
`node --expose-gc test/benchmark/profiles/profile-semantic-packing.mjs` profiles a complete lossless packed
snapshot of the exact nested corpus fixture, with whole-root/projection/structured-clone
equivalence assertions. It writes `test/artifacts/logs/semantic-packing-profile.json`. This is experimental
Node evidence; application transport and packaged corpus gates remain unchanged. It now also
validates an owned indexed arena, compares every field through direct reads, checks all block
ranges and extracts a selected nested subtree under independent budgets. The packed wire fits
8 MiB; the arena/source/outgoing-copy accounting fits 16 MiB. Full parsing/encoding, complete
peak/lifetime accounting and packaged observations still prevent production activation.
Design and activation gates are in
[ADR 003](../adr/003-semantic-snapshot-packing.md).

Stress opens 5 MiB long-line and nested files in Source mode, edits/saves exact text, pastes
5 MiB, replaces repeated markers, closes search with Escape, edits/saves again and verifies
over-cap file rejection without rewriting that file. Paste/replace frame estimates start
inside the renderer and exclude test transport. Both wait for their actual atomic commits,
including staged preparation, before estimating the painted frame. These checks cover
completed operations and subsequent editing; physical IME behavior and a 5 MiB latency target
remain separate work.

Packaged correctness in `test/e2e/large-paste.spec.ts` holds native scheduler continuations after
actual preparation begins, then cancels a greater-than-5-MiB plain-text paste by button,
Escape and tab suspension. Exact source remains unchanged; releasing old continuations cannot
insert stale text. The same fixture completes with normalized line breaks, exact save and
one-step Undo/Redo. Pending cancellation controls are checked with keyboard input, Chinese
dark mode at 320px and native 200% zoom. Synthetic DOM paste leaves the OS clipboard alone.
This proves cancellation before the atomic insertion, not preemption inside a final transaction.

`test/e2e/replace.spec.ts` separately holds actual replacement-worker requests for button, Escape,
editing and tab-cancellation races, then verifies exact greater-than-5-MiB completion and
isolated Undo/Redo. A real pathological regex runs only inside the worker while the editor's
query remains harmless: Cancel and the external five-second deadline both invalidate the job
and terminate the native worker. CDP target polling every 50 ms distinguishes native shutdown
from prompt UI cancellation. Chromium's forcible-termination grace is approximately two
seconds; the local shutdown check allows three seconds after Cancel, while the control must
clear within 500 ms and actual editing/Undo remains available. This is a native shutdown
observation and regression budget, not an instantaneous-termination guarantee. Timeout permits
an explicit successful retry. Localized keyboard/layout checks cover Chinese dark mode,
320px and native 200% zoom.

The separate boundary scenario opens a valid UTF-8 file of exactly 52,428,800 bytes, containing
CJK and supplementary characters with wrapped lines. It rejects a typed byte at the cap and
a synthetic DOM paste replacing one ASCII byte with three UTF-8 bytes. The OS clipboard is
unchanged. A same-size selection replacement, undo, redo, explicit save, close and reopen must
preserve whole-file SHA-256; the reopened editor also reveals the saved tail. Open/reopen
timings use the same editable-open method, without a 50 MiB latency budget. This covers one
Unicode fixture on the tested platform, not arbitrary line shapes, encodings or memory behavior.

The cold-widget scenario starts a fresh app with a compact document, keeps math and Mermaid
mounted, and types 20 heading characters at 25 ms intervals while lazy resources initialize.
It reports readiness and the number of keydowns before each widget first becomes ready.
Readiness includes cancellation/recreation caused by intervening edits; it is not an isolated
library startup measurement. The test asserts actual overlap with at least one unfinished
widget and typing p95 below 50 ms. This is separate from the 1 MiB settled-edit corpus.

The separate `node --expose-gc test/benchmark/profiles/profile-semantic-packing.mjs` diagnostic now also
compares an immutable versioned delta against a fresh full parse/render and checks the old
captured graph remains exact. Complete parsing and whole-tree diff costs are separate from
delta encoding/indexing/application. It reserves one outgoing delta buffer and verifies a
subsequent whole-HTML replacement rejects at the existing cache cap. This measures
experimental fidelity/capacity, not incremental parsing or packaged freshness. All results
remain under `test/artifacts/logs/`.

`node --expose-gc test/benchmark/profiles/profile-semantic-text.mjs` extends that experiment with bounded
UTF-16 string spans. It independently parses/renders two complete nested-fixture states,
computes both full-tree diffs and applies 40 alternating deltas. Every updated field and
three old captures are compared with those oracles. Candidate envelope/outgoing reserve,
source/arena/overlay weights and independent full-HTML read budgets are reported. The two
oracle parses/diffs are setup work, not incremental parsing; complete HTML reads remain
too long for renderer apply slices. Results are `test/artifacts/logs/semantic-text-profile.json` and
the chosen stdout log beneath `test/artifacts/logs/`. This is separate from packaged acceptance.

The text diagnostic also applies the same 40 updates through an independent 16 MiB session
owner. Guarded reads compare every current field, with an original capture retained for ten
updates before exact comparison and release. The ledger counts current/request/prepared
ownership, shared arena/overlay identities, capture/iterator scopes and outgoing reserve;
disposal must report zero managed resources. A GC probe holds released root/item/iterator
and canceled prepared-inspection readers alive and checks they no longer retain the owner.
Native scalar/key/position outputs have separate caller budgets; this does not account for
their aggregate lifetimes, production wire envelopes or calibrated runtime memory peaks.

`node --expose-gc test/benchmark/profiles/profile-semantic-dependencies.mjs` separately builds a bounded
whole-document reference/footnote context index through guarded readers. It compares every
top-level block and reference range/key against the native oracle for the exact nested
fixture. Admission includes the accepted snapshot, the caller-owned index (including exact
source) and a reserve for every permitted iterator, after full outgoing payload release.
The index must remain usable after disposal while a WeakRef proves it does not retain its
owner. Results are `test/artifacts/logs/semantic-dependency-profile.json` and the chosen `test/artifacts/logs/` stdout
log. This measures initial indexing; retaining/updating that index alongside pending
requests, safe fragment parsing and actual packaged performance remain unverified.

`node --expose-gc test/benchmark/profiles/profile-markdown-fragments.mjs` runs two actual local reparses on
the same exact nested corpus: a longer nested word and EOF typing after its final definition.
Each candidate is checked against a separately fresh complete root, comparing the captured
prefix, replacement and every suffix position with the reported offset shift. A separate
16 MiB session also prepares/commits the real packed suffix transform and compares both its
current root and old capture. The same resource ledger admits the old and updated dependency
indexes, fragment, parser-metadata and projection outputs, result source/request, preparation,
captures/readers and outgoing reserve together under the unchanged 16 MiB cap.
Immutable range segments share unchanged dependency
tables; the small replacement supplies new absolute ranges. A six-edit sequence compares
every prepared/current parser document against a fresh complete parse: root, block hashes/
ranges, outline, counts, source hash and parser version. Complete HTML, rendered widget blocks
and packed serializer layouts also match fresh full rendering. Incremental timings describe
the actual transaction. Every updated index matches a whole-root rebuild, and each old captured
document/projection/layout matches its earlier oracle. Real GC verifies that live independent
index/metadata/projection outputs do not retain an obsolete index, source wrapper or owner.
Preparation validates exact selected offset bounds using a bounded direct walk or temporary
topological DAG summaries. Summary counts retain expanded alias multiplicity and depth
limits; scratch is admitted before allocation and real GC checks tables collect while the
current capture remains live. Short predicted remainders stay on direct traversal. Unchanged
descendants stay packed. Non-root `from`/`to` fields use their own bounded range transform. Exact word counts
still walk whole-document text and run the same `Intl.Segmenter` input as the parser, with
separate bounded scratch. Local projection renders the replacement body with global reference
context and regenerates the complete footnote footer through upstream public handlers. Source
validation, metadata, projection, packed preparation and index costs are reported separately;
the transaction's total still needs to satisfy packaged application freshness. The report
includes prepared-transform scratch as well as metadata and projection scratch.
The sequence also sends one full snapshot and six complete deltas through actual Node
`MessagePort.postMessage` transfers to a separate transactional receiver. Both sender and
receiver retain independent 16 MiB ledgers; incoming payload/envelope and outgoing payload/
operation-construction reserves remain charged. Receiver validation compares the entire
prepared graph with the independent fresh oracle before commit, while its original capture
remains exact. Its expensive oracle time is explicitly reported and is not production latency
or a complete production schema validator. GC also checks disposed receivers release validator
contexts and cannot be retained by escaped revoked captures/tickets. Version 2 binds fresh
request/result tokens and exact acknowledged base tokens. Requests and accepted receipts
also cross real MessagePorts; the sender commits only on the matching acknowledgement,
and ownership samples include its receipt hold before commit. Disposal GC checks retain
publisher handles and escaped wire/ticket/receipt values while verifying that their source
and owner collect. The receiver now uses revocable cooperative receipt handles with an
independent oracle yielding between fields/elements. A 1 ms target Node scheduler reports
actual step/slice maxima, active work and wall time. Long strings now compare through
admitted capture text streams: at most one 4,096-byte lexical batch and 4,098 emitted UTF-16
units per advance, including discarded-prefix/padding progress. Four LRU decoder slots bound
live workspace; opened streams reserve workspace/output/control bytes and share the session's
aggregate staging cap with later binary preparation. Binary indexing now uses charged,
revocable session preparation: long strings yield per 4,096 encoded bytes, short strings
yield individually, and reference/record runs yield after 256 combined work units. Its
report separates index, revision-transform and validation maxima plus final publication.
Delta position walks and summary construction now yield after 256 combined work units;
range checks yield per object, and late path/prefix scans also yield. Overlay ownership,
outgoing capacity and scratch remain reserved throughout suspension. Source checks and
native/metadata copying remain synchronous. Oracle wall time includes scheduling. These
observations do not establish the packaged <4 ms apply gate or production freshness.
Queued-handle GC probes keep closed handles and escaped readers/tickets/envelopes alive
while verifying that transferred buffers, receiver, source and validation context collect
before first advance, during binary indexing and during suspended validation. Additional
probes keep closed work and captures while checking cancelled summary builders, arenas,
sources and disposed sessions collect. Production semantic validation,
consumer and service integration remain open. Additional real GC retains closed text stream,
capture and emitted-chunk handles while verifying arenas, sources and disposed sessions
collect, both before and after stream advancement. These cooperative primitives do not
establish packaged application freshness or bound every native/metadata operation.
Results are `test/artifacts/logs/markdown-fragment-profile.json` and the chosen `test/artifacts/logs/` stdout log.
Before the independent full oracle, each receiver candidate now runs packed root and
description validation: node schemas, exact sparse source coordinates, complete block
descriptors and streamed heading plaintext, metadata identity/schema and Unicode character
counts. The report separates description step maxima, active/wall time and staging from
oracle work, and samples receiver ownership on every advance. Temporary source indexes and
builders must collect while captures/completed handles remain live. This layer checks word
count types/bounds; capture-owned validator handles revoke even before their first advance,
and cancellation GC retains closed handles, captures and disposed owners across source-index
and heading-stream suspension. The checks cover receiver and standalone use. Exact words,
parser equivalence and rendered output still require further
production checks. It does not replace the independent oracle or establish packaged gates.
Development samples are not p95 or packaged freshness. Standalone summed weights repeat shared
source/table charges; the tested resource union governs combined admission. Construction/heap
peak calibration, bounded resync integration, production wire/service ownership and remaining
semantic/projection consumer updates are still required. The transform's suffix-validation
cost is reported separately from commit; neither is a packaged renderer-slice measurement.

The reference-machine results and known failures are in [VALIDATION.md](../validation/implementation-history.md).
The additional `node --expose-gc test/benchmark/profiles/profile-packed-items.mjs` diagnostic writes
`test/artifacts/logs/packed-item-profile.json`. It verifies 256-reference cursor work through a lazy
19,999-entry discarded prefix, plus real collection with escaped closed cursors, item scopes,
captures and retained disposed owners. It covers unstarted, prefix, selected and nested reader
phases. This is an ownership/work-unit check; it is not heap calibration or packaged timing.
Broader backpressure/tab schedules, repeated hardware runs, broader heavy-resource
lifecycle, compositor timing and other operating systems remain separate acceptance work.

`node --expose-gc test/benchmark/profiles/profile-packed-serialization.mjs` writes
`test/artifacts/logs/packed-serialization-profile.json`. It exports the complete authoritative 1 MiB nested
corpus root directly from a capture under the existing 16 MiB worker ledger and 8 MiB staging/
message limits. It checks every root value against the independent full parser and compares
complete rendered HTML/blocks. The two-pass encoder reserves workspace before tables/frames,
admits one exact-size output before native allocation, streams large/overlaid strings and
preserves all lazy transforms. Root export size, records, advances, largest step, wall time,
weighted workspace and session peaks are reported separately. Wall time includes owner-stat
sampling and three forced-GC samples; neither it nor the largest observed step is packaged p95.
Heap/ArrayBuffer samples compare suspended work with the same live parser oracle/base; they
are incremental observations, not whole-application memory or a portable heap guarantee.
Five retained closed task handles additionally verify collection of ten capture/owner objects
after cancellation before start, during measurement and after output allocation. Production
full-root consumers, bounded resync/compaction integration, packaged calibration and freshness
remain separate gates.

`node --expose-gc test/benchmark/profiles/profile-packed-resync.mjs` writes `test/artifacts/logs/packed-resync-profile.json`.
It transfers the complete authoritative nested document/projection/layout over real MessagePorts
from the publisher's committed graph. Initial publication, receiver eviction with a deliberately
lost receipt, and retry each run mandatory complete source/root/count/render validation before
ACK. Native full-snapshot equality is an independent diagnostic oracle outside the application's
ownership ledger. The existing 16 MiB worker, 64 MiB renderer and 8 MiB message/staging caps
remain enforced. A direct copy of existing validated bytes avoids decoding/re-encoding and
yields per 64 KiB; transformed graphs use the measured serializer with explicit capacity failure.
The report separates sender-copy and full receiver-validation time, per-advance maxima,
message geometry and session peaks. Five retained closed tasks plus three detached messages
verify collection of 25 owner/publisher/source/arena/capture objects. Native allocation,
normalization, metadata and real packaged heap calibration remain separate work. The diagnostic
does not activate production service transport or establish packaged freshness, overlay
compaction capacity, or complete current/model/cache ownership.

`node --expose-gc test/benchmark/profiles/profile-packed-reading.mjs` writes `test/artifacts/logs/packed-reading-profile.json`. It runs
the production renderer root serializer and reading processor with unchanged caps, verifies
complete root/provider-unit/final-projection equality against native captures and observes
buffer detachment through structured clone. It reports source/native-message/packed-message
bytes, renderer serializer slices/session peaks, worker time and final ownership baseline.
Its equality oracle is outside the application's ledger and its Node timings are diagnostic;
the packaged reading E2E separately checks a real Worker transfer. The authoritative 1 MiB
nested fixture is also tried against the current reading worker. Its complete preparation
must match the native oracle with all 6,299 units and three canonical payload keys. With the
controller's mapped blocks, complete replacement rendering and one translated heading must
match the independent native oracle. Both bilingual layouts currently reject projection
overflow; omitted mapped blocks independently exceed snapshot admission. Clearing the processor
must invalidate the plan. These direct checks do not prove the ordinary nested app workflow.
Twelve retained closed capture/task handles additionally verify collection of six session/source
objects after committed forks, prepared-fork revocation and partial serialization teardown.
The report also measures bounded immutable reconstruction against detached reconstruction on
the complete nested root: source fallback and one translated unit share untouched branches,
preserve complete values and retain compact position accessors. Forced-GC heap deltas include
the same live source/plan baseline and separate the detached oracle. They are incremental
observations, not total RSS or portable calibration. Four new output/root/children/status
objects must collect while the original plan remains retained. Full packed preparation and
rendering are checked independently; these reconstruction observations do not admit either.
Shared extraction additionally reports retained/workspace/peak weights, canonical payload
counts, elapsed time and forced-GC incremental heap on the full nested root. It checks every
unit/private binding against ordinary extraction. A retained cleared reading processor must
release its plan/root/bindings/canonical payload/token array; the module's trust WeakSet must
not pin them. The full packed operation still has to pass combined worker and response limits;
deduplication alone is not large-document acceptance.

The reading diagnostic also round-trips `prepared-shared` responses through structured clone
and renderer validation, comparing every restored occurrence field and provider value.
It reports repeated versus shared response bytes and admitted descriptor storage for the
complete nested corpus. A second complete protected-code fixture must exceed the legacy
descriptor JSON allowance while admitting its exact payload table and matching the native
whole-root render. This verifies response/descriptor capacity under unchanged caps; the nested
worker's combined admission remains independently required. The packaged reading E2E observes
the actual worker response kind, unit/table counts, message bytes and private-payload boundary.

Phase-lifetime checks retain a live reading processor while its public prepared envelope,
unit array, first unit record, block array/first block, and input operation/identity/settings/
provider/glossary must collect;
the still-owned plan/key index must support a later complete render. Capacity reports
distinguish admitted post-decode plan-phase peaks from retained render-time ownership after
extraction scratch, temporary response records and input source logical ownership expire.
Decoding has its own admission. Physical string release is not inferred from object collection.
A 260-unit protected-code fixture must fail the former permanent-charge render calculation
and succeed with phase-specific ownership, preserving every occurrence and full native render
equality. The separate nested prepare must still report its actual admission result.

Compact private-binding extraction is measured independently against ordinary shared
extraction on the same full nested root: complete unit/binding equality, retained/workspace
weights, measured incremental heap, accessor count and all private token pairs. Observed
heap can exceed the retained ledger; report that discrepancy rather than calling weights a
physical bound. Cleared-plan GC observes a unit with a real compact binding store so the
weak index must not pin it. Reconstruction GC also observes a generated text node while the
original source remains retained, verifying the per-operation text pool expires. The 280-unit
capacity case supplies a complete translated provider result, retains all 67,200 protected
code occurrences, and compares the complete projection with independently detached native
reconstruction/rendering. This remains a direct reading-worker diagnostic; main semantic
transport, full nested translation and bilingual admission remain separate gates.

Compact block storage must round-trip every ID, kind, range and hash without normalizing
values or retaining public record objects. The cleared-plan GC probe also observes its typed
store owner. Report retained store bytes, preparation peak and the complete nested projection
charge. Replacement HTML has one labelled language group, preserving every block's direction
and unit language overrides; bilingual labels remain per side. Lower serialized HTML volume
does not establish calibrated physical memory bounds.

The Electron lifetime suite now includes a real React/Strict Mode status fixture using the
production publication coordinator and status hook. Delaying one reader's notification must
keep all five observed old model/status/outline objects live and charged; the final commit
must permit collection while the new UI stays mounted. A suspended abandoned render must add
no consumer or publication. Closing with a delayed reader keeps old ownership until unmount,
then returns to the 256-byte session baseline. The hook must exclude borrowed outline arrays
from React's cached store snapshots, and outline handlers must retain offsets rather than rows.
Deterministic controller cases independently verify pre-commit admission and complete native
fallback at publication capacity. This covers bounded status handoff, not aggregate heap
calibration, large snapshot/cache overlap or production semantic transport activation.

`node test/benchmark/profiles/profile-reading-worker.mjs` writes `test/artifacts/logs/reading-worker-memory.json`. It builds
the production reading worker in an isolated Electron fixture, adding only numeric diagnostics,
clear and WeakRef observation in that diagnostic bundle. DevTools samples the actual worker
isolate after three forced collections: V8 used heap, backing storage and embedder heap remain
separate fields. Compare their summed delta with the warmed baseline and the processor's
weighted ownership ledger; report absolute values too. These retained samples do not measure
transient peak, total application ownership, portable physical bounds or packaged UI freshness.

The exact authoritative nested source and 280-unit protected-code translation run in the same
worker, followed by a nested repeat. Every prepared occurrence/payload and block value must
match the independent Node native oracle; complete successful projections must match detached
native reconstruction/rendering. Observe an actual compact-binding unit when present. Seven
plan/root/unit/payload/block objects must collect after each clear while the worker remains
alive. Compare end-to-initial cleared growth separately from each warmed baseline. Both bilingual
layouts and full nested translation report their actual results; rejected layouts must allow
later complete replacement rendering. Independent shared-reconstruction charge separates
projection overflow from insufficient reconstruction headroom. Keep every production cap
unchanged and keep the ordinary semantic-transport acceptance gate separate.

The current worker must fully translate every nested occurrence in replacement mode and
match the entire detached native projection. Report the direct inline projection's admitted
metadata/workspace peak alongside the old shared-reconstruction oracle's actual capacity
result. Observe temporary translated child arrays/generated text nodes at the renderer callback
boundary using WeakRefs in the diagnostic build; they must collect after render with the plan
still retained. This build-only observation adds no production hook. Nested bilingual output
still reports its real projection failure and complete replacement recovery. The protected-code
fixture must continue to match complete translated output in all three layouts.

Large bilingual results now use an exact-value row dictionary with complete occurrence and
block-anchor indexes. The actual-worker diagnostic expands these only in its independent
Node oracle comparison, and reports native expanded charge, retained indexed charge, row/value
counts and complete output equality. Both nested source-fallback and full-translation layouts
must pass under unchanged caps. All CommonMark cases compare indexed expansion with complete
native output. Raw HTML retains whole-fragment parsing and normal capacity admission.

`test/e2e/indexed-reading.spec.ts` builds the production reading surface in Electron. Its exact 1 MiB
nested fixture retains a complete 6,299-row index and reaches first/middle/last blocks in both
layouts while mounting at most 64 rows; a layout switch preserves the current anchor. An
offscreen footnote fixture follows definitions/backlinks independently in each copy and checks
external-link routing. Holding a closed teardown handle must still permit the projection,
index and value array to collect. Shared DOM-budget exhaustion must reject the view, leave
no rows/registration and permit retry after releasing the competing reservation. These direct
surface checks do not establish ordinary semantic admission, all scroll/selection/assistive
technology schedules, runtime peak calibration or packaged nested Live freshness.

`node --expose-gc test/benchmark/profiles/profile-packed-reuse.mjs --document --words --preview` composes
all three admitted validation caches with old/new owned Live Preview models, retained old
DOM/status leases, full reading captures and the actual nested fragment transaction. Both
roots serialize under production reading limits, transfer and equal independent fresh parses
completely. Report the full semantic descriptor count, model/input costs, each phase's peak,
retained old-consumer overlap and release, and both handoff costs. The optional diagnostic-only
`--preview-all-descriptors` restores the former consumer in the isolated Vite module and must
report its real capacity failure; it changes no application source or caps. The preview
collection diagnostic now includes selection-set cancellation/disposal with closed handles
retained, for 39 probes. These establish specific weighted ownership and lifetime schedules;
native semantic transport, portable physical peak and packaged latency remain separate gates.

With `--words`, fragment metadata production also borrows the already admitted text cache for
the exact original source and owner. Compare `--document --words --preview --no-producer-words`
to retain the original full producer traversal. Both paths still construct the complete new
prose and run one whole-document Intl segmentation; no block word totals are added. Record
producer, preparation and complete preview times separately and their sum before IPC/apply.
The `--words` lifetime diagnostic now has 19 probes, including synchronous producer completion
and revocation during a borrowed chunk, with closed inspection handles retained through GC.
This does not admit the cache in the ordinary semantic worker or prove packaged nested p95.

With `--document`, the baseline also admits block/outline prefix counts for every top-level
child boundary. Fragment metadata may use those intervals only for the exact original source,
owner, immutable revision and document path. Compare
`--document --words --preview --no-producer-metadata` to retain both complete descriptor scans.
The report records metadata time, certified intervals and actual descriptor scan lengths;
complete changed-node checks and whole-document word counting still run. On the complete
nested fixture, two interval lookups replace scans of 31,492 blocks and one heading. The
additional retained/staging reservation is 50,472 bytes. One sequential comparison observes
44.0 versus 54.0 ms metadata time, with both complete native roots still equal. Individual
development timings establish no latency gate. The document lifetime diagnostic now has
21 probes watching the actual typed table and its ArrayBuffer, including cancellation after
allocation during construction, explicit close and borrowed capture release. Escaped numeric ranges
remain readable while closed work/baseline/capture handles stay held through GC. Shared word
baseline lifetime coverage remains 19 probes. These additions do not activate semantic packing
in the ordinary worker or establish aggregate physical admission.

The bounded packed-string decoder scans literal runs, carries at most five incomplete escape
units and uses native JSON decoding only for completed escaped fragments. Every reader advance
still consumes at most 4,096 encoded bytes, including padding; the largest wrapped native
fragment is 4,104 UTF-16 units. Compare `--document --words --cpu` with the recorded pre-change
run in `test/artifacts/logs/nested-latency-baseline.log`, preserving the full source/HTML/count comparisons,
logical work counts and unchanged admission charges. CPU sampling and single development
observations do not establish packaged p95 or combined producer/preparation/preview freshness.

Compare initial complete packed validation with:

```sh
node --expose-gc test/benchmark/profiles/profile-packed-validation-cpu.mjs --measured-copy
node --expose-gc test/benchmark/profiles/profile-packed-validation-cpu.mjs
node --expose-gc test/benchmark/profiles/profile-packed-native-stream.mjs
```

The first command substitutes the original measured body-block copier only inside the
diagnostic Vite module; the second uses the application's incremental admission path. Both
perform the same complete source/document/projection/output/count validation. Reports are
`test/artifacts/logs/packed-validation-cpu-measured.json` and `test/artifacts/logs/packed-validation-cpu.json`, with
matching `.cpuprofile` files. Compare the exact source hash, payload bytes, total work and
active/wall time; CPU sampling and individual development observations are not packaged p95.
The lifetime command records 33 probes in `test/artifacts/logs/packed-native-stream-lifetime.json`. It
observes actual partially constructed native objects/arrays/positions, text collectors,
arenas and source resources. Closed work/workspace/item/scope/capture handles remain held
and unadvanced through forced GC. It covers allocation checkpoints, node-limit rejection,
inspector exceptions, parent-scope expiration and an otherwise unreachable undisposed owner.
This proves cleanup for the tested schedules, separately from physical heap calibration.

For renderer traversal comparisons, archive the pre-change `projection-owned-output.ts` and
`projection-serialization-plan.ts` under `test/artifacts/logs/renderer-traversal-baseline/`, then run:

```sh
node --expose-gc test/benchmark/profiles/profile-packed-validation-cpu.mjs --unbatched-traversal
node --expose-gc test/benchmark/profiles/profile-packed-validation-cpu.mjs
node --expose-gc test/benchmark/profiles/profile-packed-output.mjs
```

The comparison reads those two local files only in the diagnostic Vite transform and records
their SHA-256 hashes in `test/artifacts/logs/packed-validation-cpu-unbatched.json`. Missing archived files
fail explicitly; the application has no comparison switch. Both paths retain complete
validation and memory admission. The output diagnostic now runs 26 GC probes, including real
partial description/policy/widget batches and partially serialized widget maps, with closed
handles retained unadvanced. It also compares complete nested, footnote and long-widget output
against an independent native renderer. Observe the complete source hash, output counts,
memory weights and actual scheduler maxima; these development samples do not establish
packaged p95 or physical peak calibration. Shared traversal counters bound visits and text
units, while URL policy, code-language normalization and every native serializer retain
separate scheduler barriers. Native handler/serializer duration remains independently measured.

For integer-decoder comparisons, archive the pre-change `packages/core/src/packing-bytes.ts`
at `test/artifacts/logs/packed-integer-baseline/packing-bytes.ts`, then compare
`node --expose-gc test/benchmark/profiles/profile-packed-validation-cpu.mjs --arithmetic-integers` with the
ordinary command. The diagnostic transform reads only that archived module, records its
SHA-256 and writes `test/artifacts/logs/packed-validation-cpu-arithmetic.json`; missing archives fail.
The complete source, snapshot, logical advances, validation outputs and admission limits
must match. Also run `node test/benchmark/profiles/profile-reading-worker.mjs` to verify actual Electron
worker transfer, complete translations/bilingual output and cleared lifetimes. Individual
timings and steady retained samples do not prove packaged nested p95 or physical peak.

For exact initial-snapshot validation reuse, compare:

```sh
node --expose-gc test/benchmark/profiles/profile-packed-reuse.mjs --document --words --preview --revalidate-initial-preview
# Archive test/artifacts/logs/packed-preview-overlap-profile.json before the next run.
node --expose-gc test/benchmark/profiles/profile-packed-reuse.mjs --document --words --preview
```

The control forces repeated validation through a diagnostic module transform; there is no
application switch. The report records `revalidateInitialPreview`. Both paths first create
the baseline through complete snapshot validation, then prepare independently admitted native
preview input. Compare baseline creation separately from initial preview preparation. Proof
reuse requires the exact revision object and owner, original source object, snapshot path,
render policy and valid limits at least as permissive as those originally validated. Changed
revisions continue full validation with the existing subtree caches. Keep complete root/parser
equivalence, descriptor counts and GC results alongside timings. These development measurements
do not establish end-to-end startup, packaged nested freshness or ordinary worker admission.

The composed diagnostic builds the document baseline first and passes it to projection and
word-cache construction. Compare with the same construction order using
`node --expose-gc test/benchmark/profiles/profile-packed-reuse.mjs --document --words --preview --independent-baselines`,
archive `test/artifacts/logs/packed-preview-overlap-profile.json`, then run without the final flag. The report
records `independentBaselines`; the control omits the optional certificate for both builders.
Report the sum of all three construction times, the initial preview separately, and complete
root equivalence/ownership results. All builders still admit and construct their own metadata;
projection output is always checked. Run
`node --expose-gc test/benchmark/profiles/profile-packed-document-lifetime.mjs --words --from-document` for
the new construction path's 19 GC probes, report `test/artifacts/logs/packed-word-from-document-lifetime.json`.
The ordinary document lifetime command separately checks its 15 probes. Closed document/word
cache handles and escaped chunk capabilities remain retained during collection.

The composed document baseline also records whether each complete top-level subtree contains
any definitions or footnote calls, in its existing summary pass and admitted metadata.
Projection validation and definition-cache planning/copying can use this absence proof only
for the exact source object, immutable revision/owner, document path and valid non-stricter
limits. Skipped descendants still count toward logical node/depth limits; renderer output
is checked independently. The same summary pass also records link/image reference presence.
For certified subtrees without definitions or footnote calls, projection-cache classification
uses that flag and the complete logical costs instead of walking the subtree again. This
preserves the requirement to verify ordered definition context before reusing reference-bearing
blocks. Non-certified subtrees use the existing full classification walk.
Closing the document baseline revokes subsequent proof lookups and
restores full traversal. The independent-baselines control omits this proof as well.

For actual Electron renderer ownership observations, run:

```sh
node test/benchmark/profiles/profile-packed-renderer-memory.mjs
```

The isolated build uses the production packed session, cache builders, owned preview and
complete root serializer. A separate harness Worker fetches fixture bytes and transfers their
buffer into the measured renderer; the native parser/root oracle stays in Node. The report
`test/artifacts/logs/packed-renderer-memory.json` records V8 heap, backing storage and embedder memory for
each construction/serialization stage, with three GCs per retained checkpoint. Periodic
samples during cooperative work include garbage and diagnostic overhead and can miss a peak
inside a native call. They are separate from retained admission weights. The report checks
the measured retained subset against each checkpoint's ownership estimate, complete root
equivalence, all descriptor/widget counts, collection after baseline release and final
cleanup, repeated preparation in one isolate, and cancellation after actual cache chunks are
copied. Closed handles, escaped composed capture/item child scopes and document absence-proof
callbacks remain retained throughout collection. Escaped scope guards must reject after
cleanup, and closed document callbacks must return no proof. No DOM widget mount, semantic
producer memory, loader-worker memory, main-process IPC or aggregate process RSS is measured.
Keep this scope explicit: the isolated renderer observations cannot activate production
transport or establish a portable physical memory bound. All generated assets/profiles stay
under ignored `/test/artifacts/logs/`.

For allocation investigation, run the same command with `--allocations`. This separate,
unminified diagnostic build counts `PackedReader`, `PackedView` and `PackedReadScope`
constructions per phase and writes `test/artifacts/logs/packed-renderer-allocations.json`. It also samples
live projection allocations at a 262,144-byte interval, retaining the largest sampled live
profile in `test/artifacts/logs/packed-projection-allocations.heapprofile`. The numeric construction counts
are exact for the instrumented paths; sampled bytes omit collected allocations and are neither
cumulative allocation totals nor a peak bound. Instrumentation changes execution costs. Use
the ordinary minified command for runtime memory observations and preserve reports before
comparison runs overwrite them. Neither mode changes production admission or transport.

The `keyCopies` counter also records calls to the guarded scope's key-copy operation. Every
such call in a successful measured phase creates one independently admitted frozen key
array. Atomic schema matching now borrows immutable arena shapes without exporting them;
it preserves complete field checks and the same key-metadata budget, while `keys()` still
creates independent output for consumers that retain a list. Compare this counter alongside
reader/view/scope counts; it is not a count of all arrays or allocation bytes.

Add `--construction-sites` to the allocation command to sample scope-construction call stacks
with a seeded 1-in-4,096 selector. Each phase reports up to 40 stacks with their sample counts
in `test/artifacts/logs/packed-renderer-construction-sites.json`, preserving the ordinary allocation report.
This diagnostic adds stack and map allocations; use it to locate work, not to measure runtime
memory or latency. Constructor totals remain exact for the instrumented paths; stack counts
are samples and do not attribute all allocations or bytes. It requires `--allocations`.

For a separate minified run with OS process observations, use:

```sh
node test/benchmark/profiles/profile-packed-renderer-memory.mjs --process-memory
```

This writes `test/artifacts/logs/packed-renderer-process-memory.json` and preserves the ordinary heap and
allocation reports. It cannot be combined with `--allocations`. Each CDP query is followed
by an Electron main-process `app.getAppMetrics()` query. The measured window's OS renderer
PID and process creation time identify the renderer; all reported Electron process rows and
simultaneous totals are retained. Values from Electron's documented kilobyte fields are
normalized to bytes. The report records baseline, largest sampled absolute value and largest
sampled increase separately for working sets and, where available, Windows private bytes.
Private bytes describe private commitment, not resident RAM. Summed working sets count shared
pages multiple times; lifetime peak working sets include startup/warmup and cannot be added
as simultaneous process peaks. Missing private-byte fields stay absent on other platforms.
See Electron's [MemoryInfo](https://www.electronjs.org/docs/latest/api/structures/memory-info)
and [ProcessMetric](https://www.electronjs.org/docs/latest/api/structures/process-metric).

OS process observations include the loader Worker sharing the renderer process and the
diagnostic Electron main/utility/GPU processes. They exclude the separate Node producer/oracle,
automation and Vite host, and do not represent production worker or mounted-widget lifetimes.
Heap and process readings are successive; the extra query changes sampling cadence and may
still miss peaks. Post-GC checkpoints do not promise OS memory decommit. Keep complete output
and ownership/collection checks alongside these observations; no process threshold or
production admission is inferred from one fixture run.

To include the complete native producer in a separate minified diagnostic, run:

```sh
node test/benchmark/profiles/profile-packed-renderer-memory.mjs --process-memory --producer
```

This writes `test/artifacts/logs/packed-producer-process-memory.json` and requires `--process-memory`.
Each admission creates a real worker that receives the complete source, fresh-parses and
renders it, and encodes under the existing 32 MiB / 800k-visit / depth-512 encoder allowance.
The independently transferred payload plus a checked 1,024-byte envelope reserve must fit
8 MiB. Both detachment and actual worker target disappearance are checked before later
preparation. The diagnostic matches the packaged renderer's worker-safe entity resolution.
Native parser/HAST/input memory is included in renderer OS process samples; it is outside
the encoder ledger and the renderer isolate's heap observations. Node keeps the independent
expected parser/render output. No production transport is activated by this fixture.

The report retains producer parse/render/encode timing, successive worker phase observations,
and complete root/descriptor/widget and ownership/collection checks. A pending case pins a
complete native snapshot in a worker while the previous owned preview and serialized root
remain live. Termination must remove the actual worker target, publish no candidate, preserve
exact owner statistics and leave the predecessor's complete root unchanged. The harness
allows 10 seconds for fixture production/transfer and 5 seconds for target disappearance;
these diagnostic timeouts do not replace production watchdog or freshness acceptance.
Phase observations follow memory samples and are not atomic allocation attribution. OS
private commitment, working sets and V8 heap remain different quantities. Mounted widgets,
main-process semantic consumers and aggregate production lifetimes still require separate
acceptance; these observations do not establish a portable physical admission bound.

The native parser includes a pinned event-map backport, documented in
[`docs/patches/micromark-edit-map.md`](../patches/micromark-edit-map.md), and a traversal backport,
documented in [`docs/patches/unist-visit.md`](../patches/unist-visit.md). Installation applies
the reviewed sources; lint and desktop builds verify their exact source hashes.
The first preserves untouched event prefixes instead of replaying them after every edit
group. The second reuses one traversal function instead of allocating and renaming a
closure for every parser/renderer node; internal stack traces lose per-node debug names.
Keep this patch state with runtime results: measurements made before and after the backport
are distinct baselines. Complete native producer parsing, current/pending ownership and all
six packaged corpus acceptance gates still apply; the patch does not enable packed transport.

The core parser also skips impossible email/table tokenizer attempts using immutable GFM
processor variants. Email attempts stay enabled for `@`, entities or escapes; table attempts
stay enabled for pipes, `:-`, `-:`, entities or escapes. Aligned single-column tables without
pipes remain supported. The complete mdast transforms and other GFM constructs stay enabled.
Compare the full GFM baseline, email guard alone and combined guard on the exact complete
nested fixture with:

```sh
node --expose-gc test/benchmark/profiles/profile-parser-constructs.mjs
```

This creates `test/artifacts/logs/parser-construct-profile.json`, CPU profiles and cumulative allocation
samples from separate fresh Node/Vite processes. Every sample checks the independently
recorded complete root hash and all 31,492 descriptors. The baseline forces the original
full processor; it does not modify dependencies. Sampled cumulative allocation and endpoint
process memory do not establish simultaneous physical peaks or packaged UI freshness.

A paired lifetime patch to pinned `micromark@4.0.3` and
`mdast-util-from-markdown@2.1.0` lets completed tokenizer state collect before mdast
compilation. The serializer owns source chunks through a separate factory, preserving its
identity across streaming writes. After all micromark resolvers finish, mdast's private
compiler events retain only that serializer. Public micromark event contexts remain complete.
Installation applies both default/development exports; lint and builds verify all four exact
source hashes. See [patch provenance](../patches/parser-lifetimes.md).

```sh
node test/benchmark/profiles/compare-parser-lifetimes.mjs
```

This writes `test/artifacts/logs/parser-lifetime-compatibility.json` after comparing four fresh processes:
hash-verified original/patched sources under both export conditions. It substitutes original
sources with Node load hooks, without rewriting installed dependencies. Each process checks
1,642 complete semantic-document/render hashes, including the full nested root, both grammars
and both raw-HTML policies. Forced GC separately verifies that a retained, still-callable
serializer permits its patched tokenizer to collect, while the original tokenizer stays live.
This reachability check is separate from transient process commitment and aggregate admission.
For explicit live graph samples at parser/compiler boundaries, run:

```sh
node test/benchmark/profiles/profile-parser-lifetimes.mjs
node test/benchmark/profiles/profile-parser-lifetimes.mjs --development
```

These write `test/artifacts/logs/parser-lifetime-live-graph.json` and its `-development` counterpart.
Fresh original/patched processes use diagnostic load hooks to split `fromMarkdown` at
complete postprocessing, context compaction and compilation. Each checkpoint deliberately
holds the complete event array live through three forced GCs. Complete nested roots and
descriptors must still match. These controlled retained graphs extend event lifetimes and
invalidate parse timing; they do not measure transient physical peaks or UI freshness.
The producer memory command above includes the installed lifetime patch; preserve that patch
state with its observations. Direct `--child` tokenizer profiles now use separate default file
names; use `--profile-prefix` with a filename prefix to distinguish further prototypes.

## Streaming packed translation extraction ownership

```sh
node --expose-gc test/benchmark/profiles/profile-packed-extraction.mjs
```

This development Node/Vite probe instruments the actual transient native subtrees, position
objects, projected token/binding/text arrays, occurrence ID sets and units produced by
`inspectPackedTranslationUnits`. It also watches source resources and arenas. Its 33 cases
cover cancellation before start, during validation/native copying and in a suspended
inspector; completion, inspector failure, duplicate IDs and workspace rejection; and an
otherwise unreachable undisposed session. Both externally held and unreachable owners are
included. Closed work/capture/workspace handles remain held and unadvanced during forced GC;
every watched object must collect and every closed workspace must reject further resizing.
The report is `test/artifacts/logs/packed-extraction-lifetime.json`.

This checks actual reachability cleanup alongside exact ledger restoration. It does not
measure a portable physical memory bound or exercise production reading-worker integration.
The inspector owns only one eligible native unit during its callback; independently retained
payloads, bindings or reconstructed output require their own admission. Full source-bound
validation precedes the first callback, and global logical unit/payload limits still apply
when all earlier units are discarded. The focused `packed-extract.test.ts` suite covers
complete CommonMark output/privacy/reconstruction equality, malformed later branches,
ownership failures and the complete nested corpus. Production persistent plans, translated
rendering, semantic transport and all release acceptance gates remain separate requirements.

For persistent payload-only plan lifetime checks, run:

```sh
node --expose-gc test/benchmark/profiles/profile-packed-plan.mjs
```

This writes `test/artifacts/logs/packed-plan-lifetime.json`. Its 24 cases keep completed plans and borrowed
translation projections live and readable while forcing GC: transient native units,
reconstructed children and private binding graphs must collect,
while canonical provider payloads and occurrence metadata remain live. After plan release or
session disposal, all watched metadata/source/arena and otherwise unreachable owners must
collect with closed plan/projection/work/capture handles held and unadvanced. Cases include queued and
in-progress build cancellation, metadata admission failure, complete and suspended private
inspection, throwing inspector cleanup, projection completion/cancellation/disposal, and both
externally held and unreachable session owners. The local plan budget reserves metadata out
of the extractor's retained ceiling; the shared session also charges
source, arena and concurrent captures. On-demand rehydration uses a complete ordered scan
and preserves unit identity/privacy/limits without retaining every private native subtree.
Provider job/hash copies and inspector output retained beyond callbacks require independent
admission. This probe checks reachability, not packaged physical memory or production reading
integration. Sequenced reading and packed-plan projection have complete development
compatibility coverage, including both full nested roots. The internal `inspectPackedReading`
consumer now admits global language states, each native block, reconstructed children,
paired HAST/policy/serialization frames and persistent rows/final output together. Source,
arena, translation projection and caller-owned block metadata share the session ledger.
The production packed-reading worker now uses this owned path; semantic activation and
aggregate physical ownership remain open.

```sh
node --expose-gc test/benchmark/profiles/profile-owned-reading.mjs
node test/benchmark/profiles/profile-owned-reading-worker.mjs
```

The first writes `test/artifacts/logs/owned-reading-lifetime.json`. Its 42 cases cover all three layouts,
completion, body/output cancellation, session disposal, throwing output inspection and live
output inspection and completed owned output, with both externally retained and unreachable
session owners. Escaped retain callbacks must revoke without holding source/arena state. Actual
body mdast/HAST must collect while output inspection stays open. Context, public renderer
states/maps/counters, row/slot state, sources and arenas must collect after release while
closed frame/sequence/projection/plan/work/capture handles remain held and unadvanced.

The second builds the diagnostic fixture in `test/e2e/fixtures/owned-reading-memory` and runs an
actual Electron worker. It transfers each complete packed root, includes block/envelope
metadata in the same 32 MiB session, translates every eligible occurrence and compares all
three layouts with an independent complete native oracle. Cases include the full 1 MiB
nested fixture in both grammars. Minification is disabled to preserve checkpoint statements.
After a complete runtime warmup, the worker forces three GCs before debugger pauses at
increasing frame weights and complete output;
CDP measures V8 used heap, backing storage and embedder heap. Results are in
`test/artifacts/logs/owned-reading-worker-memory.json`.

These samples check retained graph weights. They do not bound transient allocation peaks,
outgoing response clone/envelope scratch, process RSS, simultaneous application revisions,
provider/hash jobs or the production queue. Output copies to the independent driver inside
its admitted borrow. Debugger pauses invalidate latency measurements. A cold small-case
measurement exceeds its graph weight (1,725,550 measured bytes versus 1,191,648 admitted);
`test/artifacts/logs/owned-reading-helper-cold-profile.log` preserves that failure. Warm measurements
exclude lazy runtime initialization and cannot prove cold-start physical bounds.

`node test/benchmark/profiles/profile-reading-worker.mjs` now exercises the actual production worker wrapper,
hashing, packed plan/reading path and response publication. Its diagnostic request queue
runs directly, outside production watchdog/latency gates. The report is
`test/artifacts/logs/reading-worker-memory.json`. It verifies complete prepared records, translated and
untranslated full nested roots in both grammars, all layouts, 67,200 protected occurrences,
collection after clear, and owned output plus clone scratch before/after real `postMessage`.
Three GCs per checkpoint align backing-store release with idle samples; an earlier single-GC
measurement mismatch remains in `test/artifacts/logs/reading-worker-one-gc-checkpoints.json`. Every sampled
live graph must fit its simultaneous retained/staging ledger. This does not bound synchronous
transient/native clone allocations, cold initialization, process RSS, application-wide
current/pending/captured revisions or provider jobs. All semantic/release gates still apply.

## Continuous typing and tab backpressure

Two generated approximately 1 MiB dense files exercise 40 edits with 40 ms spacing, followed
by six alternating tab clicks with 180 ms dwell and a final return. This keeps typing faster
than the idle debounce while allowing its maximum-delay publication to run. A test-only Worker
wrapper counts actual posted/outstanding/completed requests and their opaque identities;
it records no source text. It asserts one request in flight, at least two published edit
requests (fewer than the number of edits), 40 paint estimates, input p95 below 50 ms and
final typing/tab settlement below 1.5 seconds. Current character counts and exact saved text
are verified. Report the final-tab metric from its actual browser click to accepted apply.

This observes traffic and final behavior rather than exposing the internal pending queue.
Deterministic service tests separately prove one latest pending request, discarded obsolete
work, watchdog/restart caps and explicit fallback. It is one recorded interaction pattern;
arbitrary schedules, larger documents, physical IME and OS-specific interaction still need
their own evidence. The full performance command runs this alongside the corpus, stress,
cold-widget and lifecycle scenarios.

## Application packed producer exchange

Run `node test/benchmark/profiles/profile-semantic-producer.mjs` to build and launch the experimental
application producer in an actual Electron Worker. This covers native parsing/layout,
cooperative encoding, worker-session preparation, transferable publication, complete receiver
validation and exact acknowledgement. Each full 1 MiB corpus case uses a fresh worker and
then repeats the same result after receiver eviction to exercise cached full resync.
Independent native parser/renderer output stays in Node; the diagnostic driver also expands
the received payload solely to hash every semantic field except parser/render timings.
Those diagnostic native allocations are not admitted application consumers.

The report is `test/artifacts/logs/semantic-producer-profile.json`; stdout is
`test/artifacts/logs/semantic-producer-profile.log`. The worker keeps the existing 16 MiB retained session,
8 MiB wire/staging and 32 MiB encoder workspace. The receiver uses the existing 64 MiB
renderer session, 8 MiB staging and 160-reader diagnostic configuration. Encoder/native/
session ownership is not one calibrated aggregate physical budget. Wall times and step
samples include diagnostic scheduling and may be affected by other processes; they are
neither packaged freshness nor portable physical peak measurements.

The command deliberately fails if any complete case fails. At the earlier producer checkpoint,
five cases including nested containers complete fresh and cached exchanges with exact
semantic hashes; the single-paragraph receiver exceeds projection output workspace.
Nested validation takes about 20 seconds. Keep these failures and the unchanged ordinary
JSON transport visible while implementing bounded validation, incremental production and
controller integration. Subsequent chunk validation removes the single-paragraph workspace
failure without changing those caps. Current results are recorded in VALIDATION.md; this
diagnostic does not activate the application protocol.

## Projection chunk validation

The packed receiver now compares serialized HTML chunks from complete owned native
conversions. It reserves the complete HAST/descriptions, shell serialization and bounded
text scratch, and checks body/layout/widget/footer equality without joined HTML outputs.
Full native-output inspectors retain their original output/scratch admission. Attribute and
shell serialization still delegates to the public pinned serializer; those native calls and
native block/HAST construction remain atomic and separately measured.

`node --expose-gc test/benchmark/profiles/profile-projection-chunk-lifetime.mjs` records
`test/artifacts/logs/projection-chunk-lifetime.json`. Twelve probes retain closed work/capture/owner handles
unadvanced through forced GC. WeakRefs observe the actual decoded MDast/HAST/conversion
objects and transient widget maps at begin, body, widget HTML and footer boundaries, each
with work return, capture release and session disposal. This checks collection of those
graphs, independently of physical peak or aggregate admission.

Run the application producer exchange above for all six complete 1 MiB shapes and cached
resync. `node --expose-gc test/benchmark/profiles/profile-packed-validation-cpu.mjs` profiles the complete
nested receiver in Node and writes `test/artifacts/logs/packed-validation-cpu.json` plus its CPU profile.
These diagnostics remain separate from packaged corpus/watchdog/latency acceptance. The
historical archived traversal comparison requires matching modules from its original
representation; archives predating chunk preparation cannot be substituted into the new
streaming module graph.

### Incremental application producer

`node test/benchmark/profiles/profile-semantic-producer.mjs --incremental` exchanges four complete revisions
for every authoritative 1 MiB fixture through the actual Electron Worker: initial full,
two real heading edits, and final full resync after receiver eviction. Both edits must be
deltas. Independent native hashes cover every document/projection/layout field except
timings; delta captures are completely serialized for hashing after receiver validation.
That diagnostic-only materialization is excluded from receiver time. `--case NAME` selects
one named fixture and writes a separate report. Full-run output is
`test/artifacts/logs/semantic-producer-incremental-profile.json`.

The receiver's two-millisecond diagnostic batches now defer through the application's
`browserRuntime` (`scheduler.yield`, with timer fallback). Earlier producer reports used
`setTimeout(0)` directly; their wall times are not a controlled comparison with this run.
Producer native builders remain atomic and per-advance measurement adds instrumentation
cost. These reports are neither packaged p95 measurements nor watchdog acceptance.

Cached serialization reserves workspace growth before allocation. Optional dependency
acceleration may be evicted first; if the committed overlay and outgoing encoding still
cannot coexist, the producer evicts its committed cache and recomputes the complete result,
reporting `cached: false`. Explicit old captures remain valid and charged. No worker,
source, wire or staging cap changes. The ordinary semantic worker still uses JSON.

`node --expose-gc test/benchmark/profiles/profile-producer-fragment-lifetime.mjs` observes actual native
fragment trees, positions, metadata arrays and projection patch fields. Thirteen probes
retain closed work/message/capture/owner handles unadvanced through GC: cancellation and
disposal in six phases, plus a real transferred delta ACK with a live producer and old
packed capture. Source resources and identities intentionally live in current/old captures
and are excluded from native patch observations. Reports live in
`test/artifacts/logs/producer-fragment-lifetime.json`; this establishes graph collection, not a physical
peak or aggregate admission bound.

### Application receiver proof caches

Run `node test/benchmark/profiles/profile-semantic-producer.mjs --incremental --receiver-cache` to build
document/projection/word-text certificates after the initial complete receiver validation
and exact Worker ACK. Construction runs cooperatively through the same two-millisecond
`browserRuntime` scheduler as receiver validation. Both subsequent heading edits must be
deltas; every full and delta result must match the complete independent native oracle.
The final round evicts receiver data and certificates before requesting the full final
revision again. `--case nested-containers` selects one complete authoritative fixture.

The flag writes a distinct
`test/artifacts/logs/semantic-producer-incremental-receiver-cache-profile.json`. Each case includes
certificate construction time, largest advance, peak sampled retained/staging ledger
ownership and completed cache flags. Each round includes receiver time, largest advance
and post-ACK receiver/producer ownership. Diagnostic complete delta serialization for
hashing runs after validation and is excluded from receiver timing. No semantic fields
are removed; only nondeterministic timings are normalized for hashing.

The 2026-10-27 run passes all 24 exchanges and 12 actual edits. All three certificates fit
every fixture under the unchanged 64 MiB receiver session and 8 MiB staging caps. The
largest sampled construction ledger is 56,183,044 retained bytes (many small blocks);
the largest staging is 8,103,354 bytes (single paragraph). Nested receiver edits take
316.3/356.9 ms after 3,631.7 ms of separate construction. These are warmed diagnostic
measurements, not cold readiness or packaged p95 gates. Combined nested producer and
receiver times remain 623.6/572.3 ms; many-small-block times remain 556.8/554.5 ms.
Freshness, ordinary transport activation, native/aggregate physical admission and platform
release requirements remain open. The ordinary application still uses the JSON worker.

### Producer dependency warmup and Worker scheduling

`node test/benchmark/profiles/profile-semantic-producer.mjs --incremental --receiver-cache --producer-cache`
also constructs the producer dependency index after the initial exact ACK, concurrently
with the receiver's certificates. Its separate report is
`test/artifacts/logs/semantic-producer-incremental-receiver-cache-producer-cache-profile.json`.
Each case includes `producerCaches`, with warmup time, completed dependency-cache flag,
largest advance and sampled retained/staging ownership. Both edits and final full resync
still require complete native semantic hashes. The unchanged 16 MiB producer session
admits dependency metadata and traversal scratch before their allocation/growth. Cancellation
and supersession close partial work; optional capacity or unsupported source geometry can
decline the warmup. Full cold construction remains necessary when there is no exact cache.

The fixture now uses `PackedProducerHost`, the application's Worker scheduling coordinator,
with one deferred callback and one current task. Real transfer finishes before exact ACK;
queued superseded work cannot publish. The host charges 4,096 bytes of control metadata in
the same producer session. Measurements are optional and enabled by this diagnostic only.
This is runtime evidence for the host; ordinary semantic worker/service/controller transport
still requires integration and activation gates.

`node --expose-gc test/benchmark/profiles/profile-producer-dependency-lifetime.mjs` records
`test/artifacts/logs/producer-dependency-lifetime.json`. Eleven probes observe actual construction maps,
arrays and records while retaining closed handles unadvanced through collection. They cover
cancellation, disposal and supersession during traversal, reference resolution and footnote
ordering, plus completed-cache disposal and exact-ACK replacement with an old consumer alive.
`node --expose-gc test/benchmark/profiles/profile-producer-host-lifetime.mjs` separately records
`test/artifacts/logs/producer-host-lifetime.json`. Eleven probes keep the actual deferred callbacks and live
hosts unadvanced through GC, checking obsolete producer work and disposed port collection.
Neither diagnostic establishes physical peaks or aggregate native admission.

For CPU attribution, add `--receiver-cpu` to `--incremental --receiver-cache`, optionally
with `--case nested-containers`. This builds readable fixture bundles and samples the actual
renderer only during each incremental receive. It writes
`test/artifacts/logs/receiver-cpu-CASE-REVISION.cpuprofile` and a distinct `-receiver-cpu` report. Profiling
overhead changes timing; use the unprofiled diagnostic for separate timing observations.
Complete hashes, policies and source fixtures remain mandatory with profiling enabled.

The current host diagnostic's nested warm producer/receiver sums are 430.1/470.5 ms;
many-small-block sums are 485.1/532.0 ms. These omit source admission, channel/consumer/DOM
work and are individual instrumented observations, not packaged freshness or p95 acceptance.
Idle warmup also leaves initial complete validation and separate receiver cache construction.
Current cold, packaged and artifact evidence is recorded in VALIDATION.md; remaining gates
must be satisfied before activating the ordinary application's packed transport.

### Application service and Live consumer diagnostic

Run `node test/benchmark/profiles/profile-semantic-service.mjs`, optionally with `--case NAME`. It builds an
isolated Electron fixture with the actual packed Worker endpoint, renderer port, application
debounce/watchdog service, mounted CodeMirror editor, `DocumentPreview`, owned Live model,
status publication and independent complete Reading capture. The six corpus definitions are
shared with the producer diagnostic; all six source hashes/byte lengths match its earlier run.
Complete document/projection/layout hashes and count/outline values are checked against an
independent native parse/render for the initial state and two real heading edits. No semantic
fields are removed except nondeterministic timings. Complete diagnostic hashing runs outside
ready timing, after consumer preparation and separately awaited idle receiver certificates.

Use `--edits 20` to check twenty actual heading edits per complete fixture, including later
shortening edits, with a full independent native hash/count/outline comparison on every
revision. The supported range is 1–20; default remains two for archived comparisons.
Explicit edit counts write a distinct `-editsN` report and keep every direct-delta gate.
This checks repeated application coexistence; it does not provide packaged input-to-frame,
mode-transition or maximum apply-slice measurements.

Use `--process-memory` separately from `--admission` and `--renderer-cpu` to observe the
actual application's persistent semantic Worker, receiver and mounted Live model together.
For example, run `node test/benchmark/profiles/profile-semantic-service.mjs --edits 2 --process-memory`;
use `--case nested-containers` for a fresh-process nested-only comparison. Reports add
`-process-memory` before `-editsN`. Raw OS process samples remain in the JSON report;
stdout prints summaries. Samples use Electron main-process metrics, with a 20 ms pause
between completed observations, without renderer polling or forced GC during work.
Checkpoints separate request/readiness, caches, full diagnostic hashing and disposal.
`coldThroughReady` ends before the first full-output hash expansion; later revisions can
include memory commitment left by that diagnostic expansion. All six cases share one
Electron process, so later case baselines include earlier process reservation.

The tool confirms one actual Worker, its termination, zero final receiver ownership and
complete native semantic equivalence. Renderer heap/backing/embedder observations before
work and after disposal plus three GCs are separate from process working set/private bytes.
Windows private bytes measure commitment; working sets include shared pages, and the OS
peak working set is a process lifetime high-water mark. Sampling can miss synchronous
peaks. These observations include native producer work missing from the earlier loader
fixture, but omit other tabs, mounted widgets, translation/export and production main IPC.
They do not establish a portable physical admission bound or packaged latency acceptance.

Receiver warmup uses background-priority tasks after mandatory consumer preparation.
Mandatory receipts and optional caches each have one revocable callback slot, preventing
a queued cache callback from taking newer receipt work. Runtimes without background
scheduling retain defer/timer fallback. Complete cache contents and admission stay unchanged.
The full twenty-edit sequence still checks every cache after separately awaiting warmup;
its ready timing now observes publication before optional caches finish. Do not report the
removed polling delay as faster mandatory native validation or as a packaged paint result.
The matching VALIDATION.md checkpoint records 126 complete revisions, 120 direct deltas,
68 ownership probes and the fresh-process memory comparison. Native/aggregate admission
and ordinary transport activation remain separate requirements.

At this scheduling checkpoint all 11,009 units, 68 ownership probes and 73 packaged
functional tests pass. The new Windows ASAR is
`5da2cc2d6b480edb4d6a5a17b19ef7a184bfb43f449f75bdc1e7a65589e84ea9`; compiled runtime
and complete packaged workspace source inventories match current bytes. Packaged performance
continues to fail nested Source fallback/missing Live samples, while the other five corpus
fixtures and backpressure/boundary/lifecycle/stress/widgets pass. See
`test/artifacts/logs/background-cache-service-20-summary.json`, `test/artifacts/logs/background-cache-memory-summary.json`
and `test/artifacts/logs/background-cache-performance-summary.json`. No activation or physical admission
acceptance follows from removing cache interference with ready observations.

Evidence goes to `test/artifacts/logs/semantic-service[-NAME]-profile.json`; redirect console output into
`/test/artifacts/logs/` as well. The runner checks every fixture even when one incremental gate fails, then
exits nonzero if any edit needs full resync. The original integration accepted all 18 complete revisions
with one Worker per fixture, but many-small-blocks requires full resync on its second edit.
Nested edits take about 3.37 seconds end to end, so the earlier producer/receiver-only timings
do not establish application freshness. The unchanged 500 ms packaged p95 target still applies.
This isolated experimental fixture does not activate or validate the ordinary packaged transport.

Run `node --expose-gc test/benchmark/profiles/profile-semantic-port-lifetime.mjs` for the renderer transport's
16 lifetime probes. They keep actual ports, receivers and old queued callbacks alive and
unadvanced through collection, covering queued/active receipt and idle cache construction
under cancel, supersession, termination and failure. Actual obsolete work/transferred buffers
have zero observed survivors, independent accepted consumers remain readable, and final
disposal returns session ownership to zero. Results are in `test/artifacts/logs/semantic-port-lifetime.json`.
This is lifetime evidence; native physical peaks and aggregate admission remain separate gates.

The exact-certificate checkpoint reuses the receiver's completed validation during
native Live preparation for the very same immutable graph, source, path, serialized policy
and non-stricter limits. Certificate metadata is independently charged; it retains no old
graph through its weak witness. Native copy/model output admission remains unchanged. The
complete service diagnostic still verifies all 18 outputs but fails its incremental gate on
the second many-small-block edit. Nested edits measure 666.4/725.1 ms (previously about
3.37 seconds), still above the unchanged 500 ms target. Exact current reports are archived in
`test/artifacts/logs/snapshot-certificate-service-profile.json`; the preceding comparison report is
`test/artifacts/logs/semantic-service-before-certificate-profile.json`.

Run `node --expose-gc test/benchmark/profiles/profile-snapshot-certificate-lifetime.mjs` to check the weak
certificate witness and output lifetime. Five probes keep certificate handles, raw witnesses,
closed creation tasks and sessions alive through collection, while observing actual prepared
revisions, arenas, sources and inspection captures after cancellation, ended/discarded requests,
eviction and disposal. Completed validation survives commit first; no old graph survives the
ended graph lifetime, and output metadata collects after its final independent handle closes.
Results are in `test/artifacts/logs/snapshot-certificate-lifetime.json`. These are lifecycle checks and do
not establish physical peak admission, packaged p95, initial readiness or ordinary transport
activation. The port lifetime diagnostic still passes all sixteen probes with certificates.

The candidate/cache reclamation checkpoint now passes the complete application diagnostic:
six full fixtures, eighteen matching native semantic hashes/counts/outlines, twelve direct
deltas and one Worker per fixture. Committing native occurrence candidates ends only the old
range reservation; abandoned read-only candidates keep it. Mandatory receiver validation can
reclaim optional word-text cache and retry once on the same prepared graph. Document and
projection caches remain present; the initial round still requires all three caches. Full
word recount and every semantic/incremental assertion remain mandatory. All fixture hashes
and byte lengths match the archived exact-certificate checkpoint. Current evidence:
`test/artifacts/logs/word-cache-retry-service-profile.json` and `test/artifacts/logs/word-cache-retry-service-summary.json`.
Many-small-block edits measure 587.6/755.7 ms and nested edits 543.1/585.6 ms; these individual
observations still do not satisfy the unchanged 500 ms packaged p95 target.

Use `--admission` with the service diagnostic to trace failed reservations without source
content. It builds a separate readable bundle and records requested/available bytes, weighted
resource metadata, ledger counters and stacks in a distinct `-admission` report. Tracing
changes timing and cannot establish latency acceptance. Complete hashes/status, full corpus,
unchanged caps and direct-delta gates still run. The trace that motivated reclamation found
a 6,435,432-byte word workspace with 4,435,170 bytes available on the second many-small-block edit.

Run `node --expose-gc test/benchmark/profiles/profile-preview-candidate-lifetime.mjs` for seven native candidate
probes. Actual old editor text/range maps remain alive and charged for abandoned/rejected
read-only leases and independent installed consumers, and collect after commit or cancellation
when no consumer needs them. Candidate maps and ended reservation metadata also collect;
final disposal leaves zero observed survivors and zero ledger bytes. Results:
`test/artifacts/logs/preview-candidate-lifetime.json`.

Run `node --expose-gc test/benchmark/profiles/profile-semantic-cache-reclaim-lifetime.mjs` for three cache
reclamation probes. It observes actual word-cache maps/entries/chunk arrays under mandatory
validation pressure, holding original receivers, closed baselines, closed receipt work, old
consumers and unadvanced callbacks alive through GC. Acceptance, cancellation and disposal
leave zero observed obsolete cache survivors and zero final ownership. Results:
`test/artifacts/logs/semantic-cache-reclaim-lifetime.json`. Both diagnostics establish the checked lifetimes;
native physical peaks, complete latency, packaged nested fallback and activation remain open.

The twenty-edit diagnostic also passes all six fixtures: **126 complete native semantic
hash/count/outline matches and 120 direct deltas**, with one Worker per fixture. Evidence:
`test/artifacts/logs/word-cache-retry-service-20-profile.json` and
`test/artifacts/logs/word-cache-retry-service-20-summary.json`. Diagnostic edit-readiness p95 is
304.6/244.7/271.1/579.8/648.7/563.9 ms for prose/single-paragraph/mixed-RTL/repeated/many/nested.
The last three still exceed the unchanged 500 ms target. Every round keeps structural
caches; only many-small-blocks reclaims optional prose, on revision 2. Ready-state retained
observations stay under 64 MiB; they are not peak or physical admission measurements.

The new admission-tracing mode passes its complete many-small-block case after showing the
failed word reservation and same-delta retry; `test/artifacts/logs/word-cache-retry-admission-profile.json`.
The original pre-fix trace is archived as `test/artifacts/logs/candidate-storage-admission-profile.json`.

Use `--renderer-cpu` with the service diagnostic to sample renderer work from immediately
before each actual edit/initial attach until Live readiness. It writes one readable
`test/artifacts/logs/service-renderer-cpu-CASE-REVISION.cpuprofile` per round, plus a distinct
`-renderer-cpu` JSON report. Idle receiver cache construction and complete diagnostic hashing
run after profiling stops. Source fixtures, full native hashes/counts/outlines, ownership
cleanup and direct-delta gates still apply. Sampling changes timing; use a separate
uninstrumented run for readiness observations. These profiles cover the renderer, not the
Worker. Each round also reports source-free application performance measures and the wire's
arrival time relative to edit/attach, so Worker wait, receiver work and installation can be
distinguished without adding diagnostic fields to the production protocol.

The fused projection checkpoint keeps standalone projection validation complete, while exact
snapshot output validation combines schema/widget checks with its own complete span,
visibility, separator and HTML/value comparison. It removes the earlier duplicate geometry
walk. Clock callbacks bind directly to their owners and still check the clock after every
advance under the same one-millisecond slice target. No admission weight or cap changes.
New cached-delta tests reject extra span fields, hidden spans, wrong body ends and separators.

The full twenty-edit run passes 126 native semantic revisions and 120 direct deltas again.
Diagnostic edit-readiness p95 is 297.8/236.2/261.1/493.5/638.1/527.4 ms for
prose/single-paragraph/mixed-RTL/repeated/many/nested. Repeated paragraphs now stay below
500 ms across all twenty edits; many and nested remain above target. These observations
still do not supply packaged input/mode/apply-slice or physical peak admission evidence.
See `test/artifacts/logs/fused-projection-service-20-profile.json`,
`test/artifacts/logs/fused-projection-service-20-summary.json` and the latest VALIDATION.md checkpoint.

The shared word-cache layout replaces per-record plan/entry/value/chunk-array objects with
typed metadata, numeric namespace indexes and one retained chunk list. Its revocable chunk
iterators check the owner on every advance. Existing complete word reconstruction/recount,
identity, cap and cancellation checks remain. Construction uses an atomic resizable workspace;
the actual smaller structures have separate row/map/namespace and text/chunk charges.

All 126 complete native revisions and 120 direct deltas pass again with `--edits 20`.
Every round now retains all three caches, including many-small-block revision 20, under the
same 64 MiB cap. Diagnostic readiness p95 is 297.7/241.2/266.3/490.0/536.6/544.1 ms for
prose/single-paragraph/mixed-RTL/repeated/many/nested. Many and nested still exceed 500 ms;
initial readiness and physical peak admission are also unresolved. Evidence:
`test/artifacts/logs/flat-word-cache-service-20-profile.json` and
`test/artifacts/logs/flat-word-cache-service-20-summary.json`.

Word lifetime diagnostics now additionally watch the typed metadata/backing buffers and flat
chunk storage while already-advanced escaped iterators remain alive through GC. Both
`node --expose-gc test/benchmark/profiles/profile-packed-document-lifetime.mjs --words` and the same command
with `--from-document` pass 21 probes; mandatory-reclamation lifetime probes still pass all
three cases. These are ownership/lifetime observations, not physical peak calibration.

Projection context now avoids a second traversal when the complete immutable planning walk
finds no definitions to copy. Body footnote references and identifier sizes still come from
that full walk; nonempty contexts keep their admitted copy pass. Exact cached absence/word
metadata is consulted before repeating shape queries. Word chunk iterators resolve their
numeric range once and retain per-advance and end-of-stream revocation checks.

The current twenty-edit run passes all 126 native revisions and 120 direct deltas with all
three caches retained. Diagnostic readiness p95 is 291.1/242.1/260.6/458.7/514.6/535.9 ms for
prose/single-paragraph/mixed-RTL/repeated/many/nested. Many and nested remain above 500 ms.
Evidence: `test/artifacts/logs/empty-context-service-20-profile.json` and
`test/artifacts/logs/empty-context-service-20-summary.json`. Current GC probes cover the numeric chunk
iterator, complete receiver/port ownership and transient native projection objects; these
remain lifetime observations rather than physical peak admission evidence.

Sealed immediate range bounds now avoid rescanning unchanged descriptor arrays on every
range shift. A complete successful scan can issue source-free evidence bound to an opaque
arena token, array record, covered subset and numeric bounds. New evidence is charged at
512 bytes before allocation under existing overlay ownership. Forged or insufficient
evidence cannot bypass checks; conservative subset misses use a full narrowed scan, and
expanded descriptor multiplicity remains bounded. Full semantic/output validation continues.

The updated complete six-fixture, twenty-edit run verifies **126 native revisions and 120
direct deltas**, retaining all three caches throughout. Readiness p95 is
**281.8/241.3/259.9/431.8/466.7/534.2 ms** for prose/single-paragraph/mixed-RTL/repeated/many/nested.
Many small blocks now meet 500 ms p95, although the first edit takes 508.2 ms. Nested still
fails: its first two edits take 543.4/534.2 ms. An isolated nested result below 500 ms did not
reproduce in the full sequence and is not acceptance evidence. Initial nested readiness is
6,227.7 ms. These are mounted packed application diagnostics, not packaged input/mode/slice
or calibrated physical peak acceptance. Evidence: `test/artifacts/logs/range-proof-service-20-profile.json`
and `test/artifacts/logs/range-proof-service-20-summary.json`.

`node --expose-gc test/benchmark/profiles/profile-packed-range-lifetime.mjs` passes seven probes holding
escaped evidence and closed revocable application-style work handles while observing the
actual arena/index/payload/offset buffers/maps/shapes. Raw helper generators have no independent
revocable ownership contract. Sixteen port and five certificate lifetime probes also pass
against this runtime. No physical peak claim follows from these collection observations.

Exact position-segment evidence now also avoids repeated walks and temporary summary builds
for unchanged arrays. A full successful scan records source-free bounds, expanded visits and
container depth, charged at 512 bytes before allocation. Reuse requires the same arena/array,
exact coverage and range transform, with safe current/resulting position bounds. Narrowed or
split coverage receives a new full scan so varying descendant counts cannot be approximated.
All alias/depth/overflow checks remain enforced. Constructors, prototypes and checkers for
both proof types are frozen, including against reflected method replacement.

The final complete six-fixture twenty-edit run again verifies **126 native revisions and
120 direct deltas**, with all three caches retained throughout. Diagnostic readiness p95 is
**280.8/247.3/261.7/436.0/455.7/475.2 ms** for prose/single-paragraph/mixed-RTL/repeated/many/nested.
All six now meet 500 ms p95 in this sequence. Many/nested maxima remain **516.4/513.5 ms**,
and initial nested readiness is **6,255.4 ms**. An earlier complete run before checker sealing
also measured all six below 500 ms p95, including nested at 464.0 ms; final results above
remain authoritative. This closes the measured packed diagnostic edit p95 gap and does not
establish packaged input/mode/apply-slice, initial readiness, physical admission or activation.
Evidence: `test/artifacts/logs/position-proof-service-20-profile.json` and
`test/artifacts/logs/position-proof-service-20-summary.json`.

`node --expose-gc test/benchmark/profiles/profile-packed-range-lifetime.mjs --positions` passes **nine probes**,
including cancellation during actual temporary DAG summary allocation. Those tables/backing
buffers, along with observed arenas, payloads, indices, maps and shapes, are collected while
proofs and closed revocable handles remain held. The default immediate-range mode passes
seven probes; sixteen actual port and five certificate probes also pass, for **37 current
lifetime probes**. These remain ownership observations, not physical peak calibration.

Projection-cache construction now reuses the receiver's already completed exact snapshot
certificate, avoiding a duplicate complete validation/render of the same immutable revision.
The private brand, graph/owner/source/path, serialized policy and compatible limits must
match. Other cases run full validation. Metadata admission and complete logical bounds remain
enforced. The constructor/prototype and intrinsic authorization checker are sealed; forged
instance methods cannot bypass validation in either preview or cache construction.

The quiet twenty-edit six-fixture run preserves **126 complete native semantic hashes/counts/
outlines and 120 direct deltas**, all three caches and the 64 MiB receiver cap. Edit p95 is
**280.3/240.1/253.3/405.9/441.0/432.3 ms** for prose/single/mixed/repeated/many/nested. Observed
initial readiness is **622.5/439.8/489.3/1,549.3/1,785.4/4,616.2 ms**. Evidence:
`test/artifacts/logs/certificate-cache-service-20-profile.json` and
`test/artifacts/logs/certificate-cache-service-20-summary.json`.

Readiness is a timer observation and can include optional cache work that starts after
publication. The earlier claim that all idle cache construction was excluded was incorrect.
Hashing remains outside timing. Nested apply completion is **3,778.3 ms before / 3,687.5 ms
after**; the larger reduction in observed cold readiness (**6,255.4 to 4,616.2 ms**) mostly
removes optional work after publication. This is not packaged cold/input/mode/apply-slice or
physical admission acceptance. Mandatory cold work, cache task priority and activation remain
open. An earlier contended full run is archived separately and is not the timing comparison.

`node --expose-gc test/benchmark/profiles/profile-semantic-port-lifetime.mjs` now passes **twenty probes**,
including cancellation, supersession, termination and failure during actual projection-cache
construction. Five certificate probes also pass; all observed objects are collected while
closed handles and old callbacks stay held. These establish ownership lifetimes only.

The matching Windows build passes all **73 packaged functional tests**. Packaged performance
remains **five passes, one corpus failure and one intentional profiling skip**: nested still
falls back to Source with no Live samples. The other five complete fixtures meet input,
freshness, mode and apply-slice gates. All six reports identify ASAR SHA-256
`41e31dd7bed5df9b5d23d9d212af5353290a7433ae69a6161bee157f9bddea61`.
Evidence: `test/artifacts/logs/certificate-cache-performance-summary.json`; full release acceptance and
transport activation remain open.

Native copy construction now uses a single generator with an explicit traversal stack.
Existing allocation, key/path, alias, depth, sixteen-value batch and lexical/array progress
checks remain. Every open array closes on cancellation, including when another close throws;
partial output never reaches inspectors. The native lifetime tool observes actual stacks
and adds six cancellation probes with five nested arrays open, for **39 native-copy probes**.
Twenty port and five certificate probes also pass, for **64 current ownership probes**.

The complete six-fixture twenty-edit run preserves all **126 native semantic revisions and
120 direct deltas**. Edit p95 is **277.9/239.9/253.0/425.0/441.9/435.1 ms** for prose/single/
mixed/repeated/many/nested, with all three caches retained under 64 MiB. Nested initial apply
completion is **3,542.7 ms** and observed readiness **4,490.9 ms**. Evidence:
`test/artifacts/logs/native-copy-stack-service-20-profile.json` and
`test/artifacts/logs/native-copy-stack-service-20-summary.json`.

Five alternating cold comparison pairs change only the copy module. All twenty initial/edit
semantic revisions match full native hashes/counts/outlines. Median message-arrival-to-apply
time is **2,187.1 ms recursive / 2,106.7 ms stack (3.7% lower)**. Median apply completion is
**3,396.3 / 3,284.9 ms**; median observed readiness **4,241.9 / 4,153.9 ms**. This modest
diagnostic gain does not establish a packaged SLO. Individual timings vary; the first isolated
new-code result was faster than the full-sequence result and is not the acceptance comparison.
Evidence: `test/artifacts/logs/native-copy-comparison-summary.json` and
`test/artifacts/logs/native-copy-comparison-provenance.json`.

The matching Windows build passes all **73 packaged functional tests** without retry.
Packaged performance remains **five passes, one corpus failure and one profiling skip**:
nested still falls back to Source with no Live samples. The other five complete fixtures
meet their input/freshness/mode/apply-slice gates. All six reports identify ASAR SHA-256
`46b118a7d577f3a9d60f05735b88686b64ae781405a0ef05b518150df7327044`.
Evidence: `test/artifacts/logs/native-copy-stack-performance-summary.json`. Physical/native-input admission,
activation and remaining release acceptance stay open.

Projection HTML serialization now uses one traversal stack while preserving exact public
serializer spelling, chunk boundaries, progress pauses, node/depth checks and shell-call
barriers. The isolated Node comparison alternates old/new implementations over one complete
nested HAST for twelve measured pairs, after three warmup pairs. All outputs match the native
HTML hash, with **239,327 chunks / 71,050 pauses** in both implementations. Median iterator
time is **294.8 / 144.5 ms**. This excludes parse, HAST construction and application scheduling;
it is not a packaged input/freshness measurement or a physical memory bound. Evidence:
`test/artifacts/logs/iterative-html-benchmark.json` and `test/artifacts/logs/benchmark-iterative-html.mjs`.

The final mounted application sequence verifies **126 complete native revisions / 120 direct
deltas** without raised caps or lost caches. Its nested cold readiness is 3,399.3 ms and edit
p95 491.8 ms; an additional isolated nested sequence verifies 21 more revisions / 20 deltas,
with 3,112.2 ms cold readiness and 434.2 ms edit p95 (521 ms maximum). The prior full-sequence
nested edit p95 was 436.5 ms. Report both current sequences; these results do not establish a
uniform warm-edit gain. Complete hash checks run after ready timing, and recorded retained
weights are captured after cache warmup/hash inspection, not instantaneous ready-time OS
memory. Evidence: `test/artifacts/logs/iterative-html-service-20-summary.json` and
`test/artifacts/logs/iterative-html-isolated-nested-20-summary.json`. Native/aggregate admission, mandatory
cold validation and the ordinary packaged nested Live gate remain open.

Native-copy suspension guards now check capture/item liveness without decoding the selected
immutable record kind again. Initial kind/schema reads, separate owner checks, admission and
yield points remain. Five alternating fresh-Electron minified nested comparison pairs verify
twenty complete native revisions, with median arrival-to-apply time **1,928.3 / 1,871.2 ms**
(about 3% lower). Initial apply completion is 3,091.1 / 3,053.1 ms and first-edit readiness
516.9 / 514.5 ms. Both first-edit medians exceed 500 ms; this is a modest diagnostic gain,
not packaged latency acceptance. Evidence: `test/artifacts/logs/scope-liveness-comparison-summary.json`
and its paired raw reports under `test/artifacts/logs/scope-liveness-comparison/`.

The separate complete six-fixture twenty-edit sequence preserves **126 native revisions /
120 deltas**, all three caches and unchanged caps. Edit p95 is **295.0/256.1/259.6/466.0/
468.9/470.9 ms** for prose/single/mixed/repeated/many/nested; nested initial readiness is
3,548.0 ms and maximum edit 539.4 ms. Compared with the preceding full run, these results
do not establish a uniform cold or warm gain. Hashing remains outside readiness timing;
recorded retained weights follow cache warmup/hash inspection. Evidence:
`test/artifacts/logs/scope-liveness-current-service-20-summary.json`. Native/aggregate admission, mandatory
cold latency and ordinary transport activation remain open.

Normal exact word validation now traverses text once and grows its workspace before copying
each complete leaf/cache entry. Explicit phase observers retain separate sizing/read walks.
All caps, conservative admission weights, whole-string Intl semantics and sixteen-call
segment batches remain. The isolated exact 1,048,669-byte nested fixture comparison uses
three warmup pairs and twelve alternating measured pairs, with medians **238.1 / 140.2 ms**
(about 41% lower). Validation advances fall **452,688 to 238,548**; native counts match and
all reservations return to baseline. Parse, encoding, indexing, session disposal and hashes
are outside timing. Evidence: `test/artifacts/logs/word-single-pass-benchmark.json`.

Five alternating minified application pairs preserve twenty complete native revisions.
Median arrival-to-apply time is **1,961.3 / 1,785.5 ms** (about 9% lower), but first-edit
medians remain **596.3 / 594.7 ms**. Evidence and source hashes:
`test/artifacts/logs/word-single-pass-comparison-summary.json`. The separate full six-fixture twenty-edit
sequence verifies **126 complete revisions / 120 deltas**, all three caches and unchanged
caps. Edit p95 is **307.3/266.5/275.5/430.7/465.8/471.1 ms** for prose/single/mixed/repeated/
many/nested. Nested cold readiness is 3,736.8 ms with 589.3 ms edit maximum; the preceding
full run measured 3,548.0 ms and 470.9 ms p95. These full sequences do not establish a
uniform cold or warm gain. Hashing follows readiness, and retained weights follow cache/hash
inspection. Evidence: `test/artifacts/logs/word-single-pass-current-service-20-summary.json`.
Mandatory complete validation, native/aggregate admission and activation remain open.

The owned projection stream now groups tiny HTML outputs with a separately admitted 64 KiB
collector, preserving every original serializer suspension and at most one input piece per
advance. Five alternating final-code minified application pairs preserve twenty complete
native revisions. Median arrival-to-apply time is **1,784.0 / 1,624.6 ms** (about 9% lower),
but first-edit readiness remains **618.5 / 597.2 ms**. Separate event instrumentation
observes **233,032 / 6,300 body callbacks**, identical **2,254,745 UTF-16 units** and equal
complete hashes; this fixture has no widget events. Counter runs are separate from timing.
Evidence: `test/artifacts/logs/projection-buffer-comparison-summary.json` and
`test/artifacts/logs/projection-buffer-events-summary.json`. Earlier multi-piece-per-advance prototype
timings are excluded from this final-code comparison.

The separate final six-fixture twenty-edit run verifies **126 complete native revisions /
120 deltas**, all three caches and unchanged caps. Edit p95 is **344.3/291.4/292.8/484.6/
517.2/531.0 ms** for prose/single/mixed/repeated/many/nested. Nested initial readiness is
**3,854.9 ms** and maximum edit **592.3 ms**. All six initial and edit p95 observations are
higher than the preceding full run, so the controlled cold gain is not a uniform corpus
gain. Readiness can include optional cache work before timer observation; complete hashes
and retained-weight inspection follow readiness. Evidence:
`test/artifacts/logs/projection-buffer-current-service-20-summary.json`. Mandatory cold validation,
native/aggregate admission, ordinary packaged nested Live and transport activation stay open.

Definition-context collection now walks the document once, preflighting and admitting each
complete selected definition before copying it. Prior private copies remain charged under
unchanged weights/caps. Three warmup pairs and twelve alternating measured pairs over the
exact nested fixture give median context time **187.7 / 107.5 ms** and **428,282 / 214,143
advances**. Complete context/final costs match. Parse, encoding, indexing and session disposal
are outside timing; work creation, iteration, inspector equality and work cleanup are inside.
This is an isolated collection result. Evidence: `test/artifacts/logs/context-single-walk-benchmark.json`.

Five alternating fresh-Electron minified application pairs preserve twenty complete native
revisions. Median arrival-to-apply is **2,134.2 / 2,014.7 ms** (about 6% lower), with one pair
regressing; first-edit readiness remains **712.5 / 661.6 ms**. Complete cold validation remains
above its target. Evidence and source hashes: `test/artifacts/logs/context-single-walk-comparison-summary.json`.
Native/aggregate admission, actual packaged latency and ordinary transport activation remain open.

The separate final six-fixture twenty-edit sequence preserves **126 complete native revisions /
120 deltas**, all three caches and unchanged caps. Edit p95 is **358.8/272.8/312.0/547.4/
570.5/577.2 ms** for prose/single/mixed/repeated/many/nested; nested initial readiness is
**3,956.5 ms**, maximum edit **624.9 ms**. Five edit p95 observations exceed the preceding
full run, and three current edit p95 values exceed 500 ms. This is mixed corpus evidence,
not a uniform gain. Complete hashes and retained-weight inspection follow timer-observed
readiness, which can include optional cache work. Evidence:
`test/artifacts/logs/context-single-walk-current-service-20-summary.json`. The remaining activation,
physical admission and packaged latency gates stay open.

The parser additionally omits impossible WWW/HTTP literal-autolink attempts while retaining
all mdast transforms and conservative entity/escape behavior. Separate cumulative allocation
samples on the complete nested source estimate **1,032,783,640 / 956,494,720 bytes**, including
collected objects; this roughly 7% difference is not a physical or retained peak bound.
Three parse samples have nearly equal medians, **536.1 / 533.7 ms**. Evidence:
`test/artifacts/logs/parser-current-native-profile.json` and `test/artifacts/logs/parser-autolink-guards-profile.json`.

Five alternating fresh minified Electron pairs verify twenty complete native revisions and
explicit worker-source substitutions/emitted variant markers. Median initial ready is
**3,250.5 / 2,700.5 ms**, first-message arrival **1,344.4 / 1,187.0 ms**, and first-edit ready
**519.2 / 518.1 ms**. Two current cold observations regress, and two current edits regress;
one baseline cold observation is 4,644.9 ms. Preserve this spread rather than claiming a
uniform latency improvement. All current first edits remain above 500 ms. Evidence:
`test/artifacts/logs/autolink-guards-comparison-summary.json` and raw pairs/build proofs.

The completed-flow dependency prototype remains uninstalled. Its original renderer-only
injection omitted the actual worker and is excluded. Corrected worker-source matches and
emitted worker hashes/flags establish one valid pair, with first nested private commitment
**319.5 / 310.3 MB**; repeat increases vary with retained process baselines. Separate forced-GC
raw-block endpoints fall by about 19.7 MB. These observations do not calibrate native
admission, establish repeatable physical peaks or activate packed transport. Evidence:
`test/artifacts/logs/parser-flow-release/verified-summary.json`.

Five subsequent alternating fresh-Node pairs confirm lower cumulative allocations in every
current pair. Median sampled allocation is **1,030,089,256 / 952,424,720 bytes** (about 7.5%
lower); fifteen separately profiled parse samples per variant have medians **571.94 / 565.61
ms**. All complete semantic digests agree. This measures cumulative sampled allocation,
including garbage, not live or physical peaks. Evidence: `test/artifacts/logs/autolink-allocation-comparison.json`.

The final complete six-fixture twenty-edit sequence verifies **126 native revisions / 120
deltas**, all caches, unchanged limits and zero final ownership. Edit p95 is **271.5/244.5/
259.2/397.2/423.7/430.3 ms** for prose/single/mixed/repeated/many/nested. Nested initial ready
is **2,874.9 ms**, maximum edit **547.1 ms**. Unchanged grammar fixtures also improve against
the preceding unpaired sequence, so its whole timing difference cannot be attributed to the
guards. Complete independent hashes/ownership checks follow timer-observed readiness, which
can include optional work. Evidence: `test/artifacts/logs/autolink-guards-current-service-20-summary.json`.
Native/aggregate admission, mandatory cold validation and packaged performance remain open.

The matching package passes all **73 functional flows**, while the separate current packaged
performance suite has **five passed / one failed / one intentional skip**. Its corpus gate
fails prose's **4.2 ms** maximum apply slice, many-small-blocks **523.4 ms** freshness p95,
and nested Source fallback with missing Live samples. The complete nested ordinary JSON
payload is **22,705,613 bytes**, plus envelope reservation, exceeding the unchanged 8 MiB
wire cap; the actual ordinary encoder rejects it. This is current failing acceptance
evidence, separate from the passing experimental packed diagnostic. Reports bind the
matching executable/ASAR hashes. Evidence: `test/artifacts/logs/autolink-guards-performance-summary.json`,
`test/artifacts/logs/autolink-guards-ordinary-transport.json`, and `test/artifacts/logs/autolink-guards-validation-check.json`.


### Direct complete-root projection definition indexing — 2026-10-27

The ordinary full-root renderer now indexes all link/footnote definitions by direct
preorder into public converter State maps before invoking the original root handler.
The converter still owns all native handlers and the complete footnote footer. Original
root identity/data/positions, global first-wins definitions, all widget fields and raw-HTML
policies remain unchanged. Ten added full-output regressions and all 11,061 units pass.

Five alternating fresh actual ordinary-worker pairs verify 210 complete native revisions
and emitted worker variants/hashes. Median warmed render is
**20.8 / 11.6 ms**, worker round trip
**224.8 / 219.4 ms**; every pair improves both medians.
Round trip excludes debounce, main validation and apply. No profilers/concurrent workloads
run during the comparison. Evidence: `test/artifacts/logs/ordinary-renderer-comparison-summary.json`.

The matching Windows build, actual install/save/reopen/uninstall/restoration, and all 73
packaged functional flows pass. Full packaged performance is **5 passed / 1 failed /
1 intentional skip**. All five non-nested corpus cases meet their current assertions;
nested ordinary Live fallback and its missing Live samples remain unresolved. The actual
ordinary encoder rejects the complete nested JSON payload of **22,705,614 bytes**,
plus envelope, against the unchanged 8 MiB wire cap. All six raw reports bind matching
executable/ASAR hashes. No native/aggregate admission, cold validation, transport activation
or full release gate is waived. Full evidence: `test/artifacts/logs/projection-definitions-validation-check.json`
and the corresponding completed checkpoint in `docs/validation/implementation-history.md`.


### Allocate common native records once — 2026-10-27

The packed native copier allocates complete common three-field record shapes after full
admission, fills own data slots and freezes the result. Arbitrary shapes, key order and
hostile names retain the general path. Values, descriptors, prototypes, all logical costs,
scheduler advances and every validation/admission checkpoint remain unchanged. Four added
regressions and all 11,065 units pass; 45 forced-GC probes collect their watched objects
while closed handles remain held. Evidence: `test/artifacts/logs/native-record-lifetime.json`.

Five alternating fresh Node pairs show copy medians **249.12 / 202.13 ms**, about 19% lower,
and separately sampled cumulative allocations **809,727,992 / 797,401,288 bytes**,
about 1.5% lower. Exact full-child hashes, work advances and logical costs agree. This is
not physical peak calibration. Five fresh application pairs verify twenty complete native
revisions and actual renderer variant hashes; the producer worker is byte-identical.
Receipt-to-apply medians are **1519.2 / 1507.6 ms**, only about 0.8% lower.
Worker-arrival timing differs substantially despite unchanged worker bytes, so the larger
initial-readiness difference cannot be attributed to copying. Two current first edits
regress and all current first edits exceed 500 ms. Evidence:
`test/artifacts/logs/native-record-comparison-summary.json` and `test/artifacts/logs/native-record-service-comparison-summary.json`.

The full six-fixture twenty-edit run preserves 126 complete native revisions / 120 deltas,
all caches and zero final ownership. Nested initial readiness is 2,746.6 ms, receipt to
apply 1,620.5 ms, edit p95 433.3 ms and maximum 492.7 ms in this selected diagnostic.
Cold validation and native/aggregate admission remain open. The matching Windows build,
actual install/save/reopen/uninstall/restoration and all 73 packaged functional flows pass.
Full packaged performance is **5 passed / 1 failed / 1 intentional skip**. Ordinary nested
Source fallback remains unresolved: its full native JSON payload is
**22,705,623 bytes**, plus envelope, exceeding the unchanged 8 MiB wire cap.
All raw performance reports bind matching executable/ASAR hashes. Complete current evidence:
`test/artifacts/logs/native-record-validation-check.json` and the corresponding `docs/validation/implementation-history.md` checkpoint.


### Read arena scalars without transient path wrappers — 2026-10-27

Exact arena-backed atomic queries now resolve record IDs directly, avoiding transient path
wrappers while retaining complete edge checks, output admission, costs and scheduler advances.
Overlays/transforms and generic traversal remain unchanged. Two added path/failure-order tests,
all 11,067 units, 45 lifetime probes, 20 complete paired application revisions and the six-fixture
126-revision/120-delta sequence pass. Both emitted renderer and worker variants are verified.

Five fresh Node pairs reduce separately sampled cumulative allocation medians from
795,324,560 to 753,235,824 bytes, about 5.3%; copy CPU is essentially unchanged
(201.00 / 200.73 ms). A prior generic-path candidate was measured slower and rejected.
Application receipt medians are 1461.1 / 1455.6 ms; first-edit medians regress from
506.9 to 514.4 ms (4/5 slower current edits). This does not establish latency acceptance
or physical/aggregate memory calibration. The matching Windows build, actual install/save/reopen/
uninstall/restoration and all 73 packaged functional flows pass. Full packaged performance:
5 passed / 1 failed / 1 intentional skip. Ordinary nested Live fallback,
cold validation, native/aggregate admission and platform/release acceptance remain open.
Full methods, source/artifact hashes, mixed results and failed assertions are recorded in
`docs/validation/implementation-history.md` and `test/artifacts/logs/arena-query-validation-check.json`.


### Compose internal projection work under its enclosing owner — 2026-10-27

Internal native-copy and definition-context generators now delegate through their enclosing
capture-owned projection task; independent inspectors still own registered work. All guards,
output admission, logical costs, checkpoints and finally cleanup remain. The exact nested
projection reduces registrations from 6,302 to one with the same 535,367 advances, complete
HTML and native/state/output cost vectors. A kernel-finally rewrite was measured slower and
rejected; the PackedWork kernel remains byte-for-byte unchanged.

Nine new scheduler regressions and all 11,076 units pass, with one intentional skip. All 140
lifetime probes pass with closed handles held unadvanced, covering both native ownership
modes, context/state/native output and complete chunk rendering. Five actual application
pairs preserve twenty complete native revisions and all four renderer variants; the producer
worker imports none of those modules and is byte-identical. Receipt medians are
1446.3 / 1441.4 ms; first-edit medians 509.4 / 505.2 ms.
Gains are small; cold validation, physical/aggregate admission and latency gates remain open.

The full six-fixture run verifies 126 revisions/120 deltas and zero final ownership. The
matching Windows build, actual install/save/reopen/uninstall/restoration and all 73 packaged
flows pass. Full packaged performance: 5 passed / 1 failed / 1 intentional skip. Ordinary
nested Source fallback and platform/release acceptance remain open. Full evidence, methods,
hashes and current failed assertions: `docs/validation/implementation-history.md`,
`test/artifacts/logs/owned-compose-validation-check.json`.


### Close suspended work when owner cancellation cleanup fails — 2026-10-27

Cancellation now closes suspended generators even when immediate owner cleanup throws;
reentrant deferral and the normal next path are preserved. Two pre-fix failures now pass.
Current checks, 11,078 unit tests, 73 packaged flows, 140 lifetime probes, 126 full native
service revisions / 120 deltas and actual install/save/reopen/uninstall/state restoration
pass. Ordinary nested Live transport still exceeds the fixed 8 MiB cap; full performance
has 1 failed test(s). The goal remains active, with cold validation,
native/aggregate admission and platform/release gates open. Detailed current artifacts,
metrics, provenance and rejected guard experiment: docs/validation/implementation-history.md, section
"Close suspended work when owner cancellation cleanup fails — 2026-10-27"; `test/artifacts/logs/work-cleanup-validation-check.json`.


### Compose complete snapshot validation under its enclosing owner — 2026-10-27

Internal complete validators now delegate to capture-owned parents; public validators
retain independent revocable work. Root/description/word/schema/output checks, guards,
limits, checkpoints and cleanup remain. Nested validation uses 10/4 registrations and
7,740,080/4,349,848 handle advances with the same 1,329,813 scheduler checkpoints.
Five actual application pairs measure receipt medians 1456.6/1419.3 ms;
the gain is small and latency targets remain open. The held creation-wrapper retention bug is fixed. Current checks, 11,081 unit
tests, 73 packaged flows, 154 lifetime probes, 126 full native service revisions / 120 deltas
and actual installer restoration/removal pass. Full performance has 1 failed test(s);
ordinary nested Live transport, cold receipt, native/aggregate admission and platform/
release gates remain open. Full goal stays active. Details: docs/validation/implementation-history.md, section
"Compose complete snapshot validation under its enclosing owner — 2026-10-27"; `test/artifacts/logs/validation-compose-final-validation-check.json`.


### Reject isolated arena tag-query optimizations — 2026-10-27

Direct first-byte tag queries and a fully charged one-byte-per-record type index were
measured in five Node and five actual renderer/Worker application pairs each, then reverted.
Node native-copy gains around 2% translate to only 0.8%/1.1% application receipt differences;
edits are mixed, and the index adds approximately 362 KB to the complete fixture ledger.
Both variants preserve complete native hashes and multibyte object shape boundaries.
Restored runtime/tests match the current ASAR; 700 focused tests and the previous complete
release verifier pass. A fresh fourteen-source-bound renderer CPU profile still identifies
work dispatch and complete projection validation as substantial remaining costs.
No prototype is installed and no delivery/performance gate is newly closed. Detailed
methods, limitations and evidence: docs/validation/implementation-history.md, section "Reject isolated arena tag-query optimizations — 2026-10-27";
test/artifacts/logs/arena-experiments-check.json. Full goal remains active.


### Keep nested projection validation under its registered owner — 2026-10-27

Internal array/schema/state/output borrows now delegate to one capture-owned validation
task; public independent APIs keep revocable registered work. Certificate cleanup attaches
to that task, including queued cancellation, and its forwarding outer handle is removed.
All guards, validations, admissions, scheduler checkpoints and the PackedWork kernel remain.
Registrations fall 4/1 and handle advances 4,349,848/1,329,814, with the same 1,329,813
scheduler advances. Five actual renderer/Worker application pairs measure receipt medians
1425.4/1379.5 ms and edit readiness
505.9/499.3 ms. Current checks, 11,091
unit tests, 73 packaged flows, 180 lifetime probes, 126 complete revisions/120 deltas and
actual installer restoration/removal pass. Full packaged performance has
1 failed test(s); ordinary nested Live transport, cold
receipt, aggregate/native admission and platform/release gates stay open. Full goal remains
active. One earlier full service run observed an unexplained Worker restart; the subsequent
fully observed audit passed, and both runs are preserved. Details: docs/validation/implementation-history.md, section "Keep nested projection validation under its registered owner — 2026-10-27";
test/artifacts/logs/projection-owner-validation-check.json.


### Preserve replacements during synchronous Worker failure — 2026-10-27

SemanticService keeps the identity of each start's running request. Synchronous failure
notification can already start a replacement; the older call now neither posts its stale
request nor terminates the replacement when the old post later throws. Five original
regressions fail and now pass, including the actual packed channel. A real-Worker injected
send failure creates three Workers before/two afterward with identical complete outputs.
Current checks, 11,096 unit tests, 73 packaged flows,
126 native revisions/120 deltas and actual installer restoration/removal pass. The prior
630-revision bounded trace did not reproduce the original unexplained startup event;
its aggregate repeat-count harness error is preserved and independently verified. The
original startup cause remains open, along with performance (one failed packaged test),
transport, admission and platform/release gates. Detailed methods, provenance and limits:
docs/validation/implementation-history.md, section "Preserve replacements during synchronous Worker failure — 2026-10-27"; test/artifacts/logs/service-recovery-validation-check.json.


## Plan serialization with explicit depth frames — 2026-10-27

The serialization admission planner now uses an explicit depth stack instead of a
recursive generator for every HAST node. Frames remain within the caller's existing
depth workspace. The complete postorder calculation still includes escaped attributes,
raw HTML policy, overwritten widget serializations, sibling strings, nested joins,
entity scratch, shell scratch and the bounded chunk collector. Node/depth limits and
every entry, property, lexical and completion scheduler checkpoint remain unchanged.
Native output is still private until the complete plan succeeds. No transport activation,
wire/memory limit, accounting weight, debounce or scheduler clock check changes.

A fresh mounted Electron renderer CPU diagnostic, collected before this stack change
and after the Worker recovery fix, reports 1,558.7 ms cold receipt-to-apply for the exact
nested fixture. Serialization planner visit self-time is 37.3 ms; arena path lookup is
57.2 ms and PackedWork.next is 63.4 ms. Eighteen actual source imports and both emitted
bundles are verified. This unminified sampled run includes optional cache work and
debounce/Worker wait, and is diagnostic rather than an acceptance latency measurement.
Its raw CPU profiles, full native oracle hashes and source/build bindings are preserved
in test/artifacts/logs/cold-after-recovery-summary.json and the associated files. This replaces the
older pre-composition CPU profile as evidence for selecting the next optimization.

An isolated Node/Vite comparison builds production ProjectionSequence HAST for all
6,300 nested-fixture blocks plus the footer. Both planner variants visit 179,498 nodes, take 28,344
advances, and produce identical complete plan hashes and admission maxima. Three warm
baseline runs are 49.85/51.50/51.09 ms; candidate runs are 43.05/42.34/42.51 ms. One
separate allocation sampling run per variant reports 179,837,968 versus 80,174,776 bytes.
These are isolated diagnostic observations, not a physical memory bound or repeated
allocation estimate. Native HAST hashes are identical. Sources, heap profiles and raw
reports are kept in test/artifacts/logs/serialization-stack-{baseline,current}.{json,heapprofile}.

Thirty independent source-variant fidelity comparisons cover all six complete fixtures
in both raw HTML modes, deep sibling/widget ranges, empty roots, unsupported nodes and
properties, node/depth failures and cancellation. All 78,496 completed plans match, as
does each checkpoint's operation count, lexical units and completion status. Both
versions leave their native inputs unchanged. The archived original implementation is
byte-verified against the preceding ASAR before modification. New permanent tests also
exercise actual node/text bounds and cancellation at the exact depth-128 ceiling with
siblings in both raw HTML modes. Existing fixed native admission-weight tests pass.

Five alternating fresh minified mounted application pairs retain full validation,
independent complete native oracles, real edits and all existing limits. Cold
receipt-to-apply medians improve from 1,395.1 to 1,368.2 ms (1.9%); all five candidate
paired observations are lower. Initial readiness medians are 2,554.8/2,536.7 ms. First
edit readiness is effectively flat at 569.3/570.3 ms and remains over the 500 ms target.
Each actual renderer variant marker is checked; the producer does not import the
planner and its emitted Worker bytes remain identical. Raw pairs and build proofs are
preserved under test/artifacts/logs/serialization-stack-service-comparison/ and its summary JSON.

Fresh release validation passes static checks, 11,098 unit tests
across 167 files (one intentional skip), 73 packaged flows, the Windows
installer lifecycle and all 180 native/chunk/output/certificate lifetime probes. Closed
unadvanced handles release observed graphs; this is collection evidence rather than
calibrated peak admission. A fresh six-fixture application audit verifies all 126 complete
native revisions and 120 direct deltas, one Worker per fixture, no captured Worker errors,
all three caches and the 64 MiB receiver ledger. Every native hash also matches the
preceding verified recovery release. The fixture asserts zero receiver ownership after
cleanup. Source copies and the complete emitted runtime inventory match the actual ASAR.

Current ASAR: 188,874,800 bytes,
SHA-256 f790b025978ed265dc475761a5913cd7a6faaf42b43e5b5e77e2928b8224cbfb.
Current NSIS: 147,429,423 bytes,
SHA-256 bb6940e7ef93053225841a35ae31aadf2da29be5dd5999771741e41eba000176.
Installer evidence: test/packaging/results/windows-installer-06935619-06ec-46c9-abc4-df03383a0ba6/report.json; 79 installed files, two installed-app launches,
37-byte exact Unicode/BOM/CRLF save and reopen, no captured errors, owned installation
removed and exact previous OS state restored.

The full fresh packaged performance run remains 5 passed / 1 failed / 1 intentional
skip. The nested ordinary transport still falls back: its complete JSON is
22,705,614 bytes against the unchanged 8 MiB cap, and the
actual ordinary encoder rejects it. Packed cold receipt remains far over 150 ms; native
construction/aggregate admission, ordinary activation, unexplained isolated Worker
startup restart and physical cross-platform release gates remain open. The earlier
synchronous Worker recovery fix remains installed; this change neither explains the
separate startup incident nor establishes a complete application release.

Final evidence manifest: test/artifacts/logs/serialization-stack-validation-check.json. All new
temporary scripts, reports, profiles and logs remain under test/artifacts/logs/. The full application
goal remains active.


## Reject root-loop and coordinate-lookup prototypes — 2026-10-27

Three bounded source variants were measured and rejected. The current runtime, all
workspace/runtime inputs and the existing Windows installer remain byte-identical to
the preceding serialization-stack release. No limit, fixture, scheduling checkpoint,
transport eligibility or admission weight changed. This turn adds evidence and removes
these hypotheses from the next implementation step; it does not claim a new runtime fix.

| Prototype | Isolated warm root median, original/candidate | Mounted cold receipt-to-apply median | Mounted first-edit median | Decision |
| --- | --- | --- | --- | --- |
| Inline root visits in the existing depth stack | 212.7 / 198.4 ms | 1,381.4 / 1,389.0 ms | 576.4 / 593.0 ms | Reject: isolated gain does not improve the application |
| Use adjacent sparse checkpoints for coordinate ranges | 227.1 / 302.0 ms | 1,439.1 / 1,431.7 ms | 589.9 / 610.6 ms | Reject: isolated regression and mixed application timing |
| Check for a following checkpoint before that lookup | 206.6 / 194.3 ms | 1,439.5 / 1,412.6 ms | 563.6 / 579.3 ms | Reject: modest cold gain with worse edit median |

Each row uses five alternating fresh minified Electron application pairs with the actual
Worker, receiver, SemanticService, mounted editor and independent full native oracle.
All 30 runs/60 complete native revisions pass, use one Worker, preserve full-then-delta
transport and have no captured Worker errors. Both emitted renderer variants are checked;
the producer imports neither changed helper, and its Worker bytes are identical within
every pair. Cold paired observations improve in 3/5, 4/5 and 4/5 pairs respectively; edit
observations improve in 2/5 pairs for each coordinate variant. The timing variation does
not establish a general application gain, so none of these bodies is shipped. No extra
repeats were taken to seek a passing performance result.

Isolated runs include three warm traversals per variant and a separate sampled-allocation
run, rather than repeated physical memory measurements. Every root profile validates
113,368 nodes in 214,396 advances and produces the same complete observer sequence hash.
The root-loop and final coordinate prototypes also preserve all 1,329,813 full-snapshot
certificate scheduler advances, 1,329,814 PackedWork.next calls, one capture work
registration, source/root/HTML hashes and zero final ownership. These changes do not
remove the checkpoint volume that dominates the remaining complete validation work.

The coordinate idea derives positions from the next existing sparse checkpoint when
an interval contains at most one line ending or the offset follows its final ending.
Dense endings and final partial intervals still scan at most 255 UTF-16 units. It adds
no index storage. A separate baseline/candidate oracle checks all 1,222,966 normalized
UTF-16 coordinates per variant across 1,575 cases: every CR/LF/CRLF stride alignment,
initial BOM, exact/partial checkpoints, empty strings, dense endings, tabs, Unicode and
lone surrogates. All coordinates, construction pauses and charged index bytes match;
invalid offsets are rejected. A correctness proof alone does not establish a useful
application performance result. The extra following-checkpoint bound is a measured
variant; no unmeasured JIT/deoptimization cause is asserted for its timing difference.

Rejected bodies are test/artifacts/logs/root-visit-rejected.ts,
test/artifacts/logs/source-point-range-phase1/packing-source-points.ts and
test/artifacts/logs/source-point-fast-rejected.ts. Their originals are in test/artifacts/logs/root-visit-before/
and test/artifacts/logs/source-point-range-before/, verified against the current ASAR before edits.
Raw profile source paths referring to the then-current files map to those archived
candidate bodies in test/artifacts/logs/source-point-experiments-check.json; they must not be compared
with the restored originals. All three application comparison summaries, 30 raw reports,
emitted bundle hashes, isolated heap profiles, oracle results and executed drivers remain
under test/artifacts/logs/. The final verifier checks these bindings and exact restoration.

The unchanged ASAR still contains 236 runtime files plus 122 core,
18 editor and 72 renderer source files, all checked against current bytes. Artifact
hashes remain f790b025978ed265dc475761a5913cd7a6faaf42b43e5b5e77e2928b8224cbfb (ASAR) and
bb6940e7ef93053225841a35ae31aadf2da29be5dd5999771741e41eba000176 (NSIS). The preceding 11,098 unit tests, 73 packaged flows,
Windows installer lifecycle, 126 native revisions and 180 lifetime probes remain
hash-bound prior evidence for these restored sources; they were not rerun this turn.
Focused prototype checks pass 135 tests, including all 652 pinned CommonMark examples
under both grammars. Fresh release inventory and prior-evidence/source rechecks pass.
No temporary root files or owned application processes remain.

The full application goal remains active. Ordinary nested transport still exceeds its
unchanged cap; complete packed validation remains far above 150 ms. Future work should
address the amount and composition of complete validation or native/aggregate admission,
rather than shipping these source-level rearrangements on isolated timing alone. The
separate unexplained startup restart, hardware/platform and distribution gates remain
open. Final evidence: test/artifacts/logs/source-point-experiments-check.json.

## Share the cold document root walk — 2026-10-28

Complete cold document validation now collects text during its existing root/schema/
descriptor walk and counts the complete prose afterward. Existing weights include the
simultaneous root/description workspaces; insufficient overlap capacity discards the
partial collector and retries the original independent passes. Explicit word-phase
observers and baseline-backed revisions keep their previous paths. No cap, text batch,
Intl batch, source eligibility or per-advance scheduler clock check changed.

Five alternating fresh minified Electron pairs verify all twenty complete native revisions
against the independent oracle, with one Worker and full-then-delta transport. Actual
baseline/candidate renderer markers and source hashes are checked; paired producer Worker
bytes match. Cold receipt-to-apply medians improve from 1,502.3 to 1,330.7 ms (all five cold
pairs lower); initial ready medians are 2,775.6 / 2,552.5 ms and first-edit medians are
572.5 / 563.6 ms. Raw pairs remain in `test/artifacts/logs/document-word-fusion-service-comparison/`.
The corrected method/provenance report is `test/artifacts/logs/document-word-fusion-comparison-verified.json`;
its copied coordinate-prototype description in the original metadata is preserved separately.

The independent full snapshot-certificate count falls from 1,329,813 to 1,169,206 scheduler
advances and from 1,329,814 to 1,169,207 PackedWork.next calls. One work registration,
source/root/HTML hashes, complete validation and zero end ownership remain. This measures
less duplicated work; it neither batches away deadline checks nor proves physical admission.

Fresh current-source verification passes 11,104 units plus one skip, all 73 packaged flows,
Windows installer/save/reopen/uninstall restoration, 126 complete native revisions/120 deltas
and all 180 lifetime probes. The six-case sequential audit observes nested cold receipt at
1,611.0 ms; the paired improvement remains well short of the 150 ms packed activation gate.
Packaged performance stays 5 passed/1 failed/1 intentional skip, with the same nine nested
ordinary-transport fallback assertions. Complete native/aggregate admission and platform/
distribution gates also remain open. Current artifact hashes, full methodology and final
manifest: `docs/validation/implementation-history.md`, `test/artifacts/logs/document-word-fusion-validation-check.json`.

## Rejected cold context summaries — 2026-10-28

Whole-root absence does not help the authoritative nested corpus, which contains a
reference definition: complete certificate advances stay at 1,169,206. A transient map
of validated top-level absence reduces advances to 961,369, preserving logical costs
and full fidelity. Its initial five alternating fresh application pairs favor it, but
the final source-bound five pairs observe median cold receipt worsening from 1,371.7
to 1,496.8 ms (four pairs slower). Final edit medians are 667.5/657.0 ms. All 30 runs
across the three experiments produce the same 60 complete native results, one Worker
per run and full-then-delta transport. Worker bytes are unchanged. No reliable latency
win or physical-memory improvement is established.

A separate 16-case differential also finds two lost eligibility cases at 2 MiB due
to an omitted native-copy capacity fallback. All experimental runtime changes are
restored; two permanent regression tests protect those complete 100/600-paragraph
snapshots. Fresh check and all 11,106 units plus one skip pass. Existing runtime and
installer bytes are unchanged; the packaged test source predates the two new cases.
Evidence and exact historical source/bundle hashes: docs/validation/implementation-history.md and
test/artifacts/logs/context-rejection-verification.json. Earlier favorable observations remain
archived alongside the final rejection. The full application goal remains open.

## Preserve the Worker after accepted-response consumer exceptions — 2026-10-28

An accepted response's UI callback could throw after starting newer work, causing the
Service to terminate that work and spend a genuine Worker restart. Both native/packed
handlers now restart only while the original request still owns the running slot.
Seven regressions reproduce the preceding behavior and pass with the fix (39 focused
tests). Actual Electron packed fault injection observes baseline two Workers/redundant
full versus current one Worker/full then delta, with identical complete native results
and producer Worker bytes. This does not explain the separate old startup restart.

Fresh verification passes 11,113 units plus one skip, 73 packaged flows, the real Windows
installer lifecycle and 126 complete native revisions/120 direct deltas across all six
authoritative Service cases. All current runtime and workspace source bytes match the
new package. No core/renderer lifetime probe is rerun for this Service-only change.

Packaged performance remains 5 passed/1 failed/1 intentional skip with the same nine
nested assertions. Sequential nested packed receipt-to-apply is 1,362.4 ms, above the
150 ms requirement. Ordinary complete nested JSON is 22,705,614 bytes plus reserve and
the unchanged 8 MiB encoder rejects it. This fix is a reliability improvement; ordinary
transport, packed latency, native/aggregate admission and release gates remain open.
Current artifact hashes and exact source/bundle/report bindings are in docs/validation/implementation-history.md
and test/artifacts/logs/consumer-failure-validation-check.json. Temporary artifacts stay in test/artifacts/logs/.

## Collect renderer context during the complete cold root walk — 2026-10-28

Cold snapshot validation now selects/copies exact definitions during its existing full
document walk and completes every root/schema/description/word check before using that
context. Exact projection/layout/widget comparison remains enabled. Fixed context storage
and 1 MiB optional headroom are admitted before collection and subtracted from simultaneous
document allowances; unused headroom releases before output. Capacity failure discards
the transaction and retries original validation. Limits, weights, batching and per-advance
scheduler clock checks remain unchanged.

Five alternating fresh minified Electron pairs for the final bodies improve nested cold
receipt-to-apply medians from 1,295.0 to 1,199.3 ms, all five pairs lower. Initial ready
medians are 2,468.3/2,367.0 ms and first-edit medians 506.8/498.8 ms. Complete native hashes
match the independent oracle; actual renderer markers/source hashes are checked and
producer Worker bytes match. The earlier prototype pairs (1,273.6/1,225.7 ms) remain
separate from the repeated final-source measurements. Complete certificate advances fall
from 1,169,206 to 955,064 with identical source/root/HTML hashes and one work registration.
This is a diagnostic work/latency improvement, not the 150 ms activation gate.

All 42 budget-differential cases preserve acceptance, and nine added tests cover complete
context semantics, late corruption, fallback and partial-copy cancellation. Fresh full
verification passes 11,122 units plus one skip, 73 packaged flows, real Windows installer
lifecycle, 126 complete native revisions/120 deltas and 194 lifetime probes. Holding 39
closed collector objects/callbacks leaves no observed graphs. Runtime and all 215 packaged
workspace source files match the current build.

Packaged performance stays 5 passed/1 failed/1 intentional skip with the same nine nested
assertions. The sequential six-case audit observes nested receipt-to-apply at 1,354.2 ms;
ordinary complete JSON still exceeds the unchanged 8 MiB cap and is rejected. Native and
aggregate admission, packed latency, ordinary transport and release gates remain open.
Current artifact hashes and exact source/bundle/report bindings: docs/validation/implementation-history.md and
test/artifacts/logs/collected-context-validation-check.json. Temporary artifacts stay in test/artifacts/logs/.

## Rejected scalar metadata query experiment — 2026-10-28

Five alternating fresh minified Electron pairs compare exact renderer native copier
bodies with identical current helpers and producer sources. Complete native results
and paired Worker bytes match. Combined type/length/cache lookup removes 409,396 arena
field resolutions while preserving all 955,064 scheduler advances. Cold receipt medians
are 1,348.5/1,314.6 ms, with only three pairs improving; every paired edit is slower
(medians 517.7/531.5 ms). Outlier causes are unproven. Reject the five-file prototype.

All 452 runtime/test inputs are restored exactly and existing release artifacts verify.
Fresh static checks and 11,122 units plus one skip pass. The preceding installer remains
current; no packaged/installer/lifetime rerun is claimed. Complete pair observations and
source/bundle/restoration bindings: docs/validation/implementation-history.md and
test/artifacts/logs/scalar-metadata-validation-check.json. Full application gates remain open.

## Windows application icon package — 2026-10-28

The current Windows package includes the Manuslip application/window/installer icon.
Actual PE and installed-window checks pass. The package comparison preserves 235 runtime
files byte-exactly; main/index.mjs only adds the icon option and main/icon.png is added.
Every semantic, renderer and Worker byte matches the preceding release, so this is a
packaging change with no semantic optimization claim. Full Service/lifetime probes are
not rerun. Fresh checks pass 11,122 units plus one skip, 73 packaged flows and the real
installer lifecycle. Fresh packaged performance remains 5 passed/1 failed/1 intentional
skip with the same nine nested assertions. Current artifacts and 474 source/configuration/
asset bindings: docs/validation/implementation-history.md and test/artifacts/logs/application-icon-validation-check.json.
Transport, latency, admission, signing and platform acceptance gates remain open.
