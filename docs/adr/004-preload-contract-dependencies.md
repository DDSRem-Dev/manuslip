# ADR 004: Keep preload contracts independent of Markdown parsers

Status: implemented; local Windows validation recorded on 2026-10-30.

## Problem

The sandboxed preload needs translation settings, provider metadata and payload
validation. Importing these through the translation package's root entry point also
initializes the Markdown parser. The settings and payload modules compound this by
importing a byte-counting helper through the core package's parser-bearing root.
The default preload consequently contains 538,758 bytes of code, including parser
initialization that the bridge does not use.

## Decision

Expose `@manuslip/translate/transport` as a public entry point for transport types,
translation limits, settings normalization, payload validation and provider metadata.
Shared translation and reading-export contracts consume that entry point. Translation
modules that only need `utf8Bytes` use the existing `@manuslip/core/text` entry point;
AST types remain type-only imports from core.

The public root entry points retain extraction, reconstruction and parsing. The new
entry point re-exports the existing implementations and objects. It introduces no
duplicate validators or alternative payload behavior.

The preload build now rejects rendered modules from core's parser/compiler,
mdast-util-from-markdown, micromark and unified. It checks the emitted module graph,
normalizing Windows separators, so a future import that pulls the parser back into
the preload fails the build. The decision does not depend on a package-wide claim
that modules have no side effects.

## Evidence

The default preload falls from 538,758 to 50,637 bytes, a 90.6% reduction. The source
capture contains 241 transformed files before and 23 after. Emitted chunk module
entries fall from 167 to 20; these counts include zero-length facade entries and
do not count independently executed initializers. Captured bundles exactly match
their corresponding default build output. The build guard rejects the retained
before graph and accepts the current graph.

An executable-body comparison of the five edited implementation modules is equal
after removing imports and type declarations. All five runtime exports from the new
entry point have the same identities as the root exports. The package manifest has
one additive export; dependency versions and the lockfile are unchanged.

Fourteen native sandboxed Electron windows load the original before/after bundles
against the same empty local HTML. Chromium's script-parsed events identify the
requested preload in every window, all 54 bridge field names/types match, and
sandbox/context isolation remain enabled with Node integration disabled. After two
warmups, six alternating pairs average 71.12 ms before and 65.77 ms after for window
creation through HTML load. This small diagnostic excludes application bootstrap,
the editor and UI; it does not establish application startup or any p95 target.

Validation passes:

- `npm run check` and 19,421 unit tests across 212 files, with one existing Windows
  POSIX-permissions skip; the focused contract/translation run passes 2,724 tests.
- Two complete default builds produce identical bytes for all 247 runtime files.
  Every renderer output path and byte matches the preceding compiler increment.
- A fresh Windows directory package passes all 102 integration cases without skips,
  retries, failures or flaky outcomes. An independent process observation identifies
  the new executable during application-helper cases. Dedicated Electron fixtures
  continue to use their own entry points.
- All 9,660 ASAR files are checked: 558 current application/source/manifest files,
  eighteen parser pins, three unpacked files and the remaining retained dependencies.
  The complete package directory is inventoried.
- The retained compiler increment's native proof rechecks all 119 evaluated sources
  and parser bindings against current bytes. Its 6,756 fixed-clock and 6,756
  active-clock complete comparisons and 158 lifetime observations remain applicable
  to those unchanged inputs; these are retained runs, not fresh parser runs.

Proof and repeatable checkers reside in ignored `/test/artifacts/logs/preload53-*` and
`/test/artifacts/logs/verify-preload53-*.mjs`. The fresh executable is
`test/artifacts/logs/preload53-package/win-unpacked/Manuslip.exe`. Existing installers and other
platform artifacts retain their earlier implementations and validation.

## Limits and follow-up

The first graph capture missed sources because of path separator handling; the
corrected capture retains all inputs. The first guarded build exposed a second root
import in reading-export contracts, which now uses the public transport entry point.
An initial native fixture assumed Electron exposed the preload path in returned
preferences. A second fixture waited on debugger enable before navigation and was
stopped after live Inspector observation confirmed a pending blank window. The
successful fixture enables the debugger after navigation. Failed artifacts remain.

[ADR 002](002-implementation-plan.md) remains authoritative and unchanged. Items
01–14, complete nested-document Live acceptance, physical/aggregate memory and p95
gates, remaining M1–M4 features, UI/input/accessibility checks, physical platform
validation and signing/distribution remain open. This dependency change establishes
no semantic transport activation, larger resource budget or full application acceptance.
