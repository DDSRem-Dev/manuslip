# Renderer polish from the supplied Typora source

Reference: `D:/Project/user/Nazumeki/manuslip-typora/typora/markdown/renderer`,
reviewed on 2026-11-03. The comparison covers math, note rendering/navigation,
selection, task updates and their interaction with source editing. Manuslip keeps
its CodeMirror 6 source positions, worker rendering, sanitizer and source-preserving
undo model.

| Reference source | Relevant behavior | Manuslip refinement |
| --- | --- | --- |
| `modules/27-math-inline.js`, `modules/30-mod-30.js` | Inline math retains MathJax's container/SVG layout within prose. Rendered output and editable TeX have separate lifetimes. | Keep ordinary inline SVG overflow visible so accents and deliberately smashed expressions remain visible. A width observer enables horizontal scrolling only when an expression exceeds its line and restores normal flow when the line widens. |
| `modules/1b-math-block.js` | MathJax receives document font metrics and retains mathematical baseline/depth. | Preserve the existing font-relative baseline reconstruction. Compensate a real horizontal scrollbar's height without moving the formula's glyph baseline. |
| `modules/13-node-to-html.js` | Footnote definitions are document rows containing a label, body and return links. | Remove the generic widget card from note definitions, align source-edit actions beside the content, and provide an edit action for named definitions too. |
| `modules/42-doc-menu.js` | Definitions and individual return references have explicit relationships; repeated references retain distinct return destinations. | Carry a note body's rendered placement into references inside it. Returning from another note now mounts the footer containing that reference instead of jumping to hidden inline source. Resolve already mounted targets directly within the current editor. |
| `modules/2c-stylize.js`, `modules/2a-brush.js` | Task updates operate on model attributes, while rendering and selection changes have separate responsibilities. | Retain the existing local task-marker update and widget reuse. Frame-by-frame checkbox regressions remain part of validation. |

The nested-reference defect was reproduced by a unit test: an inline note's return
anchor retained its source offset but lost its `after-document` placement. A long
desktop document then exercises both directions with the named definition and the
inline note outside one another's mounted viewport.

Rendering checks cover overhanging accents, `\smash{\dfrac{a}{b}}`, long formulas,
keyboard scrolling, resizing from wide to narrow and back, scripts/fractions/CJK,
heading and table formulas, dark theme, larger text and zoom. Source editing, note
numbering, reading copies, HTML export and literal disclosure tags retain their
existing regression coverage.

Relevant checks:

```powershell
npx vitest run apps/desktop/test/unit/renderer/src/preview/preparation.test.ts packages/renderer/test/unit/math-layout.test.ts packages/editor/test/unit/inline-footnotes.test.ts
npm run test:e2e -- test/e2e/renderer-polish.spec.ts test/e2e/footnote-navigation.spec.ts test/e2e/inline-markdown.spec.ts test/e2e/task-controls.spec.ts
npm run check
```

Evidence is retained under `test/artifacts/logs/typora-polish-*` and `test/artifacts/logs/typora-renderer-*`.

Validation on the updated Windows source build: 21,453 unit/integration cases
passed across 268 files, with one POSIX permission case skipped on Windows.
All 38 desktop regressions passed, including four checkbox cases and the two new
renderer-polish cases. The new cases also passed a separate run after adding
explicit source-edit coverage for named definitions. Five smoke tests then passed
against the rebuilt Windows executable, including named-note editing and undo,
resizing formulas in both directions, note navigation, reading and HTML export.
The Windows installer was rebuilt successfully. Lint, formatting, runtime
boundaries and TypeScript checks passed.
