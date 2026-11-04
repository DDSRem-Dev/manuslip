# ADR 006: Extend Markdown through positioned grammar and shared rendering

Status: Accepted.

## Context

Extended syntax must remain editable as its original Markdown and behave consistently
in Live Preview, translated reading and export. Compatibility must not add network
dependencies or grant document content execution privileges.

## Decision

Represent subscript, superscript, offline emoji, inline notes and definition lists as
positioned semantic nodes. Preserve source spellings, code, math and destinations.
Strict CommonMark remains a separate grammar; optional conventions select their own
syntax. Captured reading copies retain their grammar until explicitly refreshed.

Use the shared renderer and sanitizer for all projections. Translate eligible prose
with structural tokens while retaining protected values in local occurrence bindings.
Parser, renderer and extraction identities invalidate incompatible caches.

Convert the documented `sequence`/`seq` and `flowchart`/`flow` subset inside the existing
isolated Mermaid host using generated identifiers and encoded labels. Keep its resource
and configuration policy. Unsupported syntax retains complete editable source.

## Alternatives and consequences

Rendered-text replacement cannot reliably preserve ranges, syntax nesting or translation
bindings. Adding separate legacy JavaScript engines expands the execution surface.
Grammar extensions and bounded conversion require explicit compatibility tests but share
existing rendering, isolation and fallback behavior.

The [Markdown guide](../guides/commonmark.md) defines syntax, defaults and supported
legacy constructs. See [dependency patches](../development/dependency-patches.md) for
definition-list/table compatibility and pinned parser assumptions.
