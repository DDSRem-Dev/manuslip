# ADR010: Optional local Pandoc export

Status: accepted on the Windows baseline for ADR002 item25; broader platform acceptance remains separate.

Document actions offers Export with Pandoc for the selected source revision and
Export reading with Pandoc for a captured reading copy. The dialog explicitly selects
Word (.docx), EPUB (.epub) or LaTeX source with images (.zip), and Standard or Numbered
headings + contents. A stale or incomplete reading copy still requires confirmation.
Later source edits, translations, layout changes and dialog choices cannot change a
captured job. Export never edits source, selections or undo history, or requests translation.

Pandoc is optional, external and never downloaded or discovered on PATH by the application.
Choose a trusted Pandoc 3 executable with the native file picker. Selection hashes a bounded
regular executable and probes its version with a five-second deadline. Only the basename
and version reach the renderer; paths and fingerprints remain in main. Change application,
Forget application and Retry save are explicit actions. Atomic profile persistence detects
outside changes; corrupt settings retain a backup and future schemas remain read-only.
Failed persistence keeps the session choice available with a visible retry. Closing or
superseding a picker/probe cannot install its late result.

Main captures the selected tool before destination selection and checks its fingerprint
before and after conversion. A changed or missing tool requires a fresh explicit choice.
The executable is user-trusted software with the user's OS privileges. Pandoc's reader/writer
sandbox limits its own file access; it is not an operating-system sandbox for that executable.
Arguments are fixed arrays with shell disabled, HTML input on stdin and output on stdout.
There are no arbitrary arguments, filters, templates, defaults, PDF engines or shell commands.
The child uses an owned temporary directory and a restricted environment. No document body,
private path or child diagnostics is exposed in an error message or application log.

The existing export parser, asset resolver and isolated print renderer prepare sanitized
content. Math, chemistry and diagrams are captured as PNGs using bundled fonts, with physical
dimensions and aggregate decoded-image admission checked before allocation. GIF/WebP images
are normalized to PNG. Bilingual side-by-side pairs become two-column document tables;
interlinear pairs receive visible source/translation labels. Text, tables and notes remain
editable. DOCX, EPUB and LaTeX use their own document styles; imported CSS is not preserved
as a word-processor theme. LaTeX output includes document.tex, media and a README; compiling
it requires a separate Unicode-capable LaTeX toolchain and suitable fonts.

The existing two-MiB source and asset limits remain. Prepared HTML is capped at 16 MiB,
output at 160 MiB, stderr at 64 KiB and executable size at 256 MiB. Version output is capped
at 16 KiB. Conversion uses a 60-second deadline, a 512-MiB Haskell heap limit and at most
1,200 media slots. Cancel, owner closure, timeout, pipe failure and overflow terminate the
child; the job remains charged until the child closes. An inspector in the existing
terminable export worker validates complete ZIP directories, sizes, paths, decompression
bounds and CRCs, plus required DOCX/EPUB structures and every expected image. LaTeX media
must be bounded regular files referenced by the generated source. Native destination
fingerprints and atomic publication preserve existing output on error or cancellation.

Pandoc 3.13 lacks some built-in label translations, including Chinese. Conversion accepts
only its exact bounded missing-translation and known missing-label warnings; any other
diagnostic still fails. Numbered profiles explicitly set the English or Chinese contents
title. This does not claim every generated label is localized for every document language.

Validation uses a separately acquired, checksum-verified official Pandoc 3.13 executable.
Set MANUSLIP_TEST_PANDOC to a trusted local executable before npm test and the native desktop
suite to include actual conversion cases; those optional cases explicitly skip without it.
Unit tests cover process lifetimes, limits, tool/profile races and malformed containers.
Native flows cover both UI locales, all formats and reading layouts, stale-copy confirmation,
editable content, media, source bytes, multiple selections, undo and narrow accessibility.
Other platforms and external Word/ebook/LaTeX applications require their own acceptance.
