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
    fontSize: "16px"
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
    padding: "9px 12px"
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
    width: "min(620px, calc(100vw - 32px))"
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

The desktop shell fills the dynamic viewport (100dvh). One toolbar (48px) spans the window. Workspace, file and editing tools sit before the tabs; editor modes, Save, document actions and Preferences sit after them. All controls share a vertical center. Tabs occupy the flexible middle region and scroll horizontally, preserving the active tab and its separate close button. Filenames truncate while retaining their full path in accessible context.

The workspace pane starts closed. Opening it reveals a 240px sidebar below the toolbar, with one Files, Search or Outline view at a time. Views retain their state when hidden. Workspace search shortcuts open the search view and focus its field. Windows and Linux hide the native menu bar while retaining menu accelerators; macOS keeps its system menu.

The live editor centers its content box at a maximum width (808px), including inline padding (36px per side), leaving a prose measure of up to 736px. Ordinary live content has top and bottom breathing room (48px and 96px); typewriter mode owns its own vertical positioning. Translated articles use a bounded reading measure (80ch) with fluid inline padding. Side by side translation expands into two equal columns.

Repeated spacing is recorded in the frontmatter. Small gaps join icons and labels; larger steps separate settings groups and secondary tasks. Flat rows and dividers provide grouping without surrounding each setting with a card.

Below 58rem, New and Open move into document actions when a document is open. At 44rem, the toolbar keeps one row with 28px-wide, 32px-high icon controls and narrower tab padding. The workspace pane overlays the document below the toolbar and leaves room to reach the toolbar toggle. Live prose padding reduces (24px per side, 28px top, 64px bottom), Preferences navigation shares the available width and side by side translation stacks. Additional local breakpoints stack sync comparisons (34rem) and appearance fields (26rem). The document container hides its secondary count below 38rem.

Use logical inline and block properties for spacing and borders. Keep long paths and consequential messages able to wrap. Wide code blocks, tables and workspace trees scroll within their region.

## Elevation & Depth

The shell stays flat. Neutral surface changes and thin dividers establish hierarchy; floating command popovers and the narrow workspace overlay use a restrained shadow. Native modal dialogs establish a separate layer with a dim backdrop (black at 0.22 alpha), without a custom dialog shadow.

**Command popover shadow:** `0 12px 32px rgb(0 0 0 / 0.12)`. It separates a floating command surface from the document beneath it.

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

Preferences and workspace view switches use transparent buttons, regular icons and a selection fill, with `aria-pressed` exposing the active view. Source, Live Preview and Translated reading sit in the application toolbar with the same pressed semantics and a subtle filled and bordered selection. Sidebar file and outline rows use logical indentation.

The Edit icon opens Undo, Redo, Cut, Copy, Paste, Select all, and Find and replace. Each row has an action icon and an aligned shortcut. Editing commands target the active document, finish pending input first and stay disabled during composition or translated reading. Clipboard commands use a strictly limited native bridge.

### Dialogs and command popovers

Use native dialog and popover behavior. Preferences has a bounded width from `panel-preferences`, a scrollable interior and separate General, Translation and Plugins views. Command popovers use `panel-popover`, grouped action rows, muted group legends and a stronger outer stroke. Both layers fit within viewport margins and contain their own overscroll. Dismissed popovers become inert as their exit begins. Preserve focus restoration, field drafts and keyboard dismissal.

**The Layer Rule.** Only pointer-opened dialogs and command popovers use spatial transitions: a short vertical offset (4px), panel duration (180ms) and exponential ease out (`cubic-bezier(0.23, 1, 0.32, 1)`). Keyboard commands remain immediate. Reduced motion sets the panel duration to zero and removes the transform. Typing, document content, tab switching and editor mode changes do not animate.

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
