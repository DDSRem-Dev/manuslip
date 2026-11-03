# Manuslip documentation

Start with the [project overview](../../README.md) or [contribution guide](../../CONTRIBUTING.md).
Run development and test commands from the repository root.

| Area | Documents |
| --- | --- |
| Using Manuslip | [Markdown conventions](../guides/commonmark.md), [local command plugins](../guides/plugins.md), [file sync](../guides/sync.md), [LaTeX gallery](../examples/latex.md), [Markdown sample](../examples/markdown-conventions.md) |
| Product and design | [Desktop product](../product/desktop.md), [desktop design](../design/desktop.md), [workspace design](../design/workspace.md) |
| Development | [Dependency compatibility](../development/dependencies.md), [application icons](../development/application-icons.md), [fonts](../development/fonts.md), [native Linux fonts](../development/native-fonts.md), [offline dictionaries](../development/offline-dictionaries.md), [distribution](../development/distribution.md) |
| Testing | [Test layout and commands](../testing/testing.md), [benchmark methods and evidence](../testing/benchmarks.md), [CommonMark fixtures](../testing/commonmark-fixtures.md) |
| Architecture | [Decision records](../adr/), [translation](../architecture/translation.md), [semantic native construction](../architecture/semantic-native-construction.md), [worker failure handling](../architecture/semantic-worker-failures.md) |
| Reviews | [Feature availability](../reviews/feature-availability-review.md), [accessibility](../reviews/accessibility-review.md), [interface](../reviews/interface-review.md), [renderer polish](../reviews/renderer-polish-review.md), [tables](../reviews/table-rendering-review.md), [navigation](../reviews/navigation-review.md) |
| Dependency patches | [Definition lists](../patches/definition-list.md), [micromark edit map](../patches/micromark-edit-map.md), [micromark replay](../patches/micromark-replay.md), [parser lifetimes](../patches/parser-lifetimes.md), [unist traversal](../patches/unist-visit.md) |
| Validation history | [Chronological implementation and validation record](../validation/implementation-history.md), [repository layout validation](../validation/repository-layout.md), [commit-by-commit history reorganization](../validation/history-reorganization.md) |

See the [repository layout policy](../development/repository-layout.md) for placement rules.

## Where to put documentation

Put substantive documentation in `docs/<topic>/` with a lowercase kebab-case filename.
Use `guides/` for user instructions, `development/` for contributor workflows, `testing/`
for test methods, `architecture/` and `adr/` for engineering decisions, `design/` and
`product/` for product specifications, `reviews/` for findings, `patches/` for dependency
patch provenance, and `validation/` for dated evidence. Keep examples in `examples/`.
Link new documents from this index or another relevant guide.

The root READMEs, `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, and GitHub's
pull request template retain their standard discovery names. Upstream licenses and notices
remain beside their assets. Screenshots and machine reports belong in test artifact
directories; link them from prose when they help explain a result.

Record validation submissions chronologically and distinguish observed results from
remaining acceptance work. Earlier results in the history describe the revision and
platform tested at that time; use the testing guide for current commands and paths.

`npm run check:layout` checks documentation placement, local Markdown links, test
placement, obsolete root output directories, and stray UUID metadata in source directories.
