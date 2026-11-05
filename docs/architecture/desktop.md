# Desktop architecture

Manuslip is an npm workspaces application. Exact dependency versions live in the
workspace manifests and `package-lock.json`. The [ADR index](../adr/index.md) preserves
the rationale, alternatives and status of architectural choices. [Workspace guidance](../guides/workspace.md)
and [visual foundations](../guides/foundations.md) guide interface work within those decisions.

| Workspace | Responsibility |
| --- | --- |
| `apps/desktop` | Electron main process, preload, React interface, native services and packaging |
| `packages/core` | Whole-document Markdown parsing, semantic metadata and packed data structures |
| `packages/editor` | CodeMirror state, source editing and Live Preview decorations |
| `packages/renderer` | Shared HTML, math, diagrams, reading layouts and export projections |
| `packages/translate` | Pure extraction, canonical provider payloads and validated reconstruction |

## Document and process ownership

CodeMirror owns editable text, selections and undo history. Views derive from the same
source revision; changing a mode or appearance must not rewrite text or recreate history.
Synchronize pending input and composition before saving, switching documents, capturing
exports or applying asynchronous edits. Reject results whose document, revision, operation
generation or configuration no longer matches.
These identity and ownership choices are maintained in [ADR 002](../adr/002-implementation-plan.md).

The sandboxed renderer has no Node or filesystem authority. Typed preload methods validate
requests and responses; main validates the exact sender frame, document ownership and
payload before granting access. Keep preload contracts independent of Markdown parser and
renderer runtime imports. Main owns native dialogs, file sessions, credentials, network
permissions and atomic writes. See the [security policy](../../SECURITY.md) for each boundary.
The preload dependency boundary is maintained in [ADR 004](../adr/004-preload-contract-dependencies.md).

Atomic writes reserve a UUID-named temporary sibling without copying the destination
basename, so long filenames do not inflate temporary paths beyond filesystem/native-tool
limits. Replacement still preserves metadata, rechecks the destination fingerprint and
removes temporary files on failure.

Parsing, translation preparation, replacement matching and export preparation use disposable
workers. Mermaid and printing use separate sandboxed Electron processes and sessions.
Every owner must release workers, listeners, readers, timers and reservations on completion,
cancellation, failure and disposal. Cleanup attempts all releases even if one throws, while
preserving the original operation error.

## Semantic pipeline

Lezer handles incremental editor syntax. The semantic worker parses the complete Markdown
document so references, footnotes and containers retain global context. The application
compiler consumes spans from that one parse; it does not independently parse source blocks.
Rendering shares the captured grammar and complete document context. All DOM admission
sanitizes HTML/SVG, including provider results, local documents and cached output.

The window semantic service permits one running request and one latest pending request.
It debounces edits, rejects stale results and recovers failed workers within a bounded
restart budget. Valid parse/limit responses follow the normal result path. Exhausted
recovery leaves Source editing and manual Retry available.

The production browser adapter uses native whole-root JSON transport. Eligible received
snapshots with exact layout metadata can use cooperative local packed preview preparation;
unsupported or failed candidates use native preparation. MSP2 worker transport and incremental
parsing remain experimental and disabled. [ADR 003](../adr/003-semantic-snapshot-packing.md)
defines that activation boundary. Packed captures have explicit ownership: borrowed readers
cannot outlive their scope, publication requires validated identity and complete output,
and cancellation must revoke suspended work. Keep equivalence and cleanup tests when changing
these paths. Packed ownership counters do not establish physical memory bounds or performance
acceptance.

Resource constants are authoritative in source:

| Limit family | Source |
| --- | --- |
| Preview, worker messages, caches, debounce and restart policy | [core contracts](../../packages/core/src/contracts.ts) |
| Editable source size | [editor limits](../../packages/editor/src/limits.ts) |
| Diagrams and SVG | [diagram contracts](../../packages/renderer/src/diagram.ts) |
| Export jobs and assets | [export contracts](../../apps/desktop/src/shared/export-contracts.ts) |
| Raster geometry | [raster limits](../../packages/renderer/src/raster.ts) |
| Translation payloads and output | [translation contracts](../../packages/translate/src/contracts.ts) |

For worker troubleshooting, inspect
`performance.getEntriesByName('manuslip:semantic-failure')` in the current window's DevTools.
The bounded in-memory records contain a fixed failure reason and request age, without source,
paths or exception messages. Timing API failures must never interrupt writing or recovery.

See [structural translation](translation.md), [dependency patches](../development/dependency-patches.md)
and [testing](../testing/testing.md) for the remaining contracts and verification commands.
