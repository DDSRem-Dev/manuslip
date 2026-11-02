# Release completed tokenizer state before mdast compilation

`scripts/patch-parser-lifetimes.mjs` applies a paired local lifetime patch to pinned
`micromark@4.0.3` and `mdast-util-from-markdown@2.1.0`. Root postinstall installs it;
lint and desktop builds check it. Core declares both exact dependencies directly.

| Package / file | Original normalized-LF SHA-256 | Patched normalized-LF SHA-256 |
| --- | --- | --- |
| micromark / lib/create-tokenizer.js | `4d563d31e0f48eb0460072c869c6e38d92da7179768a671c66fa9db9fbe4fadf` | `a5706cb8169715d0bae53db9521b20a6d37de55a235a6b623a655c8640e25789` |
| micromark / dev/lib/create-tokenizer.js | `3046dca3821cd57682f7bea3a91879519d7821a5976f2bd8aef5ce644885f7ce` | `4748267dc2f1a8f245dc7d207738465c9af5cca56178b128ff8a2f011a05621d` |
| mdast-util-from-markdown / lib/index.js | `dd0cd20672558ab4ca548b4f7e442e850863228915fff8eafd6d987d29fb107b` | `2caaaaa1679fbf33b78b40ae074f39eed5bd12993a86aa87093ee53732c4379d` |
| mdast-util-from-markdown / dev/lib/index.js | `c05ff75bbc99fbae60f4bcf53bc29edc7ab20f3750c7f3bc3ed6381e2f7627dd` | `8194000ec980fe15c46fe74347c993459f4edfa8832a664aa454c80d66d0c39a` |

