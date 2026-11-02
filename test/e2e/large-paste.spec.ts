import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, type Page, test } from '@playwright/test'
import { contrast, launchDesktop } from './helpers'

const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'
async function hold(page: Page) {
  await page.evaluate(() => {
    const original = Object.getOwnPropertyDescriptor(scheduler, 'yield')
    const waiting: (() => void)[] = []
    Reflect.set(window, '__pasteYields', { original, waiting })
    Object.defineProperty(scheduler, 'yield', {
      configurable: true,
      value: () => new Promise<void>((resolve) => waiting.push(resolve)),
    })
  })
}
async function release(page: Page) {
  await page.evaluate(() => {
    const state = Reflect.get(window, '__pasteYields') as {
      original?: PropertyDescriptor
      waiting: (() => void)[]
    }
    if (state.original) Object.defineProperty(scheduler, 'yield', state.original)
    else Reflect.deleteProperty(scheduler, 'yield')
    for (const resolve of state.waiting) resolve()
    Reflect.deleteProperty(window, '__pasteYields')
  })
}
async function paste(page: Page, source: string) {
  await page.getByRole('textbox', { name: 'Markdown source' }).evaluate((element, text) => {
    const clipboardData = new DataTransfer()
    clipboardData.setData('text/plain', text)
    element.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }),
    )
  }, source)
}

test('five MiB paste can be cancelled after preparation starts, then commits and undoes atomically', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'manuslip-large-paste-'))
  const path = join(directory, 'draft.md')
  const original = '# Draft\n\nKeep this source.\n'
  const inserted = 'A long passage with 中文 and 😀.\r\n'.repeat(140000)
  expect(Buffer.byteLength(inserted)).toBeGreaterThan(5 * 1024 * 1024)
  await writeFile(path, original)
  const application = await launchDesktop(join(directory, 'profile'), [path])
  try {
    const page = await application.firstWindow()
    const editor = page.getByRole('textbox', { name: 'Markdown source' })
    await expect(editor).toBeVisible()
    await page.getByRole('button', { name: 'Source', exact: true }).click()
    await editor.focus()
    await page.keyboard.press(`${modifier}+End`)
    let current = original
    for (const method of ['button', 'escape', 'tab']) {
      await hold(page)
      await page.evaluate(() => performance.clearMeasures('manuslip:paste-prepare-slice'))
      await paste(page, inserted)
      await expect(page.getByRole('button', { name: 'Cancel paste', exact: true })).toBeVisible()
      // Other work can already be queued on the shared native scheduler. Advance
      // until one paste chunk completes, then keep its next continuation held.
      await expect
        .poll(() =>
          page.evaluate(() => {
            const slices = performance.getEntriesByName('manuslip:paste-prepare-slice').length
            if (!slices) {
              const state = Reflect.get(window, '__pasteYields') as { waiting: (() => void)[] }
              state.waiting.shift()?.()
            }
            return slices
          }),
        )
        .toBeGreaterThan(0)
      await expect(editor).toHaveText(current.replaceAll('\n', ''))
      if (method === 'button') {
        await page.keyboard.type('kept')
        current += 'kept'
        await page.screenshot({ path: test.info().outputPath('pending-paste-light.png') })
        await page.getByRole('button', { name: 'Cancel paste', exact: true }).click()
      } else if (method === 'escape') await page.keyboard.press('Escape')
      else {
        await page.getByRole('button', { name: 'New document', exact: true }).first().click()
        await page.getByRole('tab', { name: 'draft.md', exact: true }).click()
        await editor.focus()
      }
      await expect(page.getByRole('button', { name: 'Cancel paste', exact: true })).toHaveCount(0)
      await expect(editor).toBeFocused()
      await release(page)
      await page.keyboard.press(`${modifier}+s`)
      await expect(page.getByText('All changes saved', { exact: true })).toBeVisible()
      expect(await readFile(path, 'utf8')).toBe(current)
    }
    await paste(page, inserted)
    await expect
      .poll(() => page.evaluate(() => performance.getEntriesByName('manuslip:paste-commit').length))
      .toBe(1)
    await page.keyboard.press(`${modifier}+s`)
    await expect(page.getByText('All changes saved', { exact: true })).toBeVisible()
    expect((await readFile(path, 'utf8')) === current + inserted.replaceAll('\r\n', '\n')).toBe(
      true,
    )
    await page.keyboard.press(`${modifier}+z`)
    await page.keyboard.press(`${modifier}+s`)
    await expect(page.getByText('All changes saved', { exact: true })).toBeVisible()
    expect(await readFile(path, 'utf8')).toBe(current)
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+y')
    await page.keyboard.press(`${modifier}+s`)
    await expect(page.getByText('All changes saved', { exact: true })).toBeVisible()
    expect((await readFile(path, 'utf8')) === current + inserted.replaceAll('\r\n', '\n')).toBe(
      true,
    )
  } finally {
    await application
      .evaluate(({ BrowserWindow }) => {
        for (const window of BrowserWindow.getAllWindows()) window.destroy()
      })
      .catch(() => {})
    await application.close()
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
})

