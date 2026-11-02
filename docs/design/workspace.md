# Desktop writing workspace

Mode: Operate. Build: code-first. The user pinned Typora as the design reference.

The first viewport gives the local document most of the window. One 48px toolbar aligns
workspace, file and Edit controls with quiet tabs, editor modes, Save, document actions
and Preferences. The initial window is 1360 × 900px, bounded by the display's work area.
The workspace starts closed. Opening it shows equal 240px panes, with folders on the left
and the document outline on the right. Both pane headings align. When a folder is open,
a small search button sits immediately left of Open folder in the Files heading and
opens search in the left pane; closing it restores the folder tree. Without an open
folder, shortcuts show the folder chooser with Close search; closing focuses Open folder.
Both file and workspace search shortcuts start with filenames and paths. Content search
requires selecting Saved file contents. Filename results contain each relative path once,
retain distinct files with the same name, and accept Windows or forward-slash paths on Windows.
The workspace folder has a separate close button on its right, visible when collapsed.
Its path appears only at the top of its expanded contents. Closing releases the catalog
and search and persists the closed state while retaining recent folders and open drafts.
Folder and outline guides use 16px indentation. The outline nests headings under their
nearest shallower parent and uses filled, open-circle, and square punctuation.
There is no workspace category switcher or manual Refresh control. Filesystem events
and window focus reconcile folder contents while preserving unchanged rows, expanded
folders, loaded pages and drafts. Narrow windows place folders and outline in equal halves
in an overlay below the toolbar, with search using the overlay's width when opened.
Secondary document and editing commands use native popovers. Preferences has separate
General, Editor, Translation and Plugins views in a native dialog. A fixed header and search
sit above a navigation rail and scrolling content; narrow windows put navigation in a row.
Preferences also opens from welcome and with Ctrl/Cmd+comma. Source display preferences
persist, as does the default reading layout. Translation offers quick section
navigation, saved-provider readiness, language suggestions, explicit Save/Discard, and feedback
beside the relevant action. Windows and Linux hide the
native menu bar while retaining shortcuts; macOS keeps the system menu.

Use a white writing surface, a subtly contrasting sidebar, charcoal text, compact system
UI typography and an approximately 740px prose measure. Dark mode uses neutral charcoal
surfaces. Phosphor regular icons inherit currentColor; decorative icons are hidden from
assistive technology. Keep actual action names and consequential permission explanations.

The signature interaction is opening a secondary layer with a short 4px transition and
opacity fade. Pointer-opened dialogs and menus use a 180ms exponential ease-out, with a
matching dialog backdrop fade. Each opening and closing action captures its input method;
closed layers become inert immediately. Keyboard interactions remain immediate, and
reduced motion removes spatial transitions. Typing, mode changes, tab switching and
document text never animate. Selection backgrounds follow selected text, join the full
line height without gaps, and avoid filling line tails or tinting the final row. Live prose
preserves source newlines through caret movement, text selection and selection collapse.
Rendered prose aligns with editable prose without extra per-paragraph controls. Chinese
language choices use 简体中文 and 繁體中文. Live text selections reveal the affected inline syntax,
including paired markers for selected body words and original paragraph line breaks.
Collapsing them restores formatting while keeping source newlines. Carets and ordinary clicks keep
widgets rendered; Select source explicitly selects their original source range.
Range endpoints stay exclusive, including backward and disjoint selections. Images preserve proportions;
formulas and whole-word table cells scroll within their accessible regions.

Reference evidence: Typora's local resources/style/window.css (240px sidebar, quiet footer,
compact file and outline rows), whitey.css (bounded document measure and breathing room),
and night.css (neutral dark reading surfaces). These inform conventions; no proprietary
Typora source or assets are shipped.

The footer keeps cursor position and a word-count disclosure beside the local HH:mm time.
The clock updates each minute and on window focus. Its compact detail popover
retains word and character statistics, file encoding, line endings, text size and the full
path, without a text-size calculation note. Document actions groups utility tools separately, and plugin commands appear only
for installed, enabled plugins. Focus and typewriter modes are retired.

Required verification: writing and source modes, translated reading and setup, preferences
navigation, tabs and their close controls, native clipboard editing, undo and redo,
long paths, keyboard search from a hidden sidebar, Chinese, RTL,
forced colors, reduced motion, narrow windows and 200% zoom. The toolbar stays one row
from 320px upward; below 58rem New and Open remain available in document actions.
