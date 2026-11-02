# P0 interface review

Scope: the shell entry/preferences flow, including loading/retry and save-error markup,
English/Chinese text, light/dark/system theme configuration, future-version read-only settings,
corrupt-setting recovery, and narrow layout. React 19, native HTML controls, CSS semantic tokens.
Conventions inspected: `CONTRIBUTING.md`, `SECURITY.md`, ADR 002. Editing and later feature
surfaces are outside this review. This is a screen/flow review, not a branch review.

| Domain | Evidence inspected | Result |
| --- | --- | --- |
| Accessibility | Native labels/selects, focus and skip navigation, status/error regions, read-only explanation | Clear for inspected behavior; screen reader not verified |
| Layout | 1160px and 320px reflow, 200% zoom, wrapping rows, logical spacing | Clear |
| Writing | English/Chinese resources, loading/error/recovery/read-only copy, saved status | Clear |
| Typography | System UI and serif heading, descending heading scale, line height, wrapping, no hidden truncation | Clear |
| Colors | Computed foreground/background pairs in Electron E2E, both themes; semantic CSS variables | Clear |
| UI | Native control states, 40px control targets, visible focus, simple borders, no animation | Clear |

No actionable interface findings.

## Verification

- `npm run test:e2e` / `npm run test:packaged`: preferences, corruption/recovery and future
  read-only states; 320px reflow, native 200% zoom, focus/skip navigation, contrast checks passed.
- Light/dark screenshots inspected. Muted text: light paper 5.73:1, light sidebar 5.25:1,
  dark paper 7.69:1, dark sidebar 6.75:1. Focus token against paper: light 6.86:1, dark 9.96:1.
- Source inspection: controls have native labels, errors offer retry paths, long labels can
  wrap, and there is no motion or auto-playing content.
- Not verified: screen-reader walkthrough, forced-colors mode, macOS/Linux native controls.
  Loading/transport-failure markup was inspected in source; transport failure is not injected
  into the rendered UI test.

Approve for the inspected P0 flow and evidence above. This is not a general accessibility
certification or approval of unimplemented features.

## M1a source/file flow review — 2026-10-23

Reviewed New/Open, the source editor, dirty/saving states, Save As/Copy, external conflicts,
encoding confirmation, newline normalization, native close/quit decisions, recovery offers,
restored drafts, and the preferences dialog while editing. Both locale resources and native
dialog copy were inspected. Source text remains visible after cancellation or errors.

The editor has a labeled textbox, visible keyboard focus, line/column and encoding/newline
status, plain-language conflict actions, and explicit confirmation before destructive choices.
Preferences preserve the mounted source view and return focus via native dialog behavior.
Syntax colors use theme tokens; computed text contrast passed 4.5:1 in both themes. Native
200% zoom reflows the toolbar and keeps the editor and Save action visible without horizontal
page overflow. Chinese editor/search labels are verified after a language change.

Light/dark source and recovered-draft screenshots were inspected. Found and fixed: the stock
syntax palette did not provide a theme-specific contrast guarantee, so the source editor now
uses explicit semantic color tokens. Preferences and recovery use existing surfaces and native
controls; no motion was added.

Not verified: screen-reader walkthrough, forced colors, physical IME composition, and
macOS/Linux native dialogs. This review covers the implemented source/file flows only.

## Initial M1b Live Preview review — 2026-10-23

Inspected the rendered Windows preview screenshot, both locale resources, native image
permission text, pressed mode controls, source-reveal buttons, task checkbox labels,
pending/error/retry states and resource-limit Source fallback. The existing paper/surface,
focus and syntax tokens are reused. Live prose uses a readable UI face; source and code retain
monospace. Sanitized table/code widgets use restrained borders and direct source actions.
Word counts appear only for the current semantic revision. No motion was introduced.

Electron checks cover selection/undo through mode changes, keyboard find after localization,
native image permission cancellation/allow/revocation, raw HTML opt-in and failure Retry.
Source-mode contrast and 200% reflow remain tested separately. A hidden empty decoration span
is expected in Live mode, so the source-only syntax-color check explicitly selects Source.

Remaining review: full Live-mode 200%/narrow and both-theme walkthrough, assistive technology,
physical IME, large formula/table overflow and native platform differences. This evidence
does not certify accessibility or close M1b acceptance.

## M2 tab flow review — 2026-10-23

Scope: New/Open → activate/reopen a tab → close a tab or cancel closing the window. This
screen/flow review covers the tab strip, active editor context, native close decisions,
busy states and localized file/tab-limit error copy. Conventions remain React/native controls,
existing CSS semantic tokens and the source-first file lifecycle in CONTRIBUTING/ADR 002.

| Domain | Evidence inspected | Result |
| --- | --- | --- |
| Accessibility | Labeled tab/close controls, selected state, roving tab focus, arrows/Home/End, keyboard close, visible 2px focus perimeter, cancellation | Passed inspected keyboard flow; screen reader and forced colors not verified |
| Layout | Long filename, four tabs, horizontal tab scrolling, 320px Chinese layout and native 200% zoom; active full filename/path wraps below tabs | No clipped action or page-wide horizontal overflow in inspected states |
| Writing | EN/Chinese untitled numbering and close labels; recoverable tab-cap and Save As collision messages; native save/discard/cancel and file context | Clear for inspected actions; tab-cap notice checked in source/unit tests |
| Typography | Existing system type, 13px tab controls, filename truncation with full name/path in active heading and native title tooltip, bidi-isolated tab names | Readable within inspected flow |
| Colors | Computed tab and close-button foreground/background contrast in both themes, tested at least 4.5:1; existing selected underline/focus tokens | Passed measured text pairs; selection also uses a surface and underline |
| UI | Existing surfaces/radii, 40px-high targets, explicit close glyph, selected tab styling, busy-state disabling; no motion added | Consistent with current desktop chrome |

Inspected light/dark and narrow-Chinese screenshots generated by `tabs-ui.spec.ts`. No actionable
findings remain within this inspected flow. This does not certify the entire editor, screen-reader
behavior, physical IME switching, platform dialogs or retained-memory behavior.

The final regression check invokes the native Close document menu command while preferences
are modal, then creates a document and reopens preferences. Closing the last tab now resets
the dialog state. Synthetic Playwright key events are not proof of OS accelerator delivery;
native menu binding and callback execution are checked separately from tab-strip keyboard use.

## M2 workspace flow review — 2026-10-23

Scope: choose a folder → expand and open a file → Refresh or select a recent folder → restart
and resolve unavailable files. Inspected the existing React/native disclosure controls, shared
theme tokens, EN/Chinese copy and Windows screenshots from `workspace.spec.ts`.

| Domain | Evidence inspected | Result |
| --- | --- | --- |
| Accessibility | Labeled navigation, native disclosure keyboard behavior, named file buttons, visible focus, loading/status and Retry actions | Passed inspected keyboard flow; screen-reader behavior remains unverified |
| Layout | Scrollable desktop sidebar, wrapped root/recent paths, bounded narrow disclosure, Chinese at 320px and native 200% zoom | No page-wide horizontal overflow or overlapping actions in inspected states |
| Writing | Folder selection, missing root/files, retry/removal, persistence failure, truncated listing and excluded links in both locale resources | Actions describe their effect; removal explicitly concerns the session |
| Typography | Existing system face, 13px browser controls, 12px full paths, wrapping filenames and logical indentation | Consistent with current chrome; long paths remain available |
| Colors | Computed browser button/disclosure/path text pairs in both themes, minimum 4.5:1 | Passed measured pairs; native disclosure also communicates expansion without color |
| UI | Existing surfaces, 40px folder/file targets, independent sidebar scrolling, recent-folder controls and busy disabling; no new motion | Consistent with the implemented file lifecycle |

Inspected light, dark-Chinese and narrow-Chinese screenshots. Expanded Files at narrow width
uses a bounded internal scroll region; collapsing it returns space to writing. No actionable
findings remain for these inspected states. Physical IME, forced colors, assistive technology
and native macOS/Linux behavior remain unverified; this review does not close those gates.

## M2 external-open flow review — 2026-10-23

Scope: launch/drop a file → preserve the current draft → retry or dismiss a failed open.
Reviewed the React notice component, existing semantic CSS tokens, both locale resources and
Windows rendered states from `incoming.spec.ts`. This applies the six `better-interface` domains
to this flow, including the layout correction found during the review.

| Domain | Evidence inspected | Result |
| --- | --- | --- |
| Accessibility | Named section, stable polite status region, visible-text-inclusive button names, native buttons, 2px focus, Tab from Retry to Dismiss | Passed inspected keyboard flow; screen readers/forced colors not verified |
| Layout | Long file path, notice scroll limits, Chinese at 320px and native 200% zoom; status/footer geometry | Passed after fixing vertical compression; scrollbars cue content beyond the viewport |
| Writing | Opening status, unavailable/read failure guidance, overflow/unsupported types and non-destructive dismissal in EN/Chinese | Instructions address opening the requested file and include a recovery action |
| Typography | Existing 13px UI face, wrapped full paths, bidi isolation, existing control sizing | Readable in inspected light/dark/narrow states |
| Colors | Computed notice text/button pairs against actual backgrounds, minimum 4.5:1 in both themes | Passed measured pairs; messages and actions carry meaning independently of color |
| UI | Existing surfaces/borders, 40px controls, busy disabling, no new motion | Consistent with the existing file and recovery notices |

| Severity | Domain | Location | Before | After | Why |
| --- | --- | --- | --- | --- | --- |
| HIGH, fixed | Layout | `apps/desktop/src/renderer/src/styles.css:146`, `:380`, `:400` | At 320px with a wrapped failure notice, editor status compressed into the footer | Keep chrome from shrinking and allow the writing region to scroll; measured status ends above footer | Controls and status must remain readable under constrained height |

`npm run test:e2e` passed all 22 flows, including the existing editor scroll/locale cases and the
new status/footer geometry assertion. Inspected `incoming-light.png`, `incoming-dark.png` and
`incoming-narrow-chinese.png`. No actionable interface findings remain within the inspected flow.
Approve for this scope. Physical OS input, screen readers, forced colors and other platforms
remain Not verified; this review is not general accessibility certification.

## M2 navigation and spelling flow review — 2026-10-23

Scope: choose a folder → filename/text search → open/jump or recover from a stale result;
Source/Live outline → heading jump → edit/undo; Preferences → offline spelling → native
correction/undo → restart or write failure/retry. React/native controls, existing CSS tokens,
CONTRIBUTING and ADR 002 remain the conventions. This is a flow review using all six
`better-interface` domains, not a review of uninspected application surfaces.

| Domain | Evidence inspected | Result |
| --- | --- | --- |
| Accessibility | Native labeled search form/disclosures, stable result status, named result/heading buttons, 2px input focus, keyboard disclosure/jumps, search menu focus, disabled stale headings, spelling hint association | Passed inspected keyboard/control flow; screen readers and forced colors not verified |
| Layout | Long relative paths/snippets, 207-heading paging, result paging/truncation, scrollbars, error notice, modal spelling controls; Chinese at 320px and native 200% zoom | No clipped or unreachable control in inspected final states; shortcut scrolls its input into view |
| Writing | Saved-file scope/encoding exclusions, empty results with next step, limits, missing-binary/session/stale-result recovery, English-only vs system-language spelling, opt-in and unavailable-dictionary guidance | Clear for inspected actions; missing-dictionary/binary copy additionally checked in source/unit tests |
| Typography | Existing 12/13/14px desktop metadata/control/body styles, inherited 1.5 line-height, wrapping/bidi-isolated paths/headings, snippet clamp with full excerpt/title and file opening, tabular status digits | Consistent with current desktop chrome; full source remains reachable |
| Colors | Computed actual text/background pairs in search/outline and Preferences, both themes | Search/outline minima 5.25:1 light / 6.75:1 dark; Preferences 5.73:1 / 7.69:1, above required 4.5:1 |
| UI | Existing surfaces/radii, 40px targets, result and heading paging, busy states, pending preference choice and rollback; no motion added | Consistent with existing controls; actual native suggestion callbacks and undo checked |

