# Measuring native semantic construction

Run from the repository root after installing the pinned dependencies:

```sh
node test/benchmark/profiles/profile-semantic-native-construction.mjs
node test/benchmark/profiles/profile-semantic-native-construction.mjs --case nested-containers
node test/benchmark/profiles/profile-semantic-native-construction.mjs --sample-allocations
```

Each invocation prints its unique `test/artifacts/logs/semantic-native-construction-*` directory.
It contains the diagnostic Vite build, complete report, emitted bundle hashes,
original/injected source snapshots and executed driver/observer snapshots. Temporary
Electron profile data is removed on exit. No installed application files, source files
or dependency files are rewritten. Run this separately from performance benchmarks.

`--sample-allocations` additionally saves nine cumulative V8 sampling profiles per case,
from immediately before native parsing through completed packed encoding. Sampling uses
a 32,768-byte interval and includes sampled allocations subsequently collected by minor
or major GC. It stops at the final boundary. The ordinary mode leaves heap profiling
disabled. Both modes retain the same corpus, complete oracle checks, numeric hooks,
debugger boundaries, five-second watchdog and final ownership assertions.

The probe mounts the actual editor fixture, SemanticService, packed transport and
persistent semantic Worker. Each corpus case gets an initial document and one heading
edit. Both complete native results must match the separate parser/renderer oracle,
including the document root, descriptors, counts, outline, projection and layout. The
transport must produce one full message followed by one delta, use one Worker and report
no Worker failures. The existing fixture also checks zero receiver ownership on disposal.

Only the first construction is instrumented. A CDP session attaches before the Worker
starts and resumes it after each debugger boundary. Samples come from the actual Worker
isolate, followed by the renderer isolate and Electron process metrics. The probe does
not request garbage collection or change the existing five-second Service watchdog.

## Current application compiler — 2026-10-30

Ordinary synchronous parsing now drains the shared pinned compiler described in
docs/patches/parser-lifetimes.md. It keeps the complete native root and publishes only at
completion. Experimental block consumption uses the same configuration. Native API
profilers select parseMarkdownNative explicitly so their historical whole-event/span
measurements keep the same scope.

Source-bound inspector profiles of the unchanged emphasis-exhaustion fixture observed
root construction at 17,069 ms before and 849 ms after; sampled chunked-splice self time
fell from 16,283 ms to zero. The nested fixture observed 803/758 ms before and 952/912 ms
after, so this is no general parse-speed claim. Those sequential host observations do
not prove p95 freshness or physical admission. The full original unit suite now passes
19,058 tests with one existing Windows POSIX-permissions skip. Its original 30 s encoder
and 20 s nested-translation deadlines remain unchanged. Details and actual profiles are
in test/artifacts/logs/whole-root-parser-cpu-summary.json and test/artifacts/logs/whole-root-parser-unit-verification.json.

## Boundaries and counters

Ten samples cover Worker idle, immediately before parsing, completed block tokenization,
the first resolved compilation span, completed MDAST compilation, before joining prose,
completed semantic document, the first non-heading body HAST at shared policy entry,
completed projection/layout and completed packed encoding. `first-body-hast` observes one
block, not a complete document HAST. These leave gaps inside synchronous operations.

Numeric hooks count tokenizer creations, tokenizer point copies, calls entering tokens,
appended enter/exit events, MDAST handler entries and MDAST point copies. They also record
maximum resolved span size and MDAST handler stack depth. HAST counters record every body
and footer policy graph, cumulative node visits and the largest graph. The first body
sample includes its numeric source offsets and graph size, checked against the independent
native parse. The final document visitor provides its separate complete node count.
Debugger expressions read numeric phase metadata, not source values or parser graphs.
The diagnostic HAST traversal allocates scratch and changes allocation and collection.

These counters describe operations, not all allocations or live objects. Parser attempts
can be rolled back, tokens can reuse fields, transforms can synthesize nodes outside the
instrumented handler, and point copies can become garbage. Enter and exit event counts
need not balance. An MDAST handler receives an already-created node, so a check at that
hook alone would be too late to admit its allocation.

The diagnostic bundle explicitly selects production dependency exports. The separate
Vite SSR oracle initializes development mode; inheriting its environment would otherwise
select different parser files. The build checks actual transform input hashes, all eight
source markers in the emitted packed Worker, expected renderer markers and debugger
placement. A changed pinned parser signature fails the probe instead of silently omitting
its instrumentation.

## Windows observation — 2026-10-28

The earlier full-HAST run is in `test/artifacts/logs/semantic-native-construction-igEifv/`. All six cases,
12 complete native revisions and 60 boundary samples pass. The Worker counters match
the earlier complete diagnostic runs; no captured Worker or debugger failure occurs.

| Case | Block tokenization, Worker used heap MiB | MDAST compiled, MiB | Projection complete, MiB | Packed payload bytes |
| --- | ---: | ---: | ---: | ---: |
| prose | 7.83 | 9.88 | 19.40 | 1,191,775 |
| single-paragraph | 4.67 | 5.37 | 6.28 | 2,098,094 |
| mixed-rtl | 7.78 | 12.64 | 12.88 | 1,149,339 |
| repeated-paragraphs | 56.98 | 78.36 | 103.52 | 2,222,772 |
| many-small-blocks | 55.92 | 94.57 | 104.19 | 2,448,976 |
| nested-containers | 57.23 | 113.89 | 170.05 | 5,886,179 |

The nested document has 113,368 final MDAST nodes. Its cumulative hooks record 25,198
tokenizers, 393,658 token entries, 992,025 tokenizer point copies, 270,827 MDAST point
copies and 59,833 MDAST handler entries. Maximum resolved compilation span size is only
254 events, while the earlier full block event array contains 226,736 events. Small
compilation spans alone therefore do not bound the earlier tokenizer or later complete
document construction.

These are instrumented, unminified boundary observations. Hooks, debugger pauses, debugger
roots and the added local event-array reference can affect allocation and collection.
Used heap includes garbage not yet collected; it is neither retained graph size nor a
proven peak. Heap capacity, backing storage, renderer heap and process metrics are
distinct quantities. Process queries follow the heap queries and are not simultaneous.
Process working sets may count shared pages, and Windows private commit is not physical
RAM. Successive cases share the Electron renderer process, so process growth across the
table cannot establish a leak or the cost of one case. Packed payload lengths can also
vary slightly because the encoded document includes timing values.

## Implication for admission

The producer constructs the native document and full projection before bounded packed
encoding. Packed output size and its logical encoder/session ledgers cannot establish
admission for those earlier objects. The observations identify substantial construction
before encoding; they do not calibrate a portable byte charge or justify changing limits.

Native admission still needs checks before tokenizer, resolver, compiler/transform and
renderer allocations, including transient arrays, positions, strings and full output
construction. It must account for simultaneous old/new revisions and other consumers.
Coverage, conservative weights, failure cleanup and aggregate ownership must be verified
before activating the packed transport. This tool supplies evidence for that work; it
does not implement admission or satisfy the packed cold-receipt latency gate.

## Allocation sampling — 2026-10-28

The sampling run `test/artifacts/logs/semantic-native-construction-XhBvxS/` passes all six cases,
12 native revisions and 60 boundaries, producing 54 raw `.heapprofile` files.
The separate ordinary-mode run `test/artifacts/logs/semantic-native-construction-oc0EbM/` also passes
all six cases, 12 revisions and 60 boundaries. Corresponding native hashes, structural
counters and emitted main/Worker bundle hashes match between modes. Neither run has
a captured Worker or debugger failure. The preliminary nested-only sampling run is
retained separately in `test/artifacts/logs/semantic-native-construction-o4YjHt/`.

The report links each raw profile by path and SHA-256. `sampledBytes` sums the profile
tree's estimated `selfSize`; `samples` counts statistical samples and `nodes` counts
allocation-stack nodes. Neither count is an object census. The profile retains stack
names, URLs, source locations, estimated sizes and sample ordinals, without saving heap
object contents or document values. Allocation estimates include sampled objects that
have already died; they cannot be used as a simultaneous retained-memory reservation.
Typed-array backing storage and other external/native memory need separate accounting.
Profiling and debugger hooks can affect allocation and GC. In particular, sampled-mode
used-heap readings differ substantially from ordinary-mode readings; that difference is
not an application memory improvement. No explicit GC command is issued.

| Case | Cumulative allocation estimate at block tokenization, MiB | At MDAST completion, MiB | At packed completion, MiB |
| --- | ---: | ---: | ---: |
| prose | 16.30 | 29.76 | 91.49 |
| single-paragraph | 0.58 | 1.19 | 41.78 |
| mixed-rtl | 13.01 | 22.84 | 69.56 |
| repeated-paragraphs | 129.98 | 220.25 | 430.42 |
| many-small-blocks | 150.41 | 258.76 | 507.08 |
| nested-containers | 147.50 | 551.96 | 1177.72 |

These estimates show why final packed bytes and the largest resolved span cannot stand
in for native construction admission. The nested estimate already reaches about 552 MiB
by MDAST completion, before semantic descriptions, projection and packing. Later packed
encoding adds further temporary allocation. The raw stacks separate tokenizer/event,
subtokenization/compiler, rendering and encoder work. Admission still needs bounds on
the live objects and scratch at each allocation site, with release rules across phases
and simultaneous consumers. These profiles help locate those sites; they do not supply
portable weights or establish a peak. The application transport remains unchanged.

## Rejected position-probe shortcut — 2026-10-28

A source-bound experiment checked for an own `start` field before enumerating an
object's position keys. It preserved exact wire bytes and complete native decoding
for all six document/projection corpora, including unchanged compact-position point
enumerations. Numeric instrumentation counted 201,558 avoided key lists and 695,996
avoided key entries for the nested input. A separate Node sampling pair estimated
cumulative encoder allocation at 801,014,520 bytes before and 785,176,296 bytes with
the shortcut. These are allocation estimates, not simultaneous live memory or a
portable admission bound. Five isolated encoder pairs reduced the nested median
from 333.3 to 317.0 ms, with four pairs lower.

The full application result did not support retaining it. Five fresh alternating
minified Service/Worker pairs, each with an initial full response and two real edits,
checked 30 complete native revisions against the independent oracle. Every run kept
one Worker, accepted full then delta/delta, maintained all three caches and closed
receiver ownership. Cold readiness was slower with the shortcut in all five pairs;
medians moved from 2,540.1 to 2,559.7 ms. Cold receipt medians moved from 1,290.4 to
1,328.3 ms and edit readiness from 509.4 to 513.0 ms. Causes of the timing difference
are unproven. Corresponding main and Worker bundles were stable within each variant;
the Worker bytes differ because the candidate changes the producer. Application
wire lengths can also differ because they include measured timings; exact wire-byte
equality was checked with identical controlled inputs in the separate encoder probe.

The candidate and its changed budget test are archived under `test/artifacts/logs/` and both source
files were restored byte for byte. The restored focused suite passes 711 tests. Do
not reintroduce this shortcut based solely on fewer allocations or isolated encoder
timing. Reports: `test/artifacts/logs/position-probe-encoder-comparison.json`,
`test/artifacts/logs/position-probe-key-counts.json` and
`test/artifacts/logs/position-probe-service-comparison.json`. Historical report labels `current`
refer to the candidate at measurement time, not to the restored worktree.

## Rejected indexed record-writing loop — 2026-10-28

