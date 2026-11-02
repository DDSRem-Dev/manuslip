import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, type Page, test } from '@playwright/test'
import { contrast, launchDesktop } from './helpers'

const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'
async function query(page: Page, search: string, replace: string) {
  await page.getByRole('textbox', { name: 'Markdown source' }).focus()
  await page.keyboard.press(`${modifier}+f`)
  await page.locator('.cm-search input[name=search]').fill(search)
  await page.locator('.cm-search input[name=replace]').fill(replace)
  await page.locator('.cm-search input[name=replace]').press('Tab')
}
async function save(page: Page) {
  await page.keyboard.press(`${modifier}+s`)
  await expect(page.getByText('All changes saved', { exact: true })).toBeVisible()
}
async function hold(page: Page) {
  await page.evaluate(() => {
    const Original = Worker
    const waiting: (() => void)[] = []
    Reflect.set(window, '__replaceWorkers', { Original, waiting })
    class Held extends Original {
      postMessage(message: unknown, options?: StructuredSerializeOptions | Transferable[]) {
        const configuration = Array.isArray(options) ? { transfer: options } : (options ?? {})
        if (this.nameForTest) waiting.push(() => super.postMessage(message, configuration))
        else super.postMessage(message, configuration)
      }
      private nameForTest: boolean
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options)
        this.nameForTest = options?.name === 'manuslip-replace'
      }
    }
    Reflect.set(window, 'Worker', Held)
  })
}
async function release(page: Page) {
  await page.evaluate(() => {
    const state = Reflect.get(window, '__replaceWorkers') as {
      Original: typeof Worker
      waiting: (() => void)[]
    }
    Reflect.set(window, 'Worker', state.Original)
    for (const run of state.waiting) run()
    Reflect.deleteProperty(window, '__replaceWorkers')
  })
}

test('five MiB replace-all stays cancellable, preserves concurrent edits and commits as one undoable change', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'manuslip-replace-'))
  const path = join(directory, 'draft.md')
  const original = `# Draft\n\n${`${'ordinary prose '.repeat(1024)}MARKER\n\n`.repeat(350)}`
  expect(Buffer.byteLength(original)).toBeGreaterThan(5 * 1024 * 1024)
  await writeFile(path, original)
  const application = await launchDesktop(join(directory, 'profile'), [path])
  try {
    const page = await application.firstWindow()
    const editor = page.getByRole('textbox', { name: 'Markdown source' })
    await expect(editor).toBeVisible()
    await query(page, 'MARKER', 'REPLACED')
    for (const method of ['button', 'escape', 'edit', 'tab']) {
      await hold(page)
      await page.locator('.cm-search button[name=replaceAll]').click()
      const cancel = page.getByRole('button', { name: 'Cancel replacement', exact: true })
      await expect(cancel).toBeVisible()
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              (Reflect.get(window, '__replaceWorkers') as { waiting: unknown[] }).waiting.length,
          ),
        )
        .toBe(1)
      if (method === 'button') {
        await page.screenshot({ path: test.info().outputPath('replace-pending-light.png') })
        await cancel.click()
      } else if (method === 'escape') await page.keyboard.press('Escape')
      else if (method === 'edit') {
        await editor.focus()
        await page.keyboard.press(`${modifier}+End`)
        await page.keyboard.type('kept')
      } else {
        await page.getByRole('button', { name: 'New document', exact: true }).first().click()
        await page.getByRole('tab', { name: 'draft.md', exact: true }).click()
      }
      await expect(cancel).toHaveCount(0)
      await release(page)
      await editor.focus()
      await save(page)
      expect(
        (await readFile(path, 'utf8')) ===
          original + (['edit', 'tab'].includes(method) ? 'kept' : ''),
      ).toBe(true)
      await query(page, 'MARKER', 'REPLACED')
    }
    await page.locator('.cm-search button[name=replaceAll]').focus()
    await page.keyboard.press('Enter')
    await expect
      .poll(() =>
        page.evaluate(() => performance.getEntriesByName('manuslip:replace-commit').length),
      )
      .toBe(1)
    await page.keyboard.press('Escape')
    await editor.focus()
    await save(page)
    const replaced = `${original.replaceAll('MARKER', 'REPLACED')}kept`
    expect((await readFile(path, 'utf8')) === replaced).toBe(true)
    await page.keyboard.press(`${modifier}+z`)
    await save(page)
    expect((await readFile(path, 'utf8')) === `${original}kept`).toBe(true)
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+y')
    await save(page)
    expect((await readFile(path, 'utf8')) === replaced).toBe(true)
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