| Severity | Domain | Location | Before | After | Why |
| --- | --- | --- | --- | --- | --- |
| MEDIUM, fixed | Accessibility | `apps/desktop/src/renderer/src/WorkspaceSearch.tsx:19` | Search shortcut focused the disclosure while a folder was loading, then left the input unfocused | Follow the pending focus request when the root arrives; scroll the focused target into view | Keyboard lookup should reach its query directly, including after asynchronous admission |
| MEDIUM, fixed | UI | `apps/desktop/src/renderer/src/App.tsx:111` | A controlled checkbox briefly returned to its previous state during persistence | Retain one pending settings choice, commit on success, roll back with an error on failure | A preference control must reflect the requested action while its write is pending |

Verified with `navigation.spec.ts` and `settings.spec.ts`, including an actual native context
event, correction and undo under offline emulation, stale dirty-buffer protection, menu focus
from Preferences, source heading jumps/undo, empty/limit states, restart, failed preference
writes and retry. Inspected `navigation-light.png`, `navigation-dark.png`,
`navigation-narrow-chinese.png`, `spelling-preferences-light.png` and
`spelling-preferences-narrow-chinese.png`. The native suggestion popup is intercepted by the
test to invoke its real callback; its OS-rendered appearance was not visually inspected.

No actionable interface findings remain within the inspected flow. Approve for this scope.
Physical keyboard/IME, macOS/Linux spelling delivery, assistive technology, RTL mirroring and
forced colors remain Not verified; no general accessibility certification is claimed.

## M2 clipboard and local images — 2026-10-23

Reviewed native HTML/image paste, Save As cancellation, paste progress/errors, local
image failures/retry, undo retention and asset resolution after Save As.

| Domain | Inspection and evidence | Result |
| --- | --- | --- |
| Accessibility | Native retry buttons retain original image alt text; separate readable errors, keyboard focus, status/alert semantics, cancellation and plain-text fallback | Clear in inspected flow |
| Layout | Error copy and retry controls wrap; English/Chinese at 1160px and 320px, native 200% zoom; loaded-image geometry remeasured | Clear |
| Writing | Missing, unreadable, linked, outside-grant and unsupported-image guidance; failed/oversized paste explains plain-text fallback; cancelled Save As preserves source | Clear |
| Typography | Existing editor/system type, wrapping errors and button labels, no added truncation | Clear |
| Color | Retry text contrast 13.64:1 light and 13.55:1 dark; muted errors use existing verified tokens; explicit accent focus ring | Clear |
| UI | Local images work with remote-image permission off; retry after restoring a file; previews refresh after Save As; undo retains imported files | Clear |

Fixed findings: preserving the original image alt text makes failure and retry accessible
without replacing its name; file-specific errors avoid suggesting document-save actions
for a missing image. Explicit retry focus styling wins inside CodeMirror. Save As now
recreates widgets against the destination folder instead of retaining decoded old images.
The full packaged suite exposed an intermittent narrow search-focus displacement after
layout changes; an IntersectionObserver now scrolls only while the query retains focus.
Both navigation scenarios passed three additional packaged repetitions after the fix.

Verified with clipboard-assets.spec.ts and the existing preview-security flow. Inspected
local-image-light.png, local-image-dark.png, local-image-narrow-chinese.png and
clipboard-local-images.png. Native OS clipboard PNG encoding is validated by decoded
pixels; the original compressed encoding can change during the OS clipboard round trip.

No actionable findings remain in this inspected flow. Physical clipboard/IME providers,
screen readers, forced colors, macOS/Linux and RTL remain Not verified. Approval is limited
to these inspected interactions.

## M2 Mermaid diagrams — 2026-10-23

Reviewed the complete preview flow: cold first render, theme changes, syntax/configuration/
node-limit errors, retry, source editing, undo, watchdog failure and recovery. The existing
React/CodeMirror layout and semantic tokens remain the design system for these controls.

| Domain | Inspection and evidence | Result |
| --- | --- | --- |
| Accessibility | Diagram image label and separate Edit source control; loading/error status; native Retry button; keyboard retry preserves focus; explicit 2px focus ring | Clear in inspected flow |
| Layout | Bounded scrollable source fallback, wrapped error text; 320px Chinese and native 200% zoom; SVG geometry and label separation assertions | Clear |
| Writing | Distinct syntax, configuration, complexity, timeout, stopped-process and repeated-failure guidance; original source retained | Clear |
| Typography | Existing editor/system fonts; readable fallback code, wrapping status and button labels | Clear |
| Color | Retry text contrast 13.64:1 light and 13.55:1 dark; theme-specific graph colors; explicit focus indicator | Clear |
| UI | Lazy render, theme refresh, cancellation, unchanged source/undo, one running job; actual hung process terminated and manual retry succeeds | Clear |

Fixed findings: the fragment-only URI policy originally removed SVG geometry as well as
URLs; explicit geometry/presentation admission now preserves paths and transforms while
references stay local. Computed styles are captured before classes are removed. Large
error fallbacks scroll within a bounded area. Retry restores focus to its replacement
button after failure, and to Edit source after successful recovery when focus stayed in
the loading status. Per-copy SVG IDs prevent cached diagrams from sharing references.

Inspected diagram-light.png, diagram-dark.png, diagram-error-light.png,
diagram-error-dark.png, diagram-narrow-chinese.png and diagram-zoom-chinese.png.
The packaged diagrams.spec.ts covers seven diagram families, preserved source/history,
configuration/node rejection, denied host resources/popups, separate PID/session, real
hang recovery and interface states. User-supplied graph styling can change diagram colors;
arbitrary styled diagrams were not contrast-audited. Screen readers, physical IME, forced
colors, RTL and macOS/Linux remain Not verified. Approval is limited to this flow.

## M2 HTML/PDF export — 2026-10-23/24

Reviewed source capture, destination selection/cancellation, asynchronous completion,
later edits, invalid resources/math, page-cap rejection, hung print rendering, cancellation
and fresh retry. Existing file actions, semantic color tokens and native controls own the
interface. Export actions share the file toolbar and wrap with it.

| Domain | Inspection and evidence | Result |
| --- | --- | --- |
| Accessibility | Named fieldset, native buttons, live status/alerts, composition guard, keyboard cancellation; focus returns to Export HTML when an export control disappears, while editor focus stays with ongoing editing; math uses its TeX as a label | Clear in inspected flow |
| Layout | Toolbar wrapping, full-row status with path wrapping; 320px Chinese and native 200% zoom without horizontal document overflow; independently opened HTML fits its page | Clear |
| Writing | Visible loading/cancel/success/error states; plain-language notice for later edits excluded from the copy; separate image, rendering, resource and page-limit guidance in English/Chinese | Clear |
| Typography | Existing UI/system fonts and 13px status; export 16px/1.65 body, separated headings, bordered tables, wrapped monospace code; SVG math/chemistry and graph labels inspected | Clear |
| Color | Inherited text on paper, light/dark contrast assertions above 4.5:1; fixed light output with underlined links | Clear |
| UI | Editing and saving remain usable during export; Cancel stops an actual infinite loop in the separate print renderer; no output on failure; next export succeeds | Clear |

Fixed findings: export buttons originally added a separate toolbar row; grouping them with
file actions preserves document space. A disappearing Cancel button now restores focus only
when focus stayed in that action group. Math labels now preserve TeX rather than internal slot
IDs. Asset IPC failures now show image-specific guidance. Messages describe excluded later
edits without exposing internal revision numbers. The standalone artifact screenshot test
uses a visible, unthrottled verification window so its paint can complete reliably.

Inspected export-document.png, export-error-light.png, export-error-dark.png,
export-narrow-chinese.png and export-zoom-chinese.png. The HTML artifact is opened independently
and its image/inline SVG geometry checked. Generated PDF checks include page count, embedded
raster image and Unicode font mapping. PDF is fixed A4/20mm and code has no syntax colors;
arbitrary long tables/graphs and every installed font have not been visually reviewed.
Physical screen readers, forced colors, RTL, physical IME, and macOS/Linux remain Not verified.
Approval is limited to this inspected flow.

## M3 provider preferences — 2026-10-24

Scope: the complete provider-preferences flow in the welcome page and native Preferences
dialog: lazy loading, connection/languages/options, invalid endpoint/glossary, saved state,
session keys, unavailable OS key store, key removal, cache confirmation/cancel/clear and
return to editing. Stack: React, existing CSS tokens, native form controls/details/dialog.
Conventions read: CONTRIBUTING.md, SECURITY.md, ADR 002 and this interface record. All six
owning better-* skills were loaded. The translated reading view is outside this increment.

| Domain | Evidence inspected | Result |
| --- | --- | --- |
| Accessibility | Native labels/fieldsets/details, dialog name, stable status/alerts, native validation plus aria-invalid, focus after removal/confirmation, Enter/Escape and return to the trigger; visible 2px focus ring | Clear in inspected flow |
| Layout | Connection before credentials/cache, options disclosed explicitly; wrapping languages/actions, scrollable modal with visible scrollbar; Chinese 320px and native 200% zoom without horizontal modal overflow | Clear |
| Writing | English/Chinese setup hints, full endpoint and language examples, prompt-based glossary/formality limitation, stored/session/absent key distinction, actionable locked-store fallback and explicit cache consequence | Clear |
| Typography | Existing system font and 16px input text, 14px/1.5 hints, full editable/scrolled endpoint values, no fixed text-container heights | Clear |
| Color | Measured input text 13.64:1 light / 13.55:1 dark, input border 3.66:1 / 4.34:1, focus 6.86:1 / 9.96:1 on actual input backgrounds; semantic input-border token in both themes and system-dark | Clear |
| UI | Instant native feedback, distinct controls, no animation added, bounded lazy service initialization, save/key/clear feedback; source editing remains available after dismissing Preferences | Clear |

Fixed findings: provider changes clear obsolete endpoint validity; credential controls explain
and require saving changed connections first; key input clears before IPC; disappearing key
removal and cache confirmation restore focus; the OS-key-store error now appears beside its
setting. A dedicated input-border token supplies control contrast rather than an undefined
border token. The Preferences dialog now has an explicit accessible name.

Verification: `npm run check`, the focused translation Vitest suite and
`test/e2e/translation.spec.ts` pass. Inspected translation-settings-light.png,
translation-settings-dark.png, translation-settings-narrow-chinese.png,
translation-settings-zoom-chinese.png, translation-settings-key-store-error.png and
translation-settings-options.png from the Electron flows. The tests use loopback services
and dummy keys; no paid-provider traffic. Loading/disabled behavior is inspected in source;
native key-store unavailable handling is injected in the UI flow. Physical screen readers,
forced colors, RTL mirroring, physical IME and macOS/Linux are **Not verified**.

No actionable interface findings remain in this flow. **Approve**, limited to this scope
and the verification recorded above.

## M3 replacement translated preview — 2026-10-24

Scope: the full replacement-reading flow: empty/configured view, explicit online/offline
loading, progress, failed-unit fallback, Retry failed, cancellation, changing language, tab
suspension, stale copy/refresh and returning to the source editor. React and existing semantic
CSS tokens/native controls own this flow. CONTRIBUTING.md, SECURITY.md, ADR 002 and the six
owning better-* skills were applied. Bilingual layouts and translated export are outside
this increment; the reading hint explicitly identifies file exports as source exports.

