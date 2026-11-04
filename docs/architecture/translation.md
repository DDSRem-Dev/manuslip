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

`prepareTranslation(plan, settings, capabilities)` computes canonical SHA-256 unit keys and
deduplicates equivalent work. Each job contains only a key and `TranslationPayload`. **Never
send a plan, unit, root or binding to a provider.** Protected values stay in each occurrence's
binding map, so `Use alpha()` and `Use beta()` can share work when the calls are inline code,
without reconstructing the wrong call. Provider/cache payload parsing rejects unknown fields.

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
