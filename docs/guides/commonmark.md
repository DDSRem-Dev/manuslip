# Markdown support

The base grammar follows [CommonMark 0.31.2](https://spec.commonmark.org/0.31.2/), with the
extensions below. **Preferences → Plugins → Markdown extensions** saves global switches
automatically. Changes affect previews, new reading copies and exports; refresh an existing
reading copy to change its captured grammar. [ADR 006](../adr/006-extended-markdown.md)
defines shared rendering; [workspace guidance](workspace.md#editing) defines Live editing.

## Basic extensions

These work with all optional switches off. Code, escaped markers and unfinished syntax
remain literal. Known fence languages receive highlighting; unknown languages remain code.

| Extension | Syntax and behavior |
| --- | --- |
| Tables | Pipe tables; `:---`, `:---:` and `---:` align columns. Escaped pipes/code spans stay literal. |
| Footnotes | Named: `Text[^id]` and `[^id]: Body`; inline: `Text^[Body]`. Rich formatting, multiple references and return links. |
| Task lists | `- [ ]` / `- [x]`; toggling a rendered checkbox is one undoable source edit. |
| Smart punctuation | Typographic quotes/apostrophes, `--`/`---` dashes and `...` ellipsis; source, code, math and destinations stay unchanged. |
| Heading attributes | ATX/Setext headings accept `{#id .class}`. Invalid or escaped attributes stay text. |
| Superscript / subscript | `x^2^` / `H~2~O`; no whitespace inside delimiters. |
| Emoji | Known `:emoji_name:` shortcodes resolve offline; unknown names stay literal. |
| Front matter | Initial `+++` fences enclose literal TOML metadata. |
| Definition lists | A term followed by `: Description`; supports lists, blockquotes and inline formatting. |

Headings get deterministic Unicode-aware anchors; explicit IDs take precedence and
duplicates receive suffixes. TOCs and fragments share those anchors. Sanitized HTML scopes
IDs and rewrites their links, including table header relationships.

Notes use first-reference numbering and return links for every occurrence. Inline bodies
support balanced/escaped brackets, code, links, math and soft breaks; empty/unfinished notes
stay literal. Click a displayed note body to edit its original source. Translation handles
note prose separately from protected content.

## Optional extensions

| Switch | Default | Syntax |
| --- | --- | --- |
| Opt | On | `==highlight==`, `~~strikethrough~~`, including nested formatting. |
| LaTeX | On | Inline/display TeX and math fences; see below. |
| Mermaid | On | Local `mermaid` diagrams and the bounded legacy subset below. |
| GitHub | Off | GFM autolink literals and alerts. |
| Typora | Off | Initial YAML front matter and standalone `[TOC]` / `[toc]`. |

Each switch controls its syntax independently; disabled syntax follows ordinary Markdown
rules. **Reset extensions** restores these defaults.

### LaTeX

Use `$x^2$` or `\(x^2\)` inline. Display forms are standalone/multiline `$$`, `\[...\]`,
and `math`, `tex` or `latex` fences. Self-contained offline SVG preserves mathematical
baseline/depth; wide formulas scroll with keyboard access. Invalid formulas retain source
and edit/retry controls. TeX remains protected during translation.

Bundled MathJax packages: base TeX, AMS, newcommand, mhchem, AMS commutative diagrams,
boldsymbol, braket, cancel, cases, mathtools, physics, textmacros, unicode, upgreek, color,
bbox, enclose and extpfeil. This is mathematical TeX, not a LaTeX document compiler:
macros are expression-local; external package loading and HTML commands are unavailable.
See the [tested gallery](../../packages/renderer/test/fixtures/markdown/latex.md) and
[MathJax package reference](https://docs.mathjax.org/en/latest/input/tex/extensions/index.html).

### Legacy diagrams

Case-insensitive `sequence`/`seq` and `flowchart`/`flow` fences convert within the isolated
diagram renderer; original source stays editable.

| Kind | Supported subset |
| --- | --- |
| Sequence | Participants/aliases before messages, one title, solid/dashed filled/open arrows, left/right notes and notes over one/two participants. |
| Flowchart | Start/end, operation, input/output, subroutine and condition nodes; multiline labels, edge chains, yes/no branches. |

Comments and blank lines work. Links, styles, parallel nodes, directional ports, unsupported
directives and ambiguous references show source with an explanation. Reading/export use
the same subset and limits.

### GitHub

Bare URLs/email use [GFM autolink rules](https://github.github.com/gfm/#autolinks-extension-).
Alerts start a blockquote with `[!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]` or `[!CAUTION]`:

```markdown
> [!TIP]
> Use **Markdown**, lists and code inside the callout.
```

Each has a text title, offline icon and theme-aware accent. Unknown/escaped/incomplete
markers stay ordinary blockquotes. See [GitHub alert syntax](https://docs.github.com/en/get-started/writing-on-github/getting-started-with-writing-and-formatting-on-github/basic-writing-and-formatting-syntax#alerts).

### Typora

Initial `---` fences enclose [YAML front matter](https://support.typora.io/YAML/).
It stays literal/editable in Live Preview and is excluded from headings, counts,
translation and rendered output. Metadata does not configure Manuslip or export settings.
Unclosed or later fences follow ordinary Markdown rules.

A standalone `[TOC]` / `[toc]` creates a linked outline in source order, including skipped
heading levels and explicit IDs. Live links move the caret to the heading; reading copies
use translated labels. See [Typora's TOC convention](https://support.typora.io/Markdown-Reference/#table-of-contents-toc).

## HTML

Raw HTML displays as source by default. **Render sanitized HTML** enables basic document
markup independently of optional grammar switches. Source always retains authored markup.

| Allowed content | Examples |
| --- | --- |
| Formatting | Bold/italic, underline, strike, insertion, highlight, small text, sub/superscript. |
| Inline semantics | Abbreviations, citations, quotes, keyboard/sample/variable text, dates, ruby, direction and word breaks. |
| Structure | Headings, paragraphs, rules, quotes, lists, code, links, images, sections and figures/captions. |
| Tables | Captions, column groups, row groups, spanning cells and scoped header relationships. |

Allowed titles, language/direction, dates, list numbering and citation destinations survive
sanitization. Scripts, embedded pages, event handlers and document CSS are removed, except
image sizing below. `<details>`/`<summary>` remain literal; Markdown between them still parses.
Inline HTML may surround Markdown; HTML blocks retain literal contents until the block ends.
See [CommonMark HTML blocks](https://spec.commonmark.org/0.31.2/#html-blocks).
Navigation admits HTTPS and document fragments; parsing never grants access by itself.

## Images

Images keep proportions and fit document width. Local paths resolve relative to the saved
file through authorized reads. Remote images require both **Load remote images** and the
current document's permission.

With sanitized HTML enabled, `<img>` retains numeric `width`/`height` and safe inline
`width`, `height` and `zoom`, including `style="zoom:50%;"`. Other inline CSS is discarded.
Sizing carries through reading/export. Loading or blocked images show alt text and status;
failures offer Retry. Successful reads still wait for decoding.

Use the [conventions sample](../../test/e2e/fixtures/markdown/markdown-conventions.md) for syntax
and the [testing guide](../testing/testing.md) for conformance coverage.