| Domain | Evidence inspected | Result |
| --- | --- | --- |
| Accessibility | Named mode buttons with pressed state, labeled native language selector, stable live progress/alerts, disabled task checkboxes, focusable reading surface, keyboard mode switches; disappearing Retry/Cancel returns focus and Source returns editor focus | Clear in inspected flow |
| Layout | Wrapped controls, independently scrolling copy with visible scrollbar, bounded sidebar at small widths, tables/code scroll within the copy; 320px Chinese and native 200% zoom, with cached-load action fully in viewport and clicked | Clear |
| Writing | English/Chinese empty/loading/ready/cancel/stale/error states, translated/cached/failed/missing counts, explicit source fallback and online versus offline actions; credential failure offers settings and Retry failed | Clear |
| Typography | 16px/1.7 reading body, separated headings, system UI copy, full editable language choices, wrapped paths/status; structural mixed-script output inspected | Clear |
| Color | Existing text/paper, muted text, input-border and focus tokens; both-theme body contrast assertions exceed 4.5:1; actual focused article uses a visible solid outline | Clear |
| UI | Source, selection and undo survive translation; refresh requests only changed prose; duplicate prose restores distinct protected values; tab switching/cancel ignores late work; cache survives restart with provider stopped | Clear |

Fixed findings: the sanitizer's URL rule removed checkbox type, so explicitly admitted
non-URL type metadata now survives and only disabled checkboxes are retained. Retry/Cancel
removal now restores focus without taking focus away from the reader or editor. Mode changes
return keyboard focus after the editor becomes visible. The sidebar's height is bounded on
small viewports so enlarged controls have reading space. Heavy resource slots use unpredictable
names to keep raw source HTML from impersonating them. File-export behavior is explicit.

Inspected reading-light.png, reading-dark.png, reading-error-light.png,
reading-narrow-chinese.png, reading-zoom-chinese.png, reading-structure.png, reading-loading.png
and reading-stale.png. The two reading.spec.ts Electron flows exercise real math/chemistry, Mermaid,
local images, GFM tasks/tables, references and footnotes. Provider bodies are inspected for
protected values; all traffic uses a loopback fake provider. No paid-provider calls were made.
Physical screen readers, physical IME, forced colors, RTL mirroring and macOS/Linux remain
**Not verified**. Worst-case reading latency/memory is not established by accounting limits.

No actionable interface findings remain in the inspected flow. **Approve**, limited to the
scope and evidence above.

## M3 bilingual reading and captured export — 2026-10-24

Scope: translation-only, side-by-side and interlinear reading; stable block scrolling during
layout/progress/resource-height changes; complete, incomplete and stale HTML/PDF export;
confirmation, cancellation, native File-menu export and return to source. React, native controls,
existing semantic CSS tokens and the shared sanitized renderer own this flow. CONTRIBUTING.md,
SECURITY.md, ADR 002 and all six better-* domain skills informed this implementation review.

| Domain | Evidence inspected | Result |
| --- | --- | --- |
| Accessibility | Named layout selector; language and direction per copy/unit; independent fragment/footnote/accessibility targets; keyboard confirmation receives focus, Cancel and completion restore the export trigger; reading interaction suppresses unsolicited focus return | Clear in inspected flow |
| Layout | Whole lists/tables and footnotes pair by semantic block, with one native scroller and aligned grid rows; stacked pairs on narrow screens; anchor/offset retained after layout, resource-height and actual delayed translation changes; Chinese 320px and actual native 200% zoom | Clear |
| Writing | English/Chinese layout and reading-export labels; captured language/layout/revision in confirmation; explicit missing-source fallback and stale-source explanation; exported artifact repeats language/layout/completion/fallback information | Clear |
| Typography | 16px/1.7 body, 32px reading heading, readable system controls and copy labels; long paths/status wrap; code/tables scroll within their cells; translated heading wrapping inspected | Clear |
| Color | Existing paper/text/muted/input-border/accent tokens in both themes; layout and progress are labeled rather than communicated by color; existing reading contrast/focus checks retained | Clear |
| UI | Layout changes request no provider work; one snapshot survives later outputs/edits/layout changes; source mode restores current-source export; pending choice is released on tab suspension; offline artifact retains both copies' math/diagrams/images | Clear |

Fixed findings during implementation:

| Severity | Domain | Location | Before | After | Why |
| --- | --- | --- | --- | --- | --- |
| HIGH | Accessibility | ReadingPreview.tsx, translation/viewport.ts | Completion could focus Translate after the reader scrolled; a disappearing action row also shifted the anchor | Scrolling/reading suppresses focus return; preserve the last user scroll anchor and observe controls as well as content | Delayed output must not interrupt the reader or move the reading position |
| HIGH | Accessibility | renderer/sanitize.ts | Footnote fragments were prefixed twice while IDs were prefixed once; copies could share targets | Apply named-property normalization once and scope IDs, fragment links and accessibility references independently per copy | Each language's links and descriptions must resolve to its own content |
| MEDIUM | Accessibility | ExportControls.tsx | Confirmed export removed its focused button without restoring a useful target | Restore the export trigger on completion, while leaving other focused content alone | Keyboard mode shortcuts must remain reachable after confirmation |
| MEDIUM | Layout/writing | ReadingPreview.tsx, ExportControls.tsx, styles.css | Long persistent instructions and an obsolete empty-copy error displaced reading content | Disclose details under a native summary, combine progress text, suppress the resolved error and size document headings for reading | Keep copy visible on a small laptop without hiding controls or recovery guidance |

Verification: `npm run check`, `npm test` and `npm run build` pass. The three
`test/e2e/bilingual.spec.ts` flows cover paired geometry, unique references, all three export layouts,
native-menu export, self-contained offline HTML and multipage PDF with Unicode font mapping,
late-result scroll stability within one CSS pixel, immutable partial/stale confirmation,
cancel/focus, source restoration and tab suspension. Inspected bilingual-light.png,
bilingual-dark.png, bilingual-export.png, bilingual-partial-choice.png,
bilingual-stale-choice.png, bilingual-narrow-chinese.png, bilingual-zoom-chinese.png and
bilingual-late-anchor.png. The native zoom test clears Playwright's emulated viewport and
checks that 1160 physical pixels become at most 580 CSS pixels at zoom factor 2.

Physical screen readers/IME, forced colors, RTL mirroring, macOS/Linux execution and visual PDF
pagination across other installed fonts are **Not verified**. Worst-case latency and retained
memory are not established by the accounting limits. No paid-provider requests were made.

No actionable interface findings remain in the inspected flow. **Approve**, limited to this
scope and the evidence above.

## M3 DeepL provider — 2026-10-24

Scope: provider selection, required write-only key, explicit language discovery, dynamic native
language/options controls, saved options before metadata is loaded, translation/cache restart,
missing-key and quota recovery. Existing React/native controls and semantic CSS tokens remain
in use. CONTRIBUTING.md, SECURITY.md, ADR 002 and the six better-* domains informed this review.

| Domain | Evidence inspected | Result |
| --- | --- | --- |
| Accessibility | Explicit labels survive input/select replacement; keyboard discovery and retry; focus returns to Translate after failed-unit retry; saved formality can reset to Default and an unavailable saved glossary can be removed | Clear in inspected flow |
| Layout | Grouped source/target controls reflow; proxy URLs stay within native inputs; Chinese at 320px and actual native 200% zoom; root and dialog overflow assertions | Clear |
| Writing | Discovery explicitly contacts DeepL without document text; separate missing-key, rejected-key, unsupported-option and exhausted-quota messages; no remote glossary creation implied | Clear |
| Typography | Existing 16px native fields and 14px explanatory copy; readable English/Chinese labels; long endpoint descriptions wrap | Clear |
| Color | Existing light/dark semantic tokens; measured control text at least 4.5:1 and focus at least 3:1; state conveyed with text | Clear |
| UI | Chat-only model/temperature/output-token/inline-glossary controls disappear for DeepL; loaded catalog filters XML-capable languages; formality follows target support and glossary requires explicit source; opening preferences and cache use make no requests | Clear |

Fixed findings: wrapping a dynamic select inside its label made the label's DOM text include
all options; use separate, explicitly associated labels. Moving the controls into stable field
groups retains their original wrapping behavior. Saved native options were initially disabled
when metadata was absent; Default and Remove glossary now let users clear them offline. The
first zoom test retained a 320px emulated viewport; reset it before native zoom and assert
570–580 CSS pixels from a 1160px content window at factor 2.

Inspected deepl-settings-light.png, deepl-settings-dark.png,
deepl-settings-narrow-chinese.png, deepl-settings-zoom-chinese.png and deepl-quota.png.
The two `test/e2e/deepl.spec.ts` flows inspect real loopback GET/POST headers/bodies, discover
capabilities through Preferences, preserve per-occurrence protected content, export bilingual
HTML, reopen cache without a key/server, and recover from missing-key/quota failures.
Provider-only tests cover hostile XML, API limits, redirects, retries and cancellation.
Main-service tests cover discovery invalidation and metadata expiry/connection isolation.

Physical screen readers/IME, forced colors, RTL mirroring, macOS/Linux execution and real DeepL
accounts are **Not verified**. No paid-provider request or real credential was used. Existing
reading controls may require vertical scrolling in a short window when several error/status
messages are visible; the independently scrolling reading surface retains keyboard access.

No blocking interface findings remain within this scope. **Approve**, limited to the evidence above.
## Long-paragraph editing review — 2026-10-24

Scope: the editor-only inline syntax threshold and existing Source/Live controls during a
generated 1 MiB paragraph. The full goal continues; this does not close the broader interface
or performance acceptance gates. Inspected the packaged light-theme screenshot at
`test/benchmark/results/1792783908760-75394ae7-2daf-4943-8954-f3c41fe47456/profile-long-paragraph-profile-diagnostic-no-latency-gate-/long-paragraph.png`,
ordinary-syntax/semantic unit coverage, existing packaged regression flows and resource-limit
messages. No new control, color, layout, motion or product copy was added.

| Domain | Evidence and result |
| --- | --- |
| Accessibility | Existing labeled Markdown textbox, pressed mode buttons, visible caret/focus and keyboard editing remain; unknown inline code context preserves plain text. Physical assistive-technology/IME walkthrough remains open. |
| Layout | Long paragraph wraps within the editor and scrolls to its actual end; mode/save/status controls remain visible. 5 MiB long-line and nested editing/save also pass. |
| Writing | Existing resource-limit Source fallback remains explicit. Numeric limits and skipped inline styling are documented in ADR 002 and benchmark methods. |
| Typography | Ordinary emphasis/code syntax still parses; exceptionally long inline leaves retain visible source. Screenshot retains comfortable live prose line height and source markers are not destructively rewritten. |
| Colors | Existing theme tokens are reused; no palette change. Existing packaged theme/contrast regressions pass. |
| UI | Mode switches retain cursor status and exact saved source. Long-paragraph typing meets the local 50 ms target; dense apply/freshness still fail separately and remain documented. |

This inspection covers the generated paragraph and regression scope only. It does not establish
new screen-reader, forced-colors, physical IME, dark-theme long-paragraph or other-OS evidence.

## Cooperative apply behavior — 2026-10-24

Scope: asynchronous preparation beneath the existing Source/Live editor, current counts,
pending status and export/translation capture. No new visual surface, control, copy, type,
color or motion is introduced. The preceding six-domain reviews continue to describe those
surfaces. This is a behavior/code review with packaged regression evidence; no new visual
screenshot or physical accessibility walkthrough is claimed.

