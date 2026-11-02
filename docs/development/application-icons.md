# Application icon

![Manuslip application icon](../../apps/desktop/build/icon.svg)

The Manuslip mark shows a hand-turned manuscript with bowing pages, a flowing spine
and a curled paper tip. The curved gutter, asymmetric leaves and tapered lower edges
express the gesture of handling flexible paper. The name's
[`manu-` root means "by hand"](https://www.etymonline.com/word/manuscript).
The open pages represent writing and reading; the lifted leaf suggests a paper slip
in motion and words carried across languages. Warm ivory and sage paper sit on a
deep green ink field. The sense of movement comes from the static silhouette.
The SVG uses vector geometry and restrained color gradients, with no fonts,
linked images or external resources.

`apps/desktop/build/icon.svg` is the editable source. Generated assets are checked in:

| Asset | Use |
| --- | --- |
| `build/icon.svg` | Canonical artwork; welcome screen, favicon and repository readmes |
| `build/icon.ico` | Windows executable, installer, uninstaller, shortcuts and Markdown association |
| `build/icon.icns` | macOS application bundle |
| `build/icons/*x*.png` | Linux desktop integration; 16, 24, 32, 48, 64, 128, 256 and 512 pixels |
| `out/main/icon.png` | Main application window; copied from the 512-pixel PNG during build |

After editing the SVG, run from the repository root:

```sh
npm run icons
npm run icons -- --check
npm run build
```

Generation uses the pinned electron-builder portable icon converter. Its initial use
may download the packager's checksum-verified icon toolset. No new image library or
native graphics dependency is required. `build/icons.json` records the source and
generator hashes, converter version, and every generated asset's size/hash. Application
builds check that manifest before compiling and fail if it is stale. Commit the SVG,
generated assets and manifest together. The assets follow the repository's MIT license.

The packager configuration explicitly selects each platform's asset. The window PNG
is copied into `out/main` for both development and packaged launches, so the application
does not depend on an unpackaged build directory at runtime. See the packager's
[icon documentation](https://www.electron.build/docs/features/icons-and-images/).

On Windows, `npm run test:installer` verifies all seven embedded ICO images in the
installer, installed executable and uninstaller against the generated icon. Each
installed launch also queries the real window's native icon through `WM_GETICON`,
compares its complete image against the source PNG with a small allowance for native
resampling, and saves the observed icon beside its installer report. All evidence goes
under `test/packaging/results/windows-installer-*`. The source/configuration check alone does not prove
the visible OS result.

Windows packaging and installed-window checks have been executed locally. macOS and
Linux assets are generated; their bundle/desktop behavior still requires those platforms'
build and acceptance runs. Code signing and distribution remain separate release gates.

