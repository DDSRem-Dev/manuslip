import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { type ElectronApplication, expect, type Locator, type Page, test } from '@playwright/test'
import axe from 'axe-core'
import {
  clickDocumentAction,
  launchDesktop,
  openDocumentActions,
  openReadingOptions,
} from './helpers'

const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'

async function close(application: ElectronApplication): Promise<void> {
  await application
    .evaluate(({ BrowserWindow }) => {
      for (const window of BrowserWindow.getAllWindows()) window.destroy()
    })
    .catch(() => {})
  await application.close()
}

async function evidenceDirectory(): Promise<string> {
  await mkdir('test/artifacts/logs', { recursive: true })
  return mkdtemp(resolve('test/artifacts/logs/document-toolbar-'))
}

test('document and reading actions preserve keyboard access, native shortcuts and visible feedback', async () => {
  const directory = await evidenceDirectory()
  const path = join(directory, 'Notes.md'),
    source = '# Notes\n\nKeep every command available.\n'
  await writeFile(path, source)
  const application = await launchDesktop(join(directory, 'profile'), [path])
  try {
    const page = await application.firstWindow()
    const editor = page.getByRole('textbox', { name: 'Markdown source', exact: true })
    const actions = page.getByRole('button', { name: 'Document actions', exact: true })
    await expect(page.getByRole('tab', { name: 'Notes.md', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeVisible()
    await actions.focus()
    await page.keyboard.press('Enter')
    const panel = page.getByRole('group', { name: 'Document actions', exact: true })
    await expect(panel).toBeVisible()
    await page.keyboard.press('Tab')
    await expect(panel.getByRole('button', { name: 'New document', exact: true })).toBeFocused()
    await page.keyboard.press('Shift+Tab')
    await expect(actions).toBeFocused()
    await page.keyboard.press('Tab')
    await page.keyboard.press('Escape')
    await expect(panel).toBeHidden()
    await expect(actions).toBeFocused()

    await openDocumentActions(page)
    await panel.getByLabel('Render sanitized HTML', { exact: true }).check()
    await expect(panel).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(actions).toBeFocused()
    // Pointer dismissal must leave the intended outside target focused.
    await openDocumentActions(page)
    await page.getByRole('button', { name: 'Source', exact: true }).click()
    await expect(panel).toBeHidden()
    await expect(page.getByRole('button', { name: 'Source', exact: true })).toBeFocused()

    await application.evaluate(({ dialog }) => {
      dialog.showSaveDialog = async () => {
        process.env.MANUSLIP_TOOLBAR_SAVE_CHOICES = String(
          Number(process.env.MANUSLIP_TOOLBAR_SAVE_CHOICES ?? 0) + 1,
        )
        return { canceled: true, filePath: '' }
      }
    })
    await editor.focus()
    await page.keyboard.press(`${modifier}+Shift+S`)
    await expect
      .poll(() => application.evaluate(() => process.env.MANUSLIP_TOOLBAR_SAVE_CHOICES))
      .toBe('1')
    await clickDocumentAction(page, 'Export HTML…')
    await expect(
      page.getByText('Export cancelled. Your document is unchanged.', { exact: true }),
    ).toBeVisible()
    await expect(panel).toBeHidden()
    await expect(actions).toBeFocused()

    await editor.focus()
    await page.keyboard.press(`${modifier}+3`)
    const options = page.getByRole('button', { name: 'Reading options', exact: true })
    await options.focus()
    await page.keyboard.press('Enter')
    await page.keyboard.press('Tab')
    const layout = page.getByLabel('Reading layout', { exact: true })
    await expect(layout).toBeFocused()
    await layout.selectOption('interlinear')
    await page.keyboard.press('Escape')
    await expect(options).toBeFocused()
    await openReadingOptions(page)
    await layout.focus()
    await page.keyboard.press(`${modifier}+1`)
    await expect(page.getByRole('button', { name: 'Source', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(await page.locator('[popover]:popover-open').count()).toBe(0)
    await expect(editor).toBeFocused()
    await page.keyboard.press(`${modifier}+3`)
    await openDocumentActions(page)
    await openReadingOptions(page)
    await expect(panel).toBeHidden()
    await page.getByRole('button', { name: 'Translation settings', exact: true }).click()
    const preferences = page.getByRole('dialog', { name: 'Preferences', exact: true })
    await expect(preferences).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(preferences).toBeHidden()
    await expect(options).toBeFocused()
    await clickDocumentAction(page, 'Export reading HTML…')
    await expect(page.getByRole('alert')).toContainText('Choose Translate or Load cached')
    await expect(panel).toBeHidden()
    await expect(page.getByRole('alert')).toBeVisible()

    await page.keyboard.press(`${modifier}+1`)
    await editor.fill('# Notes\n\nStill editable — 仍可编辑.\n')
    await editor.press(`${modifier}+s`)
    await expect.poll(() => readFile(path, 'utf8')).toBe('# Notes\n\nStill editable — 仍可编辑.\n')
    await expect(editor).toBeFocused()
    await page.screenshot({ path: join(directory, 'commands-and-feedback.png') })
  } finally {
    await close(application)
  }
})

async function withinViewport(page: Page, target: Locator): Promise<void> {
  await target.focus()
  await expect(target).toBeInViewport({ ratio: 1 })
  const bounds = await target.boundingBox()
  expect(bounds).not.toBeNull()
  const width = await page.evaluate(() => innerWidth)
  expect(bounds?.x).toBeGreaterThanOrEqual(0)
  expect((bounds?.x ?? 0) + (bounds?.width ?? 0)).toBeLessThanOrEqual(width + 1)
  expect(await target.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(
    true,
  )
}

test('toolbar disclosures fit translated, mirrored and zoomed layouts and longer copy', async () => {
  test.setTimeout(90_000)
  const directory = await evidenceDirectory()
  const path = join(directory, 'Thoughts — 语言与写作的笔记.md')
  await writeFile(path, '# A little space\n\nLeave room for the next idea.\n')
  const application = await launchDesktop(join(directory, 'profile'), [path])
  const reports: unknown[] = []
  try {
    const page = await application.firstWindow()
    await expect(
      page.getByRole('tab', { name: 'Thoughts — 语言与写作的笔记.md', exact: true }),
    ).toBeVisible()
    await page.getByRole('button', { name: 'Translated preview', exact: true }).click()
    await expect(page.locator('.editor-status')).toContainText(/\d+ words/)
    await page.evaluate(axe.source)
    const capture = async (name: string, panel?: Locator): Promise<void> => {
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      )
      if (panel) {
        expect(
          await panel.evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
        ).toBe(true)
        const controls = panel.locator('button, input, select, summary')
        for (let index = 0; index < (await controls.count()); index++) {
          const control = controls.nth(index)
          if (await control.isEnabled()) await withinViewport(page, control)
        }
      }
      const result = await page.evaluate(async () => {
        const checker = (window as unknown as { axe: typeof import('axe-core') }).axe
        const result = await checker.run(document)
        return {
          violations: result.violations,
          incomplete: result.incomplete,
          passes: result.passes.length,
        }
      })
      await writeFile(join(directory, `${name}-axe.json`), `${JSON.stringify(result, null, 2)}\n`)
      expect(
        result.violations.map((row) => row.id),
        name,
      ).toEqual([])
      const layout = await page.evaluate(() => ({
        width: innerWidth,
        height: innerHeight,
        direction: document.documentElement.dir,
        scrollWidth: document.documentElement.scrollWidth,
      }))
      await page.screenshot({ path: join(directory, `${name}.png`) })
      reports.push({
        name,
        layout,
        violations: result.violations.length,
        incomplete: result.incomplete.map((row) => row.id),
      })
    }
    for (const width of [320, 360, 704, 1144, 1920]) {
      await page.setViewportSize({ width, height: 800 })
      await capture(`english-${width}`)
      await capture(`document-${width}`, await openDocumentActions(page))
      await page.keyboard.press('Escape')
      await capture(`reading-${width}`, await openReadingOptions(page))
      await page.keyboard.press('Escape')
    }
    for (const [locale, theme, width, direction] of [
      ['en', 'dark', 360, 'ltr'],
      ['en', 'dark', 1144, 'rtl'],
      ['zh-CN', 'light', 320, 'ltr'],
      ['zh-CN', 'light', 1144, 'ltr'],
      ['zh-CN', 'dark', 320, 'rtl'],
    ] as const) {
      await page.getByRole('button', { name: /^(Preferences|偏好设置)$/ }).click()
      await page.locator('#theme').selectOption(theme)
      await page.locator('#locale').selectOption(locale)
      await page.keyboard.press('Escape')
      await page.setViewportSize({ width, height: 800 })
      await page.evaluate((direction) => {
        document.documentElement.dir = direction
      }, direction)
      const name = `${locale}-${theme}-${width}-${direction}`
      await capture(name)
      await capture(`${name}-document`, await openDocumentActions(page))
      await page.keyboard.press('Escape')
      await capture(`${name}-reading`, await openReadingOptions(page))
      await page.keyboard.press('Escape')
    }
    const client = await page.context().newCDPSession(page)
    await client.send('Emulation.clearDeviceMetricsOverride')
    await (await application.browserWindow(page)).evaluate((window) => {
      window.setContentSize(1160, 800)
      window.webContents.setZoomFactor(2)
    })
    await expect.poll(() => page.evaluate(() => innerWidth)).toBeLessThanOrEqual(580)
    await capture('chinese-dark-rtl-zoom-200')
    await capture('chinese-dark-rtl-zoom-200-document', await openDocumentActions(page))
    await page.keyboard.press('Escape')
    await capture('chinese-dark-rtl-zoom-200-reading', await openReadingOptions(page))
    await page.keyboard.press('Escape')
    await (await application.browserWindow(page)).evaluate((window) =>
      window.webContents.setZoomFactor(1),
    )
    await client.detach()
    await page.setViewportSize({ width: 320, height: 800 })
    // DOM-only copy expansion stresses layout; it is not an additional supported locale.
    await page.evaluate(() => {
      for (const root of document.querySelectorAll(
        '.document-toolbar, .preview-toolbar, .reading-controls',
      )) {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          if (node.textContent?.trim())
            node.textContent = `[ ${node.textContent.trim()} — extended translated wording ]`
        }
      }
    })
    await capture('longer-copy-rtl-320')
    const documentTrigger = page.locator('.document-toolbar .toolbar-disclosure')
    await withinViewport(page, page.locator('.document-save'))
    await withinViewport(page, documentTrigger)
    await documentTrigger.click()
    await capture(
      'longer-copy-rtl-320-document',
      page.locator('.document-toolbar .toolbar-popover'),
    )
    await page.keyboard.press('Escape')
    await withinViewport(page, page.locator('.reading-actions .toolbar-disclosure'))
    await page.locator('.reading-actions .toolbar-disclosure').click()
    await capture('longer-copy-rtl-320-reading', page.locator('.reading-actions .toolbar-popover'))
    await writeFile(
      join(directory, 'report.json'),
      JSON.stringify({ directory, reports, physicalAssistiveTechnology: 'not verified' }, null, 2) +
        '\n',
    )
  } finally {
    await close(application)
  }
})
