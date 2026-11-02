# ADR 005: Focus and typewriter writing modes

Status: retired, 2026-11-02. Focus and typewriter modes have been removed at the user's request.
Saved typewriter preferences are discarded while preserving other editor and reading settings.
The original decision and validation below are historical.

Delivery follows the 2026-10-31 goal update: complete useful features and refine the interface; exact historical latency targets remain improvement goals.

Focus mode gives the active document the window: hide workspace navigation, tabs and the ordinary file/mode toolbars. Keep a small, named toolbar with the filename, save state, Save and Exit focus mode, plus all conflicts, recovery notices, errors, translation controls and native dialogs. The current source/reading surface stays mounted. Escape exits focus only when it is not needed by an active popover, composition, search, replace or paste interaction. Entry and exit preserve the text, selection, undo and current mode; keyboard users have a visible exit. These are per-window session modes, separate from document bytes and provider settings.

Typewriter mode keeps the primary source caret near the vertical middle while typing or moving the selection, including at the beginning and end of the document. An editor extension owns viewport padding and a scheduled CodeMirror measurement. It never rewrites source, selection, undo, semantic state or translation. Recenter on selection/document changes, focus, composition completion and viewport resizing; allow manual scrolling until the next such action. Avoid smooth scroll and per-scroll centering. Multiple selections remain unchanged; use the main caret as the scrolling anchor. Keep the option while reading, but apply it only to the source editor. Remove all extension styling when disabled or destroyed.

The writing options belong in the existing Document actions disclosure. The focus toolbar exposes both Exit and the typewriter setting so focus mode cannot hide its own controls. Switching tabs with the native commands retains the per-window choices and each document's existing input synchronization. Toggling typewriter waits for pending source input, with latest-request and disposal guards.

Verify real packaged Source and Live editing, caret geometry at both document edges and after resize, manual scrolling, multi-selection/history, save/reopen, composition, switching documents and mode restoration. Review light/dark/narrow and Chinese labels, keyboard entry/exit and focus ownership. Use existing core fidelity/security/resource checks. No new renderer capability, network access or IPC channel is required.

The implementation passes six packaged Source/Live cases with 18 exact save snapshots and two reopen checks. Separate English/Chinese flows verify independent typewriter use, the same mounted reading pane, keyboard entry/exit focus and return to Source. Six current-package UI states have no axe violation or root overflow, including 320 CSS pixels and 200% zoom. Queued measurements reject disposed plugins and remove their owned padding property.

The current validation covers 19,629 passing unit cases through the full run plus a 36-case focused confirmation, and 145 packaged cases through 144 full-run passes plus one corrected synthetic pending-input case on the identical package. Neither is presented as a single fully green current full run. Existing 50-cycle and 50 MiB/5 MiB resource/fidelity checks pass. Exact evidence and automation boundaries are in VALIDATION.md and /test/artifacts/logs/pipeline95-validation.json. Remaining M4 features and broader platform validation stay active.
