# Visual foundations

Keep prose dominant and supporting controls compact. [Workspace guidance](workspace.md)
defines interaction; the linked source files own exact visual values.

## Colors and type

Reuse semantic tokens in [desktop styles](../../apps/desktop/src/renderer/src/styles.css):

| Tokens | Role |
| --- | --- |
| `--paper`, `--surface` | Document/dialog surfaces and supporting regions |
| `--text`, `--muted` | Primary content and secondary labels |
| `--border`, `--input-border` | Quiet dividers and discoverable editable fields |
| `--accent`, `--accent-text` | Primary actions and focus |
| `--selection`, hover/pressed tokens | Selection and control states |

Light mode uses white paper and charcoal text; dark mode uses neutral charcoal surfaces.
Keep syntax markers readable and preserve system colors in forced-color mode.

| Role | Default size / line height |
| --- | --- |
| UI | 13px / 1.5 |
| Source | 15px / 1.75 |
| Live prose | 17px / 1.8 |
| Reading prose | 17px / 1.7 |

Use existing system/CJK and monospace stacks and Phosphor regular icons. Decorative icons
stay hidden from assistive technology. Fonts remain [offline](../development/assets.md).
[Document typography](../../packages/renderer/src/typography.ts) overrides prose across
editing, reading and export while leaving UI type intact.

## Layout

Use [navigation styles](../../apps/desktop/src/renderer/src/navigation.css) for geometry:

| Region | Baseline |
| --- | --- |
| Toolbar | One 48px row; tabs use remaining space and scroll. |
| Files / Outline | Equal 240px panes; 200px at `58rem` and below; 16px tree indentation. |
| Navigation at `44rem` and below | Overlay pair up to 440px, leaving at least 40px uncovered; search uses one pane up to 320px. |
| Live prose | 808px container including 36px side padding; 24px side padding at narrow widths. |
| Reading | 80ch container; bilingual columns use available width and stack when narrow. |
| Preferences | Up to 800 × 680px; fixed heading/search/footer, scrolling content; navigation becomes a row when narrow. |

Confine scrolling to content regions. Truncate tab/file titles with full paths available
in details; let outline headings wrap. Keep dialogs inside window gutters. Align related
controls and use surface tone or thin borders to separate permanent regions; shadows and
dimmed backdrops identify temporary layers.

## Controls

Reuse the 5px control and 8px panel radii. Standard buttons/selects are at least 34px high;
toolbar icon targets use 32px, compacting to 28px at narrow widths. Standard focus rings
are 2px with a 3px offset. Distinguish selection, hover and keyboard focus. Keep table cell
borders stable during editing.

## Motion

Typing, selection, reflow, tab switches and surface changes are immediate. Pointer-opened
secondary layers use opacity and a 4px vertical offset over 180ms with
`cubic-bezier(0.23, 1, 0.32, 1)`; keyboard interaction is immediate. Reduced motion removes
movement and duration. Closing layers become inert immediately. The 120ms feedback token
applies to controls, never document changes.
