import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseMarkdown } from '@manuslip/core'
import { renderMarkdown } from '@manuslip/renderer'
import { beforeAll, expect, it } from 'vitest'
import { pandocFixture, pandocTestPath } from '../../../../../../test/helpers/pandoc'
import type { PandocTool } from '../../../../src/main/pandoc/binary'
import { convertWithPandoc } from '../../../../src/main/pandoc/converter'
import { PandocRepository } from '../../../../src/main/pandoc/repository'
import { PandocTools } from '../../../../src/main/pandoc/tools'
import { readPandocZip } from '../../../../src/main/pandoc/zip'

const path = pandocTestPath()
let tool: PandocTool, html: string
function documentHtml(source: string): string {
  const rendered = renderMarkdown(parseMarkdown(source).root, {
    rawHtml: false,
    footnotesLabel: 'Notes',
    footnoteBackLabel: 'Back',
  })
  return `<!doctype html><html lang="en"><head><meta charset="UTF-8"><title>Captured title</title></head><body>${rendered.html}</body></html>`
}
beforeAll(async () => {
  const directory = await mkdtemp(join(tmpdir(), 'manuslip-pandoc-examples-'))
  try {
    const repository = new PandocRepository(join(directory, 'pandoc.json'))
    await repository.load()
    const tools = new PandocTools(repository)
    await tools.select(
      1,
      async () => path,
      () => {},
    )
    tool = tools.capture()
    html = documentHtml(await pandocFixture('conversion'))
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})
const pixel =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j0XcAAAAASUVORK5CYII='
for (const locale of ['en', 'zh-CN'] as const)
  for (const format of ['docx', 'epub', 'latex'] as const)
    for (const profile of ['document', 'numbered'] as const)
      it(`converts real local Pandoc ${locale}/${format}/${profile} with text, table and exact embedded media`, async () => {
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
      }, 30_000)

for (const format of ['docx', 'epub', 'latex'] as const)
  it(`preserves escaped prose, external links and repeated footnotes in a ${format} document without media`, async () => {
    const source = await pandocFixture('references')
    const output = await convertWithPandoc(
      tool,
      documentHtml(source),
      { format, profile: 'document' },
      new AbortController().signal,
    )
    const files = readPandocZip(output)
    expect([...files.keys()].filter((name) => /\.(?:png|jpe?g|gif|webp)$/.test(name))).toEqual([])
    if (format === 'docx') {
      const body = files.get('word/document.xml')?.toString() || ''
      expect(body).toContain('&lt;tag&gt;')
      expect(body.match(/<w:footnoteReference\b/g)).toHaveLength(2)
      const notes = files.get('word/footnotes.xml')?.toString() || ''
      const noteText = [...notes.matchAll(/<w:t\b[^>]*>([^<]*)<\/w:t>/g)]
        .map((match) => match[1])
        .join('')
      expect(noteText.match(/Footnote 世界 &amp; protected prose\./g)).toHaveLength(2)
      expect(files.get('word/_rels/document.xml.rels')?.toString()).toContain(
        'https://example.invalid/guide?first=1&amp;second=2',
      )
    } else if (format === 'epub') {
      const chapters = [...files]
        .filter(([name]) => name.endsWith('.xhtml'))
        .map(([, bytes]) => bytes.toString())
        .join('\n')
      expect(chapters).toContain('&lt;tag&gt;')
      expect(chapters.match(/epub:type="noteref"/g)).toHaveLength(2)
      expect(chapters).toContain('Footnote 世界 &amp; protected prose.')
      expect(chapters).toContain('https://example.invalid/guide?first=1&amp;second=2')
    } else {
      const tex = files.get('document.tex')?.toString() || ''
      expect(tex.match(/\\footnote\{/g)).toHaveLength(2)
      expect(tex.match(/\\footnote\{Footnote 世界 \\&\s+protected prose\.\}/g)).toHaveLength(2)
      expect(tex).toContain('\\href{https://example.invalid/guide?first=1&second=2}')
      expect(tex).toContain('textless')
      expect(tex).toContain('textgreater')
    }
  }, 30_000)