A second source-bound experiment replaced `frame.refs.entries()` destructuring with
indexed access when writing references. It preserved the existing yield after every
256 references, caps, interning and complete validation. Six complete native
corpora retained identical wire bytes and decoded data. Five isolated ordered pairs
reduced the nested encoder median from 340.6 to 325.8 ms, with four pairs lower.
A separate Node sampling pair estimated cumulative allocation at 802,451,456 bytes
before and 648,924,928 bytes with indexing, approximately 146.4 MiB less. As above,
this is a cumulative estimate including collected allocations, not a live-memory
bound. The candidate's focused suite passes 712 tests, including an archived test
that cancels at the first 256-reference writing yield without publishing output.

The full application again did not improve. Five fresh alternating minified pairs
checked 30 complete native revisions, one Worker per run, full then delta/delta,
all three caches and closed receiver ownership. Cold serialization medians decreased
from 344.4 to 336.3 ms, but cold receipt was slower in every pair, with medians moving
from 1,285.7 to 1,346.9 ms. Cold readiness medians increased from 2,527.4 to 2,566.4 ms;
three pairs were slower. Edit readiness medians increased from 505.5 to 530.3 ms.
The cause of the broader timing difference is unproven; this evidence does not justify
keeping the candidate. Both the encoder and candidate test are archived, and their
original files are restored byte for byte. The restored focused suite passes 711 tests.

Reports: `test/artifacts/logs/record-loop-encoder-comparison.json` and
`test/artifacts/logs/record-loop-service-comparison.json`. The two rejected experiments together
check 60 application revisions in 20 fresh application runs, plus identical-input
encoder comparisons across all six native corpora. Neither closes the cold receipt
or native/aggregate admission gate. Further work should target renderer receipt and
complete certification rather than infer application improvement from producer
allocation savings. Verification and source/package restoration are bound by
`test/artifacts/logs/encoder-allocation-validation.json` and `test/artifacts/logs/verify-encoder-allocation.mjs`.


## Initial block renderer — 2026-10-28

The experimental producer now renders the initial native Markdown document using the
existing global-state ProjectionSequence, keeping one body HAST block at a time. It preserves
complete HTML/widgets/layout, definition order and footnote counters. Custom root-wide data
overrides keep the full-render policy. The earlier construction boundary/allocation tables
above measured the preceding complete-HAST renderer; they are historical observations and
must not be presented as measurements of this new initial path.

The source-bound retained-implementation probe in
`test/artifacts/logs/sequenced-layout-current-construction.json` observes a largest nested HAST policy
graph of 54 nodes, compared with 179,496 for the unchanged full renderer. Total HAST node
visits are almost equal. All 39,252 observed policy-root WeakRefs collect while full native
input and final outputs remain available. This is a structural/lifetime result: earlier
block garbage may remain pending, WeakRefs alter GC, and one large container/footer remains
atomic. It neither measures nor calibrates physical peak admission.

Native parse, definitions/state, accumulated HTML/widgets and final joining still require
pre-allocation admission together with old/new revisions and other consumers. The final
complete Worker audit preserves 126 native revisions / 120 deltas. Five separate alternating
application pairs show a 106.7 ms median paired nested initial-readiness reduction, with no
established edit gain. Ordinary transport and all existing limits remain unchanged. Current
source/build provenance, raw comparisons and remaining release gates are in VALIDATION.md:15241.


## Probe repair for the initial block renderer — 2026-10-28

The preceding driver still expected the complete-HAST checkpoint bypassed by initial
block rendering. Its nested run at `test/artifacts/logs/semantic-native-construction-9RhOTj/` fails with nine
boundaries while preserving complete full/delta semantic results. The repaired driver
observes `first-body-hast` at actual shared policy entry and checks its source offsets.
It counts all body/footer graph visits and explicitly binds the initial renderer and
ProjectionSequence. All eight sources must appear in the packed Worker.

Full ordinary run: `test/artifacts/logs/semantic-native-construction-3WcBrJ/`. Full allocation-sampling run:
`test/artifacts/logs/semantic-native-construction-syGjmB/`. They pass all six cases, 24 combined native revisions,
12 deltas and 120 boundaries, with 54 hash-verified raw allocation profiles in sampled mode.
Native hashes, structural counters and emitted bundles agree. Current ordinary values are:

| Corpus | MDAST boundary used heap, MiB | First body HAST boundary, MiB | Projection boundary, MiB | Body/footer graphs | Largest HAST graph nodes |
| --- | ---: | ---: | ---: | ---: | ---: |
| prose | 9.79 | 10.96 | 17.81 | 1,616 | 3 |
| single-paragraph | 5.34 | 5.51 | 6.36 | 3 | 3 |
| mixed-rtl | 12.72 | 12.89 | 11.79 | 1,140 | 3 |
| repeated-paragraphs | 78.43 | 81.19 | 92.49 | 13,800 | 3 |
| many-small-blocks | 99.39 | 80.09 | 93.94 | 16,386 | 3 |
| nested-containers | 115.20 | 120.34 | 137.79 | 6,301 | 54 |

The graph walk adds scratch, pauses affect GC, and heap includes pending garbage. The new
first-body boundary and earlier complete-HAST boundary measure different scopes. These
values cannot establish a physical peak or portable allocation charge. Native admission
and other full-delivery gates remain open; current provenance and validation are recorded
in VALIDATION.md:15383 and `test/artifacts/logs/native-block-analysis.json`.

## Native block handoff — 2026-10-28

The internal `markdownBlockSteps` API can hand off completed native children while
compilation continues, then return complete semantic/root metadata. Its pinned private
compiler retains shared parser/compiler state and future block tokens, but detaches
completed root children and clears their slots. Only the explicitly audited block-local
GFM transform is supported. The ordinary semantic producer still uses the complete
native tree; the ten-boundary Worker diagnostic above measures that existing producer.

Run these separately from application timing measurements:

```sh
node test/benchmark/profiles/profile-markdown-block-stream.mjs
node test/benchmark/profiles/profile-markdown-block-stream.mjs --lifetime
```

The first command compares complete native roots and semantic metadata, then complete
projection/layout output in both grammars and HTML policies, under both parser export
modes. Its corpus contains every pinned CommonMark example, all six full diagnostic
documents, extension/BOM/CRLF/Unicode cases and 1,024 seeded combinations. Actual evaluated
application sources, dependency hashes, driver snapshots and raw reports are retained in
a unique ignored `test/artifacts/logs/markdown-block-stream-*` directory. Export conditions are pinned
explicitly for Vite SSR as well as Node, so the application and oracle use the intended
production or development dependency files.

The lifetime command uses separate `--expose-gc` processes. It witnesses nodes in the
first up to 32 blocks, advances beyond them, and holds the stream active while checking
collection. It also holds completed and cancelled handles, including cancellation after
both the heading and first body have been yielded. Ordered child and complete semantic
metadata hashes must still match the independent whole parser. Weak references and
requested collections alter runtime behavior; these observations establish reachability
only. No allocation sampling or throughput acceptance result is inferred from them.

The handoff API does not admit tokenizer/resolver/compiler allocations. A balanced linked
span can contain the whole input, and accumulated descriptions/prose plus whole-document
segmentation remain outside a native byte ledger. Connecting the stream to one packed
root and its renderer, then verifying admission and complete application latency, remains
necessary. Current evidence and distributable checks are recorded in `VALIDATION.md`.

## Direct block-to-packet encoding — 2026-10-28

The internal `packMarkdownDocumentSteps` now consumes the native block handoff into one
complete SemanticDocument encoding. It preserves document-wide record sharing and all
semantic fields, including final root metadata and whole-document word counts. Native
children pass directly through the encoder; the composition does not rebuild a complete
native root. This helper is not yet used by the application producer, so the earlier
application construction tables still describe its full-tree parser.

```sh
node test/benchmark/profiles/profile-packed-markdown.mjs
node test/benchmark/profiles/profile-packed-markdown.mjs --lifetime
```

The fidelity command compares complete documents and exact timing-matched packet bytes
with the independent ordinary parser/encoder, then compares full HTML/widgets/layout under
both grammars and HTML policies. Both production and development parser exports run in
fresh processes against the complete corpus used by the native-block diagnostic. Timing
values are measured by the actual APIs; they are matched only for byte comparison because
the two parsers measure different executions. Unit comparisons also freeze the clock to
verify the entire packet byte for byte.

The lifetime command separately freezes its diagnostic clock and requests GC. It observes
actual native values at the owned array handoff, including child arrays, positions and
points, while holding active and closed encoder/input handles. Complete packet hashes must
match ordinary encoding; this mode never decodes a full native root. The retained run
records 7,442 active witness observations and 8,666 closed witness observations across
the two parser exports, with zero survivors and 240 held handles. These observations can
overlap and are not counts of distinct allocations or measurements of physical peak memory.

The array registry and current handoff scratch join the existing logical encoder budget.
Parser callbacks and their native allocation remain outside that ledger. Rendering from
the owned packet, composing the final application result under the same owner, native
pre-allocation admission and aggregate physical calibration remain required. The new
reachability evidence does not close the application memory or latency acceptance gates.

## Complete packed producer integration — 2026-10-28

The experimental full producer now calls the direct block encoder, stages its complete
document, validates it, renders an internal chunk spool and canonically assembles the public
document/projection/layout result. Intermediate packets, captures, reader workspaces and
output reservations use the same existing 16 MiB owner. An independently retained old
capture remains charged. The coordinator does not assemble a full native MDAST root or join
complete HTML/widget strings. Ordinary production transport remains disabled for this path.

```sh
node test/benchmark/profiles/profile-packed-producer-full.mjs
node test/benchmark/profiles/profile-packed-producer-full.mjs --lifetime
node test/benchmark/profiles/profile-semantic-native-construction.mjs
node test/benchmark/profiles/profile-semantic-native-construction.mjs --sample-allocations
```

The full-producer fidelity command exercises the actual application producer under the
unchanged 16 MiB owner, 8 MiB wire/staging and 32 MiB encoder working limits. Independent
whole-tree APIs verify every document field, full HTML/widgets/layout and exact canonical
packets using the producer's actual timings. Both HTML policies and production/development
parser exports cover all CommonMark examples, six complete large corpora, extensions,
1,024 seeded combinations, 20,000 widgets and a large escaped-code widget. The application
uses its Manuslip grammar; the separate helper diagnostics also cover CommonMark grammar.

Lifetime runs separately request GC with a frozen diagnostic clock. They hold native
array/capture inputs and completed/cancelled handles while witnessing native nodes, child
arrays, positions and points during active parsing and packed assembly, then after closure.
Complete packet hashes still match the independent native oracle without decoding an
actual complete root in this mode. The additional retained arena probe holds escaped opaque
reader adapters and witnesses actual packed arenas at array traversal. These observations
establish reachability only; overlapping witnesses are not distinct allocation counts.

The construction driver now binds ten actual source modules and observes the actual block
compiler, owned renderer policy, chunk spool and final assembler. Its ten boundaries are:
Worker idle, before native parse, block tokenization, first resolved span, first detached
block handoff, before prose join, complete staged document, first body HAST, completed spool
and completed full packet. A staged document is not a complete native tree, and the spool
boundary is not a joined HTML value. The first handoff checks that the compiler's root child
list has already detached; cumulative counters also record the maximum span child count.
Debugger traversal, heap queries and optional statistical allocation sampling change timing
and allocation. Their results remain separate from application performance acceptance.

