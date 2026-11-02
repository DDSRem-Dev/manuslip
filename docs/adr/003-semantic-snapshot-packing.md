# Lossless semantic snapshot packing and incremental follow-up

Status: experimental implementation and measured proposal, updated 2026-10-28. The application
now uses owned packed preview preparation opportunistically for bounded snapshots; worker/service
transport remains ADR 002's whole-root JSON. Semantic MSP2 transport and incremental parsing
remain disabled. Existing limits and Source fallback remain current. Earlier checkpoint statements
below describe their recorded state; the current controller integration is described next.

The worker adds exact serializer layout only for sources of at most 524,288 UTF-16 units and
at most 2,000 semantic descriptors and root children. Unsupported layouts or optional metadata
that exceeds the message cap preserve the ordinary projection/JSON payload. The controller
requires this metadata, repacks the already received snapshot and prepares an owned preview
cooperatively. Encoding, arena indexing, validation and model preparation now share one
cancellable sliced task, including their measured active time. It shares the exact
`PackedSource` with `beginPrepared` and binds the document's
complete parser version. Candidate failure returns to native sliced preparation. DOM and async
renderer consumers retain independent leases; pending borrowers can outlive controller disposal.
Initial widget lease exhaustion requests Source fallback after CodeMirror's update. Retry lease
failures use existing error controls. This path does not establish total native snapshot/cache
accounting, wire activation or large-document performance. Bounded status publication now uses
independent leases and committed UI acknowledgements, described below. Exact
validation and current distributable evidence are in [VALIDATION.md](../validation/implementation-history.md).
The encoder preserves the MSP2 spelling, chunks JSON string work at 4,096 UTF-16 units without
splitting surrogate pairs, and copies output at 64 KiB boundaries. Inputs must remain stable
until encoding completes or cancels. Enumeration, shape-key spelling/map lookup, source
validation and native output allocation remain atomic. Record hashing and exact emitted-byte
comparison yield after at most 256 coordinates/references. The bounded owned-preview encoder
has separate 32 MiB weighted working storage, 800,000 traversal-visit and 512-depth limits. Construction
tables, live scratch and writer chunks/output are admitted; completed scratch is released.
Native key enumeration is charged immediately after its result exists. Caller-owned native
input and aggregate physical peak calibration remain open; this local ledger does not
activate packed transport or extend the existing source/descriptor eligibility limits.
Position and array/object interning now use a typed open-addressed record index instead of
retained native key strings/maps. Each slot holds a hash, record ID plus one, and emitted body
offset. Hashes select candidates only: the tag, array length and every exact uint32 coordinate
or child ID are compared against immutable emitted bytes before reusing an ID. Full hash
collisions therefore cannot merge distinct records. Tables stay at most half full, and growth
admits both old and new storage before allocation. Rehashing yields every 256 old slots or
probes; cancellation discards/releases the candidate table and preserves the previous one.
Explicitly bounded encoding rejects probes beyond 256 slots; byte-only callers retain their
existing contract. High/low ID halves, order, length, array/object shape distinctions and
duplicate identities preserve independently written wire records. This eliminates atomic
record-key joining and admits the complete nested diagnostic under the encoder's existing
32 MiB allowance; aggregate/native physical memory and application readiness remain open.

Completed unique records now emit directly into a bounded body writer in their original
ID order. The encoder no longer retains a native record graph or completed reference arrays.
Position coordinate arrays are temporary; unique records retain only typed index slots.
After resolving/emitting the root ID, it drops the completed-identity and scalar/record/shape
lookup tables before header/final-output allocation. Shape lists remain owned and charged.
The header receives only the body's remaining wire allowance, and finalization admits one
combined output before copying header then body at 64 KiB boundaries. Both writers' chunks
remain charged during copying. This preserves exact MSP2 bytes and partial-output rejection;
it does not activate semantic transport or calibrate aggregate/native process memory.

With explicit encoder limits, the optional completed-object identity memo now retains at
most 4,096 entries. It drops that WeakMap before releasing its charged entries and starting
a new memo. Exact scalar/record value interning remains authoritative after eviction, so
revisiting an evicted identity preserves its wire ID. Revisited children consume the ordinary
node/depth/work allowance; heavily shared graphs can therefore reach the traversal limit
earlier. Cycle detection has its own active-ancestor set and is never evicted. The byte-only
experimental call keeps its previous memo behavior. This bounds a cache that the complete
nested diagnostic did not reuse; it does not establish a calibrated physical peak.

Packed string readers now scan literal runs and decode completed escaped fragments with one
native JSON parse per bounded batch, avoiding per-unit callbacks and typed-array spreading.
Each advance still consumes at most 4,096 encoded bytes, including padding. Only an incomplete
escape of at most five UTF-16 units crosses batches; literal output, complete Unicode/escape
validation, fatal UTF-8 decoding, cancellation and the existing workspace admission remain.
The native parse receives at most 4,104 UTF-16 units including its wrapper, never a complete
unbounded field. Nested cached validation is faster in the development diagnostic, but initial
validation and combined producer/preparation/preview latency still exceed acceptance targets.

Captures now also provide cooperative, owned serialization of a complete selected value,
including persistent text/array/position/range transforms. This path streams from the immutable
packed view, remaps reachable records with charged dense index chunks, measures before allocating
one exact-size output buffer and replays without expanding a native tree. Its workspace and
independent output lifetime share the capture's session ledger. The authoritative nested root
exports in 2,793,533 bytes at a 15,175,972-byte peak ledger charge under the worker's existing
16 MiB limit. Independent parser-tree and complete render equality pass. This is a prerequisite
for bounded full-root handoff/compaction; it does not integrate those consumers or activate
production resync. Current measurements and limitations are recorded in VALIDATION.md.

Bounded owned previews now retain a complete root capture for translated reading. Reading
forks that exact immutable revision, serializes its selected root cooperatively and transfers
the independently owned buffer to the dedicated translation worker. It sends no native AST
on this path. The worker checks actual buffer plus envelope bytes, source identity, pinned
parser/renderer versions and complete mdast schema/ranges before native expansion. Validation
copy, source, arena, decoder staging and decoded-tree weights are bounded within the existing
32 MiB reading-worker allowance; plan/unit/block checks continue to apply. Cancellation and
failures release renderer work, captures and output leases. Unadmitted previews continue to
use the existing native capture path. Keeping the root also keeps its complete arena charged
in the renderer session until the preview and independent reading captures close. This adds
production full-root consumption for bounded previews; it does not prove aggregate heap
calibration, eliminate retained native snapshots, or admit the authoritative nested corpus.

Reading reconstruction now shares immutable source/protected nodes and rebuilds only changed
paths. A bounded patch trie keeps equal shared nodes at different paths independent and copies
each changed ancestor once. Descriptor/prototype copying preserves compact position accessors
without invoking them. New nodes/children, statuses, patch metadata and validation/traversal
workspace are admitted before construction against the reading worker's remaining allowance,
with the existing 8 MiB reserve retained. Capacity rejects the operation without publishing a
partial graph; invalid or oversized individual translations preserve their source. Detached
reconstruction remains the independent native oracle and export path. This removes a native
whole-root clone from actual reading renders, but the nested fixture still exceeds current
plan admission and main semantic transport is unchanged.

Packed reading prepares now use bounded shared extraction. Exact canonical payload spellings
pool immutable provider payloads and token descriptions; each occurrence retains its own ID,
path, range and private node bindings. Unit/payload/depth limits remain logical limits even
when many payloads share storage. Extraction charges unit/path/binding metadata, unique
payloads and pool keys, private literal/HTML-group allocations, pending traversal and one
bounded projection before retaining them. It bounds long-unit projection without changing
prose eligibility or the explicit per-unit limit fallback. Job preparation hashes only trusted
interned payloads once; mutable or externally frozen payloads retain normal validation.
After validated native decoding, the exclusive incoming packed buffer is detached/discarded
before plan construction. Reading admission uses the decoded graph plus extraction weights,
workspace, descriptor/map metadata and canonical job copies, instead of JSON-expanding the
shared graph for that ledger. Actual response/renderer descriptor limits remain unchanged.
At that checkpoint the complete nested fixture rejected combined admission. Subsequent
preparation changes below admit it; rendering and aggregate heap calibration remain open.

Prepared reading responses now carry a versioned `prepared-shared` value: all occurrence
records remain present, but payload fields reference an exact-value table. The renderer
admits unit/block/index metadata plus unique payload strings and token objects, validates
indices, complete provider payloads, ranges, IDs and kinds, then shares immutable payloads
among the restored occurrence records. Worker and controller descriptor admission use this
same ownership representation under the existing 8 MiB allowance. Actual response messages
still obey their independent 8 MiB limit; logical aggregate payload and unit limits continue
to apply to all occurrences. Response failure clears the prepared worker plan. This removes
repeated provider graphs from the wire and descriptor ledger without removing private bindings
from the worker plan. Complete nested response admission now succeeds independently, but
combined root/plan/working-memory admission failed at that checkpoint; semantic transport
remains unchanged.

The reading worker initially retained the extraction plan and one occurrence-to-key index rather
than retaining a second array of reading-unit records. Public response records are temporary;
the serialized worker posts them before accepting another operation. Packed prepare peak
admission remains unchanged, but completed extraction scratch and the reserved temporary
response-record portion are released from render-time ownership. Key/map storage and the
existing 8 MiB rendering reserve remain charged. Reconstruction resolves each occurrence's
output on demand and uses its ordered statuses to mark translated ranges, avoiding two
per-render copied maps and filter/map intermediates. Full-root/protected-node retention and
per-unit status semantics are unchanged. Forced-GC probes verify response records collect
while the processor still retains its plan and can render. This phase separation admits a
larger complete reading fixture; that checkpoint did not admit the authoritative nested
prepare or prove portable aggregate heap bounds.

Packed reading now uses `extractCompactTranslation`: it preserves the complete immutable
plan but stores private node references in a weakly indexed array for binding lists of at
least three tokens. Token descriptions stay in the canonical payload. Complete immutable
`bindings` snapshots remain available on demand; reconstruction iterates the private pairs
without retaining a binding-object array per occurrence. Small lists retain ordinary frozen
bindings when that costs less. Plans, units, paths, binding snapshots and private HTML-group
arrays are frozen; source-root immutability remains the caller's contract. Accessors are
added to a fresh shared shape rather than replacing an existing data property, avoiding
per-unit runtime property dictionaries. Ordinary extraction remains the detached oracle.
The compact binding weights are explicit ownership estimates: measured incremental heap
still exceeds their retained ledger on the nested corpus, so aggregate calibration remains
an open gate. No claim of portable physical memory bounds follows from admission.

Immutable reconstruction also interns exact generated text values for one operation. It
charges new type/value nodes, their temporary lookup keys and every occurrence edge before
retention. Equal text may share a frozen node; paths, children arrays and protected bindings
stay independent. Distinct text values and logical aggregate reconstructed-output limits
remain distinct/unchanged. No source nodes, positions or extension fields are omitted.
Complete native value/render equality and a fully translated 280-unit/67,200-code fixture
pass. At that checkpoint the authoritative nested prepare still exceeded combined admission;
ordinary main semantic transport still uses JSON.

Preparation now indexes provider keys by trusted immutable canonical payload identity, avoiding
an occurrence-key map while keeping all source occurrences and private bindings. Native/mutable
preparation remains independent. Extraction finishes before block/job/response allocation;
the latter phase reserves 2 MiB for one bounded validation/hash job plus canonical payload
copies. After publication the processor retains language fields and releases input source and
temporary response-record logical charges. Initial object-lifetime probes observed eight temporary
response/input/settings objects collect while the plan/key index still supports rendering.
This does not measure physical source-string release or calibrate aggregate heap ownership.

That checkpoint prepares all 6,299 units of the exact 1,048,669-byte nested corpus with three payload keys.
Its complete response equals the independent native oracle and round-trips renderer validation.
Post-decode plan phases peak at 33,005,362 weighted bytes and retain 26,380,436 bytes; decoding
has separate admission. Rendering still rejects `translation-view-limit` under the unchanged
32 MiB worker allowance and 8 MiB rendering reserve. Full nested reading, ordinary semantic
transport, packaged readiness/freshness and portable calibration remain open.

Packed reading now stores complete block values in a lossless typed table, with ten uint32
words per block and an interned kind table. UUID and source-hash spellings round-trip exactly,
including footnote sentinels. Admission reserves 512 control bytes and 64 KiB for bounded
kind/index workspace, in addition to the array. Preparation still charges all temporary public
records. The controller's mapped records are used directly during rendering; callers omitting
them must admit a complete ordinary snapshot alongside the existing rendering reserve.
All ten temporary response/input/settings/block objects collect with a live processor, and
clearing it releases six observed plan/root/unit/payload/token-array/block-store objects.

Replacement markup places its shared language and accessible label on one outer group while
retaining per-block direction and IDs, plus per-unit translated/source-fallback language.
The exact nested fixture now prepares and renders a complete replacement projection, including
one translated heading, equal to independent native reconstruction/rendering. It retains
21,859,356 weighted bytes, peaks at 33,323,450 post-decode bytes, and emits a 7,739,838-byte
projection charge under unchanged caps. Both bilingual layouts still reject projection
overflow; a separately expanded default block snapshot also exceeds worker admission.
These are direct development processor observations. Main semantic JSON admission still
prevents the ordinary nested workflow; full translation capacity, packaged readiness/freshness,
aggregate heap calibration and the remaining production transport gates remain open.

The experimental publisher now supports `offerCurrentSteps` for full resync of an exact
committed result after receiver eviction or a lost receipt. An untransformed complete arena
copies its existing validated encoding into separately admitted output at 64 KiB boundaries;
overlays use measured serialization. The publisher keeps the exact graph capture, metadata
and output charged through transfer and acknowledgement, detects changed current graphs,
and cancels without discarding the committed graph. The complete nested document/projection/
layout passes real MessagePort transfer, mandatory receiver validation, eviction and lost-ACK
retry within unchanged caps. Peak worker charge is 15,426,364 bytes. Uncached receiver
validation still takes about 3.7 seconds in the development diagnostic. This does not activate
the application transport, establish overlay compaction capacity or pass packaged freshness.

## Problem and fidelity requirements

The exact 1 MiB nested corpus fixture has SHA-256
`93840405600f54e8014aa52af0dbb30d5e844e3fbfe9656296330807064026c3` and 1,048,669 UTF-8 bytes.
Its complete semantic document/projection occupies about 22.7 MB as JSON, exceeding both the
8 MiB message limit and the existing doubled-JSON snapshot accounting. Whole parsing takes
about three seconds on the local development runtime, so wire compression alone cannot meet
500 ms edit-to-application freshness. Source fallback currently preserves exact writing.

Keep every mdast node, extension property, reference/footnote association, UTF-16 offset,
line/column, descriptor, count and rendered block. Do not truncate nodes, omit positions,
silently downgrade grammar, increase limits to pass the fixture or equate absent Live samples
with passing latency. Full-document parsing and whole-root rendering remain the independent
correctness oracle and fallback. Source text remains solely owned by CodeMirror; any worker
mirror is derived and disposable.

## Executable experiment

`packages/core/src/packing.ts`, `packing-bytes.ts` and `packing-positions.ts` implement the
experimental `MSP2` value format. They remain absent from the package's public exports;
bounded preview and reading integrations import these internal modules explicitly. The main
semantic worker/service protocol still uses JSON. `test/benchmark/profiles/profile-semantic-packing.mjs` loads these pure
modules through the already installed Vite runtime; it adds no dependency or network request.

The wire contains a version marker, object-key schemas, an exact position count, topologically
ordered value records and one root reference. Records encode JSON-compatible scalars, arrays,
schema-based objects or six-coordinate position tuples. Unsigned integers use canonical
bounded varints; other finite numbers use float64, preserving negative zero. JSON string
spelling inside strict UTF-8 retains lone UTF-16 surrogates. Equal scalar and structural
records share identity; reference IDs point backward only. There is no recursive encoder or
decoder traversal. Cycles and unsupported values reject explicitly. Undefined object fields
follow the existing JSON omission rule; undefined array values reject.

Decoded values are immutable. A semantic node exposes an enumerable `position` accessor backed
by one shared Uint32Array and its private index. Reading it returns exact immutable start/end
values without retaining three extra objects per node. JSON serialization and native
structured clone expose ordinary position values. Object/point identity, property descriptors
and prototype identity are not contracts across revisions/realms; complete semantic values
are. Consumers must not mutate the derived snapshot. A structured clone is mutable without
changing the captured source graph. Standalone positions and positions stored under other
keys/arrays also round-trip. Special keys such as `__proto__` become safe own properties.

Decoder checks include actual input bytes, numeric budgets, version, canonical integer
encoding, strict UTF-8/JSON strings, unique schema keys, shape/record/position counts,
backward-only references, complete consumption and independent retained/staging accounting.
It rejects malformed input without returning a partial graph. Generic value decoding does
not establish mdast schema validity or document/revision identity: the application envelope
and complete semantic/source-range validation remain mandatory before admission.

The experimental retained ledger charges objects at 48 + 16 bytes per property, arrays at
48 + 8 bytes per element, unique strings/keys at 32 + twice their UTF-16 length, scalar
records at 8 bytes, coordinates at 24 bytes per position plus a 256-byte table/prototype
reserve, and 96 bytes for a standalone position view when needed. Temporary schemas,
record references and JSON decoding workspace have a separate staging ledger. These are explicit
weights, **not a conservative portable heap bound**. The initial accessor profile showed more
measured retained storage than its weighted ledger predicted. The typed-reference follow-up
below improves that observation, but the model still needs calibration/headroom
before production use. Encoding maps, original parser objects, byte chunks, incoming/outgoing
buffers and pending/current snapshots also require peak accounting; output byte admission
alone does not bound encoder working memory.

Run `node --expose-gc test/benchmark/profiles/profile-semantic-packing.mjs`. It writes only beneath `test/artifacts/logs/`.
It compares the complete document/projection against the original graph, compares a native
structured clone, and renders the decoded root again to compare complete HTML and blocks.
The initial accessor development-Node run had 5,753,829 packed bytes versus 22,705,613 JSON bytes,
26,419,842 weighted retained bytes and 8,041,318 weighted staging bytes. Forced-GC JS heap
delta was 30,151,184 bytes plus 2,645,256 ArrayBuffer bytes: about 31.28 MiB, with little margin
under 32 MiB on just this runtime. Parse/render took 4,149.8 ms, encoding 547.6 ms and decoding
143.0 ms (`test/artifacts/logs/.semantic-packing-private-final.log`, `2026-10-24T04:55:04.955Z`). Earlier
iterations observed parse/render around 3.4 seconds and encoding around 0.4 seconds; timing
fields vary and change JSON size slightly. These are diagnostics, not
packaged latency, total RSS, a portable memory guarantee or production admission evidence.

The generic shared-record variant without compact position accessors fit the wire but used
46,416,658 weighted retained bytes. A separate retained position-view object still used
37,000,866 weighted bytes. Neither is a capacity solution. The final accessor experiment
reduces retained allocations without discarding positions; its weaker calibrated-memory
evidence and remaining latency are explicit.

## Indexed owned arena and selected subtrees

The follow-up implements `packing-arena.ts` and `packing-subtree.ts`. Both remain experimental
and absent from public package exports and application imports. `PackedArena.open` validates
all records and strings, builds a Uint32Array of record offsets and caches only scalar strings
of at most 4,096 encoded bytes. Larger JSON strings validate in 4,096-byte UTF-8 chunks, with
escape/Unicode state preserved across boundaries; decoded large values stay uncached. Direct
reads expose scalar values, frozen keys, reference IDs, lazy array-reference iterators and
exact positions. They do not expand an ordinary mdast tree. IDs are local to one arena and
cannot replace the future document/generation/base identity envelope.

Successful admission takes ownership through native ArrayBuffer transfer, detaching the
caller and any old typed views. Invalid data/budgets leave input ownership intact. Owned
bytes, offsets, cached values and large-string length metadata remain in ECMAScript private
fields; the public object and exposed schema keys are frozen. No mutable byte/index view is
returned. A large scalar read is an explicit caller-owned allocation. `scalarCost` exposes
its output and temporary JSON spelling weights so consumers can admit both before decoding;
the arena does not retain that output or claim to bound every caller-held value.

`readPackedSubtree` gathers only reachable record IDs, then materializes them in their
backward-reference dependency order. It preserves shared subgraphs and exact global positions
without recursive traversal or exponential expansion. Its result has independent retained
and staging budgets, immutable values and a coordinate table for only the selected subtree.
It checks large scalar output/workspace before materialization. Failure returns no partial
result and cannot mutate the arena or an earlier extracted value. It performs no source
parse or new reference resolution: the original verified whole root remains authoritative.

The expanded decoder also replaces one PositionReference object per position with a typed
tag vector and numeric coordinate offsets. Its initial 3,094,117-byte table-staging result
excluded the largest temporary JSON spelling; the final implementation explicitly charges
that workspace as well. It scans string metadata, charges output, then admits the temporary
JSON text before native decoding. The complete final staging figure is 7,767,801 bytes,
within the unchanged 8 MiB allowance. This corrects accounting rather than moving the limit.

The full diagnostic at `2026-10-24T05:18:17.920Z` (`test/artifacts/logs/.arena-profile-final.log`) records:

| Scope | Observation |
| --- | --- |
| Whole fixture | Same SHA-256 and 5,753,829 packed bytes; full document/projection, native clone and rendered HTML/block equality pass |
| Expanded immutable decoder | 26,419,842 weighted retained / 7,767,801 staging bytes; observed JS heap plus ArrayBuffer delta 25,258,272 bytes; decode 109.5 ms |
| Arena validation/indexing | 38.1 ms; 7,135,603 weighted retained bytes including its owned wire and offset table; 36,736 staging bytes |
| Arena ownership/storage observation | Existing incoming wire plus newly observed buffers is 7,127,073 bytes; heap delta was −73,776 bytes, treated as zero in the approximate owned-storage estimate because GC noise cannot establish negative storage |
| Arena + source + one full outgoing copy | 14,986,770 weighted bytes, under the unchanged 16 MiB worker-cache allowance; this does not include a second retained parsed AST or an additional encoded cache entry |
| Read every block range | All 31,492 `from`/`to` pairs in 9.9 ms, with exact count and sum checked |
| Selected nested blockquote | 99 reachable records; extraction 0.46 ms; 11,350 retained / 12,192 staging bytes under independent 64 KiB budgets; exact native-subtree equality passes |
| Remaining full work | Parse/render 3,185.1 ms and encoding 388.4 ms; these remain too expensive for the complete freshness path |

Every field of the entire original document/projection is compared through direct arena reads,
without retaining a decoded full tree. Memory baselines keep original/eager-decoded values and
Vite modules alive; the incoming arena buffer already exists before the baseline, so its
owned bytes are added explicitly. These development-Node deltas and weighted budgets are not
total RSS, a portable heap bound, a measured production peak or packaged acceptance evidence.
Parser/encoder working sets, every simultaneous snapshot, allocator variation and actual
consumer lifetimes still need verification. The safe selected-subtree capability now makes
dependency-aware reuse feasible without keeping a second expanded AST in the worker cache.

## Versioned persistent changes

`packing-revision.ts` and `packing-view.ts` implement experimental immutable revisions over
owned arenas, outside public exports and application imports. Full admission binds an exact
source string to generation, document ID, revision, source hash, parser/renderer versions and
options identity. Updates must match every base identity field **and the exact base source**;
the existing non-cryptographic hash alone is insufficient. Result revision must advance,
including coalesced jumps; ownership/version/options changes require full resync. Source
checks retain the 2 MiB UTF-8 cap, including supplementary characters and lone-surrogate
replacement spelling, without allocating an unadmitted full encoding buffer.

Ordered operations replace existing paths or splice arrays. Paths after a splice refer to
that operation's result. Flat array segments retain original arena references; changing one
element does not copy every unchanged record ID. Numeric lookup scans packed bytes without
allocating a reference object for every preceding item. Object ancestors copy field metadata.
Changing one alias of an interned record preserves the other. New values come from a
separately validated owned arena. Invalid paths, IDs, kinds, ranges, identities or budgets
return no partial revision and leave older captures intact. Operation count (1,024), path
depth (128) and path-key length (1,024) are experimental delta admission bounds; unsupported
updates require resync rather than dropping semantic data.

The result keeps unique arena dependencies, cumulative overlay reservations and its current
source/identity. It does not retain its predecessor revision or predecessor source. Older
arena dependencies remain conservatively charged even after replacement; overlay reservations
also overcharge obsolete intermediate metadata. `retainedBytes` reports that result ledger;
`preparationBytes` additionally reserves the preceding source/identity and dependency-set
bookkeeping during preparation. A separate staging ledger admits operation/path traversal.
Caller-owned large scalar output still requires `scalarCost` admission. Callers subtract an
outgoing-buffer reserve before preparation. These explicit weights remain an experiment,
not a portable heap bound. Session-wide captures, prepared results, cursor lifetimes, channel
commits, evictions and resync are **not** yet owned by this implementation; aggregate
lifecycle accounting and stale prepared-result rejection remain activation gates.

The diagnostic obtains a same-length prose edit from an independent **complete parse and
render**, computes a whole-tree diff and applies packed path replacements. It compares every
updated document/projection field with that oracle and every old captured field with the
original. This proves update representation fidelity, not a safe incremental parsing rule.
The final run at `2026-10-24T05:37:39.589Z` (`test/artifacts/logs/.revision-profile-final.log`) records:

| Scope | Observation |
| --- | --- |
| Changes | 15 replacements, 2,336,921 packed bytes; mostly the whole replacement HTML string |
| Delta encoding + indexing / persistent application | 37.4 / 11.2 ms; application includes source/identity checks |
| Result / preparation / staging weights | 11,649,406 / 13,747,838 / 4,416 bytes |
| Preparation + outgoing delta reserve | 16,084,759 bytes, within unchanged 16 MiB cache for this one edit |
| Repeated edit capacity | Next whole-HTML delta rejects at that cap with its outgoing reserve; accepted graph remains exact |
| Independent edit oracle / full diff | 3,541.0 / 183.0 ms; still too expensive for freshness |

The 19 added cases cover fresh-parse full-root edit sequences, ordered/random array changes,
alias/capture isolation, identities and exact source, ownership/version changes, coalesced
revisions, failed partial preparation, exact limits, Unicode, positions and special keys.
A 40,000-entry descriptor-array splice adds less than 4 KiB weighted result storage.
Repeated whole-HTML replacement must be addressed before this representation can sustain
ordinary editing. This checkpoint adds no production transport or semantic reuse rule.

## Persistent text spans and repeated updates

`packing-text.ts` adds flat immutable UTF-16 spans over owned string records. A `text`
operation replaces a code-unit range with a string from the delta arena. It keeps unchanged
spans in their original arenas, including cuts through surrogate pairs; the result must
preserve exact JS-string values, not normalize Unicode. It validates string kinds, exact
integer ranges and result length before publication. Old aliases/captures remain unchanged.
Span and temporary slice metadata are charged before construction. Arena dependencies and
obsolete overlay reservations still accumulate conservatively; this is not an unlimited
history or a compaction/session lifecycle implementation.

`packing-string.ts` shares the JSON lexical scanner between length validation and chunked
decoding. `PackedReader.stringChunks` uses fatal streaming UTF-8, preserves escape/Unicode
state and emits at most 4,098 UTF-16 units per chunk. Direct reader iteration may yield a
prefix before a malformed suffix rejects; the arena validates all input before exposing
any cursor. Owned arenas expose exact string length/workspace and caller-owned chunks,
without caching decoded long values. Tests now compare every possible UTF-16 code unit
against native JSON decoding, alongside malformed UTF-8/JSON and all earlier boundaries.

`PackedView.readScalar` checks retained output and staging allowances before reading.
Persistent text materialization uses one decoding cursor per distinct arena/string ID,
resuming it across separated unchanged spans; backwards source ranges reset that cursor.
It never expands unrelated scalar records. The output is caller-owned and uncached.
`scalarCost` reserves the returned UTF-16 string separately from temporary decoded chunks,
join storage, cursor state and boundary-chunk retention. These are explicit experimental
weights, not a portable heap bound. Joining the full HTML is still too expensive for an
uninterrupted renderer apply slice; future representation-aware consumers must avoid it
or perform it off the renderer thread.

`node --expose-gc test/benchmark/profiles/profile-semantic-text.mjs` writes results beneath `test/artifacts/logs/`.
It independently parses/renders the original nested fixture and one same-length prose
edit, then computes both complete-tree diffs. Long strings use exact common-prefix/suffix
splices. Forty alternating updates each compare every complete semantic/projection field,
including positions and HTML, against one of those two independent oracles. Three older
captures are compared again after all updates. It does not perform forty independent
parses, prove semantic reuse, model arbitrary edits or establish session-wide ownership.

The local diagnostic at `2026-10-24T05:54:26.270Z` (`test/artifacts/logs/.text-profile-final.log`) records:

| Scope | Observation |
| --- | --- |
| Full oracle sources | Same nested fixture SHA-256; original and edited complete parse/render took 3,724.7 / 3,810.6 ms |
| Two full-tree diffs | 357.9 ms combined; still oracle/setup work, not incremental parsing |
| Each delta | 336 packed bytes; at most 2,142 bytes including candidate identity/path envelope, versus prior 2,336,921-byte whole-HTML replacement |
| Encoding + indexing / application p95 | 1.99 / 18.47 ms across 40 development-Node samples; application includes full source checks |
| Complete HTML materialization p95 | 61.18 ms; exceeds the renderer's 4 ms uninterrupted apply allowance |
| Final retained / maximum preparation + outgoing reserve | 12,752,065 / 14,857,563 weighted bytes, within the unchanged 16 MiB cache for this sequence |
| HTML caller output / staging | 4,522,048 / 4,957,536 weighted bytes, independently admitted and not retained by the revision |
| Observed additional heap / buffers | 512,272 / 13,440 bytes after forced GC, with base/native oracles/diff plans already alive; not total RSS, calibrated production peak or portable bound |

The outgoing reserve includes one packed payload copy and twice the candidate envelope's
encoded bytes; exact source strings already belong to the request/receiver in this local
experiment. No production transport envelope has been activated. Forty-edit storage
success supersedes the earlier second-whole-HTML-delta rejection only for this tested
text-splice sequence. Persistent arena/metadata accumulation still needs bounded session
ownership, compaction/resync and complete capture accounting.

## Bounded session ownership and revocable readers

`packing-source.ts`, `packing-resources.ts`, `packing-capture.ts` and `packing-session.ts`
add an experimental owner around the persistent revision primitives. The resource ledger
unions actual arena, source and overlay object identities, with a 192-byte bookkeeping
reserve per resource. Equal hashes or equal source values do not establish shared ownership.
The exact validated source object is shared between one request and its prepared result.
Current, request, prepared result, explicit captures, active iterators and prepared outgoing
copies all count against one configured retained limit. The outgoing reserve stays charged
until commit, discard or invalidation, including when a caller subsequently opens a reader.

Request and preparation tickets use object identity as well as frozen metadata. A new
request invalidates earlier tickets even if every metadata value repeats; tickets from
another session cannot publish a result. Delta admission checks all base/result identities
and the exact base source before opening its binary payload. An evicted base requires full
resync. Successful binary opening consumes the caller buffer; later path or operation failure
can leave that buffer detached while retaining the accepted graph and request for retry.
Malformed binary or an identity mismatch does not consume the buffer.

Prepared results remain private until commit. A bounded `capturePrepared` scope permits
receiver validation before publication; commit, discard and invalidation revoke these
inspection scopes. Current captures preserve older immutable values across later updates
and eviction until explicitly released. Escaped root readers are revocable; iterator items
expire on advance, while nested iterators have independent scopes. Releasing a capture
closes all its iterators and clears the revision and owner callbacks. Native scalar, key
and position outputs remain independently admitted caller-owned values. This owner does
not track their aggregate lifetimes or authorize an unbounded native tree reconstruction.

The 16 session cases include exact admission boundaries, held outgoing reserves, cross-owner
and repeated-identity races, pre-commit inspection, partial rejection/retry, buffer transfer,
old captures, scope expiry, eviction, resync and disposal. A real GC diagnostic keeps escaped
root/item/iterator and canceled inspection handles alive: an active capture pins the session,
and released handles permit the owner to be collected.

The updated nested diagnostic at `2026-10-24T07:43:02.819Z`
(`test/artifacts/logs/.session-profile-final.log`, `test/artifacts/logs/semantic-text-profile.json`) additionally runs an
independent session through the same 40 updates. Every current field is compared through
guarded readers, and an original capture remains live for the first ten updates before
comparison and release. It records 14,990,996 weighted bytes at full preparation including
the outgoing reserve, a maximum update preparation of 14,882,075 bytes and final ownership
of 12,775,937 bytes across 83 resources. Disposal reports zero owned bytes, resources,
captures, readers and outgoing reserve. Source validation in `begin` has p95 15.53 ms;
preparation and commit have p95 0.41 and 0.02 ms respectively. These development-Node
measurements do not establish renderer slicing or packaged freshness. The unchanged two
independent complete oracle parses still take approximately 3.5 seconds each.

Resource weights and the observed additional heap/buffers (879,896 / 26,880 bytes with native
oracles, plans and both bases already alive) are not calibrated production peak/RSS bounds.
Candidate wire sizing still treats exact source strings as local request/receiver arguments;
an actual bounded wire envelope and receiver schema/range validation remain unimplemented.
Persistent historical arena/overlay accumulation still requires compaction or full resync.

## Whole-document dependency context

`semantic-dependencies.ts` builds an immutable, separately admitted context index from a
verified complete parser root through a session capture. It copies top-level block ranges,
definition/reference ranges and renderer keys without reconstructing the native graph.
Iterative traversal bounds nodes, depth, retained metadata and scratch space; all borrowed
iterators close on success or rejection. The result retains its exact validated source and
frozen snapshot identity, with no arena, capture, reader or session handle. `assertBase`
checks every identity field and exact source equality before the index can describe a base.

Definitions use the installed renderer's uppercase parser-normalized identifier key and
first-definition selection, independently for links and footnotes. Link/image/footnote uses
retain their selected definition and enclosing footnote context. Footnote calls run through
the main body first, then the selected used definition bodies in first-call order, including
newly discovered notes, repeated calls and cycles. Unused and duplicate definition bodies
do not acquire rendered call numbers. Literal unresolved reference syntax remains literal;
block bracket flags prevent treating its absence from semantic references as context freedom.

Upstream positions must be preserved even when they overlap. In CommonMark example 215,
`[foo]: /url` precedes a setext heading whose upstream start offset also includes that
definition. The index preserves both exact ranges and reports `disjointBlocks: false`;
such boundaries cannot authorize fragment reuse. This index is not an arbitrary-mdast
validator, a fragment parser, an edit invalidation protocol or a reuse proof.

The 183 tests include 156 CommonMark link/image/definition/entity examples, direct comparison
with complete parser definition/reference ranges, actual renderer footnote call numbers and
repeat suffixes, Unicode keys, CRLF, grammar selection, duplicates, cycles, reordered edits,
exact identity/source binding, immutability and exact admission boundaries. Iterator cleanup
also covers rejection by the session's own reader limit.

`node --expose-gc test/benchmark/profiles/profile-semantic-dependencies.mjs` at
`2026-10-24T08:04:18.853Z` compares all 6,300 top-level ranges and 9,447 reference ranges/keys
against the unchanged complete nested fixture. Traversing 113,368 nodes takes 194.86 ms
in development Node; the independent complete parse/render takes 3,650.34 ms. The index
admits 5,601,620 weighted retained bytes (including its exact source) and 20,480 staging
bytes. The accepted owner, index and reserve for all 64 allowed iterators total 14,869,387
weighted bytes, below 16 MiB, after the full outgoing payload has been released. A GC probe
keeps the independent index alive while its disposed owner is collected.

This is initial indexing capacity, not update-time aggregate admission. The index is a
caller-owned output and is not automatically included in the session ledger; keeping it
across a pending request/preparation must be admitted together with those resources. Source
sharing, compact metadata, incremental index maintenance and compaction/resync still need
an integrated ownership design. These weights are not calibrated heap/RSS or packaged
observations. The 195 ms whole-root index build must not run in a renderer apply slice.

## Context-verified local Markdown parsing

`markdown-fragment.ts` and `fragment-tree.ts` now implement an experimental local parse
returning an immutable top-level replacement and a suffix-offset instruction. The whole
source identity, generation/document/version/options and exact change spelling must match
the captured dependency index. `parseMarkdownWithGrammar` is an internal entry that applies
the verified whole document's grammar to a slice; `parseMarkdown` continues choosing its
whole-source grammar as before. Neither internal entry is exported from the package index.

The current general eligibility rule admits edits composed of Unicode letters, numbers,
marks and ordinary spaces, within a supported paragraph/heading/quote/list text range or at
EOF. It requires disjoint upstream block ranges and blank top-level separation, rejects
surrogate splits and document-wide grammar changes, and does not edit definition/reference
ranges. Inserting/removing syntax markers, newlines, containers or ambiguous boundaries
requests full parsing. Code/math/HTML/table/frontmatter/footnote-body edits remain unsupported.
EOF after a final definition is covered, including creation of a following paragraph.

The parser adds selected whole-document definitions behind an isolated sentinel, parses the
old slice and compares every field/property/position with the captured old subtree. A missing
sentinel, changed definition/reference spelling or ordering, changed block shape or failed
old-context comparison requires a full parse. The candidate uses the same definitions and
grammar. This catches unresolved labels becoming resolved after prose edits. Iterator scopes
close on rejection, including a session reader cap. Input is at most 64 KiB by a conservative
UTF-8 upper bound; parser scratch, node/depth and returned data each have explicit admission.
The parser scratch weight is provisional and still needs packaged heap calibration.

No newline changes are admitted, so later root children preserve line/column coordinates
while every source offset shifts by the insertion/deletion delta. Replacement nodes are
anchored and frozen, and the root end point is updated exactly. The returned suffix shift
is consumed by the packed operation described below. Production
counts, semantic descriptors, outline, dependency-index updates and rendered projection
updates are not produced by this module. It must not publish a supposedly complete snapshot.

The 438 cases include 391 CommonMark inputs with a prose edit: each either equals a fresh
whole parse or explicitly falls back. Separate positive cases compare complete roots and
rendered projections for nested containers, lists/tasks/headings, CRLF/CR, Unicode entities,
reference/footnote context, length changes and EOF. Coverage includes grammar transitions,
overlapping upstream positions, identity/source binding, immutable results, admission,
reader cleanup and a deletion exposing 500 nested quote markers.

The exact nested diagnostic (`test/benchmark/profiles/profile-markdown-fragments.mjs`) verifies two actual
local parses against independent complete fresh roots. It compares unchanged packed prefixes,
replacement fields and all shifted suffix positions through guarded readers, without
materializing an old native root. A longer nested word and EOF typing after the final
definition both pass. Separate source validation remains a full-source pass. The initial
owner, caller-owned index and one patch total approximately 19 MB in the independent weight
model, exceeding 16 MiB; keeping both patches totals 23,289,259 bytes. Source values are
conservatively charged by each independent owner. This is evidence for required shared
ownership/compact metadata work, not permission to raise the cache limit. The diagnostic
also proves that held docs/patches/context do not retain the disposed session.

## Packed suffix-offset publication

The persistent revision protocol now accepts an experimental `offset` operation naming an
array path, suffix start and signed offset delta. It changes only offset coordinates in
position-tagged values. Line/column coordinates, scalar numbers, similarly named object
properties and all text remain exact. A flat array segment carries the transform; descendants
apply it through indexed views when read. Repeated shifts combine at segment/node edges
instead of retaining a recursive wrapper chain. Splices and replacements preserve shifts
on old values while newly inserted values keep their absolute coordinates. Ordered edits
inside an already shifted subtree remain supported.

Preparation validates every position in the selected suffix before publishing anything.
Underflow/overflow of the unsigned 32-bit coordinate range rejects the complete ordered
update, including any successful preceding operation. The iterative validation walk limits
depth to 256 frames and visits to 800,000, with admitted scratch and metadata. This first
implementation still walks the suffix; it does not claim constant-time validation. Retained
output copies segment metadata, without re-encoding or expanding unchanged descendants.
Historical metadata/arena weights still accumulate until a full resync.

Eighteen additional transform tests cover aliases, immutable captures, 600 composed/reversed
shifts, absolute replacements, nested splices/text edits, malformed offsets, exact range and
memory boundaries, reader cleanup, excessive depth/alias expansion and 12 length changes in
different blocks against independent fresh roots. The existing positive local-fragment tests
now also prepare, inspect and commit actual packed roots and recheck the old capture.

The updated `test/benchmark/profiles/profile-markdown-fragments.mjs` additionally applies both nested-corpus
candidate roots through separate 16 MiB sessions. A longer nested word needs a 981-byte
packed replacement and 107.39 ms preparation including suffix validation; EOF typing uses
296 bytes and 0.20 ms preparation. Commit takes 0.010 / 0.003 ms. Both current and old roots
compare exactly with independent native oracles, and disposal releases every managed
resource. Prepared ownership including the outgoing reserve peaks at 11,355,291 /
11,351,809 weighted bytes for those two root transactions.

Those transaction weights exclude the separately owned dependency index and fragment output.
Their combined independent weights still exceed the unchanged 16 MiB limit. Nor does this
root transaction update non-root descriptors/counts/outline, the dependency index or rendered
projection. It therefore cannot publish a complete application semantic snapshot. Source
resource sharing, integrated admission and incremental maintenance remain required. The
107 ms validation must stay off the renderer apply path; these two development samples are
not packaged freshness/p95 or calibrated heap bounds.

## Shared source and derived ownership

The subsequent ownership checkpoint replaces repeated source charges with an actual resource
union. Captures and dependency indexes expose the same immutable validated `PackedSource`;
`beginPrepared` shares that exact object with requests and revisions. Equal text in distinct
source objects remains separately charged. Dependency indexes and fragment outputs expose
trusted internal resource footprints. A session's `retain` handle charges those resources
and its own bookkeeping alongside current/request/prepared revisions, captures/readers and
outgoing reserve. Footprints are bounded, validated and deduplicated before any pins change.
Cancellation, commit and eviction preserve independently live holds. Disposal closes them.

Holds account for native values; they do not revoke them. Callers must keep ownership admitted
until the associated uses end or transfer to another admitted owner. Builders still need
construction/staging peak calibration; admitting a completed output does not prove its parser
construction peak. The local ownership diagnostic at `2026-10-24T09:03:05.874Z`
(`test/artifacts/logs/.ownership-profile-final.log`) admits the old snapshot/capture, index, fragment,
result request, preparation and outgoing reserve together at 14,913,455 / 14,864,561 weighted
bytes. Both transactions fit the unchanged 16 MiB limit. Historical independent sums above
repeat source charges and remain useful standalone weights. Real GC checks prove released
handles and live independent outputs do not retain a disposed owner or obsolete index.

## Immutable dependency maintenance

`SemanticDependencies.advance` updates an index only from a real local-parser result certified
against that exact index. Weak provenance tokens retain neither the index nor its source;
clones, an equivalent independently built index and replay against an updated index reject.
The existing prose/grammar/dependency eligibility rules still decide when full parsing is
required. The update rereads only the small replacement tree's records, verifies definition
and reference order, preserves selected definitions and footnote call numbering, and replaces
their absolute ranges. Unchanged records use flat immutable segments with accumulated offset
and block deltas. No recursive chain of previous indexes or sources is retained.

The source-free metadata backings participate in the same session resource union. Old and
updated indexes share their actual immutable tables; the new index adds its bounded local
records, descriptors and bookkeeping. Previous captures/indexes remain exact. Retained and
scratch reserves are checked before collecting replacement records or copying segments.
Node counts update exactly from per-block counts. The depth bound stays conservative across
updates. At 128 metadata backings or 4,096 segments, require a full rebuild/resync rather than
silently dropping context or raising the cap. Historical tables remain charged until that
rebuild, even where their records have been replaced.

Tests compare updated indexes with independent fresh whole parses across prose edits,
CommonMark cases eligible for local parsing, nested definitions/references, cyclic/duplicate
footnotes, Unicode, CRLF and EOF block additions. They exercise exact admission boundaries,
provenance rejection, old/new lifetime overlap, bounded history and successful full resync.
The fragment diagnostic additionally checks both indexes during each real packed transaction
and a six-edit nested-corpus sequence. Every prepared/current root is compared completely
with a fresh parse; a whole-root index rebuild independently checks each updated index.
Explicit real GC verifies that a live updated index does not retain an old index, source
wrapper or owner. These are development correctness/admission checks, not packaged latency
or calibrated heap/RSS evidence.

The final development run at `2026-10-24T09:24:53.931Z`
(`test/artifacts/logs/.dependency-update-profile-final.log`) admits old/new indexes and the complete
transaction at 14,917,877 / 14,868,893 weighted bytes for the two original examples.
Six consecutive early/middle/late nested edits peak at 15,053,817 bytes, still below 16 MiB.
Updated indexes cost 0.11–1.42 ms in that sequence; packed preparation costs 18.30–172.19 ms.
Every complete root, index and old capture matches its oracle. These samples establish a
bounded root/index sequence, not complete application freshness or arbitrary edit schedules.

## Complete parser-document transactions

`document-metadata.ts` now prepares all non-root parser fields for a certified local edit:
block descriptions and hashes, outline text/depth/ranges, counts, source hash/parser version,
and actual incremental parse/description timings. `semantic-description.ts` shares the
existing descriptor and heading rules with the full parser; its public behavior is unchanged.
Only replacement descriptions are rebuilt. A new ordered packed `range` operation shifts
the immediate numeric `from`/`to` fields of surviving array items, preserving nested fields,
positions, scalar values and aliases. It composes independently with position-only `offset`
transforms, combines repeated shifts, checks unsigned ranges before publication, and bounds
validation visits and scratch. Late failure leaves the accepted graph unchanged.

The metadata builder verifies the exact index/fragment/capture identity and current document
hash/version. Provenance tokens also bind operation generation to the real fragment, metadata
object and document path. Tokens retain none of the input owners or previous source wrappers.
The native metadata output has its own shared-source footprint and must remain admitted until
its use ends or its encoded data transfers to prepared ownership. This helper builds trusted
internal operations; it is not a receiver/wire/schema validator.

Word counts deliberately preserve the full parser's exact semantics: join every mdast text
value in traversal order with one ordinary space, then run the same runtime-default
`Intl.Segmenter`. A guarded walk substitutes candidate text for the selected old block, without
materializing a native root. Bounded chunks reduce temporary string/array overhead; scratch
admission includes the joined prose and possible Intl segment. Character counts iterate
Unicode code points. No unproven additive word-count assumption or locale change is introduced.
This first implementation still traverses unchanged text and descriptor ranges. Reducing that
cost while preserving the exact global word input is required for freshness.

Seventeen transform tests and thirteen metadata tests cover mixed/repeated shifts, absolute
edits, malformed ranges, exact boundaries, expanded aliases, rejection before large scalar
decoding, Unicode/Intl cases, stale metadata/provenance, cancellation/disposal and reader cleanup.
Existing positive/CommonMark fragment and repeated-edit tests now compare full parser metadata,
and actual packed transactions compare complete parser documents with independent fresh parses.
Old captured documents remain exact. Timings report real incremental work, rather than copying
unrelated fresh-oracle durations.

The development diagnostic at `2026-10-24T09:50:14.340Z`
(`test/artifacts/logs/.metadata-profile-final.log`) publishes complete parser documents and updated dependency
indexes for the original examples and six successive nested edits. Peak retained ownership is
15,248,533 weighted bytes under 16 MiB; separate counting scratch peaks at 5,455,382 bytes under
8 MiB. Real GC confirms independent metadata/index outputs do not retain obsolete owners,
indexes or old source wrappers. All managed resources close on disposal.

Metadata costs 191.27–303.40 ms and one sequence preparation costs 289.66 ms. That edit's
measured source/local-parse/metadata/preparation/index work already totals about 609 ms, before
debounce, projection, transport or renderer application. **Freshness remains unsatisfied.**
At that checkpoint, the rendered projection was still stale. The following experiment adds
complete projection publication; the application still does not use these transactions.

## Complete rendered-projection transactions

The public renderer now delegates to a shared internal projection engine with the same
serialization, widget descriptions and URL policy. `projection-layout.ts` observes exact
top-level serializer spans during initial rendering. Visible spans exclude joining newlines;
suppressed definitions/frontmatter retain zero-length anchors at the preceding visible end.
The layout separately records the body end and total HTML length, so a global footnote footer
can be replaced independently. No HTML substring search or assumption about unique text is used.

`render-fragment.ts` renders the certified replacement body with the globally selected first
definitions. External definition blocks are copied through bounded guarded readers; the copy
checks scalar admission before decoding, charges containers and scratch, limits visits/depth,
freezes the result and closes iterators on failure. Copies shift only valid source offsets,
preserving line/column values. No complete native root is reconstructed for a local edit.
The public `mdast-util-to-hast` root handler receives global definition maps, footnote order
and call counts. Prefix counts preserve body reference IDs; complete main-body counts seed
upstream footer generation, including cyclic and nested references and exact backlinks.
The complete footer is regenerated through upstream handlers and the existing renderer policy.

`projection-fragment.ts` builds ordered operations for footer/body HTML, selected layout
entries, suffix HTML ranges, rendered widget ranges/splices and actual render timing/version.
Body separator newlines and invisible anchors are preserved through repeated growth/shrinkage.
`projection-block-plan.ts` merges new body/footer blocks with unchanged packed blocks, avoiding
decoding unchanged HTML/value strings. It bounds input block counts, plan scratch and splice
groups. Parser-document and projection operations prepare and commit as one transaction.
Genuine fragment/patch tokens bind operation generation; outputs carry independent resource
footprints and no obsolete owner/index/source closures. These remain trusted internal builders,
not complete semantic validators for arbitrary wire input. Construction weights are provisional.

The focused 422-case run covers CommonMark candidate/fallback behavior, exact full projection
and layout equality, raw HTML policies, reference/footnote order and cycles, duplicate
definitions, footer widgets, CRLF/Unicode, EOF separators, repeated histories, old captures,
pre-decode admission, exact budgets, stale metadata, provenance and failure cleanup.
The full unit suite passes 4,982 tests with one platform skip; static checks pass. These tests
include the existing public renderer, CommonMark and export suites after the engine extraction.
The production app/public exports do not import the experimental projection helpers.

The complete development diagnostic at `2026-10-24T13:25:15.098Z`
(`test/artifacts/logs/.projection-profile-final.log`, `test/artifacts/logs/markdown-fragment-profile.json`) preserves the
exact nested fixture and unchanged caps. Both original scenarios and six early/middle/late
edits match independent complete parse/render/layout oracles, including all previous captures.
Peak combined retained ownership is 15,677,518 weighted bytes under 16 MiB; maximum counting
scratch is 5,455,382 bytes and projection scratch is 364,864 bytes under the separate 8 MiB
limit. Projection preparation costs 7.67–12.51 ms. GC confirms live projection/metadata/index
outputs do not retain obsolete owners, indexes or source wrappers; disposal reaches zero.
The fourth sequence edit totals about 495.30 ms before debounce, encoding/transport and
renderer application. This is still insufficient freshness evidence and leaves little room
for accumulated revision metadata. Bounded compaction/resync and packaged measurement remain
required. The public renderer extraction also passes `npm run build:app`; no installer was
rebuilt or experimental transport activated.

## Temporary DAG summaries for suffix validation

`packing-position-summary.ts` summarizes an already byte-validated arena in topological record
order. Each record stores minimum/maximum descendant position offsets, expanded traversal
visits and container depth. Alias multiplicity remains part of the visit count; counts and
depth saturate only beyond the existing rejection thresholds. Offset extrema remain exact.
The selected subtree's bounds, not the entire arena's bounds, govern validation, so invalid
unselected prefixes do not reject a valid suffix. Shifted overlays add their existing offsets;
mixed arenas, absolute replacements and range transforms preserve their previous semantics.

The suffix validator starts with direct traversal. After a bounded amount of work, it builds
a summary only when observed work per top-level item predicts enough remaining work to justify
indexing the whole arena. Short suffixes retain the direct path. Both strategies enforce the
same 800,000 expanded visits, 256 container frames and unsigned position bounds. This is a
cost heuristic, not a semantic or fixture shortcut. No scalar string is decoded for summaries.

The complete 16-byte-per-record table and overhead are admitted before allocation, as temporary
scratch under the existing 8 MiB limit. Tables never enter revision nodes or the resource
ledger. Session statistics report prepared-transform scratch separately from retained bytes.
Real GC in the complete nested diagnostic confirms all eight tables collect while the current
capture, index and derived outputs remain live. Caller admission weights still need real
packaged construction/heap calibration.

The diagnostic at `2026-10-24T13:45:25.541Z` retains full document/projection/layout/index/old
capture equivalence for both original scenarios and all six edits. Early/middle preparation
is 63.33–80.06 ms; late preparation stays on direct traversal at 27.82–29.14 ms. Transform
scratch peaks at 5,804,512 bytes, while retained ownership remains 15,677,518 bytes under
16 MiB. Complete measured incremental components total 251.93–334.62 ms before debounce,
encoding/transport and renderer apply. This improves the previous checkpoint's roughly
495 ms slow transaction, but is still development evidence rather than packaged p95.
Whole-document exact Intl counting, production integration and bounded revision resync remain
open; no application transport or installer is changed.

## Bounded envelopes and transactional receipt

`packing-wire.ts` and `packing-wire-values.ts` define the experimental
initial `manuslip-packed/1` full/delta/resync envelope (superseded by version 2 below).
Exact data-property schemas reject unknown
fields, accessors, nonstandard prototypes, sparse arrays and unsupported versions. Numeric
identities/paths/operations, finite timings and bounded strings are checked before consuming
any binary records. Normalized metadata, operation arrays and paths are copied/frozen.
Delta ownership must remain consistent and its revision must advance. Claimed byte counts
cannot bypass admission: actual binary bytes plus canonical JSON envelope bytes plus a
1,024-byte transport reserve must fit 8 MiB. The envelope itself is capped at 64 KiB;
normalization is capped at 512 KiB with a conservative scratch reserve admitted before JSON
serialization. These are separate protocol/admission bounds, not a measurement of engine
structured-clone overhead.

`PackedReceiver` binds a response to its exact pending source/sequence and opaque local
request ticket, then resolves a delta only against its current locally owned source. It pins
incoming binary/normalized metadata through arena preparation and validation. A mandatory
synchronous application validator inspects a revocable prepared capture before commit.
Malformed records, operation/schema failures, capacity failure, cancellation and validator
reentry preserve accepted data and close partial readers/holds. Unknown/evicted/mismatched
bases return explicit resync without consuming their payload. Full resync, owner/version/
options changes and repeated sequence values have coverage. Released captures and tickets
cannot retain a disposed receiver; disposal also clears validator callbacks and their context.
The generic validator hook does not itself constitute complete mdast/schema validation.

Packed identity options now allow 4,096 UTF-16 units. This covers the production API's two
200-unit labels even when JSON must escape every control/lone-surrogate unit. Other identity,
source, transport and cache caps remain unchanged; identity admission charges actual spelling.

The complete local-projection suite now sends its full snapshots and deltas through genuine
buffer transfers and this receiver, checking every accepted semantic field against independent
fresh results and retaining original captures. All 443 focused cases pass; the complete suite
passes 5,025 tests with one platform skip and static checks pass.

The exact nested diagnostic at `2026-10-24T14:16:07.245Z` sends an initial full snapshot and six
deltas through actual Node `MessagePort.postMessage` transfers. The full message is 5,887,656
bytes including envelope/reserve; deltas are 5,804–6,097 bytes. Sender peak ownership, including
outgoing payload, normalized envelope and operation-construction reserve, is 15,705,797 bytes.
Receiver peak is 15,332,398 bytes for full receipt and 14,185,734 bytes across deltas, each under
its separate unchanged 16 MiB ledger. Wire scratch is at most 172,304 bytes and transform
scratch remains 5,804,512 bytes under 8 MiB. All 15 temporary validation tables collect while
captures remain live, and both ledgers reach zero on disposal.

Receiver acceptance in this diagnostic runs an expensive independent whole-snapshot oracle
(about 675–792 ms per delta), explicitly reported separately. This proves equivalence and
transactional ownership; it is neither a production semantic validator nor packaged freshness
evidence. At that checkpoint, cross-process acknowledgement/base-token binding, bounded
resync/compaction, cooperative production validation and full-root consumers remained open.

## Request tokens and acknowledged publication

The experimental wire is now `manuslip-packed/2`. Each receiver request has a fresh UUIDv4,
independent of source hashes and sequence counters. Responses echo that token and carry a
separate fresh result token. A receiver advertises its accepted identity/token as the next
request's base; deltas must match both before binary consumption. A full result must also
advance the accepted token. This prevents repeated sequence/identity values from identifying
an unrelated request or cached base. Version 1 envelopes are rejected.

`packing-exchange.ts` validates exact, bounded, copied/frozen request and accepted-receipt
schemas. `PackedPublisher` manages one pending offer against a borrowed session, checks its
actual prepared source object, and commits only after the matching sequence, complete result
identity, request token and result token return in an acknowledgement. An outgoing buffer
must have transferred before that commit. A delta additionally requires the exact last
acknowledged source object to remain current; reconstructing an equal identity cannot supply
that ownership. Source/hash equality alone never authorizes delta reuse.

Cancellation detaches an escaped unsent buffer before discarding its reservation. A late
receipt cannot commit a replacement offer; cancellation of stale work preserves a newer
session request. Lost acknowledgements leave sender and receiver with different base tokens,
so the next delta is rejected and the controller must send a full resync. Reset/disposal
release pending metadata and acknowledged-source pins. The caller must finish or cancel an
offer before otherwise mutating its borrowed session. Independent native construction
outputs remain caller-owned and must stay charged until their uses end.

Receiver metadata slots, publisher metadata, copied request/wire/receipt metadata, outgoing
buffers and acknowledged-source ownership participate in the existing ledgers. Full
projection histories exercise this path against independent fresh complete oracles, retaining
all original captures. Ten publisher/exchange cases also exercise actual MessagePorts,
replayed receipts, lost acknowledgements, cancellation, eviction, independent equal sources,
external invalidation, missing reserves and disposal. Together, 456 focused cases pass;
the complete suite passes 5,038 tests with one platform skip. Static checks pass.

The exact nested diagnostic also routes requests and accepted receipts across real
MessagePorts and records sender ownership before acknowledgement commit. It separately
checks real GC of disposed publishers, their sources and owners while disposed handles or
escaped messages/tickets/receipts remain live. See the current measured checkpoint in
[VALIDATION.md](../validation/implementation-history.md). This experimental state machine still needs application
service/watchdog integration and a complete cooperative production semantic validator.

## Cooperative receipt lifecycle

`PackedReceiver.receiveSteps` now returns a revocable scheduler handle. It checks the wire
and source/base binding, admits the incoming buffer/normalized metadata/control slots, and
transfers the buffer into receiver ownership before returning that handle. The caller's
original wrapper is detached; later envelope mutations cannot change the admitted response.
Rejected envelopes, unavailable bases and failed admission still leave the buffer untouched.
This closes the otherwise uncharged interval before the first scheduled step. The original
wrapper's conservative incoming charge covers the moved buffer through arena preparation.

The first step yields before binary preparation and the next yields before validation. A
validator may finish synchronously or return a synchronous iterator yielding only `undefined`.
Validation resumes through the scheduler; only complete successful validation and cleanup
can commit and return the accepted receipt. Promises, async iterators, malformed steps and
non-void return values fail without publication. `receive` retains its explicit synchronous
contract and rejects a validator requiring cooperative execution.

`PackedWork` closes the request even if returned/thrown into before its first advance.
Cancellation, replacement, eviction and disposal immediately revoke suspended inspections
and readers, release holds and sever scheduler-handle references to the receiver. Reentrant
cancellation waits for the running generator to unwind before calling its `return`; it
does not invoke `return` on an already running generator. Cleanup cannot create fresh work
during eviction/disposal. A stale failure/cancellation cannot erase a newer request.

The renderer's existing `SlicedWork` accepts this structural next/return contract; its runtime
scheduling behavior is unchanged. Integration cases use that actual scheduler for completion,
cancellation, invalidation and cancellation before first run. Further lifecycle cases cover
every suspension boundary, active nested iterators, reentrant validation, cleanup failures,
budget rejection, explicit resync and detached/copy-frozen queued input. GC probes retain
closed queued handles and escaped readers/tickets/envelopes while checking source, receiver
and validator-context collection both before first advance and after validation has started.

This supplies interruptible receipt lifetime, not a complete production semantic validator.
Binary admission/preparation, source checks and any individual validator step remain
synchronous. The diagnostic oracle yields per field/element but can still decode a whole
large scalar in one step. Its recorded step/slice maxima must not be confused with its 1 ms
scheduling target or the packaged <4 ms apply gate. Production validation must bound those
operations and its own scratch/continuation state, then connect actual service/watchdog and
all full-root consumers before activation. Current results are in
[VALIDATION.md](../validation/implementation-history.md).

## Bounded scalar streams

`PackedReadScope.textSteps` now opens an admitted, revocable text reader. Each advance emits
at most 4,098 UTF-16 units or `undefined` progress. The decoder scans at most one 4,096-byte
JSON/UTF-8 lexical batch per advance, including whitespace-only padding and discarded
prefixes. It preserves lone surrogates, supplementary characters and JSON escape state;
piece slicing uses exact UTF-16 offsets. No complete decoded string or final join is needed.
`textStepCost` verifies string kind and returns fixed costs without scanning a piece table.

Persistent text uses four LRU decoder/last-chunk slots. This reuses an original stream around
ordinary insertions without retaining one decoder per arbitrarily many pieces. Backward
and evicted-record reads may rescan, but each discarded-prefix batch yields progress rather
than hiding a whole scan inside a single advance. Piece transitions yield too. Short arena
strings remain bounded by their existing cache admission. The legacy whole-scalar API and
its caller-owned output admission remain available and unchanged in behavior.

The conservative fixed costs are 8,228 bytes of output and 305,168 bytes of workspace. An
open session reader reserves both plus its 512-byte control slot: **313,908 weighted bytes**.
Caller limits, session retained capacity, reader count and aggregate live stream staging
must all admit before decoding. `readerStagingBytes` exposes that live staging reservation;
subsequent arena/preparation work only receives the remaining staging capacity. Earlier
emitted strings retained by a consumer need their own independent output admission.

An opened stream owns its scope independently of parent-array item advancement. Return,
throw, early loop exit, capture release and session disposal close it and clear decoder,
view, arena and owner references, including an unstarted generator. Explicit old captures
continue reading through current invalidation/eviction. The exact nested receiver diagnostic
now compares long strings incrementally against its independent full oracle and reports
actual validation-step timings. GC retains escaped closed streams, captures and emitted
chunks while checking arena/source/session collection. Current measurements and full-suite
evidence are in [VALIDATION.md](../validation/implementation-history.md).

These are bounded-work primitives, not a hard wall-clock guarantee or a complete application
semantic validator. Revision transforms, exact source work, whole-document metadata/layout
walks, consumer integration and packaged performance remain activation work. Full consumers
must adopt explicit output ownership rather than accidentally accumulating an uncharged
native string/graph from individually bounded chunks.

## Cooperative arena indexing

`PackedArena.openSteps` now consumes its input by transfer before returning a revocable
`PackedWork` handle. Limits are copied. Caller views cannot mutate bytes between validation
steps. Unlike synchronous `open`, malformed input is consumed too; invalid initial limits
reject before transfer. No arena escapes until every record, reference, position count,
root and trailing-byte check completes. Synchronous `open` drives the same index validator
and still preserves rejected input ownership.

Long scalar validation consumes at most 4,096 encoded bytes per decoder advance. Short
strings yield after indexing, so many individually small strings cannot hide a large scan
inside one step. Reference lists and ordinary record runs yield after 256 combined work
units, including a single large array. Shape keys also yield while decoding; large native
key assembly has separately admitted complete output/spelling and chunk workspace. Native
string hashing/comparison, key-array freezing and typed-array allocation remain measurable
synchronous operations. This establishes cooperative work units, not a universal wall-clock
bound for arbitrary payloads.

`PackedSession.prepareFullSteps` and `prepareDeltaSteps` reserve queued buffer ownership,
one arena resource entry, outgoing capacity, and 2,048 control bytes plus any copied delta
operation envelope. Index growth is admitted and charged before allocation; the admission
callback rechecks current remaining capacity because other consumers can acquire resources
while decoding is suspended. `preparingBytes` and `preparingStagingBytes` expose the live
reservation. Decoder and copied-operation staging share capacity with open text readers.
Subsequently opened readers must fit the remaining staging too. The completed index moves
directly to an actual immutable arena resource pin before constructing a revision.

Delta identities and bounded operation paths/values are copied before suspension. Caller
mutation cannot alter a pending update. Only one preparation may be live. Return/throw,
request replacement, invalidation, eviction and disposal revoke started/unstarted handles
and release index/buffer/workspace ownership. Direct session cancellation preserves its
request for retry. Receiver cancellation additionally invalidates its request as before.

`PackedReceiver.receiveSteps` now uses these session preparation handles for full and delta
receipts. It still validates the complete prepared snapshot before committing or returning
an acknowledgement. Its synchronous `receive` contract remains explicit. The diagnostic
separates index steps, revision-transform steps, the final publication step, and semantic validation steps;
GC retains escaped closed handles and proves transferred buffers collect during indexing
as well as before start and during validation. Full snapshots no longer require one whole
index scan in a scheduler step. Delta offset/range transforms and their temporary DAG
summaries now yield too, as described below. Complete production semantic validation,
source/metadata/layout work and activation gates remain.

## Cooperative delta transforms

`PackedRevision.applyPreparedSteps` shares ordered operation semantics, complete validation
and admission with synchronous `applyPrepared`. Only fully checked immutable revisions
escape. `PackedSession.prepareDeltaSteps` drives it while keeping the new arena pinned and
reserving cumulative overlay/revision ownership, resource entries, outgoing capacity and
copied operation/control metadata. Growth rechecks actual available capacity after suspension.
The final pin replaces the pending reservation without a scheduler gap. `preparingPhase`
distinguishes `index` from `revision`; all preparation fields clear on completion or revocation.

The position walk yields after 256 direct frame/visit units. When its existing workload
heuristic selects temporary DAG summaries, construction yields after 256 combined record/
reference units, including inside a single wide array. The full table is staged before
allocation. Its min/max bounds preserve exact offset overflow/underflow checks; alias
multiplicity and container depth preserve node/depth rejection thresholds. Unselected
prefixes never acquire selected-suffix range checks. Wrappers combine existing offsets;
immediate numeric range shifts still leave descendant positions untouched.

Range validation yields after each object and within wide field scans. Selected array
iteration also yields after each 256 discarded prefix references. Cooperative path selection
uses these scans for late array entries and wide objects. A linear arena field cursor avoids
repeated field-prefix scans; synchronous field-copy construction uses it too. Every progress
yield is forwarded rather than filtered into another hidden whole-prefix scan. Ordered
operations yield after reconstruction, preserving the preceding operation's path semantics.

Transform scratch shares the aggregate staging cap with live text readers and copied
operations for its entire suspended lifetime. Its high-water reservation is conservative
across sequential operations and releases with preparation. Return/throw, invalidation,
replacement, eviction and disposal close nested iterators and summary builders and drop
temporary tables and overlay ownership. Real GC checks escaped closed work and captures
release arenas, sources and otherwise unreachable sessions during suspended summaries.

The exact nested diagnostic reports index/revision/validation maxima and complete scheduled
oracle wall time separately. These work units and development measurements do not establish
a hard wall-clock bound for arbitrary inputs or packaged application freshness. Native index
allocations, large key comparisons, segment/piece metadata copying, ancestor reconstruction,
resource-union scans, exact source checks and caller validator steps still need measurement
and suitable bounds. Production semantic validation and whole-document metadata/layout work
remain activation work; the experiment stays outside application runtime exports.

## Source-bound root and description validation

`validatePackedRoot` checks the pinned parser's concrete mdast schemas directly through
revocable packed scopes. Unknown node types/properties, wrong scalar types, invalid child
categories, malformed math data, inconsistent positions and node/depth excesses fail before
publication. Large math values compare through two fixed-workspace text streams. The
validator does not reconstruct a native tree or decode a whole long scalar.

Sparse line checkpoints store a line and line-start offset per 256 UTF-16 units. Construction
yields after 4,096 units; each lookup scans at most 255 units. CR, LF and CRLF, tabs, astral
characters and lone surrogates preserve the pinned parser's coordinates. Micromark excludes
one initial BOM from its coordinate domain; validation preserves that convention. Existing
block hashes still follow `describeBlock`'s exact raw-source slicing convention, including
BOM input. Consumer/source mapping for that convention remains integration work. Definition
and setext-heading source ranges can overlap. GFM's literal-autolink transform can create
unpositioned text and links; positioned descendants retain nearest-ancestor bounds. A schema
validator must accept those outputs without asserting nonexistent position/disjointness rules.

`validatePackedDescriptions` composes the root walk with metadata checks. Source hash and
parser version must match the independently owned source identity. The complete block list
must match the root's positioned block nodes in traversal order: kind, range, lines and hash.
Source hashes process 4,096 UTF-16 units per advance without allocating slices. The complete
outline must match positioned headings, including depth, range and exact `plainText` spelling.
Heading text compares bounded streams across formatting, code, math, images, links and HTML;
no full heading string is assembled. Character counts match Unicode code points, including
surrogate pairs crossing a batch boundary. Word counts currently receive type and bounds
checks only; exact Intl segmentation remains required. Timing and metadata field schemas
also reject extra/missing/wrongly typed fields.

Reader scopes support copied bounded child paths, key counts and scalar-type reads without
decoding scalar contents. Child item scopes expire with their parent. Temporary validator
workspaces reserve both retained and staging capacity before allocation, consume a reader
slot and revoke with their capture. Validator work handles also consume a reader slot;
captures close them before releasing scratch, including before their first advance.
This drops suspended generator/index/source references even when an escaped handle is
never advanced again. Reentrant revocation defers generator return until the running
advance unwinds. Frame/index reserves and concurrent text-stream costs
must fit both local limits and the session's aggregate ledger. The root wrapper checks
capture liveness on every resumed advance, including nested stream and index progress.
Completion, return, failure and capture/session revocation close all nested readers and holds.

These layers are internal foundations for production validation. They do not prove parser
equivalence, exact word counts, projection HTML or layout semantics. The nested diagnostic
runs them before its unchanged independent fresh parse/render/layout oracle; it reports their
steps, active/wall time and staging separately and checks temporary source indexes collect
while captures and completed work remain live. Receiver and standalone cancellation probes
keep closed work, revoked captures and disposed owners alive while checking sources, index
builders and completed indexes collect. Reader path resolution, segment-metadata copying and
native/control operations still need bounds and packaged measurement. Application activation
requires the complete semantic validator and the remaining gates below.

## Cooperative capture array reads

`PackedReadScope.elementSteps` exposes capture-owned array cursors that return either a
guarded item or undefined progress. Discarded prefixes yield after at most 256 arena record
references, including slices that begin near the end of a large base array. Every segment
boundary yields too, so empty segments cannot hide an unbounded run. No reference-ID list
or native array is expanded. The same `elementSteps` implementation now serves view readers
and delta transforms; the traversal module re-exports it. Ordinary `elements` remains an
explicit synchronous contract through the same guarded cursor lifecycle.

Every advance expires the preceding item, including progress advances. A nested iterator
opened before expiration owns its view independently; capture release still closes both.
Admission consumes one existing 512-byte reader slot before creating the iterator. Closing
before its first advance, during discarded-prefix progress or with a selected item clears
raw views/generators and releases the slot. Escaped item/child scopes remain guarded.

Root traversal, block and outline metadata iteration, table alignment checks, math data and
streamed heading plaintext all forward cursor progress. Progress does not count as a node or metadata
entry. Tail checks drain progress before deciding whether an extra entry exists. The
independent nested diagnostic oracle also forwards array progress without dropping any
comparison. A legitimate unchanged 3,000-heading parser result, split into lazy segments by
no-op operations, verifies complete validation and cancellation while all three large arrays
scan their prefixes. Original captures remain readable.

Math's singleton child arrays and two class names also use scoped cursors rather than
numeric path selection. A small resulting array can retain an arbitrarily late base slice;
its logical cardinality does not bound the cost of looking up index zero. Five cases insert
then discard a 20,000-entry prefix while restoring the exact inline/display math data from a
fresh parser result. Child cursors stay open through nested schema/text checks and close on
every exit. Text equality can compare two guarded scopes through the same admitted streams.

This closes a hidden synchronous prefix scan inside cooperative validation. Synchronous
path selection, segment/wrapper metadata construction, whole-root traversal costs, exact word
counting and projection semantics remain separate work. In particular the parser's complete
Intl word count cannot be replaced by unproved chunk sums: word-like classification permits
[locale-sensitive implementation behavior](https://tc39.es/ecma402/#sec-createsegmentdataobject).
The complete segmentation spelling and runtime behavior must remain equivalent to the parser.
These internal readers do not activate the packed transport or establish packaged timing gates.

## Exact packed document word counts

`validatePackedDocument` now composes root/description checks with
`validatePackedWords`. The latter preserves the pinned parser's exact preorder of mdast
`text` leaves, including empty values, inserts one ASCII space between every pair, and
passes the complete string once to `Intl.Segmenter(undefined, { granularity: 'word' })`.
It counts only `isWordLike` results. Inline code, math, HTML and image alt values contribute
only when the parser actually represents them as mdast text children. Chunk segmentation
or an assumed locale-independent boundary rule would change parser behavior and is not used.

An iterative guarded scan computes the complete prose size before constructing it. A
second traversal reads each text through the charged bounded decoder. Both passes forward
array-prefix and text-decoder progress, enforce node/depth limits and keep child scopes
alive until their streams close. Collection flushes bounded pieces into chunks; admission
accounts for piece/chunk metadata, simultaneous joins, full prose, native segmentation
workspace and a largest segment. This remains a conservative weight model requiring real
runtime heap calibration. It is not a claim about ICU's undocumented allocation behavior.
The whole prose reservation and live stream workspaces count against both session retained
and staging budgets. Capacity failure occurs before prose allocation or publication.

Capture-owned work and workspace holds unwind on completion, error, return, capture
release or disposal, including reentrant release from the internal diagnostic phase observer.
Exact count failure reaches the receiver before commit or acknowledgement; its earlier
current snapshot and captures remain intact. A failed receive can be retried with a fresh
ticket. The standalone word layer checks its source/parser identity and word-related fields;
the composite also validates character totals, all document fields, root schema, positions,
blocks and outline. These checks establish internal field consistency with the supplied
root, not proof that arbitrary root text is equivalent to a fresh parse of the source.
Projection semantics and full parser equivalence remain separate requirements.

The final string join, creation/initialization of the native segmenter and each native
segment iterator advance remain synchronous. Yielding between iterator results does not
bound an individual call's wall time for arbitrary Unicode input. They must be measured
and moved off the renderer or otherwise bounded before activation. Full validation still
walks unchanged nodes multiple times; safe reuse of verified immutable subtrees is needed
to meet the freshness target without weakening validation.

`test/benchmark/profiles/profile-packed-words.mjs` separately exercises the exact nested corpus with a
64 MiB renderer ledger and 8 MiB staging. The existing 16 MiB diagnostic and its checks are
unchanged: whole-prose validation does not fit its previous peak with old captures retained.
The new run validates a full document/projection/layout envelope's **document** and rejects
an incorrect in-range total with the original capture retained. It does not add projection
validation or activate runtime transport. Eighteen GC probes keep closed work/captures
unadvanced while checking arenas, source wrappers, prose buffers, native segment objects,
iterators and otherwise unreachable owners collect. Phases include partial decoding, joined
prose, native iteration and completed work, with and without retained disposed owners.
Exact measurements and limitations are in [VALIDATION.md](../validation/implementation-history.md).

## Packed projection fields, layout and supplied widgets

`validatePackedProjection` now checks the exact projection/layout field sets without
materializing HTML or a native root. It binds the capture to its immutable source pointer,
the current renderer version and the exact request options. Array cardinality, finite
timings, string bounds, integer ranges and widget ordering are checked explicitly. A
composite `validatePackedSnapshot` additionally requires precisely document/projection/layout
fields and completes the existing document/count checks before projection checks. These
helpers remain internal and do not activate runtime transport.

Layout spans correspond one-for-one to top-level root children. Pinned handlers omit
definitions, footnote definitions and frontmatter; our HTML override emits visible content
in either raw-HTML mode. Omitted spans anchor exactly at the previous visible end. Visible
spans start at zero or exactly one newline after the previous visible span, and the last
ends at `bodyEnd`. A forward-only HTML cursor checks those actual newline code units and
consumes the complete HTML through charged bounded decoder chunks. A footer, when supplied,
starts after a newline. No large HTML scalar is decoded or joined by the validator.

Every supplied widget must have a unique ordered source range and allowed kind. Table/image
values are empty. Other values are copied into private UTF-16 arrays after preflight of
the complete comparison footprint. A bounded iterative walk of the packed root matches
each supplied range, its actual node kind (including Mermaid and image references), and
every value code unit. This catches plausible same-length forged values and in-range
forged source ranges without hashes or native mdast expansion. Unused footnote content may
legitimately have no rendered widget; supplying a widget still requires an exact root match.

Map metadata, comparison arrays, traversal frames and simultaneous decoder workspaces are
charged against the aggregate session retained/staging limits. Both preflight/copy passes
and the root walk forward array/text progress; capture release, cancellation and errors
close all cursors and discard the map. Native array allocation and cleanup are synchronous
and still require packaged calibration and timing measurements.

This establishes field geometry and **supplied** widget consistency. It does not prove that
all expected widgets are present, that widget/full HTML equals rendering the root, or that
footer contents resolve the correct definitions and numbering. Renderer equivalence remains
a separate activation requirement. Serialized HTML remains untrusted and must pass the
existing sanitizer before every DOM sink. The Node/Vite ownership/large-document diagnostic
is `test/benchmark/profiles/profile-packed-projection.mjs`; its observations and all remaining gates are
recorded in [VALIDATION.md](../validation/implementation-history.md).

## Sequenced rendering and transient native inspection

`ProjectionSequence` establishes a renderer path that accepts a native definition context
and one top-level native block at a time. It captures the pinned renderer's **public**
handler `State`, uses its public `one` method for each block, and preserves first-definition
maps, footnote order and repeated-reference counters. A final public root handler supplies
that accumulated state to `toHast`, which generates the footer exactly once, including
calls discovered inside footnotes. No private compiler import or duplicate footer algorithm
is introduced. Completing, abandoning or failing a conversion closes the sequence.

The full renderer and this path share the existing HTML override, URL policy, widget
extraction and serialization through `projectionOptions` and `projectHast`. Independent full
renders verify complete HTML, all widget fields and exact layout spans across both pinned
CommonMark modes and global-definition/footnote cases. Inputs are deeply frozen in these
tests. The sequence holds native context only; its caller must admit immutable input,
HAST/serialization work and outputs. It does not own a packed snapshot or activate transport.

`inspectPackedNative` provides cooperative transient native input for that future adapter.
It first measures the selected packed subtree without decoding strings, then admits output,
frame and collector storage before copying. Arrays forward discarded-prefix progress;
strings use bounded decoder/collector chunks. All objects, arrays and points are frozen,
hostile property names remain own data properties, and current lazy positions stay exact.
The copy remains charged through the inspector's entire generator lifetime. Closing the
work, releasing the capture, expiring a borrowed item or throwing from the inspector drops
the copy and every reader/workspace. Inspectors are trusted internal consumers; native
outputs cannot escape without separate ownership. Existing synchronous native consumers
have not been migrated by adding this helper.

Collector scratch accounts for chunks coexisting with the separately reserved final native
string; it does not reserve unrelated ICU storage. Decoder readers charge themselves, and
local preflight includes that simultaneous decoder charge. An exact staging-boundary test
rejects one byte below the combined requirement and admits the complete requirement while
checking every suspended step. Native final joins, allocation/freezing, renderer calls and
footer generation remain synchronous and require measured bounds or off-thread work.

These pieces do not yet compose into a complete packed renderer-equivalence validator.
Remaining work includes cooperative context collection with shared ownership, admission of
native context plus one block and generated HAST/output together, exact packed HTML/widget
comparison and cancellation throughout that composition. Native diagnostic oracles are
outside the application ledger and cannot establish those bounds. Timing and ownership
evidence is in [VALIDATION.md](../validation/implementation-history.md).

## Capture-owned definition and footnote context

`inspectPackedProjectionContext` now collects native renderer context from the packed root
under one capture-owned reservation. A guarded iterative traversal selects outermost link
definitions and complete footnote definitions in parser preorder. Definitions inside a
footnote remain in that copied subtree, where the public renderer discovers them in their
original order. The outer traversal does not copy them a second time. Ordinary prose values
are never decoded for context collection.

The first pass measures all selected native subtrees together, including strings, points,
object/array metadata, copy frames and the largest simultaneous collector/decoder. Node,
depth, field-count and aggregate retained/staging checks apply before construction. The
second pass copies immutable context through the same cooperative native-copy implementation
used by `inspectPackedNative`; the core measurement/copy internals have been factored out
without changing the existing inspector's ownership contract. Both passes forward lazy
array-prefix and text-decoder progress.

The context stays charged through every suspension of its trusted inspector. A separate
block inspector can use the remaining local budget while context remains alive. Competing
context admission cannot invalidate an earlier live inspector; failure unwinds its own
resources, and a retry succeeds after the earlier owner closes. Closing, capture release,
disposal, inspector errors and reentrant release revoke all suspended work and native copies.
Native context or a sequence retaining it may not escape without separately admitted
ownership; inspectors close sequences in `finally` before releasing their context.

All pinned fixtures and duplicate/nested/unused/cyclic footnote cases compare context and
sequenced HTML/widgets with independent full renders. Twelve GC probes retain escaped
closed work, captures and sequences while native context objects, collectors, arenas,
sources and otherwise unreachable owners collect. Observations are recorded in
[VALIDATION.md](../validation/implementation-history.md). These probes do not supply native renderer-state,
HAST/serialization or output admission. Complete packed HTML/widget equivalence and
production integration still require that composition; no runtime path has been activated.

## Capture-owned persistent renderer state

`inspectPackedProjectionState` composes context collection with a separate reservation for
the public renderer's definition maps, footnote order and call counters. The packed context
walk also counts ordinary body footnote references and identifier lengths without decoding
unrelated prose. A cooperative pass over the admitted native context adds nested definitions
and references inside complete footnote bodies. Duplicate/unreferenced entries deliberately
overcount persistent storage; general text and URLs do not inflate that state budget.

The complete state reservation is admitted before initializing `ProjectionSequence`. It
includes the second state created by the public footer API, simultaneous definition maps,
key copies and uppercase identifier expansion. Both local limits and the session's aggregate
workspace limits apply while context remains charged. The sequence closes in `finally`
before releasing either reservation, including abandonment, inspection errors and reentrant
capture release/disposal. Request options are copied and bound to the exact source identity
and pinned renderer policy before construction.

This remains an internal trusted inspector. Its rendering contract is this capture's body
at most once followed by its footer at most once; injecting arbitrary native blocks or
replaying blocks is outside that contract. Native blocks, generated HAST and serialized
output still need their own simultaneous admission before this becomes the complete packed
renderer-equivalence validator. Full document/schema validation must precede composition.
No production consumer has been moved to this path.

Tests compare complete sequenced HTML and widgets with independent full renders, reject
insufficient state budgets before renderer map allocation and preserve earlier suspended
state after aggregate admission failure. Sixteen GC probes retain closed work/captures and
escaped sequences unadvanced while the actual public handler states, maps/counters, native
context, collectors, arenas and otherwise unreachable owners collect. In-memory diagnostic
instrumentation observes the documented public handler argument and does not modify app
source or import compiler internals. Native roots and HAST/output oracles remain outside the
state ledger. Timing, memory weights and remaining activation limits are documented in
[VALIDATION.md](../validation/implementation-history.md).

## Capture-owned HAST and serialized output

`inspectPackedProjectionOutput` now consumes the packed root through one forward-only
body cursor. Each block has an admitted immutable native copy while the global context and
renderer state remain charged. Public `state.one` wrappers reserve weighted construction
storage before the pinned handlers run; the footer reserves its scaffolding/backlinks
separately because the public compiler constructs those outside `state.one`. Reference-key
lookup, URI normalization/policy scratch, line-fragment arrays, table-cell padding and the
second footer state participate in admission. The inspector receives only each finished
block's output and the final footer, so it cannot replay arbitrary blocks into shared state.

Native copying now releases its completed collector/copy-frame reservation before entering
downstream inspection. `copyStagingBytes` reports that earlier reservation, while
`stagingBytes` reports the settled immutable input plus inspector bookkeeping. Peak preflight
still includes the independently charged decoder. A capture-owned workspace grows in 64 KiB
increments, rolls back partially admitted increments on error and closes on every exit.

After construction and URL policy, a cooperative planner measures the actual HAST. Literal
scans yield at most every 4,096 UTF-16 units. The serialization reservation includes the
HAST, description/result maps, complete HTML, all widget serializations including overwritten
code/pre results, sibling and attribute strings, entity replacement and recursive joins.
Actual HAST depth replaces the construction depth allowance only after planning finishes.
The pinned HTML serializer runs after that complete reservation is admitted. The full and
owned paths share widget descriptions, URL/image policy and the same public serializers;
independent full renders check complete HTML, widgets and layout spans.

These are weighted admission rules, not calibrated bounds on native V8/URL/regexp heap
allocation. Full document/schema validation must precede this internal path; arbitrary
custom HAST/data/handlers are outside its contract. Native handler, policy and serializer
calls remain synchronous, as do some per-node allocation scans. Trusted inspectors may
suspend while input/HAST/output remain charged, but cannot retain outputs beyond the scope
without another admitted owner. Cancellation closes work and clears the sequence's admission
callbacks as well as its state/context.

Twenty-seven output tests include all pinned CommonMark cases in both syntax modes,
extensions/global notes, a 400,000-unit widget, pre-serialization rejection, partial workspace
rollback, aggregate rejection/retry and real lazy-suffix cancellation. Eighteen probes check
collection of actual native input, State/maps/context, HAST, output metadata and all related
ownership resources while closed handles remain retained and unadvanced. Timing and
limitations are in [VALIDATION.md](../validation/implementation-history.md).

This supplies the owned recomputation used by the exact comparison below. It repeats all
unchanged work: the output-only nested diagnostic takes over four seconds. Verified reuse,
full production/service ownership, resync/compaction, heap calibration and packaged
performance/release gates remain required before activation.

## Exact received renderer output and ACK gating

`validatePackedSnapshot` now composes complete document/count consistency, strict projection
schema/geometry and supplied-widget/source checks with `validatePackedProjectionOutput`.
The latter renders from the validated packed root under the owned output path. It compares
every UTF-16 unit of full HTML, every serializer span and visibility bit, and every widget's
kind, range, HTML and source value. It rejects missing, duplicated or extra widgets, including
source-valid widgets in unused footnote definitions. A schema-consistent root still does not
prove equivalence to a fresh parse of the source; that remains an independent gate.

One forward HTML cursor spans all body outputs and the footer. Separators and `bodyEnd`
must match actual renderer output; supplied layout alone cannot authorize arbitrary HTML.
One additional temporary cursor compares each widget's HTML or value without concatenating
or slicing decoded strings. Both decoder reservations are subtracted before native rendering
is admitted, along with comparison maps and index storage. Equality advances compare at
most 4,098 UTF-16 units, preserving lone surrogates and chunk boundaries.

Footnote widget output order can differ from source order. `PackedCapture.inspectArray`
builds one admitted, cooperative private view index rather than repeatedly traversing lazy
array prefixes or keeping a live reader per widget. Lookup scopes reference a revocable
index; closing it drops raw views and all owner/capture callbacks. An escaped closed scope
cannot keep an otherwise unreachable live owner alive. Index construction forwards lazy
discarded-prefix progress and is bounded by item count and explicit workspace admission.

When this validator is provided to the experimental `PackedReceiver`, a prepared result
cannot commit or return an acceptance/ACK until all exact comparisons finish. Same-length
HTML forgeries, missing widgets and shifted-but-geometrically-valid spans fail; cancellation
during body/widget/footer comparison discards the prepared result. Existing captured
snapshots remain immutable/readable and a correct retry succeeds. Incoming-buffer ownership
remains charged through validation, including the existing conservative double charge.

The composed diagnostic runs actual receipt and replacement with an old capture retained
for the exact nested, notes and 800,014-byte widget fixtures under unchanged limits. Twenty-one
GC probes cover queued/indexing/HAST/comparison/completed work and otherwise unreachable live
owners. Timing and evidence are in [VALIDATION.md](../validation/implementation-history.md). Nested receipt still
takes about seven seconds; this is a correctness/ownership checkpoint, not an activation
or freshness pass. Production transport, DOM sinks and the installer remain unchanged.

## Remaining architecture work

The native-copy CPU checkpoint now reuses an existing view for an empty path, borrows short
strings already owned by the validated arena index, and batches at most 16 new generic value
visits. Long/edited strings still stream; array advances and discarded-prefix progress are
not batched. Full native output admission, per-node limit/admission checks and immutable
results are unchanged. A real edited short string confirms that the borrowing path cannot
return stale arena text. Recursive completion is bounded by the existing depth limit rather
than the 16-visit batch alone; this is not a universal wall-time guarantee.

The exact nested snapshot validator now uses 2,805,509 advances instead of 4,332,855, and
receipt takes about 4.34 seconds in the composed development diagnostic. All 21 composed GC
probes and the full 5,503-test suite pass. At that checkpoint every unchanged block still
got visited, copied and rendered. CPU profiles and
updated receipt/memory observations are in [VALIDATION.md](../validation/implementation-history.md).

The shared-projection checkpoint adds `PackedProjectionBaseline`, created only after complete
snapshot validation. It borrows a live same-owner capture and owns admitted source-free
record/layout/widget metadata. Exact shared immutable records plus supported lazy position
shifts allow reuse; link/image references also require the same complete ordered definition
context. Definitions and footnote-call blocks retain normal stateful rendering. Unsupported
transforms, changed records/context, different owners and new full-resync arenas fall back.
The new document/root/count/hash/geometry checks still run completely. Reused HTML is compared
unit-for-unit through two admitted forward cursors, and widgets require exact shared record
identity with the corresponding range shift. All supplied widgets must remain accounted for.
Capture release or owner disposal revokes the cache and its persistent metadata reservation.

The actual eligible nested heading edit uses a 794-byte delta. In the sequential development
diagnostic, validation with reuse takes about 2.08 seconds versus 4.87 seconds for complete
recomputation of the same prepared snapshot. Only the edited heading and definition convert.
Initial full validation plus cache construction still costs about 4.89 seconds. All 13 new
GC probes and the existing 21 ownership/receiver probes pass, including escaped source-free
keys and an otherwise unreachable live owner. A receiver test rejects forged reused HTML
before ACK, preserves the old capture and accepts a retry. See [VALIDATION.md](../validation/implementation-history.md)
for exact costs, corpus identities, evidence and limits. This certificate establishes reuse
of previously verified projection output; it does not establish fresh-parser equivalence,
production integration, a calibrated heap bound or packaged freshness.

The following allocation/scheduling checkpoint keeps every complete validation pass but
checks child/position field presence without copying key lists, prepares pinned schema
tables once, and unwraps shifted scalar/string/key reads without temporary cursors. Exact
word validation borrows already admitted short arena strings, while edited/long text keeps
streaming under the full prose reservation. Native segment iteration is bounded to 16 calls
per advance; this is not a bound on native-call duration. Own/inherited fields, lazy transforms,
revocation, edited text, Unicode counts and counting cancellation have direct tests. The full
5,527-test suite, static checks, desktop bundle and 34 combined ownership/GC probes pass.
The unprofiled nested-edit validator now takes about **1.64 seconds**, with **1,167,825**
advances; initial certification/cache creation still takes about **4.36 seconds**. Profiling
and exact admission observations are in [VALIDATION.md](../validation/implementation-history.md). Whole-document
root/count/context walks and all production activation gates remain open.

The context-pruning checkpoint now uses the sealed baseline's full absence proof to avoid
descending through shared subtrees with no definitions or footnote calls during either
context pass. Link/image resolution still depends on the complete ordered definition identity
for output reuse. The proof carries exact logical subtree nodes/depth, which remain charged
against the current limits. Changed overlays and unsupported cases scan normally; complete
document/root/source/count validation remains mandatory. Per-root metadata admission increases
from 1,024 to 1,280 bytes before allocating the new frozen summary. The independent context
values/costs and exact limit boundaries match, including changed nested definitions and
revocation during actual pruning.

The nested-edit development validator now uses **752,157 advances** and takes about
**1.22 seconds**, versus 1.64 seconds before pruning. Across both context passes, 12,596 proof
hits account for 226,728 logical nodes without physically revisiting them. The complete
5,534-test suite, static checks, desktop bundle and 36 combined ownership/GC probes pass.
Initial cache construction peaks at 8,228,352 staging bytes, leaving just 160,256 bytes below
the unchanged 8 MiB cap. Capacity failure must keep explicit fallback. CPU samples now place
schema/descriptions and exact word validation above context work. See
[VALIDATION.md](../validation/implementation-history.md) for corpus identities, costs and profiling limits. Freshness,
source/parser reuse proofs and production activation remain unfinished.

The document-subtree checkpoint adds `PackedDocumentBaseline`, built after complete document
validation including exact word counts. It borrows a live same-owner capture and admits
source-free record/source-interval, logical traversal, source-length-minimum and descriptor
cursor metadata. Reuse requires an exact immutable record and supported position shift,
valid current root anchors and exact source units, including BOM/raw descriptor spelling.
Source-length minima preserve every string/URL/alignment constraint after deletions. Nested
descriptors/headings must match certified records with exact range shifts or receive exact
field/text comparison through forward streams. Missing/extra/forged metadata rejects;
unsupported cases fall back. Complete logical nodes/depth stay charged, while document fields,
character count and the independent complete word-count phase remain mandatory.

Both the current validator and borrowed capture/baseline own active inspections. Revocation
cancels the inspection and cannot produce a success completion value before receiver ACK.
Independent tests cover both CommonMark grammars, LF/CRLF/BOM shifts, source changes, reduced
length bounds, URL allowance, forged metadata, limits, fresh arenas and lifecycle. Actual
successive fragment edits compose both baselines; receiver tests reject forged descriptions
and HTML before ACK and preserve valid retry. The 5,565-test suite, static checks, desktop
bundle and 51 combined ownership/GC probes pass.

The final nested-edit development validator uses **607,306 advances** and takes about
**815.50 ms**, with 6,299 document proofs accounting for 113,365 logical nodes after comparing
1,036,050 source units exactly. The additional document certification/cache initially costs
**1,149.41 ms** and adds admitted retention; both caches plus producer/prepared state peak at
**35,616,201 retained bytes**. It does not establish fresh-parser equivalence or packaged p95,
and still fails the 500 ms freshness gate before producer/transport/application. Exact word
work, initial cache cost, heap calibration and all production activation gates remain open.
See [VALIDATION.md](../validation/implementation-history.md) for source identities, costs and evidence.

Initial/full-resync encoding still traverses the complete graph. Local transactions avoid
that encoding but retain whole-text counting, temporary suffix-summary scans and layout walks. Combined
with debounce, transport and application, freshness remains unproven. Do not activate the
experiment as the completed nested-document fix.

The word-cache checkpoint adds `PackedWordBaseline`, independently certified by complete
word validation. It stores separately admitted prose chunks for exact immutable subtrees.
Private entries replace construction plans with finished output, keeping metadata within
the unchanged 8 MiB admission. Full node/depth and current source-length limits remain;
new records and overlays traverse normally. Every revision still rebuilds the complete
current text-node preorder with separators between empty leaves, then runs one whole-string
`Intl.Segmenter` count. Chunk reuse changes traversal/decoding cost without summing block
counts. Borrowed/current captures both own inspections, and escaped cache getters revoke
without retaining private chunk arrays after close.

Successive real edits compose all three baselines; receiver tests reject forged counts,
descriptions and HTML before ACK and accept retry. The full **5,588-test suite**, static
checks, desktop bundle and **66 combined lifetime/ownership probes** pass. The nested edit
now validates in **197,936 advances / 372.82 ms scheduled wall time**, versus 815.50 ms with
document/projection reuse alone. Word certification/cache creation adds **832.04 ms** and
**6,371,910 admitted persistent bytes**; composed validation peaks at **41,988,111 retained
bytes** under the unchanged 64 MiB aggregate cap. Producer, preparation and validation alone
total approximately **679.30 ms**, so complete freshness still exceeds 500 ms before
transport/application. Initial certification, projection context and other incremental
costs, fresh-parser equivalence, native-output consumers, bounded resync/compaction, heap
calibration, packaged performance and release gates remain open. See
[VALIDATION.md](../validation/implementation-history.md) for source identities, costs and evidence.

The range-preparation checkpoint removes repeated immediate-field scans. Each selected
object's `from`/`to` pair is checked in one forward traversal, yielding after at most 256
fields and between objects while retaining exact ordering, integer/overflow and admission
checks. Producer counting borrows existing short arena strings and avoids copying node key
arrays; complete prose and one whole-string segmentation remain. No persistent cache is
added. New wide-field and cancellation tests pass alongside **5,597 tests**, static checks,
the desktop bundle and **66 lifetime/ownership probes**. The observed producer/preparation
costs fall from **168.62 / 137.87 ms** to **148.74 / 98.83 ms**. Validation stays around
365 ms; the three-stage sum is still **612.80 ms** before transport/application. Separate
producer/preparation CPU modes now make the remaining work reproducible. See
[VALIDATION.md](../validation/implementation-history.md) for evidence and limitations; all activation gates remain.

The first preview-consumer adapter, `inspectPackedPreview`, completes snapshot validation
before copying only semantic descriptors and rendered widgets for the application's existing
`preparePreview`. Full AST/full HTML outputs are absent. Native input has its own retained
reservation, with bounded copy/decoder staging and ownership through suspended inspection;
model/index outputs require a separate reservation and lifetime. Seventeen adapter tests,
the full **5,614-test suite**, static checks, desktop bundle and **83 ownership/collection
probes** pass. The initial nested diagnostic also runs the real occurrence/model preparation,
peaking at **62,867,395 retained / 5,632,150 staging bytes** under unchanged caps. Native input
reserves **19,012,478 bytes** and the consumer **34,410,682 bytes**. Its **4,549.98 ms** total
includes complete uncached validation; it leaves only **4,241,469 retained bytes** of headroom.
Old/new model and cache overlap, persistent model ownership, DOM installation, counts/outline,
translation and other full-root consumers still require integration and proof. The production
controller does not import the adapter. See [VALIDATION.md](../validation/implementation-history.md) for exact scope,
corpus identity and evidence; no activation or complete freshness claim follows.

The preview input also carries complete ordered headings, exact counts and parse/render
timings under the same measured native reservation. Application preparation returns counts
and headings with the prepared widget model; the production controller publishes that status
after occurrence commit. Native snapshots and the experimental adapter share this preparation
contract. All **5,619 tests**, static checks and the desktop bundle pass; **23 updated preview
collection probes** include partial long-heading copying. The unchanged nested diagnostic
peaks at **62,868,451 retained / 5,632,150 staging bytes** and takes **5,299.80 ms** including
uncached full validation. Persisting status/models beyond inspection still requires independent
ownership; cache/model overlap and packed production integration remain unproven. See
[VALIDATION.md](../validation/implementation-history.md) for exact artifacts and limits.

`PackedValue` now supplies independent session-owned native output: release/disposal clears
the stored value and accounting callback, while capture closure/base eviction preserves an
explicitly retained result. `preparePackedPreviewInput` transfers this lifetime without a
duplicate full-input reservation. The experimental application's `OwnedPackedPreview` also
admits its actual occurrence/index/model work, compares exact editor source cooperatively,
forks immutable occurrence ranges for replacement and rejects stale or foreign predecessors.
The old model remains usable on candidate failure. Consumers must end native uses before
release or retain independent read-only leases; all raw borrowers must end before session
disposal because JavaScript objects cannot be revoked retroactively. The full **5,644-test
suite**, static checks, bundle build, **17 Electron regressions** and **37 preview collection
probes** pass at the current checkpoint. The earlier cache/receiver collection diagnostics
remain recorded separately in VALIDATION.md. The initial nested model/status remain usable
after capture closure/base eviction with **53,425,496 retained bytes / two holds / zero
readers**, then release to the session's 256 bytes. Peak admission remains **62,868,451 /
5,632,150 bytes**; complete initial preparation takes **4,538.15 ms** in the current development
observation. Large old/new model and cache overlap, actual production controller/service/DOM
integration and activation gates remain open. See [VALIDATION.md](../validation/implementation-history.md) for exact
artifacts, source identity, experiment weights and limits.

An isolated Electron browser fixture installs actual owned packed models into the real
editor and production sanitizer. Independent DOM leases keep a released predecessor charged
while its equivalent widgets remain mounted; async code, math, image and diagram consumers
keep separate leases through completion/cancellation. Actual native data collects after
the final lease ends. Production fixes associate renderer cancellation with reused DOM,
clear unused DOMPurify removal diagnostics and promptly remove cancelled queued code jobs.
That fixture checkpoint used plain-text status and controlled loader/IPC delays;
it did not prove React status acknowledgement, universal capacity admission or packaged
latency. Each lease retains complete input/model resources plus independent handle metadata,
so large old/new/cache overlap remains open. This adds no production packed transport
activation or installer evidence. Exact scope is recorded in [VALIDATION.md](../validation/implementation-history.md).

Production status publication now reserves an independent model/input lease before packed
model commit, with 8 KiB of coordinator/consumer metadata in the same session. A document
admits at most 16 UI consumers and eight retained packed publications. Each mounted reader
acknowledges its version only after a React layout commit; skipped versions remain owned until
all readers advance or unmount. Native/empty publication works at packed capacity, and document
close preserves old ownership until outstanding readers finish. Render attempts acquire nothing.

The shared status hook selects scalar/file metadata without the leased outline array. React
can retain an older store snapshot after commit; passing the full store previously kept an
old outline/heading alive. The outline component now reads rows only during rendering and
its event handlers retain numeric offsets instead of heading objects. Four production status
consumers use the hook. A real React/Strict Mode fixture with delayed notification and an
abandoned suspended render retains all five observed old model/status/outline objects until
the final delayed commit, then collects them. Close/unmount returns its owner to 256 bytes.
Controller tests also prove suspension retention and native fallback when publication admission
rejects before packed model commit. This verifies bounded production status handoff; ordinary
semantic JSON transport, aggregate calibration and large old/new/cache overlap remain open.

The session owner, wire receiver and acknowledged publisher now provide admission, envelope,
binding and lifetime primitives. Integrating them into production still requires complete
semantic validation and connecting these primitives to actual service requests. Unknown/evicted
bases, mismatches or unsupported changes
must request full resync. Reset on ownership/version changes. Preserve one in-flight request
and one newest pending request, the external watchdog and restart policy. No partially
validated arena may become current. Encoder, decoder, current graph, prepared result, cached
arenas and caller outputs must fit their explicitly allocated budgets together; the 16 MiB
worker cache and 64 MiB renderer budget remain constraints. Calibrate staging/peak weights
and implement compaction or bounded resync. If capacity cannot be established, retain explicit
Source fallback. Old captured snapshots must remain immutable through later edits and deltas.

The experimental context index, local parser and ownership ledger now support bounded block
patches, complete parser-document/projection publication and immutable index maintenance.
Integrate full-root consumers and reduce/interrupt counting, suffix and layout validation when
measurements require it. Preserve first-definition
resolution and context-sensitive numbering. Editing definitions, fences, containers,
frontmatter, table/list structure or any ambiguous boundary must invalidate dependencies or
fall back to full parsing. A source-slice hash alone is insufficient; verify exact source and
the complete dependency identity. See the upstream
[micromark architecture](https://github.com/micromark/micromark#architecture), which explains
why definitions are collected before inline reference resolution.

The current local eligibility rule has bounded complete document/projection sequence coverage,
but still needs production edit schedules and protocol/consumer validation before activation.
Unsupported edits continue through the
full oracle. Keep general syntax/dependency rules, never fixture-specific shortcuts.
Insertion/removal of brackets,
reference definitions, setext underlines, blank lines, lazy continuation, container/fence
markers and EOF transitions need explicit fallback/equivalence coverage. Shifted suffix
positions must remain exact without mutating an older captured root. Native public parser
APIs are preferred; no hidden micromark compiler hook is currently adopted. Full-root HAST
reference resolution remains authoritative for projections.

## Actual Electron reading-worker retained measurements

`test/benchmark/profiles/profile-reading-worker.mjs` compiles the production reading worker in an isolated
Electron fixture. Its diagnostic-only hook exposes numeric stats, explicit clear and WeakRef
counts; it does not expose a root or add production IPC. DevTools measures the actual worker
isolate after forced collection, with the independent native parser/reconstruction/render oracle
in Node outside that isolate. Complete prepared values and successful projections remain equal.

On Electron 45/V8 15.6, the exact 1 MiB nested source retains about 13.4 MB above a warmed
baseline, below its 21.9 MB ownership weight. The 280-unit protected-code fixture retains about
8.1 MB against 18.4 MB weighted ownership, and its complete translation matches native output
in replacement, side-by-side and interlinear layouts. Repeated clear permits all seven observed
plan/root/unit/payload/block objects to collect while the same worker remains alive.

This resolves the earlier component-only discrepancy for these retained cases: compact-plan
heap exceeding its component weight does not imply the combined live worker exceeds its ledger.
It does not establish transient peak, arbitrary corpus calibration, aggregate application
ownership or ordinary packaged workflow acceptance. The initial measurement found full nested
translation failed shared reconstruction even with a separate 32 MiB reconstruction allowance,
while its native replacement projection fit the 8 MiB projection cap. The production follow-up
below closes that reconstruction limit. At that checkpoint both full nested bilingual projections
still exceeded the cap; the indexed follow-up below closes their representation limit.
Exact evidence is in VALIDATION.md.

## Direct translated inline projection

Reading now preflights complete valid outputs/private bindings and logical occurrence output
totals into a bounded index, compact status array and output-reference vector. The public
renderer root handler wraps `state.all` so translated inline children are reconstructed only
while consuming their owning prose node. This includes table cells compiled by tableRow and
paragraphs inside global footnote definitions. Unchanged source containers and position
descriptors stay immutable; no translated ancestor graph is retained. Each temporary unit's
validation/pieces/private-map/children workspace and all index metadata must fit the existing
worker remainder alongside the unchanged rendering reserve. Aliased prose nodes use the
existing path-aware shared reconstruction rather than conflating occurrences.

Every CommonMark case matches independent detached native reconstruction plus whole-root
reading output in all three layouts. Extension tests cover tables, tasks, list tightness,
references, repeated footnotes, protected raw HTML/math/diagrams and packed positions, with
mixed translated/missing/invalid statuses. The exact nested corpus now fully translates all
6,299 units in the actual Electron reading worker: complete output matches the native oracle,
and six observed temporary child arrays/generated text nodes collect while its source plan
remains alive. Weighted direct-projection peak is 1,018,725 bytes within the remaining
3,305,692-byte allowance; its complete replacement projection charges 7,941,406 bytes under
the unchanged 8 MiB cap. The independent old shared-reconstruction oracle still rejects
its full 32 MiB allowance, preserving evidence of the eliminated capacity problem.

At that checkpoint nested bilingual projection limits remained explicit, with replacement retry succeeding.
The ordinary semantic JSON path still prevents that large workflow reaching reading in the
application. This closes direct reading reconstruction capacity; aggregate peak calibration,
large old/new/cache ownership, semantic transport and packaged nested freshness remain gates.

## Indexed bilingual reading projection and viewport

The production reading follow-up now retains large bilingual output as an exact HTML-value
dictionary plus complete row order, pair flags and block-anchor indexes. It serializes one
complete logical row at a time from the same globally resolved HAST, avoiding the flattened
large string in the worker and renderer. Small output retains ordinary HTML. Explicit indexed
admission charges all values/metadata/slots/blocks against the existing 8 MiB cap, and actual
worker messages retain their independent cap. Raw HTML uses its existing whole-fragment path
because tags may span row boundaries. The existing full-root export path remains unchanged.

The exact nested bilingual output now matches the independent native whole-root renderer in
both source-fallback and fully translated modes: all 6,299 visible rows remain ordered with
all source block identities. Three exact row values share storage; the fully translated
projection charges 4,865,718 bytes, versus about 15 MB when expanded. Browser mounting keeps
at most 64 whole rows, reserves viewport/reference metadata and markup in the same 16 MiB
widget budget, measures row heights, preserves block anchors across layouts and resolves
offscreen footnotes with stable per-side ID namespaces. A retained closed teardown handle
must not pin the projection/index/value array. Exact validation and release hashes are recorded
in VALIDATION.md. Ordinary semantic JSON transport still prevents the full large app workflow;
this closes reading representation/viewport capacity without activating that transport.

## Widget descriptors and composed preview ownership

The production owned preview now selects exact widget-range descriptors only after complete
snapshot validation. It preserves source order and all coincident descriptors, leaving the
existing occurrence/model preparation and last-match range behavior intact. Selection metadata
is reserved before allocation. The full native-input adapter remains the default for other
consumers, and the immutable captured document/root still contains every descriptor/node,
position and protected value. Ordinary CodeMirror prose does not need a second widget index.

On the exact nested corpus this removes unused native descriptor copies and occurrence ranges:
31,492 semantic descriptors remain packed, while the widget-free consumer's model/input cost
is 2,180,442 bytes. Its previous native input plus model charged about 53.4 MB. Complete native
widget/status equality passes for both CommonMark grammars and extension/raw-HTML cases.
Malformed unselected descriptors still reject during full validation; real widget-heavy model
capacity still rejects explicitly and preserves the old model.

The composed development diagnostic retains all three validation baselines, the actual nested
fragment transaction, old/new owned previews, independent old DOM/status leases and complete
reading captures. The former all-descriptor model rejects combined admission under 64 MiB;
the selected consumer succeeds. Both complete transferred roots equal fresh parser output,
and the measured weighted peak including handoff is 48,755,110 bytes. This establishes the
tested packed overlap schedule, not native snapshot/service integration, physical peak memory,
arbitrary corpora or packaged freshness. Initial preparation and combined edit latency still
miss activation targets. Evidence and release validation are in VALIDATION.md.

Fragment metadata production can also borrow an already admitted word baseline for its exact
original source object, identity and owner. Exact immutable subtree keys supply text preorder
chunks and logical node/depth costs; replaced children still use the native fragment. Complete
prose, separators and empty leaves are rebuilt and passed to one whole-document Intl word
segmentation, with complete code-point counting. Cache mismatch/closure falls back before
borrowing; revocation during collection or segmentation rejects publication. Bounded borrowed
chunks check both lifetimes, and collection arrays clear before ICU allocation. This adds no
cache admission to the ordinary semantic worker and does not activate packed transport.
The composed development diagnostic's producer is faster; initial readiness, physical memory
calibration, worker cache admission and packaged nested acceptance remain separate gates.

Complete projection-output validation now copies each changed native body block in one
traversal. A capture-owned workspace grows atomically before every allocation and shrinks
after copying, preserving one reader slot and the complete output charge through suspended
inspection. Rounded growth falls back to the exact requirement under tight budgets, including
simultaneous text-decoder capacity. Partial copies remain private; cancellation, failed
admission and expired parent scopes revoke them. All native fields, protected values and
positions remain present, with the existing complete renderer/HTML/widget comparisons.
Callers requiring complete preflight retain the measured copier. Controlled development
profiling improves initial validation; this does not establish packaged nested readiness,
physical peak calibration or ordinary semantic transport acceptance. Evidence is recorded
in VALIDATION.md.

Renderer description, policy, serialization planning and widget bookkeeping now share bounded
traversal batches. Logical limits and allocation admission still run on every visited value.
Planner text work yields within 4,096 UTF-16 units across adjacent strings; raw text preserves
that progress too. Long code-language normalization, URL policy, each widget serializer and
the final full serializer have separate scheduler barriers. The complete original HTML/widget
ordering and admission formulas remain. Native handlers and individual serializers remain
synchronous and require their existing independent limits. Development validation is faster;
full packaged nested acceptance and the other activation requirements below remain open.

The packed unsigned-integer reader now handles one-byte values directly and assembles
continued groups with bitwise shifts, normalizing the final result to unsigned 32-bit.
Canonical spelling, overflow/truncation rejection and exact cursor consumption are unchanged.
An independent arithmetic oracle covers every one/two-byte value, all two-byte prefixes,
width/sign boundaries, every fifth-byte value and seeded arbitrary encodings. This changes
neither the wire format nor index/retained/staging admission. Controlled development validation
and actual Electron reading-worker comparisons pass; the activation requirements below remain.

## Activation gates

Initial experimental preview preparation can reuse the complete validation already performed
by its sealed projection baseline. This requires the exact immutable revision object and
owner, original source object, snapshot path, render policy and valid limits at least as
permissive as those originally validated. Identity fields alone are insufficient. Stricter,
malformed, foreign or changed requests take the existing validation path. The check borrows
no baseline data: an independently live capture keeps the certified revision immutable through
native preparation, and output retains its separate allocation admission and cancellation.
Baseline construction still validates the complete snapshot. Controlled initial-copy timings
therefore exclude that mandatory baseline work and cannot establish application startup or
packaged freshness acceptance. Later-revision subtree reuse and the gates below remain.

Composed construction can build the independently admitted document baseline first. Its
complete validation includes exact word and character counts. Projection-baseline construction
may reuse that fact for the exact immutable document while independently validating all
projection/layout/widget/renderer output; word-cache construction may reuse it while still
planning, admitting and copying every cache entry. The same original-source/revision/owner/
path and non-stricter valid-budget checks apply. Both caches own their output independently
and may outlive a closed document baseline with their own live capture. Later-revision
validation still performs complete current counts; requested word-phase observation also
runs the original phases. No new certificate lifetime, renderer dependency in core, memory
cap or ordinary-worker admission is introduced.

The isolated Electron renderer memory diagnostic now measures the actual packed session,
all three caches, owned preview and complete root serialization, using transferred fixture
buffers and a separate Node parser oracle. Retained checkpoints stay below their ownership
estimates for the tested nested/widget fixtures; closing caches and cancelling partial native
chunk construction release watched objects while closed handles remain retained. Periodic
samples during construction are substantially higher and vary with GC, including a sampled
increase above 64 MiB in projection-baseline construction. These V8/backing/embedder observations
are a subset of process memory and omit producer, mounted DOM widgets and aggregate ownership.
They establish neither a portable peak bound nor production admission. Preserve the existing
caps and the remaining calibration/integration requirements below.

Atomic arena queries now reuse a private reader cursor after validating the record reference.
Streams retain independent cursors across yields; full-encoding copies and position summaries
remain independent of the shared cursor's current position. A diagnostic construction counter
reduces projection-baseline reader constructions from 8,338,400 to 302,325 on the complete nested
fixture. Complete roots and cancellation/collection checks still pass. This reduces transient
cursor creation, but a separate minified run still samples a 77,862,695-byte increase during
construction. Peak calibration and aggregate ownership remain open; this is not activation
evidence and no admission cap changes.

Atomic read-scope path queries also avoid temporary views while retaining guarded lookups on
every read and independently owned streaming views. On the complete nested fixture this removes
2,667,382 view constructions across document/projection/word builders. Complete output and
revocation checks pass, but a repeated minified run still samples a 74,372,535-byte increase.
This is allocation reduction, not an actual peak bound or activation evidence.

Composed child scopes now copy one prefix path and preserve their original guarded lookup,
instead of recreating parent views through closure chains. Projection construction removes
a further 1,527,456 views on the complete nested fixture. Actual Electron cleanup collects
watched resources with eight escaped composed scopes and 72 closed handles retained. Two
minified runs still vary substantially, including an 81,751,975-byte sampled increase during
projection construction. Keep peak calibration and the remaining activation gates open.

Native subtree measurement/copy also use private relative paths through object fields rather
than creating a child scope for every field; array cursors retain independent guarded scopes.
Complete nested projection construction removes 368,458 scope constructions, with unchanged
field-name limits, per-value admission, batching and complete output. Runtime cleanup passes
with escaped scopes retained, but a minified run still samples an 81,440,879-byte increase.
Neither sampled call-site attribution nor lower constructor counts establish a physical peak
bound or production activation.

The document baseline's existing complete summary pass now records whether each top-level
subtree contains definitions or footnote calls. Exact-source/revision/owner/path provenance
and valid non-stricter limits allow projection context scans to skip those absent subtrees,
while charging their complete logical node/depth costs. Full renderer output validation and
independently owned cache construction remain mandatory; closing the borrowed baseline
restores full traversal. Complete nested projection construction falls from 302,325 readers /
1,007,727 views / 705,425 scopes to 100,785 / 377,919 / 277,157. Two minified renderer runs
observe largest sampled increases of 46,578,111 and 49,551,923 bytes; escaped proof callbacks
remain retained through successful resource collection. These isolated V8/backing/embedder
samples do not establish aggregate physical peaks, ordinary semantic transport admission or
the full packaged corpus requirements below. No cap or activation rule changes.

A separate minified OS-process diagnostic now samples Electron process metrics alongside
the renderer isolate data, matching the window's renderer PID and process creation time.
Two cold nested runs observe renderer private-byte increases of 92,778,496 / 92,602,368 bytes
and working-set increases of 91,385,856 / 92,237,824 bytes, while their measured isolate
increases remain 54,215,979 / 53,428,543 bytes. Both preserve complete output and cleanup.
Private commitment, resident working sets, shared-page process totals and lifetime high-water
marks are distinct observations. Loader-worker and allocator/process overhead contribute;
producer/oracle and production mounted-widget/worker lifetimes remain outside this diagnostic.
The process increases exceed 64 MiB, so the lower isolate samples do not close memory
calibration. No production admission or activation follows.

Complete schema field checks now match immutable object shapes through a guarded atomic
query instead of exporting a frozen key-array copy. Required/optional own fields, hostile
property names and the original complete key-metadata admission remain checked. The
selected object is resolved before budget getters execute; expired item/capture scopes
still reject. Native consumers that retain a key list keep their independent copying API.
This removes 365,304 key-array copies from the complete nested preparation pipeline, without
changing reader/view/scope counts or complete output. A separate OS run still observes a
93,052,928-byte cold renderer private increase. This reduces temporary allocation but does
not establish a physical peak bound or satisfy the remaining activation requirements.

The existing document summary pass also records link/image reference presence. After exact
document provenance checks, projection-cache classification can use that immutable flag and
the complete node/depth summary for subtrees proved free of definitions and footnote calls.
Reference-bearing blocks still require ordered definition-context verification before later
reuse; other subtrees retain the full classification walk. Closure revokes lookups and
independently live construction falls back. This removes a further 50,385 reader / 157,452
view / 107,067 scope constructions on the complete nested fixture, with complete output and
logical costs preserved. A separate OS run still observes an 88,150,016-byte cold renderer
private increase; full memory calibration and the activation requirements below remain open.

An additional minified diagnostic now includes a real native producer worker in the measured
renderer OS process. It fresh-parses/renders the complete source and encodes under the existing
32 MiB / 800k-visit / depth-512 allowance before a checked, detached transfer. Two complete
nested runs observe private-commitment increases around 343–351 MB, compared with the much
smaller renderer-isolate observations. Parsing alone takes about 1.6–1.7 seconds; producer
completion takes about 2.0–2.2 seconds before document/projection cache construction. A
pending native snapshot pinned beside the complete predecessor is also measured; terminating
its actual worker target preserves exact owner statistics and the predecessor's full root.
The encoder ledger excludes native parser/HAST/input allocation. These broader measurements
therefore contradict treating encoder admission as complete producer memory or readiness
acceptance. Production worker JSON transport and every activation gate remain unchanged.

Native parsing now includes a pinned local backport to `micromark-util-edit-map@1.0.0`.
Its event edit map keeps the untouched prefix in place instead of copying, clearing and
replaying that prefix after each group of edits. The suffix replay and dense event ordering
are unchanged. Both default/development exports have exact source hashes, installation is
idempotent, and lint/build reject an unreviewed version, modified source or missing patch.
See [patch provenance](../patches/micromark-edit-map.md) for the checked fingerprints.
An independent original-parser comparison covers both grammars, every CommonMark case,
extensions, generated sources and both complete nested roots. The Electron producer
diagnostic observes nested parse time around 0.80 seconds and total producer time around
1.25 seconds, with additional sampled renderer private commitment around 333 MB. These
improve the earlier native producer measurements but still exceed freshness acceptance and
do not bound aggregate physical memory. No transport, cap or activation requirement changes.

A second pinned local backport to `unist-util-visit-parents@6.0.2` reuses one recursive
function per traversal instead of allocating and renaming one closure per node. Ordering,
ancestor arrays, predicates, mutation and action/index propagation remain unchanged; error
stacks lose the internal per-node decorated names. The application supplies ordinary data
trees, so accessor side effects used solely for debug naming are outside its contract.
Exact source hashes guard installation/builds; tests compare traversal with an independent
oracle and complete parser/renderer output with fresh original-library processes. See
[patch provenance](../patches/unist-visit.md). Node allocation sampling estimates roughly
129 MB less cumulative parse allocation on the nested fixture. The Electron producer
observes parse/render around 0.75/0.14 seconds and total around 1.18 seconds, while additional
sampled renderer private commitment remains around 330 MB. Cumulative allocation, live heap
and simultaneous process commitment are distinct; all remaining activation gates still apply.

An experimental translation extractor now validates the complete source-bound packed root,
then expands only one eligible prose unit at a time. Native and packed extraction share the
same per-unit projector, privacy bindings, paths, errors and logical aggregate limits. The
inspector's transient native subtree and projection remain charged through suspension;
occurrence IDs remain charged across the complete stream. A trusted inspector must admit
any output it retains beyond its callback. Cancellation closes active iterators and drops
native units, projection arrays and identity sets, including while closed handles stay held.
The complete nested fixture produces all 6,299 units under an 8 MiB staging allowance that
rejects whole-root native expansion. Independent archived-extractor comparison and forced-GC
reachability probes are recorded in VALIDATION.md. These weighted development observations
do not calibrate physical memory. A persistent experimental plan now separately pins the
exact immutable revision and retains frozen occurrence metadata plus canonical provider-safe
payloads. Its metadata allowance is subtracted from extraction's retained ceiling and
admitted in the shared session before retention. An ordered rehydration scan recreates one
unit's private bindings at a time, preserving logical limits without wide-root random scans.
Full nested admission retains 6,299 occurrences with three canonical payloads; actual private
units collect while plans remain live, and release/session disposal revokes suspended scans
and clears metadata/source/arena ownership even while closed handles remain held. These are
weighted development and reachability results. The production reading worker still expands
its complete root; worker integration remains open. A borrowed packed-plan projection now
validates complete occurrence-order output and re-creates private bindings only when rendering
an independently admitted native block. A sequenced reading renderer preserves global
footnotes, slots, all layouts and complete indexed/raw output without retaining a full native
root/HAST. It matches native reconstruction across both CommonMark grammars and both complete
nested roots. These development tests keep HAST/serialization outside the session ledger;
simultaneous construction/serialization/output admission and calibrated memory are still
required before production adoption. Cancellation and release clear live borrowed projection
state; forced-GC probes cover native/reconstructed collection while projections remain live.
Exceptional cleanup now closes all remaining capture work/workspaces and session ownership
before rethrowing the original error. Failed prepared commit cleanup invalidates its candidate
and preserves the previous current revision. Complete nested performance still fails.
An earlier full run recorded an intermittent short-save stress assertion. A separate
deterministic regression now proves that native Save could capture state before pending
DOM input was consumed; saves now await CodeMirror's public measurement boundary before
capture. The rebuilt bundle passes all 73 packaged tests, source stress in the full
performance run and five further stress repetitions. The earlier failure remains archived,
and its precise cause is not proven by the separately reproduced defect. See VALIDATION.md
for the exact bundle hashes and remaining acceptance failures.
This internal API is not exported through the translation package's public entry point and
does not activate semantic transport or change any acceptance gate below.

The internal owned reading consumer now composes complete source-bound validation with
admitted global source/translation states, one native block and reconstruction frame,
paired HAST/policy/serialization, persistent rows and final joins. Replacement output joins
borrowed dictionary values, UUID anchors and fixed markup fragments directly into one flat
HTML string. This removes the earlier complete-row duplication at the shared memory peak.
All reading layouts match the complete nested native oracle, including fully translated
input and separately owned block/envelope metadata, within unchanged 32 MiB session and
8 MiB staging limits. Forty-two forced-GC scenarios verify actual graph release; an
isolated Electron worker provides retained graph samples below the admission weights.
Those samples do not prove transient/native allocation peaks, outgoing serialization,
simultaneous application revisions or portable physical bounds.
The production packed-reading worker now uses this owned consumer and a payload-only plan,
with no complete native root or persistent private bindings. Preparation records/hash work,
render inputs, completed output and outgoing structured-clone scratch share its unchanged
32 MiB session. Cancellation keeps asynchronous hashing admitted until settlement; response
publication releases its output borrow even if cloning fails. Escaped retention callbacks
are revoked without pinning closed source/arena state. Completed native conversions exchange
handler scratch for measured live HAST while preserving both language copies. All three
dense protected-text layouts and complete nested roots in both grammars match full native
oracles through the actual worker wrapper and response publication. Runtime probes exclude
cold initialization and cannot bound transient native/clone allocation or application-wide
ownership; a cold small-case graph-weight mismatch remains recorded. Semantic transport
remains whole-root JSON, and its complete nested acceptance gate remains open.
See the owned packed reading checkpoint in VALIDATION.md for reproducible commands and
remaining gates.

- Prove all existing semantic outputs and complete position-bearing roots equal independent
  fresh parses across CommonMark, extension cases and sequences of edits. Include reference
  definition changes, footnote ordering, duplicates, split/merge, container/fence changes,
  UTF-16/CRLF boundaries, grammar selection changes and fallback/resync races.
- Bound encoder working memory, decoder staging and current/pending/captured graph lifetimes;
  calibrate a conservative admission model with actual packaged runtime observations. Prove
  cancellation, disposal, cache eviction and resync release obsolete arenas/buffers.
- Route every full-root consumer through a bounded representation-aware path. Native cloning
  expands lazy positions: translation/export cannot accidentally create an uncharged full
  graph on the renderer thread. Retain the sanitizer and main-process authority boundaries.
- Preserve actual buffer/envelope caps and source/range checks. Exercise malformed records,
  identity/base mismatches, cache ownership, transfers, late results and failed partial decode.
- Measure all six full packaged corpus shapes, backpressure, 50 MiB boundary, source stress,
  widgets and lifecycle. Require nested Live readiness and complete sample counts, input
  p95 <50 ms, freshness p95 <500 ms, mode p95 <100 ms and apply slices <4 ms on the reference
  machine. Keep real hardware/other-platform release gates separate.
- Only then replace ADR 002's current JSON rule, update dependency/benchmark documentation and
  rebuild/revalidate the distributable. Production reading changes do not activate semantic
  transport; that requires separate recorded acceptance evidence.

The native parser now avoids GFM tokenizer attempts that cannot succeed for the complete
source. Four immutable processor configurations retain every mdast transform and selectively
omit email/table constructs through cloned public micromark extension records. Email guards
retain the original tokenizer for literal `@`, entities or escapes. Table guards retain it
for any pipe or `:-`/`-:` pair, entities or escapes, preserving aligned single-column tables
without pipes. The pinned table tokenizer requires a pipe or an alignment colon immediately
adjacent to a delimiter hyphen; otherwise it rejects the candidate. This is a source-dependent
optimization of equivalent grammar, with complete position-bearing trees compared against
the independently configured full GFM processor. It is not another dependency patch.

The full nested Node comparison records a median parse of 685 ms against 779 ms for the full
processor, and sampled cumulative allocation of 1.206 GB against 1.592 GB. Complete root hashes
and all 31,492 descriptors match. The complete Electron producer still observes approximately
329 MB of additional renderer private commitment, with native parse/render/encode around
603/133/265 ms on its first nested admission. These diagnostic timings and cumulative
allocation improvements do not establish a physical bound, packaged freshness or semantic
transport readiness. All activation gates above remain required. See the tokenizer checkpoint
in VALIDATION.md and the reproducible comparison in docs/testing/benchmarks.md.

A paired pinned native lifetime patch now separates source serialization from each completed
tokenizer's parser/state closure. After micromark resolves all events, mdast's private compiler
retains only source serializers. Both development/default exports are version/hash guarded;
public micromark event contexts, streaming serializer identity and complete parser output
remain verified. Four fresh processes compare exact original/patched sources across both
conditions, with 1,642 complete document/render hashes per process. Retained serializer probes
observe patched tokenizers collect while their serializer remains callable.

Controlled live-graph samples with the complete event array deliberately held through three
GCs observe approximately 56 MB released at compaction. The latest complete producer still
samples 327/316 MB additional renderer private commitment on first/repeated nested admission.
These artificial retained samples and noisy individual process observations establish no
portable physical peak or aggregate ownership bound. Consumed-event truncation was tested
and rejected; it is not part of the patch. All semantic activation gates above remain open.
See [patch provenance](../patches/parser-lifetimes.md) and the native lifetime checkpoint
in VALIDATION.md.

A further pinned replay patch copies completed gap-buffer events directly into the original
ordinary event array, avoiding full replacement-array and chunked-splice scratch. Both
subtokenizer exports retain exact version/source guards. Fresh original/patched comparisons
hold the lifetime patch constant and compare complete roots/renders plus raw event identity,
coordinates, serialization and repeated postprocessing. The nested Node allocation sample
falls about 13%, while the Electron producer still samples approximately 323/316 MB additional
private commitment. This does not establish a physical bound or satisfy the nested Live gate.
No semantic caps or activation decisions change. See
[replay provenance](../patches/micromark-replay.md) and its checkpoint in VALIDATION.md.

Native phase diagnostics now distinguish complete block tokenization from each postprocessing
pass. The full nested graph grows from approximately 99 MB retained heap after block parsing
to 210 MB before the existing compaction, which releases approximately 56 MB. Earlier private
context compaction prototypes preserve the measured complete roots but add Node parse work
and leave the first Electron private-memory increase near 320 MB. They are not adopted.
The reproducible Node phase tool separates forced-GC and natural endpoint observations and
checks both export paths; neither observation mode proves physical admission or application
readiness. See the native postprocessing checkpoint in VALIDATION.md.

The application now opts into private native event-span compilation after all block parsing
and document-wide definitions complete. Balanced top-level spans remain joined while any
forward token link is outstanding, including flow links across outer container boundaries.
Each span is fully postprocessed and list-prepared, then compiled through one persistent
root/data/listener context. Whole-root transforms run once. Only consumed private event
arrays are cleared; the general parser retains its original compiler for other extension
configurations. Both exports are pinned/hash guarded and known previous patches upgrade
explicitly. Complete original/patched roots and renders match in both application grammars.

The complete nested prototype improves median Node parse from approximately 699 to 536 ms,
and its Electron first native parse from 623 to 528 ms, with additional sampled private
commitment approximately 317 to 281 MB. This is a diagnostic observation, not a physical
bound: one container or linked flow can still span the full source. Source/wire/cache caps,
aggregate ownership requirements and packed semantic activation gates remain unchanged.
See [updated provenance](../patches/parser-lifetimes.md) and the native event-span
checkpoint in VALIDATION.md.

A source-shape diagnostic now compares complete approximately 1 MiB single quotes, lists
and inline-rich paragraphs as well as the repeated nested corpus. Each adversarial shape
still occupies one span; the quote resolves 976,854 events. These observations explicitly
rule out treating the repeated corpus's small spans as a native memory bound. The private
compiler now releases its redundant resolved input after list preparation and before node
construction. Complete outputs remain identical, with approximately 7–10 MB lower retained
compiler heap on those single-span shapes. Earlier postprocessing retention remains high
and the sampled first complete nested Electron private increase remains about 285 MB.
This closes redundant input ownership during compilation, not native/aggregate physical
admission or packed semantic activation. See the source-shape/input-release checkpoint in
VALIDATION.md and `test/benchmark/profiles/profile-parser-spans.mjs` for exact methods and limitations.

The completed document baseline now owns admitted typed prefix counts for block and outline
descriptors at each top-level child boundary. This lets fragment metadata locate replacement
intervals using the exact original immutable document proof. Foreign owners, changed source
objects, revisions and paths cannot use the table; closed baselines fall back to complete
descriptor scans. The query returns frozen numbers without retaining the table or owner.
Full changed-native-node checks, current prose/Intl counts and later document/projection
validation remain required. The complete nested diagnostic avoids scanning 31,493 old
descriptors at an additional admitted cost of 50,472 bytes, preserves both complete native
root comparisons, and observes collection of the actual typed backing under 21 lifetime
scenarios. This remains preparatory work for the packed semantic producer; production JSON
transport, native/aggregate memory admission and all activation gates remain unchanged.

Production source character counting now scans UTF-16 numerically instead of materializing
the complete source as a code-point array. This preserves original-source counts, valid pairs,
lone surrogates and every semantic field, while removing that source-sized temporary
allocation. Fragment counts share the helper; cooperative packed validation retains an
independent implementation. Eight isolated counts of the complete nested source sample about
67.1 MB of allocation with the original array path and none with the scan. Complete native
parser/renderer/transfer/cancellation checks still pass, but the first complete Electron
producer continues to sample about 280 MB additional private commitment. This allocation
removal establishes no bound on the earlier parser/postprocessing graph, aggregate physical
memory or packed semantic activation. Reproduction is recorded in docs/testing/benchmarks.md.

UTF-8 size admission now counts bytes numerically with TextEncoder-equivalent replacement
of lone surrogates, avoiding a complete encoded copy merely to obtain its length. A pure
`@manuslip/core/text` export keeps the utility independent of parser initialization. File,
semantic, export, diagram and translation guards share it; editor and replacement preflights
walk the rope directly, preserving exact incremental byte accounting and surrogate splits.
All source/wire/output caps and actual wire encoders remain unchanged. Four checks of the
complete 50 MiB fixture avoid 200 MiB of cumulative encoded-buffer allocation, with a modest
CPU tradeoff in the isolated probe. This establishes the removal of those specific copies,
not a physical bound on JSON spelling, JavaScript string representation, parser/native
graphs or aggregate current/pending consumers. Packaged gates and semantic activation
requirements still apply.

An experimental application `PackedSemanticProducer` now coordinates the full native
parse/layout/encode pipeline with `PackedSession` and `PackedPublisher`. Queued normalized
request/source ownership, cooperative cancellation, outgoing buffer reservation, exact ACK
commit and cached full resync share one lifecycle. A new request revokes earlier queued work
and pending offers, even with repeated numeric IDs; independent old captures retain their
session charge. Native parse/render construction remains atomic and outside those ledgers.
This implements the full-result producer prerequisite, not fragment/delta orchestration or
ordinary worker/service activation.

An actual Electron Worker diagnostic transfers the coordinator's results to a validating
receiver and returns its exact ACK. Five complete 1 MiB corpus shapes, including the
authoritative nested source, complete both fresh publication and cached resync under the
existing 16 MiB worker session and 8 MiB wire/staging allowances. Complete semantic hashes
match independent native output after removing timing fields only. The single-paragraph
receiver exceeds projection serialization workspace; nested receiver validation takes about
20 seconds in the final instrumented run. These are explicit activation failures, alongside
native/aggregate physical admission and unimplemented incremental/controller integration.
No cap, watchdog, packaged performance assertion or production transport is changed. See
the application producer checkpoint in VALIDATION.md and `profile-semantic-producer.mjs`.

Projection equivalence validation now consumes a complete stream of serialized body and
widget HTML. It retains the full native block/HAST policy and description plan, while
reserving bounded text scratch and shallow serializer shells instead of joined body/widget
outputs. Public `hast-util-to-html` still spells attributes, escapes and HTML/SVG shells;
the stream reproduces its pinned default script/style context and schema transitions.
Exact layout ends, footers, widget overwrite/range/value semantics and every HTML unit
remain checked before acceptance. Existing native-output inspectors retain full output
admission. The 8 MiB staging, source/wire/session caps and ordinary JSON worker stay unchanged.
Complete oracle, large-input forgery, cancellation and forced-GC evidence is recorded in
the projection chunk validation checkpoint in VALIDATION.md. This addresses the long-block
serialization copies; receiver latency, incremental producer/controller integration and
native/aggregate physical admission remain separate activation requirements.

The experimental application producer now derives an exact contiguous change from immutable
whole sources and coordinates the existing native fragment, complete metadata/count and
projection patch builders. A delta requires the publisher's exact acknowledged source and
receipt, matching document/generation/parser/renderer/policy and a newer revision. The
dependency index advances into a separately admitted candidate and becomes the accepted
index only after the transferred result's exact ACK. Supersession, cancellation and disposal
release native patches, captures, candidate indexes and outgoing buffers. Unsupported edits
and optional delta capacity failures retry complete native results under the same caps.

Complete serialization now reserves actual admitted workspace growth before allocation,
retaining each pass's high-water reservation until its mapping generator ends. The ceiling,
weights and output admission remain intact. Long unchanged fragment-count text is streamed
into the complete prose spelling required by Intl word segmentation. Neither change trims
semantic content. Cached full resync first releases optional dependency acceleration if
needed; if the overlay plus output still cannot coexist, it evicts the committed cache and
recomputes a full result. Independent old captures remain valid and charged. Recomputed
results report `cached: false` and still require an exact transferred ACK.

This integrates producer delta orchestration, while native builders remain atomic and
outside aggregate physical admission. Complete receiver proof reuse, ordinary worker/service
and controller integration, the five-second watchdog, all six packaged Live performance
cases, and hardware/platform release checks remain activation requirements. Producer-only
exchange or lifetime evidence cannot prove those gates.

The experimental application receiver now owns optional document, projection and exact
word-text certificates on an independent committed capture. Every incoming result still
finishes complete document/count/projection/layout/widget validation before the generic
receiver commits and emits its exact ACK. Shared immutable records may reuse certificate
metadata across successive revisions; changed records and global rendering contexts still
take the complete validation paths. Cache construction is explicit idle work after initial
acceptance. Partial work is revoked by supersession, cancellation, eviction and disposal;
incompatible document/policy identities drop completed certificates. Capacity failures drop
optional acceleration and request resync without acknowledging or replacing accepted data.
Independent consumer captures remain charged and valid until release or owner disposal.

Persistent cache maps, prefixes and word chunks keep their complete retained reservations
during construction. Their bytes no longer also count as temporary staging; traversal and
copy/decoder scratch remain separately admitted. Existing retained/staging ceilings and
per-entry weights stay intact. Six 4,000-block tests check metadata larger than staging,
actual lookup results, cancellation and insufficient retained capacity.

Actual Worker diagnostics build all three certificates for each of the six complete 1 MiB
fixtures, then verify two real edits and an evicted full resync against complete native
oracle hashes. The nested receiver's warmed edits take 316.3/356.9 ms, while its certificate
construction takes 3,631.7 ms. This demonstrates receiver proof reuse; combined producer
and receiver work still exceeds 500 ms in several cases. Cold-path, packaged p95, ordinary
transport/consumer integration, watchdog and aggregate physical admission remain open.

Producer dependency construction now has a capture-owned cooperative API. It yields during
source bracket scans, node traversal, reference resolution and footnote ordering, reserving
metadata and scratch in the producer's existing session before growth. The synchronous API
drains the same implementation. Closing queued/active work or releasing its capture revokes
all readers and partial maps. A completed index transfers from its temporary reservation to
an independent resource hold synchronously. Identifier decoding/case conversion and final
array freezing remain atomic; this local ledger is not a calibrated aggregate physical bound.

Optional producer warmup operates only on acknowledged idle data and never commits or ACKs
an offer. New valid requests revoke partial warmup; malformed requests and ACKs preserve it.
An exact current index is reused, and the next revision's advanced index still becomes the
accepted cache only after its exact transferred ACK. Capacity/unsupported geometry can decline
optional warmup under the unchanged caps. Idle preparation moves cold construction off later
edits, while initial validation and cold readiness remain required.

`PackedProducerHost` now coordinates the producer's real Worker scheduling: one current task,
one deferred callback, two-millisecond batches, explicit cancellation/disposal and complete
buffer transfer before ACK. Deferred callbacks read the current task instead of retaining a
superseded generator. Invalid requests cannot cancel valid work; scheduling, work and channel
failures revoke temporary ownership. The host charges its bounded control metadata within the
same 16 MiB session. Optional diagnostic measurements are disabled by default. The actual
Worker fixture uses this host for all six complete sources, repeated deltas and full resync.
The ordinary JSON worker, service and controller still require integration; host evidence
does not authorize production transport activation.

Receiver descriptor reuse now returns paired valid stream items directly while retaining
separate yields for discarded-prefix progress. Small immutable range shapes use bounded
direct field lookup; arbitrary wide objects keep their yielding field scan. Exact range,
descriptor, semantic and complete native-output checks remain unchanged. The warmed host
diagnostic records nested producer/receiver sums of 430.1/470.5 ms and many-small-block sums
of 485.1/532.0 ms, excluding channel, source admission and consumer/DOM work. Initial work,
packaged freshness, native/aggregate admission and complete release requirements remain open.

### Application transport and consumer checkpoint (2026-10-27)

The experimental path now has a real Worker entry and a correlated control endpoint over
`PackedProducerHost`, plus a renderer `PackedSemanticPort`. Prepare, ACK and cancel controls
carry exact sequence/request tokens. Stale controls cannot cancel a newer offer. Complete
receiver validation finishes before the exact transferred ACK and synchronous borrowed-capture
notification. Malformed active responses fail the Worker; stale responses cannot publish.
Capacity resync is bounded to one full retry. Source-free correlated error envelopes use the
existing application error vocabulary and do not introduce semantic objects on the wire.

`SemanticService` accepts this port with its existing debounce, one-running/newest-pending
backpressure, revision/policy identity, watchdog, bounded restart and explicit retry behavior.
`DocumentPreview` retains the borrowed capture through sliced owned-model preparation and
publishes independently owned model/status resources. Reading receives an independent complete
`document/root` capture, without hydrating the native AST. The window owns the receiver:
restarting/terminating a port evicts current/cache ownership while old consumers remain valid
and charged in the same 64 MiB session. Transport/endpoint metadata also shares the existing
renderer/producer allowances. Consumer setup capacity errors return Source with a limit status
without restarting the Worker; invalid preparation reports a parse error.

Receiver certificate warmup starts explicitly after consumer preparation. Automatically warming
immediately after receipt competed with native model preparation for the same staging allowance.
Optional warmup can decline capacity without invalidating an accepted publication. Snapshot
metadata distinguishes the latest wire bytes from the complete revision's admitted retained
bytes, including shared arenas across deltas. Preview admission and Reading's derived budget
use the complete retained charge; native snapshots retain their existing decoded-size estimate.

The mounted CodeMirror diagnostic now exercises the actual Worker, port, service, controller,
Live model, status ownership and Reading capture for all six unchanged complete 1 MiB fixtures.
All 18 revisions match full independent native document/projection/layout hashes and status,
with one Worker per fixture. Eleven edits accept a delta directly; the second many-small-block
edit requires a full resync, so the incremental gate correctly fails. Nested ready timings are
9,262.2 ms initially and 3,372.3/3,372.5 ms for its edits. These observations include consumer
work and demonstrate that producer/receiver-only timings were insufficient. They are individual
diagnostic observations, not packaged p95 or physical-memory admission evidence.

Sixteen GC probes retain original ports, receivers and unadvanced scheduler callbacks while
observing actual receipt/cache work and transferred buffers. Cancel, supersede, termination and
failure leave zero observed obsolete survivors; old accepted consumers remain valid and final
disposal returns the ledgers to zero. This proves the checked lifetime behavior, not native
physical peaks. `browser.ts` still selects the ordinary JSON Worker. Activation remains gated
on consumer coexistence, full latency/initial readiness, physical admission and packaged gates.

### Reusing exact receiver validation in native consumers (2026-10-27)

`PackedSnapshotCertificate.create` now performs complete snapshot validation and only then
issues independently charged certificate metadata. Its weak revision witness recognizes the
same actual immutable revision and session owner across prepared-capture revocation at commit.
It contains no strong graph/source/inspection backlink. The trusted certificate factory cannot
be replaced by a wire assertion, source hash or equal identity fields. A different graph with
the very same source object, owner and identity still requires full validation.

The receiver owns its current certificate, while port/service notifications lend it alongside
the accepted capture. A queued consumer retains its own certificate and graph separately;
replacement, failure, cancellation, preparation completion and eviction release their temporary
ownership. Native preview preparation reuses validation only when exact graph, source object,
path and serialized policy match and requested limits are valid and non-stricter. Property
order in the serialized policy remains part of the existing ownership check. Closed or
mismatched certificates take the normal complete validation path. Copy/model admission is
unchanged; certificate metadata itself remains admitted before validation and publication.

Sixteen certificate tests cover binding, forged-graph fallback, commit/revocation, metadata
capacity and cleanup. Five GC probes retain certificates, raw weak predicates, closed work and
sessions while observing actual old graphs, arenas, sources and inspections: zero graph
survivors after ended requests/eviction/disposal and zero final metadata survivors after close.
The sixteen transport GC probes pass again. This establishes tested lifetimes, not a calibrated
physical-memory bound.

All eighteen complete mounted application outputs still match the native oracle. Nested edits
now take 666.4/725.1 ms versus the preceding 3,372.3/3,372.5 ms; both exceed the required
500 ms target. Initial nested readiness is 8,049.9 ms and the second many-small-block edit
still requires full resync. No fixture, admission weight, cap or performance target was relaxed.
The ordinary JSON factory remains selected pending full consumer/coexistence, latency,
physical admission and release gates. See the latest VALIDATION.md checkpoint for exact evidence.

### Candidate lifetime and optional cache pressure (2026-10-27)

Native occurrence preparation now separates permanent model storage from the old immutable
range storage borrowed by an uncommitted fork. Both keep the existing source/descriptor
weights and remain admitted before construction. Controller and read-only leases share a
separate reservation for the borrowed ranges. Successful commit replaces those ranges and
ends that reservation; abandoned/rejected candidates keep it through their last read-only
lease. Independent old installed consumers retain their own charge. Partial retain failure,
preparation cancellation and owner disposal release every acquired handle. Five tests and
seven GC probes cover these paths, including keeping closed work and callbacks unadvanced.

The actual second many-small-block edit still exhausted admission after this lifetime fix.
A diagnostic-only trace identifies whole-string word validation: 6,435,432 bytes requested
with 4,435,170 available. The receiver now releases its optional cached prose after closing
that failed inspection, then retries complete validation once on the same prepared graph.
Document/projection certificates remain available. Every word is recounted with the normal
whole-string Intl path; forged counts still fail. No new payload or ACK is issued by the
retry, and a second capacity failure follows the existing bounded full-resync path.

Three pressure tests cover acceptance, forged words and cancellation after reclamation.
Three additional GC probes observe actual cache maps/entries/chunk arrays after successful
receipt, cancellation and disposal, while closed baselines/work and original receivers stay
alive: zero observed cache survivors and zero final ledger bytes. Independent accepted old
consumers remain valid before owner disposal. Existing certificate/port GC checks pass again.

All six complete mounted application fixtures now pass: eighteen native semantic hashes,
counts/outlines and twelve direct deltas, one Worker per fixture. The diagnostic requires all
three initial caches and preserves document/projection caches across edits; optional prose
may be reclaimed. Complete semantics, corpus sizes, caps and incremental acceptance remain
mandatory. Many-small-block edit readiness is 587.6/755.7 ms and nested readiness is
543.1/585.6 ms in this individual run, still above the required 500 ms p95 target. This fixes
the observed resync, without establishing latency or physical-memory acceptance. Ordinary
JSON transport remains selected pending the full activation and release requirements.

An extended twenty-edit application run then verifies 126 complete revisions against the
native oracle and accepts all 120 edits directly as deltas, including heading shortening.
One Worker per fixture, independent Reading lifetime, final zero ownership and every existing
cap remain mandatory. Only many-small-blocks reclaims optional prose, on revision 2. Edit
readiness p95 is 579.8 ms for repeated paragraphs, 648.7 ms for many small blocks and 563.9 ms
for nested containers; these still exceed 500 ms. These diagnostic distributions do not
establish packaged input/mode/apply-slice latency or native physical peak admission.

### Combining complete projection checks (2026-10-27)

Actual renderer CPU profiles and source-free application phase timings locate most edit
latency in receiver validation, while installation takes about one millisecond in the three
slow fixtures. `PackedSemanticPort` and the shared browser runtime now bind their clock
callbacks directly, preserving their owners and a clock check after every advance. The
one-millisecond target, cancellation and accounting remain unchanged.

Exact output validation previously performed projection geometry validation, then traversed
the same spans/HTML again for exact renderer comparison. The composed path now checks
identity, schema, limits and supplied widgets, then performs every span key/type, visibility,
ordering, boundary, separator, footer and HTML/value check in its exact comparison. Standalone
`validatePackedProjection` retains its complete geometry pass. The schema-only internal
helper explicitly proves no geometry and cannot issue a complete snapshot certificate alone.
Full document validation remains a prerequisite. No admission weights or caps change.

Four added cached-delta cases reject unknown span fields, hidden spans, wrong body ends and
separators, complementing the existing complete CommonMark, extension, forgery, limit and
revocation tests. All 10,946 unit tests and 31 lifetime probes pass. The complete twenty-edit
application run again verifies 126 native semantic revisions and 120 direct deltas. Repeated
paragraph readiness p95 is now 493.5 ms (494.7 ms maximum); many-small-block and nested p95
remain 638.1/527.4 ms. These diagnostic observations do not establish packaged input/mode/
apply-slice acceptance or physical memory bounds. Full latency, cold readiness, physical
admission, production activation and the remaining release requirements remain open.

### Compact word-cache storage (2026-10-27)

The post-composition renderer profile confirms that many-small-block validation becomes
more expensive after optional word-cache reclamation: the second sampled edit spends
approximately 109 ms in whole-prose validation, versus the earlier cached path. Complete
native outputs still match in all eighteen profiled revisions. Profiles and the separate
uninstrumented twenty-edit evidence are retained under `test/artifacts/logs/fused-projection-*`.

`PackedWordBaseline` now stores seven numeric fields per root child in one private
`Uint32Array`: traversal nodes/depth, text count, prose length, maximum leaf length and its
chunk range. Namespace maps contain only numeric row indexes. One flat native chunk list
replaces per-record plan, entry, value and chunk-array objects. The original chunk spelling,
empty-leaf separators, full current prose reconstruction and one complete Intl word recount
remain unchanged. Exact immutable record identity and compatible owner/source remain required
for reuse; newly packed/overlaid records take the complete traversal path.

Admission precedes table allocation and every new namespace map. A resizable capture-owned
workspace preserves the reservation across planning, copying and completed-cache handoff.
Each slot charges 32 bytes for its 28-byte typed row and 160 bytes for map membership; each
namespace adds 256 bytes. Existing text/chunk, stream, traversal and copy-workspace weights
remain in force. This change removes the retained structures that the previous weights
covered; it does not increase any application cap or calibrate portable physical peaks.

Cached chunks are exposed only through source-free revocable iterators. Every advance,
including the end check, consults the live baseline. Closing the baseline clears the private
list and metadata ownership, revokes suspended validation and makes escaped iterators throw.
Native arrays, typed buffers and namespace maps are observed in the updated lifetime probes,
with closed owners/work/capabilities and already-advanced escaped iterators kept alive.

All 10,948 unit tests and 73 lifetime probes pass. The twenty-edit mounted diagnostic
matches all 126 complete native revisions and accepts all 120 deltas directly. Every round
retains all three caches under the same 64 MiB cap. Many-small-block p95 decreases from
638.1 to 536.6 ms without late reclamation; repeated paragraphs remain below 500 ms at
490.0 ms p95. Nested p95 is 544.1 ms. The rebuilt Windows package passes 73 functional tests
and the same five complete performance fixtures; ordinary JSON nested fallback still fails
the sixth fixture. These results do not satisfy full packed latency, cold readiness,
physical admission, activation or the remaining platform/hardware release requirements.

### Avoid repeated empty-context work (2026-10-27)

Projection context planning already traverses the complete immutable root and counts every
outer definition and body footnote reference. If that completed walk finds no definitions,
the context and its record-key list are empty: there are no native context nodes to copy.
The collector now uses that result directly. Nonempty contexts keep their separate admitted
copy pass and the complete count consistency checks. Body-reference counts and identifier
sizes always come from the complete planning walk, including when definitions are absent.

Context and word traversal now consult sealed immutable-record metadata before repeating
shape/type queries for a cache hit. Every logical node/depth/text bound still applies, and
new or overlaid records retain complete checks. Projection context absence lookup reads its
stored traversal summary directly. Word chunk iterators resolve their numeric range once;
each advance and the final end check still consult the revocable baseline, without retaining
its private array/table. Full current prose reconstruction, Intl recount and exact HTML/
widget/span validation remain required. No application cap, admission weight, debounce or
slice target changes.

New tests cover revocation before the final chunk end check and before starting an empty
chunk stream. An empty definition-context test includes an unresolved body footnote call,
verifies its complete reference/identifier cost and rejects insufficient node/depth limits
before inspection. Complete CommonMark/extension and native-oracle comparisons remain in
the suite. All 10,951 unit tests and 85 lifetime probes pass. The twenty-edit application
diagnostic again verifies 126 complete native revisions and 120 direct deltas, retaining all
three caches throughout. Diagnostic readiness p95 is 458.7 ms for repeated paragraphs,
514.6 ms for many small blocks and 535.9 ms for nested containers; the last two still miss
500 ms. Full packed latency, cold readiness, physical admission, activation and release
verification remain open.

### Reuse sealed immediate range bounds (2026-10-27)

Lazy range shifts previously rechecked every unchanged descriptor's immediate `from`/`to`
pair on both sides of each delta. A complete successful segment scan can now issue an
immutable proof containing only its opaque arena token, array record, covered index range,
current range offset and minimum/maximum bounds. Its private brand and module-private
constructor key prevent caller-created objects from issuing evidence. No arena, reader,
node, source, predecessor or native semantic graph is retained by that proof.

The overlay admits **512 bytes before allocating each new proof**; existing segment and
staging weights remain unchanged. There is no global cache or uncharged metadata table.
Immutable slices and position-only shifts share their existing proof. A later range shift
can reuse it only for the same arena/array record, a covered subset and valid current and
resulting uint32 bounds. Expanded descriptor counts still enforce the 800,000-node limit.
Each reused segment yields to the scheduler. If conservative bounds cannot establish a safe
subset shift, a complete scan computes narrower bounds rather than rejecting safe work.
New records, forged evidence, widened coverage and changed arenas cannot bypass validation.
These facts authorize only immediate numeric range transforms; full semantic/output checks
remain required before publication.

Thirteen new tests cover cumulative/position shifts, subset fallback, underflow/overflow,
forged/prototype/copied evidence, constructor sealing, expanded alias counts and rejected
proof admission. Seven forced-GC probes hold escaped proofs and closed application-style
`PackedWork` handles across unstarted, scanning, cached, error and completion paths. Observed
arenas, indices, owned payloads, offset buffers, string maps and shapes are collected. Raw
helper generators do not provide an independent revocable ownership contract; application
and session callers retain the existing revocable work handle. These probes do not calibrate
physical peak memory or aggregate admission.

The complete twenty-edit application sequence passes all 126 native comparisons and 120
direct deltas with all three caches retained. Many-small-block p95 decreases from 514.6 to
466.7 ms; repeated paragraphs measure 431.8 ms. Nested remains above the target at 534.2 ms
because its first two edits take 543.4/534.2 ms. An isolated nested result below 500 ms did
not reproduce in the full sequence and is not acceptance evidence. The updated Windows
build passes 10,964 unit tests and all static checks. Initial readiness, full nested latency,
physical admission, transport activation and the remaining release requirements stay open.

### Reuse exact position-segment facts (2026-10-27)

Position transforms can now retain a sealed, source-free proof after fully validating one
immutable array segment. It stores the opaque arena token, array record, exact index range,
position/range offsets, minimum/maximum position offsets, expanded visit count and maximum
container depth. Each new proof is charged at **512 bytes before allocation** to existing
overlay ownership. Temporary whole-arena DAG summaries remain staging scratch and are never
retained by the proof. There is no global cache or new uncharged metadata table.

A later transform reuses these facts only for the same arena/array record and exact segment
coverage, with the same immediate-range transform and safe current/resulting position bounds.
Expanded counts still include every alias occurrence; the selected array counts once across
all segments. Stored depth remains subject to the existing 256-container bound. Reused
segments yield. Split/narrowed segments and changed range transforms receive a full scan,
because expanded descendant counts need not be equal across different subsets. Nodes without
positions preserve their scalar values. New nesting and unproved nodes retain complete checks.

Proof instances, constructors and prototypes are frozen. The private brand and constructor
key prevent forged issuance, while frozen checkers/getters prevent replacement through a
reflected constructor. Immediate-range proofs receive the same checker/prototype sealing.
These immutable numeric facts do not replace capture revocation or full semantic/output
validation. No application cap, existing admission weight, debounce, Intl recount batch or
renderer slice target changes.

Seventeen new tests cover cumulative shifts, yielding, exact subset handling, uint32 bounds,
copied/forged/prototype evidence, changed records/coverage/transforms, aliases, added nesting,
empty position sets, constructor/checker sealing and rejected admission. The older summary
test now expects one summary build across a shift and its reversal and verifies the lower
staging requirement, while retaining exact transformed-value and staging-boundary assertions.
The lifetime tool's `--positions` mode observes actual temporary summary tables/backing
buffers as well as arenas, indices, payloads, offset buffers, maps and shapes. It keeps proofs
and closed revocable work handles alive, including cancellation during summary construction.
These collection checks do not establish physical peak or aggregate admission.

The final twenty-edit sequence verifies all 126 complete native revisions and 120 direct
deltas, retaining all three caches throughout. All six diagnostic edit readiness p95 values
are below 500 ms: 280.8/247.3/261.7/436.0/455.7/475.2 ms for prose/single/mixed/repeated/many/
nested. Nested p95 was 534.2 ms at the preceding checkpoint. Many/nested maxima remain
516.4/513.5 ms, and cold nested readiness is 6,255.4 ms. All 10,981 unit tests and 37 current
lifetime probes pass; the Windows build passes all 73 functional tests without retry.
Complete packed diagnostic edit p95 is now measured below the target across the corpus.
Packaged full-corpus acceptance, cold readiness, physical admission, transport activation
and remaining release verification stay open.

### Reuse the exact snapshot certificate while building projection metadata

Projection-cache construction previously ran complete snapshot validation a second time
after the receiver had already completed it before ACK/publication. The factory can now use
that exact source-free snapshot certificate. Reuse requires private factory provenance,
the same immutable graph/owner/source/path/policy and compatible limits. Otherwise complete
validation runs again. Metadata admission, traversal bounds, cancellation and independently
owned consumers retain their existing contracts. The cache does not retain a native root,
HAST or rendered output as a consequence of this change.

The shared certificate checker uses the private brand and a sealed intrinsic method;
constructor/prototype freezing prevents replacement. Both preview preparation and projection
metadata construction reject forged instance authorization methods. Eleven additional tests
cover reuse and rejection, and twenty actual port plus five certificate GC probes pass,
including cancellation inside projection-cache construction.

The readiness diagnostic uses timer polling. Optional cache work after publication can run
before that poll; its timing was previously described too strongly as excluding cache work.
The final quiet six-fixture run preserves all 126 semantic revisions/120 direct deltas and
all three caches under 64 MiB. Edit p95 is 280.3/240.1/253.3/405.9/441.0/432.3 ms. Observed
nested cold readiness drops from 6,255.4 to 4,616.2 ms, while actual apply completion is
3,778.3 ms before and 3,687.5 ms after. Most of the reduction is removed optional work after
publication, not earlier first-preview installation. Mandatory cold validation, cache task
priority, physical aggregate admission, packaged acceptance and activation remain open.

The resulting Windows build passes all 73 packaged functional tests without retry. All
236 compiled runtime files and all 207 packaged workspace source files match current bytes
and inventories. Packaged performance still fails only the nested Source fallback/missing
Live samples; the other five corpus fixtures and five auxiliary performance tests pass.
This does not authorize transport activation or establish full release acceptance. See the
matching validation checkpoint and `test/artifacts/logs/certificate-cache-performance-summary.json`.

### Copy native values with one explicit traversal stack

Native copy construction now replaces recursive generator delegation with one generator and
an explicit object/array frame stack. The existing sixteen-value batch bound, array/prefix
progress, streaming strings, allocation weights, complete preflight/incremental admission,
key/path bounds and expanded alias counts remain. Native positions use the complete frozen
reader result directly. Partial objects remain private until complete inspection. Cancellation
closes every open array inside out, even when one close throws; an existing body failure wins.
The stack stays within existing depth scratch and clears on exit without a retained cache.

The full twenty-edit sequence preserves all 126 native semantic revisions/120 direct deltas
and all three caches. Edit p95 is 277.9/239.9/253.0/425.0/441.9/435.1 ms for prose/single/
mixed/repeated/many/nested. Five alternating cold pairs with only the copy module changed
measure median message-arrival-to-apply time of 2,187.1 ms recursive versus 2,106.7 ms stack
(3.7%). This is a modest diagnostic gain; individual runs vary and packaged SLOs remain
separate. All 11,000 unit tests and 64 current ownership probes pass, including actual frame
stacks/native values held through cancellation with five nested arrays open. See the matching
VALIDATION.md checkpoint and `test/artifacts/logs/native-copy-comparison-summary.json`.

The resulting Windows build passes all 73 packaged functional tests without retry. Its
236 compiled runtime and 207 complete workspace source files match the current bytes and
inventories. Packaged performance still fails only nested Source fallback/missing Live
samples. The other five complete fixtures and five auxiliary performance tests pass.
Aggregate physical/native-input admission, transport activation and remaining release gates
stay open; this local copy improvement does not establish them.

### Observe memory through the actual mounted semantic application path

The service diagnostic's separate `--process-memory` mode now samples the actual persistent
packed Worker, receiver, service and mounted Live consumer together. Main-process OS metrics
include native producer work, while optional checkpoint labels separate readiness/cache
construction from full diagnostic hash expansion and disposal. The raw report retains process
rows, Worker observations, ownership and per-revision summaries; the cold-through-ready
summary ends before native hash materialization. Later revisions can include commitment
left by hashing. Six-case runs share a process; a separate nested-only run starts fresh.

All 21 measured revisions and 18 additional normal revisions match complete native semantic
hashes/counts/outlines, exact prior outputs and direct full/delta expectations. Every Worker
terminates and receiver ownership returns to zero. The fresh nested process samples 453.1
MiB private commitment through first readiness, versus a 37.0 MiB baseline. After disposal
and three GCs, commitment remains 258.8 MiB while renderer heap/backing/embedder total is
14.5 MiB. The 676.0 MiB overall sampled maximum includes diagnostic hash expansion and is
not an application-only requirement. These observations distinguish process reservation
from reachable JavaScript storage without proving either complete leak freedom or a physical
bound. Private bytes are commitment, working sets can double-count shared pages, sampling
can miss peaks, and renderer heap excludes Worker isolates.

This closes the earlier diagnostic-path coverage gap, not native/aggregate admission. Other
tabs, mounted widgets, translation/export and production main IPC remain unmeasured here.
Admission must cover native construction and simultaneous current/pending/old consumers with
calibrated headroom before activation. All 11,000 unit tests, full checks and the Windows
build pass. The rebuilt ASAR is byte-identical to the preceding 73-functional-test checkpoint;
packaged nested fallback, activation and release gates remain open. See the matching
VALIDATION.md checkpoint and `test/artifacts/logs/service-memory-summary.json` for evidence and limits.

### Give optional receiver warmup its own background scheduling slot

Optional receiver caches now use background `postTask` scheduling; mandatory receipt and
preview work retain their existing scheduler. Each priority has one revocable callback
slot, so a delayed cache callback cannot take a newer required receipt. Cancellation clears
both work references while callbacks remain safely queued. Browser fallback uses timers;
callback failure is surfaced without executing the work again. Cache admission, validation,
ACKs, independent consumers and complete output remain unchanged.

Nine added regressions cover priority, scheduler fallback, callback errors and interruption
with both callback priorities outstanding. All 11,009 unit tests and 68 current lifetime
probes pass. Four new port probes hold both obsolete/current callback slots through forced
GC under cancel/supersede/terminate/failure, without retaining obsolete work or transferred
buffers. The complete twenty-edit diagnostic still preserves 126 native semantic revisions,
120 direct deltas and all three caches, under the existing 64 MiB receiver allowance.

Nested observed readiness now follows apply completion by about 0.1 ms, previously roughly
948 ms. Apply completion remains similar (3,554.3 versus 3,542.7 ms); this removes cache
interference with the ready observation and does not prove a comparable native validation
or paint improvement. Edit p95 values are 280.0/242.9/252.1/402.5/438.5/436.5 ms for the six
complete fixtures. The fresh nested memory checkpoint reaches first readiness before any
optional cache is complete; all caches still finish afterward. Native memory remains high,
and neither local ownership weights nor these samples establish aggregate admission.
See the matching validation checkpoint for exact artifacts, limits and remaining gates.

The rebuilt Windows package matches all 236 compiled runtime files and all 207 packaged
workspace source files. All 73 packaged functional tests pass without retry. Packaged
performance still fails only nested Source fallback/missing Live samples; the other five
complete fixtures and five auxiliary scenarios pass. Background cache priority closes that
scheduling issue while leaving native/aggregate admission, mandatory cold construction,
transport activation and hardware/platform release gates open.

### Serialize projection HTML with one traversal stack

The bounded HTML comparator now keeps one explicit stack instead of a recursive visitor
and a lookahead generator per element. Pending ancestor shells open only when descendants
actually emit nonempty HTML. An empty element's complete shell also makes its ancestors
nonempty, retaining the pinned serializer's void-element behavior. The public `toHtml`
still spells every shell, property and escaped text piece; SVG/template/script/style rules
and surrogate-safe 4096-unit chunks remain. Sparse child arrays are rejected rather than
silently ending a traversal before later siblings.

Every node is visited and checked against the existing node/depth limits. Each shell still
has a cooperative barrier before its native serializer call, and empty walks retain their
progress budget. Active frames use the stream planner's existing per-depth workspace
reservation; no cache, admission cap or wire format changed. The stack clears in `finally`.
The lifetime diagnostic now covers actual pending serializer frames in addition to body,
widget and footer graphs: all fifteen return/release/dispose probes collect every observed
object while closed handles remain held and unadvanced.

Twelve alternating final-code Node measurement pairs preserve the complete nested HTML
hash, all 239,327 output chunks and all 71,050 progress pauses. Median serialization time
is 294.8 ms before and 144.5 ms after. This isolates iteration/HTML generation over an
already constructed HAST; it excludes parsing, HAST construction, packed validation and
application scheduling. The complete application diagnostic still checks all 126 native
semantic revisions and 120 direct deltas. See the matching validation checkpoint for full
application timing, package evidence and limits. Mandatory cold validation remains over
budget, and native/aggregate admission and ordinary transport activation remain open.

### Recheck native-copy scope lifetime without repeating immutable kind lookup

Native inspectors now use `PackedReadScope.assertOpen()` on each side of an advance. The
guarded capture/item lookup still rejects release or item expiry, including scopes borrowed
from a different capture. Paths are validated when composed over immutable views; initial
kind checks and all actual value/schema reads remain. The guard still checks its separate
work owner's identity. It returns no view and introduces no retained state or admission change.

Six reentrant borrowed-scope regressions cover both inspectors under advance, return and
release. The atomic-query expiry matrix includes the new check. All 39 current native-copy
lifetime probes collect their observed objects with closed handles held and unadvanced.

Five alternating complete nested application comparison pairs preserve twenty native
semantic revisions. Median arrival-to-apply time is 1,928.3 / 1,871.2 ms, about 3% lower.
Both first-edit medians remain above 500 ms. The separate six-fixture sequence preserves
126 complete revisions / 120 direct deltas and all three caches under 64 MiB. Nested cold
readiness is 3,548.0 ms and edit p95 470.9 ms (539.4 ms maximum). Separate corpus runs do
not establish a uniform latency gain. See the matching validation checkpoint and
`test/artifacts/logs/scope-liveness-comparison-summary.json` for controlled provenance and limits.
Mandatory cold validation, calibrated native/aggregate admission and activation stay open.

The matching Windows build passes all 73 packaged functional flows without retry and the
actual install/save/reopen/uninstall test, including exact recorded OS-state restoration.
Current checks, 11,020 unit tests and complete package byte/inventory verification pass.

### Admit complete text leaves while collecting word-count prose

Normal word validation now traverses text once, growing its capture-owned workspace before
copying each complete leaf or sealed cache entry. The reservation includes accumulated prose,
separators, chunk metadata, final join and whole-string Intl storage. Growth of the collector's
expected length follows successful admission; a failed resize preserves the old charge.
Final admission still runs for empty documents, and partial collection closes on cancellation
or failure. Existing caps and conservative weights remain. This does not admit native parser
construction or simultaneous consumers outside this collector.

An explicit phase observer retains the original separate scan/read walks. Exact parser text
preorder, empty leaves, overlay streams, cache boundaries and whole-string Intl counting are
preserved, with sixteen native iterator calls per scheduler advance. Join and native Intl
calls remain synchronous. Three regressions cover late budget/node/depth failure and retry;
all 11,023 unit tests pass. The lifetime tool adds normal collection under return/release/
dispose for 54 total probes, all collected with closed handles held and unadvanced.

Five alternating full nested application pairs preserve twenty complete native revisions.
Median arrival-to-apply time falls from 1,961.3 to 1,785.5 ms, about 9%. First-edit medians
remain 596.3 / 594.7 ms. The matching validation checkpoint records provenance and limits;
these diagnostics do not establish packaged latency, calibrated physical admission or
transport activation. Mandatory cold work and the remaining release gates stay open.

The isolated exact nested document benchmark uses three warmup pairs and twelve alternating
measured pairs: median word validation is 238.1 / 140.2 ms, with 452,688 / 238,548 scheduler
advances. Parse, encoding, indexing and session disposal are outside timing. The separate
full corpus run preserves all 126 complete native revisions / 120 deltas, all three caches
and unchanged caps. Its nested readiness is 3,736.8 ms with edit p95 471.1 ms and maximum
589.3 ms; the preceding full run was 3,548.0 / 470.9 ms. These separate sequences do not
establish a cold or warm improvement. Preserve them alongside the controlled paired gain.
Both cache-lifetime variants add 21 passing probes each, for 96 current word-related probes.

The matching Windows package passes all 73 functional flows without retry, the actual
install/save/reopen/uninstall verification with OS-state restoration, and complete runtime/
source byte-inventory checks. All new temporary evidence remains under ignored `/test/artifacts/logs/`.

### Group tiny projection outputs while preserving every serializer suspension

The owned body/widget stream now groups small HTML pieces before invoking its exact-output
inspector. A private collector holds at most 256 pieces and about 4096 UTF-16 units; one
bridging low surrogate can make a flush 4097 units. This preserves exact concatenated text
without separating surrogate pairs across piece boundaries. Body and each widget finish
their own collector before the following metadata event. No complete HTML output is joined.

Every upstream progress pause remains visible. A string emission also remains a scheduler
pause while its text is private, so adjacent lexical/native batches cannot combine inside
one advance. A new regression checks adjacent 4096-unit inputs; one advance consumes at
most one upstream piece. Native serializer shell barriers and original node/text bounds
remain. Iterator return/failure clears partial pieces and closes its input.

The stream planner adds a separate **64 KiB** reservation before constructing the collector.
It covers bounded piece metadata, the joined flush and one pending input concurrently.
Existing native/complete-output weights stay intact, as do application/session caps; the
extra allocation is charged instead of hidden inside those existing weights. This is a
local conservative reservation, not calibrated native/aggregate physical admission.

Native CommonMark spelling under both grammars/raw policies is checked through both direct
and buffered streams. Unicode/lone-surrogate, capacity, pause and cancellation tests retain
exact output. The lifetime diagnostic adds pending body/widget/footer collectors to its
existing graph/frame phases, for 24 return/release/dispose probes with handles held and
unadvanced. Full delivery and ordinary transport activation remain subject to the existing
latency, admission and platform gates.

Five alternating final-code application pairs preserve twenty complete native revisions.
Median arrival-to-apply time is 1,784.0 / 1,624.6 ms, about 9% lower. First-edit readiness
remains 618.5 / 597.2 ms, above 500 ms. Separate event instrumentation observes 233,032 /
6,300 body callbacks for identical 2,254,745 UTF-16 units and complete semantic hashes.
It records no widget events for this fixture. The earlier prototype that grouped several
upstream pieces per advance is excluded from final-code evidence.

The separate six-fixture twenty-edit sequence verifies 126 complete native revisions /
120 deltas and all three caches. Nested initial readiness is 3,854.9 ms, edit p95 531.0 ms
and maximum 592.3 ms; many-small-blocks edit p95 is 517.2 ms. Every fixture's initial and
edit p95 observation is higher than the preceding full run. Preserve these results beside
the paired gain: they do not establish a uniform cold or warm improvement. The matching
validation checkpoint records full results, provenance and timing limits.

All 11,034 unit tests pass, with one intentional skip, and all 24 lifetime probes collect
their observed objects. Checks, Windows build, complete runtime/source byte-inventory
verification and actual install/save/reopen/uninstall with OS-state restoration pass.
Mandatory cold validation, calibrated native/aggregate admission and activation remain open.

The matching unsigned Windows package passes all 73 functional flows without retry. Final
evidence links current artifact hashes, complete 236-runtime/209-source inventories, installer
restoration/removal and comparison source hashes to the completed checks. Functional success
does not remeasure or resolve the ordinary packaged nested Live fallback or latency gates.

### Admit complete projection definitions during one document walk

Context preparation now measures and admits each complete outermost definition/footnote
before copying it, while the document cursor remains borrowed. Prior copies stay private
and charged in one resizable workspace during later traversal. Only the complete frozen
context reaches the inspector. Native copying within each selected definition retains its
full preflight, and all weights, logical limits and native/text batch boundaries remain.
Late workspace/node/depth failures close the partial context and restore ownership; complete
retry succeeds. This changes context-wide admission into incremental per-definition admission
without publishing a partial context or admitting native producer construction.

The isolated exact nested-context comparison uses three warmup pairs and twelve alternating
measured pairs. Median collection is 187.7 / 107.5 ms, with 428,282 / 214,143 advances and
equal complete context/final costs. Five minified application pairs preserve twenty complete
native revisions: median arrival-to-apply is 2,134.2 / 2,014.7 ms, about 6% lower, with one
pair regressing. First-edit readiness remains 712.5 / 661.6 ms. The matching validation
checkpoint records provenance and measurement limits; neither diagnostic passes cold latency.

Four new late-failure regressions and all existing context/output checks pass. The lifetime
tool adds actual private context copies during partial collection, under return/release/
dispose with live owners retained for return/release, for 18 passing GC probes. All 11,038
unit tests and current checks pass. Native/aggregate admission, packaged acceptance and
ordinary transport activation remain open.

The separate complete six-fixture twenty-edit run verifies 126 native revisions / 120
deltas with all three caches and unchanged caps. Nested initial readiness is 3,956.5 ms,
edit p95 577.2 ms and maximum 624.9 ms; repeated and many-small-blocks edit p95 are 547.4 /
570.5 ms. Five edit p95 observations are higher than the preceding full sequence, so the
paired cold gain does not imply a uniform corpus improvement. Current checks, Windows build,
complete runtime/source inventories and actual install/save/reopen/uninstall restoration pass.

The matching unsigned Windows package passes all 73 functional flows without retry. The
final evidence check binds current artifact hashes, complete 236-runtime/209-source inventories,
installer restoration/removal and both comparison source sets to this checkpoint. Ordinary
packaged nested Live fallback, native/aggregate admission and release acceptance remain open.

### Omit impossible literal-autolink attempts without changing transforms

The source-wide grammar selection now also omits WWW and HTTP autolink tokenizers when
their required literal prefixes cannot occur. Entities or escapes conservatively retain
the corresponding constructs. The sixteen fixed frozen processor configurations clone
syntax records and preserve every mdast transform, including decoded autolinks, plus
frontmatter/math and the original whole-document span path. Explicit fragment grammar uses
the same conservative selection. Source, message, node, block, cache and workspace limits
are unchanged.

Thirteen added regressions compare complete roots/positions against an independently
configured full grammar, including all sixteen construct combinations in repeated forward/
reverse edit order and literal/encoded/escaped autolinks. All 11,051 unit tests and current
checks pass. A separate current-parser cumulative allocation sample falls from approximately
1,033 MB to 956 MB, including collected objects; this is not a retained or physical peak
bound. Three CPU observations have nearly equal medians. Five alternating minified Electron
pairs verify all twenty complete native revisions and explicit substitutions in both renderer
and actual worker builds. Their timing results are mixed; current edit readiness still
exceeds 500 ms in every pair. The matching validation checkpoint records the raw observations
without treating this allocation change as passing latency or admission gates.

The completed-flow dependency prototype remains uninstalled. Its first renderer-only build
injection did not reach the actual producer worker and cannot support a worker peak claim.
Corrected separate worker plugins, per-worker source matches and emitted-worker flag/hash
checks establish a valid modest single-pair comparison. Further controlled evidence and
calibrated native/aggregate admission remain necessary before expanding the pinned patch.

Five subsequent alternating fresh-Node pairs confirm the allocation direction: median
sampled cumulative allocation is 1,030,089,256 / 952,424,720 bytes, about 7.5% lower, with
every current pair lower. CPU and allocation profiling are separate; fifteen parse CPU
samples per variant have medians 571.94 / 565.61 ms. Complete semantic digests match.
The separate six-fixture twenty-edit run verifies 126 native revisions / 120 deltas with
unchanged caches/caps and zero final ownership. All selected diagnostic edit p95 values are
below 500 ms; nested initial readiness remains 2,874.9 ms and maximum edit 547.1 ms. Unchanged
grammar fixtures also improve versus the preceding unpaired run, so the whole timing change
cannot be attributed to the guards. Ordinary packaged acceptance remains a separate gate.

The current Windows build and actual install/save/reopen/uninstall restoration pass, and
all 73 packaged functional flows pass. The separate packaged performance suite has five
passed / one failed / one intentional skip. Prose maximum apply slice is 4.2 ms, many-small-
blocks freshness p95 is 523.4 ms, and nested containers still fall back to Source. The actual
ordinary snapshot encoder rejects the complete nested JSON payload of approximately 22.7 MB
against the unchanged 8 MiB wire cap. Current artifact/source checks bind both passing and
failing evidence; native/aggregate admission, transport activation and release acceptance
remain open.


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

## Native construction boundary evidence — 2026-10-28

The repeatable `test/benchmark/profiles/profile-semantic-native-construction.mjs` probe now observes the
actual Worker during tokenization, MDAST compilation, document preparation, HAST and
projection construction, and packed encoding. Six corpus cases pass 12 complete native
oracle comparisons, with 60 boundary samples and no captured Worker/debugger errors.
The final report and source/bundle provenance are in
`test/artifacts/logs/semantic-native-construction-igEifv/`; method, counter coverage and measured values
are documented in `docs/architecture/semantic-native-construction.md`.

The nested case observes 170.05 MiB of Worker used heap after projection construction
before encoding a 5,886,179-byte payload. This instrumented observation establishes
neither a portable native charge nor a peak. Maximum resolved compilation span size
also excludes earlier block tokenization and the later whole document. MDAST handler
entries receive already-created nodes and exclude nodes synthesized elsewhere. Native
admission must cover construction before these allocations and aggregate ownership;
neither packed-buffer admission nor these diagnostic counters satisfy that requirement.
No production parser, renderer, transport activation, limit or weight changed.

## Collect prose in the complete cold root walk — 2026-10-28

Cold document validation now collects each text leaf during the complete root/schema/
descriptor walk, then verifies the complete prose with the existing Intl counter. Empty
and unpositioned leaves preserve parser preorder. Node/depth/geometry checks and exact
descriptor/outline/count/projection/layout/widget comparisons remain mandatory. Explicit
phase observers and baseline-backed revisions retain their independent phases. The
shared counter preserves its 16-call bound per advance and bounded text decoding.

Collection keeps every previous buffer/stream/traversal weight and additionally reserves
the coexisting root/description workspaces when checking its local allowance. Session
admission covers actual simultaneous ownership. If the optional overlap cannot fit,
all partially collected prose/readers are discarded before retrying the original separate
passes. No limit, eligibility rule or scheduler deadline check is relaxed. This does not
address native parser/renderer construction admission or calibrate physical memory.

Five fresh application pairs reduce the nested cold receipt-to-apply median from
1,502.3 to 1,330.7 ms, with all five cold pairs lower and approximately flat edit medians.
All twenty complete native revisions match the independent oracle. The renderer variants
are checked in actual bundles and paired producer Worker bytes are identical. Separate
complete snapshot validation reduces scheduler advances from 1,329,813 to 1,169,206 with
the same source/root/HTML hashes, one work registration and zero final ownership. This
removes duplicated traversal work while keeping complete validation.

The matching Windows build passes 11,104 unit tests, 73 packaged flows, real installer
lifecycle, 126 complete native service revisions/120 deltas and 180 fresh lifetime probes.
The ordinary transport still rejects the nested complete JSON; packaged performance stays
5 passed/1 failed/1 intentional skip. Cold packed receipt remains far above 150 ms, and
native/aggregate admission, transport activation, unexplained startup restart and release
gates remain open. Detailed methods, corrected comparison metadata provenance and current
artifact hashes: `docs/validation/implementation-history.md`, `test/artifacts/logs/document-word-fusion-validation-check.json`.

### Reject transient cold context maps — 2026-10-28

Collecting definition/footnote absence during complete document validation can prove
that exact root or top-level subtree needs no context search. The tested prototypes
kept all schema/source/descriptor/word/output checks and exact logical traversal costs.
Their metadata was admitted before allocation and held through projection validation.
No caller flag or matching revision number authorized reuse.

The final subtree prototype removes 207,837 nested certificate advances but does not
show reliable application latency improvement. An earlier five-pair comparison favors
it; the final source-bound five-pair comparison observes median cold receipt worsening
from 1,371.7 to 1,496.8 ms, with four pairs slower. Its fallback also omits native-copy
capacity failure: two complete documents accepted at 2 MiB by the existing validator
are rejected. A lifetime check with 22 retained internal callbacks finds no graph
survivors, but that does not establish physical admission or latency acceptance.

Reject all experimental runtime changes. Keep two regression tests for 100/600
paragraphs under 2 MiB, demonstrated failing with the prototype and passing after exact
restoration. Fresh full units pass 11,106 plus one skip. The preceding tested installer
and its runtime remain current; only its embedded test copy predates these new cases.
See docs/validation/implementation-history.md and test/artifacts/logs/context-rejection-verification.json for both favorable
and unfavorable measurements, the independent eligibility differential and restoration
proof. This does not authorize packed transport activation or close any native/aggregate
admission, ordinary-transport, latency or distribution gate.

### Isolate accepted-response consumer failures — 2026-10-28

Native and packed Service response handlers now distinguish a validation failure still
owning the original running request from a UI notification exception after acceptance.
Only the former fails the Worker. The latter resumes eligible pending work through the
existing guards, preserving a newer request or genuine replacement already started by
the callback. Restart allowance and watchdog ownership remain attached to actual work.

Seven regressions fail with the preceding Service and pass with the current Service.
A source-bound actual Electron packed probe reproduces two Workers/redundant full with
the baseline and one Worker/full then delta with the fix. Both complete native revisions
and producer Worker bytes are identical. This is a controlled callback-failure fix;
the separate isolated startup restart remains unexplained.

Fresh verification passes 11,113 unit tests plus one skip, 73 packaged flows, the Windows
installer lifecycle and all six complete Service cases (126 native revisions/120 deltas,
one Worker each). The new package matches every current runtime/workspace source file.
Performance remains 5 passed/1 failed/1 intentional skip, with the same nine nested
assertions. Nested packed cold receipt is 1,362.4 ms in this sequential diagnostic and
ordinary JSON still exceeds 8 MiB. This does not authorize packed activation or close
native/aggregate admission, latency or release gates. Current artifacts, provenance and
limits are recorded in docs/validation/implementation-history.md and test/artifacts/logs/consumer-failure-validation-check.json.

### Collect exact cold renderer context during complete document validation — 2026-10-28

Cold snapshot validation now collects complete definition/footnote context during its
existing validated root walk. Outermost definitions retain parser order and duplicate
semantics; body footnote references remain separate from references inside copied
footnotes. The factory itself completes mandatory document/schema/description/word
validation before exposing its private context to exact projection/output validation.
Baseline-backed revisions keep their existing path. Capture/source/path binding and
revocation remain required throughout the borrow.

Prepaid fixed context storage plus 1 MiB optional headroom admits metadata/copies before
allocation and reduces the document's simultaneous local allowance. Native, text,
decoder and traversal weights remain unchanged. Completed collection releases unused
headroom before projection; capacity fallback closes every partial copy/reader before
retrying the preceding full validator. No limit or scheduler clock check is relaxed.
All 42 independent budget cases preserve their previous acceptance decisions, including
tight-budget documents that use fallback.

Final source-bound fresh application pairs improve nested cold receipt medians from
1,295.0 to 1,199.3 ms, with all five pairs lower, exact complete native results and
identical producer Worker bytes. Complete certificate advances fall by 214,142 to
955,064 with the same native input hashes and one work registration. This removes a
separate context traversal while retaining complete validation.

Fresh verification passes 11,122 units plus one skip, 73 packaged flows, Windows installer
lifecycle, 126 complete native revisions/120 deltas and 194 lifetime probes. The latter
include held collector objects and callbacks with no observed surviving graphs. All
current runtime/workspace source bytes match the rebuilt package. Packaged performance
still fails exactly the same nine nested assertions; sequential nested packed receipt is
1,354.2 ms, above 150 ms. Native/aggregate admission, ordinary transport activation,
unexplained startup restart and release gates remain open. Exact artifacts and methods:
docs/validation/implementation-history.md and test/artifacts/logs/collected-context-validation-check.json.

### Reject combined scalar metadata queries — 2026-10-28

Do not keep the prototype that combines native-copy scalar type/length/cache queries.
With both variants using identical current helper and producer bodies, five fresh
alternating minified application pairs vary only the exact renderer copier body.
All complete native results and paired Worker bytes match. Arena field lookups fall
by 409,396, while all 955,064 scheduler advances remain. Cold receipt medians move
from 1,348.5 to 1,314.6 ms, but two pairs regress and every paired edit is slower;
edit medians rise from 517.7 to 531.5 ms. This mixed application evidence does not
justify the added helper API. Outlier causes are unproven.

Restore all five runtime files exactly. All 452 release source hashes and existing
package artifacts verify, and fresh static checks plus 11,122 units and one intentional
skip pass. The existing installer stays current; packaged, installer and lifetime
evidence is reverified rather than rerun. No transport/admission/latency/release gate
closes. Methods, individual pairs and restoration proof: docs/validation/implementation-history.md and
test/artifacts/logs/scalar-metadata-validation-check.json. Temporary artifacts stay in test/artifacts/logs/.

### Reject producer allocation shortcuts without application gains — 2026-10-28

Two allocation-driven encoder experiments preserve complete native output and exact
wire bytes for identical inputs across all six corpora. The own-`start` position probe
avoids 201,558 nested key-list allocations; indexed reference writing removes many
temporary iterator pairs and reduces one cumulative sampling estimate by approximately
146.4 MiB. Neither produces an application improvement. Each has five fresh alternating
minified Service/Worker pairs with two real edits per run, independent complete native
oracles, one Worker, full then delta/delta and no observed receiver ownership left at
fixture disposal. Both candidates have slower cold receipt medians. Their runtime and
test files are restored exactly; neither optimization nor changed budget expectation
is retained. Sampling estimates do not establish physical admission.

Keep the existing limits and every scheduler check. Prioritize renderer receipt and
complete certification, where the unresolved latency remains, and require application
evidence before keeping another producer optimization. Methods, individual pairs and
restoration proof: docs/architecture/semantic-native-construction.md, docs/validation/implementation-history.md and
test/artifacts/logs/encoder-allocation-validation.json. The full application goal stays active.

### Root visitor experiment and cleanup ownership — 2026-10-28

Inlining the root validator's per-node visitor preserves every observed type/position/depth,
ordinary and observer advance counts, and five cancellation checkpoints per variant across
all six native corpora. Nested validation still has 113,368 nodes and 214,396 ordinary
advances; an observer yielding once per node gives 327,764 advances in either variant.
Five fresh alternating minified application pairs check 30 complete native revisions with
identical producer Worker bytes. Cold receipt medians move from 1,335.6 to 1,327.5 ms,
with only three pairs lower; cold readiness moves from 2,586.4 to 2,608.7 ms, with three
pairs slower. Edit readiness medians move from 525.5 to 512.2 ms. This mixed application
evidence does not justify keeping the inlining. Its body and full evidence are archived
under `test/artifacts/logs/root-visit-*`; the visitor structure is restored.

A separate fault reproduction proves that the original root validator's cleanup exits
at the first throwing iterator, leaving other frames and its workspace charged. Keep the
cleanup fix: attempt every frame and workspace release, preserve an existing validation
failure even when it is `undefined`, and otherwise report the first cleanup failure.
Four regressions demonstrate the preceding failures and exact restoration of reader and
workspace ownership. The complete schema/source/description/word/projection checks,
budgets, native fields and scheduler yields remain unchanged. Normal complete-application,
lifetime, package and installer evidence is bound by `test/artifacts/logs/root-cleanup-validation.json`
and docs/validation/implementation-history.md. Packed transport and the full application goal remain gated.

### Bound coordinate lookup with admitted newline masks — 2026-10-28

Keep the 256-unit sparse source checkpoints and add eight uint32 newline masks to each
checkpoint. A lookup counts the set bits through its requested offset and finds the
last line boundary with `Math.clz32`, examining at most eight words. It preserves CRLF
as one line ending, excludes one initial BOM and counts UTF-16 columns exactly. A
boundary at the checkpoint itself is already included in its stored line/start. The
population count includes sign bits without signed-mask truncation. Index construction
still yields at the original 4,096-unit boundaries; validator node/array/lexical checks
and scheduler clock checks remain in place.

The caller reserves both checkpoint arrays and all eight masks before construction.
The index ownership weight changes from `256 + checkpointCount * 8` to
`384 + checkpointCount * 40`: 33,032 to 164,264 bytes for a 1 MiB source. This is an
explicit workspace tradeoff under the existing ceilings, not a measured physical peak
or portable aggregate-memory calibration. Tightly budgeted callers may reject earlier;
no limit is raised. Tests cover dense newline words, bit 31, CRLF/checkpoint boundaries,
invalid offsets, BOM and surrogate coordinates.

Fifteen independent coordinate fixtures verify 215,475 selected offsets. All six full
native roots retain exact traversal/observer order, advance counts and 60 cancellation
checks. An isolated nested index-build/query diagnostic improves from 32.3 to 5.1 ms.
Ten fresh alternating minified application pairs retain 60 exact native revisions. Cold
receipt is lower in nine pairs, with a paired median change of -37.7 ms. Because producer
times shifted during the first five pairs, five separate confirmation pairs are retained:
all five have lower cold receipt, with paired median change -46.6 ms. Their cold readiness
medians are 2,477.0 / 2,419.9 ms before/candidate, while edit readiness medians are
503.3 / 508.1 ms. This is a cold-processing improvement; it does not establish an edit
latency gain or close the 150 ms receipt gate. Every old/new result remains in the record.

The retained runtime compiles to the measured candidate's identical syntax; only comments
differ. Current full-suite, ownership, native-output and rebuilt-release evidence is in
docs/validation/implementation-history.md and `test/artifacts/logs/source-point-mask-validation.json`. Native parser/renderer
admission, aggregate physical accounting and packed transport activation remain open.

### Reject shared reader-key arrays without application gains — 2026-10-28

The prototype returns the already frozen primitive-only key list after the same complete
key-cost admission, rather than freezing another copied array. Only the renderer capture
module varies in five fresh alternating application pairs; the Worker explicitly retains
the original capture body and emitted Worker bytes are identical. All 30 complete native
revisions, full/delta/delta handoffs, caches and disposal invariants agree. Nevertheless,
cold receipt is slower in three pairs. Its median moves from 1,268.6 to 1,235.2 ms while
edit readiness rises from 513.6 to 521.8 ms and edit receipt from 193.4 to 202.8 ms.
This does not justify retaining the change or revising the existing copying contract.

Both variants pass exact key-budget checks, frozen primitive-only output, hostile own
key names, expired/released scope checks and synchronous release inside a budget getter.
Twenty-four explicit-GC probes retain 78 key/scope/callback/iterator handles without any
of their 72 actual arena/revision/source witnesses surviving disposal. Candidate-focused
tests pass 830 cases. These results verify the tested ownership behavior, not peak memory,
portable admission or an application latency gain. The prototype stays under `test/artifacts/logs/`.
All 486 current application/config/tool inputs, 237 runtime files, 215 workspace source
files and current ASAR/NSIS artifacts are unchanged. Evidence is bound in
`test/artifacts/logs/shared-reader-keys-validation.json`; current release gates remain open.

### Complete validator cleanup before reporting failure — 2026-10-28

Extend the existing all-release cleanup helper to description/word validation, reused
metadata streams, baseline summary frames and active baseline inspections. Attempt
every release even if an earlier one throws. Preserve the original validation/observer
failure when unwinding; otherwise preserve the first cleanup error with an explicit
failure flag, since thrown `undefined` is still a failure. Clear baseline/reuse state
before calling fallible cleanup. Closed reuse helpers drop source/baseline references
and reject later prune work. Schema, budgets, native fields and scheduler yields remain
intact.

Fourteen regression cases exercise these paths, with thirteen failures against the
archived preceding modules. A GC diagnostic found that cursor closure alone left the
reuse helper retaining its source. After clearing that state, 28 current fault probes
keep 236 closed objects and callbacks while all 84 actual source/revision/arena witnesses
collect after disposal. This verifies the tested lifetimes, not native peak or aggregate
memory calibration. Release and complete native-output evidence is recorded in
docs/validation/implementation-history.md and `test/artifacts/logs/validator-cleanup-validation.json`. Packed activation and
full application delivery remain gated by the outstanding acceptance requirements.

### Reject uint32 unrolling after confirmation — 2026-10-28

Keep the existing bounded uint32 loop. An explicit five-byte termination-branch
prototype preserves independently encoded values, canonical/truncation errors and
cursor state across 1,000,018 canonical and 87,849 adversarial cases, and passes
1,463 injected focused tests. Both actual Worker and renderer use the corresponding
reader in ten fresh alternating minified application pairs. All 60 complete native
revisions, 40 direct deltas, caches and disposal invariants agree.

Initial cold receipt is lower in three of five pairs, with paired median change
-41.1 ms. In the separate confirmation it is slower in four of five, with paired
median change +41.6 ms. Across all ten pairs, receipt has paired median change
+17.5 ms and cold readiness +19.2 ms; edits also have positive paired changes.
Do not retain the larger implementation from the initial subset. The measurements
do not explain why the timings differ or close any latency gate. Full results are
in `test/artifacts/logs/varint-unroll-all-service-comparison.json`; the source/release checkpoint
remains unchanged. Evidence is bound by `test/artifacts/logs/varint-unroll-validation.json`.

### Direct propertyless HTML shells — 2026-10-28

Spell the default shells for lower-case `blockquote`, `p`, `strong`, `em`, `del` and
`code` directly when the stable HAST is in HTML space and has no enumerable properties.
Check with `for...in`, including inherited properties and the empty property name.
Keep the pinned upstream serializer for every property-bearing element, other tag and
SVG context. Preserve empty-content spelling, every emitted chunk and progress yield,
native fields, traversal limits and workspace reservations. Add no retained cache.

Ten fresh alternating minified application pairs preserve all 60 complete native
revisions and 40 direct deltas. Actual Worker bytes are identical in both variants;
this serializer is in the renderer graph. Cold receipt is lower in nine pairs, with
paired median change -47.8 ms, and cold readiness is lower in eight, with paired
change -59.6 ms. Edit readiness is lower in five pairs; claim no reliable edit gain.
Cold receipt remains about 1.24 seconds, far above the unchanged 150 ms gate.

Keep the measured string-concatenation implementation with two local `useTemplate`
style suppressions. A separately measured template-literal variant is lower in only
two of five cold receipts, with paired change +12.1 ms; edit readiness has paired
change +15.9 ms. Preserve that rejected variant and all its results rather than
substitute its different compiled code. These observations do not establish why the
timings differ. The final authoritative integration emits the exact renderer and
Worker bytes used by the retained prototype.

Independent upstream and native-renderer oracles verify 1,568 edge fixtures and both
HTML policies across all six complete corpora, including every progress/chunk emission
and matching upstream errors. The retained source passes all 11,170 unit tests with
one intentional skip and all 126 complete native revisions with 120 direct deltas.
Release evidence and remaining gates are recorded in docs/validation/implementation-history.md and
`test/artifacts/logs/propertyless-shell-validation.json`. Packed activation and full application
delivery remain gated by the outstanding acceptance requirements.

### Fused document and exact output cleanup — 2026-10-28

Apply the existing all-release cleanup rule to the fused document/prose collector and
exact projection-output validation. A failing word-buffer close must not skip release
of its resizable workspace. A failing HTML cursor close must not skip the predecessor
HTML cursor, active widget cursor or layout iterator. Preserve the original comparison,
observer or revocation failure through each enclosing cleanup scope; otherwise report
the first cleanup failure, including thrown `undefined`, after all releases finish.
Detach a completed widget cursor before its fallible close so unwinding cannot close
that cursor a second time. Retain schema, native fields, budgets and scheduler yields.

Twenty-two fault cases fail against the archived preceding modules. The corrected
implementation passes 209 focused tests and all 11,192 unit tests with one intentional
skip. Forty-four lifetime probes keep 3,220 closed objects and bound methods alive;
none of their 180 actual source/arena/revision witnesses survives disposal and explicit
GC. These are tested ownership/lifetime results, not physical peak or portable aggregate
memory calibration. Current native-output and rebuilt release evidence is recorded in
docs/validation/implementation-history.md and `test/artifacts/logs/receipt-cleanup-validation.json`. The full application
goal and its remaining acceptance gates stay open.

### Rejected arena-local own-field query — 2026-10-28

A shape-only presence query avoids decoding a field's preceding value references without
adding storage, changing complete field access or exporting an arena key table. The isolated
prototype preserves 76,547 before/candidate query results/errors and passes 885 focused
tests. Five fresh alternating mounted application pairs preserve all thirty complete native
revisions and twenty direct deltas, with actual candidate source in renderer and Worker.
Cold receipt is lower in only three pairs, with paired median change -1.2 ms. Cold readiness
has paired change +22.1 ms and edit readiness +8.0 ms. Reject the prototype; no authoritative
application source or release artifact changes. Current evidence and unchanged open gates
are recorded in docs/validation/implementation-history.md and `test/artifacts/logs/field-presence-validation.json`.

### Array inspector and projection baseline cleanup — 2026-10-28

Array inspection now attempts its workspace release after a lookup close throws, and its
delegating guard preserves an earlier failure while closing the work. Projection-baseline
classification similarly attempts every nested frame, layout reader and workspace release.
An existing failure takes precedence; otherwise the first cleanup error wins, including
thrown `undefined`. Baseline lifetime closure also attempts its metadata-hold release after
the close fails. Completed layout readers detach and close before a baseline can take
ownership, preventing unreachable unpublished metadata from retaining a reservation.

All twelve new fault cases fail against the archived preceding modules. The corrected
paths pass 125 focused tests and restore exact pre-task ownership. Twenty-four explicit-GC
probes hold 2,096 closed tasks, lookups, baselines, certificates, borrowed scopes and bound
methods; all 72 actual source, arena and revision witnesses collect after disposal. This
establishes scoped cleanup/lifetime behavior, not physical-memory admission. Full validation
and release evidence are recorded in docs/validation/implementation-history.md and
`test/artifacts/logs/reader-baseline-cleanup-validation.json`; the full application gates remain open.


### Rejected atomic schema dispatch — 2026-10-28

An isolated schema dispatch prototype avoids a delegated generator for synchronous rules,
retains cooperative table/math validation and preserves the exported generator adapter.
Fixed per-schema cooperative flags add no per-document cache. Fidelity checks match all
2,275,741 reader/iterator queries and 389,382 yields over 1,609 comparisons, including
complete corpora, pinned CommonMark examples, schema mutations and cancellation/failure
paths. All 309 focused tests pass with both candidate modules verified as loaded.

Five fresh alternating mounted application pairs preserve thirty complete native revisions
and twenty deltas with byte-identical Workers and unchanged caps/caches. Cold receipt has
paired median change -0.6 ms, with only three pairs lower; edit receipt is slower in every
pair, with paired change +2.9 ms. Cold readiness changes +8.3 ms and edit readiness +17.6 ms.
Reject the prototype without installing it. All 486 authoritative inputs and release
artifacts retain the preceding cleanup checkpoint. A separate current source-bound CPU
diagnostic locates work in receipt/context/output validation; sampled inclusive timings
overlap and do not prove unprofiled acceptance or physical-memory admission. Evidence is
recorded in docs/validation/implementation-history.md and test/artifacts/logs/atomic-schema-validation.json. The full application
goal and all remaining acceptance gates stay open.


### Text comparison decoder cleanup — 2026-10-28

Comparison cleanup now attempts both decoder returns after a close throws, preserving an
existing failure or the first cleanup error, including thrown undefined. The outer helper
owns the first decoder until the second opens and then transfers both together. Setup
failure closes the first once while preserving the setup exception; after transfer, the
outer helper no longer closes it twice. Field/schema/equality checks, budgets and scheduler
checkpoints remain intact.

All ten new real decoder fault cases fail against the archived helper. Current cases
restore exact ownership and leave terminal handles inert. The preceding helper leaves one
reader, 313,908 additional retained-charge bytes and 305,168 staging-charge bytes until
capture release. Twenty lifetime probes hold 224 closed objects/bound methods; all sixty
actual source/arena/revision witnesses collect after disposal. This is scoped lifecycle
evidence, not physical-memory admission. Complete current unit/native/packaged/installer/
performance validation, the initial timeout run and unchanged open acceptance gates are
recorded in docs/validation/implementation-history.md and test/artifacts/logs/comparison-cleanup-validation.json. The full
application goal remains active.


### Reject shared subtoken jump dictionary — 2026-10-28

A fresh actual ordinary Worker CPU trace attributes substantial many-small-block parsing
work to subtokenization/resolution. An isolated dependency prototype writes subcontent's
jump entries directly into its caller's existing pass dictionary, avoiding one temporary
map and immediate Object.assign per resolved chunk. No tokenization, native field, schema,
geometry, cache or transport limit changes are proposed.

All 13,496 complete document/projection/layout comparisons pass across both actual
dependency exports, grammars and raw HTML policies. Five fresh alternating minified
ordinary Worker pairs preserve all 210 complete native revisions. Warm parse has paired
median change -4.65 ms, but Worker round trip changes only -1.00 ms and improves in three
of five pairs. Reject the prototype without installing it or extending the pinned patch.
The mixed Worker timing does not prove mounted or packaged freshness acceptance.

All 486 authoritative inputs, installed parser dependency sources and Windows artifacts
retain the text-comparison-cleanup checkpoint. Existing packaged many-small-block freshness
and nested failures remain open, along with the other full application gates. The separate
CPU diagnostic has profiler/binding idle time and inflated transportInMs; sampled inclusive
costs overlap and do not establish physical admission or normal transport timing. Current
evidence and limits are recorded in docs/validation/implementation-history.md and
test/artifacts/logs/shared-subtoken-gaps-validation.json. The full application goal remains active.

### Reject single-range subcontent replay — 2026-10-28

An isolated pinned-subtokenizer candidate reuses the existing detached child-event array
when linked-chunk resolution produces one range, avoiding its slice and temporary jump
pairs. All tokenization, linked-chunk processing and multi-range behavior remain. Complete
native outputs match in 13,496 document/projection/layout comparisons, 128 whole/streamed
public-event comparisons and all 420 revisions in ten actual ordinary Worker pairs.
The Worker round trip is lower in only 6/10 pairs, with paired median change
-2.50 ms and a higher across-process median. This does not establish a reliable gain,
so the candidate is rejected and not installed. All 486 authoritative inputs, both installed
exports, caps, activation policy and current release artifacts remain unchanged. Exact
evidence and timing limits are in docs/validation/implementation-history.md and
test/artifacts/logs/single-span-subcontent-validation.json. Full application delivery remains gated.

### Finish publisher and producer cleanup after close failures — 2026-10-28

Experimental publisher resync cancellation could leave an extra capture/metadata hold
after closing its real child and receiving a close error. Producer cancellation could
leave a queued source request and non-idle phase. Both coordinators now attempt every
remaining owned release and clear their controller references, preserving the first
cleanup failure including undefined. Shared PackedWork precedence is unchanged.
All 34 new cases fail on archived code and pass with the fix; the complete suite passes
11,248 tests. Thirty-four GC probes retain 410 closed handles while all 384 observed
actual graph/output objects collect. The actual Worker passes 126 complete native
revisions and 120 deltas against its independent oracle. All 75 packaged UI flows and
Windows installer lifecycle checks pass. All 237 production runtime files remain
byte-identical because the packed pipeline stays disabled. Physical/native aggregate
admission and full application delivery remain gated. Exact artifacts, performance
results and limits are recorded in docs/validation/implementation-history.md and
test/artifacts/logs/publisher-cleanup-validation.json.


## Render the initial native projection one body block at a time — 2026-10-28

The experimental packed producer now uses the existing ProjectionSequence for complete
initial rendering. Definitions are collected in preorder; one renderer state preserves
global references and footnote counters through all body blocks and the final footer.
Complete HTML, widgets and layout remain equal to the independent full renderer. Custom
root-wide data overrides use the existing full renderer. The ordinary transport is unchanged.

Five alternating application pairs preserve 180 native revisions / 120 deltas. Nested
initial readiness is lower in all five pairs, with a 106.7 ms median paired reduction;
edit observations do not establish improvement. On the retained implementation, the
largest nested policy input graph is 54 nodes instead of 179,496. This bounds one owned
policy graph in that corpus, not cumulative allocation, pending garbage or physical memory.
Native input, global state, large single containers/footer and accumulated output still
need admission. The final 126-revision audit, 11,263 passing units, 75 packaged flows and
Windows installer pass. Production runtime bytes remain identical because packed semantic
transport remains experimental. Native/aggregate admission, latency, ordinary nested Live
and full delivery remain gated. Detailed artifacts and limitations: VALIDATION.md:15241.


## Observe the actual initial block HAST in native diagnostics — 2026-10-28

The native construction driver previously paused only in the complete-HAST path bypassed
by the new initial block renderer. Its archived nested run preserves full semantic output
but fails the required ten-boundary assertion. The repaired driver pauses at the first
non-heading body HAST in shared policy, checks its exact source range, counts every body
and footer graph, and binds the initial/sequence renderer as two additional actual sources.
Both ordinary and allocation-sampling complete runs preserve 24 native revisions / 12
deltas and 120 boundaries; 54 raw sampling profiles have verified hashes. Corresponding
native hashes, numeric counters, eight source bindings and emitted bundles match across
modes. The current nested first body has 54 HAST nodes; MDAST completion observes about
115.20 MiB used heap, including pending garbage. These observations do not calibrate
physical admission. Application inputs and existing verified release artifacts remain
unchanged. Full delivery gates remain open. Current evidence: VALIDATION.md:15383.

### Hand off compiled native blocks without retaining the full root

An internal `markdownBlockSteps` API now yields completed top-level MDAST children
and returns a final summary containing the exact root metadata, descriptors, outline,
counts, source hash and parser version. It shares the frozen grammar selection with
the ordinary whole-tree parser. The private pinned compiler tokenizes the full source
first, preserving forward reference/footnote resolution, then resolves and compiles
balanced spans with shared compiler state. It detaches completed children before
handing them off and clears each consumed slot. Independent mutable position objects
and every semantic field remain present. The application producer still calls
`parseMarkdown`; wiring streamed children into one packed snapshot is outstanding.

This third compiler is opt-in through an additional private option. It supports the
fixed application grammar and the block-local GFM autolink transform. A whitelist
derived from a separate GFM-only processor rejects new application transforms, and
replacement roots fail. The existing whole-tree private path still applies all
transforms once over the complete root; ordinary extensions retain that contract.
The original published compiler remains the independent source reconstruction oracle.

The stream describes blocks before yielding them, uses the existing source/node/block
limits and counts words with one complete-prose segmentation at finalization. Cancellation
revokes its handle and closes nested generators. Separate lifetime observations show
that earlier handed-off nodes can collect while the stream is active, and that held
closed handles do not retain the observed native nodes. These are reachability results,
not physical peak measurements. Complete document and projection/layout comparisons
under both grammars, HTML policies and parser exports pass.

The remaining producer work must encode the streamed children into one complete packed
root, then render from that owned snapshot with global definitions/footnotes available.
It must preserve independent whole-document oracle equality, exact timing checkpoints,
admission before allocations and aggregate ownership. Complete source tokenization,
possibly whole-source spans, accumulated descriptors/prose, final segmentation and
render output remain atomic or unadmitted. This change does not activate packed semantic
transport or close the nested-container packaged performance gate. Commands and current
validation evidence are in `docs/patches/parser-lifetimes.md` and `docs/validation/implementation-history.md`.

## Encode complete semantic documents from owned arrays — 2026-10-28

The internal `packMarkdownDocumentSteps` composes `markdownBlockSteps` directly with
one MSP2 encoding. It hands each completed native child to the ordinary record encoder,
then drops that child before pulling the next one. Shapes, scalars and position records
share the same document-wide tables. It preserves the entire SemanticDocument, including
root positions, descriptors, outline, counts, source identity, parser version and timings.
Private position/count/timing containers receive the parser's final summary before the
encoder visits them. Descriptors and outline use separate declared array inputs; no
complete native children array is assembled.

`PackedArrayInput` transfers single-use iterator ownership atomically after validating
and admitting the registry. Unknown-length arrays require the existing encoder working,
node and depth limits as well as the wire cap. Every source advance suspends before its
returned child or completion can be encoded. Array record identities remain available
after ordinary memo eviction. Cancellation closes every declared input, including unopened
revocable work; cleanup attempts all inputs and preserves an existing encoding/source
failure. A closed handle drops its source and completion callback.

The complete packet remains private until parsing, final metadata and encoding succeed.
Exact-byte comparisons with the independent whole-tree parser/ordinary encoder and full
render/layout comparisons cover both grammars, both HTML policies, both parser exports,
all CommonMark examples, all six full diagnostic corpora, extensions and seeded inputs.
Separate forced-GC diagnostics hold encoder and input handles while observing native nodes,
child arrays and positions; they compare complete packets without decoding a root.

This helper does not yet replace the producer's full native parse/render path. Connecting
it requires rendering from the packed document and composing the final document/projection/
layout result while charging the intermediate packed data and other live consumers to the
same existing owner. An extra independent session must not bypass the producer's aggregate
limit. Tokenization, possibly whole-input spans, native compiler construction, semantic
metadata/prose, segmentation and accumulated render output still need admission before
allocation and portable calibration. Transport activation and full performance/distribution
acceptance remain open. Current commands and evidence are in `docs/validation/implementation-history.md`.

## Build complete producer results through the existing packed owner — 2026-10-28

The experimental producer now uses `encodeProducerFull` for full construction and full
recovery. The earlier descriptions of its full native parse/render path are historical.
It streams compiled children into a complete packed SemanticDocument, stages that packet
under its existing request, completes document validation, renders into an internal chunk
spool and assembles the complete public document/projection/layout packet. Both intermediate
captures, reader workspaces, chunk/layout/widget metadata and output reservations share the
same existing 16 MiB session owner. Staging neither commits a result nor changes the request
ticket; only the existing transfer and exact acknowledgement path can publish the result.

The coordinator retains neither a full native MDAST root nor joined document/widget HTML.
The renderer keeps its shared global reference/footnote state while consuming one native
body at a time. The internal event spool contains bounded HTML chunks and complete layout
metadata. Final assembly indexes widget ranges with admitted numeric storage, preserves
last-wins source-range behavior and replays text directly into the canonical record encoder.
Compact guarded array indexes avoid retaining a native view for every spool event. No raw
arena/view or complete decoded document crosses the captured-input adapters.

Captured and native strings share an emitted-byte interning table. Hashes only select
candidates: equality checks every canonical JSON byte, including UTF-16 surrogate pairs
split across chunks. Replayed inputs remain private until all stages succeed. Output
allocation is reserved before allocation and suspends before publication so cancellation
can revoke it. Completion and failure attempt every nested cleanup; independent old captures
continue to count against the same session cap.

Re-encoding repeated immutable records initially exceeded the real Worker's five-second
watchdog on the complete nested corpus. A paged record cache now reuses completed output IDs
by source-free arena token, record ID and lazy transform. It admits every page before
allocation, shares the existing serialization implementation and retains no arena backlink.
Distinct arena namespaces and position/range transforms remain separate; full value
interning still determines sharing between different records. New tests preserve canonical
bytes across those cases and bound long-text replays for repeated aliases. The watchdog,
corpus, output fields and memory limits have not changed.

Large native text also exposed a reader-slot mismatch: the old rendering workspace opened
one slot per 64 KiB reservation quantum, exhausting the Worker's 64 slots before its byte
budget. Construction/serialization scratch now uses one capture-owned resizable slot,
preserving the rounded byte reservations and admission before growth. Denied growth leaves
the preceding reservation intact; shrinking and closure release it. Full-producer diagnostics
now use the actual 64-slot limit and both 4 KiB host/endpoint holds, replacing the earlier
160-slot diagnostic configuration. A complete one-MiB paragraph regression checks the full
document, HTML/widgets/layout and canonical packet under that limit.

Capacity tests now create temporary consumer pressure inside the actual 16 MiB owner,
then require observed cache eviction before releasing pressure for a full recomputation.
Previously tiny test owners could succeed because full native parse/render allocations
were outside their ledger. Accounted render scratch can now reject those permanently tiny
configurations; the production cap is unchanged.

Packed transport remains disabled in ordinary production. Native tokenization, potentially
whole-input compiler spans, transformations, semantic metadata/prose and final segmentation
still need allocation admission and calibration. The encoder's separate logical 32 MiB
working ledger is not an aggregate physical process bound. Native key enumeration remains
atomic and is charged after enumeration. Full application latency, physical/aggregate memory,
remaining features, hardware/accessibility acceptance and distribution gates remain open.
Current commands and release evidence are recorded in `docs/validation/implementation-history.md`.


### Yield native children before compiling future siblings — 2026-10-28

The experimental complete producer's native parser now yields each completed top-level block
inside its resolved span. It waits until the current event's handler and exit listeners have
finished and both compiler stacks are closed at the root, then applies the existing explicitly
audited block-local transform, detaches children and clears consumed private event slots before
yielding. Full source tokenization and span list preparation stay intact, preserving forward
definitions, list spread, footnotes, positions, compiler data and all semantic/output fields.
Ordinary and whole-tree span compiler behavior is unchanged; generic cross-block extension
listeners and whole-root transforms remain unsupported by the additional private stream path.

The failing construction regression measured 2,001 paragraph entries before the first yield;
it now measures one, and cancellation prevents later entries. The current mounted Worker probe
observes maximum accumulated root children of one for every full corpus, versus 16,385 for
many-small-blocks before this change. Final node/event/position constructor totals and complete
oracle hashes are conserved. Complete helper/producer fidelity, held native/arena GC probes,
126 persistent-Worker revisions, current packaged/installer checks and remaining performance
failures are recorded in the corresponding validation section and source-bound
`test/artifacts/logs/early-block-yield-validation.json`.

This reduces eager native sibling accumulation. It does not admit or bound full tokenizer,
resolver, prepared-event, individual container/HAST or segmentation allocations. All original
caps and the watchdog remain unchanged; packed activation and the ordinary nested performance
gate remain open. Future work must preserve complete semantics while addressing these native
construction stages and validating actual physical admission before broad activation.


### Private document tokenizer suspension — 2026-10-29

The complete experimental producer now propagates actual native document-tokenizer progress
through its trusted streamed-array input. A private tokenizer generated from the pinned state
loop dispatches at most 4,096 root input codes before yielding. Original preprocessed chunks,
buffer indexes, definitions and lexer state survive suspension; compilation still waits until
EOF processing completes. Only the private root context receives the stepping method, and
ordinary tokenizer/compiler methods remain unchanged. Progress contributes no JSON array
element. Closing the outer work revokes the parser and clears pending chunks/document events.

Splitting source chunks was rejected after full nested references and development footnote
assertions exposed the lexer's original chunk invariant. Minimal regressions preserve that
failure. State-loop suspension conserves all preceding constructor totals and complete oracle
output. The actual Worker first-pause observation has zero MDAST handler entries; the actual
producer cancellation probe observes 344 tokenizer contexts collect while holding
closed work/input handles. Full helper/producer fidelity, native/arena GC, 126 service revisions
and rebuilt packaged/installer evidence pass; details are in the matching validation section.

The dispatch budget enables cancellation during document tokenization. It does not bound
child flow/EOF work, preprocessing, span resolution, individual native blocks/HAST or prose
segmentation, and supplies no calibrated physical admission. All original caps/watchdog and
complete field/corpus scope remain unchanged. Packed activation, ordinary nested performance
and full application/distribution acceptance remain open.


### Bounded descriptor hashing and scalar predicates — 2026-10-29

Keep per-unit hash arithmetic in an ordinary helper bounded to 4,096 UTF-16 units, with
the existing generator checkpoints between chunks. Complete hashes and cancellation semantics
are conserved; the scalar encoder uses direct primitive predicates instead of a per-value
array. Full constructor/output evidence is unchanged while sampled allocation decreases;
the corresponding validation entry records the exact comparison and its statistical limits.
Six boundary/cancellation cases, all 16,705 units, full producer/native/arena comparisons,
126 service revisions, rebuilt packaging and installer checks pass. The full nested sampling
watchdog and ordinary nested performance still fail. No resource limit or activation gate is
relaxed; native/aggregate admission and full platform/distribution acceptance remain open.

## Indexed complete-arena paths — 2026-10-29

The complete-arena fast path indexes each segment rather than creating an iterator for
every short path and empty prefix. Field/type/numeric bounds checks and failure order are
preserved. Overlay/shift/range paths retain their existing behavior. No record encoding,
field set, grammar, resource cap, watchdog or activation setting changes.

All complete producer comparisons, lifetime probes, 126 untraced service revisions and
77 packaged flows pass. The first full sampled construction run after the change also
completes all six corpora and twelve revisions, with one Worker per case and no failures.
At matching nested projection-spooled boundaries, total cumulative sampled allocation
changes from 2441.31 to 2231.30 MiB. Exact output/counters and emitted-helper source
bindings are retained. This statistical observation is not retained/physical memory,
portable admission calibration or an isolated causal timing result. Native/aggregate
admission and ordinary nested performance remain open; packed transport remains disabled.
Current complete evidence is `test/artifacts/logs/path-iteration-validation.json`.

## Cooperative original-chunk preprocessing — 2026-10-29

The complete experimental producer additionally selects `_manuslipBlockPreprocessSteps`.
A private whole-value preprocessor scans at most 4,096 UTF-16 source units before yielding,
then returns the identical original chunk sequence to the existing stepped tokenizer.
It preserves literal boundaries and lexer buffer indexes across suspension. Incomplete
chunks and the outer source binding are released on cancellation; ordinary preprocessing
and ordinary transport selection are unchanged. The public production/development
preprocessors are hash-pinned as unchanged fixtures, with the preceding private compiler
reconstructed exactly for upgrade/compatibility checks.

The 6,756 complete producer comparisons, both grammar/export matrices, 41 new regressions,
24 preprocessing-array/356 tokenizer-context lifetime witnesses, 126 persistent-Worker
revisions, 77 packaged flows and installer checks pass. Both normal and allocation-sampled
actual Worker probes complete all six corpora with 72 boundaries; the first new pause is
before tokenizer input or MDAST construction. These observations do not establish a time
bound, all-allocation coverage or physical admission. Byte decoding, literal slicing,
array storage, flow/EOF resolution, span preparation, native blocks/HAST and whole-prose
segmentation still need admission/scheduling work. Native/aggregate memory admission,
ordinary nested performance and platform/release gates stay open. Packed transport remains
disabled. See `test/artifacts/logs/preprocess-steps-validation.json` for current bound evidence.

## Cooperative complete-prose iterator — 2026-10-29

After complete native block handoff, the experimental parser yields before joining prose.
It consumes the same single complete Intl segmentation in groups of at most sixteen native
iterator next calls, including EOF. It keeps whole-prose dictionary/context behavior, clears
private text references after joining/on closure, and excludes parked time from describe
timings. Source guards, grammar, all semantic fields, counts, encoded results and limits are
unchanged. Ordinary parsing and transport selection retain their existing behavior.

The complete 6,756-comparison producer matrix, 6,748 block comparisons, six new regressions,
126 persistent-Worker revisions, 77 packaged flows and Windows installer checks pass. Both
normal and sampled Worker diagnostics complete all six corpora at 78 boundaries. Separate
GC probes prove actual iterator ownership at the sixteen-call pause and collection of all
twelve observed Segments objects/twelve iterators after cancellation while 408 work/input
handles stay held. Existing native/chunk/tokenizer/arena closure checks also pass.

The scanner/count loop checkpoints do not bound an individual native call or admit physical
memory. Source sizing/hashing/grammar scans, decoding/slicing, array storage, flow/EOF and
span work, native blocks/HAST, whole-prose joining and individual Intl calls remain atomic
or unadmitted. Native/aggregate admission, ordinary nested performance, cold receipt/freshness
and platform/release gates stay open. Packed activation remains disabled. Current evidence
is `test/artifacts/logs/word-count-validation.json` and the corresponding validation entry.

## Cooperative final source metrics — 2026-10-29

The experimental complete block producer combines final character counting and source hashing
in one scan, yields before it begins and after each 4,096 UTF-16 units, and carries surrogate
pair state across pauses. It preserves the independent ordinary parser's exact counts and
existing dual-32-bit source hash. Describe timing excludes parked time. Cancellation stops
the next source reads and closes the underlying parser; private outputs remain unpublished
until the complete summary succeeds.

Nine new regressions cover exact/partial batch boundaries, a split surrogate pair, return/throw
cancellation and read failure. Complete differential results, 456 held-handle lifetime checks,
the fourteen-source Worker probe (84 boundaries, 78 sampled profiles), 126 repeated service
revisions, 77 packaged flows and the Windows installer pass. The source/artifact verifier is
`test/artifacts/logs/source-metrics-validation.json`. Ordinary nested performance still fails through
the existing whole-root Source fallback. Earlier source guards/encoder hashes, grammar scans,
remaining native/aggregate admission, cold receipt/freshness and platform/release gates remain
open. Packed activation remains disabled; this step does not establish physical admission.

## Cooperative grammar selection before native parsing — 2026-10-29

The complete experimental block producer now owns a cancellable grammar-selection task.
Each bounded slice adds up to 4,089 UTF-16 units and seven units of context; native regex
inputs remain at most 4,096 units. The original regex semantics and all sixteen frozen
processors are preserved. CommonMark bypasses scanning, full enabled selection may finish
early, and a separate checkpoint precedes native parsing. The parser still receives one
complete source with global reference/footnote context. Active-only parse timing excludes
parked time, and parent cancellation closes actual private classifier work.

Seventy-six new regressions, complete differential outputs, 516 held-handle lifetime checks,
the fifteen-source Worker probe (90 boundaries, 84 sampled profiles), 126 service revisions,
77 packaged flows and the Windows installer pass. Ordinary parser/grammar functions and
the frozen processor construction remain byte-for-byte unchanged. Current proof is
`test/artifacts/logs/grammar-steps-validation.json`. Native slice/regex scratch, earlier source guards/
hashes, remaining native/aggregate admission, cold receipt/freshness, ordinary nested
performance and feature/platform/release gates remain open. Packed activation stays disabled.

## Revocable metadata work for complete native blocks — 2026-10-29

The complete experimental producer separates native block construction and metadata with
a checkpoint, then owns `markdownDescriptionSteps` until it returns its explicit
completion witness. Its range hashes preserve ordinary UTF-16 slice/hash semantics while
reading the complete original source directly in bounded groups. Metadata and heading
cursors preserve preorder without pushing an entire child array or recursively building
heading text. Shared budgets cap hash reads at 4,096 and cursor advances at 256 between
metadata checkpoints; either checkpoint resets both budgets. Existing cumulative guards
and complete native block handoff remain intact. Active timing excludes parked time.

The enclosing parser closes child work on every exit and rejects an incomplete child
before handing off its native block. Fourteen held actual child handles close with their
parent, including two cancellations after 4,096 range reads; 28 actual body/metadata owners
are observed live while suspended and collect after closure. Full independent fidelity,
both parser exports, persistent revisions and the rebuilt Windows release are verified in
`test/artifacts/logs/description-steps-validation.json`. The ordinary parse/description/hash oracles
and six parser dependency pins are unchanged. This adds cooperative metadata scheduling
and observed closure, not calibrated physical admission. Heading/prose joins, native
construction scratch and aggregate ownership still require admission; ordinary packed
activation remains disabled and all existing caps/watchdogs remain in force.

## Revocable source capability and prepared encoder reuse — 2026-10-29

The experimental renderer's real SemanticService/packed-port path now prepares source
cooperatively. Identity/options are captured before yielding. One revocable scan combines
the exact UTF-8 cap and ordinary UTF-16 hash with at most 4,096 reads per checkpoint;
provisional source/request ownership is admitted before supersession and released on every
exit. A private WeakSet capability guards prepared entry points. A forged prototype, proxy
or clone cannot bypass validation or invalidate a valid request through beginPrepared.
The complete producer encoder reuses the authentic immutable cap/hash. Existing synchronous
APIs retain their immediate errors and pending-offer contracts.

All complete packet/HTML/widget/layout oracles, 16,915 unit cases and 77 packaged flows pass.
Actual source lifetime diagnostics hold 180 work/controller/callback handles; 72 immutable
request/metadata owners are observed live before closure and collected afterward. Normal and
sampled native runs bind 17 sources and preserve all complete revisions and constructor work.
These are scheduling, reachability and fidelity results; they do not prove physical peaks or
aggregate admission. Initial request JSON sizing and the legacy Worker source constructor
remain atomic, alongside the previously recorded native and acceptance gates. Ordinary
transport remains unchanged and packed activation remains disabled. Full evidence and
retained development failures: `test/artifacts/logs/source-preflight-validation.json` and the matching
`docs/validation/implementation-history.md` checkpoint. The complete application goal remains active.

## Independent Worker preparation and candidate promotion — 2026-10-29

The actual experimental Worker now uses receiveCooperative. A bounded metadata reader
snapshots the exchange without authenticating its claimed source digest. The internal
request factory captures fixed structured-clone fields, validates request/identity/sequence
metadata, and independently advances the existing 4,096-unit combined byte/hash scan.
A private completed-request capability grants prepared producer access only after a full
identity match. Structured clones, prototypes and proxies cannot acquire that capability.

The host keeps one active offer/cache task plus one latest source candidate behind one
revocable callback. They alternate; replacement candidates close the previous candidate.
Promotion first validates the complete source and admits its new ownership, then revokes
the earlier offer. Invalid or cancelled candidates leave the earlier offer ACKable. Pending
and active correlations are distinct, so cancellation and failure target their actual owner.
Legacy synchronous receive/prepare validation contracts remain available and unchanged.
Initial request JSON sizing remains synchronous on the new path.

Thirty-nine new regressions and 48 actual Worker lifetime observations verify this behavior.
With 336 handles retained, all 144 normalized owners collect after closure, all 144 original
input witnesses detach while queued, and twelve digest failures preserve an ACKable offer.
Native and persistent-service full hashes, package pins, installer and UI checks bind the
same frozen source set. Complete evidence: `test/artifacts/logs/worker-source-validation.json` and
the matching validation checkpoint. These observations are not calibrated physical or
latency admission. Limits, full-field semantics, ordinary transport selection and the
full M1–M4 scope remain unchanged; all unresolved application/release gates stay open.

## Exact request JSON budget in the shared source scan — 2026-10-29

The internal packed request path captures exact immutable data fields and validates only
bounded metadata synchronously. It subtracts the native JSON envelope spelling from the
unchanged 8 MiB cap and checks the remaining source budget during the independent renderer
and Worker source scans. UTF-8, JSON escaping and the ordinary identity digest share each
source read, with at most 4,096 reads per advancement. High-surrogate carry defers the JSON
decision until a low surrogate or EOF determines the exact spelling. No complete source
JSON string or encoded sizing buffer is constructed by the new path.

SemanticService discovers the new port capability before choosing its guard. New packed
ports queue source sizing; native and older ports retain the full guard before post.
Oversized queued requests release ownership and report a bounded recoverable result. Earlier
Worker offers remain ACKable and later requests use the same channel. Legacy synchronous
request, post/postCooperative, source and producer APIs preserve their errors and unknown
property/size contracts. The fixed internal shape rejects unknown fields explicitly.

Thirty-six new regressions, 48 renderer lifetime observations and 60 Worker observations
cover exact spelling/caps, scheduling, recovery and closure. With 240 renderer and 420
Worker handles held, all observed closed owners collect. Twelve renderer cap failures
collect while the port remains alive; twenty-four Worker failures preserve prior-offer ACK.
Complete semantic, package, installer and responsive UI evidence is indexed by
`test/artifacts/logs/request-sizing-validation.json`. Ordinary activation, physical admission,
performance and full M1–M4/platform/release gates remain subject to the recorded open work.

## Captured fields descend through guarded encoder frames — 2026-10-29

Captured objects retain their bounded field list and open only the next field for descent.
Private encoder frames receive the existing guarded reader directly; each captured array
element also enters its frame without another opaque adapter. The public value protocol
still accepts only declared privately branded capture adapters, and rejects bare readers.
Global source guards, revocable scopes, full canonical field/record order, exact interning
and native cycle detection remain. No raw view/arena or unguarded public input is added.
The conservative working weights, node/depth counts and existing suspension bounds remain.

Eight new regressions and complete 6,756 producer comparisons preserve exact packets and
all document/HTML/widget/layout fields. The focused GC probe holds 421 handles across 18
cases and witnesses all 90 source/identity/arena/transferred-buffer/index owners collect;
source/session cancellations collect before held work resumes. Actual full-producer and
renderer/Worker preflight lifetime proofs were rerun. Numeric weights and observed
reachability remain distinct from aggregate physical admission.

Native diagnostics now preserve interrupted markers, command durations and captured
profiles, and aggregate failures across revisions. Normal evidence binds 27 sources and
completes all twelve revisions. Allocation-sampling gate passed: false; ordinary
performance gate passed: false. Full details, failed targeted
captures, semantic/oracle checks, artifacts and UI evidence are indexed in
`test/artifacts/logs/snapshot-assembly-validation.json` and the matching validation checkpoint.
Ordinary transport remains selected; activation and the complete application/release
requirements remain open until their original gates pass.

## Native-copy visit state and admission callbacks — 2026-10-29

Private native-copy traversal now carries the next scope/path/depth in local state and
constructs its container frame directly. Incremental allocation admission calls a shared
workspace resizer and keeps numeric scratch costs. Complete immutable values, every old
checkpoint, exact weighted limits, decoder/reader-slot headroom, rounding/fallback and
revocation/cleanup remain enforced. No source cache or transport activation is added.

The 29-source selected pair preserves complete semantic hashes and estimates native-copy
subtree allocations at 249.3 → 220.6 MiB. Full allocation gate passed:
false; ordinary performance gate passed: false. Full semantics,
lifetimes, release artifacts and UI results are indexed in the matching validation
checkpoint. Statistical allocation/reachability evidence does not establish aggregate
physical admission or complete the original application/release scope.

## Reuse projection frames within each traversal — 2026-10-29

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

This changes allocation frequency inside existing admitted per-depth workspace. Every
weight, complete output, traversal/cancellation boundary and protocol cap is preserved.
Full allocation gate passed: true; ordinary performance gate passed:
false. Fresh fidelity, lifetime, service, package, installer and UI evidence is
indexed by `test/artifacts/logs/projection-frames-validation.json`. Packed activation remains off.
The original M1–M4 scope and physical/platform/distribution gates remain required.

## Traversal-owned HTML piece iterators — 2026-10-29

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

The planner and all original caps remain unchanged; iterator ownership fits its existing
admitted traversal workspace. Current full allocation gate passed: true; ordinary
performance gate passed: false. Full semantics, lifetime, package, installation
and UI evidence is indexed by `test/artifacts/logs/html-emission-validation.json`. Weighted,
reachability and allocation evidence do not prove aggregate physical admission. Full
M1–M4 and platform/distribution requirements remain open, and packed activation stays off.


## Completed private tokenizer ownership — 2026-10-29

The complete private block parser releases completed tokenizer closures only after
EOF resolvers finish. It keeps events, the shared parser, detached serialization and
detached stream slicing for subsequent subtokenization. Active tokenizers retain their
full streaming methods; the ordinary public parser keeps its complete contexts. Whole
roots, all positions/extensions, references/footnotes, descriptors, outline/counts and
full HTML/widgets/layout remain unchanged. No cap, watchdog or yield budget changed.

A separate source-bound explicit-GC probe distinguishes live construction ownership from
the earlier collectible allocation samples. The selected block-tokenized Worker boundary
falls 40.9 → 35.2 MiB after releasing private EOF
closures. Eight held-context before/after witnesses prove the actual constant column
table/resolver array collect only after new private completion, preserving slicing.
All complete semantics, positions and canonical output remain enforced. Four pinned
source files upgrade reproducibly; both public exports and original-source reconstruction
remain checked. Evidence: `test/artifacts/logs/native-ownership-validation.json`.

These measured live isolate boundaries are not a natural peak or portable/aggregate
physical admission. The native raw event/token graph still needs bounded ownership and
admission; complete fixed-source semantic and performance requirements remain intact.
Ordinary performance gate passed: false; sampling gate
passed: true. Packed activation and full application completion remain off.


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

Admit 64 fixed logical retained bytes for one positive last-field cache inside each immutable
arena. Cache exact (record ID, admitted own key) → record ID; use an undefined sentinel so
record zero works. Keep only existing admitted key strings. A cache hit skips key/reference
scanning; guarded capture/read-scope checks and complete document/HTML/widget/layout
validation still run. No public API, native graph promotion or transport activation is added.

The seven complete validator fixtures preserve 4,264,683 exact field results and 2,059,110
suspension checkpoints, while scans fall to 2,109,555 and skipped references to 2,650,348.
Every live arena baseline rises exactly 64 logical bytes. All 2,626 encoder comparisons keep
canonical bytes, 14,511,691 admission arguments and 621,896 pauses exact. The 48 actual
Worker revisions preserve complete native hashes. Nested cold readiness averages 4253.6 → 4173.6
ms over three ordered pairs; receipt remains well above the 150 ms gate. Timing observations
are mixed elsewhere and do not establish p95 or physical memory acceptance.

17,028 unit tests, both complete producer fidelity/lifetime branches, captured-input GC,
fresh Windows packaging, 79 packaged workflows, actual installation and nine UI states pass.
The 704-file archive and 15,461 predecessor evidence entries remain reproducible. Source,
injected images, emitted assets, installer and screenshots are bound by the proof at
test/artifacts/logs/receiver-dispatch-validation.json. The explicit 64-byte decoder reservation changes
admission accounting; all numeric caps stay fixed. Portable aggregate physical admission,
cold readiness/receipt, individual-call atomicity, platform/physical-accessibility/distribution
and full M1–M4 completion remain open. Packed transport stays inactive.

## Reject direct byte reads in the uint32 decoder — 2026-10-29

Keep the accepted bounded uint32 loop. A separate prototype replaced its byte() calls
with direct owned-buffer reads and the same explicit end-of-buffer checks. This was not
the previously rejected five-byte unrolling. All 1,000,018 canonical and 87,849 adversarial
inputs preserved exact values, errors and cursor state; 770 focused unit cases passed.
Three minified application pairs preserve 48 complete native revisions with exact
source/asset bindings. Nested cold readiness averages 4175.7 → 4203.6 ms, and reported
transport-out including receipt 1098.1 → 1100.0 ms. Other cases and edits are mixed.
Ordered controls and natural GC limit the timing evidence; no aggregate benefit justifies
retaining the prototype. Restore packing-bytes.ts byte-for-byte and preserve the rejected
candidate and measurements in test/artifacts/logs/receipt-walk-rejection.json. Do not repeat this change
without a new structural hypothesis or new evidence.

No byte ABI, numeric cap, cooperative suspension, admission or ownership rule changes.
The accepted immutable last-field cache and its 64 logical retained-byte reservation
remain. A subsequent native-checkbox UI refinement changes no core/renderer-semantic
inputs or ordinary emitted semantic Worker. Its full unit, Windows package, 81 workflow,
installer and UI checks are fresh; preceding source-bound codec/producer/lifetime evidence
is explicitly reused. See docs/validation/implementation-history.md and test/artifacts/logs/task-controls-validation.json.
Packed transport, physical admission and full M1–M4 acceptance remain open.

## Cooperative resolved-event compilation — 2026-10-29

Keep the ordinary browser endpoint unchanged. The experimental block producer explicitly
opts into cooperative resolved-event compilation. Span/serialization/list cursors pause
within 256 advances; nested list preparation shares the same counter. Event dispatch pauses
within 16 events, even while one complete top-level native block is under construction.
Complete shared parser/compiler state, global definitions, exact listeners and positions,
full list spread inference and early closed-block handoff remain. A backwards in-place
list-event merge replaces its full-list splice copy. Cancellation closes active span input
and events, nested generators, compiler stacks/data and the existing outer ownership chain.

The 700-item old/new probe falls from 95,198 event dispatches in one advance to 16 while
preserving the complete ordinary root hash. Both export conditions pass all 32 cancellation
cases and release 88 witnessed graphs with closed handles held. All 17,035 units, both full
producer fidelity/lifetime branches, captured-input reachability, 81 packaged flows and real
installation pass. The 96 actual minified Worker revisions cover both export conditions;
source binding caught development exports in the initial diagnostic and a separate explicit
production series verifies the actual production parser inputs. Production nested readiness
averages 4083.5 → 4144.1 ms and reported receipt 1110.6 → 1115.9 ms. This cost is retained for
bounded cancellation, with no speedup, physical-memory or latency acceptance claim.

The two compiler pins change; tokenizer/preprocessor pins and all caps stay fixed. A separate
patch module shares exact spelling edits with fixture restoration, whose published original
hashes are still verified independently. Both original and known previous installs reproduce
the exact new sources; unknown changes are rejected before writes. Details, hashes, failures,
actual source images, timings and package evidence: docs/validation/implementation-history.md and
test/artifacts/logs/compile-events-validation.json. EOF/postprocess resolution, individual native handlers,
transforms and allocation, aggregate physical admission, receipt/final assembly and full
M1–M4/platform/distribution gates remain open. Packed transport remains inactive.

## Cooperative native subtokenization — 2026-10-29

Retain the ordinary JSON endpoint while extending the experimental producer with a private
native-equivalent postprocessing callback. A shared 256-advance quota covers event walks,
copies and transactional gap edits. Private child writes forward 4,096-dispatch checkpoints
and yield at write boundaries. Global definitions, linked token chains, GFM task hooks and
complete output remain authoritative. Borrowed native contexts are not revoked by the new
child owner. The adaptation records the pinned upstream algorithm and its MIT notice.

Cancellation must close both event storage and native closure owners. Actual held child
generators exposed a retained argument array after ordinary context deletion. A clearable
input owner, private return/throw closure and captured-state release fix this, including
before-first-advance cancellation. Nonfinal successful writes retain state. The document
wrapper accepts already-revoked context cleanup. Exact recognized/original source upgrades
and independently pinned published original hashes remain required.

Final checks pass 17,049 units, 13,512 full producer comparisons, 268 lifetime observations,
68 new cancellation cases/288 collected witnesses, 48 actual production application
revisions, 81 packaged workflows, installation and fresh UI regression checks. Nested cold
ready/receipt-inclusive transport-out averages are 4234.5 → 4365.3/1115.4 → 1102.4 ms. Source-bound
measurements and the complete cost table are in docs/validation/implementation-history.md; no p95 or physical
admission acceptance is inferred. Opaque native calls, allocations, receipt/storage/final
assembly, calibration and the full feature/platform/distribution scope remain open.

## Cooperative native text resolution — 2026-10-29

Keep the ordinary JSON endpoint while extending the experimental producer with a private
native EOF callback. Pinned resolver function identities select data merging and line-suffix
resolution. A shared 256-advance quota covers event walks, whitespace/chunk scans, copies and
gap edits. Native order, deduplication, source positions, tabs, hard breaks and final trailing
policy remain exact. Other resolver calls receive boundaries only. The callback's revocable
owner clears incomplete input and releases context even when cancelled before its first step;
successful nonfinal native writes preserve linked state. Ordinary parsing is unchanged.

Final checks pass 17,082 units, 13,512 complete fidelity comparisons, 268 lifetime observations,
44 new cancellation cases/172 collected witnesses with 124 handles held, 48 production Worker
revisions, 81 packaged workflows, installation and fresh UI checks. Nested ready/receipt-inclusive
transport-out averages are 4356.6 → 4391.5/1122.9 → 1115.4 ms. Full source-bound measurements and the
small-block cost are in docs/validation/implementation-history.md; no p95 or physical admission acceptance is inferred.

The archive helper failed to preserve the preceding two binaries. Exact source and 237 runtime
recovery pass, but the reconstructed container's whole-ASAR identity fails and the old installer
is unavailable. This is recorded as two unavailable historical evidence entries; current package
content/workflows/installation are verified independently. New artifact copies are preserved.
All native opaque-call, admission, performance and full application gates remain open.

## Cooperative private inline resolution — 2026-10-29

Extend the experimental producer's existing private EOF callback with attention/strong and
GFM strikethrough resolution selected by actual native function identities. Preserve ordinary
native parsing and unknown inside-span resolver configurations. Use an explicit frame stack
for nested resolution and share one 256-advance quota across dispatch, scans/backtracking,
marker reads, copies/gap edits and nested text resolution. Revocable owners clear incomplete
input, pending arrays, active frame payloads and context on cancellation, including unstarted
work. Native point movement and native raw-chunk serialization behavior remain authoritative.
The adapted algorithms carry their upstream MIT notices; the native resolver files themselves
are unchanged and independently checked against integrity-verified published archives.

Direct complete-event checks, 17,135 units, 13,512 full producer comparisons and 268 lifetime
observations pass. Eighty-four new cancellation cases collect all 292 witnesses while 5,000
handles, tokenizer contexts and cleared frame records remain held. Three matched production application pairs preserve
108 complete revisions over all six unchanged full corpora. Nested ready/receipt-inclusive
transport-out averages are 4516.3 → 4547.2/1166.2 → 1176.6 ms. Preserve this cost evidence and
its diagnostic limits; no throughput, p95 or calibrated admission acceptance follows.

Other native constructs, link-label resolution, custom resolver configurations, exceptional
invalid/empty raw-chunk serialization and allocation remain opaque. Receipt/storage/final
assembly, aggregate physical admission and all original application/platform/distribution
gates remain open. The browser keeps its ordinary JSON Worker; packed transport stays off.
Source bindings, failed initial probes, release checks and preserved baseline/current binaries
are recorded in docs/validation/implementation-history.md and test/artifacts/logs/inline-resolver-validation.json.

## Bounded ascending arena field queries — 2026-10-30

The immutable arena now retains one bounded object-field cursor: its existing shape,
record identity, start/next byte offsets and latest field index/value. Ascending queries
resume after the preceding reference; reverse queries restart at the record's first
field. Each query seeks explicitly, so arbitrary atomic reads cannot move this saved
position. Suspended iterators continue to use independent readers. Missing queries do
not retain caller keys; invalid IDs and non-object records still reject.

The arena admits 128 fixed bytes for this state before indexing, 64 more than the old
single-field cache. Original retained/staging/message limits stay fixed. Both synchronous
and cooperative open paths preserve reordered reads, failed lookups, multi-byte references
and complete immutable values. Actual source-bound operation counts for one ascending
3/16/64-field pass fall from 9/152/2144 integer decodes to 4/17/65, with atomic reads
interleaved. This proves less prefix decoding, not general elapsed-time improvement.

Three alternating minified application pairs match all six full corpora and 108 initial/
edit revisions against the independent native packet oracle. Nested cold ready averages
4787.2 -> 4563.2 ms, while receipt-inclusive transport averages 1133.2 -> 1134.7 ms.
The two edit receipt means change 193.8 -> 186.6 and 144.1 -> 152.0 ms. CPU sampling
shows higher field self time in its cold sample, 14.2 -> 25.3 ms; profiling and a short
concurrent focused run can perturb that diagnostic. Results remain mixed. No throughput,
p95, latency acceptance or calibrated physical admission follows from these observations.

All 19,082 units, 89 packaged workflows, actual Windows installation and frozen runtime
reproduction pass. Complete validation, source positions, graph ownership and work quotas
remain required. Ordinary JSON remains the application's selected transport; packed stays
inactive. Native opaque-call/admission/performance gates and the full M1–M4/platform/
distribution scope remain open. Evidence: test/artifacts/logs/arena-fields-validation.json.

## Capture-owned array advances — 2026-10-30

Captured cooperative arrays now advance the metadata generator under their existing
parent reader handle, avoiding a second PackedWork forwarding call. The parent owns
revocation before the first advance, rejects reentrant next calls, clears the borrowed
item immediately on cancellation and closes an executing generator after its advance
unwinds. A cancelled result cannot publish another item. Standalone node/view work
keeps its independent PackedWork contract. Reader reservations, metadata checkpoints,
discarded-prefix accounting and all original limits remain unchanged.

Synchronous readers receive the same running-advance guard. Four regressions against
the preserved original capture implementation reproduce its attempted return into an
executing generator. Current tests cover both traversal modes, queued/item/checkpoint
cancellation, cleanup failures and owner cleanup precedence. Metadata traversal checks
also exercise the internal cursor across the complete transformed-array fixtures.
Forced GC collects all 65 actual source/identity/arena/buffer/index witnesses in thirteen
held-array probes, before closed handles resume. The independent captured-input encoder
probe collects all 90 witnesses while retaining 421 caller handles. These are reachability
checks, not calibrated aggregate physical memory admission.

Three alternating minified application pairs preserve all six full corpora and 108
initial/edit revisions against the independent native complete-packet oracle. Nested
receipt-inclusive transport means change 1116.3 -> 1124.2 ms, 202.0 -> 185.2 ms and
145.6 -> 161.1 ms. Separate CPU samples reduce forwarding-wrapper self time from
68.0 -> 45.2 ms for the initial snapshot and 13.1 -> 3.4 ms for the edit. The mixed
complete-run timings establish no general speedup, original latency/p95 acceptance
or physical memory acceptance. Readiness polling can include optional cache work after
publication. Ordinary JSON remains selected and packed transport remains inactive;
all remaining native/performance/application/platform/distribution gates remain open.
Evidence and release validation: test/artifacts/logs/capture-iteration-validation.json.

Static checks/build, 19,131 source-bound units and all 89 packaged workflows pass,
with one existing Windows POSIX-permissions skip. Actual Windows installation verifies
79 installed files, two launches, exact Unicode/BOM/CRLF save and prior-state restoration.
Final acceptance of this increment also requires the frozen-source runtime comparison
and independent evidence verifier recorded in that proof.

## Actual Worker CPU profiling and rejected string shortcuts — 2026-10-30

The reusable semantic-service diagnostic accepts `--worker-cpu`. Electron main's
debugger attaches to the actual dedicated application Worker before its first script.
It samples each original full/delta request through renderer readiness, stops before
diagnostic hash materialization and confirms disposal between corpora. Separate
unminified assets, exact loaded sources, native Node oracle dependencies, CPU profiles
and their hashes are retained in a unique `test/artifacts/logs/semantic-service-worker-cpu-*`
directory. Production export conditions apply. Other instrumentation modes run
separately. Initialization failures resume paused targets; cleanup detaches the debugger.

All six complete corpora and 18 initial/edit revisions pass the independent native
complete-packet, count and outline oracle. Fault injection verifies resumption after
profiler initialization failure, revision correlation and cleanup. These observations
do not establish latency/p95, throughput or calibrated physical admission acceptance.

Two immutable string shortcuts, at 512 and 4096 UTF-16 units, were measured and
rejected. The final candidate's three alternating complete-corpus pairs show nested
cold serialization means 1779.2 -> 1794.2 ms and ready means 4350.4 -> 4366.3 ms.
Separate actual Worker samples show essentially unchanged total active time. Both
production files are restored byte for byte; candidate code, tests and raw evidence
remain archived. The retained tool's baseline sample attributes much larger costs
to encoder traversal and clock reads. No codec change or general speedup is claimed.
Ordinary JSON remains selected; packed transport and all original activation gates
remain unchanged. Evidence: `test/artifacts/logs/worker-profiler-validation.json`.

## Reference lists for live encoder containers — 2026-10-30

Every encoder frame keeps a reference-list slot initialized to undefined. The list
is allocated only when the frame reaches container traversal. Scalars, positions and
completed aliases finish without an empty child-reference array. All frames retain
their original 192-byte construction charge, node/depth visit accounting and per-edge
weights. Canonical records, output bytes, yield sites, cancellation and host clock
checks keep their existing contracts. This reduces unnecessary array construction;
the ledger remains an explicit weight rather than calibrated physical admission.

The first variant omitted the slot until container entry. Its three complete-corpus
pairs show no cold serialization benefit. The retained variant declares the slot on
every frame; three alternating minified application pairs preserve all six complete
corpora, 108 revisions and full/delta/delta delivery against the independent native
complete-packet oracle. Nested cold serialization means change 1799.6 -> 1771.2 ms;
ready means change 4383.4 -> 4346.8 ms. Edit timings are largely unchanged. Separate
actual Worker CPU samples show essentially unchanged total active time. These results
establish no general speedup, original latency/p95 or aggregate physical admission.

All 19,131 source-bound units pass, with one existing Windows POSIX-permission skip.
The 18 captured-input lifetime cases collect all 90 witnesses while 421 caller handles
remain held, before closed work resumes. A separate allocation-sampling diagnostic
exited its baseline browser before producing a profile; its failed report is retained
and supplies no allocation evidence. Full release/source verification is recorded in
`test/artifacts/logs/encoder-progress-validation.json`. Ordinary JSON remains selected, packed stays
inactive, and the full application/performance/platform/distribution scope remains open.


### Guarded imports of completed arena records

Final snapshot assembly now opts into shallow reads of validated, untransformed
arena records. Frames keep source-free IDs, shape keys, scalar/coordinate metadata
and byte cursors; every edge rechecks the original revocable capture/item scope.
No arena, view, buffer or native tree escapes into import metadata. Array edges
retain their handoff yield, and every visited child keeps its original logical
node/depth charge. Existing frame, container, key, edge and interning weights stay
in force. Lazy transforms and composite subtrees use ordinary readers, with direct
imports available again in their untransformed descendants.

Imported shapes/references map into the encoder's existing canonical tables.
Cross-arena equality still compares complete records. Strings use the existing
bounded decoder and exact canonical emitted-byte interning; valid alternative wire
escapes cannot be copied as if they were canonical JSON. This avoids per-child path
scopes and array iterator objects in completed arena subtrees; it does not bypass
traversal allowance, transfer buffers directly, or prove aggregate physical admission.

Three alternating minified application pairs cover all six complete corpora and
108 full/delta/delta revisions against an independent complete native-packet oracle.
Nested cold serialization means change 1731.8 -> 1566.7 ms and readiness
4214.5 -> 4054.7 ms. Receipt-inclusive transport changes 996.1 -> 1022.7 ms;
first-edit readiness changes 495.5 -> 489.2 ms and second-edit readiness
426.0 -> 423.7 ms. These diagnostics do not establish original latency/p95 targets
or a general speedup. The actual Worker CPU capture and all source/asset bindings
are retained separately.

The source-bound suite passes 19,172 tests with one existing Windows POSIX-permission
skip, including 41 new import cases. Both captured-input modes pass 36 lifetime
probes: all 180 actual source/identity/arena/buffer/index witnesses collect while
586 caller handles remain held, before cancelled work resumes. Complete producer
fidelity, package/installer checks and frozen runtime reproduction are recorded in
test/artifacts/logs/record-import-validation.json. Ordinary JSON remains selected; packed
transport and the broader application/performance/platform/distribution gates remain open.


### Guarded records during complete native projection validation

Experimental renderer receipt now reconstructs each complete native projection
block using shallow validated record metadata where the original guarded scope
selects an untransformed arena. Every edge, text decoder and allocation keeps that
scope's revocation checks. Composite revisions, discarded prefixes and position/
range transforms retain their ordinary reader fallback. Native arrays, objects,
own descriptors, distinct copied identities and all six position coordinates stay
complete. Output still passes the independent HTML/widget projection comparison.

Record metadata borrows only an already indexed bounded string and its UTF-16
length; it never decodes or caches a new string. Long and transformed strings use
the existing bounded collector. The original output/workspace weights, node/depth
limits, sixteen-value batches, array handoff yields, 256-entry discarded-prefix
checkpoints and immediate ownership checks remain. The generic stream-copy path
remains available, as do preflight callers. This is not aggregate physical admission.

Three alternating minified application pairs cover all six complete corpora and
108 full/delta/delta revisions against independent complete native-packet equality.
Nested cold receipt-inclusive transport means change 1021.8 -> 979.5 ms, readiness
4073.3 -> 4003.6 ms and serialization 1567.8 -> 1579.1 ms. First/second edit receipt
means change 170.2 -> 171.1 and 136.8 -> 132.8 ms. The focused native-record tests
overlapped part of this shared-host series. These are diagnostic means, not p95 or
general latency acceptance. Separate before/after actual renderer CPU captures
bind evaluated sources, emitted assets and both revision profiles. Native-copy
inclusive sampled CPU changes 126.684 -> 90.621 ms; total cold active renderer
samples change 1152.372 -> 1112.704 ms. Sampling includes request-to-ready work and
can include post-publication cache work.

The current source-bound suite passes 19,205 tests with one existing Windows
POSIX-permission skip, including 33 new direct-copy cases. The reusable native-copy
lifetime driver now archives sources/injections/driver under unique test/artifacts/logs paths;
180 ordinary/direct and standalone/parent-owned probes collect all 7,164 actual
witnesses before closed held work resumes. Complete producer, release, installer
and frozen runtime evidence is recorded in test/artifacts/logs/receipt-path-validation.json.
Ordinary JSON remains selected and packed remains experimental. Original
performance, physical admission, M1-M4, platform and distribution gates stay open.


### Bounded synchronous interning for short completed records

The encoder's exact emitted-record index offers a bounded synchronous lookup and
insertion path for at most sixteen values/probes. It compares complete tags,
array lengths and uint32 coordinates/references after matching hashes. A failed
short attempt neither allocates nor changes the table. The encoder yields before
falling back for long rows/chains and table growth. Cooperative hashing/comparison/
probing still yields at 256-item boundaries, with the same optional collision
limit, overlapping old/new table charge and cancellation rollback. All previous
logical visits/depth, workspace/wire limits, canonical interning and owner checks
remain. This changes neither the wire format nor the selected ordinary JSON path.

The 38 new cases cover cooperative byte/hash/ID equality, seeded short rows,
uint32 extremes, full-hash collisions, tags/length/order, sixteen-probe fallback,
deferred long rows, growth denial/cancellation/completion and malformed references/
entries. The full suite passes 19,243 tests with one existing Windows permission
skip, using the original four workers. Fresh producer and ownership checks retain
complete native semantics and zero survivors before held closed work resumes.

Three alternating minified pairs cover all six corpora and 108 complete native
full/delta/delta comparisons. Cold nested serialization means 1623.0 -> 1581.1 ms;
ready means 4103.2 -> 4069.4 ms; receipt-inclusive transport 1003.0 -> 1015.7 ms.
Separate source/asset/profile/driver-bound actual Worker captures locate the local
index reduction. Results remain diagnostic: p95, broad speedup, aggregate physical
admission and original performance targets are unproven. The attempted scalar-field
receipt shortcut was rejected and restored; its exact evidence is preserved.
Current proof: test/artifacts/logs/record-index-validation.json. Packed remains experimental;
all original application, UI, performance, platform and distribution gates stay open.


### Reusing completed untransformed aliases

Completed untransformed arena aliases now reuse their existing canonical output
IDs without creating a transient encoder frame. Every edge is still validated;
the original scope is rechecked before use. The original child visit/depth,
192+320 working charge, parent-edge charge, array handoff and 64-advance progress
point remain. Transformed subtrees retain their ordinary fallback. No wire,
string, quota, timing or selected-transport change is introduced.

Thirty frozen-before/current trace cases match every encoder charge/release and every
progress boundary, across complete output, node/depth/working failures and
cancellation. All 19,269 units pass with one existing Windows permission skip,
207 files and 483 current source bindings under the original four-worker setup;
26 new cases cover alias equality, identity isolation, progress, quotas and
reentrant closure. Complete producer and fresh lifetime evidence is required by
test/artifacts/logs/record-alias-validation.json, including 586 held captured-input handles.

Three alternating minified pairs preserve six full corpora and 108 complete
native full/delta/delta comparisons. Nested cold serialization means change
1603.3 -> 1587.5 ms; readiness
4092.3 -> 4094.2 ms; receipt-inclusive transport
1011.5 -> 1016.5 ms. Separate actual Worker CPU captures bind evaluated sources,
assets, profiles and drivers. These diagnostics do not establish p95, broad
speedup, physical admission or original latency acceptance. Ordinary JSON remains
selected with its unresolved complete nested wire-limit failure. The full M1-M4,
UI, physical accessibility, performance, platform and distribution scope stays open.


### Borrowing already retained object shapes

The experimental encoder now remembers two canonical object shapes by the exact
immutable arena key-array identity. It borrows only arrays already retained by
its shape table, using fixed cursor slots within the existing reservation. A hit
avoids repeated JSON key spelling and map lookup. Per-object key validation and
working admission still run; arrays from another arena, native objects and lazy
transforms retain canonical spelling lookup. Shape zero, order, escaping and
canonical output are unchanged. No cache table, arena backlink, wire change,
quota increase, clock batching or selected-transport change is introduced.

Fifty source-bound frozen-before/current cases match every encoder charge,
release, frame admission, progress boundary, error and canonical output hash.
All 19,283 unit tests pass with one existing Windows permission skip, 208 files
and 484 loaded-source bindings under the original four-worker setup. Fourteen
new cases cover repeated and evicted shapes, escaped and special keys, shape
order, independent arenas, denied admission, reentrant closure and cancellation.

Three alternating minified pairs preserve all six complete corpora and 108
independent native full/delta/delta comparisons. Nested cold serialization means
change 1596.0 -> 1581.6 ms;
readiness 4105.3 -> 4104.7 ms;
receipt-inclusive transport 996.6
-> 1021.4 ms. These are small, mixed
diagnostic results, not a broad speedup or original performance acceptance.
Separate actual Worker profiles and a fresh renderer baseline retain source,
asset, driver and raw sample evidence. The full proof is
test/artifacts/logs/receipt-span30-validation.json. Ordinary JSON remains selected with its
unresolved complete nested wire-limit failure. All original M1-M4, UI,
performance, physical accessibility, platform and distribution gates remain open.


### Borrowing context from full-producer document validation

The experimental full producer now collects global definitions and footnote
context during complete document validation, then borrows that validated context
through projection encoding. This reuses the existing receiver collection
transaction and removes the producer's redundant context walk. Rendering begins
only after schema, source positions, descriptions and exact word counts pass.
If optional collection cannot fit, its transaction closes before independent
validation and the original renderer context walk retry under the same limits.
Unknown errors and invalid documents are rejected without that retry.

An internal encoding borrow lets the existing capture-owned task close every
render child and workspace on cancellation, including queued work. Standalone
encoding keeps its synchronous setup and admission behavior. No limit, selected
transport, wire format, clock granularity or preview cap changes.

All 19,321 unit tests pass with one existing Windows permission skip, 209 test
files and 486 loaded-source bindings under the original four-worker setup.
Thirty-eight new cases cover complete native output for both syntaxes and HTML
policies, corrupt documents, both capacity fallbacks, copied caller inputs,
queued/collection/render cancellation, renderer failures, independent output
ownership and encoder exhaustion. The actual full producer also passes 6,756
complete native packet checks and 6,756 whole-root comparisons.

Seventeen forced-GC coordinator probes observe 4,665 private context, definition,
converted tree, widget-map and event objects, with zero survivors before resuming
held work. The 121 held handles include closed children and collections as well
as suspended outer coordinators after capture/owner closure. Request-source
accounting returns to its exact baseline before disposal and zero after disposal.
Source archives and three diagnostic injections are retained. Two initial probe
assumptions about direct-coordinator accounting and resumption were corrected;
their failed logs and exact drivers remain. These probes establish reachability
for observed graphs, not aggregate physical admission or peak memory.

Three alternating minified pairs preserve all six complete corpora and 108
independent native full/delta/delta comparisons. Nested cold readiness means
change 4041.1 -> 3949.3 ms;
receipt-inclusive transport 1014.0
-> 991.6 ms. Edit readiness means
are slightly slower. Shared context preparation moves out of the child renderer
timer into validation/residual serialization: the reported render and serialize
fields therefore cannot independently establish a speedup. Separate actual
Worker CPU captures retain original signed samples, exact loaded sources, assets
and drivers. This is a modest cold-readiness diagnostic improvement, not latency
p95, broad throughput or original performance acceptance.

Full source, package, installer and runtime-reproduction evidence is recorded in
test/artifacts/logs/producer-context32-validation.json. Ordinary JSON remains selected with its
unresolved complete nested wire-limit failure. All original M1-M4, UI,
performance, physical accessibility, platform and distribution gates remain open.


## Resumable full snapshot encoding

The experimental full producer now parks one canonical encoder at sibling boundaries.
The coordinator stages an independently admitted document checkpoint, performs the existing
complete document validation/rendering into the event spool, then supplies projection and
layout inputs to the same record writer. Validation/render orchestration runs between
parked boundaries; streamed native document inputs still advance the parser inside
encoding steps. The native scalar map retains its fast path, charges retained string units,
and registers each emitted native string once for exact sharing with later captured text.
All native frames, indices and buffers disconnect on cancellation or completion. Copies
keep independent storage and retain the original simultaneous workspace/output admission.

The focused suite passes 2,122 checks, including 16 new sequence cases. The complete actual
producer passes 6,756 full native comparisons and 6,756 exact canonical packet comparisons
in production/development parser processes. Another 134 lifetime observations hold 720
actual sequence/checkpoint/input/outer handles; all observed survivor fields are zero.
These observations establish reachability for the tested graphs, not physical peak bounds.

Three alternating minified before/after pairs preserve all six complete 1 MiB corpora,
two edits per case, one persistent Worker, original clocks/quotas/caps and 108 complete
native full/delta/delta comparisons. Nested cold readiness means change
3875.7 -> 3567.9 ms;
serialization means change 1529.2 -> 1222.3 ms.
Other cold means improve except single-paragraph, which is effectively unchanged.
Some edit means regress: nested first-edit readiness changes
482.9 -> 498.0 ms.
This is diagnostic cold-readiness evidence, not packaged p95 or original performance acceptance.

Complete source/check/test/package/installer/frozen-runtime evidence is recorded in
`test/artifacts/logs/encoder-resume37-validation.json`. The previous recovery interface review remains scoped
to its documented states. Ordinary JSON remains selected with the complete nested wire-limit
failure; experimental packed transport stays inactive. All original M1-M4, remaining
performance/physical-admission, interface, accessibility, platform and distribution gates
remain open as applicable.


## Canonical sibling key ordering

The experimental resumable encoder now requires sibling names in Object.keys order.
It snapshots and checks names before opening input ownership or starting the encoder.
JavaScript array-index names enumerate first in numeric order; accepting a different
supply order could visit an opaque future sibling before its input existed. Reordered
envelopes and sparse key lists now fail with the explicit invalid-key error. Canonically
ordered numeric names, non-index numeric spellings, empty names and own __proto__/
constructor/toString fields retain exact checkpoints and canonical final packets.

Eight new regression cases cover those boundaries. Five rejection cases reproduce
against the archived prior implementation; the current focused suite passes 2,830
checks. Complete producer verification passes 6,756 exact canonical packet comparisons
and 6,756 complete native-root comparisons in production/development parser processes.
The fixed application envelope remains document/projection/layout. No scheduling,
numeric limit or semantic validation is relaxed. Source-bound checks, package and
installer results are recorded in test/artifacts/logs/sequence-order39-validation.json.

The renderer-walk38 profiles are bound to the preceding encoder-resume37 sources.
Inspection confirms that cold word-text collection already shares the schema walk;
its inclusive samples do not prove a redundant walk. No performance improvement or
original latency acceptance is claimed by this correctness change. Selected JSON
transport still fails the complete nested wire-size gate; packed transport remains
experimental. Original M1-M4, interface, physical accessibility/platform, aggregate
physical admission and distribution requirements remain open as applicable.


### Borrow the full-producer render iterator — 2026-10-30

The experimental full producer's event iterator now owns its private render generator
through a finally block. Removing its additional registered scheduler wrapper preserves
all yield expressions and public revocable task interfaces. Parent closure unwinds the
render generator after an active advance returns, including cancellation inside native
conversion. Three regressions cover cancellation, capture release and owner disposal.
The standalone full-producer probe now asserts the actual sequence/projection-input
assembly route in place of its stale legacy snapshot-encoder assertion.

Fresh complete native checks retain 6,756 canonical packets and 6,756 whole-root
comparisons. Both parser exports and HTML policies cover all CommonMark examples,
extensions, six full corpora, seeded combinations and large widget cases. All 134
lifetime observations retain 720 held handles and 854 metadata witnesses, with zero
observed survivors. This establishes observed reachability, not physical admission.

A separate count diagnostic observes 6,457,231 -> 5,795,586 scheduler-wrapper advances
for the cold nested Worker request; both edit counts are unchanged. Instrumentation
perturbs execution and the readiness window can include optional background work.
Three alternating minified pairs preserve all six full corpora and 108 complete native
full/delta/delta comparisons. Nested cold readiness means change 3542.0 -> 3492.8 ms,
about 1.4%; edit readiness means change 461.2 -> 463.3 ms. These small, mixed results
establish no general speedup or original latency/p95 acceptance.

Source, native, count, packaged, installer and reproduction evidence is retained in
test/artifacts/logs/read-borrow41-validation.json. Selected ordinary JSON still fails the complete
nested wire admission gate. Packed transport stays off; original M1-M4, aggregate
physical admission, UI/accessibility, platform and distribution gates remain open.

### Single-use main HTML experiment — 2026-10-30

A complete prototype in test/artifacts/logs/stream-text42-control consumes the main HTML producer
once, stages canonical JSON bytes inside the existing encoder budget, and preserves
exact string interning. It retains a separate complete widget spool, global renderer
context, footnotes, layout, all document fields and actual render timings. Bounded
byte comparison/copy uses 4,096-byte progress points. Wire, session, validation and
encoder limits, parser exports, HTML policies and scheduler readiness stay fixed.

Reentrant cancellation initially tried to return an executing text generator. The
retained failure is test/artifacts/logs/stream-text42-targeted-complete.log. The corrected prototype
uses a revocable handle with separately admitted construction weight, deferring raw
return until the active advance unwinds. Cancellation, disposal, thrown conversion
and successful retry are covered. All 8,685 focused checks pass across 79 files.

Fresh verification compares 6,756 complete canonical packets and whole native roots,
including all CommonMark examples, six complete corpora, extensions, 1,024 seeded
combinations, 20,000 widgets and escaped code. Both parser exports and HTML policies
are retained. Canonical packet rows also match the prior packaged implementation.
Separate lifetime runs observe 134 closures, 854 metadata witnesses and 744 held
handles, with zero reported survivors. This is reachability evidence, not calibrated
physical or aggregate admission. Sources, driver copies and evaluated modules are
bound in test/artifacts/logs/stream-text42-native-proof.json.

Three alternating minified pairs preserve all six corpora and 108 independent native
full/delta/delta comparisons through the actual Worker, service and mounted Live
model. Nested cold readiness means are 3484.37 -> 3514.50 ms; receipt means are
2505.13 -> 2500.93 ms. Edit readiness means are 460.85 -> 462.50 ms; edit receipt
means are 307.63 -> 307.33 ms. The other five corpora improve slightly, but the
critical nested readiness mean regresses and receipt is effectively flat. The
prototype is retained for investigation and is not applied to application sources.

The same runs record nested serialization means of 1200.50 -> 1168.43 ms, rendering
442.83 -> 463.97 ms, and transport-out/application preparation 978.40 -> 1012.53 ms.
These application timing buckets include copying, validation and scheduling; they
are not exclusive CPU samples. This result redirects investigation toward complete
construction and receiver validation, rather than further main-HTML spool changes.
Keep original readiness, work quanta, complete fixtures and physical admission gates.

Retained performance and phase analyses are test/artifacts/logs/stream-text42-performance.json and
test/artifacts/logs/stream-text42-phase-analysis.json. The documentation increment and independent
checks are recorded in test/artifacts/logs/stream-text42-validation.json. The selected JSON wire
gate, experimental transport activation and complete original M1-M4 acceptance
remain open. This experiment establishes no latency/p95 or full application acceptance.

### Private array cursor batching — 2026-10-30

The private native copier now batches constant-time encoded array references and
completed array slots under the existing sixteen-value bound. Array opening,
fallback item-iterator handoffs, lexical progress, ownership checks and allocation
admission retain their original boundaries. Post-assignment and final-root guards
cover reentrant revocation; no borrowed native cursor crosses a suspension.

Nine added cases cover complete mixed arrays, reference/value batch limits and
reentrant cancellation, capture release and owner disposal. The delayed-sibling
cancellation fixture grows from 100 to 1,000 children so its twenty advances remain
strictly inside the original sixteen-value bound. A parameterized-test error was
caught by type checking and corrected to exercise each complete array.

Three alternating minified pairs preserve all six full corpora and 108 independent
native full/delta/delta comparisons through the actual Worker, service and mounted
Live model. Nested cold readiness averages 3557.13 -> 3241.80 ms;
receipt averages 2554.70 -> 2348.13 ms. Cold readiness improves in
all three pairs, about 9% overall. Edit readiness averages 459.90 -> 467.43 ms;
edit receipt averages 306.57 -> 311.68 ms. These are diagnostic
averages, not original latency/p95 acceptance. The packed and incremental gates
remain disabled.

The formatted implementation and test have the prototype's syntax tree. Fresh
production verification passes 6,756 complete packet and root comparisons with
fixed clocks and another 6,756 with active clocks. Both parser exports, both HTML
policies, all CommonMark cases, all six corpora, extensions, 1,024 seeded cases,
20,000 widgets and escaped code remain included. Separate forced-GC runs retain
720 held handles and 854 metadata witnesses across 134 observations; all reported
survivors are zero. This proves observed reachability, not physical admission.

Full validation passes 19,374 tests across 211 files with the one existing Windows
POSIX-permissions skip, 99 packaged cases with no retries or flaky results, a real
79-file NSIS installation with two launches and exact Unicode/BOM/CRLF save, and
uninstall/state restoration. All 237 runtime files reproduce from 771 frozen inputs.
The package checker verifies all 9,645 ASAR files, including 516 application files,
18 pinned parser sources and three unpacked native files.

The full release driver initially referenced the old manifest name, then collided
with prototype report names after a passing full unit run. That full run overwrote
the initial prototype report and bindings. Failure logs and the first full-run
outputs are retained. Fresh focused and full runs use separate
report paths. The original prototype unit proof is superseded; use
test/artifacts/logs/array-copy43-prototype-unit-proof.json. Fresh production native evidence is
test/artifacts/logs/array-copy43-release-native-proof.json and performance evidence is
test/artifacts/logs/array-copy43-performance.json. The final current-state check is
test/artifacts/logs/array-copy43-validation.json.

Only the native copier, its existing test and these two records change from the
preceding frozen state. Complete source-free CPU profiles of the preceding runtime
are retained as diagnostic motivation, not current-runtime profiles. The full
application goal remains active: selected ordinary JSON still fails the complete
nested wire gate, and original M1-M4, UI/accessibility/IME/touch, aggregate physical
admission, platform and distribution requirements remain open. Root temporary logs
stay in ignored /test/artifacts/logs/. No commit, publication, deployment or transport activation
is performed.

### Private projection plan — 2026-10-30

The experimental full producer now renders into an admitted private plan and supplies
its complete HTML, widgets and layout directly to the existing sibling encoder. It
removes the intermediate event-packet encoding, arena copy/index and decoding pass.
The final complete canonical packet, original parser/renderer semantics, six source
coordinates, global definitions/footnotes and all original limits remain unchanged.
The selected ordinary JSON worker and disabled transport activation gates remain.

The plan retains bounded text pieces with exact string sharing and fixed numeric
pages. Reservations precede retention/page allocation. Widget range indexing waits
until the native rendering/context scope closes; sorting and last-wins source-range
semantics use the existing implementation. Complete validation still precedes any
rendering, including the independent fallback after optional context collection fails.
Inputs retain an independent capture and revoke on cancellation/disposal. Completed
projection and layout inputs release their respective native storage before final
packet allocation. Private construction pieces do not introduce wire chunking.

An initial native-object plan exceeded the existing 16 MiB owner cap on the complete
20,000-widget fixture. Fixed pages and deferred range indexing resolve that regression
without changing the cap. An initial capture-identity mismatch was corrected in the
coordinator; the validator's identity check remains intact. Failed versions/logs remain.

Fresh fixed-clock and active-clock verification each pass 6,756 complete packet and
whole-root comparisons, including both parser exports, both HTML policies, CommonMark,
the six full corpora, extensions, 1,024 seeded cases, 20,000 widgets and escaped code.
The 119 evaluated source bindings match current inputs. Separate forced-GC diagnostics
pass 158 observations with 730 held handles and 596 journal-data witnesses. Observed
storage clears after completion and cancellation during rendering/final assembly.
These observations establish reachability, not physical heap admission.

Three alternating minified pairs preserve all six full fixtures and 108 complete native
full/delta/delta comparisons through the actual Worker/service/mounted Live model.
Nested cold readiness averages 3284.53 -> 3199.50 ms and receipt 2409.13 -> 2322.20 ms;
cold readiness improves in every pair. Edit readiness is 461.45 -> 470.65 ms and receipt
306.92 -> 315.32 ms, a mixed/slower result. Original readiness, clocks, work quanta,
watchdog and caps are unchanged. These averages do not satisfy original latency/p95 gates.

Fresh validation passes 19,403 tests across 212 files with 495 evaluated source bindings
and the existing Windows POSIX-permissions skip. The 29 added cases cover complete
canonical output, independent ownership, corrupt-document rejection, fallback,
cancellation/revocation, admission rejection and encoder exhaustion. All checks pass.
A fresh build from 794 frozen inputs reproduces all 245 default runtime files exactly;
the existing packaged releases are retained executions, not new installer/platform runs.

Evidence: `test/artifacts/logs/projection49-performance.json`, `test/artifacts/logs/projection49-native-proof.json`
and `test/artifacts/logs/projection49-validation.json`. Original selected-JSON nested wire failure,
experimental activation, latency, aggregate physical admission, platform/UI/accessibility
and remaining M1-M4 feature/distribution gates remain open. The full application goal
continues; this construction improvement does not establish completion.

### Reuse admitted source metadata — 2026-10-30

The locally admitted immutable source now retains its exact Unicode code-point
count alongside its existing validated hash. The cooperative admission scan counts
surrogate pairs across its original 4,096-unit boundaries while checking the same
UTF-8/JSON limits and complete hash. The synchronous constructor derives the count
during its existing UTF-8 admission pass. A private weak map seals the count to the
authentic source; copied, forged and proxy objects cannot authorize reuse. The
source ledger adds the existing sixteen-byte scalar weight for this retained value.

Prepared block parsing reuses that count and hash. Complete description validation
compares the received document's count against the independently computed local
count. This removes the prepared parser's final whole-source scan and validation's
separate character scan. Whole-prose word segmentation, all schema/source/position,
descriptor/outline and exact projection checks remain. The ordinary string parser
retains its bounded final scan. Original caps, work quanta and transport selection
remain; the selected ordinary JSON worker still exceeds the complete nested wire cap.

Eleven added cases cover exact Unicode counts, pairs across scan boundaries, both
source constructors and both parser syntaxes, complete native parser equality and
the absence of a final source scan. Existing source-cap, forgery, malformed-count
and cancellation checks pass. Both full unit runs pass 19,414 cases across 212 files
with the existing Windows POSIX-permissions skip; the separate uncached run binds
495 evaluated sources. Fixed and active clocks each pass 6,756 complete native
packet/root comparisons. Fresh lifetime runs pass 158 observations, including twelve
cached-metadata cancellations after whole-prose EOF with zero source reads.

Three alternating minified pairs preserve all six complete fixtures and 108 native
full/delta/delta comparisons. Nested cold readiness averages 3278.73 -> 3248.97 ms;
receipt averages 2352.23 -> 2336.50 ms. The gain is modest and varies across pairs.
Nested edit readiness averages 487.32 -> 466.78 ms, with other edit results mixed.
These diagnostics establish no original p95 or latency acceptance. ADR 002's 150 ms
target covers whole-AST application, while editable Source opening has a separate
one-second target; the receipt diagnostic is a separate measurement.

The fresh default build changes thirteen renderer files and reproduces all 245
runtime files exactly in a second build. A fresh Windows directory package under
`test/artifacts/logs/source50-package/` passes all 102 integration cases without retries. All
9,657 ASAR files, including 528 current application/source files and eighteen parser
pins, plus the three unpacked native files are checked. Dedicated Electron fixtures
within that suite retain their own fixture entry points. The installer and other
native platforms retain their earlier named evidence.

Evidence: `test/artifacts/logs/source50-{native-proof,performance,package-check,validation}.json`.
The initial lifetime observer waited for the removed scan; its replacement observes
the actual authenticated count handoff. A build comparison initially assumed the
old runtime would remain identical; the changed runtime is now reproduced and tested.
Initial diagnostic JSON comparison and scratch test-directory errors are corrected;
their failed logs and drivers remain. Original M1-M4, activation, physical/aggregate
admission, p95, UI/input/accessibility, platform and distribution gates remain open.

## Listless compiler span ownership — 2026-10-30

The private compiler previously detached serialization contexts, then copied every
span into another event array while looking for lists. The serializer now records
whether a span contains listOrdered/listUnordered tokens during its existing walk.
A listless span consumes its original private array directly. List spans keep the
original preparation, list-item synthesis and spread behavior. All native handlers,
listener context copies, positions, global references and complete semantic fields
remain. Public APIs and the noncooperative private path remain unchanged.

The new guarded forward/inverse helper is scripts/parser-list-preparation.mjs.
Both pinned compiler exports upgrade together; historical reconstruction first
removes this latest edit. The same 256-event metadata and 16-native-event quotas,
cleanup and all original caps remain. The complete nested corpus body eliminates
705,406 additional event-reference copies, preserving all 705,406 dispatches and
complete native output under both grammars and both exports. This establishes an
operation reduction, not physical allocation or latency acceptance.

The current full unit run passes 19,421 cases in 212 files with one existing
Windows POSIX-permissions skip. Seven new cases cover native handler traces,
dispatch bounds, return/throw cleanup for listless and nested lists, and actual
installer upgrades. Fixed and active clocks each pass 6,756 complete canonical
packet comparisons and 6,756 whole-native-root comparisons. Lifetime verification
retains 158 observations, 730 held handles and 596 journal witnesses with zero
closed-state survivors. Default output reproduces all 245 files; 22 differ from
source50. A fresh Windows directory package passes all 102 integration cases.

Three alternating pairs over all six complete fixtures retain 854 evaluated
sources per build and 108 independent native full/delta/delta comparisons through
the actual Worker/service/DocumentPreview/mounted Live. Only the production
compiler differs among loaded sources. Readiness, clocks, limits and fixtures stay
unchanged. Timings are mixed and establish no general latency improvement:

| Complete corpus | Cold ready before → after (ms) | Edit ready before → after (ms) |
| --- | ---: | ---: |
| prose | 633.50 → 635.23 | 300.40 → 300.63 |
| single-paragraph | 393.93 → 393.80 | 259.37 → 259.70 |
| mixed-rtl | 471.00 → 472.83 | 263.37 → 263.73 |
| repeated-paragraphs | 1730.13 → 1739.77 | 432.67 → 438.75 |
| many-small-blocks | 1878.03 → 1896.23 | 456.10 → 462.60 |
| nested-containers | 3171.87 → 3164.67 | 471.03 → 467.78 |

The nested cold receipt mean changes 2273.17 → 2292.93ms; its edit readiness
changes 471.03 → 467.78ms. No cold case improves in all three pairs. These are
diagnostic means, not p95 acceptance. The change is retained for eliminating a
duplicate traversal and event-reference array; larger construction/application
costs remain. Evidence is in test/artifacts/logs/compiler52-{native-proof,performance,package-check,validation}.json.
The source50 current-head checks are now archival; use node test/artifacts/logs/verify-compiler52-validation.mjs
and the corresponding native/performance/package checkers. Original ADR002,
transport activation, complete nested Live, physical/aggregate admission, latency,
remaining features/UI/accessibility, platform and distribution gates remain open.

## Cooperative native body conversion — 2026-10-30

Packed output validation now prepares native body children incrementally through
`ProjectionSequence.convertSteps`. The original pinned native handlers still create
each HAST result once. An iterative stack preserves native admission order and
per-occurrence footnote counters; native `State.all` applies its original child
flattening and hard-break whitespace rules to groups of sixteen cached child results.
The preceding sibling supplies boundary context without converting it again. Table
rows preserve native alignment, cell padding and discarded-cell behavior. The ordinary
synchronous conversion and substituted Reading APIs retain their existing paths.

Each resumed conversion admits at most sixteen native node entries before yielding.
This bounds recursive dispatch, not handler duration: individual native handlers,
array expansion within native `all`, URL/scalar work, context indexing, footer and
other synchronous operations remain. Complete children and all semantic fields are
preserved. Frame/request arrays, per-occurrence references and expanded native output
slots have explicit capture-owned scratch admission before allocation. Missing or
denied admission fails closed. Returning, throwing or revoking active work closes
its sequence so partial global counters cannot be reused. Concurrent conversion and
footer requests are rejected. Existing work, memory and wire limits are unchanged.

The final helper matches native HAST, including positions, for 2,636 CommonMark and
extension cases across both syntaxes and HTML policies, with unchanged MDAST and
matching footnote order/counters. Its observed maximum is six handler invocations per
advance; separate ownership tests enforce the sixteen-entry bound and native admission
trace. Coverage includes hard breaks across group boundaries, repeated node objects,
discarded table cells, expanded unresolved references, cancellation and admission
failure. The full suite passes 19,444 cases across 212 files, with one existing Windows
POSIX-permissions skip. The first full run exposed seventeen observers of the old
synchronous method; their routes now observe actual yielding conversion while keeping
the original reuse, corruption, cancellation and failure assertions.

The maintained output diagnostic now retains a unique report, driver and 73 evaluated
source archives. All 56 standalone/parent-owned forced-GC probes collect their observed
objects before any held closed task resumes, including four probes holding actual
conversion frames and partial native HAST. Three complete native functional comparisons
cover nested content, global notes and a large Unicode widget under the existing
8 MiB staging and 64 MiB session limits. These establish observed reachability and
functional equality, not calibrated physical or aggregate memory admission.

Three alternating minified pairs retain 854 before and 855 after evaluated sources,
all emitted assets and 108 complete native full/delta/delta comparisons through the
actual Worker, service, DocumentPreview and mounted Live editor. Only the sequence
and packed body-output sources differ among shared loaded sources; the conversion
helper is added. Both sides use identical production parser pins. Cold readiness
regresses for several corpora; the change is retained for bounded dispatch and
cancellation, with further overhead reduction required:

| Complete corpus | Cold ready before → after (ms) | Edit ready before → after (ms) |
| --- | ---: | ---: |
| prose | 622.53 → 624.27 | 293.05 → 291.55 |
| single-paragraph | 381.57 → 381.70 | 278.23 → 257.10 |
| mixed-rtl | 459.70 → 464.57 | 259.80 → 256.92 |
| repeated-paragraphs | 1669.43 → 1745.87 | 424.98 → 423.67 |
| many-small-blocks | 1834.30 → 1923.43 | 456.60 → 448.40 |
| nested-containers | 3108.43 → 3261.50 | 460.52 → 454.32 |

Nested cold packet receipt changes 2236.90 → 2298.73 ms. These diagnostic means
include the fixture's original ready-timer behavior and establish no p95 or full
latency gate. Two default builds reproduce all 247 runtime files; 234 match the
preceding runtime, including the narrow preload. The new Windows directory package
is local validation; earlier installers and other-platform artifacts remain earlier
evidence. Proofs are `test/artifacts/logs/conversion54-{performance,build-verification,package-check,validation}.json`.

Packed/incremental transport remains experimental and off. The selected ordinary
JSON path still exceeds the 8 MiB wire cap for the complete nested fixture. Whole-AST
application time, semantic freshness, physical/aggregate memory, remaining M1–M4
functionality, refined UI/input/accessibility, platform and distribution gates remain
open. Original ADR 002 is unchanged and the full application objective continues.

## Avoid conversion frames for native leaves — 2026-10-30

The yielding body converter now invokes text and other native leaf handlers directly
after the same node/depth, liveness and scratch checks. A leaf still charges its
original 512-byte conversion allowance. It no longer allocates a traversal frame or
an empty child-request array, or revisits that frame in the generator loop. Parent
frames, native `State.all`, global context, footnote counters, complete output and
the sixteen-entry/invocation bound remain. Native methods restore in `finally` and
unexpected recursion/child requests reject. Two new cases cover revocation and
allocation failure at a leaf before a later sibling can run. No resource limits,
admission weights, work quotas or transport selection change.

A read-only witness compares actual before/current helpers over all six complete
native corpus roots. Exact HAST including positions, input preservation, footnote
state, admission order, handler-call count and total conversion scratch agree.
The nested fixture creates 113,367 → 50,385 frames, removing 62,982 leaf frames,
and takes 25,192 → 22,043 helper yields. Repeated paragraphs remove 13,799 frames;
many small blocks remove 16,385. This establishes fewer traversal objects and
iterations, without calibrating physical allocation or memory admission. Native
equivalence also passes 2,636 CommonMark/extension cases across both syntaxes and
HTML policies. The observed maximum is eight handler invocations per advance;
the unchanged sixteen-entry limit is checked separately.

The full suite passes 19,446 cases in 212 files with one existing Windows
POSIX-permissions skip. The updated lifetime observer watches direct leaf results
as well as parent results and active frames. All 56 output, 21 composed-validator
and 15 reuse probes pass, retaining closed handles until after observed resources
collect. These checks establish reachability, not elapsed-time or physical bounds.
The output diagnostic ran concurrently with functional checks and reported a local
step above 4 ms; it does not pass the original elapsed-slice gate. Its retained log
also records a development WebSocket-port warning while the functional checks pass.

Fresh sampled renderer profiles bind their actual loaded sources, complete native
initial/edit results and emitted assets. Their converter inclusive samples change
61.24 → 73.91 ms, showing that these single unminified profiles do not prove a CPU
gain. Three alternating minified pairs provide the separate timing comparison;
all 855 evaluated sources per build and all emitted assets are retained. Only the
conversion helper differs among loaded runtime sources, with identical parser pins
and 108 complete native full/delta/delta comparisons under the original controls:

| Complete corpus | Cold ready before → after (ms) | Edit ready before → after (ms) |
| --- | ---: | ---: |
| prose | 628.63 → 632.10 | 293.75 → 290.92 |
| single-paragraph | 389.13 → 384.77 | 256.58 → 257.25 |
| mixed-rtl | 475.20 → 472.67 | 257.78 → 258.57 |
| repeated-paragraphs | 1746.43 → 1755.97 | 427.02 → 430.08 |
| many-small-blocks | 1918.37 → 1920.07 | 453.20 → 455.97 |
| nested-containers | 3286.87 → 3270.13 | 460.67 → 460.97 |

Nested cold readiness is lower in all three pairs; its packet receipt changes
2321.63 → 2310.60 ms. Other results are mixed. Retain the operation reduction
without claiming a general latency improvement, p95 or application acceptance.
The fixture's original ready-timer behavior remains. Two default builds reproduce
all 247 runtime files, with 234 unchanged from the preceding runtime and an identical
narrow preload. Evidence is `test/artifacts/logs/conversion55-{work-reduction,performance,build-verification,package-check,validation}.json`.

Original ADR 002, complete nested Live/wire acceptance, experimental activation,
whole-AST/elapsed-slice/freshness/p95 gates, physical/aggregate memory, remaining
M1–M4 features, refined UI/input/accessibility, native platforms and distribution
remain open. The full application objective continues.


### Restricted exact ASCII word counting (2026-10-31)

Complete packed prose validation still calls runtime-default Intl.Segmenter on
the original whole prose and retains its existing storage admission. A bounded,
constant-scratch recognizer can skip traversing that result only when the entire
prose consists of single contiguous ASCII letter/digit runs separated by ASCII
whitespace or hyphens, with ! , . : ; ? surrounding a run. Another alphanumeric
run across punctuation, unsupported ASCII, Unicode and surrogates all use the
original complete native iterator and exact total comparison. The recognizer
yields every 4,096 UTF-16 units; native fallback yields every sixteen next calls.
No incoming total, per-block sum or partial scan is trusted. This uses the
[default Unicode word-boundary rules](https://www.unicode.org/reports/tr29/#Word_Boundary_Rules)
for this restricted language; native Intl remains the independent oracle.

Two alternating six-corpus service pairs, plus one nested-only pair, preserve 546
complete native parser/render/count/outline oracle results. Four ASCII corpora
improve; mixed RTL and the combined nested mean are effectively unchanged, while
nested combined p95 remains slightly higher. Full results, rejected contracts,
sample counts, outliers and fresh Windows package/resource evidence are recorded
in VALIDATION.md. This optimization changes neither experimental activation nor
admission caps and does not establish complete nested Live, physical peak-memory,
packaged input/mode p95 or full-application release acceptance.


### Printable ASCII punctuation in exact word validation (2026-10-31)

The complete-prose recognizer accepts printable ASCII punctuation surrounding a
single contiguous letter/digit run per whitespace/hyphen token. Underscore stays
on the native path because ExtendNumLet sequences can carry word status. A second
alphanumeric run across punctuation, unsupported control, Unicode or surrogate
also falls back to the original whole-prose native iterator. Complete Intl.segment
construction/admission, exact expected-count comparison and 4,096-unit/sixteen-next
advance bounds are unchanged. No per-block sum, partial count or new storage is
introduced. This extends the restricted recognition language; it is not a general
Unicode segmenter or a change to grammar/transport/resource eligibility.

Four further native-oracle tests exercise every ASCII punctuation pair in word
contexts, full markup, explicit iterator fallback and ten locale settings. Four
ordinary complete six-corpus service runs and one additional nested pair preserve
all 546 full native semantic results; fresh Windows package, desktop and resource
evidence is in VALIDATION.md. Warm nested improvement is repeatable; cold
observations and original tail regressions remain explicit in the evidence.
CPU sampling, local empirical timings and closed-fixture retention do not establish
full physical memory admission, packaged typing/mode, experimental activation or
whole-application/platform/release acceptance. All such original gates remain.


## 2026-10-31 — Startup semantics and rejected encoder trials (pipeline80)

The loading/error page now has a Manuslip H1 before its existing status and retry
action. The previous package independently reproduced page-has-heading-one;
fresh native loading, error and recovery states pass. Existing typography,
localized recovery copy and production colors are retained. Two additional
encoder tests cover live object-key admission during value getters and own-field
changes caused by a malformed position getter, including independent exact-wire
and decoded-value parity. Production packing.ts is restored byte-for-byte to
pipeline79; no encoder performance optimization is retained in this checkpoint.

The scoped better-interface review covers welcome/bootstrap/retry and keyboard
New-document entry. Nine normal-theme native states have zero axe violations,
no horizontal overflow and no page errors: light/dark desktop, dark 320 CSS px,
Chinese light 320 CSS px, native 200% zoom at 580 CSS px, keyboard New, error,
loading and recovery. Selected text pairs meet exact contrast thresholds; raw
AX/axe/layout/color inputs/screenshots remain in
test/artifacts/logs/pipeline80-ui-entry-current-final.json and its bound directory. Non-text
glyph/close-symbol incomplete axe checks remain explicit. Forced-colors automated
contrast is inconclusive: Chromium reports black text while text-fill-color
retains author gray, which axe-core 4.14.0 reads. All 29 diagnostic violations
remain raw; this does not approve physical high-contrast/AT use or justify a
production palette change. Earlier harness zoom, RGBA and Retry-locator failures
are preserved separately. Detailed six-domain scope, findings and limitations:
test/artifacts/logs/pipeline80-ui-review.md. This is not whole-product UI approval.

Fresh dedicated Worker CPU sampling of cold complete nested 1 MiB plus two
actual edits preserves three full native semantic/status checks, 868
consumed sources and 118 emitted assets. The unminified diagnostic
requested 500 us sampling and does not establish a latency gate. Clock calls,
projection iteration, encoder frames and progress wrappers have substantial
samples; sampling does not establish a causal allocation/JIT/GC explanation.

Both complete-data encoder trials were rejected after separate four-run
before/after/after/before comparisons over six 1 MiB corpora and twenty actual
edits per corpus. Each group retains 252 matched revisions and 504 independent
native results, original clocks/caps/grammar, every observation and every outlier.

| Rejected trial | Before cold nested freshness ms | After ms | Before serialization ms | After ms |
| --- | ---: | ---: | ---: | ---: |
| candidate | 3271.400 | 4794.100 | 975.200 | 1277.700 |
| reviewed | 3193.000 | 3492.550 | 959.250 | 1002.900 |

The uniform-frame candidate worsens all six warm receive-plus-apply means. The
key-reuse candidate gives no useful consistent benefit and worsens important
warm tails, including nested freshness p95 422.5 -> 506.9 ms. Both complete
comparison reports, archived source, phase means and quantiles remain in
test/artifacts/logs/pipeline80-candidate-service-comparison.json and
test/artifacts/logs/pipeline80-reviewed-service-comparison.json. Rejection decisions are
independently bound by test/artifacts/logs/pipeline80-retention.json. No extra timing pair was
run, no clock was moved and no speedup is claimed. Runtime limits, production
experiment activation, all semantic data and independent native oracles retain
their previous behavior. The observed regression causes remain unestablished.

Static checks and all 888 focused tests pass. Full units pass
19,609 of 19,610 across 217 files, with zero failures and one
unchanged Windows POSIX-permission skip. The fresh Windows directory package
passes all 131 desktop tests at original 30 s timeout, one worker, zero retries,
zero skips/flaky/unexpected results. The original 300 s resource suites pass:
fifty closed-file cycles retain 46,603,229 -> 48,501,525 bytes (4.073%);
all six samples stay under 250 MB and 10% growth with isolate sums, stable
listeners/watchers and settled filesystem requests. Exact 50 MiB replacement/
Undo/Redo/save and multibyte over-cap rejection pass, as do exact saves for three
5 MiB stress shapes. Closed retention is not physical peak/aggregate admission;
Source fallback is not complete nested Live acceptance.

Package: test/artifacts/logs/pipeline80-package/win-unpacked/Manuslip.exe,
SHA-256 ecc920918c2358996923d36e16de79a6ed3ae8703a56f96fb14556685480e136;
ASAR 107b4350b4ed3c801b26d4a204a70202b9efde640f362f917b186b80afc441a2.
All 9,665 ASAR entries, 563 source/runtime checks, 18 runtime/parser pins, three
unpacked native binaries and 77 directory artifacts are independently bound.
Positive current-package process observation occurs during the desktop suite;
final current-package/project process scopes are empty. Scratch artifacts remain
under ignored test/artifacts/logs, and the legitimate root-file inventory is unchanged.

This is verified progress toward the active full-feature/refined-UI objective.
Full nested Live input/mode/slice/physical peak and aggregate admission, physical
IME/AT/touch, whole-product UI, remaining M1-M4 features, other-platform CI,
installers/signing/distribution and release acceptance remain open. Production
experiments remain disabled. The historical pipeline66 PDF Cancel input incident
remains unexplained; later export/input fixes do not establish its cause.
test/artifacts/logs/verify-pipeline80-validation.mjs independently recomputes source, archived
trial, retention, UI, package and native evidence without closing these gates.


## 2026-10-31 — Native clock binding trial (pipeline81)

Decision: retain the native clock binding.
The recorded actual dedicated Worker CPU profile attributed 143.736 ms to the
clock wrapper and 137.880 ms self to projection-plan next. An isolated actual
Chromium Worker diagnostic used two warmups followed by eight alternating
one-million-read samples: wrapper mean 95.650 ms, bound native clock 48.325 ms.
It keeps every read and establishes neither application speed nor latency gates.

The candidate binds performance.now once at packed Worker startup and once per
owned projection-plan factory. Every existing call, both sides of child.next,
phase boundary, deadline check and yield barrier stays. Data, grammar, admission,
quotas and production transport activation stay. These source transformations
are checked exactly against frozen80. Static checks and all 4204
focused tests in 10 files pass, including independent exact native
projection bytes, ownership, cancellation, reentrancy, protocol and deadlines.

Four ordinary/minified complete Worker/service runs alternate before/after/after/
before over six 1 MiB corpora and 20 actual edits each. All 252 matched revisions,
504 independent complete native semantic/status checks, original phase clocks,
source/assets, receive/apply slices and every outlier remain. Cold nested pairs:

| Pair | Before freshness ms | After freshness ms | Before serialization ms | After serialization ms |
| --- | ---: | ---: | ---: | ---: |
| 1 | 3096.400 | 2986.600 | 948.800 | 846.300 |
| 2 | 3246.500 | 2977.800 | 986.900 | 828.400 |

Cold nested mean freshness 3171.450 -> 2982.200ms
(5.967% improvement; signed observation).
The predeclared rule requires improvement in both pairs and at least 3% combined
cold improvement, without a warm p95 regression exceeding both 5% and 5 ms in any
corpus. All conditions are evaluated, without selecting samples or an extra pair.

| Corpus | Before warm freshness p95 ms | After ms |
| --- | ---: | ---: |
| prose | 256.700 | 262.400 |
| single-paragraph | 226.000 | 224.200 |
| mixed-rtl | 252.400 | 250.300 |
| repeated-paragraphs | 354.300 | 353.100 |
| many-small-blocks | 392.300 | 388.400 |
| nested-containers | 407.000 | 397.700 |

The improvement is specific to the cold producer path. Warm nested mean
freshness is 385.857 -> 387.330 ms;
prose warm receive-plus-apply p95 is 35.200 -> 40.000 ms.
These increases and all other contrary observations remain explicit in the
complete report. No general warm-input speedup or closed product gate follows.

Meets the predeclared ordinary complete-service timing criteria with complete independent native parity. Preserve every clock read, phase boundary, yield and deadline; full application gates remain open.

Full units pass 19,609/19,610 in 217 files, with one unchanged Windows POSIX-permission skip and no failures. Fresh build/directory package source/runtime checks, 18 runtime/parser pins,all 9,665 ASAR entries and 3 unpacked native files verify. Original desktop 131/131, lifecycle 1/1 and large-source 2/2 tests pass with their original 30 s/300 s timeouts, one worker, zero retries,skips or flakes. The positive process witness is inside the full desktop run; final current-package/project scopes are empty. Package: test/artifacts/logs/pipeline81-package/win-unpacked/Manuslip.exe; EXE SHA-256 f5370866f8ae1100e8dd57c987cc3dcf272502ade1c47610fa0d2d6ccb74cc29; ASAR 971b3a2e88b2e8e066d85c73658a5e4a76d81c7aa08fdec48f3160c07520e650.

All 247 reproduced production runtime files match pipeline80 byte-for-byte.
The clock change improves the experimental complete-service path and does not
activate it in the shipping app. The fresh packaged checks validate source and
distribution integrity; they do not establish a production speed improvement.

Evidence: test/artifacts/logs/pipeline81-candidate-service-comparison.json retains all full
phase means/quantiles and raw observation bindings; test/artifacts/logs/pipeline81-retention.json
binds the predeclared rule and decision. test/artifacts/logs/verify-pipeline81-validation.mjs
independently recomputes the final checkpoint. Source fallback and closed-cycle
retention do not establish full Live or native physical peak/aggregate admission.
Production packed/incremental transport remains disabled. Complete M1-M4,
whole-product refined UI, physical IME/AT/touch/high-contrast, other-platform CI,
installers/signing/distribution and release acceptance remain open. Pipeline80's
forced-colors automation limitation and the unexplained pipeline66 PDF Cancel
input incident remain unresolved. The full original application goal stays active.


## Pipeline82: reject traversal-owned native edge output slots (2026-10-31)

Current source-bound Worker/renderer profiles motivated a candidate replacing
per-edge reference result objects with numeric slots bounded by active copy
depth. Original guarded reads, content, quotas, yields, clocks and deadlines
were preserved. 159 core and 4,204 integration tests passed, as did all 504
independent native comparisons over four groups of six complete corpora and 20 edits.
The predeclared complete-service timing rule rejected the candidate: cold
nested receive-plus-apply improved in only one pair and by 2.649% on average;
warm small-block freshness p95 regressed 392.400 to 442.400 ms. All six code/test
files are restored exactly to 81. No runtime improvement, new package/native
run, production activation or physical admission result is claimed.

[Validation](../validation/implementation-history.md) and test/artifacts/logs/pipeline82-validation.json retain the
full decision, contrary observations, source/assets, profiles and exact-restoration
proof. The full original application objective and existing open gates persist.

### Pipeline83: owned byte chunk boundary trial

Pipeline83 owned encoder chunk boundary was implemented and rejected under its predeclared regression rule. The candidate replaced the temporary complete document ArrayBuffer with a source-free, single-consumption handle over clipped emitted byte prefixes; it retained full original byte indexing, semantic/source/schema/description/word/projection validation and the final canonical MSP2 packet. Full chunk backing, directory/view metadata and synchronous cross-chunk string copies were charged; actual tight owner capacity fell back to the original complete flat boundary. Static checks and the full candidate suite passed (19,634 tests, 19,635 total, one unchanged Windows POSIX-permission skip, 217 files). A first targeted test failed because its new fixture used a non-Native parser identity; that fixture was corrected, its failure retained, and the final full suite passed. The original prototype type error and all intermediate results remain under test/artifacts/logs/.

Four ordinary minified groups used all six complete 1 MiB documents and twenty actual edits each, in before→after→after→before order. All 252 matched publications/504 independent complete Native comparisons passed, with exact source/asset binding and original clocks/caps/yields. The memory construction criterion and pooled cold criterion passed; the candidate failed second-pair cold nested freshness (3,009.1→3,191.9 ms, exceeding its 5% allowance) and repeated-paragraph warm freshness p95 (360.4→402.4 ms, exceeding 10%). First-pair cold nested freshness was 3,154.1→3,269.0 ms. All six pooled warm p95 freshness results (40 samples per side) are retained: prose: 259.9→255.8 ms; single-paragraph: 228.1→226.5 ms; mixed-rtl: 249.9→251.3 ms; repeated-paragraphs: 360.4→402.4 ms; many-small-blocks: 394.3→395.4 ms; nested-containers: 395.8→412.7 ms. Cold nested mean receiving/applying rose 887.9→981.7 ms; mean full freshness rose 3081.6→3230.5 ms. Candidate maximum receive/apply slices were 2.9/1.5 ms. These measurements do not establish a causal profile or physical peak/aggregate admission.

All eleven implementation/test files were restored byte-for-byte to the frozen baseline; the existing pipeline82 verifier then passed all 811 current source/pin files. No application improvement, feature completion, UI change, production activation or fresh pipeline83 package/native/resource run is claimed. The exact pipeline81 application, its source-bound 19,609 passing full tests plus existing skip, directory package, 131 original Windows tests and three resource tests remain the inherited baseline; current artifacts are rechecked. Original application/M1–M4 completion, complete latency and physical memory admission, unfinished features, whole-product UI and physical IME/AT/touch/high-contrast, other-platform CI, installers/signing/distribution/release remain open. Pipeline80 forced-colors automation remains inconclusive and pipeline66's historical input incident remains unexplained. Candidate, rule, full tests, every ordinary timing group, restoration, final source freeze, fresh process cleanup and proof are preserved under test/artifacts/logs/pipeline83-*; verify with node test/artifacts/logs/verify-pipeline83-rejected-validation.mjs.

### Pipeline84: separate snapshot cursor trial

Pipeline84 implemented a separate chunk cursor with a shared lexical base and rejected it under the unchanged pipeline83 timing thresholds. A TypeScript AST audit proved that flat byte/number/synchronous-string/seek/copy/remaining and shared uint method bodies matched the frozen baseline. The new source-free snapshot handle still consumed once, retained only clipped emitted prefixes, charged full backing/metadata and string-copy workspace, and used the original full-copy fallback under an actual tight owner cap. Full original byte/reference/root and semantic/source/schema/description/count/projection validation remained; no Native certificate or trusted encoder metadata was introduced. An added complete position-summary/alias test covered the generalized fork API. Static checks and the full candidate suite passed: 19,635 tests, 19,636 total, one unchanged Windows POSIX-permission skip, 217 files. Initial static errors in the cursor bridge and typed-array inference were fixed; the failed check remains archived.

Four ordinary minified before→after→after→before groups used all six complete 1 MiB documents and twenty actual edits each. All 252 matched publications/504 independent complete Native comparisons passed. Exact source/assets binding verified 855 baseline/856 candidate loaded sources and118 assets per group. The original clocks/caps/yields and complete final MSP2 packet remained. All six pooled warm p95 freshness checks passed (40 samples per side): prose: 269.5→254.1 ms; single-paragraph: 230.6→231.0 ms; mixed-rtl: 255.9→261.1 ms; repeated-paragraphs: 360.5→367.0 ms; many-small-blocks: 455.4→434.2 ms; nested-containers: 444.0→416.0 ms. First-pair cold nested freshness was 3,216.1→3,217.7 ms; second-pair was 3,038.0→3,277.6 ms and failed its 5% allowance. The maximum candidate receive slice was6.4 ms and failed the4 ms limit; this was cold repeated paragraphs in pair2, whose baseline also exceeded the limit at5.8 ms. Apply max1.8 ms passed. Cold nested mean receive/apply rose 904.4→974.2 ms and mean full freshness 3127.0→3247.6 ms. Candidate warm maximum freshness was498.2 ms, a local observation that does not establish the full application latency gates. Source-method identity did not prove unchanged cold cost or identify its cause.

All twelve existing implementation/test files were restored exactly and the one new reader source was removed after its candidate bytes were archived. The pipeline83 verifier then passed all811 current source/pin files. The decision verifier was adjusted to read the same frozen candidate source after restoration removed the new file; its original version and both results remain, and no criterion or measured outcome changed. No application improvement, feature completion, UI change, production activation, or fresh84 package/native/resource run is claimed. The exact81 application, source-bound19,609 passing full tests plus existing skip, directory package,131 original Windows tests and three resource tests remain inherited and are checked against restored current bytes/artifacts. All original application/M1–M4 gates and remaining features/UI/platform/release work stay open, including physical Native peak/aggregate admission, physical IME/AT/touch/high-contrast and the unexplained pipeline66 input incident. Pipeline80 forced-colors automation remains inconclusive. Candidate, AST proof, all tests/groups/negative outcomes, restoration, fresh final process observation and source freeze are under test/artifacts/logs/pipeline84-*. Verify with node test/artifacts/logs/verify-pipeline84-validation.mjs.


Pipeline85 / pipeline85-projection: profiled the frozen84 baseline and rejected snapshot reader in actual Chromium, cold complete1MiB nested input plus2 actual CodeMirror edits, both unminified and minified with hidden source maps. All118 executable/non-map assets per minified variant exactly match the original84 ordinary build; each variant adds117 maps. All12 profiled publications match the original complete Native semantic SHA/counts/outline. Neither profile pair reproduces84's ordinary cold receive regression (unminified983.7→974.2ms; minified976.8→967.7ms). This does not establish a cause, a speedup, physical memory admission or retention. Mapped baseline output validation/rendering accounts for about476ms inclusive within977ms cold receive; inclusive ancestors overlap.

Implemented one-file reuse of complete bounded Native conversion groups/results under unchanged handlers, data, scratch charges, clocks and yield cadence. Fresh static and full candidate tests passed:19,609 passed/19,610 total/one unchanged Windows POSIX-permission skip across217 files. Four fresh ordinary groups (before1→after1→after2→before2), six complete1MiB cases and20 real edits each, verify252 matched publications/504 independent complete Native outputs with855 loaded sources/118 assets per build. Rejected by the predeclared rule: cold nested freshness pair1 rose3038.5→3277.3ms, exceeding5%; pair2 fell3521.7→3376.0ms. Mean cold nested receive983.35→982.45ms is only0.90ms lower; it does not establish a meaningful benefit. Other local gates passed: pooled all-cold and all six warm freshness p95 comparisons, max receive slice2.9ms and apply slice1.3ms. Original application latency gates remain unmet. All adverse observations remain undertest/artifacts/logs.

Restored the one application file byte-for-byte and freshly verified all811 baseline source/pin files plus the inherited81 package/source/runtime evidence. Only this validation note and ADR003 append are retained. No85 package/build/native/resource suite or application/feature/UI improvement is claimed. Inherited81 evidence remains19,609 passing units/one skip,131 Windows native tests and3 resource scenarios; no new release claim. Fresh final CIM observes zero current/project Manuslip/Electron processes. The original full application/M1–M4 goal remains active, with full latency, physical peak/aggregate allocation admission, unfinished features, whole-product UI and physical IME/AT/touch/high-contrast, other-platform CI, installers/signing/distribution/release unresolved. Forced-colors automation remains inconclusive and the historical66 input incident remains unexplained.


Pipeline86: previous85 progressed through tested rejection evidence only; no application improvement was retained. Freshly reverified85, then measured a separate minified renderer counter build for cold complete1MiB nested input plus2 actual CodeMirror edits. Three complete Native semantic SHA/count/outline matches,855 loaded original source bindings,13 exact injected-source transforms and118 assets verify. Cold request→ready counters include5,539,266 capture identity reads,2,360,099 PackedWork advances,1,671,353 scope assertions,906,938 encoded-record reads,787,270 encoded-reference reads and481,834 Native-copy value visits. Four wrapper sites each advance about479,857–479,860 times; Native-copy guard486,124. Counts overlap across layers; Worker globals and later cache/hash phases are excluded. Instrumentation affects timing; counts do not establish allocation sizes, independent work, cause or retention acceptance.

Implemented a shared void-progress adapter across those five wrappers. Both guards surround every child advance/completion; original cleanup failure precedence, queued cancellation, reentrancy, borrowed-value isolation and Native iterator helpers remain. An initial static check found missing inherited iterator helpers and one test call argument; fixed by inheriting Native Iterator and adding helper cleanup coverage. Preserved prototype source/tests/failure logs. Final static and full tests passed:19,644 passed/19,645 total/one unchanged Windows POSIX-permission skip across218 files, including35 new adapter differential/safety tests.

Four fresh ordinary groups, all six complete1MiB corpora and20 actual edits each, verify252 matched publications/504 independent complete Native outputs,855 baseline/856 candidate sources and118 assets per build. Rejected under the unchanged predeclared rule: pooled cold nested receive1090.60→1071.15ms improves only1.78%, below5%; cold freshness pair1 regresses3377.4→3588.1ms, while pair2 improves3750.3→3393.9ms. Cold many-small-block receive slices6.7/5.6ms exceed the strict4ms limit (corresponding baseline1.9/2.4ms). All warm freshness p95 local comparisons and pooled all-cold allowance pass; maximum apply slice1.9ms. All adverse observations remain. This does not prove the cause of individual outliers or the original full application gates.

Restored five original files byte-for-byte, removed the two added files after verifying their candidate hashes, rechecked all811 baseline source/pin files and inherited81 package/source/runtime evidence, and observed zero final project Manuslip/Electron processes. Only this note and ADR003 append remain. No86 application/feature/UI improvement, new package/build/native/resource suite or release acceptance is claimed. Qualified inherited81 evidence remains19,609 units/one skip,131 Windows native tests and3 resource scenarios. The full original application/M1–M4 goal remains active: complete latency, physical peak/aggregate allocation admission, unfinished features, whole-product UI and physical IME/AT/touch/high-contrast, other-platform CI, installers/signing/distribution/release remain open. Forced-colors automation is inconclusive; the historical66 input incident remains unexplained.


Pipeline87: previous86 made progress through tested rejection evidence; no application improvement retained. Freshly reverified86 and implemented a separate owned encoder-prefix cursor, preserving the entire original flat PackedReader class:6,111 source bytes/all16 members exactly equal by source and normalized TypeScript AST, with no superclass or added fields/methods. Storage-specific lexical traversal uses the existing string scanner independently. Genuine one-use snapshot ownership, full backing/metadata/workspace admission, all byte/reference/root/source/semantic/word/description/render/output checks, complete final canonical wire packet and actual tight-owner copy fallback remain. The representative full producer test proves only the final flat encoder output. This source/memory mechanism evidence is not a JIT guarantee or physical peak/aggregate admission proof.

Static checks and the complete unit suite passed:19,635 passed/19,636 total, one unchanged Windows POSIX-permission skip across217 files. Four fresh ordinary groups retain all six complete1MiB corpora and20 actual CodeMirror edits each,252 matched publications/504 independent complete Native semantic SHA/count/outline comparisons,855 baseline/856 candidate loaded-source bindings and118 assets per build. Local retention rejected on: receiveSlices. Cold nested freshness pair1 3044.70→3087.80ms (pass); pair2 3185.80→3091.30ms (pass). Pooled all-cold freshness 1239.97→1244.02ms; maximum receive/apply slices 4.50/1.70ms against strict<4ms. All warm per-corpus p95 results and adverse observations remain in the verified retention record. The rule was declared before implementation/timing and was not relaxed. These results do not establish a cause for any individual outlier.

Restored all12 original application/test files byte-for-byte and removed the one added module only after verifying its candidate hash. All811 baseline files/pins reverified; only this note and ADR003 append remain. Inherited81 directory/ASAR/current source/runtime/pin evidence is freshly rechecked, with zero final project Manuslip/Electron processes. No87 application/feature/UI gain, fresh package/build/native/resource suite, production activation or whole-goal completion is claimed. The full original application/M1–M4 goal remains active, including complete1MiB latency/freshness, bounded physical Native/old-new/other-consumer allocation and aggregate memory admission, unfinished features, whole-product UI/physical IME/AT/touch/high-contrast, other-platform CI, installers/signing/distribution/release. Forced-colors automation remains inconclusive and the historical66 input incident remains unexplained.


Pipeline88: previous87 progressed through implemented/tested/rejected snapshot evidence, with baseline application restored. Freshly reverified87. A scratch diagnostic of the complete1MiB nested renderer path bound855 original sources,2 exact injected-source transforms and118 assets; all3 complete Native SHA/count/outline comparisons matched. Cold906,938 encoded metadata reads and787,270 reference reads included412,532 simulated header hits (52.40%). Eight-entry metadata recency is limited evidence about potential reuse, not latency or allocation size.

Implemented header reuse in the arena's existing128-byte field cursor reservation, with an explicit numeric mode and independent per-call re-seek/bounds/child checks. All capture/scope guards, record bounds and independent semantic/source/word/description/output checks remain. Normalized whole-module AST comparison excluding only encodedReference proves all43 existing members/fields, other methods, index validation/allocation/admission and constants unchanged; the entire byte-reader module is unchanged. Full static/unit checks passed:19,615 passed/19,616 total, one unchanged Windows POSIX-permission skip across217 files. Six added tests exercise field/reference mode changes, independent suspended streams, multi-byte/interior offsets, scalar/invalid reference failures and actual header-read bounds.

A separate exact-source-bound candidate diagnostic verified3 more complete Native matches and actual374,738 header decodes, eliminating52.40% of the baseline787,270 headers. Metadata/reference call totals match. The strict predeclared field-call parity condition failed:428,495→428,521 (+26) in the request→ready window. The initial assertion source and a fresh reproduction with native1 log/metadata are preserved. The analyzer now reports that mismatch, and retention keeps it as a failed criterion; no rule or measurement data was relaxed. These counters include work observed before ready, including possible optional cache activity; they do not establish a cause for the26-call difference or application latency benefit.

Four ordinary before/after/after/before groups retain all six complete1MiB corpora and20 actual CodeMirror edits each,252 paired publications/504 independent complete Native comparisons,855 sources and118 assets in every build. Local retention rejected on coldCallParity, coldNestedReceive. Cold nested freshness pair1 3029.80→3042.90ms (pass); pair2 2976.10→3048.10ms (pass); mean cold nested receive 866.20→893.00ms; pooled all-cold freshness 1209.08→1217.28ms. Maximum receive/apply slices 2.50/1.20ms against strict<4ms. All warm per-corpus p95 and adverse results remain in the retention record.

Restored both application/test files after verifying their candidate hashes and reverified all811 baseline files/pins. Only this note and ADR003 append remain; no88 application, feature or UI improvement is retained. The inherited81 package, current ASAR/source/runtime/pins and zero final project Manuslip/Electron processes are freshly rechecked; no88 build/package/native/resource-suite run is claimed. The full original M1–M4/features/refined-UI application goal remains active, including complete latency, bounded physical Native/old-new/other-consumer allocation and aggregate memory admission, unfinished features, physical IME/AT/touch/high-contrast, other-platform CI and installers/signing/distribution/release. Forced-colors automation remains inconclusive; the historical66 input incident remains unexplained.

Counter-window source inspection: the fixture awaits its stop hook, but the exposed Node callback takes its snapshot using a second asynchronous page.evaluate call. The snapshot is therefore later than the renderer stop-hook invocation and can include work scheduled in that gap. This identifies a protocol limitation, not a proved cause of the26 additional fields. Both original windows and the declared failure remain; no ordinary clock/boundary is changed. A future protocol should synchronously capture renderer numeric counters at the hook and retain the later observation separately. It should also count actual field-cache misses: the shared reference mode clears the field shape, so header savings can replace a useful field cursor. Call totals alone do not measure that tradeoff.


## Pipeline89: renderer-hook counter capture and editing/preferences review (2026-10-31)

Previous88 made progress through implemented, tested and rejected cache evidence; no application improvement was retained. Fresh88 verification passes before this append. Pipeline89 changes scratch diagnostics and documentation only. The full original application goal remains active; this checkpoint does not retain an application, feature, UI or performance improvement.

The scratch driver now captures numeric counters synchronously at the actual renderer stop hook, preserving the later asynchronous observation separately. Receive and optional cache task identities are labeled only in the diagnostic build. Both variants retain every original guard, reader operation, yield, clock and capacity check. Each consumes855 original source files,4 reproducible injected transforms and118 built assets. All six complete Native semantic hashes/counts/outline match the existing full1MiB nested oracle, through cold publication and2 actual CodeMirror edits per variant.

| Cold mandatory receive operation | Baseline | Rejected88 code |
| --- | ---: | ---: |
| Encoded metadata records | 906,938 | 906,938 |
| Encoded references | 787,270 | 787,270 |
| Reference headers decoded | 787,270 | 374,738 |
| Field reads | 428,433 | 428,433 |
| Field-cache misses | 141,775 | 141,775 |
| Skipped field references | 299,239 | 299,239 |
| Selected field references | 327,615 | 327,615 |

At the immediate cold hook, both variants have428,495 total field calls, including62 outside the labeled work. Both later observations add26 field calls in the optional cache phase,14 cache misses,7 value hits,22 skipped references and19 selected references. Thus the new paired protocol directly observes cache work in the asynchronous gap. It does not establish the cause of the original88 mismatch. The suspected increase in receive-side field-cache misses/scans is not observed in this run. Counts do not establish cost, physical allocation or a latency benefit. All original88 windows, its failed parity criterion and independent866.2→893.0ms ordinary receive regression remain binding; the rejected cache is not reapplied. No ordinary measurement boundary is changed.

The better-accessibility review expands the source-bound81 native survey to editing and Preferences. Four normal-theme states (welcome, editor, Preferences and320px Preferences) have zero axe violations and no page overflow/errors. Keyboard New focuses editable CodeMirror; keyboard Preferences opens the modal; Escape restores its trigger. Raw AX names/roles, computed styles, screenshots and incomplete checks are preserved. Three forced-color emulations retain29/24/10 raw contrast findings. Screenshots show black system text and visible controls/focus while computed text-fill remains author gray, which axe prefers. This remains inconclusive automated contrast evidence; no product palette change or physical high-contrast/screen-reader approval is claimed. The first survey's incorrect Settings locator and native failure are preserved; correcting it to the existing Preferences label produces the complete passing survey. Details: test/artifacts/logs/pipeline89-ui-review.md and bound raw files.

All811 source/test/pin files match88 before these two documentation appends. The inherited81 package/source/runtime/pins and final process state are rechecked; these are fresh artifact checks, not a new build/package or a rerun of the131 native and3 resource suites. Full complete1MiB latency/freshness, physical Native/old-new/other-consumer allocation and aggregate admission, unfinished M1–M4 features, whole-product UI/physical IME/AT/touch/high-contrast, other-platform CI, installers/signing/distribution/release remain open. Production experiments stay off. The historical66 input incident remains unexplained. All temporary output remains under ignored /test/artifacts/logs/.


## Pipeline90: native clock binding in the core block stream (2026-10-31)

Previous89 progressed through corrected counter timing/phase attribution and a broader native UI survey; no application gain was retained. Fresh89 canonical/current811-source verification passed. The source-bound historical Worker profile identifies the original block-stream generator at36612 with133.334ms sampled self time. This locates a candidate, not clock-only cost or a promised benefit. An off-by-one source-line assertion in the scratch inspection was corrected; its initial driver/failure log remain preserved.

Bound performance.now to its original native Performance receiver once at the first advance of each lazy stream. All21 original clock reads remain at their exact AST locations, including both sides of each grammar/compiler/description advance. Reversing just this binding/substitution makes the entire module AST equal to baseline; all other source is byte-identical. No source/semantic/word/output guard, clock-read count, timing boundary, yield, quota, cap or production activation changes. The existing parked-time test now checks receiver identity and lazy entry as well. Static checks pass; focused4360/4360 and full19,609/19,610 tests pass across217 files, with one unchanged Windows POSIX-permission skip. No new test count is claimed.

Four ordinary minified groups (before→after→after→before) use all six complete1MiB corpora and20 actual CodeMirror edits each. Each build binds855 actual loaded sources and118 assets. All252 matched publications/504 independent complete Native semantic hashes/counts/outline comparisons pass. All observations and outliers remain. The local rule was declared before mutation/timing: both cold nested pairs improve, pooled cold nested gain≥1%, other cold/warm/receive allowances and strict receive/apply slices<4ms.

| Observation | Before ms | After ms |
| --- | ---: | ---: |
| Cold nested freshness, pair1 | 3841.50 | 3382.70 |
| Cold nested freshness, pair2 | 3439.80 | 3368.10 |
| Pooled cold nested freshness | 3640.65 | 3375.40 |
| Pooled all-cold freshness | 1407.04 | 1364.67 |
| Cold nested receive | 1121.00 | 989.20 |
| Cold nested parse phase | 671.35 | 643.00 |
| Cold nested describe phase | 99.30 | 95.30 |
| Cold nested serialization phase | 995.10 | 921.35 |
| Warm freshness p95, prose | 272.10 | 271.30 |
| Warm freshness p95, single-paragraph | 230.50 | 230.60 |
| Warm freshness p95, mixed-rtl | 265.30 | 263.30 |
| Warm freshness p95, repeated-paragraphs | 381.10 | 386.10 |
| Warm freshness p95, many-small-blocks | 421.40 | 434.20 |
| Warm freshness p95, nested-containers | 454.90 | 442.00 |

Pooled cold nested change: 7.29% improvement. Candidate maximum receive/apply slices: 3.20/1.60ms. Retained the core-stream clock binding and stronger existing timing test after all declared local gates passed. Fresh production build and Windows directory package passed. 247 of 247 runtime files match the81 baseline. All 9665 ASAR files are inventoried; 563 current source/runtime checks,18 parser pins,3 unpacked native files and77 directory artifacts verify. All131 original Windows native tests pass at30s/one worker/zero retries/skips/flaky results. Original300s resource suites pass:50 closed-file cycles (46607146→49488229 bytes,+6.18%; all6 readings<250MiB/10% with2 unique isolates, main heap/external, stable resources/listeners and settled filesystem), exact50MiB replacement/undo/redo/save and three5MiB stress shapes plus multibyte rejection. Closed retention is not full nested peak/aggregate Native allocation admission.

This local change/evidence does not complete the original full application goal. Complete1MiB input/mode/latency/freshness, physical Native/old-new/other-consumer allocation and aggregate admission, unfinished M1–M4 features and sequencing, whole-product refined UI and physical IME/AT/touch/high-contrast, other-platform CI, installers/signing/distribution/release remain open. Production packed/incremental experiments stay off.89's normal UI survey is inherited, not a new90 UI audit; forced-color automated contrast remains inconclusive and the historical66 input incident remains unexplained. Scratch output remains in ignored /test/artifacts/logs/.


## Pipeline91: bounded range-hash arithmetic (2026-10-31)

Previous90 made progress by retaining the lazy native clock binding, with full/static/focused and fresh package/native/resource checks. Fresh90 canonical/current811-source verification passed. Refreshed actual unminified Worker and ordinary-minified renderer CPU diagnostics cover complete1MiB nested input plus2 real edits each, with all6 complete Native semantic/count/outline results equal to ordinary90. Worker868 loaded sources/118 assets and renderer855 originals/235 assets are bound; all118 renderer executable assets exactly equal ordinary90-after-1, with117 additional hidden maps. The cold Worker rangeHash frame has56.58ms sampled self cost. Sampling and asynchronous stop gaps are diagnostic only. The broad largest encoder frame was inspected; bounded range arithmetic was selected without repeating rejected ownership/traversal layouts. A scratch verifier initially requested absent esbuild; the preserved initial driver was corrected to use installed rolldown before trace validation; no application/criterion change resulted.

Moved exact ordered UTF-16 dual-hash arithmetic into one normal helper, using two numeric slots in the existing per-block budget and no per-node allocation/table. Shared4096-unit checkpoints, cursor reset budgets, read order, partial metadata publication, source/semantic/word/output checks, all21 retained core-stream clock sites and all other runtime source remain unchanged. Full remaining-module AST/source comparison and49 complete old/new traces cover ranges, Unicode, nested sharing, traversal/heading resets, seeded ranges, cancellation and read failures. The stronger existing nested test checks exact checkpoints and partial publication. Static checks and4360 focused tests pass. Full19609/19610 tests pass across217 files, with the same Windows POSIX-permission skip and no new test count.

Four ordinary minified groups (before→after→after→before), each855 loaded originals/118 assets, cover all six complete1MiB corpora with20 actual CodeMirror edits each. All252 matched publications/504 independent complete Native results pass. The local rule was declared before mutation/timing: both cold nested pairs improve, pooled gain≥1%, unchanged cold/warm/receive allowances and strict receive/apply slices<4ms. All observations/outliers are retained.

| Observation | Before ms | After ms |
| --- | ---: | ---: |
| Cold nested freshness, pair1 | 3327.00 | 3407.60 |
| Cold nested freshness, pair2 | 3154.60 | 3259.90 |
| Pooled cold nested freshness | 3240.80 | 3333.75 |
| Pooled all-cold freshness | 1296.21 | 1302.32 |
| Cold nested receive mean | 1011.15 | 1062.80 |
| Warm freshness p95, prose | 263.00 | 267.60 |
| Warm freshness p95, single-paragraph | 229.50 | 230.70 |
| Warm freshness p95, mixed-rtl | 260.40 | 261.80 |
| Warm freshness p95, repeated-paragraphs | 408.20 | 370.30 |
| Warm freshness p95, many-small-blocks | 435.90 | 435.40 |
| Warm freshness p95, nested-containers | 426.20 | 439.50 |

Observed pooled cold nested gain: -2.87%. Candidate maximum receive/apply slices: 7.10/1.40ms. Rejected the helper under the rule declared before mutation; failed criteria: bothColdNestedPairsImprove, pooledColdNestedImprovesAtLeastOnePercent, coldNestedReceive, receiveSlices. Restored both candidate files byte-for-byte to the retained90 baseline. No application improvement is claimed. Fresh restored90 canonical verification passed before these append-only notes. The current source-bound90 package/artifact/ASAR checks are inherited and reverified; no new native/resource runs or UI audit are claimed.

The original full application goal stays active. Complete1MiB input/mode/latency/freshness, physical Native/old-new/other-consumer construction and aggregate memory admission, unfinished M1–M4 features/sequencing, whole-product refined UI and physical IME/AT/touch/high-contrast, other-platform CI, installers/signing/distribution/release remain open. Packed/incremental production experiments remain off.89 normal UI evidence is inherited; forced-color automation remains inconclusive and historical66 input incident remains unexplained. All scratch stays under ignored /test/artifacts/logs/.


## Pipeline92: composition handoff keeps source commands guarded (2026-10-31)

Previous91 made progress by refreshing source-bound CPU evidence and rejecting/restoring a range-hash regression; the retained90 application remained authoritative. Fresh91 canonical/current811-file verification passed. Inspection confirmed that the native projection child pass carries required trimming semantics; no projection shortcut was applied. Investigation of the still-unexplained66 input incident found a separate, reproducible command-guard race.

The source editor previously queued an unconditional onComposition(false) callback at compositionend. When a second compositionstart arrived in the same task, that older microtask incorrectly cleared the document's composing state. A source-bound native90 package probe records CodeMirror compositionStarted=true while Export becomes enabled. Both Source and Live Preview application regression cases fail at this guard on the unmodified90 package. This establishes the separate guard bug; it does not establish the cause of66's extra characters.

The deferred callback now reads CodeMirror's public compositionStarted getter and reports an ended composition only when the view is no longer composing. Replacing just this handler in the AST makes the whole editor module equal to baseline. All other runtime/source files, semantic/source/count/output checks, clock reads/boundaries, quotas, caps, ownership/cancellation and production experiment flags remain unchanged. Two new application tests cover the end/start handoff, guarded export, final Unicode commit, and exact saved bytes after save, undo and redo in Source and Live Preview.

Static checks and26 focused editor/document/input-synchronization tests pass. Full19609/19610 tests pass across217 files, with the unchanged Windows POSIX-permission skip. The final E2E refinement is outside Vitest's apps/packages test scope; all unit inputs and runtime bytes remain identical to the full run. The final static check includes that refinement. No new unit test count is claimed.

The scratch evidence reader initially expected a file attachment; Playwright stored inline bytes, and decoding was corrected before mutation. An initial source-template check omitted the unchanged return false statement; the verifier was corrected without changing product code or criteria. Initial new-test lint failures were corrected. The first fresh-package regression run passes the new guard and exact commit checks but fails at redo because the new test used Control+Shift+z on Windows. The corrected test uses CodeMirror's Control+y and checks exact saved bytes after both undo and redo. Its final form fails both original90 guard cases and passes both current92 cases; all initial failures/versions/traces remain preserved. No retry or timeout relaxation was used.

Fresh production build and Windows directory package pass. There are247 runtime files (235 unchanged against90). All9665 ASAR files are inventoried;563 current source/runtime checks,18 parser pins,3 unpacked native files and77 directory artifacts verify. All133 native application cases (131 original plus2 added) pass at30s/one worker/zero retries/skips/flaky results. All3 original300s resource scenarios pass:50 closed-file cycles (46585652→48422644 bytes,3.94% growth), exact50MiB replacement/undo/redo/save/reopen and three5MiB source stress shapes plus multibyte rejection. Closed retention does not establish full nested Live peak or aggregate allocation admission. Positive live-package and final zero-process observations are retained. The final source manifest contains812 inputs; the new input is the regression test.

Composition begins through Chromium's debugger protocol; the same-task end/start handoff is explicitly scripted and untrusted. These tests establish software guard behavior and exact tested data/history behavior, not physical IME/AT acceptance. The historical66 cause remains unproved. There is no new ordinary latency or whole-product visual audit claim. Original complete1MiB input/mode/latency/freshness, physical Native/old-new/other-consumer construction and aggregate memory admission, unfinished M1–M4 features/sequencing, refined whole-product UI and physical IME/AT/touch/high-contrast, other-platform CI, installers/signing/distribution/release remain open. Packed/incremental production experiments stay off.89 normal UI evidence is inherited and forced-color automation remains inconclusive. Scratch remains under ignored /test/artifacts/logs/.


### Pipeline93 — consistent staged plain-text paste across multiple selections

The original full application goal remains active. Pipeline92 was progress: its retained
composition guard and fresh package checks passed. Pipeline93 freshly reverified that proof
before changing runtime. Inspection of M1 editing behavior found a distinct size-dependent
paste regression: native small plain-text paste distributes one line per selection when
their counts match; the staged large-paste path repeated the entire clipboard at each range.
The exact final Source and Live Preview regressions fail on package92 after four correct
small-control save/history snapshots: 300,030 expected UTF-16 units become 600,055 actual.
Public keyboard multi-selection and scripted plain ClipboardEvents exercise the real app;
the events are explicitly untrusted. This does not validate physical input or OS clipboard
ownership, or explain the historical Pipeline66 extra-character failure.

The retained runtime change is confined to apps/desktop/src/renderer/src/paste.ts. At commit,
plain input with matching normalized Text line/selection counts uses Text slices per captured
range, per-insertion cursor lengths and native by-line cursor association. It keeps the main
selection, mapped original ranges, private cooperative preparation, cancellation, document
byte cap and single isolated input.paste transaction. Mismatched plain counts and multiline
rich-text conversion retain whole-input replication. No whole-clipboard join/split, semantic,
parser, clock, quota, guard, production flag or capacity change was introduced. The rest of
the module and every other runtime source are unchanged from92. The predeclared correctness
rule SHA-256 is 38f2250f3bb9d69ffbf68b8846bf2a8cb09ecc4d973b5de274a3d64b4007d9ec.

Nine added unit cases cover CRLF/CR/LF with Unicode, unequal lengths, reversed selections,
both main indices and intervening unrelated edits; empty lines; differing line/selection
counts; and rich multiline replication. Focused27 tests, full19,618/19,619 tests across217
files (the same Windows POSIX-permission skip), and final static checks pass. All133 existing
plus2 new Windows native cases pass without retries, skips, flaky results or suite errors.
Each new targeted regression has11 exact saved-content/hash checks, covering the native
small control, staged large paste, typing at both retained cursors and isolated undo/redo.
The complete native run finished 2026-10-31T09:03:44.473Z.

Initial test work is preserved: a unit fixture initially edited a selected boundary and was
corrected to edit outside both ranges; a second formatter pass was required; and the first
after-package run exposed the test's invalid assumption that a small native paste isolates
subsequent typing. The small control now checks its own undo/redo; every staged-large history
assertion remains. Exact final tests fail on92 and pass on93. This refinement changes only
the E2E file; its runtime and full-unit inputs remain identical to the completed full run.
No application change or package rebuild was hidden by the test correction.

All3 original resource scenarios pass at their original300-second configuration. Closed
Source lifecycle retention over50 cycles changes from46,535,860 to48,358,002 bytes
(3.915565%); all6 readings stay below250MiB and10% growth, with2 distinct observed isolates,
stable native resources/listeners and zero pending filesystem work. Exact50MiB replacement,
undo/redo/save/reopen and3×5MiB stress cases remain verified. These closed Source checks
do not prove full nested Live physical peak or Native/old-new/other-consumer aggregate
construction admission. No new ordinary semantic performance improvement is claimed.

Fresh Windows directory package: test/artifacts/logs/pipeline93-package/win-unpacked/Manuslip.exe.
EXE SHA-256 31dac5ec2eeb9d89b5c1b913d1831bd8273724deab600abde978e83f767720a7;
ASAR SHA-256 965af484deff3d44e690332fff5329c44b1a9eb7230dfd581dc854ff964767f0.
All9,665 ASAR files are inventoried,563 current source/runtime/manifest files checked,
18 parser/dependency pins and3 unpacked native files verified, and77 directory artifacts
hashed. Runtime247 assets include235 unchanged from92; main and all preload bytes match.
Source counts remain core177/editor18/renderer93/translate27. This is a fresh directory
package, with no installer, signing, installation, publication or other-platform claim.

Canonical evidence: test/artifacts/logs/verify-pipeline93-validation.mjs; predeclared rule, source proof,
actual execution records, every initial failure, final native attachments and resource/package
inventories remain in test/artifacts/logs/pipeline93-*. Root17 ordinary files and unrelated dirty files are
preserved. Original M1–M4 scope remains open: complete1MiB responsiveness/freshness and bounded
host callbacks, physical/aggregate construction admission, unfinished features and milestone
sequencing, whole-product refined UI, physical IME/AT/touch/high-contrast, other-platform CI,
installers/signing/distribution and release. Packed/incremental production flags stay off.


## Pipeline94: native document cycling and input-safe preview publication (2026-10-31)

The delivery objective now explicitly prioritizes complete features and refined UI over
perfect performance. ADR 002 records that priority and a concrete M4 checklist. Existing
correctness, recovery, security and enforced resource caps remain requirements; historical
latency and unproven physical-memory targets are improvement work, not a reason to defer M4.

View now offers localized Next/Previous document commands with Ctrl+Tab/Ctrl+Shift+Tab.
They wrap in display order, accumulate repeated requests during pending input, preserve
source/history and keep the correct editor/tab focus. Preferences retains its document
and focus while open. The existing validated command channel is reused.

The first full package run passed137/139 and exposed a separate preview-publication race.
A forced worker-delivery probe records DocumentPreview.apply causing DOMObserver.clear
to consume held Unicode input before CodeMirror reads it; the former93 package also
reproduces the original tab-input failure. SlicedWork now retains its one prepared result
until the existing public input synchronization boundary settles, then checks validity
again. Cancellation, obsolete work and rejection discard prepared owned resources;
installation receives ownership once. All three preview preparation paths use the barrier.
Freshness/ready publication follows the actual accepted installation. Core/parser source,
transport, clock reads, resource caps, quotas and experiment flags are unchanged.

The recovery failure has a distinct test cause: controlled delayed New IPC proves that
the fixture filled the still-active named file, which auto-saved those exact bytes, before
the unnamed tab existed. The test now waits for the selected new tab before typing its
interrupted draft. All restart, recovery-content, retry, removal and next-restart assertions
remain. Three additional transition fixtures now wait for the second new tab, selected
duplicate-file tab or restored source-editor focus before typing. Their original failures,
traces, both packages and source-bound probes are preserved.
The native shortcut fixture also now uses Electron input; browser CDP keys bypass native
menu accelerators. Type/lint fixture corrections and the original failed runs remain.

Static checks pass. Full19,629/19,630 unit cases pass across217 files, with the existing
Windows POSIX-permission skip. Final40 focused cases include all19 scheduler cases.
Five barrier assertions fail before implementation; one complete-throws ownership control
already passes. The final added unit fixtures gained a lint-required yield and explicit
undefined return; every other unit input and all runtime bytes match the full run.
Native coverage combines135 complete-run passes with4 corrected targeted transition passes
on the identical current package, with original timeouts, one worker and zero retries.
The full run's4 fixture failures remain visible; no single green139-case run is claimed.
All3 original resource scenarios pass without skips or retries.
Four native cycling regressions include12 exact save/undo/redo content/hash snapshots.

The tab workflow was reviewed across all six better-interface domains, including duplicate
and mixed-script titles, keyboard context, close/cancel, narrow/zoomed layouts, light/dark
and a diagnostic RTL mirror. Measured tab text contrast is at least5.2479:1 and focus
outline contrast6.2794:1. Native capturePage resolves the browser screenshot zoom clipping.
Seven of eight states have no axe violation; the stubbed close state retains the recorded
scrollable-region-focusable observation because its native dialog is not shown. Physical
AT/native modal behavior is not established. See test/artifacts/logs/pipeline94-ui-review.md and the
hashed raw before/initial/final-package survey outputs for the bounded review and limits.

The fresh current package is test/artifacts/logs/pipeline94-barrier-package/win-unpacked/Manuslip.exe.
EXE SHA-256 f0fb13f048dcf27d23bf361255a81fa22d2c85c231ad3c0e07afe02962b77d2c;
ASAR SHA-256 89cff62b69a59317eb1e391c9dd1e7f9669cff22fea03bc169df9bdee0a6fae1.
All9,665 ASAR files are inventoried,563 current source/runtime/manifest files checked,
18 pins and3 unpacked native files verified, and77 directory artifacts hashed. Of247
runtime assets,233 match93. All315 packaged core/editor/renderer/translation source files
and diagram/print preloads are unchanged; native menu and command preload changes are explicit.

Closed Source retention over50 cycles is46,840,405→48,555,490 bytes (3.66155% growth),
with6 readings,2 distinct isolates, stable resources/listeners and settled filesystem.
Exact50MiB editing/save/reopen and3×5MiB source stress cases pass. This does not establish
complete nested Live physical peak or aggregate allocation admission. No new ordinary
semantic performance gain is claimed. The original resource configurations were preserved.

Canonical evidence is test/artifacts/logs/verify-pipeline94-validation.mjs. The original rule, explicit
input-fix amendment, source/runtime/package inventories, actual process execution receipts,
all adverse evidence and final reports remain under ignored /test/artifacts/logs/. Root17 ordinary files
and unrelated dirty work are preserved. No installer/signing/publication or other-platform
claim is made. The full application objective remains active; proceed with M4 feature work.
