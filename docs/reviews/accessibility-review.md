# Document tabs and keyboard focus review

Reviewed on 2026-10-28 in the built and packaged Windows application. This review covers
document tabs, their close actions, the file-action group, the editor Tab stop and the
Preferences dialog. It does not certify every application screen or assistive technology.

## Structure and keyboard behavior

| Severity | Location | Before | After | Why |
| --- | --- | --- | --- | --- |
| HIGH, resolved | `apps/desktop/src/renderer/src/DocumentTabs.tsx` | The tab list owns document tabs and ordinary close buttons. Axe reports invalid required children, and Chromium exposes the invalid ownership. | The named navigation landmark contains a tab list owning only tabs and a sibling container owning the close buttons. CSS places each close button beside its document. | Composite roles must expose the promised structure so assistive technology can navigate the documents reliably. |
| MEDIUM, resolved | `apps/desktop/src/renderer/src/DocumentTabs.tsx` | Removing or disabling the focused close button can leave focus in the editor or on the document body. | A completed close focuses the selected tab, or main content after the final tab. A canceled close restores its close button. Later keyboard or pointer input cancels restoration. | Keyboard users keep a predictable place after a control disappears, without losing a later focus choice. |
| MEDIUM, resolved | `apps/desktop/src/renderer/src/DocumentWorkspace.tsx` | File actions claim `toolbar`, but use the ordinary Tab sequence and nested export controls without the toolbar keyboard pattern. | A native, named `fieldset` exposes a group and preserves normal button navigation. | The role now matches the interaction users receive. |

The editor's existing contenteditable surface also declares `tabindex="0"`. Axe 4.14's
scroll-region check does not count an implicit contenteditable descendant as focusable.
The explicit attribute makes the existing editor focus target discoverable to that check;
it does not add a second control or make the scroll wrapper a Tab stop. Both 320px and
1160px checks reach the editor through the actual Tab sequence and bring it into view.

## Verification

The pinned development-only `axe-core` 4.14.0 runs inside the real renderer without
changing CSP. It is excluded from the distributed application. A negative run against
the preceding packaged release finds two close buttons inside the tab list. The new
regression also reproduces the lost-focus behavior before the focus correction.

The rebuilt package passes all 74 UI flows. The added regression verifies actual Chromium
accessibility-tree children, wrapping arrow navigation, Home/End, Tab/Shift+Tab, close-button
placement at 320px and 1160px, editor keyboard access, Preferences focus trapping and Escape
restoration, closing an inactive file without losing edits, the final close, canceling a
dirty close, and preserving focus moved while a close waits. Existing coverage checks both
themes, Chinese labels, 200% zoom, visible tab focus and tab-control text contrast.

A separate packaged survey records full axe results, Chromium accessibility trees and
screenshots for welcome, editing, two tabs, Preferences in light and dark themes, and
reading setup. All six states have zero reported violations. The trees expose only tabs
under the tab list and expose File actions as a named group. These are sampled states,
not every content or application configuration.

Automated incomplete results remain visible in the evidence. They concern contrast of
symbolic glyphs (the decorative offline symbol and unsaved dot) and matching the visible
close multiplication sign to its accessible action name. The symbols have their existing
decorative/status purposes and close buttons name their document. These incomplete checks
are not counted as automated passes or physical screen-reader acceptance.

Physical screen-reader announcements, platform assistive-technology behavior, physical IME
input and hardware acceptance: **Not verified**. The present review makes no claim about
those release gates. No color palette or semantic transport/admission limits change.

Source-bound release evidence is recorded in `test/artifacts/logs/tab-accessibility-validation-check.json`
and checked by `test/artifacts/logs/verify-tab-accessibility.mjs`. The original binary and installer are
archived in `test/artifacts/logs/tab-accessibility-before/`; audit JSON, trees, screenshots and all logs
remain under `test/artifacts/logs/`.

**Approve** for the inspected automated and keyboard coverage. Physical assistive-technology
acceptance remains open.

## Responsive workspace and file actions — 2026-10-29

The narrow workspace uses a native button with aria-controls and aria-expanded. Hidden
navigation leaves the Tab sequence; keyboard activation reopens it and closing retains
toggle focus. Native navigation commands reveal it, and focused workspace controls remain
available when narrowing the window. File actions retain a named fieldset and ordinary
Tab order, including nested export actions. Focus brings each action fully into view.
Export feedback and confirmations sit outside the horizontal scroller.

Both themes pass the new 360px/320px English/Chinese regression, which checks actual content
intersection, every action through Tab, reverse navigation, disclosure state/focus, export
feedback and focused-navigation resize. Existing packaged accessibility, contrast, modal,
zoom and complete feature flows also pass (77 total). The current nine-state axe/tree
survey at D:\Project\user\Nazumeki\manuslip\test/artifacts/logs\ui-shell-design-audit-QEkEqJ records zero violations. Contrast of symbolic glyphs and
visible close-symbol/name matching remain incomplete automated checks, as before.
Physical assistive-technology announcements, hardware IME, forced colors and other native
platforms remain unverified. This review covers the inspected automated/keyboard behavior.
