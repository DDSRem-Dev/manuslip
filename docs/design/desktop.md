---
name: Manuslip Desktop
description: Quiet desktop controls around local Markdown documents.
colors:
  paper: "#ffffff"
  surface: "#f7f7f5"
  text: "#30302e"
  muted: "#6b6b65"
  border: "#e5e5e0"
  input-border: "#92928b"
  accent: "#464c43"
  accent-text: "#ffffff"
  selection: "#e4e8df"
  control-hover: "#edede9"
  control-pressed: "#e4e4de"
  accent-hover: "#343a31"
  syntax-keyword: "#7653a1"
  syntax-number: "#945118"
  syntax-string: "#34603a"
  syntax-type: "#1e6478"
  dark-paper: "#242424"
  dark-surface: "#1e1e1e"
  dark-text: "#deded9"
  dark-muted: "#a7a7a0"
  dark-border: "#3c3c39"
  dark-input-border: "#797970"
  dark-accent: "#ced3c4"
  dark-accent-text: "#222421"
  dark-selection: "#41463d"
  dark-control-hover: "#343431"
  dark-control-pressed: "#41413c"
  dark-accent-hover: "#e2e6db"
  dark-syntax-keyword: "#c8a7ed"
  dark-syntax-number: "#e1b576"
  dark-syntax-string: "#acd39a"
  dark-syntax-type: "#8ccbdc"
typography:
  ui:
    fontFamily: '"Segoe UI", -apple-system, BlinkMacSystemFont, "Manuslip CJK", sans-serif'
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: '"Segoe UI", -apple-system, BlinkMacSystemFont, "Manuslip CJK", sans-serif'
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.5
  title:
    fontFamily: '"Segoe UI", -apple-system, BlinkMacSystemFont, "Manuslip CJK", sans-serif'
    fontSize: "16px"
    fontWeight: 600
    lineHeight: 1.5
  document-title:
    fontFamily: '"Segoe UI", -apple-system, BlinkMacSystemFont, "Manuslip CJK", sans-serif'
    fontSize: "13px"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "0"
  prose:
    fontFamily: '"Segoe UI", -apple-system, BlinkMacSystemFont, "Manuslip CJK", sans-serif'
    fontSize: "17px"
    fontWeight: 400
    lineHeight: 1.8
  reading:
    fontFamily: '"Segoe UI", -apple-system, BlinkMacSystemFont, "Manuslip CJK", sans-serif'
    fontSize: "17px"
    fontWeight: 400
    lineHeight: 1.7
  source:
    fontFamily: '"Manuslip CJK", ui-monospace, "Cascadia Code", "SFMono-Regular", Consolas, monospace'
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.75
  field:
    fontFamily: '"Segoe UI", -apple-system, BlinkMacSystemFont, "Manuslip CJK", sans-serif'
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  inline: "3px"
  control: "5px"
  panel: "8px"
spacing:
  "4": "4px"
  "6": "6px"
  "8": "8px"
  "12": "12px"
  "16": "16px"
  "20": "20px"
  "24": "24px"
  "32": "32px"
  "36": "36px"
  "48": "48px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-text}"
    typography: "{typography.ui}"
    rounded: "{rounded.control}"
    padding: "6px 10px"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
  button-secondary:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.text}"
    typography: "{typography.ui}"
    rounded: "{rounded.control}"
    padding: "6px 10px"
  button-secondary-hover:
    backgroundColor: "{colors.control-hover}"
  button-icon:
    backgroundColor: "transparent"
    textColor: "{colors.muted}"
    rounded: "{rounded.control}"
    padding: "6px"
    width: "32px"
  field-text:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.text}"
    typography: "{typography.field}"
    rounded: "{rounded.control}"
    padding: "8px 10px"
  navigation-tab:
    backgroundColor: "transparent"
    textColor: "{colors.text}"
    typography: "{typography.ui}"
    rounded: "{rounded.inline}"
    padding: "6px 10px"
    height: "34px"
  navigation-tab-selected:
    backgroundColor: "{colors.paper}"
  navigation-toolbar:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.muted}"
    typography: "{typography.ui}"
    padding: "0 10px"
    height: "48px"
  navigation-preferences:
    backgroundColor: "transparent"
    textColor: "{colors.text}"
    typography: "{typography.ui}"
    rounded: "{rounded.control}"
    padding: "6px 10px"
  navigation-preferences-selected:
    backgroundColor: "{colors.selection}"
  file-row:
    backgroundColor: "transparent"
    textColor: "{colors.text}"
    typography: "{typography.ui}"
    rounded: "{rounded.control}"
    padding: "6px 8px"
  panel-popover:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.text}"
    typography: "{typography.ui}"
    rounded: "{rounded.panel}"
    padding: "8px"
    width: "18rem"
  panel-preferences:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.text}"
    typography: "{typography.ui}"
    rounded: "{rounded.panel}"
    padding: "0"
    width: "min(800px, calc(100vw - 32px))"
    height: "min(680px, calc(100dvh - 32px))"
