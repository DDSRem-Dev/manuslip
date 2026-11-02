# Definition lists with GFM tables

micromark-extension-definition-list 2.0.2 documents that a colon-prefixed table body row
interrupts the table and becomes prose. Its document construct accepts `tableHead` and
`tableRow` as possible definition terms, including committed body rows. Conversely,
rejecting every table token also rejects a real term after a table: GFM first tokenizes
that line as a tentative header until the following line disambiguates it.

The pinned patch accepts a table token as a term only when it belongs to an unfinished
header. It inspects the current row's matching enter event and its preceding header;
it does not repeatedly scan backwards through a large table. Paragraph/chunk-content
handling remains upstream. The patch also treats micromark
`listItemIndent` prefixes like existing blockquote prefixes so definitions can nest in
ordered and unordered list items. Both default and development
builds receive the same fix. `scripts/patch-definition-list.mjs` checks the exact original
and patched SHA-256 values and rejects unknown versions or changed dependency sources.
Install applies it; lint and app build require it. The package's MIT license is retained.

Source: [upstream implementation and known issue](https://github.com/wataru-chocola/micromark-extension-definition-list).
The npm 2.0.2 archive, adverse alternatives and complete-AST differential prototype are
retained in /test/artifacts/logs/ for iteration97. Core tests compare complete trees and positions for
colon cells, alignment delimiters, nested tables, blank lines and ordinary definition
lists, then compare the public and private compiler. Strict CommonMark is unaffected.
