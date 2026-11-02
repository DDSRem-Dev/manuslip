import { readFile } from 'node:fs/promises'
import fontManifest from '../../../resources/fonts/manifest.json'
import license from '../../../resources/fonts/OFL.txt?raw'
import fontStyle from '../../renderer/fonts.css?raw'

/** Only this fixed, bundled resource is embedded; manuscript URLs cannot select fonts. */
export async function exportFontStyle(html: string): Promise<string> {
  // Latin-only copies remain small. Inspect the rendered copy, including translated
  // reading text and diagram labels, rather than only the original manuscript.
  if (
    !/[\p{Script=Han}\p{Script=Hangul}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Bopomofo}\u2e80-\u33ff\ufe10-\ufe1f\ufe30-\ufe4f\uff00-\uffef]/u.test(
      html,
    )
  )
    return ''
  const fonts = await Promise.all(
    fontManifest.files.map(async (font) => ({
      name: font.name,
      bytes: await readFile(new URL(`../renderer/assets/${font.name}`, import.meta.url)),
    })),
  )
  let style = fontStyle
  for (const font of fonts)
    style = style.replace(
      `/assets/${font.name}`,
      `data:font/woff2;base64,${font.bytes.toString('base64')}`,
    )
  return `${style}\n/* Copyright 2014-2021 Adobe (http://www.adobe.com/), with Reserved Font Name 'Source'.\n${license} */`
}