The first integration failed the real nested-corpus watchdog because final assembly repeated
immutable-record decoding. An admitted paged cache now reuses completed canonical output IDs
without retaining an arena backlink; lazy transforms and separate arenas retain distinct
namespaces. The complete untraced nested Worker probe subsequently accepted its full result
and next delta with one Worker and unchanged watchdog. Current complete runs, artifacts and
remaining acceptance failures are recorded in `VALIDATION.md`.

The actual Worker also exposed scratch reservations consuming one reader slot per 64 KiB.
Rendering scratch now grows and shrinks within one resizable capture-owned slot. The byte
reservation and both aggregate byte caps remain enforced before growth. Full-producer
diagnostics now use the actual 64 reader slots and both host/endpoint holds; earlier
160-slot runs did not cover that limit. The one-MiB paragraph and reservation rollback tests
exercise this correction without raising the Worker's configured limits.

Full-source tokenization, potentially whole-source balanced spans, compiler/transform
construction, accumulated metadata/prose and segmentation remain partly atomic or
unadmitted. Logical construction weights do not establish calibrated physical admission or
a portable process-memory bound. This integration therefore does not close the remaining
native admission, latency, transport activation or full application delivery gates.


## Per-block native handoff inside prepared spans — 2026-10-28

The private experimental block compiler now clears each consumed event slot and hands off
completed native children as soon as the current handler/listeners leave a closed root stack.
It constructs later sibling nodes only when resumed. Source tokenization, span resolution and
whole span list preparation remain before these handoffs; complete containers still construct
atomically. All ordinary/whole-tree compiler paths and parser, owner, transport and watchdog
limits are unchanged.

| Full corpus | Previous maximum root children | Current maximum root children | Native nodes at first handoff | Final native nodes entered | Complete top-level handoffs | Maximum prepared span events |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| prose | 1,615 | 1 | 1 | 1,615 | 1,615 | 19,382 |
| single-paragraph | 2 | 1 | 1 | 2 | 2 | 22 |
| mixed-rtl | 1,139 | 1 | 1 | 1,139 | 1,139 | 13,670 |
| repeated-paragraphs | 13,799 | 1 | 1 | 13,799 | 13,799 | 137,994 |
| many-small-blocks | 16,385 | 1 | 1 | 16,385 | 16,385 | 163,854 |
| nested-containers | 3 | 1 | 1 | 59,833 | 6,300 | 254 |

These are actual mounted experimental Worker constructor counters. Final node/position/event
totals equal the preceding complete producer; both full semantic revisions still match the
independent oracle. Each case uses one Worker with no failures. The current default probe is
`D:\Project\user\Nazumeki\manuslip\test/artifacts/logs\semantic-native-construction-KZ78dK`; the separate sampling probe has identical structural counters and
semantic hashes and retains all 54 raw allocation profiles. Its boundaries and samples are
diagnostic, not acceptance latency, exact allocation coverage or a physical bound.

The new handler-entry tests fail on the span-accumulating predecessor and pass with early
handoff, including a complete first container and cancellation before 2,000 future paragraphs.
Both patched parser exports upgrade from exactly reconstructed predecessors. Current complete
helper/producer oracle checks, active/closed native GC, complete-closure arena GC, persistent
service revisions and packaged results are bound by `test/artifacts/logs/verify-early-block-yield.mjs`.
Full source/native tokenization, maximum prepared spans, a large individual block and whole
prose segmentation remain unadmitted. Ordinary packed activation and nested acceptance
performance remain unresolved; see the matching validation/ADR entries for current evidence.


## Private document tokenizer checkpoints — 2026-10-29

The current actual Worker probe has eleven boundaries per corpus (66 for the full six cases).
`first-token-feed` observes suspension after the first private root state-loop step. The
original preprocessed chunks and token buffer indexes are preserved; each step dispatches
at most 4,096 root codes before yielding. Child flow work or EOF resolution within a dispatch
can still be atomic, so this is not a duration bound or allocation admission.

| Full corpus | Source UTF-16 units consumed at first pause | MDAST handler entries at first pause | Maximum root dispatches per step | Tokenizer steps | Tokenizer pauses | Complete native block handoffs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| prose | 4081 | 0 | 4096 | 257 | 256 | 1,615 |
| single-paragraph | 4093 | 0 | 4096 | 257 | 256 | 2 |
| mixed-rtl | 4079 | 0 | 4096 | 144 | 143 | 1,139 |
| repeated-paragraphs | 3989 | 0 | 4096 | 263 | 262 | 13,799 |
| many-small-blocks | 3971 | 0 | 4096 | 265 | 264 | 16,385 |
| nested-containers | 3787 | 0 | 4096 | 277 | 276 | 6,300 |

The default run is `D:\Project\user\Nazumeki\manuslip\test/artifacts/logs\semantic-native-construction-Qz83lU`; all six corpora complete two full native revisions
with one Worker each and no failures. The separate allocation-sampling run at
`D:\Project\user\Nazumeki\manuslip\test/artifacts/logs\semantic-native-construction-l62PxC` completes five corpora (ten revisions), but all four nested attempts
hit the unchanged five-second watchdog. Its 86 distinct profiles across
95 observed boundary rows include these failed attempts.
All observed counters and all completed semantic hashes match the corresponding normal run.
Four sampling-stop cleanup failures follow termination of the timed-out targets. The first pause
has zero MDAST handler entries, and final constructor totals equal the preceding complete
producer in the normal run. The full sampling gate remains open.
Both modes bind actual parser/tokenizer sources, injected snapshots and emitted bundles.
Raw profiles are serialized/written after the service probe finishes; sample collection and all heap
queries remain at the paused boundary. Pending observations drain before validation and final
reporting. The initial nested sampling watchdog failure and its explicit failure-metric capture
remain archived; the corresponding validation entry explains the observer overhead correction.

The complete producer's separate lifetime probe now additionally holds cancelled work/input
handles after reaching the real tokenizer progress symbol: 344 actual tokenizer
contexts collect with zero survivors before any MDAST node construction. Both parser and
tokenizer exports plus injected tokenizer snapshots are checked. Earlier active/complete/
abrupt native-node observations and complete-closure arena observations remain in scope.
These are reachability observations, not physical peak or acceptance timing measurements.
The discarded literal-chunk-splitting prototype and its reference/footnote failures remain
archived. Current fidelity, packaging and unresolved ordinary performance/native admission
gates are recorded in the corresponding validation/ADR entries and
`test/artifacts/logs/token-feed-validation.json`.


## Descriptor hashing allocation reduction — 2026-10-29

The current normal actual-Worker diagnostic binds twelve original/injected sources and their
emitted bundles, adding complete descriptor validation and the shared value encoder. All six
corpora complete both native-oracle revisions and all 66 boundaries with unchanged constructor
totals. Hash arithmetic is bounded to 4,096-unit ordinary calls, with the same generator
checkpoints and exact sourceHash result; primitive scalar checks avoid a temporary array.

| Complete corpus | Hash before (MiB) | Hash after (MiB) | Encoder before (MiB) | Encoder after (MiB) |
| --- | ---: | ---: | ---: | ---: |
| prose | 11.60 | 0.66 | 11.13 | 8.66 |
| single-paragraph | 11.81 | 0.03 | 0.25 | 0.28 |
| mixed-rtl | 6.34 | 0.38 | 7.32 | 5.25 |
| repeated-paragraphs | 14.22 | 3.10 | 83.29 | 76.67 |
| many-small-blocks | 12.32 | 3.53 | 101.55 | 93.27 |
| nested-containers | 102.96 | 6.22 | 237.41 | 216.56 |

These cumulative V8 allocation estimates include collected objects at 32 KiB sampling. The
comparison binds actual emitted function/predicate ASTs to archived/current sources and checks
equal numeric counters, HTML units and layout spans. Raw evidence/method is retained in
`test/artifacts/logs/range-hash-allocation-comparison.json`. It does not calibrate a physical peak,
portable admission weight, retained size or acceptance timing. The final full sampling run
still records four nested watchdog failures and subsequent target-stop cleanup errors, with
95 boundary rows/86 distinct profiles; five other corpora finish. The normal run and complete
126-revision untraced service pass, but full sampled completion and native/aggregate admission
remain open. Packaging and ordinary performance evidence is in the matching validation entry.

## Complete sampled construction after indexed path traversal — 2026-10-29

The current driver explicitly binds thirteen application/parser sources, now including
`packages/core/src/packing-view.ts`. Its indexed complete-arena paths preserve all
field/bounds checks and avoid short-lived traversal iterators. Current full sampled output
is `D:\Project\user\Nazumeki\manuslip\test/artifacts/logs\semantic-native-construction-qJffZi`: all six corpora and twelve native/cached revisions complete,
with 66 boundaries, 60 distinct profiles, one Worker per case and no Worker/watchdog or
diagnostic cleanup failures. The normal run at `D:\Project\user\Nazumeki\manuslip\test/artifacts/logs\semantic-native-construction-SZXLm8` also completes.

The first projection-spooled observation is compared with the preceding complete sampled
attempt in `test/artifacts/logs/semantic-native-construction-6ixjPg`. Numeric constructor counters, HTML units/layout spans
and twelve complete native-oracle hashes match. Normalized AST equality binds the old and
current emitted arenaPath helpers to archived/current TypeScript. It removes TypeScript/
location metadata, canonicalizes unshadowed undefined/void 0 and the loop's single-if brace
block; all executable path checks must otherwise match their respective source. This closes
the old helper's missing explicit module binding for this comparison.

All raw profiles, source snapshots and bundle hashes remain in
`test/artifacts/logs/path-iteration-allocation-comparison.json`. The unchanged sampling method
includes collected objects at 32 KiB. The current completed run and lower sampled allocation
do not prove physical admission, portable calibration, exact live memory, an isolated causal
speedup, or reliability across arbitrary schedules/platforms. Native/aggregate admission,
atomic work and ordinary packaged nested performance remain open.

## Source-scan checkpoints before tokenizer input — 2026-10-29

The current private block API scans complete source in groups of at most 4,096 UTF-16 units
while retaining the original preprocessed chunk boundaries. It yields within a long literal
without splitting it. Only after preprocessing completes does the document tokenizer receive
those chunks. Cancellation clears unfinished chunks and the outer source reference.
Both public preprocessors remain byte-identical and are explicitly pinned. The two current
compiler hashes are `0edc03eb2f77a2623dd0487b8d45fc918b84d6ece43aacb1ffbe5cc16270e98e` and `ae5ad144493a8cd7fc7aa3bfe923de294a007b2bddf0599f6b392d3be508e15c`; fixtures reconstruct
the exact preceding compilers and then their published originals.

The fourteen-source actual Worker probe observes twelve boundaries per corpus (72 overall),
adding `first-preprocess` before `first-token-feed`. The first new pause has exactly
4,096 scanned units and zero tokenizer dispatches, token entries or MDAST handler entries.
All six corpora and twelve native/cached revisions pass in `D:\Project\user\Nazumeki\manuslip\test/artifacts/logs\semantic-native-construction-aTzMZ7`; the first
full sampled run at `D:\Project\user\Nazumeki\manuslip\test/artifacts/logs\semantic-native-construction-qv5TWS` also passes, with 66 distinct profiles and no
Worker/watchdog or diagnostic cleanup failures. Complete hashes and all preceding numeric
constructor totals match. Sampling remains statistical at 32 KiB, including collected objects;
it does not measure an exact allocation census, retained size or a portable physical peak.

