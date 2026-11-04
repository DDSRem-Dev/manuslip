# Workspace guidance

Give local Markdown a readable editing surface and a separate translated reading copy.
Prioritize text integrity, uninterrupted input, legibility and discoverable commands.
[Desktop controls](desktop.md) define usage; [foundations](foundations.md) define appearance.
[ADRs](../adr/index.md) govern architectural changes.

## Editing

- Preserve source, selection, scroll context and undo across views and appearance changes.
  Complete pending input before captures or replacements; respect composition.
  [ADR 002](../adr/002-implementation-plan.md) defines ownership.
- Align rendered and editable prose. A rendered block opens a source session until Escape
  or the caret leaves. Keep unchanged blocks rendered during semantic updates.
- Make selections follow characters and source line breaks, revealing relevant syntax
  without filling line tails. Preserve native double-click selection and caret placement.
- Keep math/diagram previews beside editable source and wide content in accessible scroll
  regions. Unsupported or failed rendering retains Source access and recovery.
- Keep cell editing direct and structural table changes explicit. A rejected Apply retains
  its draft; unchanged Apply adds no undo event. See [ADR 007](../adr/007-visual-tables.md).

## Navigation and commands

Use one toolbar: workspace, file/edit commands, tabs, document surfaces, Save, Document
actions and Preferences. Keep Save and the active surface visible; group secondary tasks
in disclosures. Explain unavailable actions beside their prerequisites.

Start with navigation closed. Files describes the selected folder; Outline describes the
active document. Preserve expanded folders, loaded pages and keyboard location on refresh.
Keep Close folder reachable when the tree is collapsed.

Label filename navigation separately from saved-content search. Identify result files and
locations; distinguish empty, unmatched, incomplete and failed results. Opening results
preserves other drafts. Tabs separate selection from closing and expose unsaved changes;
full paths belong in document details. Only display counts for the current revision.

## Reading and settings

Keep original/translation pairing clear and stack bilingual pairs at narrow widths.
Place provider readiness, target language and recovery beside their actions:

| State | Guidance |
| --- | --- |
| Missing configuration | Name the missing requirement and open its setting. |
| Working | Show progress and Cancel; keep writing available. |
| Partial or failed | Preserve completed work and source fallback; offer Retry failed. |
| Source changed | Mark the copy stale; require explicit refresh. |

Preserve preference drafts across sections. Separate application settings, document
appearance and permissions. Document CSS must leave Source, Reset and controls usable
under [ADR 008](../adr/008-document-appearance.md).

For [export](desktop.md#export-and-presentation), [plugins](plugins.md) and [sync](sync.md),
show the input, destination, effect and recovery before publication. Keep diagnostics out
of product copy. Denial, cancellation and offline operation need useful next actions.

## Input and accessibility

Give every command keyboard access and an accessible name. Distinguish status with text,
not color alone. Preserve visible focus, composition and native selection. Closing a layer
returns focus to its trigger or a surviving control; later input takes precedence over
asynchronous focus restoration. Follow [motion rules](foundations.md#motion).

Check both interface languages, Chinese input, mixed RTL/LTR text, long paths, forced colors,
reduced motion, 320px width and 200% zoom. Keep narrow commands reachable.
Focus/typewriter modes remain retired under [ADR 005](../adr/005-writing-modes.md).

## Reference principles

These adaptations guide Manuslip; they do not prescribe additional features:

| Reference | Principle |
| --- | --- |
| [Typora](https://support.typora.io/Quick-Start/) — commercial | Readable inline editing and expandable document details. |
| [MarkText](https://github.com/marktext/marktext/blob/develop/packages/website/content/docs/end-user/BASICS.md) — open source | Immediate source access and discoverable contextual commands. |
| [Zettlr](https://docs.zettlr.com/en/sidebar/) — open source | Separate file navigation from document context. |
| [ghostwriter](https://ghostwriter.kde.org/) — open source | Quiet statistics and outline navigation for long documents. |
