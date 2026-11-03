import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, type Page, test } from '@playwright/test'
import { launchDesktop } from './helpers'

async function expectCharacters(page: Page, count: number): Promise<void> {
  const trigger = page.getByRole('button', { name: /Document details$/ })
  await trigger.focus()
  await page.keyboard.press('Enter')
  await expect(
    page
      .locator('.document-statistics > div')
      .filter({ has: page.locator('dt', { hasText: /^Characters$/ }) })
      .locator('dd'),
  ).toHaveText(count.toLocaleString('en'))
  await page.keyboard.press('Escape')
}

test('dense inline input keeps the complete native preview editable and saveable', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'manuslip-encoder-fallback-'))
  const path = join(directory, 'inline-pressure.md')
  // Exercise dense inline syntax through the document convention grammar.
  const source = `# Inline pressure\n\n${'**x** '.repeat(16000)}\n\nComplete tail 世界.\n`
  await writeFile(path, source)
  const application = await launchDesktop(join(directory, 'profile'))
  try {
    const page = await application.firstWindow()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await expect(page.getByRole('heading', { name: 'Start writing' })).toBeVisible()
    await application.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
    }, path)
    await page.getByRole('button', { name: 'Open file…', exact: true }).first().click()
    const editor = page.getByRole('textbox', { name: 'Markdown source' })
    await expect(editor).toBeVisible()
    await expect
      .poll(
        () => page.evaluate(() => performance.getEntriesByName('manuslip:semantic-apply').length),
        { timeout: 15000 },
      )
      .toBe(1)
    await expect(page.getByRole('button', { name: 'Live Preview', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expectCharacters(page, source.length)
    await editor.focus()
    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'
    await page.keyboard.press(`${modifier}+End`)
    await page.keyboard.type('Saved complete tail.')
    await expect
      .poll(
        () => page.evaluate(() => performance.getEntriesByName('manuslip:semantic-apply').length),
        { timeout: 15000 },
      )
      .toBe(2)
    await expect(page.getByText('Updating preview…', { exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Live Preview', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(
      await page.evaluate(
        () => performance.getEntriesByName('manuslip:packed-preview-apply').length,
      ),
    ).toBe(0)
    await page.keyboard.press(`${modifier}+s`)
    await expect(page.getByText('All changes saved', { exact: true })).toBeVisible()
    expect(await readFile(path, 'utf8')).toBe(`${source}Saved complete tail.`)
    expect(errors).toEqual([])
  } finally {
    await application
      .evaluate(({ BrowserWindow }) => {
        for (const window of BrowserWindow.getAllWindows())
          if (!window.isDestroyed()) window.destroy()
      })
      .catch(() => {})
    await application.close()
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
})

for (const { name, paragraphs } of [
  { name: 'native dense', paragraphs: 16500 },
  { name: 'native conventions', paragraphs: 6000 },
]) {
  test(`editing during a yielded ${name} apply installs only the newest complete snapshot`, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'manuslip-apply-'))
    const path = join(directory, 'dense.md')
    const paragraph =
      name === 'native conventions'
        ? '"Smart" -- punctuation...\n\n'
        : 'A small paragraph. One more short sentence for the next block.\n\n'
    const source = `# Dense document\n\n${paragraph.repeat(paragraphs)}`
    await writeFile(path, source)
    const application = await launchDesktop(join(directory, 'profile'))
    try {
      const page = await application.firstWindow()
      await expect(page.getByRole('heading', { name: 'Start writing' })).toBeVisible()
      // Hold native task continuations rather than exposing application internals.
      await page.evaluate(() => {
        const original = Object.getOwnPropertyDescriptor(scheduler, 'yield')
        const waiting: (() => void)[] = []
        Reflect.set(window, '__heldSemanticYields', { original, waiting })
        Object.defineProperty(scheduler, 'yield', {
          configurable: true,
          value: () => new Promise<void>((resolve) => waiting.push(resolve)),
        })
      })
      await application.evaluate(({ dialog }, path) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
      }, path)
      await page.getByRole('button', { name: 'Open file…', exact: true }).first().click()
      const editor = page.getByRole('textbox', { name: 'Markdown source' })
      await expect(editor).toBeVisible()
      await expect
        .poll(
          () =>
            page.evaluate(() => {
              const state = Reflect.get(window, '__heldSemanticYields') as { waiting: unknown[] }
              return state.waiting.length
            }),
          { timeout: 15000 },
        )
        .toBeGreaterThan(0)
      expect(
        await page.evaluate(() => performance.getEntriesByName('manuslip:semantic-apply').length),
      ).toBe(0)
      const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'
      await editor.focus()
      await page.keyboard.press(`${modifier}+End`)
      await page.keyboard.type('abcdefghijklmnopqrst')
      await expect(page.getByText('Updating preview…', { exact: true })).toBeVisible()
      expect(
        await page.evaluate(() => performance.getEntriesByName('manuslip:semantic-apply').length),
      ).toBe(0)
      await page.evaluate(() => {
        const state = Reflect.get(window, '__heldSemanticYields') as {
          original?: PropertyDescriptor
          waiting: (() => void)[]
        }
        if (state.original) Object.defineProperty(scheduler, 'yield', state.original)
        else Reflect.deleteProperty(scheduler, 'yield')
        for (const resolve of state.waiting) resolve()
        Reflect.deleteProperty(window, '__heldSemanticYields')
      })
      await expect
        .poll(
          () => page.evaluate(() => performance.getEntriesByName('manuslip:semantic-apply').length),
          { timeout: 15000 },
        )
        .toBe(1)
      expect(
        await page.evaluate(
          () => performance.getEntriesByName('manuslip:packed-preview-apply').length,
        ),
      ).toBe(0)
      await expect(page.getByText('Updating preview…', { exact: true })).toHaveCount(0)
      await expect(page.getByRole('button', { name: 'Live Preview', exact: true })).toHaveAttribute(
        'aria-pressed',
        'true',
      )
      await expectCharacters(page, source.length + 20)
      await page.keyboard.press(`${modifier}+s`)
      await expect(page.getByText('All changes saved', { exact: true })).toBeVisible()
      expect((await readFile(path, 'utf8')) === `${source}abcdefghijklmnopqrst`).toBe(true)
    } finally {
      await application
        .evaluate(({ BrowserWindow }) => {
          for (const window of BrowserWindow.getAllWindows())
            if (!window.isDestroyed()) window.destroy()
        })
        .catch(() => {})
      await application.close()
      await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    }
  })
}