test('replacement progress and keyboard cancellation remain usable in narrow Chinese dark mode and zoom', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'manuslip-replace-ui-'))
  const path = join(directory, 'draft.md')
  const source = '# Draft\n\nMARKER stays intact.\n'
  await writeFile(path, source)
  const application = await launchDesktop(join(directory, 'profile'), [path])
  try {
    const page = await application.firstWindow()
    await expect(page.getByRole('textbox', { name: 'Markdown source' })).toBeVisible()
    await query(page, 'MARKER', 'REPLACED')
    await page.getByRole('button', { name: 'Preferences', exact: true }).click()
    await page.getByLabel('Appearance', { exact: true }).selectOption('dark')
    await page.getByLabel('Interface language', { exact: true }).selectOption('zh-CN')
    await page.getByRole('button', { name: '关闭偏好设置', exact: true }).click()
    await hold(page)
    await page.locator('.cm-search button[name=replaceAll]').click()
    const cancel = page.getByRole('button', { name: '取消替换', exact: true })
    await expect(cancel).toBeVisible()
    await expect(page.getByText('正在替换匹配项…', { exact: true })).toBeVisible()
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
      await cancel.focus()
      await page.keyboard.press('Shift+Tab')
      await page.keyboard.press('Tab')
      await expect(cancel).toBeFocused()
      await expect(cancel).toBeInViewport()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      )
      const colors = await cancel.evaluate((element) => {
        const style = getComputedStyle(element)
        return {
          text: style.color,
          background: style.backgroundColor,
          focus: style.outlineColor,
          style: style.outlineStyle,
        }
      })
      expect(contrast(colors.text, colors.background)).toBeGreaterThanOrEqual(4.5)
      expect(contrast(colors.focus, colors.background)).toBeGreaterThanOrEqual(3)
      expect(colors.style).not.toBe('none')
      await page.screenshot({
        path: test
          .info()
          .outputPath(narrow ? 'replace-chinese-320.png' : 'replace-chinese-zoom.png'),
      })
    }
    await cancel.press('Enter')
    await expect(cancel).toHaveCount(0)
    await expect(page.getByRole('textbox', { name: 'Markdown 源码' })).toBeFocused()
    await release(page)
    expect(await readFile(path, 'utf8')).toBe(source)
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