The labeled editor stays usable while a native task continuation is deliberately held.
Twenty actual keyboard edits then survive the release, exact save and count update. Old or
partially prepared snapshots never produce current status. Existing pending/limit/error text,
pressed mode buttons, focus handling, source reveal, keyboard translation setup, narrow
Chinese layouts and both-theme contrast regressions pass in the 50-flow packaged suite.
Mode changes reuse the complete model; they do not rewrite text, selection or undo history.
Local dense apply slices meet 4 ms, while the independent freshness failures remain explicit
in VALIDATION.md. Source fallback continues to expose the editing surface on resource failure.

## Dense parsing and transport behavior — 2026-10-24

Scope: existing Source/Live editing, current counts and tab restoration while whole-document
semantics travel as an owned buffer. No new controls, layout, typography, colors, copy or
motion were added; the preceding six-domain reviews continue to apply. This is a behavior
and code review with packaged tests, not a new screenshot or physical accessibility review.

All 50 packaged correctness flows pass, including keyboard mode/translation controls,
narrow Chinese preferences, both-theme contrast, exact text saves and translation/export.
The new continuous-input performance scenario preserves every edit and current character
counts through alternating tabs, with at most one worker request in flight. Full-root grammar
equivalence preserves positions, references and GFM constructs; transfer ownership does not
detach cached data. Dense freshness now meets local timing targets. Nested resource fallback
remains visible and preserves the source editor; that outstanding capacity gate is explicit
in VALIDATION.md. The mode-frame benchmark now completes each sample before reversing modes.

Physical screen readers, IME, forced colors, RTL mirroring and other operating systems retain
their earlier unverified status. No broader interface certification is implied.

## Exact-boundary behavior — 2026-10-24

No application UI changed. The new packaged boundary test uses the existing labeled source
editor, visible editing-limit message, keyboard selection, Undo/Redo and Save. A valid 50 MiB
UTF-8 document opens in Source mode; rejected growth leaves the document unchanged, while a
same-size replacement remains editable and survives save/reopen. The reopened editor reveals
the saved tail. This adds behavior evidence for the existing accessibility and UI controls;
layout, writing, typography and colors retain their prior reviews. No new screenshots,
physical assistive-technology walkthrough or other-platform inspection is claimed.

## Cancellable paste flow — 2026-10-24

Scope: large plain-text paste preparation, the existing paste status surface and its new
Cancel paste control. The React/CodeMirror interface uses existing CSS variables, native
buttons and focus styling; ADR 002, CONTRIBUTING.md and preceding interface reviews supply
the project conventions. This is a complete-flow review, not a whole-application audit.
The better-interface domain skills govern the inspection; no additional animation is used.

| Domain | Evidence inspected | Result |
| --- | --- | --- |
| Accessibility | Native named button; status text has `role=status`; actual Enter activation, Escape cancellation, keyboard focus ring and return to editor; overlapping edits are preserved | Clear in tested flow; physical assistive technology/IME remains unverified |
| Layout | Pending screenshots at desktop English/light, Chinese/dark 320px and native 200% zoom; no root horizontal overflow; focus scrolls Cancel into view within the existing scrolling editing pane at zoom | Clear; a short zoomed window requires vertical scrolling, with visible scrollbars |
| Writing | Pasting… / 正在粘贴… and Cancel paste / 取消粘贴; interrupted replacement retains the existing actionable paste-again error; explicit cancellation produces no failure message | Clear |
| Typography | Existing inherited native control font, 13px status, 40px minimum button height; labels remain readable and untruncated at narrow width and zoom | Clear in inspected states |
| Colors | Existing paper/muted/accent tokens; actual dark control text measures at least 4.5:1 and keyboard focus at least 3:1; status is conveyed with text | Clear in tested states; existing light/dark palette evidence remains applicable |
| UI | Flex wrapping keeps status and Cancel grouped; no overlay or partial insertion; button/Escape/tab suspension discard staged text; success is one atomic Undo/Redo step | Clear |

`npm run test:packaged -- test/e2e/large-paste.spec.ts` passes both flows against the packaged
application. Native continuations are held after preparation actually starts; button, Escape
and tab switching leave exact disk/source content unchanged even when those continuations
are released later. Successful greater-than-5-MiB paste, exact save and one-step Undo/Redo pass.
The test uses synthetic DOM text paste and leaves the OS clipboard unchanged.

Inspected `pending-paste-light.png`, `pending-paste-chinese-320.png` and
`pending-paste-chinese-zoom.png` in the corresponding `test/e2e/results/large-paste-*` folders.
At 200% zoom the existing editing pane scrolls independently; keyboard focus brings the
entire cancellation control into view. The first test attempt incorrectly retained a 320px
device viewport at zoom; the final test resets emulation and asserts 570–580 CSS pixels from
the actual 1160px content window. An initial assertion also demanded on-screen visibility
before focusing a below-fold control; the final check verifies actual keyboard reachability.

No actionable interface findings remain in this tested flow. **Approve**, limited to the
states above. Forced colors, physical screen readers, real clipboard integration for large
plain text, arbitrary hardware/encodings and other operating systems are not newly verified.

## Cancellable replace-all flow — 2026-10-24

Scope: the existing native search panel, pending replacement status and its Cancel replacement
button. Reuses the preceding better-interface domain rules and paste-status tokens/layout;
no new motion or palette. Inspected `replace-pending-light.png`, `replace-chinese-320.png`
and `replace-chinese-zoom.png` from the packaged `test/e2e/replace.spec.ts` flows.

| Domain | Evidence and result |
| --- | --- |
| Accessibility | Named native Cancel button, `role=status`, actual Tab/Shift+Tab and Enter, Escape cancellation, focus return and subsequent source editing pass. Keyboard outline remains visible. |
| Layout | English/light desktop and Chinese/dark 320px/native 200% zoom retain readable grouped status and Cancel, with no root horizontal overflow. The short zoomed window uses the existing independent vertical scrollers; keyboard focus brings the entire Cancel control into view. |
| Writing | Replacing matches… / 正在替换匹配项… and Cancel replacement / 取消替换 describe the current action. Timeout/limit errors explain that text is unchanged and suggest a simpler search or smaller document. Explicit cancellation does not report a failure. |
| Typography | Existing inherited control font, status size and 40px minimum button height remain readable and untruncated in the inspected states. |
| Colors | Existing theme tokens convey status with text; dark button text is at least 4.5:1 and focus outline at least 3:1 against its surface, checked from computed styles. |
| UI | Button/Escape/edit/tab invalidation preserves exact source; stale output cannot install. A complete greater-than-5-MiB replacement is one Undo/Redo step. Real stalled-worker cancellation leaves editing available during native shutdown; timeout allows explicit retry. |

**Approve**, limited to these controls and states. Physical assistive technology, IME,
forced colors, other operating systems and arbitrary input/hardware schedules remain unverified.
The native search panel remains a version-sensitive CodeMirror adapter; dependency upgrades
must retain both native-command equivalence and actual activation checks.

## Responsive writing and reading shell — 2026-10-29

Used the redesign-existing-projects workflow to inspect the existing React/CSS interface,
then refine its current surfaces and controls. Reviewed the nine packaged screenshots at
D:\Project\user\Nazumeki\manuslip\test/artifacts/logs\ui-shell-design-audit-QEkEqJ, plus the complete translated-reading flow from the packaged tests.

| Finding | Resolution and evidence |
| --- | --- |
| Narrow navigation and wrapped actions leave only 36.8125 visible reading pixels | Native workspace disclosure and one scrolling action row provide 365.8125px at 360×800 and 339.8125px in Chinese at 320×800 |
| Chromium can leave a partly visible focused action after locale/width changes | Explicit nearest scrolling and focus margins; actual Tab reaches every action in both themes/locales |
| Export messages make actions wrap again | Separate action row and feedback; 308.3125px remain visible with a Chinese export error |
| Reading export labels occupy a second desktop row | Existing 13px chrome scale reduces the row from 110px to 64px; targets stay at least 40px high |
| Controls lack hover and pressed feedback | Semantic light/dark tokens supply feedback without motion |

The disclosure exposes its controlled region and expansion state, retains focus when
closing, and keeps focused navigation visible across resize. Native search/folder commands
reveal it. Existing typography, reading measure, palette, offline behavior, disabled states
and explicit error/confirmation copy remain coherent in the inspected views. All 77
packaged flows pass, including exports, translation, recovery, workspace tools and zoom.
The automated nine-state survey reports no axe violations; incomplete checks are retained.
Physical screen readers, IME, forced colors and other platforms remain unverified.

## Selected controls in forced system colors — 2026-10-30

Scope: document tabs and Source / Live Preview / Translated preview selection. Applied
better-accessibility and better-colors. This review uses the rebuilt Windows application
with Chromium forced-colors emulation; it is not a physical Windows contrast-theme or
screen-reader walkthrough.

| Severity | Location | Before | After | Why |
| --- | --- | --- | --- | --- |
| MEDIUM, resolved | apps/desktop/src/renderer/src/styles.css:1395, document tabs | Forced colors made selected and inactive bottom edges identical after focus moved elsewhere | Selected tabs use system Highlight, inactive edges use Canvas, and the selected filename is underlined | Preserve the current document's visible state independently of keyboard focus and color alone |
| MEDIUM, resolved | apps/desktop/src/renderer/src/styles.css:1404, preview mode buttons | Forced colors removed the author fill distinguishing the current mode | The pressed mode retains a text underline after focus moves away | Preserve the current editing mode without replacing native controls or system colors |

The two packaged tests in `test/e2e/forced-colors.spec.ts` cover six states: each system palette
at English 1160px, Chinese 320px, and native 200% zoom with the opposite application theme.
Actual Home/End tab selection, Enter activation, preferences focus return, source editing
and Undo pass. All 18 mode selections retain their cue without focus; text measures 21:1
and selected-edge/focus contrast is at least 14.37:1 in these emulated palettes. These
measurements do not generalize to every user-defined system palette. Native color
adjustment remains enabled. Browser-native text selection was inspected and retained.

Six native content-area captures were inspected from `test/artifacts/logs/system-colors-light-tD0LgN/`
and `test/artifacts/logs/system-colors-dark-N442Ro/`. Native captures preserve the full window at zoom;
the earlier page screenshots cropped that content. AX trees expose the named selected
tab. Each state has a forced-colors axe audit of non-color rules and a full tagged axe
audit, including contrast, in the ordinary application theme; all have zero violations.
Incomplete checks remain in the reports. axe 4.14 reads the original
`-webkit-text-fill-color` under forced colors and reports false contrast failures against
the forced background. The separate diagnostic preserves both properties, screenshots
and the initial failures; actual forced-color control contrast is measured independently.

**Approve**, limited to the selected-control states inspected here. Physical Windows
contrast themes, assistive technology, arbitrary system palettes, IME and other platforms
are **Not verified** by this increment. This does not approve whole-application accessibility.

## Document opening and recovery — 2026-10-30

### Scope and coverage

Reviewed the complete opening/recovery flow: startup scanning, loading and load errors,
draft listing, restore/discard failures and retries, permanent-discard confirmation,
successful restoration into a new editor, and opening/editing another file while recovery
waits. This is a React/Zustand/Electron flow using the existing plain CSS, semantic light/dark
tokens and native controls. Applied better-interface and all six owning domain skills.
Conventions inspected: CONTRIBUTING.md, README.md, ADR 002 and the existing interface review
and stylesheet. No applicable AGENTS.md or separate design-system document was found.
Other application flows and whole-application accessibility are outside this review.