Separate GC observations distinguish actual preprocessing and tokenizer pauses, witness 24
real chunk arrays and 356 tokenizer contexts, and hold 360 work/input handles. All collect
with zero survivors after closure. Reachability results do not prove peak memory admission.
Whole-value decoding/slicing, chunk-array storage, flow/EOF resolution, span preparation,
native blocks/HAST and whole-prose segmentation remain atomic or unadmitted. Ordinary packed
activation, nested performance, native/aggregate admission and full platform/release acceptance
remain open. Current full verification is `test/artifacts/logs/preprocess-steps-validation.json`.

## Counting checkpoints with native iterator lifetime — 2026-10-29

The complete experimental parser now yields before joining prose and after each group of
sixteen native iterator calls. It supplies the same whole prose to one Intl.Segmenter call,
retains one iterator across pauses and preserves exact dictionary/context-sensitive counts.
Private text references are cleared after joining/on closure. Timings count active batches
and exclude time parked at their scheduling checkpoints. Individual joining/Intl calls,
source scans and other native construction still require admission/scheduling work.

The fourteen-source actual Worker probe adds `first-word-count`, for thirteen observed
boundaries per corpus (78 overall). The new boundary follows sixteen complete prose segments
with one counting pause; previous constructor totals and all complete native/cached hashes
are preserved. All six corpora complete in `D:\Project\user\Nazumeki\manuslip\test/artifacts/logs\semantic-native-construction-pb3psj` and in the first full
sampled run at `D:\Project\user\Nazumeki\manuslip\test/artifacts/logs\semantic-native-construction-0ry8KT`. The latter retains 72 distinct profiles with no
Worker/watchdog or cleanup failures, using the unchanged collected-object 32 KiB sampling.
It is not exact allocation, retained-size, causal timing or portable physical-peak evidence.

The independent full-producer lifetime driver observes actual native Segments/iterator
prototypes in separate forced-GC processes. At the first counting checkpoint all blocks
have been handed off and exactly sixteen native next calls have occurred. Each of twelve
native iterators remains owned during suspension; after cancellation all twelve iterators
and twelve Segments objects collect while 408 work/input handles stay held. Existing 24
chunk-array/356 tokenizer-context and native-node/escaped-arena probes also pass. Reachability
does not prove physical admission. Ordinary nested performance, native/aggregate admission,
cold receipt/freshness and full feature/platform/release acceptance remain open; ordinary
packed transport is disabled. See `test/artifacts/logs/word-count-validation.json` for current evidence.

## Final source-metric checkpoint and cancellation — 2026-10-29

The final experimental parser summary now counts characters and computes its unchanged
source hash in one scan with a pre-scan checkpoint and 4,096-unit batches. It reads each
UTF-16 unit once and carries a pending high surrogate across checkpoints. Complete strings,
native grammar, all result fields and identity hashes are preserved. This changes the final
scan only; earlier sizing/hashing/grammar and individual native work still need scheduling
or admission.

The fourteen-source Worker diagnostic adds `first-source-metrics` after whole-prose
word counting, yielding fourteen boundaries per corpus (84 overall). It asserts 4,096 source
reads at the first new boundary, a 4,096 maximum batch and complete totals equal to the source
length. Normal `D:\Project\user\Nazumeki\manuslip\test/artifacts/logs\semantic-native-construction-lqzcV7` and the first full sampled run `D:\Project\user\Nazumeki\manuslip\test/artifacts/logs\semantic-native-construction-1CW3jw`
complete both revisions of all six corpora with one Worker per case and no failures. The
sampled run retains 78 distinct profiles. Complete outputs and previous constructor totals
match their independent oracles. Diagnostic pauses/prototype hooks/sampling are not isolated
causal latency, exact allocations, retained size, portable physical peaks or admission weights.

Separate forced-GC processes monitor actual charCodeAt calls after actual native word
iteration reaches EOF. Twelve cancellation cases stop at exactly 4,096 reads after all blocks
have been handed off, make no later reads and leave zero observed native graph survivors
while 456 work/input handles stay held. Existing actual native iterator, tokenizer/chunk and
escaped arena lifetime probes remain valid. Physical admission, ordinary nested performance,
cold receipt/freshness and full feature/platform/release acceptance remain open. See
`test/artifacts/logs/source-metrics-validation.json` and the corresponding validation entry.

## Bounded grammar slices before tokenizer construction — 2026-10-29

The complete experimental parser selects its exact frozen grammar through owned cooperative
work. Each slice supplies 4,089 new UTF-16 units and at most seven context units, so every
native regex input is at most 4,096 units. Stateless regexes retain exact native ignore-case
semantics; the longest literal prefix is eight units. The parser receives the original
whole source. CommonMark skips classification, full enabled selection can finish early,
and a separate scheduling checkpoint precedes native parsing.

The actual Worker diagnostic explicitly binds parse.ts as its fifteenth source and adds
`first-grammar-chunk` before any tokenizer is constructed. It observes 4,089 units in
the first slice, exact complete classification totals/masks, and a 4,096 maximum regex
input. Normal `D:\Project\user\Nazumeki\manuslip\test/artifacts/logs\semantic-native-construction-jBD1dd` and first full sampled `D:\Project\user\Nazumeki\manuslip\test/artifacts/logs\semantic-native-construction-F0pgTn` complete
all six corpora/twelve revisions with 90 boundaries, one Worker per case and no failures.
The sampled run retains 84 distinct profiles. Constructor totals and complete outputs
match prior/independent oracles. Diagnostic hooks, pauses and sampling are not physical
admission, exact allocation/retention, causal latency or portable peak evidence.

Separate forced-GC processes witness the actual private classifier work and source slices.
Twelve new cases stop after one 4,089-unit slice before any tokenizer, preprocessing chunk
array or MDAST node exists; parent cancellation closes the held classifier handle and makes
no further slices. Core witness injections have archived original/injected hashes and actual
executed binding checks. Existing source-metric/native-word/tokenizer/chunk and escaped-arena
closure checks pass with zero observed survivors while 516 work/input handles stay held.
Classifier scratch and individual native slice/regex calls remain physically unadmitted,
along with the previously recorded native/aggregate, ordinary nested performance, cold
receipt/freshness and full feature/platform/release gates. Evidence:
`test/artifacts/logs/grammar-steps-validation.json`.

## Bounded complete-block metadata and owned child work — 2026-10-29

`markdown-description-steps.ts` is the sixteenth explicitly bound native-probe input.
The new `before-block-description` boundary observes the first non-heading native
block owned by revocable metadata work before its first hash read. The compiler has already
detached that child; this boundary does not imply incremental native block construction.
The helper reads ranges directly from original UTF-16 source and uses cursors for metadata
and heading preorder. Complete range units, descriptor/node totals and cursor advances are
checked against the unchanged ordinary tree; batches never exceed 4,096 hash reads or 256
cursor advances. Each completed block and outline string retains its complete content.

The current normal and sampled diagnostics are `D:\Project\user\Nazumeki\manuslip\test/artifacts/logs\semantic-native-construction-d5B6MW` and
`D:\Project\user\Nazumeki\manuslip\test/artifacts/logs\semantic-native-construction-0oLLUz`. Each accepts six corpora / twelve complete revisions, observes
96 boundaries, uses one persistent Worker per case and reports zero worker/watchdog/cleanup
failures. Sampling writes 90 distinct cumulative V8 profiles at a 32 KiB interval including
sampled collected objects. Native counters and complete semantic hashes conserve earlier
construction. Profiles and debugger observations alter allocation/timing and remain
diagnostic evidence, not all-allocation coverage, calibrated admission, proven physical
peaks or application acceptance timing.

The separate full lifetime probe holds 586 work/input handles. Fourteen actual metadata
child handles close when the parent closes; two of those stop after exactly 4,096 reads.
All 28 observed complete body/metadata owners collect afterward. Existing grammar,
preprocess/tokenizer, native Segments/iterator, source-scan and arena/reader witnesses also
collect after closure. Hash-bound injections and runtime bindings identify the actual work.
The parent yields only fully described blocks and excludes parked time from active timing.
Final heading joins remain atomic. Source preflights/identity hashes, other native
construction and scratch, prose joins/individual segmenter calls and aggregate physical
admission remain open; ordinary packed activation is still disabled. Full release and
UI evidence is indexed by `test/artifacts/logs/description-steps-validation.json`.

## Bound immutable source preparation — 2026-10-29

The native diagnostic now binds packing-source.ts as its seventeenth source in both renderer
and Worker bundles. The actual renderer queues the combined 4,096-unit byte/hash scan; the
complete producer encoder reuses authentic immutable source facts. The existing 96 native
boundaries and all complete output/counter checks are conserved. Initial request JSON sizing
and legacy Worker source construction still run before the native diagnostic boundaries.

Current normal evidence: `D:\Project\user\Nazumeki\manuslip\test/artifacts/logs\semantic-native-construction-M7e8kp`. Current sampled evidence: `D:\Project\user\Nazumeki\manuslip\test/artifacts/logs\semantic-native-construction-CQyN0m`.
Both accept all six complete corpora and both revisions with zero Worker/watchdog/cleanup
failures. Sampling retains 90 profiles at 32 KiB with collected sampled objects included.
Separate actual-port forced-GC evidence at `D:\Project\user\Nazumeki\manuslip\test/artifacts/logs\packed-source-lifetime-JF0fQf` holds 180
scan/parent/scheduler/controller/callback handles and witnesses all 72 request/metadata owners
collect after closure. Hashes bind executed sources, injected bodies and diagnostic drivers.
These measurements establish observed boundaries and reachability, not latency admission,
all allocations, unobserved native peaks or aggregate physical bounds. The remaining gates
and complete source/release manifest are recorded in `test/artifacts/logs/source-preflight-validation.json`
and the matching `docs/validation/implementation-history.md` checkpoint.

## Independent Worker source scheduling — 2026-10-29

The native diagnostic now binds 22 sources, adding the Worker source factory, producer,
host, endpoint and core exchange reader to the preceding seventeen. The actual renderer
and Worker independently schedule the combined source byte/hash scan. The Worker keeps
one latest candidate behind the shared callback and promotes only after full validation
and admission. Initial request JSON sizing still runs synchronously. Legacy synchronous
source APIs remain available; the actual experimental Worker entry uses the queued path.

Current normal evidence: `D:\Project\user\Nazumeki\manuslip\test/artifacts/logs\semantic-native-construction-XXEYSY`. Current sampled evidence: `D:\Project\user\Nazumeki\manuslip\test/artifacts/logs\semantic-native-construction-zrCz0o`.
Both accept all six complete corpora and both revisions with 96 boundaries, unchanged
complete semantic hashes/counters and no Worker/watchdog/cleanup failures. Sampling keeps
90 profiles at 32 KiB with collected sampled objects included. Source preflight precedes
the native observation boundaries, so these profiles do not establish its peak allocation.