test('a stuck native replacement worker is terminated by Cancel and by its external deadline', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'manuslip-replace-timeout-'))
  const path = join(directory, 'draft.md')
  const original = '# Draft\n\nMARKER stays intact.\n'
  await writeFile(path, original)
  const application = await launchDesktop(join(directory, 'profile'), [path])
  try {
    const page = await application.firstWindow()
    await expect(page.getByRole('textbox', { name: 'Markdown source' })).toBeVisible()
    await query(page, 'MARKER', 'REPLACED')
    await page.evaluate(() => {
      const Original = Worker
      Reflect.set(window, '__originalReplaceWorker', Original)
      class Stuck extends Original {
        private replaceWorker: boolean
        constructor(url: string | URL, options?: WorkerOptions) {
          super(url, options)
          this.replaceWorker = options?.name === 'manuslip-replace'
        }
        postMessage(message: unknown, options?: StructuredSerializeOptions | Transferable[]) {
          const configuration = Array.isArray(options) ? { transfer: options } : (options ?? {})
          // Inject only into the real worker request; the editor's own regex highlighter
          // never sees this deliberately pathological test expression.
          const input = message as { query: Record<string, unknown> }
          super.postMessage(
            this.replaceWorker
              ? {
                  ...input,
                  lines: [`${'a'.repeat(60)}!`],
                  query: { ...input.query, search: '(a+)+$', regexp: true },
                }
              : message,
            configuration,
          )
        }
      }
      Reflect.set(window, 'Worker', Stuck)
    })
    const lifetimes: { cancelled: boolean; elapsed: number }[] = []
    const nativeWorkers = async () =>
      (await application.browserWindow(page)).evaluate(async (window) => {
        const debug = window.webContents.debugger
        if (!debug.isAttached()) debug.attach('1.3')
        const result = (await debug.sendCommand('Target.getTargets')) as {
          targetInfos: { type: string; url: string }[]
        }
        return result.targetInfos.filter(
          (target) => target.type === 'worker' && target.url.includes('replace.worker'),
        ).length
      })
    for (const cancel of [true, false]) {
      await page.evaluate(() => performance.clearMeasures('manuslip:replace-worker-start'))
      await page.locator('.cm-search button[name=replaceAll]').click()
      await expect
        .poll(() =>
          page.evaluate(() => performance.getEntriesByName('manuslip:replace-worker-start').length),
        )
        .toBe(1)
      expect(page.workers().some((worker) => worker.url().includes('replace.worker'))).toBe(true)
      expect(await nativeWorkers()).toBe(1)
      const started = await page.evaluate(() => performance.now())
      if (cancel) {
        await page.getByRole('button', { name: 'Cancel replacement', exact: true }).click()
        await expect(
          page.getByRole('button', { name: 'Cancel replacement', exact: true }),
        ).toHaveCount(0)
        expect(await page.evaluate((started) => performance.now() - started, started)).toBeLessThan(
          500,
        )
        // Chromium allows a blocked worker two seconds before forcible termination.
        // Editor cancellation must complete while that native shutdown is still pending.
        await page.getByRole('textbox', { name: 'Markdown source' }).focus()
        await page.keyboard.type('x')
        await page.keyboard.press('ControlOrMeta+z')
      } else
        await expect(
          page.getByText(
            'Replacement took too long. Your text is unchanged. Use a simpler search or smaller document.',
            { exact: true },
          ),
        ).toBeVisible({ timeout: 10000 })
      await expect.poll(nativeWorkers, { intervals: [50], timeout: 4000 }).toBe(0)
      const elapsed = await page.evaluate((started) => performance.now() - started, started)
      lifetimes.push({ cancelled: cancel, elapsed })
      if (cancel)
        expect(
          elapsed,
          'Chromium forcibly terminates the blocked worker after cancellation',
        ).toBeLessThan(3000)
      expect(await readFile(path, 'utf8')).toBe(original)
    }
    const lifetimesPath = test.info().outputPath('replace-worker-lifetimes.json')
    await writeFile(lifetimesPath, JSON.stringify(lifetimes))
    await test.info().attach('replace-worker-lifetimes', {
      path: lifetimesPath,
      contentType: 'application/json',
    })
    await page.evaluate(() =>
      Reflect.set(window, 'Worker', Reflect.get(window, '__originalReplaceWorker')),
    )
    await page.locator('.cm-search button[name=replaceAll]').click()
    await expect
      .poll(() =>
        page.evaluate(() => performance.getEntriesByName('manuslip:replace-commit').length),
      )
      .toBe(1)
    await page.keyboard.press('Escape')
    await page.getByRole('textbox', { name: 'Markdown source' }).focus()
    await page.keyboard.type('kept ')
    await save(page)
    expect(await readFile(path, 'utf8')).toBe(`kept ${original.replace('MARKER', 'REPLACED')}`)
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