| Domain | Evidence inspected | Result |
| --- | --- | --- |
| Accessibility | Native buttons, fieldset/legend and headings; contextual accessible names; stable polite pending status and action-specific alerts; actual Enter, Shift+Tab and Escape, Cancel focus, focus return after cancellation/removal/restoration, and later editor focus during pending work; six tagged axe audits | Two findings resolved; no remaining actionable finding in these states |
| Layout | Native content-area captures in English/light desktop, English/dark 320px, Chinese/light 320px, Chinese/dark desktop RTL diagnostic, and light/English plus dark/Chinese at native 200% zoom; full mixed-direction filenames and paths; measured control bounds and scrolling | Clear; no root/panel horizontal overflow, complete focused button remains within its panel and viewport |
| Writing | English/Chinese loading, retry, restore/discard errors, permanent-discard question and new-document recovery instructions; actual storage-repair and delayed-failure flows | One finding resolved; errors identify a next action and private native exception strings remain absent |
| Typography | Existing inherited control font and type hierarchy, new native row headings, untruncated wrapping, bidi isolation, localized dates/byte counts and zoomed text | Clear; long names remain available through visible vertical scrolling |
| Colors | Computed control text, surface and focus colors in both existing themes; full tagged axe audits including contrast, with incomplete checks retained | Clear; button text 13.64:1 light / 13.55:1 dark, focus 6.28:1 light / 8.75:1 dark; state also uses text and native semantics |
| UI | Actual blocked-directory repair without restart; serial operation admission; disabled pending actions; real discard and exact restored save; delayed load/discard/restore errors with subsequent editing and retries | Two findings resolved; source editing and unrelated file opening remain available while recovery waits |

### Findings

All findings below were implemented and verified in the inspected flow.

| Severity | Domain | Location | Before | After | Why |
| --- | --- | --- | --- | --- | --- |
| HIGH | Writing | apps/desktop/src/renderer/src/i18n.ts:132; apps/desktop/src/renderer/src/RecoveryPanel.tsx:85; apps/desktop/src/main/files/recovery.ts:58 | A failed startup scan showed a checkpoint-saving error and no reload action; the failure latch still rejected listing after storage repair | Use localized recovery-loading guidance and a Reload drafts button backed by a serialized failed-scan retry | An error must identify a usable recovery action; otherwise existing writing remains inaccessible until restart |
| HIGH | UI | apps/desktop/src/renderer/src/App.tsx:73 | Incoming file opening waited for the recovery-list promise | Start recovery loading independently and let incoming opening proceed | A stalled optional recovery read must not block opening and editing a file |
| MEDIUM | Accessibility | apps/desktop/src/renderer/src/RecoveryPanel.tsx:33; apps/desktop/src/renderer/src/RecoveryPanel.tsx:126 | Opening discard retained focus on the destructive button; cancelling left focus on the page body | Focus Cancel in the native confirmation group, support Escape, return to the initiating row, and hand focus to the next row/editor after completion without overriding later input | Predictable focus preserves keyboard context and reduces accidental permanent deletion |
| MEDIUM | Accessibility | apps/desktop/src/renderer/src/RecoveryPanel.tsx:178; apps/desktop/src/renderer/src/RecoveryPanel.tsx:195 | Multiple draft rows exposed identical Restore draft and Discard draft accessible names | Include each displayed draft name in the accessible action name, with native row headings and bidi-isolated names/paths | Users need to distinguish the intended draft when navigating controls by name |
| MEDIUM | UI | apps/desktop/src/renderer/src/recovery.ts:39; apps/desktop/src/renderer/src/recovery.ts:48 | Discard had no independent pending guard, and recovery errors shared the document error channel | Admit one recovery operation, expose pending state, retain failed entries, and report the failed action beside its controls | Prevent duplicate destructive requests and keep retry context beside the affected writing |

### Verification

Passed:

- `npm run check`: lint, formatting, package boundaries, native patch checks and TypeScript pass.
- `node node_modules/vitest/vitest.mjs run --config test/artifacts/logs/recovery-flow34-unit.config.mjs --reporter=json --outputFile=test/artifacts/logs/recovery-flow34-unit-report.json`: 19,338 tests pass across all 210 repository test files, with 488 exact loaded-source bindings and the existing Windows POSIX-permissions skip.
- `npm run test:packaged -- --output test/artifacts/logs/recovery-flow34-packaged-final-results --reporter=list,json`: all 93 workflows pass in one invocation, without retries or skips. Four new workflows cover recovery; the existing workspace test now uses the contextual recovery name.
- Keyboard checks repair a real blocked recovery directory in the same process, cancel with Enter/Escape, discard only the selected draft, restore exact Unicode text into a focused new editor, and save without replacing the original disk content. Delayed operation failures retain writing, prevent duplicate actions and preserve later editor focus.
- Six UI states measure 40px buttons, 2px focus outlines, no horizontal overflow and complete focused-button bounds. Native 200% zoom uses the actual window after clearing device emulation. RTL is a content-direction diagnostic, not an additional supported UI locale.
- Inspected the six recovery UI native captures plus storage-error, loading, discard-error and restore-error captures under `test/artifacts/logs/recovery-flow34-packaged-final-results/`. Six axe reports have zero violations. Incomplete contrast checks remain recorded for the decorative offline glyph or text outside the scrolled viewport; they are not counted as passes.
- `npm run test:installer`: the real Windows installer verifies 79 installed files, two launches, exact Unicode/BOM/CRLF saving, uninstall and complete prior-state restoration.

Initial lint issues, a native capture attempted before the window painted, an asynchronous
save read that did not tolerate ENOENT, and the old workspace action-name selector are
preserved under `test/artifacts/logs/recovery-flow34-*`. Corrections use a visible-window/paint barrier,
poll only an absent save destination, and assert the new exact accessible name. Additional
focused-button geometry assertions were exercised after the first all-suite discovery and
again in the final complete run. No production error was hidden or acceptance gate relaxed.

**Not verified:** physical screen readers, IME, touch, Windows contrast themes, arbitrary
user palettes, power-loss durability, reference hardware, macOS/Linux and whole-application
accessibility. These checks do not establish the original performance or feature gates.

### Verdict

**Approve**, limited to the complete opening/recovery flow and states reported above.
No HIGH finding remains in that scope. The full application goal and unchecked ADR 002
milestones remain open.

## Workspace search: keyboard continuity and stopped states

Scope: the complete workspace-search flow from the native filename/content-search command
through idle, loading, stopped-empty, stopped-partial, error/retry, and paginated results.
This is a React/Zustand/Electron screen using existing native controls, plain CSS and
semantic theme tokens. Conventions inspected: CONTRIBUTING.md, README.md, ADR 002 and
the existing interface review and stylesheet. No applicable AGENTS.md or separate design
system was found. The better-interface skill and all six owning domain skills were used.
Other application flows and whole-application accessibility are outside this review.

| Domain | Evidence inspected | Result |
| --- | --- | --- |
| Accessibility | Native search labels/buttons, polite status and action-specific alert; actual Enter on Stop, Retry and Show more; computed focus visibility and scroll clipping; four tagged axe audits per configuration | Two root causes resolved; focus returns to the query or the first newly revealed result |
| Layout | Actual native captures at 1160px, 320px and native 200% zoom; both themes/locales; RTL diagnostic; long mixed-direction paths and excerpts; root/panel scroll widths and exposed focused-result bounds | Clear; no horizontal overflow; oversized results retain visible focus edges and vertical scrolling |
| Writing | English and Chinese idle/loading, stopped-empty/partial, no matches, error/retry, search policy, result counts and pagination | One finding resolved; an empty stopped search gives a next action without claiming partial results |
| Typography | Inherited control fonts, existing 13px result hierarchy, 12px supporting text, bidi-isolated complete paths, wrapped filenames, zoomed text and three-line excerpts with the complete excerpt available in the button title | Clear in this desktop-tool scope; paths stay available without horizontal scrolling |
| Colors | Actual computed foreground/background pairs for all rendered search text; existing light/dark tokens; native focus indicators and tagged axe contrast checks | Clear for measured pairs: minimum text contrast 5.24:1 light / 6.75:1 dark; incomplete automated checks remain recorded |
| UI | Immediate native action feedback, retained partial results, disabled file-opening controls during busy operations, preserved unsaved source text and no added animation or tab stops | Clear; existing control sizing, spacing and visual language retained |

### Findings

All three root causes below were implemented and verified in the inspected flow.

| Severity | Domain | Location | Before | After | Why |
| --- | --- | --- | --- | --- | --- |
| HIGH | Accessibility | apps/desktop/src/renderer/src/styles.css:482 | An external result outline was clipped by the scroll panel, leaving no visible indicator in the native 200% text-result capture | Inset the existing 2px theme outline on result buttons and programmatically focused rows | Keyboard users must be able to locate focus even when a result is taller than its visible scroll area |
| MEDIUM | Accessibility | apps/desktop/src/renderer/src/WorkspaceSearch.tsx:23; apps/desktop/src/renderer/src/WorkspaceSearch.tsx:124; apps/desktop/src/renderer/src/WorkspaceSearch.tsx:151; apps/desktop/src/renderer/src/WorkspaceSearch.tsx:181 | Stop, Retry and the final Show more action removed the focused control, leaving focus on the document body | Return focus to the stable query after Stop/Retry; focus the first newly revealed result after pagination, using retained entry identity to reject obsolete requests | Keep keyboard position with the action's outcome; negative tab indices add no sequential tab stops |
| MEDIUM | Writing | apps/desktop/src/renderer/src/WorkspaceSearch.tsx:138; apps/desktop/src/renderer/src/i18n.ts:52; apps/desktop/src/renderer/src/i18n.ts:311 | Every stopped search claimed partial results, including zero-result searches | Use localized empty-stop guidance when no entries exist; retain partial-result wording when entries remain | Status text must describe the displayed result and provide a usable next step |

### Verification

Passed:

- `node test/packaging/run-packaged.mjs test/e2e/workspace-search-ui.spec.ts --reporter=json --output=test/artifacts/logs/search-focus40-before5-results`: all six baseline cases reproduce the focus regression; each records four false focus observations against the archived prior application. The test driver, application archive and source hashes are retained in `test/artifacts/logs/search-focus40-before-method.json`.
- `node test/packaging/run-packaged.mjs test/e2e/workspace-search-ui.spec.ts --reporter=json --output=test/artifacts/logs/search-focus40-refined-results`: all six cases pass against the rebuilt application. Twenty-four actual Enter-driven transitions preserve focus, partial entries and the exact unsaved Unicode draft. Native captures and observations are retained alongside 24 axe reports, each with zero violations.
- Six configurations cover English/light desktop filename search; English/dark 320px content search; Chinese/light 320px filename search; Chinese/dark desktop content search with RTL direction; and native 200% English/light content and Chinese/dark filename searches. RTL is a direction diagnostic, not an additional supported UI locale.
- No root/panel horizontal overflow; query height 40 CSS pixels; 2px focus outlines; exposed focus edges remain inside ancestor scroll clips. At native 200%, the focused filename result is fully visible and the taller content result retains 59 CSS pixels of visible height plus both focus edges.
- Inspected native idle, stopped-empty, focused-error and expanded-result captures across the six configurations, including the native 200% and 320px states. Full text-color measurements exceed 4.5:1. Automated color-contrast checks requiring manual review remain in the reports, including offscreen text; they are not counted as passes.
- `npm run check` passes for the implementation; the final frozen-source full-suite, build, installer and runtime-reproduction protocol and its recorded outcomes are indexed by `test/artifacts/logs/search-focus40-validation.json`.

