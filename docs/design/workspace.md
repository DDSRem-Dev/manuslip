# Desktop writing workspace

Mode: Operate. Build: code-first. The user pinned Typora as the design reference.

The first viewport gives the local document most of the window. One 48px toolbar aligns
workspace, file and Edit controls with quiet tabs, editor modes, Save, document actions
and Preferences. The workspace starts closed. Its optional 240px pane shows one Files,
Search or Outline view at a time; narrow windows use an overlay below the toolbar.
Secondary document and editing commands use native popovers. Preferences has separate
General, Translation and Plugins views in a native dialog. Windows and Linux hide the
native menu bar while retaining shortcuts; macOS keeps the system menu.

Use a white writing surface, a subtly contrasting sidebar, charcoal text, compact system
UI typography and an approximately 740px prose measure. Dark mode uses neutral charcoal
surfaces. Phosphor regular icons inherit currentColor; decorative icons are hidden from
assistive technology. Keep actual action names and consequential permission explanations.

The signature interaction is opening a secondary layer with a short 4px transition.
Pointer-opened dialogs and menus use a 180ms exponential ease-out. Keyboard interactions
remain immediate, and reduced motion removes spatial transitions. Typing, mode changes,
tab switching and document text never animate.

Reference evidence: Typora's local resources/style/window.css (240px sidebar, quiet footer,
compact file and outline rows), whitey.css (bounded document measure and breathing room),
and night.css (neutral dark reading surfaces). These inform conventions; no proprietary
Typora source or assets are shipped.

Required verification: writing and source modes, translated reading and setup, preferences
navigation, tabs and their close controls, native clipboard editing, undo and redo, focus
and typewriter modes, long paths, keyboard search from a hidden sidebar, Chinese, RTL,
forced colors, reduced motion, narrow windows and 200% zoom. The toolbar stays one row
from 320px upward; below 58rem New and Open remain available in document actions.
