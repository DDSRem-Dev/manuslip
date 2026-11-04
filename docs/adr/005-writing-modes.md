# ADR 005: Retire focus and typewriter modes

Status: Retired on 2026-11-02; the original writing-mode decision is no longer active.

## Context

The original feature added a focus surface that hid ordinary workspace controls and a
typewriter option that centered the caret through editor padding and measurements.
Both modes were subsequently removed at the user's request.

## Decision

Keep Source, Live Preview and translated reading as the supported document surfaces.
Remove focus/typewriter controls, special toolbars, centering extensions and associated
state. Migrate valid saved typewriter preferences away while preserving unrelated editor
and reading settings. Loading an older profile must not re-enable either mode.

## Alternatives and consequences

Keeping the modes behind an old preference would retain their behavior and lifecycle
burden despite retirement. Removing them simplifies viewport and control ownership while
preserving ordinary document text, selections, undo and reading state.

A future proposal to reintroduce either mode needs a new ADR. Preserve this record so
old implementation plans cannot be mistaken for current requirements.
See [settings migration](../../apps/desktop/src/main/settings.ts), its
[regression tests](../../apps/desktop/test/unit/main/settings.test.ts) and
[workspace guidance](../guides/workspace.md).