---

# Design System: Manuslip Desktop

## Overview

**Creative North Star: "The quiet writing desk"**

The document leads; the interface gives it a calm frame. Manuslip follows the supplied Typora reference through neutral materials, compact desktop controls, quiet tabs and generous prose spacing. Restraint comes from useful hierarchy and familiar editing conventions.

Shared controls use modest corners, a limited accent and regular Phosphor icons. Secondary work opens in a focused layer. Copy names the action directly and keeps consequential permission, recovery and error explanations readable.

**Key Characteristics:**

- Neutral paper and charcoal surfaces with a muted green accent.
- Compact interface type beside a larger, bounded writing measure.
- One aligned toolbar, optional workspace views and focused secondary layers.
- Immediate keyboard interaction and small, purposeful pointer motion.

The frontmatter records the shipped values. The desktop renderer's `src/renderer/src/styles.css` and `navigation.css` are the implementation authority; source editor defaults also come from `../../packages/editor/src/index.ts` relative to this app. Theme-prefixed color entries describe the dark overrides of the same CSS custom properties. Sidecar tonal ramps are panel visualizations, not additional application tokens.

## Colors

The palette is predominantly neutral; the accent has a quiet green cast in both themes.

### Primary

- **Muted green accent** (`accent`, `accent-hover`): primary actions, links, keyboard focus and native checked controls. Primary text uses `accent-text`.
- **Soft selection** (`selection`): text selection and selected Preferences navigation. It provides a restrained state fill without introducing another decorative accent.

### Neutral

- **Paper** (`paper`): the document, inputs, active tabs and dialog surfaces.
- **Sidebar surface** (`surface`): the sidebar, tab strip, source gutters and secondary document blocks.
- **Charcoal text** (`text`): normal labels and prose. **Muted text** (`muted`) supports paths, status, hints and secondary icons.
- **Quiet divider** (`border`): structural separation. **Input edge** (`input-border`) gives stronger boundaries to text fields, the command popover and the selected tab underline.
- **Control states** (`control-hover`, `control-pressed`): neutral hover and press fills. Disabled buttons retain their shape at reduced opacity (0.55).

Dark mode uses each corresponding `dark-` entry. Explicit dark mode and system dark preference share the same overrides, including reversed accent contrast and neutral charcoal backgrounds.

### Code syntax

`syntax-keyword`, `syntax-number`, `syntax-string` and `syntax-type`, with their dark counterparts, distinguish code semantics. They do not supply extra interface accents.

**The Paper Rule.** Use paper for the document and secondary layer surfaces; distinguish supporting regions with surface and quiet dividers.

## Typography

**Interface and prose:** the `ui` and `prose` font stacks follow the operating system, with Manuslip CJK fallback. **Source:** the `source` stack keeps Markdown code monospace. The CSS root size (15px) is distinct from the compact body interface size.

Use `label` for paths and counters; `ui` for actions and tabs; and `title` for Preferences headings. The document filename appears once in the tab, with its full path available in a tooltip and document details. The accessible document heading uses `document-title`. Metadata counters use tabular numerals. Form entry uses `field` where translation settings need larger editable text; native selects elsewhere inherit interface typography.