The separate actual Worker lifetime run at `D:\Project\user\Nazumeki\manuslip\test/artifacts/logs\packed-worker-source-lifetime-t0EluE`
holds 336 handles across 48 cases. All 144 normalized owners collect after closure;
all 144 original input witnesses detach while queued. Twelve digest failures retain an
ACKable earlier offer. Executed bindings and four injected source bodies are archived
with hashes. The renderer and existing complete-producer lifetime probes also pass.
This is reachability and scheduling evidence, not all-allocation coverage, causal latency,
aggregate physical admission or portable peak proof. Remaining work and full artifact/UI
bindings are in `test/artifacts/logs/worker-source-validation.json` and its validation checkpoint.

## Bound source JSON sizing before native construction — 2026-10-29

The native diagnostic binds 25 sources, adding the shared fixed-shape request capture,
renderer port and service to the preceding 22. The actual packed cold/warm service path
now queues exact source JSON sizing with UTF-8 and digest scanning. Only bounded request
metadata is JSON-sized synchronously. Native/older ports and legacy synchronous APIs keep
their complete request guard. Ordinary whole-root JSON transport remains selected.

Current normal evidence: `D:\Project\user\Nazumeki\manuslip\test/artifacts/logs\semantic-native-construction-dDYlFX`. Current sampled evidence: `D:\Project\user\Nazumeki\manuslip\test/artifacts/logs\semantic-native-construction-Bpoxeb`.
Normal evidence accepts all six corpora and both revisions with 96 boundaries, unchanged
complete semantic hashes/counters and no Worker/watchdog/cleanup failure. Sampled evidence
completes five corpora/ten revisions; all four nested attempts reach projection-spooled,
then the unchanged five-second watchdog terminates the Worker during a subsequent capture.
The interrupted final phase was not retained. Sampling remains an unresolved gate with
140 observations, 131 distinct profiles, four watchdog failures and eight target-loss
cleanup errors. The failure archive is `test/artifacts/logs/request-sizing-sampling-failure.json`.
The 32 KiB collected-object method is unchanged; no second unchanged sampling run was started.
Source preflight precedes these boundaries, so the profiles do not prove its peak allocation.

Separate renderer lifetime evidence at `D:\Project\user\Nazumeki\manuslip\test/artifacts/logs\packed-source-lifetime-YTc5z4` holds 240 handles and
observes all 96 closed owners collect; twelve cap failures collect while the port is alive.
Worker evidence at `D:\Project\user\Nazumeki\manuslip\test/artifacts/logs\packed-worker-source-lifetime-RbXaKt` holds 420 handles: all 180 normalized owners
collect after closure and all 180 original input witnesses detach while queued. Twenty-four
earlier offers remain ACKable after digest/JSON-limit failures. All executed originals,
injected bodies and drivers are hash-bound. These establish observed reachability and
scheduling, not all allocation, causal latency, aggregate physical bounds or acceptance.
The matching validation checkpoint and `test/artifacts/logs/request-sizing-validation.json` retain
the complete artifact, UI, ordinary performance and remaining application/release evidence.

## Preserve final captures and reduce child adapter allocation — 2026-10-29

The native observer records numeric phase/counter markers before profile/heap queries,
and retains individual command timing/status and already captured profiles after a later
query fails. The preserved baseline `D:\Project\user\Nazumeki\manuslip\test/artifacts/logs\semantic-native-construction-AEAxOo` identifies all four
interrupted boundaries as packed-complete. HeapProfiler.stopSampling finishes in about
215–234 ms before the unchanged five-second application watchdog removes the target at
the following Worker heap query. This is diagnostic wall time, not acceptance timing.

The changed encoder descends captured fields lazily and passes guarded readers directly
to private frames. The targeted run `D:\Project\user\Nazumeki\manuslip\test/artifacts/logs\semantic-native-construction-vvKyC8` retains complete hashes
but uses two Workers after a first-round watchdog, so it fails persistence. Because the
fixture clears performance measures per revision, the driver now aggregates completed
round metrics and any unfinished final round. A source-bound check verifies that collector
against the captured earlier-round failure. The statistical final-segment allocation
comparison is 932–954 MiB before versus 883–890 MiB after; it does not prove retained
memory, physical peaks, a portable weight or isolated application latency.

Fresh normal evidence: `D:\Project\user\Nazumeki\manuslip\test/artifacts/logs\semantic-native-construction-v5vl3N`. It binds 27 sources, including the capture adapter and
guarded scope, with twelve complete revisions, 96 boundaries/attempts and no failures.
The fresh phase summary at `test/artifacts/logs/snapshot-assembly-phase-summary.json` derives all
consecutive marker intervals directly from that hashed normal report. The largest broad
nested interval is `first-body-hast` → `projection-spooled`,
1116.6 ms with 3.1 ms recorded for its preceding observer.
It points to full projection encoding/spool construction for further investigation.
Scheduling and diagnostic overhead remain included; these are not isolated function
timings or uninstrumented latency acceptance.
Fresh sampled evidence: `D:\Project\user\Nazumeki\manuslip\test/artifacts/logs\semantic-native-construction-RdU1C2`. Gate passed: false; revisions 12,
complete observations 111, attempts 112, distinct profiles 105,
watchdog metrics 1, cleanup failures 2. Sampling remains at 32 KiB and
includes collected samples. No cap, watchdog, source corpus or complete output was reduced.
The targeted core lifetime probe independently witnesses 90 closed owners collect with
421 work/input/reader/iterator/output handles held. Full semantic, source/Worker lifetime,
package, installer, UI and ordinary performance results remain indexed in
`test/artifacts/logs/snapshot-assembly-validation.json`. Physical admission and the full deliverable
remain unproven until their original requirements are met.

## Native-copy visit and admission allocation — 2026-10-29

The fresh normal interval from first-body-hast to projection-spooled was the largest
broad nested interval. Its retained samples place native copying above the other sampled
allocation paths. The shared native copy now avoids per-value visit objects, container
spreads and nested resize callbacks; decoder headroom and all original checks remain.

Selected pair: `D:\Project\user\Nazumeki\manuslip\test/artifacts/logs\semantic-native-construction-3YXsGr` → `D:\Project\user\Nazumeki\manuslip\test/artifacts/logs\semantic-native-construction-ZxK0IR`.
Both use identical 29-source driver/observer code, complete both revisions with one Worker
and no failures, and match the independent complete semantic hashes. Within-target
collected-object interval estimates are 755.2 → 736.7 MiB; native-copy subtree
estimates are 249.3 → 220.6 MiB. These single-pair instrumented samples retain
raw profiles and source/bundle hashes; they do not isolate function latency or physical peaks.

Fresh normal evidence: `D:\Project\user\Nazumeki\manuslip\test/artifacts/logs\semantic-native-construction-7lyNwq`, with 96 boundaries/attempts and 29 source
bindings, including both changed modules. Fresh sampled evidence: `D:\Project\user\Nazumeki\manuslip\test/artifacts/logs\semantic-native-construction-HQW3xQ`;
gate passed false, 126 observations, 128 attempts, 120 profiles,
2 watchdog metrics and 4 cleanup failures. The cross-revision failure collector is byte-identical
to its previously verified implementation; failed/restarted runs remain explicit.
Current normal phase intervals, complete semantics, lifetimes, service revisions, package,
installation, ordinary performance and nine UI states are indexed by
`test/artifacts/logs/projection-spool-validation.json`. Packed activation and the full deliverable
remain subject to their original physical, performance, feature and distribution gates.

## Reuse projection serializer and planner frames — 2026-10-29

The HTML chunk serializer and serialization planner now reuse traversal-local frames at
each depth. Sibling entry resets node, parent/schema, child cursor/container, shell state
and every planner accumulator. Completed or cancelled traversals clear the frame arrays;
there is no cross-document frame cache. Complete native spelling, raw-text/template/SVG
semantics, all widgets/layout, source positions, conservative admission weights and all
original node/depth/lexical checkpoints remain. A new mixed-sibling regression exercises
both HTML policies through SVG, text, empty tags, template content, raw text and script
contexts. Existing source, producer and capture lifetime checks remain required.

The controlled selected pair binds 31 actual sources with identical driver/observer code.
Both runs complete two revisions with one Worker and no failures, matching both complete
semantic hashes from the independent earlier oracle. Broad first-body-hast → projection-spooled
collected-object estimates are 722.7 → 716.0 MiB. Stacks containing either
projectionHtmlChunks or planProjectionSerialization account for 164.9 → 155.5 MiB.
These single-pair instrumented statistical estimates do not establish isolated latency,
physical peak or aggregate admission. Sources, bundles and raw profiles are preserved in
`test/artifacts/logs/projection-frames-candidate-comparison.json`.

Selected pair: `D:\Project\user\Nazumeki\manuslip\test/artifacts/logs\semantic-native-construction-ZTdFzy` → `D:\Project\user\Nazumeki\manuslip\test/artifacts/logs\semantic-native-construction-7Ge6CA`.
Fresh normal evidence: `D:\Project\user\Nazumeki\manuslip\test/artifacts/logs\semantic-native-construction-Eb6v1E`, with 96 boundaries/attempts and 31 actual
source bindings. Full sampled evidence: `D:\Project\user\Nazumeki\manuslip\test/artifacts/logs\semantic-native-construction-Iy1vpz`; gate passed:
true, with 96 observations, 96 attempts,
90 profiles, 0 watchdog metrics and 0 cleanup failures. All failures and
unfinished captures remain explicit. The cross-revision collector and observer are
unchanged. Current phase intervals, complete semantics, lifetimes, service, package,
installer, performance and nine UI states are indexed in the matching validation file.
These results leave full physical admission and the original application goal open.

## HTML emission iterator allocation — 2026-10-29

The HTML serializer now owns separate reusable input and output piece iterators for each
traversal. Nested escaping can suspend its input while output is emitted, without allocating
a generator for every text/shell value. Both iterators release their strings on completion,
return, throw and traversal cleanup. Ancestor helpers are skipped when only the current text
frame or no frame remains pending. Actual ancestor shells retain every original barrier.
The piece splitter retains the exact 4,096-unit/surrogate boundary behavior. No traversal
limits, conservative weights, parser/renderer fields or complete output were reduced.

The source-bound differential check compares 2608 complete CommonMark yield sequences
with the freshly archived serializer in both syntax/HTML policies. Every chunk and undefined
pause marker agrees, and complete HTML matches the ordinary native renderer. All
178 return/throw checks at fixture suspensions preserve exact return values and exception
identity. Two new unit regressions cancel during large escaping without visiting later
siblings. This complements the existing template, SVG, void-content, hostile-property and
large astral/lone-surrogate coverage.

The selected baseline reuses the earlier clean run after verifying its actual sources,
driver, observer and bundles against all 560 freshly archived inputs. Both selected runs
bind identical 31-source driver/observer code and match both independent complete semantic
hashes. Broad interval collected-object estimates are 716.0 MiB before and
678.1, 682.2 MiB across target attempts. HTML-subtree estimates are
116.1 MiB before and 71.8, 76.7 MiB after. The target gate passed:
false; it used 2 Workers, recorded 1 watchdog failure(s) and
2 cleanup errors, and retained 31 completed observations/32 attempts/30 raw
profiles. The interrupted final snapshot capture remains explicit. These instrumented
statistical allocation estimates do not establish isolated latency, physical peaks or full
acceptance. No unchanged application diagnostic was retried to obtain a passing result.

