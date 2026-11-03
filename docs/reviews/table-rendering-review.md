# Table rendering from the Typora reference

Reference: `D:/Project/user/Nazumeki/manuslip-typora/typora/markdown/renderer`,
reviewed on 2026-11-03.

`modules/13-node-to-html.js` separates the table header and body, applies alignment
to every cell in a column, and places the table within its document figure.
`modules/4a-table-edit.js` keeps table controls around the grid and moves alignment
with its column. These guide the refinements; Manuslip retains its own renderer,
sanitizer, staged table editor and source history.

Markdown alignment was present in the generated HTML but disappeared at the DOM
sink: the sanitizer's restrictive URI policy rejected `align` values. The shared
sanitizer now preserves this non-navigation attribute. Explicit cell alignment
rules also prevent the export stylesheet from overriding it. Unspecified alignment
inherits the document's text direction, including table headers.

Live tables now align with the prose measure without an additional widget frame.
Live and reading tables share cell spacing, top alignment, semibold headers,
subtle alternating rows and tabular numerals. Wide tables keep whole words and
scroll inside named, keyboard-accessible regions. English and Chinese labels
follow the interface language. Exports use the same spacing and alignment.

The visual editor displays the current column alignment immediately and keeps
headers visible while scrolling. Its grid has an isolated stacking context so
sticky headers cannot cover row and column menus.

`test/e2e/table-rendering.spec.ts` exercises explicit and default alignment, short rows,
nested tables, references, Unicode, emoji, math, local horizontal scrolling,
320–1144px windows, 200% zoom, RTL, forced colors, light and dark themes, staged
alignment changes, translated table cells, all reading layouts, and exported HTML
under screen and print styles. Existing table editing checks cover accessibility,
saved bytes, one-step undo/redo and source fallbacks.

Visual evidence and the design scan are retained under `test/artifacts/logs/table-render-polish/`.
The scan reports existing blockquote rules and unrelated typography; it introduces
no findings on the changed table rules.

Validation: the source build and `npm run check` pass, as do 64 focused unit tests
and 18 desktop regressions for tables, reading, export and adjacent renderers.
The final three table-rendering cases also pass with actual translated cell text.
A 45-row editor check confirms that the header remains visible, the focused final
cell stays unobscured, and row menus appear above the grid.