Live prose uses `prose`. Its first three heading levels are semibold (600), with sizes relative to prose (1.85em, 1.5em, 1.25em) and tighter leading (1.4). Translated articles use `reading`, with heading leading (1.3). Source editing uses `source`; inline code remains monospace in live prose.

**The Two Scales Rule.** Keep compact interface labels distinct from the larger writing and reading text. Do not promote navigation or status copy to prose scale.

## Layout

The desktop shell fills the dynamic viewport (100dvh). The initial window is 1360 × 900px, bounded by the display's available work area. One toolbar (48px) spans the window. Workspace, file and editing tools sit before the tabs; editor modes, Save, document actions and Preferences sit after them. All controls share a vertical center. Tabs occupy the flexible middle region and scroll horizontally, preserving the active tab and its separate close button. Filenames truncate while retaining their full path in accessible context.

The workspace starts closed. Its toolbar toggle opens equal 240px panes, with folders on the left and the document outline on the right. Each pane has a compact, aligned heading. When a folder is open, the Files heading keeps a small search button immediately before Open folder on the same row. That button and workspace search shortcuts open search in the left pane and focus its field; the button becomes Close search while search is open. Shortcuts without an open folder show the folder chooser and Close search. Closing search returns to the existing folder tree, or focuses Open folder when no folder is open. Files, Search and Outline no longer form a category switcher. Views retain their state when hidden. Folder listings update from filesystem events and reconcile when the window regains focus, preserving unchanged rows, expanded folders, loaded pages and drafts. The current document has a quiet selection fill in the tree. Windows and Linux hide the native menu bar while retaining menu accelerators; macOS keeps its system menu.

The workspace folder row keeps a separate close button at its right edge, including when collapsed. Its path appears once at the top of the expanded contents. Closing the folder releases its catalog and search, remembers the closed state, retains recent folders, and preserves open documents and drafts. Folder guides use 16px indentation. The outline uses nested lists with the nearest shallower heading as the parent, including skipped heading levels; 16px indentation, neutral guides, and filled, open-circle, and square punctuation clarify the hierarchy.

The live editor centers its content box at a maximum width (808px), including inline padding (36px per side), leaving a prose measure of up to 736px. Live content has top and bottom breathing room (48px and 96px). Translated articles use a bounded reading measure (80ch) with fluid inline padding. Side by side translation expands into two equal columns.

Repeated spacing is recorded in the frontmatter. Small gaps join icons and labels; larger steps separate settings groups and secondary tasks. Flat rows and dividers provide grouping without surrounding each setting with a card.

Below 58rem, New and Open move into document actions when a document is open, and both workspace panes narrow to 200px. At 44rem, the toolbar keeps one row with 28px-wide, 32px-high icon controls and narrower tab padding. Folders and outline share equal halves of an overlay below the toolbar, with folders on the left and outline on the right; search uses the overlay's width for its form and results. The overlay leaves room to reach the workspace toggle. Live prose padding reduces (24px per side, 28px top, 64px bottom), Preferences navigation shares the available width and side by side translation stacks. Additional local breakpoints stack sync comparisons (34rem) and appearance fields (26rem). The footer keeps cursor position on the left and a word-count disclosure on the right. Its compact popover pairs word and character statistics, aligns file metadata in rows, and wraps the full path below. Counts appear only for the current semantic revision.

The footer places local time beside the word-count disclosure, separated by a quiet divider. Time uses a fixed 24-hour HH:mm format, updates at each minute, and resynchronizes when the window regains focus. Keep the bottom-right summary compact. Its metadata popover uses a 16rem width, 12px text, 13px counts and tight spacing. Document details omit the text-size calculation note while retaining counts, encoding, line endings, text size, and location.

Use logical inline and block properties for spacing and borders. Keep long paths and consequential messages able to wrap. Wide code blocks, tables and workspace trees scroll within their region. Tables preserve whole words inside a keyboard-accessible scroll region. Images and diagram SVGs keep their aspect ratios in live and translated reading. Wide formulas keep their readable size and scroll horizontally; inline scripts and emoji follow the prose baseline.