Baseline: `D:\Project\user\Nazumeki\manuslip\test/artifacts/logs\semantic-native-construction-7Ge6CA`. Target: `D:\Project\user\Nazumeki\manuslip\test/artifacts/logs\semantic-native-construction-HCMFVs`.
Fresh normal evidence: `D:\Project\user\Nazumeki\manuslip\test/artifacts/logs\semantic-native-construction-C596t8`. Fresh full sampled evidence:
`D:\Project\user\Nazumeki\manuslip\test/artifacts/logs\semantic-native-construction-AUEPhk`; gate passed true, with 96 observations,
96 attempts, 90 profiles, 0 watchdog metrics and 0 cleanup failures.
The cross-revision collector and observer are unchanged. Numeric markers and all raw
profiles, including profiles captured before a later query failed, remain retained.
Current normal phase intervals and complete release evidence are bound by the matching
validation checkpoint. The selected failure and ordinary performance failure remain
explicit; these diagnostic results do not complete the original application goal.


## Explicit-GC ownership and private EOF release — 2026-10-29

The complete private block parser releases completed tokenizer closures only after
EOF resolvers finish. It keeps events, the shared parser, detached serialization and
detached stream slicing for subsequent subtokenization. Active tokenizers retain their
full streaming methods; the ordinary public parser keeps its complete contexts. Whole
roots, all positions/extensions, references/footnotes, descriptors, outline/counts and
full HTML/widgets/layout remain unchanged. No cap, watchdog or yield budget changed.

The previous sampled stacks and natural used-heap boundaries mixed live owners and
collectible temporaries. A separate probe exposes GC only in its diagnostic Electron
launch and synchronously invokes it twice before each debugger boundary. The unchanged
observer then queries heap and process metrics. No object contents or heap snapshot
are persisted. Before: `D:\Project\user\Nazumeki\manuslip\test/artifacts/logs\native-ownership-inline-DylCzs`; after:
`D:\Project\user\Nazumeki\manuslip\test/artifacts/logs\native-ownership-inline-5V6dYG`. Both complete revisions match the independent oracle,
and the installed after run covers six cases/twelve revisions/96 boundaries without
Worker or observer failures. All 31 prototype/installed injected sources match.

The selected block-tokenized live used heap is 40.9 →
35.2 MiB; final projection live used heap is
5.5 MiB.
This evidence shifts the next memory work toward native raw events, tokens and points,
while final encoding/scheduling still matters for latency. It does not prove native
physical admission or a natural peak. Full numeric boundaries and separate backing-store
measurements are in `test/artifacts/logs/native-ownership-comparison.json`.

The initial paused-CDP GC attempt stalled before any heap capture, causing four unchanged
watchdog terminations and eight cleanup errors. Its raw reports remain retained. The
repair moves GC into the running hook; it does not relax application limits. Fresh
sampled results remain separate: {"gatePassed":true,"observations":96,"attempts":96,"watchdogs":0,"cleanupFailures":0}. Ordinary performance:
{"passed":5,"failed":1,"skipped":1}, gate false.
Full release/semantic/lifetime/service/installer/UI evidence and every remaining original
gate are indexed by `test/artifacts/logs/native-ownership-validation.json`.


## Rejected compact private event records; accepted parser restored

The compact enter/exit record experiment is rejected. It retained complete token,
point and context identities and passed 17,006 unit cases, 6,748 block comparisons,
6,756 complete producer/packet comparisons, 77 packaged flows and Windows installer
verification. Those results belong to the archived candidate, not the current source.
Its full release had 18 passing stages and two failures: allocation sampling and the
ordinary nested performance gate. The sampling run retained 140 completed diagnostic
attempts and 131 raw profiles, but the nested case exhausted four unchanged 5-second
watchdog attempts and completed no revision. Four stop-sampling cleanup errors report
lost CDP sessions. No unchanged manual retry was used to obtain passing output.

At block-tokenized, the separate controlled-GC probe reduced used heap from
36,941,108 to 33,473,996 bytes (35.230 to 31.923 MiB), with backing storage separate.
That is not natural peak or physical admission. The original candidate's broad
description interval grew from 614.7 to 1,350.5 ms. A refined block-only record variant
cached indexed values and cleared event/token/context locals before handing off a
compiler child. Its matched normal diagnostic interval still took 818 ms versus
612.1 ms for the ordinary array control. Both controls used one Worker, two complete
revisions, the same source, complete semantic hashes and final counters. These broad
intervals include scheduling and observer overhead; they do not establish ordinary
latency acceptance. The memory saving does not justify accepting this measured cost.

The four changed source inputs, six parser files and two artifacts were restored to
the completed-tokenizer cleanup checkpoint. That accepted source has 17,004 passing
unit cases, one existing skip across 186 files, plus its previously verified complete
fidelity/lifetime/service checks, 77 packaged flows and real installer run. A fresh
rebuild matches all 237 accepted ASAR runtime files. All 560 accepted inputs, the six
parser pins, the 579-file before archive and 576-file rejected archive were checked.
The accepted ASAR is e99e028cbffd14cff4ef3a3b705a219985ab15a1239bf6e68e8bb5606aeb2b17;
the accepted installer is 850980c5322910633de1babc247f5c5a54efd343595f535265cb30f569c0599a.

Reproduction/integrity evidence: test/artifacts/logs/verify-native-events-restoration.mjs and
test/artifacts/logs/native-events-validation.json (2,770 evidence files). The first verifier attempt
used slash-separated ASAR paths on Windows and failed before producing a proof; its
log is retained. Normalizing those paths fixed the verifier without rerunning the
application experiment. Candidate code, artifacts, all failed stages, rejected
variants and raw timing/sampling observations remain under test/artifacts/logs/. The prepared
candidate verifier and candidate documentation generators were never used as proof
that the rejected implementation is accepted.

Fresh accepted-binary UI evidence: test/artifacts/logs/native-events-restored-ui-audit.json,
directory test/artifacts/logs/native-events-restored-ui-audit-OS7UVC. Nine states have no detected
axe violations or page overflow; contrast/name checks remain incomplete. Three actual
captures (English light writing, English dark at 360 px and Chinese light at 320 px)
were visually inspected. Dense header bands, narrow file-action scrolling and an
ungrouped reading toolbar remain material refinement work.

The previous goal turn only verified already-completed root-log migration and made
no application progress. This continuation verified restoration and rejects the
experiment using measured evidence. The complete M1–M4 objective remains active.
Ordinary nested performance, aggregate physical admission, complete advanced-feature
and distribution/accessibility gates remain open. Packed semantic transport stays
off. Preserve every original corpus, semantic field, limit and watchdog. Next work
is the audited document/reading control hierarchy; final assembly, cooperative
decode/storage and receipt/freshness also remain material latency work.


## Reuse transient native-copy frames — 2026-10-29

The shared native-copy implementation now reuses traversal-local frames by active
depth, clears every completed frame's graph/reader references immediately and drops
the pool on completion or cancellation. Complete values, property descriptors,
positions, all original allocation arguments and every pause checkpoint remain.
Source-bound differential: 1,311 complete values, 1,191,640 visits and 431,662
checkpoints; frame constructions 346,735 → 9,547 in those standalone comparisons.
Twelve forced-GC cases hold 48 closed handles and leave no witnessed owner/frame
live. This operation count is not a physical-byte or application-wide claim.

Matched normal nested diagnostics retain identical complete semantic hashes and
counters, one Worker/two revisions each and all 16 observations/attempts. The small
1087.9 → 1078.0 ms broad projection-interval difference does not prove a latency
improvement. Complete producer fidelity (6,756 comparisons), full lifetimes
(134 observations), 17,010 unit passes/one skip, 79 packaged flows, Windows
installer and nine fresh UI states pass. Evidence and precise scope are in
VALIDATION.md and test/artifacts/logs/native-copy-frames-validation.json. The ordinary nested
failure remains open and was not rerun unchanged. Packed transport, aggregate
portable physical admission and the full M1–M4 deliverable remain unaccepted.


## Resolve guarded arena paths once — 2026-10-29

Shared guarded readers now retain a source-free numeric record location for
immutable untransformed arena paths. Every query still checks its original
capture/item lifetime. Composite and transformed roots retain copied paths.
Exact canonical packets, all allocation arguments and every suspension checkpoint
match the saved implementation over 1,311 complete values. Own-field resolutions
fall from 3,372,217 to 938,724 in those standalone encodings; this is not a physical
memory or acceptance-latency claim. Full producer, unit, packaged, installer and
fresh UI checks pass; the frozen checkpoint changes three of 562 inputs.
The rejected short-string path and the initial incorrect runtime-identity helper
assertion are preserved. Full details and limits are in docs/validation/implementation-history.md under
this heading and test/artifacts/logs/record-prefix-validation.json. The full application goal,
ordinary nested performance, native physical admission and all original gates
remain open; packed semantic transport stays off.


## Share active offer timing — 2026-10-29

The experimental host supplies active offer time to full/delta/wire serialization,
so queued waits and separate source work are excluded. Hosted full encoding removes
per-advance coordinator clock reads; the standalone fallback, child suspension
points, deadline checks, semantics, logical admission and watchdogs remain.
Source-bound complete host comparisons reduce clock calls 51,577,193 →
32,054,086 over 24 compared offers with identical payloads, other metadata
and profiling step counts. These are operation counts, not latency/memory gates.
17,012 unit passes/one skip, both 6,756-comparison producer branches, both 134-
observation lifetimes and eleven existing plus six held-clock host cases pass.
A matched 33-source Worker pair completes four native revisions with unchanged
semantics/counters. The fresh production runtime, packaged sources and complete
distributable hashes are byte-identical, preserving the preceding release/UI
evidence without a new installer run. Details, evidence links and open gates are
in docs/validation/implementation-history.md and test/artifacts/logs/host-clock-validation.json. Packed transport stays
off; ordinary nested performance, physical admission and full M1–M4 acceptance
remain open. All temporary files/logs stay in test/artifacts/logs/; the root is clear.


## Enter encoder containers once — 2026-10-29

The canonical encoder distinguishes first entry from child resumption using the
already initialized shape. Transient native entry references are explicitly
cleared before later stream work; the initial candidate failed that ownership
gate and is preserved. Exact packets, all 14,511,604 admission calls and 621,873
pause placements agree over 2,624 complete native/captured cases. Entry probes
fall 4,853,786 → 2,383,268 (50.9% fewer), with unchanged field work and limits.
Native/captured active and closed-work lifetime gates pass. All 17,012 unit cases,
both 6,756-comparison producer branches, both 134-observation producer lifetimes,
79 rebuilt packaged flows, actual Windows installation and fresh UI regression
checks pass. Isolated six-pair benchmarks and matched 33-source Worker profiles
describe a measured local improvement; they do not pass the original performance
or physical-admission gates. Full details, rejected candidate and artifact hashes
are in docs/validation/implementation-history.md and test/artifacts/logs/encoder-pass-validation.json. Packed transport
stays off. Full M1–M4, ordinary nested performance, aggregate physical admission and
distribution/physical accessibility acceptance remain open. Logs stay in test/artifacts/logs/.


## Copy bounded codec byte batches — 2026-10-29