Initial startup, welcome-screen and localized-button selector fixture failures remain in
the earlier `search-focus40-before*` logs. The corrected baseline reaches every state
and records the actual failures. Subsequent test formatting and textContent use preserve
the original focus and status assertions; later checks additionally measure the repaired
focus ring, all four accessibility states and focus contrast. No production exception or
acceptance limit was hidden or relaxed.

**Not verified:** physical screen readers, IME, touch, Windows contrast themes, arbitrary
user palettes, simultaneous busy-state pagination, reference hardware, macOS/Linux and
whole-application accessibility. These checks do not establish the original Live Preview
latency, aggregate physical admission or full feature acceptance gates.

### Verdict

**Approve**, limited to this workspace-search flow and the reported configurations.
No HIGH finding remains in that scope. The full application goal and unchecked ADR 002
milestones remain open.


## Selected document tab flow review — 2026-10-30

### Scope and coverage

Reviewed six open documents, ArrowLeft/ArrowRight/Home/End selection, selected tab
and Close focus, short-to-long Save As, viewport changes and keyboard close.
The stack is React 19 with native buttons, a roving ARIA tablist, separate close
controls, CSS grid/overflow and existing semantic color tokens. CONTRIBUTING.md,
ADR 002 and the existing review conventions informed this screen/flow review.
Empty welcome behavior is exercised before opening files; existing packaged cases
continue to cover busy/cancel and source/file paths. This review does not approve
those other surfaces or establish whole-application accessibility.

| Domain | Evidence inspected | Result |
| --- | --- | --- |
| Accessibility | Native names, complete filename in accessibility snapshots and title, roving arrows/Home/End, Tab/Shift+Tab, Close focus restoration, 2px focus ring and forced-colors emulation | Clear in inspected flow after shared layout fix; physical AT not verified |
| Layout | Six long mixed CJK/Latin filenames, 320/580/1160 CSS pixels, native 100%/200% zoom, title growth and strip resize | One HIGH root cause resolved |
| Writing | English/Chinese tab and Close labels, unchanged command copy, complete filename available beyond visual ellipsis | Clear |
| Typography | Existing 13px tab text/line height, bounded title ellipsis, bdi isolation, full accessible name | Clear |
| Colors | Actual selected tab and Close text/background pairs in light/dark; focused outline/background pairs | Clear: text minimum 9.71:1, focus minimum 5.94:1 |
| UI | Separate native tab/Close targets, visible selected state, paired scroll reveal, keyboard operation, no added motion | Clear |

### Findings

| Severity | Domain | Location | Before | After | Why |
| --- | --- | --- | --- | --- | --- |
| HIGH — resolved | Layout | apps/desktop/src/renderer/src/DocumentTabs.tsx:32, :74; apps/desktop/src/renderer/src/styles.css:213, :247 | Selection scrolls only the label; Close is clipped at 320px. Close focus can clip the label; Save As growth does not trigger reveal. | Reserve the adjacent 36px Close target plus 4px margin in native scroll margins, add 16px inline scroll padding, observe only the active tab and strip sizes, and reveal the same pair on Close focus. | Interactive controls must remain visible at narrow widths and zoom; label and action form one visual group. Hidden Close controls and clipped focus disrupt keyboard operation. |

### Verification

Passed:

- Original-package reproduction: node test/artifacts/logs/tabs44-saveas-audit.mjs, successful corrected run test/artifacts/logs/tabs44-baseline-saveas-v3.log. Six actual captures reproduce clipped Close on ArrowRight and Save As and clipped label on Close focus. The archived driver is retained with each run. Earlier fixture attempts selected the wrong Untitled ordinal; their logs remain and are not passing evidence.
- Baseline regression: node test/packaging/run-packaged.mjs test/e2e/tabs-scroll.spec.ts --reporter=json --output=test/artifacts/logs/tabs44-baseline-regression-results. Both new themed cases fail against the original package at the expected selected-pair visibility assertion. These are intentionally retained failing baseline results.
- Full frozen release: node test/artifacts/logs/tabs44-final-checks.mjs. All ten recorded stages pass: npm run check, all 19,374 unit tests (one existing Windows POSIX skip), source-binding verification, application/installer build, all 101 packaged cases, actual NSIS install/save/uninstall, package inspection and exact runtime reproduction. Each packaged case has one result, retry=0; none are flaky or skipped.
- New packaged cases exercise both themes across English/1160px/100%, Chinese/320px/100%, English/320px/200% and Chinese/580px/200% with forced-colors emulation. Home/End/arrows and Tab/Shift+Tab preserve selected/focused controls. Save As preserves the tab ID/count and exact source bytes. Keyboard Close restores focus to the selected tab. No page errors or document horizontal overflow are observed.
- node test/artifacts/logs/tabs44-packaged-audit.mjs packaged-light light and node test/artifacts/logs/tabs44-packaged-audit.mjs packaged-dark dark: six states per theme pass in the actual packaged ASAR. Native narrow-width navigation and Save As screenshots were inspected in both themes. Full names and independently named Close controls are exposed in the retained accessibility snapshots.
- node test/artifacts/logs/verify-tabs44-ui.mjs: binds original/current ASARs, both current UI source hashes, exact packaged renderer assets, screenshots, accessibility snapshots and all eight configuration observations. Text minimum 9.71:1 and focused outline minimum 5.94:1 exceed project thresholds of 4.5:1 and 3:1 respectively. Focus width is 2px. No color, typography or animation changes were required.

**Not verified:** physical screen readers, physical IME/touch, actual Windows
contrast themes, arbitrary palettes, global RTL UI, reference hardware and
macOS/Linux. Forced-colors emulation is evidence for that browser state only.
The full original feature, Live Preview latency and aggregate physical admission
gates remain open.

### Verdict

**Approve**, limited to this selected-document tab flow and the recorded states.
No HIGH finding remains in that scope. The full application goal remains active.


## Offline Chinese typography and export review — 2026-10-30

Scope: Chinese filenames, Source/Live text, Chinese interface controls, translated
reading text, Mermaid labels and self-contained HTML/PDF on Windows and the native
Ubuntu 22.04/WSL2 environment. The earlier AppImage capture reproduced missing
Chinese glyphs with zero system Chinese font matches. This review uses the
better-typography criteria for readable coverage, real weights and retained Latin
and monospace faces. It does not approve uninspected screens or languages.

| Severity | Location | Before | After | Why |
| --- | --- | --- | --- | --- |
| HIGH — resolved in inspected states | apps/desktop/src/renderer/fonts.css; renderer/src/styles.css; packages/editor/src/index.ts; renderer/diagram/main.ts; main/exports/fonts.ts | System font stacks render Chinese filenames and editor text as boxes on the minimal native environment. Reading, diagrams and exports have the same offline coverage dependency. | Bundle licensed Noto Sans CJK SC variable faces, select them only for East Asian ranges in shell/editor/reading/export stacks, await the face before diagram layout, embed fonts/license in East Asian HTML exports and load them in isolated PDF rendering. Actual painted glyphs and native captures are verified without installing system Chinese fonts. | Supported Chinese text must be visibly readable offline. Accessible names and preserved bytes alone cannot establish readable glyphs. Latin code retains its original monospace face. |
| HIGH — resolved for tested PDF characters | scripts/build-cjk-font.py; resources/fonts/manifest.json; test/e2e/export.spec.ts | The first bundled-font PDF looks correct but maps the Han character 文 to the radical ⽂ when copying/extracting text. The upstream cmap shares glyphs between distinct characters. | Partition all nominal character mappings across four faces so each face has an unambiguous nominal mapping. Retain every mapped character and its OpenType glyph closure, variable weights and variation sequences. Test actual embedded glyph paths/programs and Unicode maps; independent extraction preserves 文 ⽂, 二 ⼆, 長 ⻑ ⾧, 中・文, 龘𠮷 in order. | Visually similar glyphs can encode different characters. Search, copy and accessible PDF text need the intended Unicode rather than normalized replacements. |

Verification:

- The original `test/artifacts/logs/linux45-native-appimage-reopened.png` and
  `test/artifacts/logs/linux45-font-coverage.json` retain the failing visual baseline. Both
  current `fc-list :lang=zh` and `fc-list :charset=4e2d` also return zero matches;
  the remedy comes from the packaged application.
- All eight focused native font/reading/export cases pass. The current Windows
  packaged suite and both complete native built/packaged suites each pass all
  102 cases with one result per case, retry=0, and no flaky or skipped cases.
  Twenty-four retained CDP observations identify the custom Noto face actually
  painting filename, Source/Live, interface, reading, HTML code/table and SVG text.
- Inspected Windows and native captures show readable Source, Live, Chinese dark
  preferences at 320px, translated reading structure, Chinese narrow/200% reading
  controls and HTML export. No document horizontal overflow occurs in the new
  narrow fixture. The ASCII `iiWW` source line keeps a system monospace face and
  equal `ii`/`WW` widths. Original UTF-8 BOM/CRLF/Unicode bytes remain exact.
- Four direct native release/AppImage launches verify painted Chinese glyphs,
  exact Unicode/BOM/CRLF save/reopen and actual renderer NoNewPrivs=1/Seccomp=2.
  The application has no `--no-sandbox` switch. AppImage uses extract-and-run;
  FUSE mounting and desktop-wide installation remain outside this evidence.
- Windows and native PDFs each render as one readable page in an independent
  MuPDF engine. Actual extracted text preserves the Han/radical/rare-character
  sequence above. Their captured pages, source PDFs and hashes are retained in
  `test/artifacts/logs/fonts46-{win,native}-pdf-visuals/`.
- All four WOFF2 files, source provenance, manifest and SIL OFL 1.1 license are
  present in both packages. HTML embeds those exact font bytes and the license;
  Latin-only HTML omits them. The font preparation and independent outline,
  metric, layout and variation checks cover all 44,810 mapped code points.
  `test/artifacts/logs/fonts46-validation.json` binds the final inputs and release evidence.

The first concurrent native unit run retained one unchanged 20-second fixture
timeout; a subsequent isolated complete run passes all 19,372 applicable tests.
No application deadline, resource cap or parser activation gate changed.

**Approve**, limited to the observed Chinese typography and tested export states.
The preceding HIGH missing-glyph finding is resolved in this scope. The default
Han forms follow Simplified Chinese; this is not complete Unicode or regional
typography acceptance for every language. Native OS menu/dialog glyph coverage,
physical screen readers/IME/touch,
physical Linux/macOS desktops, reference-hardware font startup/memory budgets,
whole-application accessibility and the original full feature/performance gates
remain unverified or open. Continue the full application goal.

## Native Linux Chinese menu and dialog typography — 2026-10-30

Scope: the native File menu, menu bar and Chinese Markdown filter in the GTK Open
dialog, launched from the unpacked Linux release and AppImage extract-and-run on
Ubuntu 22.04/WSL2 with Xvfb. This extends the preceding renderer typography review
using the same better-typography criteria. The original package's renderer is
readable while these native controls still display missing-glyph boxes. Full
desktop captures reproduce that failure in `test/artifacts/logs/native-menu47-captures/`.

| Severity | Location | Before | After | Why |
| --- | --- | --- | --- | --- |
| HIGH — resolved in inspected states | apps/desktop/build/linux-launcher.sh; build/native-fonts/prepare-fonts.sh; desktop/package.json | Chinese File menu actions and GTK filter labels are unreadable on a system without installed Chinese fonts. Renderer WOFF2 resources do not reach native menus or GTK. | Linux packages include the unchanged licensed Noto Sans CJK SC TTF outside ASAR. The launcher configures an application-private Fontconfig fallback before Electron starts. Both release entry points now show readable Chinese native labels. | Native commands and file filters need visible, legible text. Correct menu strings and readable web content do not establish native glyph coverage. |