File and workspace search open in filename/path mode, including when reopened after a content search. Content search requires choosing Saved file contents. Filename matching uses normalized relative paths, accepts native and forward-slash separators on Windows, and lists each file path once across result pages. Files with identical names in different folders remain separate results.

## Elevation & Depth

The shell stays flat. Neutral surface changes and thin dividers establish hierarchy; floating command popovers and the narrow workspace overlay use a restrained shadow. Native modal dialogs establish a separate layer with a dim backdrop (black at 0.22 alpha), without a custom dialog shadow.

**Command popover shadow:** `0 12px 32px rgb(0 0 0 / 0.12)`. It separates a floating command surface from the document beneath it. The narrow workspace overlay uses `8px 0 24px rgb(0 0 0 / 0.08)` along its outside edge.

## Shapes

Controls and fields use `rounded.control`; dialogs and popovers use `rounded.panel`. Tabs and inline code use the smaller `rounded.inline`. Standard strokes are thin (1px). The selected tab stays quiet with a bottom rule, strengthened in forced colors. Document content uses open space, quotes and structured blocks rather than decorative container silhouettes.

## Components

### Buttons

Buttons are compact and factual. The ordinary bordered control uses `button-secondary`, a minimum height (34px) and quiet neutral hover and press fills. Primary actions use `button-primary`, with the paired accent text. Toolbar icon buttons use `button-icon`, a compact square (32px), a transparent resting surface and muted icon color; narrow toolbar controls retain their height and reduce to 28px wide. Plugin and sync controls retain larger targets (44px).

Hover fills apply only where hover is available. Keyboard focus uses an accent outline (2px) with an external offset (3px); confined rows and tabs move that outline inward. Disabled buttons use the shared opacity and retain native disabled behavior.

### Icons

Use Phosphor regular icons from the shared `Icon` component, with inherited `currentColor`. The application toolbar keeps consistent 18px icons; tab close icons use 14px. Decorative SVGs have `aria-hidden="true"` and `focusable="false"`; icon-only buttons keep an accessible label and tooltip. Button icon and text spacing is normally 8px.

**Application mark.** A hand-turned manuscript with bowing pages, a curved gutter, a flowing spine and a curled tip expresses the hand's gesture and the flexibility of paper. The open pages and lifted leaf represent writing, reading and words carried across languages. Warm ivory and sage pages sit on deep green ink. Use the canonical `build/icon.svg` for all application branding, including the welcome screen, favicon and repository readmes; preserve its proportions and colors across themes. The welcome mark is a static, decorative image (80 × 80px, empty alt text); movement is conveyed by the asymmetric silhouette. Controls continue to use the regular Phosphor icons above. Regenerate platform icons from the repository root with `npm run icons`.

### Inputs / Fields

Preserve native input, select, textarea and checkbox semantics. Full-width translation fields use `field-text` with a stronger input edge. Search fields use the same control shape and quieter border. Place a visible label beside or above the field; keep helper and error text associated with the control. Textareas may resize vertically. Focus remains visible without adding a decorative glow.

### Navigation

Document tabs retain a quiet rectangular form, compact padding and minimum height (34px). The active tab uses paper with a bottom rule (1px); forced colors strengthen it (2px) and underline the selected title. Each close action remains separate. Long names truncate and duplicate names can include a muted path context.

Preferences view switches use transparent buttons, regular icons and a selection fill, with `aria-pressed` exposing the active view. Workspace and file search buttons use `aria-expanded` to expose their panes. Source, Live Preview and Translated reading sit in the application toolbar with pressed semantics and a subtle filled and bordered selection. Sidebar file and outline rows use logical indentation; folder chevrons expose expansion and the current file uses `aria-current`.

The Edit icon opens Undo, Redo, Cut, Copy, Paste, Select all, and Find and replace. Each row has an action icon and an aligned shortcut. Editing commands target the active document, finish pending input first and stay disabled during composition or translated reading. Clipboard commands use a strictly limited native bridge.

### Dialogs and command popovers

