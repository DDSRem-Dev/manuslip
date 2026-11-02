# ADR009: Presentation snapshots and raster export

Status: accepted on the Windows baseline for ADR002 item24; broader platform acceptance remains separate.

Document actions provides Present document, Export PNG and Export JPEG. Translated
preview provides the corresponding reading-copy actions. Each action captures the
selected source revision, language, bilingual layout, completed translations and
document appearance once. Stale or incomplete reading copies require confirmation;
their missing units retain source text. Editing and translation results arriving
later do not change a running job. Composition is synchronized before capture.

Presentation uses top-level thematic breaks as explicit slide boundaries. When
there are no breaks, level-one headings start slides; text before the first heading
forms its own slide. Leading, trailing and repeated breaks create no empty slides.
Breaks or headings inside lists, quotes and fences remain content. A bilingual row
stays together, including its source and translation. Prepared nodes move without
duplicating reference IDs; fragment links can reveal another slide. Empty documents
and more than 200 slides receive explicit errors without changing source.

Slides open full screen in the existing sandboxed, separate-process print renderer.
Previous/Next, arrows, Page Up/Down, Space, Home and End navigate; Escape and the
visible Exit close the view. Dense content scrolls within the slide. Controls wrap
at narrow widths, have visible keyboard focus and localized accessible names, and
remain outside imported document CSS. Closing returns to the same editable document,
selections and undo history. A presentation has no viewing deadline after preparation;
the worker, diagram renderer and asset resolver are released before viewing begins.
Cancel, document/window closure and renderer failure dispose its window and job.

PNG and JPEG capture the complete prepared snapshot at a 1,024 CSS-pixel content
viewport. Image admission checks device scale, 8,192 pixels per physical side and
16 million physical pixels before resizing or native capture. Oversized or unstable
layout fails explicitly rather than cropping. Native image dimensions are checked
again before encoding; JPEG uses quality 92. The existing 160 MiB output cap remains.
HTML/PDF are available for documents too long for one image.

Preparation reuses the existing bounded source/reading parser, sanitized HTML/SVG,
local and explicitly enabled remote image resolution, offline fonts, formulas and
diagrams. The print renderer retains its isolated session, restrictive CSP and
denied network, navigation, permissions and Node access. Raster capture stays hidden.
There is no new dependency, preload method or renderer filesystem capability.

Native destination selection, owner/document validation, destination fingerprint
checks, atomic writes, cancellation and preparation deadlines remain in force.
PNG uses .png; JPEG accepts .jpeg or .jpg. A rejected or cancelled job preserves the
previous destination. Source bytes and the active editor are never rasterized back
into Markdown.

Acceptance includes real native slide navigation and exit, dense content, bilingual
layouts and footnote navigation, source/selection/undo fidelity, local image and
formula/diagram preservation, actual PNG/JPEG signatures and complete-content
dimensions, pre-allocation limits, previous-file preservation, crash/retry and
localized narrow accessibility checks. Platform acceptance and application completion
are recorded separately in VALIDATION.md.
