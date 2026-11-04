# ADR 010: Keep Pandoc optional and explicitly selected

Status: Accepted.

## Context

Word, EPUB and LaTeX export need a conversion toolchain beyond the self-contained
HTML/PDF pipeline. Tool selection must not introduce ambient executable discovery or
let document content choose commands.

## Decision

Require the user to select a trusted local Pandoc 3 executable. Do not bundle, download
or discover it on PATH. Version-probe and fingerprint it; recheck the captured tool before
and after conversion. Main owns paths, selection and process execution.

Expose fixed formats and profiles. Pass prepared sanitized HTML through stdin with fixed
argument arrays, shell disabled, a restricted environment and an owned temporary directory.
Do not expose arbitrary arguments, filters, templates or PDF engines. Preserve prose/tables/
notes as editable content and convert supported math/diagrams to admitted images.

Bound process lifetime, input/output and media. Cancellation retains its admission charge
until the child closes. Validate resulting archive structure and media before atomic
publication. Failures preserve existing destinations and the captured source/reading copy.

## Alternatives and consequences

Bundling the tool would add its distribution/update obligations to every installation.
PATH discovery could execute an unintended binary. Explicit selection keeps conversion
optional but requires users to install a tool and, for LaTeX compilation, a separate
Unicode-capable LaTeX environment. Pandoc is trusted software with the user's OS privileges;
its reader/writer restrictions are not an OS sandbox.

See [Pandoc usage](../guides/desktop.md#export-and-presentation),
[Pandoc contracts](../../apps/desktop/src/shared/pandoc-contracts.ts) and
[optional integration tests](../testing/testing.md#focused-runs-and-fixtures).
