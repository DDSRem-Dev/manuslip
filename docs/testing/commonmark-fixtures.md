# CommonMark 0.31.2 fixtures

`spec.json` is the unmodified official example corpus downloaded from
<https://spec.commonmark.org/0.31.2/spec.json> on 2026-10-23.
The specification and examples are copyright John MacFarlane and licensed
CC-BY-SA 4.0; the upstream `LICENSE` is included alongside the corpus.

The conformance test uses the CommonMark base of the same unified/remark parser
used by the application, with extension syntax disabled. It compares normalized
HTML trees before Manuslip's deliberate URL/HTML security restrictions.
The application renderer also processes every example, comparing structure and literal
content while leaving URL/image-loading attributes to the separate security-policy
tests. Editor integration tests check that semantic blocks from every example can
mount in Live Preview, including indented fences and nested containers, without
changing source text. Desktop tests additionally cover highlighting, source selection,
editing, undo, newline-preserving saving, export and ordered-list numbering.

Application GFM, frontmatter, math, global references and security policies have
separate tests. This corpus is test data and is not bundled in the desktop app.