Verification and visual review:

- Inspected the actual final File menu and GTK Open dialog captures for both
  entry points in `test/artifacts/logs/native47-release-menu-{unpacked,appimage}-captures/`.
  Chinese actions and the Markdown filter are legible. System Chinese font
  queries remain empty. No system or per-user font installation is performed.
- Early initialization is necessary: a retained prototype that sets the font
  configuration in main-process JavaScript still shows missing glyphs. The
  pre-process launcher resolves them. Its generated configuration uses absolute
  escaped paths compatible with the environment's older Fontconfig release.
- Five durable Linux launcher checks pass: literal Unicode/space/shell-character
  paths, working directory and umask survive first/warm/symlink launches; Latin
  sans/serif/monospace matches stay identical; corrupt cached fonts are repaired;
  explicit Fontconfig settings are respected; cache failure still allows launch;
  and four simultaneous starts publish complete files. The checks run in Linux
  CI through `npm run test:linux-launcher`.
- All 102 current Linux packaged cases pass once, with retry=0 and no flaky or
  skipped cases. Four direct release/AppImage save/reopen launches retain exact
  Unicode/BOM/CRLF bytes, actual custom renderer glyphs and the real sandbox:
  NoNewPrivs=1, Seccomp=2, context isolation on and Node integration off.
- Both ASARs and all 245 runtime files per platform match the preceding validated
  versions exactly. The Windows installer verifies 79 installed files and restores
  state after uninstall. Prior unit and Windows packaged evidence is retained
  with unchanged source/payload bindings; the Linux packaged run is fresh.
- The fresh native PDF is readable in independent MuPDF rendering and preserves
  the exact extracted sequence `文 ⽂, 二 ⼆, 長 ⻑ ⾧, 中・文, 龘𠮷`. Its page pixels
  match the preceding validated PDF. Existing renderer typography and export
  character mappings remain intact.
- Native X11 class/name remain `manuslip`, matching the desktop entry. Its name,
  icon, file arguments and Markdown association metadata remain intact.

The default native fallback needs a writable private cache; failure keeps host
fonts and application startup available. Explicit `FONTCONFIG_FILE`,
`FONTCONFIG_PATH` or `FONTCONFIG_SYSROOT` settings retain priority. The bundled
TTF adds 36,144,788 uncompressed bytes to Linux resources and one private cached
copy, plus Fontconfig metadata. Reference-hardware startup/memory admission is
still open. Some OS-provided English labels follow the host locale; this review
establishes glyph readability in the named controls.

**Approve**, limited to the inspected native Chinese controls and recorded
environment. Physical Linux desktops, FUSE/desktop installation, other native
dialogs, macOS, physical assistive technology/IME/touch, full regional typography,
complete application accessibility and original feature/performance acceptance
remain open. `test/artifacts/logs/native47-validation.json` binds this review to the final
inputs and release evidence. The whole application goal remains active.

## Preferences save failure and recovery while editing — 2026-10-30

Scope: Appearance, interface language and their save failure/retry state inside
the existing Preferences dialog while a named document is being edited. The
implementation uses React, CodeMirror 6, native HTML controls/dialog and existing
plain-CSS semantic tokens, English/Chinese strings and bundled CJK fonts. Reviewed
conventions are CONTRIBUTING.md, SECURITY.md and ADR 002. No AGENTS.md was found.
This is a scoped better-interface review using all six owning domain skills;
other editor flows, preference panels and the whole application are outside it.

| Domain | Evidence inspected | Result |
| --- | --- | --- |
| Accessibility | Actual modal error in Chromium's exposed accessibility tree; keyboard entry, Tab to Retry, repeated failure, success, Escape and trigger restoration; native labels/controls; scoped axe checks | One HIGH finding resolved; physical assistive technology not verified |
| Layout | Actual 1160px English, 320px Chinese and native 200% Chinese states; dialog/page scroll widths, fully visible recovery action and complete native bitmap | Clear in inspected states; vertical dialog scrolling keeps remaining controls reachable |
| Writing | Existing localized save error plus verb-first, specific “Retry saving preferences” / “重试保存偏好设置” beside the failed controls | Clear in inspected states; recovery no longer requires reselecting a value |
| Typography | 14px error text with inherited 1.5 line height, wrapping and readable CJK glyphs; existing control typography at narrow/zoom sizes | Clear in inspected states; no truncation of the error or action |
| Color | Computed foreground/background/focus colors in light and dark themes; whole-preferences text contrast diagnostic | Clear: action text 13.64:1 light / 13.55:1 dark; focus 6.86:1 / 9.96:1; minimum preferences text 5.73:1 / 7.69:1 |
| UI polish | Existing 40px minimum button height and 2px focus ring, error/action grouping, pending rollback, repeated retry and success focus | Clear in inspected states; existing tokens and native interaction conventions retained |

| Severity | Domain | Location | Before | After | Why |
| --- | --- | --- | --- | --- | --- |
| HIGH — resolved in inspected states | Accessibility | apps/desktop/src/renderer/src/App.tsx:140; App.tsx:209; renderer/src/i18n.ts:285; renderer/src/styles.css:395 | A real preferences write failure rolls back the choice, but its only alert sits outside the open modal. It is hidden behind the narrow dialog and absent from the exposed native accessibility tree. There is no explicit retry action. | Keep the complete attempted settings and render the localized alert plus native Retry button inside Preferences. Retry resubmits that attempt; a later choice supersedes it. Preserve keyboard focus across pending, repeated-failure and successful states without overriding later input. | A failure must be perceivable and actionable in the active interaction context. An alert behind an inert modal leaves the user without the reason or recovery action. |

Verification passed:

- Actual old package reproduction:
  `node test/artifacts/logs/interface56-preferences-repro-captured.mjs`. Temporarily placing an
  empty directory at the unique test profile's preferences.json causes a real
  settings repository failure through the authorized bridge, without replacing
  IPC or mocking the response. Retained captures/tree/report establish the
  failure above. Playwright's role query still finds the inert background alert;
  the native accessibility tree does not expose its message. The negative
  regression against that package fails at the missing dialog-local alert.
- Built application:
  `npx playwright test --config test/artifacts/logs/interface56-focused-verified.config.mjs`
  passes all three new cases. They cover both themes/locales, 320px and 200% zoom,
  rollback, keyboard retry, another failed retry, exact attempted-value persistence,
  a superseding choice, restart and Escape. Scoped axe reports have no violations
  or incomplete checks; the actual native tree exposes the error in all three
  states. Exact source lines and one Undo restore the original document, whose
  autosaved Unicode/BOM/CRLF bytes are checked unchanged.
- `node test/artifacts/logs/interface56-native-zoom.mjs` captures the actual fresh package's
  complete 1160×1000 native content bitmap at 200%, with a 580×500 CSS viewport.
  Inspected error text and focused Retry are readable and fully visible. Page
  scroll width is 580px. This supplements the cropped Playwright/CDP zoom image;
  no layout, scale, deadline or assertion was changed to obtain the capture.
- `npm run check` passes. All 19,446 unit cases pass across 212 files, with one
  existing Windows POSIX-permissions skip. The fresh Windows directory package
  passes all 105 integration cases using the original 30-second case deadlines,
  one worker, no retries, no failures, no flaky results and no skipped cases.
- Initial diagnostics are retained: one incorrect assumption about Playwright's
  inert-role exposure, then two test-only source observers (rendered Live text;
  unreliable generic CodeMirror fill). The final regression uses real editor
  keyboard selection/insertion and exact source assertions before and after the
  interaction. Existing assertions and deadlines were not weakened.

Not verified: physical screen readers, IME/touch, other native platforms, every
preferences option, unrelated dialogs, complete editor journeys or whole-product
accessibility/performance. These checks do not establish reference-hardware budgets.

**Approve**, limited to the observed Preferences failure/recovery states above.
No HIGH finding remains in this scope. `test/artifacts/logs/interface56-validation.json` binds
the final source, native captures, test reports and fresh package evidence. The
original full-feature, performance, platform and distribution gates remain open;
the full application goal continues.

## In-document Find and Replace — 2026-10-30

Scope: opening the existing CodeMirror Find/Replace panel, reaching all of its
controls, case-sensitive whole-word replacement, closing it, saving and undoing.
Inspected states are wide English/light, 320px English/dark, 320px Chinese/dark and
Chinese/light at native 200% zoom. The established React/CodeMirror/plain-CSS stack,
semantic color tokens, native search handlers and localized phrases remain. Read
CONTRIBUTING.md, SECURITY.md and ADR 002; no AGENTS.md was found. This applies the
better-interface skill and all six owning domain skills. Other search experiences,
read-only panels, platforms, physical assistive technology and full editor journeys
are outside this review.

| Domain | Evidence inspected | Result |
| --- | --- | --- |
| Accessibility | Keyboard traversal through every search action/option, visible focus, Close hit geometry, native Close accessible name, scoped target checks and whole-page axe observations | One HIGH sizing finding resolved; incomplete icon-name checks manually reviewed; physical AT not verified |
| Layout | Native 320px and 200% captures, page/panel widths, pairwise target intersections and focus visibility | Clear in inspected states; reserved Close space prevents collisions; a 160px minimum text scroller remains while controls grow and the existing page scroll reveals them |
| Writing | Existing English/Chinese Find, Replace, option and Close names in the native panel | Clear in inspected states; established terminology and handlers retained |
| Typography | Computed input/action font sizes and actual native bitmaps in both languages | Clear after correction: 14px fields/actions, 13px options; readable wrapped rows replace 10.5px controls |
| Color | Actual text, placeholder, surrounding surface and focus colors in both themes, including native package measurements | One HIGH placeholder finding resolved; placeholder contrast 5.73:1 light / 7.69:1 dark; action text and focus meet 4.5:1 / 3:1 respectively |
| UI polish | Existing token palette, 6px control radii, 40px targets, native checkbox labels, Close alignment and no added motion | Clear in inspected states; panel now follows the surrounding controls' density |

| Severity | Domain | Location | Before | After | Why |
| --- | --- | --- | --- | --- | --- |
| HIGH — resolved in inspected states | Accessibility | packages/editor/src/index.ts:186; apps/desktop/src/renderer/src/styles.css:821 | Native default styling reduces fields/actions to 10.5px and leaves Close about 10.27px wide. At 320px English its spacing fails the target-size check. | Integrate native controls with 14px text, 40px fields/actions, 13px/40px checkbox labels and a separate 40×40px Close target. Keep native line wrapping and handlers, reserve its inline space and preserve a 160px editable scroller. | Dense controls must stay readable and distinct. A narrow Close target beside another action makes an ordinary editing flow unnecessarily difficult. |
| HIGH — resolved in inspected states | Color | packages/editor/src/index.ts:199 | The default `rgb(117,117,117)` empty-field labels measure 4.4827:1 on the light paper and 3.3866:1 on dark paper. An initial package passes all integration cases and the automated scan still misses this. | Use the existing `--muted` token at full opacity for Find/Replace placeholders and assert their actual rendered contrast in each state. | Placeholder text must also meet the normal-text contrast requirement. Green automated checks do not establish readable empty fields. |

Verification passed:

- Old-package inspection: `node test/artifacts/logs/interface57-inspect-search.mjs`, retaining
  complete native captures, DOM geometry and scan results for all four states.
  A regression against that package fails on the original 18.1875px Find field.
  The initial packaged color review retains the separate failing contrast
  measurement in `test/artifacts/logs/interface57-review.json` and its nonzero diagnostic log.
