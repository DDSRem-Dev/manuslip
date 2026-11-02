# Native Linux font fallback

Linux menus and GTK file dialogs do not use the renderer's CSS fonts. The
native font system in the recorded Ubuntu environment cannot load WOFF2, and
Electron initializes it before application JavaScript. Linux packaging therefore
keeps the real ELF executable as `manuslip-bin` and installs a small `manuslip`
launcher that configures native fonts before executing it.

`NotoSansCJKsc-VF.ttf` is the unchanged Noto Sans CJK SC 2.004 source used to
prepare the web fonts. It retains all 44,810 mapped code points, 65,535 glyphs
and variable weights 100–900. Default Han forms follow Simplified Chinese;
complete Unicode and all regional typography are not claimed.

- Upstream commit: `523d033d6cb47f4a80c58a35753646f5c3608a78`
- [Source](https://github.com/notofonts/noto-cjk/blob/523d033d6cb47f4a80c58a35753646f5c3608a78/Sans/Variable/TTF/NotoSansCJKsc-VF.ttf)
- Bytes: 36,144,788
- SHA-256: `990c807e79c25662a5a9ecf7f971baeb2bf2eab9a559e5ecf15cdfdb8561d21f`
- Copyright © 2014–2021 Adobe (http://www.adobe.com/), with Reserved Font Name
  `Source`; licensed under SIL OFL 1.1. Packaging includes the full license from
  `resources/fonts/OFL.txt` alongside the TTF.

The launcher preserves arguments, working directory, umask and explicit
`FONTCONFIG_FILE`, `FONTCONFIG_PATH` or `FONTCONFIG_SYSROOT` settings. Otherwise
`prepare-fonts.sh` keeps a checksum-verified font and license in the app's private
cache under `$XDG_CACHE_HOME/Manuslip/native-fonts` (or `~/.cache/Manuslip/native-fonts`).
It writes an atomic configuration with absolute escaped paths, includes the
existing `/etc/fonts/fonts.conf` and places font metadata caches in the same
private app cache. This also works with older Fontconfig releases that do not
resolve relative font directories. The content hash gives the cached font a
stable path across AppImage mounts and concurrent launches. A damaged cached
font is repaired; a cache failure retains the host font configuration and lets
the application start.

No system/per-user font installation or global font configuration is changed.
The font becomes available only to this application and its child processes.
The resource is copied only into Linux packages and is outside ASAR; Windows
and macOS packages retain the existing web-font resources.

See the [Fontconfig configuration reference](https://fontconfig.pages.freedesktop.org/fontconfig/fontconfig-user.html)
for configuration, include, cache and environment semantics.
