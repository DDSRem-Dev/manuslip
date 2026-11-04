# ADR 003: Owned semantic snapshots and staged packed transport

Status: Experimental transport; bounded local preview preparation is integrated.

## Context

Whole-root snapshots can retain duplicate native trees, rendered output and transport
buffers. Reducing these costs requires lossless data representation and explicit ownership,
while preserving complete Markdown semantics and the Source fallback from
[ADR 002](002-implementation-plan.md).

## Decision

Keep production worker transport on the native whole-root JSON path. For eligible received
snapshots with exact layout metadata, the preview controller may repack locally and prepare
an owned preview cooperatively. Unsupported snapshots and failed candidates use native
preparation. This local integration does not enable MSP2 worker transport or incremental parsing.

Packed records preserve source text, UTF-16 ranges, node order, metadata, references,
projection output and parser/renderer identities. Hashes select candidates; exact values
must match before reuse. Validate complete documents and output before publication.

Use session-owned sources, revisions and arenas with explicit captures and independent
consumer leases. Borrowed readers remain within their scope. Suspended tasks are cancellable;
cancel, rejection and disposal revoke work and attempt every release, preserving the primary
error even if cleanup throws. A result received through the experimental protocol requires
correlation, complete validation and acknowledgement before publication state advances.

Preserve whole-document context for reusable fragments, definitions, footnotes, translation
and reading layouts. Reuse requires matching dependencies and identities. Admission and
work budgets remain explicit; internal ownership charges do not prove physical peak memory.

## Alternatives

Retaining unowned native copies simplifies access but leaves their lifetimes coupled to
consumers and queues. Enabling transport or fragment parsing alongside a representation
change would combine independent correctness and lifecycle changes. Keep those activation
decisions separate until their equivalence, cleanup and application behavior are established.

## Consequences

Packed data adds codec, validation and ownership complexity. Keep independent native
equivalence, cancellation and cleanup tests. Replacing the production adapter requires
an explicit follow-up decision and application verification, including fallback and resource
behavior; a diagnostic timing or ownership-counter improvement is insufficient.

Current integration points are the [browser adapter](../../apps/desktop/src/renderer/src/semantics/browser.ts),
[admission predicate](../../apps/desktop/src/renderer/src/semantics/packed-admission.ts),
[owned preparation](../../apps/desktop/src/renderer/src/preview/owned-preparation.ts) and
[preview controller](../../apps/desktop/src/renderer/src/preview/controller.ts).
