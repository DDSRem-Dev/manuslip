# Single toolbar review

The window uses one 48px toolbar for workspace tools, editing, document tabs, editor
modes, Save, document actions and Preferences. The workspace starts closed and shows
one Files, Search or Outline view when opened. Native menu accelerators remain available.

Captured from the Electron application after the navigation refactor. Local screenshots are in
`apps/desktop/.impeccable/review/navigation/`:

- `desktop.png`: 1440 × 900, light theme, workspace closed.
- `dark.png`: 1440 × 900, dark theme.
- `edit.png`: editing commands and aligned keyboard shortcuts.
- `workspace.png`: optional workspace pane.
- `mobile.png`: 390 × 844.
- `compact.png`: 320 × 800, active tab and close action remain visible.

This directory is hidden, ignored design-tool state. The screenshots are optional local
evidence; the review and acceptance details are published here.

Validation passed: application build; repository lint, formatting and TypeScript checks;
53 targeted unit tests for contracts, IPC, documents and editor behavior; Electron tests
for native clipboard editing, undo/redo, tabs, file operations and recovery, workspace
restoration, search, outline, preferences, reading setup and writing modes.

Layout and accessibility checks cover light/dark themes, English/Chinese, RTL, 320px
windows, 200% zoom, forced colors and reduced motion. Popovers become inert when
dismissed so their exit animation cannot leave hidden controls interactive.