The existing canonical writer copies/compares bounded byte batches and hashes them in
an ordinary function. Complete output, allocation arguments, suspension checkpoints,
limits and ownership behavior remain. Exact source-bound comparison passes 2,626
native/captured encodings, including an intentional string-hash collision; byte() calls
fall 14,467,200 → 11,383,574. All 17,025 unit cases, both 6,756-comparison producer
branches, both 134-observation lifetimes, eighteen captured-input cases, 79 rebuilt
packaged flows, actual Windows installation and fresh UI regression checks pass.
Six paired samples across twelve corpus/path combinations show local improvements.
Two minified application comparisons average nested cold readiness 4289.0
→ 4159.1 ms, with a slight second-edit regression;
this does not pass the original performance or physical-admission gates. Full evidence,
source/package hashes and limitations are in docs/validation/implementation-history.md under this heading and
test/artifacts/logs/bulk-bytes-validation.json. The full M1–M4 goal remains active, ordinary nested
performance/aggregate physical admission remain open, and packed transport stays off.
All temporary work stays in test/artifacts/logs/.

## Reuse the last immutable arena field — 2026-10-29

A fresh renderer CPU profile again locates substantial cold cost in complete document and
projection validation. Repeated immutable field reads can avoid rescanning shape keys and
preceding references. One source-free positive cache now does so; fixed logical storage is
admitted up front. This is separate from native parser/HAST construction and does not solve
their physical-memory/atomicity gates.

The source-bound full-validator probe covers all six full corpora and mixed extensions:
2,155,128 of 4,264,683 field reads reuse the last result. Scans fall 50.5%; skipped preceding
references fall 49.3%. Every field result and suspension checkpoint is exact. The full encoder
differential sees unchanged field/entry/writer work and admission sequences. Real minified
application pairs preserve 48 independent native hashes and observe nested readiness
4253.6 → 4173.6 ms, with mixed changes elsewhere. Controls precede candidates; these modest
timing differences do not establish acceptance or a broad producer speedup.

The fresh packaged test application passes 17,028 units, 79 packaged workflows, actual
Windows install/save/uninstall restoration and nine UI states. Static emitted-class inspection
checks the actual arena cache method; compiled GC/physical admission are not implied.
Proof: test/artifacts/logs/receiver-dispatch-validation.json. Existing individual-call atomicity, native
event/token/point ownership, cooperative decode/storage/final assembly, aggregate physical
admission and full application/platform/distribution gates remain open.

## Keep decoder experiments separate from native construction acceptance — 2026-10-29

A fresh source-bound renderer CPU profile still distributes roughly one active second
across complete cold document/projection validation, decoding and final assembly. Direct
owned-byte reads in the bounded uint32 decoder preserved values and 48 actual native
revisions but did not improve the nested aggregate: cold readiness 4175.7 → 4203.6 ms,
reported transport-out including receipt 1098.1 → 1100.0 ms. Results elsewhere are mixed;
natural GC and ordered controls limit inference. The prototype is rejected and the
accepted decoder restored exactly. Evidence remains in test/artifacts/logs/receipt-walk-rejection.json.
No timing or physical-memory gate is accepted by this experiment.

The separate task-checkbox refinement preserves native input focus/state through checked
and document-lock updates, provides a 24 px label target, and removes the duplicate task
bullet. Fresh checks, 17,028 unit tests, 81 packaged workflows, real Windows installation
and nine UI states pass. Core/renderer-semantic inputs, parser pins and the ordinary
emitted Worker are unchanged. Their existing codec/validator/producer/lifetime evidence
is reused with source hashes, rather than described as rerun. Full details and artifact
hashes are in docs/validation/implementation-history.md and test/artifacts/logs/task-controls-validation.json.

Substantive cooperative receipt/storage/final-assembly work, native event/token/point
ownership, EOF/resolver/compiler/HAST individual-call atomicity, portable aggregate
physical admission and reference-hardware responsiveness still require acceptance.
All original semantic fields, corpora, budgets and M1–M4 feature/platform/distribution
requirements remain. The ordinary browser continues using its JSON Worker endpoint;
packed transport stays inactive. All temporary diagnostics and logs remain in test/artifacts/logs/.

## Cooperative resolved-event compilation — 2026-10-29

The private block producer now also pauses after bounded resolved-event work: 256 span/
serialization/list cursor advances or 16 compiler event dispatches. Nested list loops share
their quota; a backwards in-place merge removes the full-list splice copy. On the actual
700-item probe, one advance falls from 95,198 event dispatches to 16 with an identical complete
root. Thirty-two cancellation cases release 88 weak graph witnesses while outer generator
handles remain held. Both default/development compiler source images and injections are bound.
These checks improve cooperative structure and reachability; they do not calibrate memory.

Complete producer fidelity/lifetime, 17,035 units, 81 packaged workflows, real installation
and fresh UI checks pass. Three alternating application pairs per export condition preserve
96 complete native revisions. Actual transform inputs revealed the original diagnostic used
development exports; retained results are separate from the explicit production series.
Production nested cold readiness averages 4083.5 → 4144.1 ms and reported transport-out
including receipt 1110.6 → 1115.9 ms. The cooperative change adds cost and is retained for
bounded cancellation, not a speed improvement. Complete measurements and limits are in
docs/validation/implementation-history.md and test/artifacts/logs/compile-events-validation.json.

EOF and inline postprocessing/resolvers, individual handlers/listeners/transforms and native
string/array allocation remain partly atomic and unadmitted. Native event/token/point
ownership, receipt/storage/final assembly and portable calibrated aggregate physical admission
still need substantive work under the original budgets. All full-corpus fields, coordinates,
global context, 31,492 nested descriptors and M1–M4/platform/distribution requirements remain.
The ordinary JSON Worker remains selected; packed transport stays inactive. Logs stay in test/artifacts/logs/.

## Cooperative native subtokenization — 2026-10-29

The private producer now postprocesses resolved spans with cooperative event storage and
native-equivalent subtokenization. Nested event walks, gap movements, insertions and copies
share a 256-advance quota. Newly created private child writers use 4,096-dispatch input
checkpoints with write boundaries. Linked token placement, GFM task hooks, container positions
and complete global context remain intact. The ordinary parser path is unchanged.

Held raw child generators revealed captured-state retention and an input array retained in
closed generator argument storage. Private writers now clear an input owner and captured
state on cancellation, including before their first advance. Successful linked writes keep
their context. Sixty-eight cancellation cases release 288 graph witnesses while 76 handles
remain held. Both exports preserve the complete fixture hash; observed maxima are 4,096
private input dispatches and 256 metadata advances. These are work and reachability checks.

Full producer fidelity/lifetimes, 17,049 units, 81 packaged flows, actual installation and
fresh UI regressions pass. Forty-eight production Worker revisions preserve complete native
output. Nested ready/receipt-inclusive transport-out averages are 4234.5 → 4365.3/1115.4 → 1102.4 ms;
full measurements and source evidence are in test/artifacts/logs/subtoken-events-validation.json and
docs/validation/implementation-history.md. Opaque EOF/resolvers, individual calls, source slicing/array allocation,
physical admission, receipt/storage/final assembly and the full application gates remain
open. No numeric cap, full corpus or nested descriptor is removed; packed transport stays off.

## Cooperative native text resolution — 2026-10-29

Private EOF resolution now forwards the audited text/string callback selected by native
resolver function identity. Data merging, line-suffix event/chunk/space scans, copies and
transactional gap edits share a 256-advance quota. Suffix insertions use native original indexes
and reverse application. Other EOF calls receive checkpoints around their atomic work. Native
positions, tabs, hard breaks, final trailing policy, linked state and global context remain exact.
Ordinary parsing keeps its native path. The adaptation includes the upstream MIT notice.

Held native generators/context and revocable callback work pass 44 return/throw cases under
both exports: all 172 witnesses collect with 124 handles held. Unstarted callback input is
revoked too. The old text scan's maximum is 22,307 counted advances in one step; new callback
and buffer work stays within 256, with the private input loop still within 4,096 dispatches.
These are instrumented work/reachability bounds, not elapsed-time or physical-peak acceptance.

Full validation passes 17,082 units, complete fidelity/lifetimes, 48 production Worker revisions,
81 packaged workflows, actual installation and fresh UI regression checks. Nested ready and
receipt-inclusive transport-out averages are 4356.6 → 4391.5/1122.9 → 1115.4 ms; the small-block cold
pair is slower. Measurements, pin provenance and the explicit two-binary historical archive
gap are in docs/validation/implementation-history.md and test/artifacts/logs/text-resolver-validation.json. All 237 predecessor
runtime files reproduce exactly; current artifacts are checked independently and copied.
Other resolver/construct calls, slicing/allocation, physical admission, receipt/storage/final
assembly and original full-application acceptance remain open. No cap or corpus is reduced;
packed transport remains inactive.

## Cooperative private inline resolution — 2026-10-29

The experimental producer now dispatches private EOF attention/strong and GFM strikethrough
resolution through actual native function identities. Nested inside-span resolution uses an
explicit frame stack. One shared 256-advance quota covers dispatch, native-style opener and
closer scans/backtracking, marker reads, event copies/gap edits and nested text resolution.
The native resolvers remain the ordinary parsing authority. Unknown inside-span resolvers
retain their entire native path so their global event observations remain intact.

Both native exports preserve complete event/token/point/chunk serialization hashes on the
instrumented mixed, unmatched, long-delimiter and whitespace cases. A prior advance performs
up to 3,160,086 attention and 2,103,300 strikethrough loop visits on the long paired case;
the candidate's shared metadata maximum is 256, with input dispatches at most 4,096. The
observed frame depth is five. Forty-two return/throw cases per export cover 20 pause locations
and unstarted work; 292 total graph witnesses collect with 5,000 handles, tokenizer contexts and cleared
frame records held. These counters and forced-GC observations establish no elapsed-time or physical
memory acceptance. Exceptional empty/invalid raw-chunk marker slices retain opaque native
serialization; attention inside other constructs, including link-label resolution, stays atomic.

Checks pass 17,135 unit cases, 13,512 complete producer comparisons and 268 existing lifetime
observations. Three alternating application pairs cover all six full corpora and 108 complete
native revisions. Nested cold readiness averages 4516.3 → 4547.2 ms and reported receipt-inclusive
transport-out averages 1166.2 → 1176.6 ms. The additional cooperative work has a processing cost.
Full measurements and package/regression evidence are recorded in docs/validation/implementation-history.md and
test/artifacts/logs/inline-resolver-validation.json. Both unchanged native inline algorithms are checked
against official registry archives and lockfile integrity; all 16 dependency source bindings
are recorded. No corpus, coordinates, descriptors or numeric cap is removed. Receipt/storage/
final assembly, individual native calls/allocation, calibrated aggregate admission and the
original full application requirements remain open; packed transport remains inactive.

## Cooperative private link-label resolution — 2026-10-29

The experimental producer now parks a successful native link/image construct before its next
input code. Native function identity selects cooperative backwards scanning, media assembly,
nested inline resolution and commit; EOF unmatched-label cleanup also cooperates. All these
walks share the 256-advance quota. Native points, array identity, opener-at-zero behavior,
global observations and complete semantics remain. Unknown callbacks and ordinary writes
retain native execution. Pending work revokes even before its first advance.

