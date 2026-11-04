# ADR 008: Scope document appearance and restrict local CSS

Status: Accepted.

## Context

Writers need per-document typography and reusable styles without allowing document CSS
to hide application controls, fetch resources or change Markdown and translation identity.

## Decision

Provide bounded offline typography controls and explicit import of a local UTF-8 stylesheet.
Main parses a restricted CSS language, validates tags/declarations and adds a document scope
to every selector. Reject active/resource-loading constructs, arbitrary selectors and
unsupported declarations. Source, Reset and application controls remain outside that scope.

Apply typography to editing, reading and export; apply imported CSS to rendered surfaces.
Synchronize input, preserve selections/history and keep the editor mounted. Appearance
does not request translation or alter translation cache keys.

Untitled appearance belongs to its session; named files persist by canonical path identity.
Save As inherits appearance for the new path. Bound registry capacity, serialize atomic
writes, retain recovery data and keep future schemas read-only. Capture appearance once
for each export so later changes cannot alter a running job.

## Alternatives and consequences

Unrestricted CSS or global injection would let content affect application UI and resource
loading. Restricting imports sacrifices general web-theme compatibility but leaves Reset
and Source available even when an accepted style makes document prose unreadable.

See [supported appearance controls and CSS](../guides/desktop.md#tables-and-appearance),
[style contracts](../../apps/desktop/src/shared/style-contracts.ts) and
[security boundaries](../../SECURITY.md).
