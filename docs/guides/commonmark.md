# CommonMark support

The base grammar follows [CommonMark 0.31.2](https://spec.commonmark.org/0.31.2/).
The desktop defaults to CommonMark with the basic extensions below. Optional
extensions are available in **Preferences → Plugins → Markdown extensions**.
Settings save automatically, survive restart and apply to every document's preview,
new translated reading copies and export. Existing reading copies retain the
conventions captured when they were created; refresh them to use changed settings.

Supported CommonMark constructs include:

- ATX headings (`#` through `######`) and Setext headings (`===` and `---`).
- Paragraphs, blank lines, thematic breaks, soft breaks and both hard-break forms.
- Blockquotes, nested containers, and tight or loose lists. Ordered lists accept
  both `1.` and `1)` and number subsequent items from the first marker, preserving
  the original source numbers.
- Four-space or tab-indented code, and backtick or tilde fenced code. Fence lengths,
  indentation, info strings, empty blocks and unclosed fences follow the standard.
  Code can appear inside lists and blockquotes. Whitespace, tabs, entities, HTML and
  Markdown punctuation in code remain literal; known fence languages load syntax
  highlighting, while unknown languages retain plain code.
- Code spans, emphasis, strong emphasis, escapes, and named or numeric entities.
- Inline links and images, full/collapsed/shortcut references, reference definitions,
  URI and email autolinks, and inline or block HTML.

The application applies its existing HTML, link and image policies after parsing.
Raw HTML displays as source by default; opting in still sanitizes it. Navigation
allows HTTPS and document fragments; local images use the authorized asset reader,
and remote images require permission. Recognizing Markdown does not bypass those
policies.

The desktop deliberately excludes `<details>` and `<summary>` from HTML recognition.
Their tags stay literal in Live Preview, reading and exports, including when sanitized
HTML is enabled. Markdown between those tags continues to work; it does not become
a collapsible disclosure or an opaque HTML block. Source mode retains the original text.

Live Preview keeps ordinary prose directly editable and preserves source newlines.
Blocks that need semantic rendering use widgets. Clicking one opens its editable source
with a caret; it stays open until Escape or the caret leaves. Diagrams and display formulas
keep a preview below their source while editing. An inline formula keeps its existing source
activation and adds a preview row immediately below the source line, before the next text line.
Its editable source has a quiet gray background; the preview aligns with the first source
character, including after resizing, wrapping and zoom.
Table cells edit independently inside the rendered table, with Tab/Enter navigation and shared
document undo. Their backgrounds, borders, colors and alignment stay the same while editing,
without an active underline. Double-click keeps editing inside the cell; F2 edits a cell in place.
Source punctuation stays lighter than its formatted text. Escapes, entities
and emoji show editable source after the character while the caret touches them; their glyphs
follow native caret placement rather than opening a block source session. Source
mode, undo, copying and saving preserve the authoritative
document, including the file's newline convention. Export uses the same semantic
renderer without changing the source.

## HTML

Enable **Preferences → Plugins → Markdown extensions → Render sanitized HTML** to
render basic document HTML in the current document.
This works with every optional Markdown plugin switched off and applies to Live
Preview, translated reading copies and export. Source mode always shows the authored
markup; click a rendered HTML block or paragraph to edit its source.

Supported elements include:

- Text formatting: `<b>`, `<strong>`, `<i>`, `<em>`, `<u>`, `<s>`, `<del>`, `<ins>`,
  `<small>`, `<mark>`, `<sub>` and `<sup>`.
- Inline semantics: `<abbr title="…">`, `<cite>`, `<q>`, `<dfn>`, `<kbd>`, `<samp>`,
  `<var>`, `<time datetime="…">`, ruby annotations (`<ruby>`, `<rt>`, `<rp>`),
  bidirectional text (`<bdi>`, `<bdo>`) and `<wbr>`.
- Document structure: headings, paragraphs, line breaks, rules, blockquotes, lists,
  code, links, images, divisions, sections, articles, asides, addresses and figures
  with `<figcaption>`.
- HTML tables, including `<caption>`, column groups, header/body/footer rows,
  spanning cells and `scope`/`headers` relationships. Header references remain
  connected after ID scoping, including in bilingual reading copies.

Keyboard keys have a quiet outline, annotations and captions use smaller type, and
ruby readings sit above their base characters. Titles, language and direction are
preserved. Lists retain `start`, `reversed` and signed item `value` attributes;
insertions and dates retain `datetime`, and citations retain allowed destinations.
Scripts, embedded pages, event handlers and document CSS are removed; image sizing
is the supported inline-style exception described below.

CommonMark distinguishes inline HTML from HTML blocks. Markdown can appear between
inline tags, such as `Text <b>**bold Markdown**</b> here.` Text inside an HTML block
stays literal until the CommonMark block ends; for example, `**bold**` inside a
consecutive `<div>…</div>` block is not parsed as emphasis. Code spans and fences
always keep HTML literal. See the [HTML block rules](https://spec.commonmark.org/0.31.2/#html-blocks)
and [raw HTML rules](https://spec.commonmark.org/0.31.2/#raw-html).

## Images

Markdown images keep their natural proportions and fit the available document
width. Local images resolve relative to the saved document. Remote images load
after enabling **Load remote images** in **Preferences → Plugins → Markdown
extensions** and granting permission for the current document.

With **Render sanitized HTML** enabled, `<img>` also retains numeric `width` and
`height` attributes and safe inline `width`, `height` and `zoom` sizing, including
Typora's `style="zoom:50%;"`. Other document CSS is discarded. These sizes carry
through reading and export.

Live Preview and reading show an icon, alt text and a readable status while an
image loads or is blocked. Failed images provide **Retry**; a successful file read
still waits for the browser to decode the image. Loaded images have no extra frame.

## Basic extensions

These remain available with every optional plugin switched off.

| Extension | Example and behavior |
| --- | --- |
| Tables | Pipe tables with `:---`, `:---:` or `---:` column alignment; escaped pipes and code spans remain literal. |
| Fenced code | CommonMark backtick and tilde fences, language labels and unfinished blocks. |
| Footnotes | Named notes (`A note[^id]` and `[^id]: Note body`) and inline notes (`A note^[Note body]`), with shared numbering, rich inline formatting and return links. Named definitions also support multiple paragraphs and repeated references. |
| Task lists | `- [ ] Pending` and `- [x] Complete`; toggling a rendered checkbox changes the original marker as one undoable edit. |
| Smart punctuation | Straight quotes become typographic quotes, apostrophes curl, `--`/`---` become dashes and `...` becomes an ellipsis. Code, math and link destinations remain literal. |
| Heading attributes | `## Title {#chapter .wide}` assigns an ID and classes to ATX or Setext headings. Invalid or escaped attributes remain text. |
| Superscript | `x^2^` or `^**bold**^`, without whitespace inside the delimiters. |
| Subscript | `H~2~O`, without whitespace inside the delimiters. |

Headings receive deterministic Unicode-aware anchors. Explicit IDs take precedence;
duplicates receive numeric suffixes. TOCs, document fragments and exported HTML use
matching anchors. Sanitized HTML prefixes IDs to avoid collisions with application
controls and rewrites their links together.

TOML front matter, offline emoji shortcodes, definition lists and legacy diagram
fences remain supported. See the [extended syntax decisions](../adr/006-extended-markdown.md).

Inline note bodies appear after the document in Live Preview and in the normal
footnote area in reading and export. Following a reference scrolls to and focuses
the displayed note; its return link focuses the original reference. This works
across unmounted editor viewports and with keyboard activation. Their source remains
at `^[...]`; click the note body to open its original source for editing. Balanced brackets,
escaped closing brackets, code spans, links, inline formulas and soft line breaks
are supported. Empty or unfinished notes stay literal. Translation handles note
prose separately while protecting code, math and link destinations.
Live note definitions use plain document rows. Each named or inline definition has
direct source editing on click; return links also work for references inside another note body.
References use compact superscript numbers. Definitions keep their first-reference
number even when authored in a different order. Reading and export share smaller note
typography, hanging numbers and return icons, including separate links for repeated
citations. Live reference definitions keep their original editable text with quieter
punctuation, emphasized labels and themed destinations.

## Optional extensions

| Extension | Default | Syntax |
| --- | --- | --- |
| Opt | On | `==highlighted text==` and `~~strikethrough~~`, including nested emphasis and code. One tilde is reserved for subscript. Both extensions stay literal with Opt off. |
| LaTeX | On | Inline and display TeX, math fences and the bundled formula packages described below. |
| Mermaid | On | Render `mermaid` fences as local diagrams. Disabling it leaves the fence as highlighted code, including inside lists or quotes. |
| GitHub | Off | GFM autolink literals plus the five GitHub alert/callout types. |
| Typora | Off | Recognize YAML front matter at the start of the document. A standalone `[TOC]` or `[toc]` becomes a nested, linked table of contents. |

Each switch controls its own syntax. A disabled convention remains ordinary
Markdown; other plugins and the basic extensions continue to work. Code spans,
fenced blocks and escaped markers do not activate conventions. **Reset extensions**
restores these defaults.

### LaTeX

Use `$x^2$` or `\(x^2\)` inline. Use a standalone `$$...$$`, a multiline `$$` block,
`\[...\]`, or a `math`, `tex` or `latex` fence for display formulas. TeX source is
protected during translation. SVG output is self-contained and works offline in
preview, reading and exports; inline equations retain the complete expression and
MathJax's mathematical baseline and depth. Superscripts extend above that baseline
and subscripts below it; fractions and integral signs use their mathematical axis.
The offset scales with the surrounding font instead of centering the SVG's bounding
box. This follows MathJax's typesetting model, also used by
[Typora](https://support.typora.io/Math/).
In Live Preview and reading, normal inline SVGs allow accents and overhanging ink
to remain visible. Only formulas wider than their line scroll; scrolling remains
available with the keyboard. See the [local source comparison](../reviews/renderer-polish-review.md).

The bundled MathJax configuration includes base TeX, AMS, newcommand, mhchem,
AMS commutative diagrams, boldsymbol, braket, cancel, cases, mathtools, physics,
textmacros, unicode, upgreek, color, bbox, enclose and extpfeil. See the
[runnable LaTeX gallery](../examples/latex.md) for roots, fractions, sums, integrals,
limits, derivatives, matrices, cases, alignment, tags, sets, vectors, chemistry,
units, diagrams and local macros. The gallery is rendered in automated tests.

This is MathJax's mathematical TeX dialect, not a complete LaTeX document compiler.
Macros are local to one expression; external package loading and HTML commands
are unavailable. Invalid formulas show their source with edit/retry controls, and
unfinished delimiters remain editable Markdown. Existing size and rendering limits
still apply. [MathJax extension reference](https://docs.mathjax.org/en/latest/input/tex/extensions/index.html).

### GitHub

Bare URLs and email addresses are recognized using
[GFM autolink rules](https://github.github.com/gfm/#autolinks-extension-), including
balanced punctuation and trailing-delimiter handling. Application navigation policy
still determines whether a recognized destination is clickable.

An alert begins with its marker on the first line of a blockquote:

```markdown
> [!TIP]
> Use **Markdown** inside the callout.
>
> - Lists and fenced code also work.
```

Supported markers are `[!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]` and
`[!CAUTION]`, following [GitHub's alert syntax](https://docs.github.com/en/get-started/writing-on-github/getting-started-with-writing-and-formatting-on-github/basic-writing-and-formatting-syntax#alerts).
Each renders with a distinct Phosphor icon, text title and theme-aware accent in
preview, reading and export; meaning does not rely on color alone. Exported icons
work offline. Unknown, escaped or incomplete markers remain ordinary blockquotes.

### Typora

Place YAML front matter at the very start of the document, opening with `---` and
ending with `---` or `...`:

```markdown
---
title: Writing across languages
author: Manuslip
tags: [writing, translation]
---

# Start writing
```

With Typora enabled, this block appears as a shaded, monospace header that stays
literal and directly editable in Live Preview. Its delimiters are hidden there and
visible in Source mode. YAML strings cannot affect the
Markdown that follows the closing fence, even without a blank line. It is
excluded from headings, prose word counts, translation requests and rendered reading
or export content. The source metadata is preserved unchanged. With Typora off, the
same text follows ordinary Markdown rules. An unclosed block or a fence later in the
document also follows ordinary Markdown rules. This uses
[Typora's YAML front matter syntax](https://support.typora.io/YAML/).
Metadata values are preserved as source; they do not configure Manuslip or supply
export titles, templates or other export settings. TOML front matter (`+++`) remains
available independently of Typora.

Place `[TOC]` on its own paragraph. The TOC follows source order, nests according to
heading depth (including skipped levels), omits heading attribute syntax and links
to explicit or generated IDs. In Live Preview, clicking a TOC entry moves the caret
to the original heading. The same links work in exported HTML. Translated copies
use translated heading labels without translating the generated TOC separately.
This follows [Typora's TOC convention](https://support.typora.io/Markdown-Reference/#table-of-contents-toc).

Open the [conventions sample](../examples/markdown-conventions.md) to compare the
optional plugins while keeping the source unchanged.

## Verification

The vendored [official corpus](../testing/commonmark-fixtures.md)
contains all 652 examples. Tests compare the base parser's output with their expected
HTML, run every example through the shared application renderer, and verify the
resulting semantic block ranges in the editor. Literal code content stays exact in
these comparisons; application URL/image policies have their own tests.

```sh
npx vitest run packages/renderer/test/unit/commonmark.test.ts packages/editor/test/unit/commonmark.test.ts
npm run build:app
npm run test:e2e -- test/e2e/commonmark.spec.ts
npx vitest run packages/core/test/unit/document-markdown.test.ts packages/renderer/test/unit/conventions.test.ts packages/renderer/test/unit/math-gallery.test.ts
npm run test:e2e -- test/e2e/markdown-conventions.spec.ts
npx vitest run packages/core/test/unit/inline-footnotes.test.ts packages/renderer/test/unit/inline-footnotes.test.ts packages/editor/test/unit/inline-footnotes.test.ts
npm run test:e2e -- test/e2e/inline-markdown.spec.ts
```

Desktop regression cases cover both fence styles, indentation and tabs, unfinished
and empty fences, nested code, language highlighting, source selection, undo, exact
CRLF saving, HTML export and ordered-list numbering. They also check a narrow layout
and retain screenshots in the test output.

Task checkbox regression tests measure every frame across a toggle at desktop and
narrow widths, including nested and ordered tasks, embedded math, keyboard focus
and read-only document locks. The feature matrix exercises all 32 optional plugin
combinations in preview, translated reconstruction and export. See the
[feature availability review](../reviews/feature-availability-review.md) for the complete
review scope, configuration requirements and remaining platform qualifications.
Reading-copy regressions also verify that changing conventions preserves the
captured grammar for layout and export until an explicit refresh.
Inline-note regressions cover scrolling and focus in a long document, list/table
references, repeated named references, keyboard navigation, source editing/undo,
translation and bilingual export. Desktop geometry checks measure the mathematical
baseline against adjacent prose in wide/narrow Live Preview, reading and an actual
exported HTML document, within 0.75 CSS pixels. The gallery includes tall fractions,
integrals, sums, scripts, CJK, headings, quotes and tables, with larger text, dark
theme and 125% zoom. Disclosure tags remain literal with
sanitized HTML both disabled and enabled.