Upstream sources: [micromark](https://github.com/micromark/micromark) and
[mdast-util-from-markdown](https://github.com/syntax-tree/mdast-util-from-markdown).
The installed MIT licenses and copyright notices remain intact. These are local patches,
not claims of upstream releases. Default and development exports are patched together.
Every package version and source is validated before any file is written. Unknown versions
or local changes fail closed; original CRLF spelling, idempotent installs and known partial
installs are supported. Check-only builds never repair files silently.

Originally, each tokenizer's serializer closes over its complete tokenizer scope, including
parser state and events. Mdast compilation only consumes `sliceSerialize` from each completed
event context, but the original full contexts keep that state live throughout compilation.
The first change creates the serializer in a separate source-only factory. A small mutable
holder follows the tokenizer's current source chunks, so the same function remains valid
before, during and after streaming writes, including initially empty chunk arrays. It calls
the original chunk slicing and serialization functions; Unicode, CRLF, tabs and expansion
behavior stay unchanged. Public micromark event contexts remain complete.

The second change runs after all micromark postprocessing/resolvers and before mdast's private
compiler. It replaces the internal event context with a memoized `{sliceSerialize}` record.
The private compiler uses no other context fields, including when it synthesizes list-item
events. Token objects, order, coordinates, list preparation, handlers, listener context copies
and transforms stay unchanged. The general whole-event compiler does not consume its arrays;
the application span path described below releases its private consumed arrays. The serializer
factory alone cannot release a tokenizer while the full event context remains live; the two
changes must be installed together. Internal serialization stack traces can omit the previous
`sliceStream` helper frame.

`test/benchmark/helpers/parser-lifetime-sources.mjs` reconstructs exact original sources and verifies their
independent original hashes. `node test/benchmark/profiles/compare-parser-lifetimes.mjs` launches four fresh
processes: original/patched under default/development export conditions. Original processes
substitute only those verified original sources through Node load hooks; they never rewrite
installed dependencies. Each process compares 1,642 hashes of complete semantic documents
(including roots, positions, descriptors, outlines and counts) plus complete renders under both
raw-HTML policies. Inputs include all 652 CommonMark examples, extensions, containers, seeded
combinations and the full 1 MiB nested root, with both application grammars. Loaded export files
are checked explicitly. A separate forced-GC probe holds the serializer callable and its range:
the original keeps its actual tokenizer alive; patched tokenizers collect and serialization
still works. Streaming method identity and complete public event contexts are also checked.
Other dependencies, including the existing event-map and traversal backports, remain identical
across these four processes; this comparison isolates the new paired lifetime change.

Isolated installation tests exercise the actual script against both packages/all four files,
missing-patch builds, exact installed contents, idempotence, unknown versions/content, partial
installation and CRLF. The recognized previous mdast patch hashes
`6e9aa9f5902ace264cbe42d28841e649a7f0b8ab8969e0813709d2bc3aae52e6` and
`1a1c6e7d50693b9c068e5706970ef5f9b0c4d6d8a2eda7205b48a55fa3c76763` can be upgraded;
check-only builds reject them until installation completes. Runtime measurements and rejected prototypes are recorded in
`docs/validation/implementation-history.md`. Reduced retained graphs or sampled process commitment do not establish
a portable physical peak bound, semantic transport activation or complete nested UI freshness.
The first span patch hashes `7bfda0e45999e1a89d7510f2fe57c9ab7fbe890aac2abc95b058a3c5d23aef3b`
and `cb671922fded769556f70e37fbd49d20ca129ec0d31f264d083a2a7ea1b7b7d5` also upgrade explicitly
to the early-input-release version. Isolated tests restore and upgrade each recognized predecessor.

The application additionally opts into `_manuslipEventSpans` through the frozen processor's
private settings. The general parser retains the original whole-event compiler and its
global list-preparation ordering. The private option selects a second compiler generated
from that exact pinned compiler's event/list loops; it shares one root, compiler data,
listener context and configuration across all spans and applies transforms once to the
complete root. The installed source contains the original compiler alongside the generated
variant, so ordinary callers do not acquire new extension assumptions.

All source block tokenization finishes before span resolution; document-wide definitions
are already known. A span ends only at balanced top-level token depth with no forward-linked
token outstanding. Flow chains can cross an outer container boundary, so depth alone is not
a valid cut. Each span is postprocessed completely and its lists are prepared. The prepared
array then owns every event, so the redundant resolved input array is cleared before handlers
construct nodes. The prepared array is released after compilation. This shortens live input
storage for large single spans without changing event order, token identity, listener context
copies or the general compiler. It does not reduce the preceding postprocessing peak.
Consumed slots in the private
block-event array are cleared. Root endpoints follow the complete flattened event stream,
including empty input and trailing separators. The generator clears its arrays and link set
on completion or abrupt closure. Public micromark event arrays and contexts are untouched.
This is synchronous compilation of events from one complete parse, not independent source
fragment parsing, incremental edit parsing or cooperative scheduling.

The private path is reviewed for the application's fixed CommonMark/GFM/frontmatter/math
extensions. Adding extensions requires revisiting span boundaries and preparation/listener
dependencies. An extension that observes preparation of future lists, or adds other
cross-span token dependencies, must use the general path until equivalence is proved.
No hard span size or physical peak bound follows from batching: one container or linked
flow chain can still span the whole source. Source, message, node, block and cache limits
stay unchanged. The independent original-source comparison exercises both application
grammars and both exports with all complete roots and renders; additional regressions cover
cross-container chains, references/footnotes, list spread, tables, Unicode/CRLF and listener
order/shared data/whole-root transforms. Whole-graph lifetime/phase diagnostics explicitly
remove the span option through a hash-checked source reconstruction, preserving their
original measurement scope.

`node test/benchmark/profiles/profile-parser-spans.mjs` compares complete approximately 1 MiB repeated-nested,
single-quote, single-list and single-paragraph shapes against the preceding whole-event compiler
in fresh processes. It conserves raw events, counts resolved/list-prepared maxima and verifies
normal master-array release. Both raw-HTML policy renders and complete semantic document hashes
must match. `--development` selects the other pinned export; `--natural` omits phase GC.
The observer retains numeric samples only. These selected Node endpoints can miss synchronous
peaks and do not prove latency, physical admission or bounds on other shapes. The whole-event
observer deliberately keeps its input array through compilation; compilation samples therefore
include observer-imposed retention and are not a general-compiler production peak comparison.

## Hand off completed native blocks — 2026-10-28

The patch also provides an internal `_manuslipBlockStream` path, configured in
`packages/core/src/markdown-compile.ts` for the block-stream and synchronous
whole-root application consumers. It generates a third compiler from
the same pinned span compiler. The original whole-event compiler and the existing
whole-tree span compiler remain unchanged. The predecessors with hashes
`5182ee8cacb095764a7a06dc97afa3ff4a284eba66975754b79abe7f4227198d` and
`810824f90f1bb544beba5c46c7682c22a4b23167dbf9e9150d99371468182fe5` upgrade explicitly;
check-only builds reject them until installation completes. Source reconstruction
removes the new branches/compiler and must recover those exact predecessor hashes,
then the hash-verified published sources. Installation tests cover all predecessors.

The new path is lazy. Its first advance checks the explicit transform whitelist
before tokenization, then tokenizes the complete source so forward definitions are
known. Each balanced, resolved span uses the original handlers, list preparation,
shared compiler data and independent mutable points. After each event's handler and
listeners finish, a closed node/token stack permits handing off a completed top-level
block before later siblings are constructed. Only the audited GFM autolink transform
runs over those completed root children. Unknown transforms and replacement roots fail.
The consumer's whitelist comes from a separate GFM-only processor, rather than from
whatever transforms a future application plugin adds. Generic extension listeners
and whole-root transforms are not supported by this additional private path.

Before yielding children in source order, the compiler clears consumed private event
slots and detaches the completed child array from its working root. Each yielded slot
is cleared. Remaining prepared events stay available for later siblings; their array
is cleared at span completion. Abrupt closure releases the remaining completed children,
event generator, working root, compiler stacks and temporary compiler data. A resolved
span can still contain the entire source, and an individual block can contain a large
container. This does not bound native span or block size.

The span-accumulating block-stream predecessors
`ad095f74ffbb540fc0aea410d25e97eb16f8ba73ed95fa519d4dff45e84d7501` and
`0180d3fb9922c8b96d4d8a4e69064a78abd51eb339708bc9dc1751437f5feaf1` upgrade explicitly.
The independent fixture reconstructs their exact source; installation tests restore
and upgrade them alongside all earlier recognized predecessors. A construction regression
counts actual paragraph handler entries: the first yield constructs only its completed
block, and cancelling it prevents the 2,000 later paragraphs from entering construction.

`markdownBlockSteps` uses the same frozen conservative grammar selection as
`parseMarkdown`. It computes descriptors and outline before handing off each block,
counts nodes/blocks against the existing limits and segments the whole accumulated
prose exactly once. Its final summary contains complete root metadata and semantic
metadata; children have already been handed to the consumer. Consumers keep their
candidate output private until that final summary succeeds. The revocable `PackedWork`
handle now accepts a yield type, with its existing `void` default and runtime behavior
preserved. Closing a held handle drops its iterator, including before first advance.

Run `node test/benchmark/profiles/profile-markdown-block-stream.mjs` for complete semantic/render
comparison, or add `--lifetime` for a separate forced-GC observation. Both verify
default and development exports and bind the actual evaluated application sources.
The experimental packed producer now uses this API. The ordinary application path
continues to use its existing semantic worker. Whole-source tokenization, span preparation,
individual blocks, descriptors/prose and segmentation still
need construction admission and scheduling work; physical aggregate admission and
application performance gates remain open.

## Cooperative document tokenization — 2026-10-29

The experimental block API additionally selects `_manuslipBlockTokenSteps`. After validating
the existing transform whitelist, it preprocesses the original complete value once. Only the
private document tokenizer receives a stepping method generated from the pinned `write` and
`main` loops. Its original preprocessed chunks and all internal point indexes remain intact.
Each advance dispatches at most 4,096 input codes before yielding an undefined scheduling
checkpoint. Definitions, lexer state and source serialization survive suspension. Only after
EOF processing succeeds does the compiler resolve spans and construct native blocks. Closing
the stream clears its preprocessed chunks and accumulated document events. Ordinary tokenizer
contexts retain their existing keys and synchronous `write`/`main` methods.

An earlier prototype split literal chunks to bound writes. Complete nested-corpus validation
found empty reference identifiers, and development footnote assertions caught negative buffer
indexes at new chunk boundaries. That prototype is discarded. The private state-loop stepping
preserves the original lexer chunk invariant; minimal reference and footnote boundary
regressions preserve the failure evidence alongside the complete corpus checks.

`markdownBlockSteps` exposes these checkpoints as `markdownBlockPause`, the same trusted
progress symbol already supported by the streamed packed-array encoder. It contributes no
JSON child and propagates an outer scheduling/cancellation barrier. Consumers collecting
native blocks must skip it. Source/descriptor/node limits and all semantic fields are unchanged.
The ordinary parser and callers of the private block compiler without the additional option
retain synchronous whole-source tokenization.

The exact synchronous-tokenization predecessors
`39fc5d3b2a850b08b2550d1c6a36af4bfcfa4863b930d470b93e70dde2780e6f` and
`b094ce071e890d2b47565edd3ee6bb912e3a68e81146525cbaa4c0fb578296e1` upgrade explicitly;
installation fixtures reconstruct and upgrade them alongside all earlier recognized sources.
The regression uses real micromark effects: the former first advance consumes all 20,000
probe characters, while cooperative advances consume only prefixes and cancellation prevents
the rest. Cross-batch CRLF, astral/lone surrogates, tabs, NUL, definitions and footnotes compare
against complete parsing under both grammars. Preprocessing, EOF resolution, individual flow
constructs, span preparation, native blocks and prose segmentation can still perform atomic
work. Bounded input batches do not establish a time bound, native allocation admission or a
portable physical peak.

## Cooperative whole-value preprocessing — 2026-10-29

The experimental block consumer also selects `_manuslipBlockPreprocessSteps`. The private
compiler contains a whole-value generator derived from the MIT-licensed micromark 4.0.3
preprocessor (the unchanged package/license is shipped alongside it). It scans at most 4,096
UTF-16 source units between yields. It preserves every original chunk value and boundary,
including BOM removal, NUL replacement, tab expansion, CR/LF coalescing and EOF. Long literal
spans can suspend without being divided. Byte input keeps the original TextDecoder behavior.
The public preprocessor files remain unchanged and both exports are now explicitly pinned.

The owner wraps preprocessing and tokenization in the same try/finally region. It releases
unfinished chunk arrays and the captured source value on abrupt closure, before any later
input is processed. Preprocessing has its own progress phase; diagnostic tokenization probes
wait for actual tokenizer stepping rather than counting all parser pauses interchangeably.
Ordinary parser/preprocessor APIs and block streams without the new option keep synchronous
preprocessing. No syntax, output field, source limit, token checkpoint, cap or watchdog changes.

The recognized preceding compiler hashes are
`2caaaaa1679fbf33b78b40ae074f39eed5bd12993a86aa87093ee53732c4379d` and `8194000ec980fe15c46fe74347c993459f4edfa8832a664aa454c80d66d0c39a`.
`withSynchronousBlockPreprocessing` reconstructs those exact sources for installation
upgrade tests and independent published-source reconstruction. The current compilers are
`0edc03eb2f77a2623dd0487b8d45fc918b84d6ece43aacb1ffbe5cc16270e98e` and `ae5ad144493a8cd7fc7aa3bfe923de294a007b2bddf0599f6b392d3be508e15c`.
Unknown dependency versions or altered tokenizer/compiler/preprocessor sources are rejected
before any installation write. Both original public preprocessing files are part of the
six-source fixture; the four existing patched files retain their explicit upgrade chain.

Unit checks compare the installed helper with both public preprocessors and observe actual
source reads across checkpoints, byte/Unicode/marker boundaries, interleaving and cancellation.
Complete producer and native Worker oracles conserve all fields, global references/footnotes
and lexer chunk indexes. Actual chunk arrays/tokenizer contexts collect after cancellation
while their outer handles stay held. This bounds scanner work units and improves cancellation;
it does not admit physical memory or bound decoding, slicing, array growth, flow/EOF resolution,
span preparation, native blocks/HAST or whole-prose segmentation. Those and ordinary nested
performance remain open in `docs/validation/implementation-history.md` and the packing ADR. Whole-source sizing,
hashing and conservative grammar selection also remain separate atomic work.


## Release completed private tokenizer state — 2026-10-29

The cooperative private block compiler sets `_manuslipReleaseCompleted` on its own
parser. At EOF, after `addResult` and all resolvers, each tokenizer retains only
`events`, `parser`, `sliceSerialize` and a detached `sliceStream`. The latter
closes over the existing source holder in a module-level factory, so later subtokenization
can slice source without keeping tokenization closures. Public tokenizers and active
streaming contexts keep their complete methods. The whole-tree/general compiler does
not opt into this private flag. The fixed CommonMark/GFM/math/frontmatter configuration
and its audited postprocessing still require review when extensions change.

| Installed file | Recognized predecessor normalized-LF SHA-256 | Current normalized-LF SHA-256 |
| --- | --- | --- |
| node_modules/micromark/lib/create-tokenizer.js | `a5706cb8169715d0bae53db9521b20a6d37de55a235a6b623a655c8640e25789` | `64b4cdb74ff85a72ada49a7ac1cd9b6ef75d75b182853305ee230c6e5fd4337b` |
| node_modules/micromark/dev/lib/create-tokenizer.js | `4748267dc2f1a8f245dc7d207738465c9af5cca56178b128ff8a2f011a05621d` | `256b775dc06a7d3920a851029f8f5b570efa59a18fc420b15a0d559a375ea2c5` |
| node_modules/mdast-util-from-markdown/lib/index.js | `0edc03eb2f77a2623dd0487b8d45fc918b84d6ece43aacb1ffbe5cc16270e98e` | `02064da77b598aa50b9721f4c75d47f8a28149eae2f5feca3d2e0069f7565e35` |
| node_modules/mdast-util-from-markdown/dev/lib/index.js | `ae5ad144493a8cd7fc7aa3bfe923de294a007b2bddf0599f6b392d3be508e15c` | `459718abfd6569549a7bab050f12c026de55b0432c53f36ea56b1793e9b26b47` |

Original and recognized older/partial installations all reconstruct the same current
bytes. Unknown contents/versions fail closed, and check-only mode does not repair files.
`withRetainedCompletedTokenizer` independently reverses only this stage before the
existing original-source reconstruction verifies published hashes. Unit regressions
check active/public EOF methods, private completed keys, nested parser sharing, positions,
stream slicing, tabs/CRLF and both serialization modes. Before/after forced-GC witnesses
hold actual contexts while constant column tables and resolver arrays collect after
private completion under both exports. The replaceable token stack is excluded.

Full semantic, lifetime, package, installer and performance evidence is bound in
`test/artifacts/logs/native-ownership-validation.json`. The selected explicit-GC live heap reduction
(40.9 → 35.2 MiB at block tokenization) is an
isolate boundary observation, not native physical admission or a portable peak bound.

## Cooperative resolved-event compilation — 2026-10-29

The explicit private option _manuslipBlockCompileSteps adds cooperative compilation to
the existing complete block producer. Public/general and private non-opted-in compilation
keep their prior behavior. Global definitions, linked flow spans, one compiler data/listener
context, complete list preparation and audited block-local transforms remain authoritative.
Span collection, serializer-context replacement and list-preparation loops pause within
256 cursor advances. Nested list walks and backwards insertion merging share a preparation
counter. Dispatch pauses within 16 events, including before a large block has closed.
Backwards in-place merging preserves insertion order and removes the former whole-list
splice copy. Closing an active span releases its input/events and clears compiler stacks/data.

| File | Recognized preceding SHA-256 | Current SHA-256 |
| --- | --- | --- |
| node_modules/mdast-util-from-markdown/lib/index.js | 02064da77b598aa50b9721f4c75d47f8a28149eae2f5feca3d2e0069f7565e35 | 9aa3209790118d6692f6529f78c534be000384fec5f9c6c69b38b1c9f586f37f |
| node_modules/mdast-util-from-markdown/dev/lib/index.js | 459718abfd6569549a7bab050f12c026de55b0432c53f36ea56b1793e9b26b47 | 85b2ca628df57243e2dccf2e8392fc5e7b3c2c43a6a3eaebcf198d6f555a6430 |

The four tokenizer/preprocessor hashes stay fixed. scripts/parser-compile-steps.mjs owns
this transformation and exact predecessor restoration. Installation fixtures copy that
module into their isolated test directories. Original-source reconstruction must still
match the independently recorded published hash; shared spelling edits are not an oracle.
The patch recognizes previous/original installs, checks every file before writes and rejects
unknown versions or altered sources. Seven new cases plus all existing grammar/install
tests pass. Actual injected production/development compilers preserve the complete 700-item
tree, observe maxima of 16 dispatches/256 preparation advances, and release 88 graph witnesses
in 32 cancellation cases with handles held. Full source-bound producer, Worker and rebuilt
package evidence is in docs/validation/implementation-history.md and test/artifacts/logs/compile-events-validation.json.

EOF/postprocess resolution, each individual handler/listener/transform, strings, array
growth and native segmentation can still run atomically. Their physical admission and
aggregate ownership are not established. Production observations include some processing
overhead; bounded compiler cancellation is the intended benefit. The ordinary endpoint,
all numeric caps and full M1–M4 acceptance gates remain unchanged/open as documented.

## Cooperative native subtokenization and cancellation — 2026-10-29

The private block compiler accepts _manuslipBlockPostprocessSteps. The application passes
the audited core callback; absent that private option, native postprocessing is unchanged.
The callback adapts micromark-util-subtokenize 2.1.0's native algorithm, retaining its MIT
notice in packages/core/src/markdown-postprocess-steps.ts. The exact upstream production/dev
index and gap-buffer inputs are bound alongside the six lifetime pins. They are unmodified.
The native-equivalent event buffer and postprocessor share a 256-advance quota. Child
tokenizers request private input stepping only during construction, immediately restore the
parser flag, forward 4,096-dispatch pauses and yield between writes. Complete event ordering,
GFM list hooks, linked chunks, container positions and global context remain exact.

Private native writes now carry input through a clearable owner. Return/throw also closes
an unstarted writer; active cancellation drops captured chunks, serialization input, parser,
points, stacks, resolver/column owners and context methods. A completed nonfinal write leaves
its context usable for its next linked chunk. The document wrapper guards cleanup after
context revocation. Public/non-opted-in tokenizer behavior is retained. A negative actual
held-generator probe and heap retaining path drove this change; context deletion alone did
not suffice. The final probe collects all 288 witnesses across 68 cancellations with raw
generator/context and outer handles held, under both exports.

| File | Recognized preceding SHA-256 | Current SHA-256 |
| --- | --- | --- |
| node_modules/micromark/lib/create-tokenizer.js | 64b4cdb74ff85a72ada49a7ac1cd9b6ef75d75b182853305ee230c6e5fd4337b | f2b7bfc834e2619690a4f6b037e3bfac3e245f017b7a762b8113e75bebe89871 |
| node_modules/micromark/dev/lib/create-tokenizer.js | 256b775dc06a7d3920a851029f8f5b570efa59a18fc420b15a0d559a375ea2c5 | ec9b0386789ce85cc7fdb0f24053f84f15394e30bcbcfac72bb0d8ec16d09d89 |
| node_modules/mdast-util-from-markdown/lib/index.js | 9aa3209790118d6692f6529f78c534be000384fec5f9c6c69b38b1c9f586f37f | d207acb6c3afdbfeda4ebe2289906a7b0801fd5843317f41b955cd29d8c2abc0 |
| node_modules/mdast-util-from-markdown/dev/lib/index.js | 85b2ca628df57243e2dccf2e8392fc5e7b3c2c43a6a3eaebcf198d6f555a6430 | c579b2a91162f0c9ca6a69693e1ee214cf3b9a688669f59c5e4f6ed9fba0ae20 |

scripts/parser-compile-steps.mjs owns the exact transforms and inverses. Previous/original
installs are recognized; all sources are validated before writes; unknown changes fail.
Upgrade fixtures cover the preceding compilation and tokenizer states, while original-source
reconstruction must match independent published hashes. Native replay/subtokenizer sources
and the two preprocessor hashes remain fixed. Full fidelity, package and cost evidence is in
docs/validation/implementation-history.md and test/artifacts/logs/subtoken-events-validation.json. Native atomic-call/physical
admission limits and all full application acceptance gates remain open.

## Cooperative native text resolution — 2026-10-29

The private block producer passes _manuslipBlockTextResolveSteps. The compiler propagates it
to the private parser; the tokenizer's opted-in EOF generator preserves resolver order and
deduplicates function identities. Pinned createResolver functions carry a private boolean
identity flag specifying line-suffix policy. Only those identities select the application
callback. Other native resolvers run atomically between checkpoints; public parsing and
private callers without the option retain native behavior. Nested native attention resolution
is still opaque. No general extension support is claimed beyond the existing audited grammar.

packages/core/src/markdown-text-resolve-steps.ts adapts micromark 4.0.3's data merging and
line-suffix algorithm with its MIT notice. One 256-advance quota spans scans, copies and gap
edits. Original point/tab/hard-break/trailing policy and linked writes remain exact. Suffix
insertions retain original indexes and apply in reverse order. The revocable work owner
releases input/context on return/throw, including before first advance. Actual native parent
cancellation closes it and revokes the owned tokenizer context. Forty-four cases collect
172 graph witnesses with 124 handles held under production and development exports.

| File | Recognized preceding SHA-256 | Current SHA-256 |
| --- | --- | --- |
| node_modules/micromark/lib/create-tokenizer.js | f2b7bfc834e2619690a4f6b037e3bfac3e245f017b7a762b8113e75bebe89871 | f9e2b07a25a72dc0a9e54e42385706d71170ac89950d6e7aa874fd0e5895e4c1 |
| node_modules/micromark/dev/lib/create-tokenizer.js | ec9b0386789ce85cc7fdb0f24053f84f15394e30bcbcfac72bb0d8ec16d09d89 | c8f379b6ddaacde4080ca46ea892493810b450506122ca9b6623319b7137c47f |
| node_modules/mdast-util-from-markdown/lib/index.js | d207acb6c3afdbfeda4ebe2289906a7b0801fd5843317f41b955cd29d8c2abc0 | 5ebb94bb7e65fb123b31c44c191df8638e805c9a66f56afde1420d03ed9d1c2f |
| node_modules/mdast-util-from-markdown/dev/lib/index.js | c579b2a91162f0c9ca6a69693e1ee214cf3b9a688669f59c5e4f6ed9fba0ae20 | d906fc3062c2fcbdc89e58e3e11f5050bb2112f588104bffc94fc8d66413a96c |
| node_modules/micromark/lib/initialize/text.js | 1c5682291dbb6cea7f95edeb6d50421238b91752c9e0fb9485bdde44628ce090 | aedd0c6982951a1813bac9aaeaa31e4db041b01697b7e4128880dfa12e9493eb |
| node_modules/micromark/dev/lib/initialize/text.js | 42f71a37602a65811779e2ae2977bd968504e2b54b575c1458ebb7dd0ca4ff66 | d0fe317d4892db1e33e9e11955447756c971d1fd050efbd5be6650ea02f03e16 |

scripts/parser-text-resolve-steps.mjs owns the forward/inverse edits. All eight lifetime
sources are validated before writes; original, previous and known partial installs upgrade
to the exact pins, while unknown sources/versions fail. Independent published-source checks
bind the six micromark originals to the lockfile-integrity-verified 4.0.3 archive. Replay and
preprocessor pins remain fixed. Full fidelity, package checks, measured processing cost and
the explicitly unavailable preceding ASAR/installer identities are in docs/validation/implementation-history.md.
Current artifacts are independently verified and copied; no performance, physical admission
or full-application completion gate is declared satisfied by this private change.

## Cooperative private inline resolution — 2026-10-29

The application EOF callback now exposes a private resolveAll capability. Only opted-in private
writers dispatch through it; older callbacks, private callers without it and public parsing
keep their existing paths. The application identifies built-in attention from the actual
pinned parser and GFM strikethrough from the actual extension instance passed into that parse.
Unknown inside-span resolvers retain complete native execution, including global context
observations. Nested audited resolvers use explicit frames and share the 256-advance text/
event quota. New input, pending-result and frame owners revoke payloads on return/throw.

packages/core/src/markdown-inline-resolve-steps.ts adapts native CommonMark attention 2.0.4 and
GFM strikethrough 2.1.0 with both MIT copyright notices. Their native files remain unchanged.
The first marker unit is serialized without copying the whole normal delimiter run; empty or
invalid slices created by arbitrary raw-chunk splits retain native serialization behavior.
Native point/token mutations and complete events remain exact. Resolvers called within other
atomic constructs, including link labels, are outside this callback's cooperative scope.

| File | Recognized preceding SHA-256 | Current SHA-256 |
| --- | --- | --- |
| micromark/lib/create-tokenizer.js | f9e2b07a25a72dc0a9e54e42385706d71170ac89950d6e7aa874fd0e5895e4c1 | f1ca50b01e4f60381b06f7198e476ffe0aad703973018512a82f1c31a8333672 |
| micromark/dev/lib/create-tokenizer.js | c8f379b6ddaacde4080ca46ea892493810b450506122ca9b6623319b7137c47f | f50a5ff72ef4354d5571436eb6804e68cdd6a83506f9a8d06b11fd9c5fea1a8d |

Four unchanged inline sources are now check-only pins: CommonMark lib/dev attention SHA-256
cd9329ed32379acf1e80e427124f25648fba7722886ecc0de3c5dc8551268ee4 /
a80deb1561614d952f3b283999cc3f949f23525de164b390e8e78b151049cfea, and GFM lib/dev syntax
293e9b13a554fe569efd096cd7f1c3f4d6da861f30bba701e8b923f621181250 /
913b1c9346b06ab0e5825f9b2d2f85a3d0505bf9a557f488cdf07020d494d791.
Official registry archives match the lockfile SHA-512 integrity and all four installed files;
licenses and archive hashes are bound in test/artifacts/logs/inline-resolver-upstream-proof.json.

scripts/parser-inline-resolve-steps.mjs owns the exact forward/inverse tokenizer dispatch edit.
The text-resolution inverse removes this newest edit first, preserving all preceding fixture
and original-source reconstruction callers. Twelve lifetime-source images across four packages
are validated before any write; together with the fixed replay/subtokenizer files, 16 source
bindings are recorded. Original/recognized prior/partial installs reproduce the exact pins;
unknown versions or sources fail closed. Actual held native parents, callback work and frame
handles pass 84 closures with 292 collected graph witnesses. Full differential, processing
cost, package checks and unchanged open gates are recorded in docs/validation/implementation-history.md.

## Cooperative private link-label resolution — 2026-10-29

Successful private link/image constructs now park at the native success continuation before
the next input dispatch. The actual native resolveTo function identity selects the audited
label callback; ordinary writes, older callbacks and unknown resolveTo functions retain
their synchronous path. Private input resumes only after the resolved event array is committed.
The pending callback closes on return/throw, including the pause before its first advance.

packages/core/src/markdown-label-resolve-steps.ts adapts the unchanged CommonMark 2.0.4
label-end resolver with its MIT notice. Its backwards opener/inactive-link scan, local copies,
nested attention/strikethrough/text resolution and final replacement share the existing
256-advance quota. EOF unmatched-label cleanup uses the same quota. Native opener-at-zero
truthiness, event array identity, point/token mutations and complete global context remain
intact. Unknown inside-span extensions keep the complete native call, preserving their global
event observations. Label tokenization, identifier normalization/lookup and other individual
construct calls remain atomic; this change does not establish elapsed-time or physical admission.

| File | Recognized preceding SHA-256 | Current SHA-256 |
| --- | --- | --- |
| micromark/lib/create-tokenizer.js | f1ca50b01e4f60381b06f7198e476ffe0aad703973018512a82f1c31a8333672 | d6ea9e698cabf43322108871b9cedc8ddd793cae5fdfad9ef63785ff0d090949 |
| micromark/dev/lib/create-tokenizer.js | f50a5ff72ef4354d5571436eb6804e68cdd6a83506f9a8d06b11fd9c5fea1a8d | b161c49bbf3144bb748631ad00065ab5e2a2f085b5d312e6c9ea042236d40640 |

Two additional check-only pins bind unchanged label-end.js: production SHA-256
055ac0d7f62144011730fbd5bf81ee6f4cb40bdd8428b44d2f0febd3f1ea4364 and development
a98205fee00589963f9fc4426871a9eaef43621216d5966df7de3525f7a1cee6. Fresh official registry
archives match lockfile SHA-512 integrity, both label files, both attention files and both
strikethrough files. The licenses, archive identities and all 18 dependency bindings are in
test/artifacts/logs/label-resolver-upstream-proof.json and test/artifacts/logs/label-resolver-parser-sources.json.

scripts/parser-label-resolve-steps.mjs owns the exact forward/inverse bridge edits. Earlier
reconstruction helpers remove this newest edit first. All 14 lifetime-source images are
validated before writes; known original/prior/partial installs reproduce the pins and unknown
sources/versions fail closed. Sixteen independently named historical upgrade fixtures retain
their normal per-case deadlines and three CLI invocations per image. The new pending-state
and nested-frame closures pass 108 return/throw cases across both exports: 372 witnesses
collect with 3,720 handles, tokenizer contexts and cleared frames held. Counter/reachability
evidence is in test/artifacts/logs/label-resolver-final-probe/report.json; full application gates remain open.

## Synchronous whole-root compiler — 2026-10-30

The application now drains the shared private compiler from markdown-compile.ts for
ordinary whole-root parsing as well as experimental block consumption. Complete source
tokenization still resolves global references before compilation. The synchronous API
retains every child and publishes only the completed MDAST; descriptors, counts, outline,
all six coordinates, extension behavior and existing limits are unchanged. Audited
gap-buffer inline resolvers avoid repeated shifts of the remaining event array.

The independent parseMarkdownNative entry uses the preceding processor.parse backend;
it is internal and is not re-exported by the core public index. Differential tests and
full producer comparisons use that backend as their oracle. Historical whole-event,
span, lifetime and construct profiling tools also select it explicitly and align SSR
resolution with the Node export condition, preserving their original measurement scope.
The public dependency APIs and all 18 dependency pins remain unchanged.

This synchronous API still executes atomically and retains a complete native AST. It
does not establish host cooperation, physical peak admission or application latency
acceptance. Ordinary JSON Worker transport remains selected; packed transport remains
experimental. Receipt/storage/final assembly, native construct/HAST/handler boundaries,
the complete performance/memory gates, remaining features and platform acceptance stay open.

## Consume listless event spans without copying — 2026-10-30

The cooperative serializer already visits every event and now also records whether
the span contains an ordered or unordered list token. Without either token, native
compilation consumes that same private array, clearing each event after dispatch and
the array on completion, return or throw. This removes the separate preparation walk
and second event-reference array. Spans containing lists keep the original list-item
synthesis, spread inference and event order. Noncooperative private callers retain
their preceding preparation path. Public compiler and streaming APIs are unchanged.

`scripts/parser-list-preparation.mjs` owns the guarded forward/inverse edits. The
installer accepts the exact preceding compiler images below; every historical
reconstruction first removes this newest edit. Both exports install together, and
check-only builds reject missing patches. Serialization and list preparation retain
their 256-advance limits, and native dispatch still yields after at most 16 events.
Listener context copies, serializer functions, global definitions, all native fields
and all six source coordinates remain intact.

| Compiler file | Recognized preceding SHA-256 | Current SHA-256 |
| --- | --- | --- |
| mdast-util-from-markdown/lib/index.js | 5ebb94bb7e65fb123b31c44c191df8638e805c9a66f56afde1420d03ed9d1c2f | a476f2e7cc4ee0bb6f896072d5c42573a261f24f521840cabaf4d37b050e90f0 |
| mdast-util-from-markdown/dev/lib/index.js | d906fc3062c2fcbdc89e58e3e11f5050bb2112f588104bffc94fc8d66413a96c | 7db264970c4e8edeeed801ac3563cf7814c0a7891bf3f68fad09016703260978 |

Complete corpus counter runs retain native whole-document equality under both
grammars and both exports. The unchanged nested body dispatches 705,406 events;
its additional 705,406 preparation copies become zero. These are operation counts,
not latency or physical memory acceptance. The full producer separately passes
6,756 complete packet/root comparisons with fixed clocks and another 6,756 with
active clocks. Forced-GC cancellation/completion observations retain the original
158 observations, 730 held handles and 596 journal witnesses with no closed-state
survivors. Focused tests cover exact native listener traces, the 16-event dispatch
bound, cancellation cleanup for listless and nested-list spans, and actual CLI
upgrades from the preceding image. The complete application objective and original
ADR002 gates remain open.

## Final carriage-return preprocessing

The cooperative whole-value preprocessor now flushes a pending lone CR before its final
literal chunk, matching micromark's EOF order. Previously `one\r\rtwo` could move the final
CR after `two`, merging the last two paragraphs and shifting their source positions. LF,
CRLF and trailing-CR inputs retain their native meaning. Scanning quotas and original
source bytes remain unchanged. Parser identity is bumped to invalidate derived caches.

| Compiler | Recognized predecessor SHA-256 | Current SHA-256 |
| --- | --- | --- |
| lib/index.js | a476f2e7cc4ee0bb6f896072d5c42573a261f24f521840cabaf4d37b050e90f0 | f398a7b4c45dd304c2b09b2f7c7ac8c8d87186b55c11b98acfb1b490e4204ae1 |
| dev/lib/index.js | 7db264970c4e8edeeed801ac3563cf7814c0a7891bf3f68fad09016703260978 | d7c200c319d9d71356330a6c1927779e9df9ffff064f8901575fc55494f53933 |

The installer upgrades both pinned exports and every recognized historical image.
Independent upstream-source reconstruction still verifies the original hashes. Regression
coverage compares exact preprocessing chunks across scan boundaries and full parser trees,
source ranges and shared render output for LF, CRLF and lone-CR documents.
