# ADR 001: Local-first editor foundation

Status: Superseded by [ADR 002](002-implementation-plan.md).

## Context

The initial repository needed an executable foundation for local Markdown editing,
reading and translation. Documents had to stay portable and usable offline.

## Decision

The original proposal chose Electron, React and TypeScript for the desktop shell,
CodeMirror for editable Markdown, and unified/remark for semantic projections.
CodeMirror would own text and undo; a narrow preload bridge would mediate native access.
Remote translation would require an explicit action. Delivery would proceed through
runnable editing, workspace, translation and extension increments.

## Alternatives and consequences

An independently editable rich-document model would require synchronization with Markdown
and could lose source spelling. Keeping Markdown authoritative avoids that conversion
boundary but requires positioned semantic projections and careful asynchronous ownership.

ADR 002 replaces the original implementation plan with the document, worker and process
contracts. This record preserves the foundation's rationale; current package structure is
described in the [architecture guide](../architecture/desktop.md).
