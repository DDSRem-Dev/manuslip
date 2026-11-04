# ADR 002: Source-owned documents and bounded services

Status: Accepted. Supersedes [ADR 001](001-initial-implementation-plan.md).

## Context

Editing, asynchronous previews, translation, native file operations and export must share
one document without losing writing or applying stale work. Global references and footnotes
make Markdown semantics depend on more than an independently parsed source block.

## Decision

- CodeMirror owns editable Markdown, selections and undo. Source and Live Preview share
  that state; reading and export consume immutable captured revisions.
- Track content revision and session generation separately. Dirty state compares content
  and save-relevant metadata with the saved baseline; undo can restore saved content at
  a newer revision. Occurrence IDs distinguish identical blocks from shared content keys.
- Keep translation settings identity and cache generation separate from document revision.
  Reuse canonical prose results while preserving each occurrence's protected bindings.
- Parse the complete document in a worker. The window service admits one running request
  and one latest pending request, rejects stale results and bounds recovery. Lezer supplies
  incremental editor syntax. Resource failure retains Source editing and explicit Retry.
- Keep shared libraries browser-compatible and independent of the desktop app. Main owns
  native paths, credentials, network permissions, file sessions and atomic publication.
  Sandboxed renderers receive narrowly validated capabilities through preload.
- Synchronize pending input before consequential captures. Recheck owner, generation,
  revision and permissions after asynchronous work and before publication. Dispose every
  owned worker, listener, timer, reader and reservation on all exit paths.
- Preserve source fidelity, recovery, security and enforced resource caps. Deliver useful
  features without presenting historical performance targets as achieved guarantees.

## Alternatives

Independent block parsing needs proof that references, containers and extension dependencies
remain valid; it is deferred behind the complete-parse oracle. Separate editable text per
view would require competing histories. One global revision for every subsystem would
discard reusable translations while still failing to express session or permission revocation.

## Consequences

The application needs explicit identities, bounded queues and lifecycle cleanup. Whole-root
parsing and transport can remain expensive; optimizations must preserve complete semantics
and fallback. Atomic replacement and fingerprint checks reduce save races but do not lock
other applications or guarantee power-loss durability.

The [architecture guide](../architecture/desktop.md) describes current components and
links authoritative limits. See [translation](../architecture/translation.md),
[security](../../SECURITY.md) and [testing](../testing/testing.md) for detailed contracts.