test('pending paste has a named keyboard cancel control in narrow Chinese dark mode and at zoom', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'manuslip-paste-ui-'))
  const path = join(directory, 'draft.md')
  await writeFile(path, '# Draft\n\nKeep this source.\n')
  const application = await launchDesktop(join(directory, 'profile'), [path])
  try {
    const page = await application.firstWindow()
    await expect(page.getByRole('textbox', { name: 'Markdown source' })).toBeVisible()
    await page.getByRole('button', { name: 'Source', exact: true }).click()
    await page.getByRole('button', { name: 'Preferences', exact: true }).click()
    await page.getByLabel('Appearance', { exact: true }).selectOption('dark')
    await page.getByLabel('Interface language', { exact: true }).selectOption('zh-CN')
    await page.getByRole('button', { name: '关闭偏好设置', exact: true }).click()
    const editor = page.getByRole('textbox', { name: 'Markdown 源码' })
    await expect(editor).toBeVisible()
    await hold(page)
    // The localized editor has the same native clipboard handler.
    await editor.evaluate((element) => {
      const clipboardData = new DataTransfer()
      clipboardData.setData('text/plain', 'A long passage.\n'.repeat(350000))
      element.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }),
      )
    })
    const cancel = page.getByRole('button', { name: '取消粘贴', exact: true })
    await expect(cancel).toBeVisible()
    for (const narrow of [true, false]) {
      if (narrow) await page.setViewportSize({ width: 320, height: 760 })
      else {
        await page.setViewportSize({ width: 1160, height: 760 })
        const session = await page.context().newCDPSession(page)
        await session.send('Emulation.clearDeviceMetricsOverride')
        await (await application.browserWindow(page)).evaluate((window) => {
          window.setContentSize(1160, 760)
          window.webContents.setZoomFactor(2)
        })
        await expect.poll(() => page.evaluate(() => innerWidth)).toBeGreaterThanOrEqual(570)
        await expect.poll(() => page.evaluate(() => innerWidth)).toBeLessThanOrEqual(580)
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      )
      await cancel.focus()
      await page.keyboard.press('Shift+Tab')
      await page.keyboard.press('Tab')
      await expect(cancel).toBeFocused()
      await expect(cancel).toBeInViewport()
      const colors = await cancel.evaluate((element) => {
        const style = getComputedStyle(element)
        return {
          text: style.color,
          background: style.backgroundColor,
          focus: style.outlineColor,
          focusStyle: style.outlineStyle,
        }
      })
      expect(contrast(colors.text, colors.background)).toBeGreaterThanOrEqual(4.5)
      expect(colors.focusStyle).not.toBe('none')
      expect(contrast(colors.focus, colors.background)).toBeGreaterThanOrEqual(3)
      await page.screenshot({
        path: test
          .info()
          .outputPath(narrow ? 'pending-paste-chinese-320.png' : 'pending-paste-chinese-zoom.png'),
      })
    }
    await cancel.press('Enter')
    await expect(cancel).toHaveCount(0)
    await expect(editor).toBeFocused()
    await release(page)
    expect(await readFile(path, 'utf8')).toBe('# Draft\n\nKeep this source.\n')
  } finally {
    await application
      .evaluate(({ BrowserWindow }) => {
        for (const window of BrowserWindow.getAllWindows()) window.destroy()
      })
      .catch(() => {})
    await application.close()
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
})