Both exports preserve all ten complete probe hashes. Prior label loops reach 10,360 visits
in one advance; new counted metadata stays within 256, input within 4,096. One hundred eight
closures release 372 witnesses with 3,720 handles/context/frame records held. Full producer
fidelity, 17,211 units, 87 packaged workflows, real installation and 25 fresh UI states pass.
Three application pairs preserve 108 complete revisions. Nested cold readiness/receipt-inclusive
transport-out averages are 4624.8 → 4669.2/1175.2 → 1201.7 ms. These observations establish no speed,
p95 or physical admission acceptance. Full evidence and source provenance are in
docs/validation/implementation-history.md and test/artifacts/logs/label-resolver-validation.json.

Label tokenization/normalization/lookup, other individual constructs/resolvers/handlers/HAST,
native allocation, calibrated aggregate ownership/admission and receipt/storage/final assembly
remain open under the original budgets. All corpora, coordinates and 31,492 nested descriptors
remain; ordinary JSON stays active and packed transport stays inactive. The full application,
M4, physical, platform, signing and distribution requirements remain unfulfilled.

## Cooperative persistent revision copies — 2026-10-29

Experimental packed-session revision preparation shares a 256-visit quota across ordered
operation/path checks, selection and immutable object/array ancestor copies. Shape-key
admission scans and lazy transformed-field/segment copies preserve the unchanged synchronous
results and exact conservative weights. A private owner revokes graph/callback references,
including before first advance; cancellation clears only private arrays. No partial revision
publishes, and old captures remain immutable.

The full suite passes 17,262 units with one existing skip, including 51 new cases. Eleven
source-bound copy comparisons and 13 actual-session cases keep counted bodies within 256;
16 helper closures plus session cancellations release all 82 witnesses with 120 handles/
owners/raw generators/sessions/captures held. Iterator calls, freezing/allocation and physical
or elapsed-time limits are not inferred. Full producer checks, 108 production revisions,
87 packaged workflows, actual installation and 25 UI states pass. Nested readiness and
receipt-inclusive transport-out averages are 4652.0 → 4733.1/1168.2 → 1207.6 ms. Full evidence is in
docs/validation/implementation-history.md and test/artifacts/logs/revision-copies-validation.json. All 18 native pins are unchanged.

Text splicing, offset/range boundary copies, wire/operation normalization, native aggregate
ownership/admission, opaque constructs/HAST/handlers/allocation and original application gates
remain open. Original budgets/corpora/coordinates/31,492 nested descriptors remain. JSON
Worker stays active, packed transport inactive; M4, physical/platform/signing/distribution
requirements remain incomplete. This is scoped progress toward the full application.

## Cooperative persistent text-piece splicing — 2026-10-29

Experimental packed-session text operations now share the 256-visit revision metadata budget
across position-wrapper walks and prefix/insertion/suffix piece copies. Each piece freezes
as it is copied; a private factory adopts the prepared array without rescanning its pieces.
Synchronous slice/splice bodies, UTF-16 boundaries, exact charges, ordered paths and atomic
publication remain. Revocation clears graph/callback/factory references, including unstarted
work; only private mutable output arrays clear on abort.

17,324 units pass with one existing skip, including 62 new cases. Nine source-bound comparisons
and 19 session cases retain counted work at most 256; 14 helper closures, 18 session
cancellations and the completed session release 203 witnesses with 223 unique handles/owners/raw generators/sessions/
released captures held. The unchanged synchronous path reaches 3,574 counted visits. No
native allocation, physical/time, scalar read/admission or iterator bound is inferred.
Full producer checks, 108 production revisions, 87 packaged workflows, actual installation
and 25 UI states pass. Nested cold readiness/receipt-inclusive transport-out averages are
4828.2 → 4792.6/1235.6 → 1243.5 ms. Full evidence: docs/validation/implementation-history.md and test/artifacts/logs/text-pieces-validation.json.

All 18 native pins and original corpora/budgets/coordinates/31,492 descriptors remain.
Offset/range boundary copies, operation/wire normalization, scalar costs/reads, individual
native constructs/HAST/handlers/allocation, calibrated aggregate ownership/admission and the
original full-application gates remain open. JSON Worker remains active and packed transport
inactive; M4, physical/platform/signing/distribution requirements remain incomplete.

## Cooperative persistent suffix metadata copies — 2026-10-29

Experimental position/range suffix geometry, segment slicing and final assembly now use
shared revocable metadata helpers, also used by array splicing. Parent validation and the
revision/path/copy helpers share the 256-visit budget. Copy bodies freeze segments as they
append; native final freezing/allocation remains separate. Synchronous oracle values and
exact charges/staging sequences remain. Nested validator callbacks resolve through the
revocable owner so retained closed generators do not retain their graphs. Private output
arrays clear on abort, while borrowed append targets retain caller ownership.

17,408 units pass with one existing skip, including 84 new primitive/session cases. Thirty-six
source-bound comparisons, 46 helper closures and 43 session cases collect all 447 graph
witnesses with 559 unique handles/owners/raw generators/sessions/released captures held.
Counted bodies stay <=256; 225 private-array cleanup events are empty. All native fidelity/
lifetime checks, 108 production revisions, 87 packaged workflows, actual installation and
25 UI states pass. Nested cold ready/receipt-inclusive transport means are 4944.5 → 4927.7/1216.1 → 1282.1
ms; no physical/time or performance acceptance follows. Full evidence: docs/validation/implementation-history.md
and test/artifacts/logs/suffix-copies-validation.json.

All 18 native pins, original budgets/corpora, six coordinates and 31,492 descriptors remain.
Operation/wire normalization, scalar cost/read paths, individual field/element/index/summary/
native calls, construct/HAST/handler atomicity, aggregate physical ownership/admission and
the original application gates stay open. JSON Worker stays active; packed transport stays
inactive. Full M4, physical/platform/signing/distribution work remains incomplete.

## Lazy persistent array element metadata — 2026-10-29

Experimental packed raw/view element cursors now prepare shifted segment metadata lazily.
Parent path/offset/range work shares the same 256-visit quota, including discarded arena
reference emissions. Construction reads no segment entries. One revocable owner releases
node/source/target/budget/mapper references, including before first advance. Six structural
node/segment functions move byte-identically into packing-node.ts to remove a runtime cycle.
Complete values, coordinates, exact charges/staging, aliases, old captures, ordered edits and
atomic publication remain. The unchanged synchronous iterator remains the value oracle.

All 62 new tests pass, but the full unit gate remains failed: the final full run records
17,468 passes, two timing failures and one existing skip in 200 files. All 475 loaded repository
inputs are source-bound with transform caching disabled after other validation jobs finish.
The original worker count, assertions and deadlines remain. A correctly source-bound
diagnostic also times out on encoder construction in the preserved baseline and current
source; incoming capacity fails only in the current diagnostic. The first candidate attempt
reused transforms without source bindings and is excluded. No deadline or assertion changes.
Source-bound probes check 21 comparisons, seven pause sites, 32 helper closures and 12 session
cases. Counted metadata and actual array-reference emissions stay <=256. All 5,755 witnesses
collect while 183 handles/owners/raw generators/sessions/released captures remain held.

Native fidelity/lifetime checks, 108 full-corpus application revisions, 87 packaged workflows,
actual installation and 25 native UI captures pass. The source-frozen build reproduces
237 runtime files exactly. Nested cold readiness/receipt-inclusive transport-out means are
4702.0 → 4671.7/1166.6 → 1169.1 ms; these establish no speed, p95 or physical
acceptance. Details and unresolved failures: docs/validation/implementation-history.md and
test/artifacts/logs/element-metadata-validation.json (verified-with-failed-unit-gate).

All 18 native pins and original limits/corpora/coordinates/31,492 descriptors remain. Individual
field/index/position/summary/native calls, native allocation/freezing, scalar work, operation/
wire normalization, remaining receipt/storage/final assembly and aggregate physical ownership/
admission stay open. Ordinary JSON Worker remains active and packed transport inactive.
Full M4, physical/platform/signing/distribution requirements remain incomplete; the full
application goal remains active.

## Projection policy within serialization planning — 2026-10-30

The experimental packed output inspector combines URL policy and complete HAST planning.
Policy executes before each element's property costs are measured, with the original URL
barriers and shared 16-visit/4,096-unit progress quotas. Empty widget descriptions avoid a
widget-only traversal. Complete HTML/widget/layout equivalence, overwrite semantics and
admission weights remain; no native call becomes preemptible through this change.

19,062 unit tests pass with one existing skip; 477 loaded repository inputs are source-bound.
Four new cases check full policy mutations, exact costs and actual work quotas, including
cancellation. Fifty-two owned-output lifetime probes collect their watched graphs. Three
alternating minified pairs pass all six full corpora and 108 revisions. Nested cold ready
means are 4,856.6 → 5,059.1 ms and receipt-inclusive transport means are 1,217.1 → 1,211.7 ms.
These observations establish no latency, p95 or physical admission acceptance. Details:
docs/validation/implementation-history.md and test/artifacts/logs/receipt-assembly-production-summary.json.

The rebuilt Windows package passes 87 workflows and actual installation verifies 79 files,
two launches, exact Unicode/BOM/CRLF saving and restoration of prior registration state.
The current actual ASAR/installer and both actual predecessors remain preserved under
test/artifacts/logs/receipt-assembly-final-artifacts/ and test/artifacts/logs/receipt-assembly-before-artifacts/.

All 18 native pins, original budgets/corpora/coordinates and 31,492 descriptors remain.
Receipt/storage/final assembly, operation/wire normalization, scalar cost/read paths,
individual native boundaries and aggregate physical ownership/admission remain open.
Ordinary JSON Worker stays selected and packed transport inactive. Remaining features,
UI/physical/platform/signing/distribution gates and the full application goal remain open.

## Exact widget completion and parent-owned certification — 2026-10-30

Experimental packed snapshot certification now delegates the raw complete validator inside
an already running capture-owned parent. This removes the child work handle and per-step
forwarder. Independent creation retains immediate admission and revocation. Both paths
copy policy/path/limits before suspension, keep metadata admitted and seal only complete
validation. All 28 source-bound lifetime probes collect revoked graphs while handles and
weak witnesses remain held. The full suite passes 19,080 tests with one existing skip.

A regression exposed acceptance of widget HTML suffixes: cursor completion skipped supplied
characters that were never compared. The comparator now requires exact consumed length
before stream exhaustion. Fresh archived/current contexts demonstrate all seven widget
kinds in both HTML policies: 14 baseline acceptances, 14 current rejections and complete
resource cleanup. App receiver tests keep rejection, old captures and valid retries.

Three alternating minified pairs pass all six complete corpora and 108 revisions. Nested
means are 5080.5 → 5044.6 ms cold readiness and 1233.2 → 1185.2 ms receipt-inclusive transport. Edit results are mixed;
no general speed, p95 or physical admission acceptance follows. The first candidate's
slower 108 revisions and exact source snapshots remain preserved. The rebuilt Windows
package passes 87 workflows and actual installation verifies 79 files and two launches.
Details: docs/validation/implementation-history.md and test/artifacts/logs/receipt-forwarding-validation.json.

All 18 native pins, original budgets/corpora/coordinates and 31,492 descriptors remain.
Ordinary JSON transport stays selected and packed transport inactive. Remaining receipt/
storage/assembly, native atomic boundaries, physical admission, full M4, UI/physical/platform/
signing/distribution acceptance and the full application goal remain open.

The release coordinator color-warning failure is preserved. All 87 completed workflow
results and their passed terminal marker are independently verified without rerunning;
the original command exit code remains unobserved. See docs/validation/implementation-history.md for recovery.
