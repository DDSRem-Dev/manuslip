# Desktop guide

## Writing and reading

| Surface | Shortcut | Purpose |
| --- | --- | --- |
| Source | `Ctrl/Cmd+1` | Edit literal Markdown. |
| Live Preview | `Ctrl/Cmd+2` | Edit the same source with inline formatting. |
| Translated preview | `Ctrl/Cmd+3` | Read a captured, read-only translation. |

Tabs retain selection, scroll and undo. Save preserves encoding, BOM and line endings;
conflicts and recovered drafts require a version choice before replacement.

Open a folder for Files and Outline. `Ctrl/Cmd+P` finds filenames;
`Ctrl/Cmd+Shift+F` opens workspace search. **Saved file contents** searches disk text,
excluding unsaved edits and untitled documents. The footer count opens statistics
and file details. **Preferences** (`Ctrl/Cmd+,`) controls theme, language, editor, translation
and plugins. See [Markdown support](commonmark.md) for syntax and content permissions.

Configure an OpenAI-compatible, Ollama or DeepL provider, select a target language (Simplified
Chinese by default) and click **Translate**. Opening Translated preview automatically displays
a fully cached translation, including after switching tabs or restarting, without contacting
the provider. New translations wait for **Translate**; saved blocks are reused automatically.
Saved translations expire after 30 days. Expired blocks remain in the original language until
you choose **Translate** again. Upgrading from the previous cache format rebuilds the saved
translation cache.
When no translated copy is available, the preview renders the original Markdown, including
before translation is configured. Outline headings jump within the visible preview and keep
the selected reading mode.
Requests run concurrently, and results appear in document order. The translation toolbar stays
visible while scrolling, with Cancel and Retry failed controls. Reading options offers
translation-only, side-by-side and interlinear layouts. Source changes mark the copy stale;
refresh explicitly. Code, math and destinations remain protected.

## Tables and appearance

Click a Live table cell or press F2 to edit; double-click preserves native selection.
Enter/Shift+Enter and up/down move rows; Alt+left/right moves columns. For structure, place
the caret in a table and choose **Document actions → Edit table**. Apply is one undoable
edit; Cancel discards the draft. Unsupported structures remain editable in Source.

**Document actions → Document appearance** sets fonts, size, spacing and width. Named files
retain appearance; Save As inherits it. Reset defaults removes overrides without changing
text or history. See [ADR 007](../adr/007-visual-tables.md) and
[ADR 008](../adr/008-document-appearance.md) for table/appearance constraints.

Imported CSS must be local UTF-8, at most 64 KiB:

- Select Markdown tags with descendant/child combinators; `body`, `:root` and
  `.markdown-body` alias the document root.
- Use supported typography, color, spacing, table/list and border longhands
  (`border-width`, `border-style`, `border-color`).
- At-rules, URLs, custom properties, arbitrary classes/attributes, pseudo selectors and
  `!important` are rejected. Source, Reset and controls stay outside imported styling.

## Export and presentation

**Document actions** exports source; **Reading options** exports the selected reading copy
and layout. Each job captures content and appearance once. Confirm stale/partial reading
output; missing translations retain source. Asset failures preserve existing destinations.

| Output | Behavior |
| --- | --- |
| HTML | Self-contained document. |
| PDF | A4, 20mm margins. |
| PNG/JPEG | Complete document; at most 8,192px per side and 16 million physical pixels. Use HTML/PDF for larger output. |
| Presentation | Top-level thematic breaks define slides, otherwise H1 headings; at most 200 slides. Nested boundaries remain content. |

Arrows, Page Up/Down, Space, Home and End navigate slides; Escape or Exit returns to writing.
[ADR 009](../adr/009-presentation-image-export.md) defines captured output.

**Export with Pandoc** adds Word (`.docx`), EPUB and LaTeX source/images (`.zip`). Explicitly
select a trusted local Pandoc 3 executable; it runs with your OS privileges. Choose Standard
or Numbered headings + contents. Prose, tables and notes remain editable; math/diagrams
become images. LaTeX compilation needs a separate Unicode-capable toolchain and fonts.
See [ADR 010](../adr/010-optional-pandoc.md).

Optional workflows: [command plugins](plugins.md), [file sync](sync.md).
Interface work: [workspace guidance](workspace.md), [visual foundations](foundations.md).
