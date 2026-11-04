# ADR 007: Edit tables through source-preserving transactions

Status: Accepted.

## Context

Tables need convenient cell and structural editing without replacing Markdown spellings,
document history or text outside the selected table. Pending input and asynchronous
captures can otherwise apply a table draft to a different revision.

## Decision

Live cells edit their own source in place, including F2 activation. Double-click retains
native text selection and active cells keep their theme, borders and alignment.
Structural editing is the explicit Document actions → Edit table command.

The dialog stages a bounded table draft from the current positioned native snapshot.
Preserve original cell text, escapes, inline code and supported container prefixes.
Ambiguous structures remain editable in Source. Cancel discards the draft; unchanged
Apply creates no history event.

Before Apply, synchronize input and recheck source identity, revision, owner, locks and
composition. Replace only the table in one undoable transaction, map existing selections
and retain the document's size filter. Rejection keeps the draft available.

## Alternatives and consequences

Rebuilding the document from a table/AST model can normalize unrelated spelling and
history. Opening a structural dialog on every table click interferes with direct editing.
The chosen split requires target/race validation and source-aware serialization, while
keeping ordinary cell editing and explicit structural work predictable.

See [table controls](../guides/desktop.md#tables-and-appearance), the
[table model and limits](../../apps/desktop/src/renderer/src/table-model.ts) and
[model regressions](../../apps/desktop/test/unit/renderer/src/table-model.test.ts).