Use native dialog and popover behavior. Preferences has a bounded size from `panel-preferences`, a fixed header, search and footer, and a scrollable content pane beside General, Editor, Translation and Plugins navigation. Below 44rem the navigation becomes a horizontal row above the content. Preferences is available from welcome and through Ctrl/Cmd+comma; repeating the shortcut focuses search. Search supports both interface languages and provider names. Translation has quick section navigation, a saved-provider readiness summary, persistent drafts with explicit Save/Discard, and feedback beside the relevant action. Source display changes keep selection and undo; source display and the default reading layout persist. Markdown extensions includes sanitized HTML and remote-image controls beneath a divider and a current-document scope hint. Both controls are disabled without a document; remote images retain native document permission confirmation. Command popovers use `panel-popover`, grouped action rows, muted group legends and a stronger outer stroke. Document actions separates file operations, utility tools and export. Plugin commands appear only when an installed plugin is enabled, and list only enabled plugins. Both layers fit within viewport margins and contain their own overscroll. Dismissed popovers become inert as their exit begins. Preserve focus restoration, field drafts and keyboard dismissal.

**The Layer Rule.** Only pointer-opened dialogs and command popovers use spatial transitions: a short vertical offset (4px) with opacity, panel duration (180ms) and exponential ease out (`cubic-bezier(0.23, 1, 0.32, 1)`). Dialog backdrops fade with the panel. Capture the input method at each opening or closing action so typing inside a panel cannot interrupt its entrance. Closing layers become inert immediately, and interrupted transitions can reverse. Keyboard commands remain immediate. Reduced motion sets the panel duration to zero and removes the transform. Typing, document content, tab switching and editor mode changes do not animate.

Export progress and results appear in a compact message at the bottom right, 16px from the edge and 48px above the window bottom to clear the status bar. Use the paper surface, input border, panel radius and shared regular icons, with a 28rem maximum width that fits narrow windows. Messages fade with the panel duration and disappear five seconds after each export event, without moving focus or changing the writing area. Editing, changing language and switching tabs preserve the original expiry. Success and progress use polite live status; failures use alerts. Reduced motion makes the fade immediate. Export has no cancel button; closing its document still cleans up pending work. An active presentation can be closed through Document actions.

Source and Live Preview highlight only selected text, following wrapping, tabs and bidirectional text without filling the unused width of lines. Fill the complete line height and join adjacent selected rows, including fragments with different fonts, without gaps or layout changes. Suppress the active-line fill while any text is selected so the final line has the same treatment as the rest. Preserve multiple cursors, selection visibility after blur and system selection colors in high-contrast mode.

Live Preview preserves source newlines in directly editable prose, including emphasis, quotes and list items. Caret movement, selection and selection collapse retain these source rows. Projected prose also preserves its text newlines without doubling hard breaks or adding spacing from HTML serialization. Reading and export keep their Markdown paragraph semantics. Code blocks preserve literal whitespace; semantic multiline code spans normalize their line endings. Complex projected prose aligns with editable prose. Chinese language choices use the script names 简体中文 and 繁體中文 consistently across provider settings and reading controls.

Enabled YAML front matter stays directly editable in a single shaded header with source typography and quiet borders. Live Preview hides its delimiters; Source mode preserves the full original text. Either `---` or `...` ends YAML, and its syntax remains separate from the Markdown body, including when the closing fence directly precedes prose. Plugins preferences uses “Markdown extensions” and concise feature keywords; Opt controls both highlight and strikethrough.

Live Preview uses explicit editing sessions. Clicking a rendered block opens editable Markdown with a collapsed caret; repeated clicks keep it open. Escape or moving the caret outside the block restores its presentation. No Select source or Edit table buttons appear in the document. A diagram or display formula keeps its preview below the active source, updating as semantics settle. Clicking a table cell edits only that cell's Markdown while the rest of the table stays rendered. Cell editors inherit the cell's colors and typography, preserving backgrounds, row striping, borders and alignment without an active fill or underline. They use faint syntax, navigate with Tab and Enter, and share the document's undo and save barriers, including native composition. Double-clicking editable source uses native word selection. F2 edits a focused cell, or the first cell of a focused table, in place. Rendered tables do not open the structural dialog; its explicit Document actions command owns that flow. Unchanged projections remain rendered while changed source is parsed. Non-empty text selections keep exclusive range endpoints; modified link clicks, note navigation, task controls and horizontal scrolling retain their own behavior. Async images, math and diagrams expose loading, ready, error and limited states, readable source or alt text, and explicit retries. Remote images without permission remain blocked.

