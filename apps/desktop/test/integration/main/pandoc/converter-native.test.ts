import { beforeAll, expect, it } from 'vitest'
import { inspectPandocBinary, type PandocTool } from '../../../../src/main/pandoc/binary'
import { convertWithPandoc } from '../../../../src/main/pandoc/converter'
import { readPandocZip } from '../../../../src/main/pandoc/zip'

const path = process.env.MANUSLIP_TEST_PANDOC
let tool: PandocTool
beforeAll(async () => {
  if (path)
    tool = { ...(await inspectPandocBinary(path, new AbortController().signal)), version: '3.13' }
})
const pixel =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j0XcAAAAASUVORK5CYII='
const html = `<!doctype html><html lang="en"><head><meta charset="UTF-8"><title>Captured title</title></head><body><h1>Hello 中文</h1><p>Exact <strong>editable</strong> text 😀.</p><table><tr><th>Original</th><th>Translation</th></tr><tr><td>Source</td><td>译文</td></tr></table><p><img alt="x squared" src="data:image/png;base64,${pixel}"></p><h2>Second heading</h2><p>Final note.</p></body></html>`
for (const locale of ['en', 'zh-CN'] as const)
  for (const format of ['docx', 'epub', 'latex'] as const)
    for (const profile of ['document', 'numbered'] as const)
      it.runIf(path)(
        `converts real local Pandoc ${locale}/${format}/${profile} with text, table and exact embedded media`,
        async () => {
          const output = await convertWithPandoc(
            tool,
            html.replace('lang="en"', `lang="${locale}"`),
            { format, profile },
            new AbortController().signal,
          )
          const files = readPandocZip(output)
          const text = [...files]
            .filter(([name]) => /\.(?:xml|xhtml|html|tex)$/.test(name))
            .map(([, bytes]) => bytes.toString('utf8'))
            .join('\n')
          for (const fragment of [
            'Hello',
            '中文',
            'editable',
            'Original',
            'Translation',
            '译文',
            'Final note',
          ])
            expect(text).toContain(fragment)
          expect(
            [...files.values()].some((bytes) => bytes.equals(Buffer.from(pixel, 'base64'))),
          ).toBe(true)
          if (format === 'latex') {
            expect(files.has('document.tex')).toBe(true)
            expect(files.get('document.tex')?.toString()).toContain('media/')
            expect(files.get('README.txt')?.toString()).toContain('media folder')
          }
        },
        30_000,
      )