- Final focused cases:
  `npx playwright test --config test/artifacts/logs/interface57-current-focused.config.mjs`
  passes all four. Actual Tab traversal reaches every native control with visible
  focus, no target intersections or horizontal overflow. Case + whole-word
  replace-all changes exactly the two lowercase whole words, preserves the other
  occurrences, saves original Unicode/BOM/CRLF conventions, and one Undo plus save
  restores the original bytes. Escape closes search and restores editor focus;
  Escape then Tab leaves it without inserting indentation.
- Inspected complete Electron `capturePage` bitmaps include the full 1160×1000
  native image at 200%, rather than a cropped browser screenshot. Text remains
  visible above the panel; keyboard focus scrolls the normal page as needed.
  `node test/artifacts/logs/interface57-current-inspect-review.mjs` verifies native package
  text/placeholder colors in both themes and its exposed Close button name.
- Whole-page axe scans report no violations. They retain manual-review items for
  the × Close icons, the decorative offline dot and initially off-viewport status
  text. The symbol is a Close icon with an explicit accessible name; its native
  AX node and enlarged keyboard/pointer target are verified. The other named
  items are outside this panel's scope. They are not silently counted as complete
  whole-page accessibility coverage.
- `npm run check` passes; 62 relevant editor, document and replacement unit cases
  pass across eight files. Final package integration and byte bindings are recorded
  in the corresponding validation section. Existing assertions, application
  deadlines, quotas and parser/transport selection remain intact.

Not verified: physical screen readers, IME/touch, RTL/other locales, other native
platforms, every search command or whole-product accessibility and performance.

**Approve**, limited to the observed Find/Replace flow and states above. No HIGH
finding remains in this scope. `test/artifacts/logs/interface57-current-validation.json` binds
the final source, images, manual color/name checks and package evidence. The full
application goal and its remaining feature/performance/platform/distribution gates
remain active.

## File command keyboard context — 2026-10-30

Scope: welcome Open, document Open, Save, failed Save, canceled Save As and
successful New/Open through the existing application command handler. Inspected
states are wide English/light, 320px English/dark, 320px Chinese/dark and
Chinese/light at native 200% zoom. This uses React, Zustand, CodeMirror, native
buttons/dialog/popovers and the existing plain-CSS semantic tokens, localized
phrases and bundled fonts. CONTRIBUTING.md, SECURITY.md and ADR 002 supply the
project conventions; no AGENTS.md was found. The better-interface skill and all
six owning domain skills apply. Other command handlers, folder operations,
conflict/reload controls, physical OS dialogs, platforms and full application
journeys are outside this review.

| Domain | Evidence inspected | Result |
| --- | --- | --- |
| Accessibility | Actual previous package focus loss; current keyboard activation/restoration, next Tab, native Save/error accessibility nodes and scoped axe | One MEDIUM finding resolved; later input and successful editor autofocus retain precedence |
| Layout | Complete native narrow/200% captures, fully visible focused targets, alert wrapping and page widths | Clear in inspected states; no horizontal overflow; error and focus remain visible |
| Writing | Existing English/Chinese Open, Save, Document actions and actionable retained-content error | Clear in inspected states; the message identifies retry or save a copy without adding technical detail |
| Typography | Measured 15px welcome/sidebar actions, 13px toolbar actions/error text, native English/Chinese captures | Clear in inspected states; established density and readable wrapping retained |
| Color | Computed control text, adjacent focus surfaces and real save error colors in light/dark | Clear: Save text 7.05:1 light / 9.96:1 dark; focus at least 6.28:1 light / 9.96:1 dark; error 12.49:1 / 11.90:1 |
| UI polish | Existing 40px target heights, 2px focus rings, native disclosure return, pending/error/completion states | Clear in inspected states; no new visual style or motion; focus follows the completed action and subsequent intent |

| Severity | Domain | Location | Before | After | Why |
| --- | --- | --- | --- | --- | --- |
| MEDIUM — resolved in inspected states | Accessibility | apps/desktop/src/renderer/src/App.tsx:52; App.tsx:66 | Open and Save disable their focused trigger during the operation. Cancellation leaves focus on the body in all three reproduced contexts, with no visible focused control. | Remember the initiating native button and restore it when the command finishes if focus is still on the body and the trigger is connected, visible and enabled. Cancel the request on subsequent keyboard/pointer input and preserve a newly focused document or modal. | Completing or canceling an ordinary file action should preserve keyboard context. Repeated loss makes the next action harder to locate and use. |

Verification passed:

- `node test/artifacts/logs/interface58-repro-file-focus.mjs` observes the actual previous
  package, original bridge/controllers and native chooser response held then
  canceled. Welcome Open, draft Save and sidebar Open all leave the body focused;
  exact Unicode draft text survives. Native images and the observations remain.
- `npx playwright test --config test/artifacts/logs/interface58-negative.config.mjs` runs the
  final regression against that previous package. All four cases fail at the
  missing restored focus, under the original deadlines.
- `npx playwright test --config test/artifacts/logs/interface58-focused-corrected.config.mjs`
  passes four current built cases. They cover canceled Open/Save, immediate
  cancellation, a real directory-target save failure, retry, exact source, one
  Undo/Redo, exact saved bytes and a newly opened Unicode/BOM/CRLF file. New/Open
  focus the editor. Deliberate later keyboard input into Preferences or a pointer
  action that leaves the body focused prevents completion from stealing focus.
- `node test/artifacts/logs/interface58-inspect-native-ordered.mjs` verifies the fresh package
  in wide English, narrow Chinese/dark and 200% Chinese/light. Actual Tab after
  canceled welcome Open reaches Appearance; after canceled Save it reaches
  Document actions. Canceled Save As returns to its visible disclosure. A real
  failure exposes its message and focused Save in the native accessibility tree.
  Scoped toolbar/error axe scans have zero violations and zero incomplete checks.
- Complete Electron `capturePage` images were inspected for cancellation and
  failure, including the full 1160×1000 bitmap at 200% and the 320px dark state.
  Existing target sizes, text/focus/error contrast and wrapping pass the scoped
  checks. The original native-dialog focus lifecycle itself is not exercised by
  the substituted chooser responses.
- `npm run check` and 24 relevant document/workspace controller unit cases pass.
  The complete current package suite and byte bindings are recorded in
  VALIDATION.md. No existing application deadlines, quotas or regression
  thresholds are changed. Initial new-test diagnostics retain an incorrect
  uniform 14px button assumption, an implicit array type and a click on a heading
  whose focusable main ancestor invalidated the body-focus setup. The corrected
  case uses established toolbar typography and a real nonfocusable brand target.
  A separate native diagnostic initially advanced before Save As completed; the
  ordered version observes the chooser and enabled state before its next action.

Not verified: physical OS dialog focus, physical screen readers/IME/touch,
unrelated file actions, other native platforms or whole-product accessibility,
feature completeness and performance.

**Approve**, limited to the observed file-command states above. No HIGH or
unresolved finding remains in this scope. `test/artifacts/logs/interface58-validation.json`
binds the current source, retained diagnostics, images, native observations and
package evidence. The original full application goal remains active.

## Composition and keyboard context when changing writing modes — 2026-10-30 (UTC)

Scope: the open-document workspace from Source editing through a requested mode
change, translated-preview setup, return to Source and exact Save. The primary
task is retaining a writer's final composed text while moving between modes.
The existing design uses native controls, CodeMirror, React/Zustand and semantic
light/dark CSS tokens in apps/desktop/src/renderer/src/styles.css. This pass
retains its deliberate desktop density and changes the mode/focus lifecycle.

| Domain | Coverage and result |
| --- | --- |
| Accessibility | HIGH finding below resolved. Actual keyboard navigation, native accessibility-tree focused/pressed properties, scoped toolbar/reading-control axe scans and focus indicators inspected in all four states. |
| Layout | Native captures at 1160px, 320px, 200% zoom (1160 physical pixels / 580 CSS pixels) and an isolated RTL mirror. Mode controls wrap within the viewport; document/body widths do not overflow. |
| Writing | Existing English and Chinese Source/Live Preview/Translated preview names, shortcut labels and translation setup/retention guidance remain understandable in the observed flow. No additional copy finding. |
| Typography | Bundled fonts loaded before capture. Computed mode-button sizes are 12px; the established toolbar hierarchy remains readable in the inspected Chinese narrow and zoomed states. No additional finding. |
| Color | Actual computed mode-control text/background contrast is at least 6.46:1 across light/dark states. Tab-visible 2px focus outlines contrast at least 6.86:1 against their surrounding surface. No additional finding in these measured controls. |
| UI polish | Source remains visible while composition is pending; completed mode and keyboard context agree. Rapid requests apply the latest choice, and later Preferences interaction keeps focus. No additional scoped finding. |

| Rank | Severity | Finding, evidence and change | Why it matters | Status |
| --- | --- | --- | --- | --- |
| 1 | HIGH | Ctrl/Cmd+3 immediately hid an active source composition: the native Chromium witness saved provisional `shi` instead of final `世界` and focused the body. document.ts:274 now synchronizes pending input before applying the latest requested mode and rejects a disposed/locked continuation. DocumentWorkspace.tsx:54 routes buttons/shortcuts through that action and retains keyboard context without overriding later interaction. | Mode changes must retain the text being written and a usable keyboard destination. | Resolved; five former-package failures become five current-package passes. |

Verification:

- Current Windows directory package: actual CDP composition start/update/end,
  exact Save, Undo/Redo, programmatic mode activation, rapid mode requests,
  held DOM input and later Preferences focus. This is Chromium composition
  evidence, not physical OS IME acceptance.
- Four fresh native inspections: English/light 1160×850, Chinese/dark 320×850,
  Chinese/light 1160×1000 at 200%, and English/dark 980×820 with local RTL
  mirroring. Complete Electron capturePage bitmaps were inspected for pending
  composition, translated setup, keyboard focus and saved Source. Root/body
  horizontal overflow and renderer errors are absent in these observations.
- Translated mode exposes focused and pressed native AX properties. Actual Tab
  reaches Reading options; Shift+Tab returns to the mode button with the visible
  outline; Ctrl/Cmd+1 returns to the editor. Scoped document/preview/reading
  controls have zero axe violations and zero incomplete checks in each state.
- The initial diagnostic asserted :focus-visible immediately after a CDP IME
  commit, which produced a focused mode button without that pseudo-class. Its
  failed assertion and native captures remain retained. The final inspection
  records that immediate state and verifies the visible outline through actual
  Tab/Shift+Tab navigation; it does not claim a physical IME modality result.
- Initial pending-input tests installed their observer after editor construction.
  Their retained failures are superseded by tests installing it before Open;
  all five corrected tests fail against the former package and pass here.
- npm run check, 37 focused unit cases, 19,589 complete unit cases (one existing
  Windows POSIX-permissions skip), 130 packaged desktop cases and three packaged
  lifecycle/large-file cases pass. Evidence binds the reviewed source and package
  bytes; no quotas, application deadlines, retries or regression thresholds moved.

Not verified: physical OS IME, screen readers or other assistive technology,
touch, physical native-dialog focus, other operating systems, forced-colors in
this pass, unrelated settings/export/sync flows, or complete Live/performance
acceptance. RTL is a local mirroring stress test, not a claim of RTL localization.

**Approve**, limited to the observed mode-change writing flow. The resolved
finding leaves no HIGH or unresolved finding in this scope. The consolidated
test/artifacts/logs/pipeline75-validation-check.json binds source, native captures, observations,
tests and package; feature completeness and the full application goal remain open.