Rendered blocks align with the document measure and use open space. Code and active source panels use a softly shaded inset with a small radius and a slightly smaller monospace scale. An editing inline formula uses the same surface and 15px monospace type as display math source, with 2px block and 6px inline padding around its editable text. It adds one unframed preview row immediately below the source line, before the next text line, with 8px above and 12px below inside the widget's measured box. The preview starts at the first source character, following its measured position through wrapping, resizing and zoom. Activation remains unchanged; clicking the preview keeps the source caret and session. Display math and HTML block interactions retain their existing behavior. Exposed Markdown delimiters use `syntax-marker`, mixed from 94% muted text and 6% paper, so syntax recedes behind the prose while retaining readable contrast in both themes. Forced colors uses CanvasText for these markers.

Inline emphasis and code retain their typography while the caret exposes paired punctuation. Escapes, entities and emoji keep their rendered character and show editable source immediately after it when the caret touches the token. These auxiliary hints mix 72% muted text with paper and use a slightly smaller monospace scale; forced colors uses GrayText. Their glyph adornments never enter the document or copied Markdown. This follows the local Typora renderer's fence focus lifecycle, per-cell table targets and `md-meta` treatment, informed by all bundled GitHub, Newsprint, Night, Pixyll and Whitey themes. The implementation and assets remain Manuslip's own.

Basic document HTML follows the CommonMark grammar and the document's sanitized HTML setting, independently of optional Markdown plugins. Writing, reading and export share the same semantic elements and typography: keyboard keys use a quiet 1px outline and the mono stack; small print, samples, variables and captions use a .875em scale; ruby readings use .6em above the base text. Captions use muted text, normal weight and start alignment, with .6em separation. Figures align with prose without an enclosing frame. Underlines and abbreviation dots sit clear of glyphs. Table header ID references remain connected through sanitization and separate bilingual columns. HTML source stays editable with the same persistent source sessions as other blocks.

GitHub alerts use distinct regular Phosphor icons beside their text titles, a 1px accent edge and a faint themed background. Keep titles and bodies close enough to read as one block. Icons inherit the title color, remain decorative to assistive technology and render offline in exports.

Loaded images retain their proportions without extra framing. HTML blocks containing only an image use the same document alignment and reveal source on click. Loading, blocked and failed images show an image icon, alt text and status; failures offer a labeled Retry action. Preserve safe authored width, height and Typora-style zoom when sanitized HTML is enabled. A successful asset read becomes ready only after browser decoding succeeds.

Footnote references use small superscript numbers on a neutral surface. Note bodies use a smaller prose scale, hanging numbers and regular Phosphor return icons; repeated return links retain distinct counts and accessible names. Named definitions stay at their authored positions, and inline notes form a compact group after the document. Clicking a note body opens its original source for editing. Reading and export share the same note typography, with a thin divider above the collected notes. Reference definitions keep editable Markdown with semibold labels, muted punctuation and titles, and accent-colored destinations.

## Do's and Don'ts

### Do:

- **Do** use the shared semantic CSS properties so light, dark and system themes stay aligned.
- **Do** keep the document measure bounded and the surrounding controls compact.
- **Do** use regular Phosphor icons with current text color and accessible control names.
- **Do** preserve native form semantics, visible keyboard focus and reduced motion behavior.
- **Do** keep permission, recovery and error consequences readable in concise, factual copy.

### Don't:

- **Don't** animate typing, document text, tab switching or editor mode changes.
- **Don't** replace flat file and settings rows with decorative card grids.
- **Don't** mix icon families or substitute text glyphs for action icons.
- **Don't** use syntax colors as decorative interface accents.
- **Don't** hide necessary action names or consequential explanations to make the interface look quieter.
