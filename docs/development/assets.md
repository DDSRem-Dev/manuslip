# Offline application assets

## Icons

[icon.svg](../../apps/desktop/build/icon.svg) is the editable application mark.
Regenerate and verify platform assets after changing it:

```sh
npm run icons
npm run icons -- --check
```

Commit the SVG, ICO, ICNS, Linux PNG sizes and `apps/desktop/build/icons.json` together.
The manifest records source/generator hashes and output sizes/hashes; builds reject stale
assets. Generation uses the pinned electron-builder icon converter, whose first use may
download its checksum-verified toolset. The artwork follows the repository's MIT license.
The window icon is copied into `out/main`; installers use the platform assets in `build/`.

## Bundled dependency notices

Vite generates `THIRD-PARTY-NOTICES.txt` in `out/main`, `out/preload` and `out/renderer`
from the installed packages contributing code to each bundle. These files include full
upstream license text, including Mermaid's MIT copyright and permission notice even though
Mermaid is a development dependency. Ordinary and release packages include these notices
through the `out/**` packaging rule. Rebuild application assets after dependency updates.

## Fonts

The [font manifest](../../apps/desktop/resources/fonts/manifest.json) describes the offline
Noto Sans CJK SC 2.004 WOFF2 faces. They retain the upstream 44,810 mapped code points,
variation sequences and variable weights 100–900. The `Manuslip CJK` CSS family applies
only to East Asian ranges. Default Han forms follow Simplified Chinese.

Pinned source: [NotoSansCJKsc-VF.ttf](https://github.com/notofonts/noto-cjk/blob/523d033d6cb47f4a80c58a35753646f5c3608a78/Sans/Variable/TTF/NotoSansCJKsc-VF.ttf),
commit `523d033d6cb47f4a80c58a35753646f5c3608a78`, 36,144,788 bytes,
SHA-256 `990c807e79c25662a5a9ecf7f971baeb2bf2eab9a559e5ecf15cdfdb8561d21f`.
Copyright © 2014–2021 Adobe, Reserved Font Name `Source`; preserve the
[SIL OFL 1.1 license](../../apps/desktop/resources/fonts/OFL.txt).

To rebuild, use Python 3.11, FontTools 4.64.0 and Brotli 1.2.0:

```sh
python scripts/build-cjk-font.py NotoSansCJKsc-VF.ttf --output-dir test/benchmark/result/font-update
```

The script verifies the source hash, complete character coverage, variation sequences,
weight range and unambiguous nominal mappings after reopening each output. Separate alias
faces prevent Chromium PDF export from mapping shared glyphs to the wrong Unicode character.
Copy generated WOFF2 files into `apps/desktop/resources/assets/`, the manifest into
`apps/desktop/resources/fonts/` and `fonts.css` into `apps/desktop/src/renderer/`.
Run the font and export browser tests, which inspect painted fonts and PDF text maps.
Normal builds need neither Python nor font downloads. HTML export embeds the fonts and
license when East Asian text is present; PDF embeds loaded faces.

Linux native menus and dialogs need the original TTF because they initialize outside the
renderer CSS font system. Packaging installs a `manuslip` launcher around `manuslip-bin`.
Unless Fontconfig variables were explicitly supplied, it creates a checksum-verified private
font cache under `$XDG_CACHE_HOME/Manuslip/native-fonts` or `~/.cache/Manuslip/native-fonts`.
Its configuration includes the host configuration; failure falls back to the host fonts.
No global or per-user font installation is changed. Keep the TTF and OFL notice in Linux
packages, outside ASAR. See [Fontconfig configuration](https://fontconfig.pages.freedesktop.org/fontconfig/fontconfig-user.html).

## Spelling dictionary

Windows/Linux use the unchanged `en-US-10-2.bdic` from Electron 45.0.0's
[dictionary release archive](https://github.com/electron/electron/releases/download/v45.0.0/hunspell_dictionaries.zip).
macOS uses its system spellchecker.

| Asset | Size / SHA-256 |
| --- | --- |
| Release archive | `8bb83d71a627b82d27133a668e4fc2c59e6d9a1fed123918f9ebb49f8bdf6322` |
| Dictionary | 451,982 bytes; `b0d80e6b6c5491879365e176ecbd98074602a663429bcfcfb0a5a8375c051f13` |

Preserve `LICENSE`, `COPYING.MIT` and `README_en_US.txt` beside the dictionary in
`apps/desktop/vendor/dictionaries/`, including all SCOWL/Ispell wordlist attributions.
The app verifies bytes/hash before seeding Chromium's private dictionary cache and uses
a packaged local URL. When upgrading Electron, update the artifact, notices and constants
in `apps/desktop/src/main/spellcheck.ts`, then run offline spelling tests on each platform.
