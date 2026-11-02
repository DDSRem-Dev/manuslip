import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { type ElectronApplication, expect, type Page, test } from '@playwright/test'
import { clickDocumentAction, launchDesktop } from './helpers'

const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'
const labels = {
  en: {
    open: 'Open file…',
    source: 'Source',
    live: 'Live Preview',
    focus: 'Focus mode',
    exit: 'Exit focus',
    typewriter: 'Typewriter',
    editor: 'Markdown source',
  },
  'zh-CN': {
    open: '打开文件…',
    source: '源码',
    live: '实时预览',
    focus: '专注模式',
    exit: '退出专注',
    typewriter: '打字机',
    editor: 'Markdown 源码',
  },
}

async function fixture(
  locale: 'en' | 'zh-CN',
  theme: 'light' | 'dark',
  contents: string[],
  run: (
    application: ElectronApplication,
    page: Page,
    paths: string[],
    directory: string,
  ) => Promise<void>,
): Promise<void> {
  await mkdir('test/artifacts/logs', { recursive: true })
  const directory = await mkdtemp(resolve('test/artifacts/logs/writing-modes-'))
  if (!resolve(directory).startsWith(resolve('test/artifacts/logs') + sep))
    throw new Error('Unsafe fixture cleanup')
  const profile = join(directory, 'profile')
  await mkdir(profile)
  await writeFile(
    join(profile, 'preferences.json'),
    JSON.stringify({ schemaVersion: 1, locale, theme }),
  )
  const paths = contents.map((_, index) => join(directory, `notebook-${index + 1}.md`))
  for (const [index, path] of paths.entries()) await writeFile(path, contents[index] ?? '')
  const application = await launchDesktop(profile)
  try {
    const page = await application.firstWindow()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    for (const [index, path] of paths.entries()) {
      await application.evaluate(({ dialog }, path) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
      }, path)
      await page.getByRole('button', { name: labels[locale].open, exact: true }).first().click()
      await expect(page.getByRole('tab').nth(index)).toHaveAttribute('aria-selected', 'true')
    }
    await run(application, page, paths, directory)
    expect(errors).toEqual([])
  } finally {
    await application
      .evaluate(({ BrowserWindow }) => {
        for (const window of BrowserWindow.getAllWindows()) window.destroy()
      })
      .catch(() => {})
    await application.close()
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
}

async function centerDistance(page: Page): Promise<number> {
  return page.locator('.cm-cursor-primary').evaluate((cursor) => {
    const scroller = cursor.closest('.cm-editor')?.querySelector('.cm-scroller')
    if (!scroller) throw new Error('Missing source scroller')
    const caret = cursor.getBoundingClientRect(),
      viewport = scroller.getBoundingClientRect()
    return Math.abs((caret.top + caret.bottom - viewport.top - viewport.bottom) / 2)
  })
}

async function saved(page: Page, path: string, expected: string): Promise<void> {
  await page.keyboard.press(`${modifier}+s`)
  await expect.poll(() => readFile(path, 'utf8')).toBe(expected)
  const bytes = await readFile(path)
  await test.info().attach('saved-snapshot', {
    body: JSON.stringify({
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    }),
    contentType: 'application/json',
  })
}

async function cycle(application: ElectronApplication, reverse = false): Promise<void> {
  await application.evaluate(({ BrowserWindow }, reverse) => {
    const window = BrowserWindow.getAllWindows()[0]
    if (!window) throw new Error('Missing application window')
    window.focus()
    const modifiers: ('control' | 'shift')[] = reverse ? ['control', 'shift'] : ['control']
    for (const type of ['keyDown', 'keyUp'] as const)
      window.webContents.sendInputEvent({ type, keyCode: 'Tab', modifiers })
  }, reverse)
}

