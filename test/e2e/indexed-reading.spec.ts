import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { parseMarkdown } from '@manuslip/core'
import {
  expandReadingIndex,
  readingBlocks,
  readingProjectionBytes,
  renderReading,
} from '@manuslip/renderer/reading'
import { extractTranslation, reconstructTranslation } from '@manuslip/translate'
import { _electron as electron, expect, test } from '@playwright/test'
import { build, preview } from 'vite'
import type {} from './fixtures/reading-memory/fixture'

async function setup() {
  await mkdir('test/e2e/result', { recursive: true })
  const profile = await mkdtemp(resolve('test/e2e/result/indexed-reading-profile-'))
  const config = {
    configFile: false as const,
    root: resolve('test/e2e/fixtures/reading-memory'),
    logLevel: 'silent' as const,
    base: './',
    build: { outDir: resolve('test/e2e/result/indexed-reading-build'), emptyOutDir: false },
    worker: { format: 'es' as const },
    resolve: { conditions: ['worker', 'module', 'browser', 'development|production'] },
  }
  await build(config)
  const server = await preview({ ...config, preview: { host: '127.0.0.1', port: 0 } })
  const address = server.httpServer.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture address')
  const app = await electron.launch({
    args: [resolve('test/e2e/fixtures/reading-memory/main.cjs')],
    env: {
      ...process.env,
      MANUSLIP_READING_MEMORY_PROFILE: profile,
      MANUSLIP_READING_MEMORY_URL: `http://127.0.0.1:${address.port}/index.html`,
    },
  })
  const page = await app.firstWindow(),
    errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.waitForFunction(() => Boolean(window.readingMemory))
  return {
    page,
    errors,
    async close() {
      try {
        await page.evaluate(() => window.readingMemory.clearView())
        await app.close()
      } finally {
        await server.close()
        await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
      }
    },
  }
}
const options = { rawHtml: true, footnotesLabel: 'Notes', footnoteBackLabel: 'Back' }
function projection(source: string, layout: 'side-by-side' | 'interlinear') {
  const root = parseMarkdown(source).root,
    plan = extractTranslation(root, source)
  const rebuilt = reconstructTranslation(
    plan,
    new Map(
      plan.units.map((unit) => [
        unit.occurrenceId,
        unit.payload ? `Translated ${unit.payload.text}` : undefined,
      ]),
    ),
  )
  return renderReading(root, rebuilt.root, options, {
    layout,
    blocks: readingBlocks(root, source),
    units: plan.units,
    sourceLanguage: 'en',
    targetLanguage: 'ar',
    labels: { original: 'Original', translation: 'Translation' },
    translated: new Set(plan.units.map((unit) => `${unit.from}:${unit.to}`)),
    indexAboveBytes: 0,
  })
}
test('large indexed bilingual copies preserve the complete index and reach distant blocks in both layouts', async () => {
  test.setTimeout(60000)
  const fixture = await setup()
  try {
    const chunk = `${'> > > > > > > > Nested writing with **emphasis**, `code`, a [link][r] and enough prose to keep reading. '.repeat(3)}\n\nSeparate context.\n\n`
    const source = `# nested-containers\n\n${chunk.repeat(Math.ceil(1048576 / Buffer.byteLength(chunk)))}\n[r]: https://example.invalid/\n`
    let previous: string | undefined
    let lastId: string | undefined
    for (const layout of ['side-by-side', 'interlinear'] as const) {
      const value = projection(source, layout)
      expect(value.indexed?.order).toHaveLength(6299)
      expect(readingProjectionBytes(value)).toBeLessThan(8 * 1024 * 1024)
      // Keep anchors identical across layout changes, as the production controller does.
      if (previous) value.blocks = JSON.parse(previous)
      previous = JSON.stringify(value.blocks)
      await fixture.page.evaluate((value) => window.readingMemory.show(value), value)
      if (lastId)
        await expect(fixture.page.locator(`[data-reading-block="${lastId}"]`)).toBeVisible()
      for (const at of [0, 3150, 6298]) {
        const id = value.blocks?.[at]?.id
        if (!id) throw new Error('Missing block')
        expect(await fixture.page.evaluate((id) => window.readingMemory.reveal(id), id)).toBe(true)
        const block = fixture.page.locator(`[data-reading-block="${id}"]`)
        await expect(block).toBeVisible()
        await expect(block.locator('.reading-original')).toHaveCount(1)
        await expect(block.locator('.reading-translation')).toHaveCount(1)
        await expect(block.locator('.reading-translation')).toContainText('Translated')
        expect(
          (await fixture.page.evaluate(() => window.readingMemory.view())).rows,
        ).toBeLessThanOrEqual(64)
        lastId = id
      }
    }
    await fixture.page.evaluate(() => window.readingMemory.clearView())
    await fixture.page.requestGC()
    await expect
      .poll(() => fixture.page.evaluate(() => window.readingMemory.collectedView()))
      .toEqual({ observed: 3, alive: 0, closed: 1 })
    expect(await fixture.page.evaluate(() => window.readingMemory.view())).toMatchObject({
      rows: 0,
      registered: false,
      text: '',
    })
    expect(fixture.errors).toEqual([])
  } finally {
    await fixture.close()
  }
})
test('Unicode footnote links reach offscreen definitions and return within indexed and native language copies', async () => {
  const fixture = await setup()
  try {
    const source = `# Start\n\nReference[^脚注] and [external](https://example.invalid/).\n\n${'Middle paragraph.\n\n'.repeat(180)}[^脚注]: Last footnote with **protected** prose.\n`
    const value = projection(source, 'side-by-side')
    await fixture.page.evaluate((value) => window.readingMemory.show(value), value)
    const original = fixture.page.locator('.reading-original a[data-footnote-ref]').first()
    await expect(original).toBeVisible()
    await original.click()
    await expect(fixture.page.locator('.reading-original [data-footnote-backref]')).toBeVisible()
    await expect(fixture.page.locator('.reading-original')).toContainText(['Last footnote'])
    await fixture.page.locator('.reading-original [data-footnote-backref]').click()
    await expect(
      fixture.page.locator('.reading-original a[data-footnote-ref]').first(),
    ).toBeVisible()
    await fixture.page.locator('.reading-translation a[data-footnote-ref]').first().click()
    await expect(fixture.page.locator('.reading-translation [data-footnote-backref]')).toBeVisible()
    await fixture.page.locator('.reading-translation [data-footnote-backref]').click()
    await fixture.page.locator('.reading-original a[href="https://example.invalid/"]').click()
    expect((await fixture.page.evaluate(() => window.readingMemory.view())).links).toEqual([
      'https://example.invalid/',
    ])
    const native = { ...value, html: expandReadingIndex(value), indexed: undefined }
    await fixture.page.evaluate((value) => window.readingMemory.show(value), native)
    await fixture.page.locator('.reading-original a[data-footnote-ref]').first().click()
    await expect(fixture.page.locator('.reading-original li[id]')).toBeFocused()
    await fixture.page.locator('.reading-original [data-footnote-backref]').click()
    await expect(
      fixture.page.locator('.reading-original a[data-footnote-ref]').first(),
    ).toBeFocused()
    await fixture.page.locator('.reading-translation a[data-footnote-ref]').first().click()
    await expect(fixture.page.locator('.reading-translation li[id]')).toBeFocused()
    await fixture.page.locator('.reading-translation [data-footnote-backref]').click()
    await expect(
      fixture.page.locator('.reading-translation a[data-footnote-ref]').first(),
    ).toBeFocused()
    expect(fixture.errors).toEqual([])
  } finally {
    await fixture.close()
  }
})
test('indexed metadata admission rejects at the shared DOM budget and releases every partial reservation for retry', async () => {
  const fixture = await setup()
  try {
    const value = projection(`Start.\n\n${'Paragraph.\n\n'.repeat(180)}`, 'interlinear')
    await fixture.page.evaluate(() => window.readingMemory.reserve(16 * 1024 * 1024 - 100))
    await expect(
      fixture.page.evaluate((value) => window.readingMemory.show(value), value),
    ).rejects.toThrow('translation-view-limit')
    expect(await fixture.page.evaluate(() => window.readingMemory.view())).toMatchObject({
      rows: 0,
      registered: false,
      text: '',
    })
    await fixture.page.evaluate(() => window.readingMemory.reserve(0))
    await fixture.page.evaluate((value) => window.readingMemory.show(value), value)
    expect((await fixture.page.evaluate(() => window.readingMemory.view())).rows).toBeGreaterThan(0)
    expect(fixture.errors).toEqual([])
  } finally {
    await fixture.close()
  }
})
