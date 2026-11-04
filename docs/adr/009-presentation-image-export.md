# ADR 009: Reuse captured export snapshots for slides and images

Status: Accepted.

## Context

Presentation and raster export must preserve the selected source or reading copy,
including translations, appearance, math, diagrams and images, while editing continues.

## Decision

Capture revision, language, layout, completed translations and appearance once, after
synchronizing input. Confirm stale or partial reading copies; missing translations retain
source. Reuse the bounded sanitized export pipeline and isolated print process.

Top-level thematic breaks define slides; without them, level-one headings start slides.
Nested content remains content, empty boundaries produce no empty slides and bilingual
rows stay together. Keep visible keyboard-accessible navigation and Exit; dense content
scrolls within a slide. The prepared presentation does not retain preparation workers.

PNG/JPEG captures the complete prepared document. Admit physical dimensions and pixel count
before allocation, verify native image dimensions again and fail oversized output without
cropping. Cancel, closure and failure release hosts and preserve an existing destination.

## Alternatives and consequences

A separate slide renderer would duplicate syntax, assets, translation and security policy.
Viewport screenshots would omit offscreen content. Reusing snapshots preserves output
semantics but requires complete layout/asset readiness and explicit size limits; HTML/PDF
remain available for documents too large for one image.

See [export and presentation controls](../guides/desktop.md#export-and-presentation),
[slide grouping](../../packages/renderer/src/slide-groups.ts) and
[raster limits](../../packages/renderer/src/raster.ts).