for (const mode of ['source', 'live'] as const) {
  test(`${mode} focus/typewriter preserve the editor, history and manual scrolling through narrow layouts`, async () => {
    const locale = mode === 'live' ? 'zh-CN' : 'en'
    const copy = labels[locale]
    const original =
      '# Notebook\n\n' +
      Array.from({ length: 120 }, (_, index) => `Line ${index + 1}: keep every word.`).join('\n\n')
    const edited = `${original}\n\nFinal 世界`
    await fixture(
      locale,
      mode === 'live' ? 'dark' : 'light',
      [original],
      async (application, page, paths, directory) => {
        const path = paths[0]
        if (!path) throw new Error('Missing fixture path')
        const editor = page.getByRole('textbox', { name: copy.editor, exact: true })
        const modeButton = page.getByRole('button', { name: copy[mode], exact: true })
        await modeButton.click()
        await expect(modeButton).toHaveAttribute('aria-pressed', 'true')
        await editor.fill(edited)
        await editor.press(`${modifier}+End`)
        const position = await page.locator('.editor-status-summary > span').first().textContent()
        const originalEditor = await editor.elementHandle()
        if (!originalEditor) throw new Error('Missing source surface')
        await clickDocumentAction(page, copy.focus)
        await expect(page.locator('.app-shell')).toHaveClass(/writing-focus/)
        await expect(page.locator('.sidebar')).toBeHidden()
        await expect(page.locator('.document-tabs')).toBeHidden()
        await expect(editor).toBeFocused()
        expect(await editor.evaluate((node, previous) => node === previous, originalEditor)).toBe(
          true,
        )
        await expect(page.locator('.editor-status-summary > span').first()).toHaveText(
          position ?? '',
        )
        const typewriter = page.getByRole('checkbox', { name: copy.typewriter, exact: true })
        await typewriter.check()
        await expect(page.locator('.cm-editor')).toHaveClass(/cm-typewriter/)
        await editor.focus()
        await expect.poll(() => centerDistance(page)).toBeLessThan(4)
        await editor.press(`${modifier}+Home`)
        await expect.poll(() => centerDistance(page)).toBeLessThan(4)
        await editor.press(`${modifier}+End`)
        await expect.poll(() => centerDistance(page)).toBeLessThan(4)
        await page.locator('.cm-scroller').evaluate((scroller) => {
          scroller.scrollTop = 0
        })
        await page.evaluate(
          () =>
            new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
        )
        expect(
          await page.locator('.cm-scroller').evaluate((scroller) => scroller.scrollTop),
        ).toBeLessThan(1)
        await editor.press('ArrowLeft')
        await expect.poll(() => centerDistance(page)).toBeLessThan(4)
        await application.evaluate(({ BrowserWindow }) => {
          const window = BrowserWindow.getAllWindows()[0]
          if (!window) throw new Error('Missing application window')
          window.setMinimumSize(0, 0)
          window.setContentSize(320, 850)
        })
        await expect.poll(() => page.evaluate(() => innerWidth)).toBe(320)
        await expect.poll(() => centerDistance(page)).toBeLessThan(4)
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        )
        await expect(page.getByRole('button', { name: copy.exit, exact: true })).toBeInViewport({
          ratio: 1,
        })
        const screenshot = join(directory, 'narrow-focus.png')
        await page.screenshot({ path: screenshot })
        await test.info().attach('narrow-focus', { path: screenshot, contentType: 'image/png' })
        await editor.focus()
        await saved(page, path, edited)
        await page.keyboard.press(`${modifier}+z`)
        await saved(page, path, original)
        await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+y')
        await saved(page, path, edited)
        await typewriter.uncheck()
        await expect(page.locator('.cm-editor')).not.toHaveClass(/cm-typewriter/)
        await expect
          .poll(() =>
            page
              .locator('.cm-editor')
              .evaluate((node) =>
                (node as HTMLElement).style.getPropertyValue('--manuslip-typewriter-padding'),
              ),
          )
          .toBe('')
        expect(
          await editor.evaluate((node) => Number.parseFloat(getComputedStyle(node).paddingTop)),
        ).toBeLessThan(64)
        await editor.focus()
        await page.keyboard.press(`${modifier}+f`)
        await expect(page.locator('.cm-search')).toBeVisible()
        await page.keyboard.press('Escape')
        await expect(page.locator('.cm-search')).toHaveCount(0)
        await expect(page.locator('.app-shell')).toHaveClass(/writing-focus/)
        await page.keyboard.press('Escape')
        await expect(page.locator('.app-shell')).not.toHaveClass(/writing-focus/)
        await expect(page.locator('.document-tabs')).toBeVisible()
        expect(await editor.evaluate((node, previous) => node === previous, originalEditor)).toBe(
          true,
        )
        await originalEditor.dispose()
      },
    )
  })

  test(`${mode} pending composition survives writing-option changes and native document switches`, async () => {
    const original = '# One\n\nOriginal text.'
    const second = '# Two\n\nKeep this file unchanged.'
    await fixture('en', 'light', [original, second], async (application, page, paths) => {
      const first = paths[0],
        other = paths[1]
      if (!first || !other) throw new Error('Missing fixture paths')
      await page.getByRole('tab').first().click()
      await expect(page.getByRole('tab').first()).toHaveAttribute('aria-selected', 'true')
      const modeButton = page.getByRole('button', { name: labels.en[mode], exact: true })
      await modeButton.click()
      await expect(modeButton).toHaveAttribute('aria-pressed', 'true')
      await clickDocumentAction(page, 'Focus mode')
      const editor = page.getByRole('textbox', { name: 'Markdown source', exact: true })
      await editor.focus()
      await editor.press(`${modifier}+End`)
      const cdp = await page.context().newCDPSession(page)
      try {
        await cdp.send('Input.imeSetComposition', {
          text: 'shi',
          selectionStart: 3,
          selectionEnd: 3,
        })
        await expect(editor).toContainText('shi')
        // A programmatic click changes the option without blurring the native composition.
        await page
          .getByRole('checkbox', { name: 'Typewriter', exact: true })
          .evaluate((input) => (input as HTMLInputElement).click())
        await expect(page.getByRole('checkbox', { name: 'Typewriter', exact: true })).toBeChecked()
        await expect(page.locator('.cm-editor')).not.toHaveClass(/cm-typewriter/)
        await cycle(application)
        await expect(page.locator('.document-tab').first()).toHaveAttribute('aria-selected', 'true')
        await cdp.send('Input.insertText', { text: '世界' })
        await expect(page.locator('.document-tab').nth(1)).toHaveAttribute('aria-selected', 'true')
        await expect(page.locator('.cm-editor')).toHaveClass(/cm-typewriter/)
        await cycle(application, true)
        await expect(page.locator('.document-tab').first()).toHaveAttribute('aria-selected', 'true')
        await expect(page.locator('.cm-editor')).toHaveClass(/cm-typewriter/)
        await saved(page, first, `${original}世界`)
        await page.keyboard.press(`${modifier}+z`)
        await saved(page, first, original)
        await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+y')
        await saved(page, first, `${original}世界`)
        await cycle(application)
        await expect(page.locator('.document-tab').nth(1)).toHaveAttribute('aria-selected', 'true')
        await page.getByRole('checkbox', { name: 'Typewriter', exact: true }).uncheck()
        await expect(page.locator('.cm-editor')).not.toHaveClass(/cm-typewriter/)
        await cycle(application, true)
        await expect(page.locator('.document-tab').first()).toHaveAttribute('aria-selected', 'true')
        await expect(page.locator('.cm-editor')).not.toHaveClass(/cm-typewriter/)
        expect(await readFile(other, 'utf8')).toBe(second)
        await page.getByRole('button', { name: 'Exit focus', exact: true }).click()
        await expect(modeButton).toHaveAttribute('aria-pressed', 'true')
      } finally {
        await cdp.detach()
      }
    })
  })

  test(`${mode} writing modes preserve multiple selections and a saved document reopens intact`, async () => {
    const original = 'token keep token\n'
    await fixture('en', 'light', [original], async (application, page, paths) => {
      const path = paths[0]
      if (!path) throw new Error('Missing fixture path')
      const modeButton = page.getByRole('button', { name: labels.en[mode], exact: true })
      await modeButton.click()
      await expect(modeButton).toHaveAttribute('aria-pressed', 'true')
      const editor = page.getByRole('textbox', { name: labels.en.editor, exact: true })
      await editor.focus()
      await editor.press(`${modifier}+Home`)
      await editor.press(`${modifier}+d`)
      await editor.press(`${modifier}+d`)
      await clickDocumentAction(page, 'Focus mode')
      await page.getByRole('checkbox', { name: 'Typewriter', exact: true }).check()
      await expect(page.locator('.cm-editor')).toHaveClass(/cm-typewriter/)
      await editor.focus()
      await page.keyboard.type('X')
      await saved(page, path, 'X keep X\n')
      await page.keyboard.press(`${modifier}+z`)
      await saved(page, path, original)
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+y')
      await saved(page, path, 'X keep X\n')
      await application.evaluate(({ Menu }) => {
        const close = Menu.getApplicationMenu()
          ?.items.flatMap((item) => item.submenu?.items || [])
          .find((item) => item.accelerator === 'CmdOrCtrl+W')
        if (!close) throw new Error('Missing Close document menu command')
        close.click()
      })
      await expect(page.locator('.cm-editor')).toHaveCount(0)
      await expect(page.locator('.app-shell')).not.toHaveClass(/writing-focus/)
      await page.getByRole('button', { name: 'Open file…', exact: true }).first().click()
      await expect(page.getByRole('tab').first()).toHaveAttribute('aria-selected', 'true')
      await expect(editor).toHaveText('X keep X')
      await expect(page.locator('.cm-editor')).toHaveClass(/cm-typewriter/)
      expect(await readFile(path, 'utf8')).toBe('X keep X\n')
    })
  })
}
