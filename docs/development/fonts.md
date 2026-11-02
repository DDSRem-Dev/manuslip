# Offline East Asian fallback

The four WOFF2 faces in [manifest.json](../../apps/desktop/resources/fonts/manifest.json) derive from Noto Sans CJK SC
2.004. Together they retain all 44,810 mapped Unicode code points, variation
sequences and variable weights (100–900). Each face retains the OpenType glyph
closure needed by its characters. The CSS family `Manuslip CJK`
applies only to East Asian ranges, preserving the app's Latin and monospace faces.
The default Han forms follow Simplified Chinese; this is not a claim of complete
Unicode coverage or of regional typography for every language.

Copyright © 2014–2021 Adobe (http://www.adobe.com/), with Reserved Font Name
`Source`. The font remains under the [SIL Open Font License 1.1](../../apps/desktop/resources/fonts/OFL.txt).

Upstream, pinned to commit `523d033d6cb47f4a80c58a35753646f5c3608a78`:

- [NotoSansCJKsc-VF.ttf](https://github.com/notofonts/noto-cjk/blob/523d033d6cb47f4a80c58a35753646f5c3608a78/Sans/Variable/TTF/NotoSansCJKsc-VF.ttf)
- [License](https://github.com/notofonts/noto-cjk/blob/523d033d6cb47f4a80c58a35753646f5c3608a78/LICENSE)
- [Deployment formats](https://github.com/notofonts/noto-cjk/blob/523d033d6cb47f4a80c58a35753646f5c3608a78/Sans/README.md)

Source TTF: 36,144,788 bytes, SHA-256
`990c807e79c25662a5a9ecf7f971baeb2bf2eab9a559e5ecf15cdfdb8561d21f`.
The manifest records the bytes, SHA-256, code-point and glyph counts for each face.

The upstream cmap shares some glyphs between distinct characters, such as the
Han character `文` and the Kangxi radical `⽂`. Chromium's PDF exporter can reverse
that shared glyph into the wrong Unicode character. The preparation script
assigns each code point to exactly one face and keeps each face's nominal cmap
unambiguous. The small alias faces preserve the radical and other alternate
characters rather than remove them. CSS selects the faces by Unicode coverage;
Latin text continues to use the app's existing fonts.

Conversion uses Python 3.11, FontTools 4.64.0 and Brotli 1.2.0:

```sh
python scripts/build-cjk-font.py NotoSansCJKsc-VF.ttf --output-dir test/artifacts/logs/font-update
```

The script checks the pinned source hash, exact union of character mappings,
unambiguous nominal mappings, variation sequences and weight range after writing
and reopening every WOFF2. Copy its `.woff2` files to `resources/assets/`, its
manifest to this directory and its `fonts.css` to `src/renderer/`, then format the
CSS/JSON with the project's Biome version. Run the font/export browser cases;
they inspect actual painted fonts and PDF glyph paths and text maps.

FontTools is needed only when updating this checked-in asset. App builds and
runtime need no font downloads or Python. Vite copies `resources/` into the
renderer output; both the application and isolated diagram/print origins serve
the same files. HTML export embeds them and this license directly when the
rendered copy contains East Asian characters. Latin-only HTML stays small.
PDF uses the loaded faces and Chromium's font embedding.
