# ADR 012: Synchronize saved files explicitly with durable recovery

Status: Accepted.

## Context

A saved document may need a folder or WebDAV counterpart while offline editing, external
changes and interrupted transfers remain possible. A remote response must not overwrite
newer editor input or erase the version needed to recover.

## Decision

Pair one named document with one selected folder child or exact WebDAV file URL. Keep
paths, credentials and raw bytes in main. Opening the application or dialog causes no
transfer; every send, receive and retry follows explicit version review.

Bind review to local fingerprint, remote bytes/version, connection and owner. Revalidate
before publication. Existing WebDAV files require a strong ETag with conditional PUT;
creation uses `If-None-Match: *`. A failed condition requires fresh review. Do not add
implicit deletion, redirects, remote browsing or background merging.

Before replacing bytes, preserve durable recovery, persist transfer intent, publish
conditionally, verify and advance the baseline. Retry checks actual versions because
cancellation cannot retract a server commit. Route incoming files through ordinary
external-change handling so dirty/composing editor drafts retain conflict controls.

Bound connections, operations and recovery storage without silently evicting recovery.
Damaged/interrupted artifacts remain visible and block unsafe replacement. Disconnect
removes connection metadata and credentials while retaining both files and recovery copies.

## Alternatives and consequences

Automatic bidirectional merging adds conflict semantics beyond a one-file connection.
Blind last-writer-wins replacement risks data loss. Explicit direction and durable recovery
require more user interaction and storage but keep version choices recoverable. Servers
without strong ETags can supply content but cannot have existing content replaced safely
through this adapter.

See [sync controls](../guides/sync.md),
[sync contracts](../../apps/desktop/src/shared/sync-contracts.ts) and
[security policy](../../SECURITY.md) for authentication, limits and ownership.
