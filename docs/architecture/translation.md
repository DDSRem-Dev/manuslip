# Structural translation core

`packages/translate` implements structural prose extraction and reconstruction. It is
browser-compatible, imports no Electron or Node runtime APIs, and performs no network or
filesystem operations. Run `npm test -- --project translate` for its contract/fixture suite.
The desktop application integrates this package with translated preview and provider calls.
The source, occurrence and cache identity decisions are maintained in
[ADR 002](../adr/002-implementation-plan.md).

`extractTranslation(root, source, occurrence?)` consumes a captured semantic root from
`@manuslip/core`. It emits paragraph, heading and table-cell units, including prose inside
lists, block quotes and footnote definitions. Units keep UTF-16 source ranges, AST paths,
opaque occurrence IDs and local reconstruction bindings. A caller integrating editor edits
must supply IDs reconciled from mapped ranges; the default creates fresh IDs for a capture.
Do not reconcile duplicate units by content hash or ordinal alone.

Formatting uses paired canonical tokens (`⟪M0⟫`, etc.) with parent/pair metadata. Protected
inline code, math, images, raw HTML bodies, hard breaks, footnote references, automatic links,
URI-looking prose and literal token delimiters use atomic tokens. Whole code, display math,
diagram, frontmatter, HTML and definition blocks stay outside translation. Human-readable
Markdown link/reference labels translate; destinations, titles and reference identifiers stay
local. Image alt text and raw HTML bodies currently remain unchanged.

`prepareTranslation(plan, settings, capabilities)` computes canonical MurmurHash3 x86 128-bit unit keys and
deduplicates equivalent work. Each job contains only a key and `TranslationPayload`. **Never
send a plan, unit, root or binding to a provider.** Protected values stay in each occurrence's
binding map, so `Use alpha()` and `Use beta()` can share work when the calls are inline code,
without reconstructing the wrong call. Provider/cache payload parsing rejects unknown fields.

Translation hashes index derived data; they do not authenticate it. Main recomputes unit keys,
and cache hits require exact canonical settings and payload equality plus output validation.
Job admission also compares those complete values, and preparation rejects different payloads
that collide within a plan. Credential bindings continue to use SHA-256 independently.

The translated view retains up to 16 MiB of output within a 64 MiB shared snapshot budget;
its reading worker also has a 64 MiB ownership budget. Requests use bounded 8 MiB batches;
complete responses have a separate 64 MiB wire ceiling and a 32 MiB retained projection ceiling.
Large bilingual projections use indexed rows. Retained output/projection strings count UTF-16
bytes, while wire/HTML sizes count UTF-8. Reading export accepts the same 16 MiB output budget,
with 64 MiB request/HTML ceilings and 24 MiB UTF-8 reconstruction for CJK text.

The dedicated SQLite cache worker uses schema 2, with a 256 MiB logical-data budget,
320 MiB database ceiling and 50,000 entries. Entries expire 30 days after a successful write;
reads coalesce LRU updates into bounded batches without extending expiration. Metadata flushes
run on a one-second idle timer, before eviction and on close; payload writes remain fully synced.
Expired rows are removed on lookup and
in indexed batches during cache activity. The legacy SHA-256 cache is rebuilt on upgrade
because stored hashes do not contain enough settings information to safely rekey entries.

SQLite uses WAL with `synchronous=FULL`, automatic checkpoints, reused prepared statements,
and atomic replacement/eviction transactions. WAL and shared-memory sidecars receive the same
file checks as the database. A 32 MiB WAL threshold triggers a truncating checkpoint; a pinned
reader that prevents it pauses writes while preserving reads and the WAL for recovery. Logical
and physical page pressure both evict old entries before insertion; full/busy writes roll back
without closing the healthy connection, allowing later requests and clearing to recover. The
database, sidecars and corruption quarantine share a 384 MiB footprint budget. Clearing the
cache checkpoints before deleting its files. Storage failures leave translation available
in memory and report the cache as unavailable.

`reconstructTranslation(plan, outputsByOccurrence)` validates complete outputs before admission.
Each token must occur exactly once, with its original parent and balanced formatting pair.
Siblings may reorder. New, duplicated, missing, moved-across-parent or unbalanced tokens fail
the unit. Empty prose and oversized output also fail. Reconstruction creates text nodes;
provider HTML/Markdown is literal text, not parsed markup. Source remains visible for missing,
invalid or limited units. Root and source are never rewritten by reconstruction.

`normalizeTranslationSettings` checks capabilities and separates non-secret provider metadata
from credentials owned by desktop main. Remote endpoints require HTTPS; HTTP is accepted only for explicitly
configured loopback endpoints. Normalization preserves path/trailing-slash/query order routing
semantics, rejects user information/fragments/common credential query/option names, and keeps
all prompt-affecting settings in identity. Concrete transport adapters must additionally admit
only their documented options, retrieve credentials in main, check redirects/DNS as appropriate,
bound bodies/deadlines, and redact logs. This package is not a transport security boundary.

Numeric caps live in [translation contracts](../../packages/translate/src/contracts.ts).
Per-unit oversize retains source with a limit
status; aggregate extraction overflow rejects the whole plan instead of silently truncating.
Reconstruction independently bounds per-unit/aggregate output. Planning and reconstruction
run off the typing path in the desktop reading worker.

`capabilitiesFor(adapter)` distinguishes chat prompt options from DeepL native options.
`parseDeepLLanguages`, `deepLLanguage` and `deepLMetadataEndpoint` validate bounded stable
metadata, canonical language/variant selection, XML support and same-origin discovery routes.
These helpers perform no I/O. Concrete option admission, the XML codec, credential lookup,
metadata lifetime and all native HTTP remain in desktop main, outside this package.

The deterministic provider in `packages/translate/test/fixtures/provider.ts` is a test utility, not a user-facing translation
engine. Tests inspect its payloads, exercise translated lists/tables/emphasis/references and
partial failures, and round-trip all 652 CommonMark 0.31.2 fixtures through the shared renderer.
Desktop main now integrates subscription generations, credential storage, SQLite persistence,
OpenAI-compatible/Ollama/DeepL transport, translated preview and bilingual layouts/export.
Tests use fake local providers; no paid account is required or contacted by the test suite.
