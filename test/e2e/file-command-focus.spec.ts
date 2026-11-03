import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { type ElectronApplication, expect, type Locator, test } from '@playwright/test'
import { contrast, launchDesktop } from './helpers'

const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'

async function holdDialog(application: ElectronApplication, kind: 'open' | 'save'): Promise<void> {
  await application.evaluate(({ dialog }, kind) => {
    const state = globalThis as typeof globalThis & {
      finishFileDialog?: (path: string | null) => void
    }
    const selected = (): Promise<string | null> =>
      new Promise((resolve) => {
        state.finishFileDialog = resolve
      })
    if (kind === 'open')
      dialog.showOpenDialog = async () => {
        const path = await selected()
        return { canceled: path === null, filePaths: path === null ? [] : [path] }
      }
    else
      dialog.showSaveDialog = async () => {
        const path = await selected()
        return { canceled: path === null, filePath: path ?? '' }
      }
  }, kind)
}

async function finishDialog(application: ElectronApplication, path: string | null): Promise<void> {
  await application.evaluate((_, path) => {
    const state = globalThis as typeof globalThis & {
      finishFileDialog?: (path: string | null) => void
    }
    if (!state.finishFileDialog) throw new Error('No pending native file choice')
    state.finishFileDialog(path)
    delete state.finishFileDialog
  }, path)
}

for (const state of [
  { name: 'wide English light', locale: 'en', theme: 'light', width: 1160, height: 850, zoom: 1 },
  { name: 'narrow English dark', locale: 'en', theme: 'dark', width: 320, height: 850, zoom: 1 },
  { name: 'narrow Chinese dark', locale: 'zh-CN', theme: 'dark', width: 320, height: 850, zoom: 1 },
  {
    name: 'zoomed Chinese light',
    locale: 'zh-CN',
    theme: 'light',
    width: 1160,
    height: 1000,
    zoom: 2,
  },
])
  test(`file commands retain keyboard context and draft history: ${state.name}`, async () => {
    await mkdir('test/artifacts/logs', { recursive: true })
    const directory = await mkdtemp(resolve('test/artifacts/logs/file-command-focus-e2e-'))
    const profile = join(directory, 'profile')
    await mkdir(profile)
    await writeFile(
      join(profile, 'preferences.json'),
      JSON.stringify({ schemaVersion: 1, locale: state.locale, theme: state.theme }),
    )
    const application = await launchDesktop(profile)
    try {
      const page = await application.firstWindow()
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      const openName = /^(Open file…|打开文件…)$/
      const newName = /^(New document|新建文档)$/
      const saveName = /^(Save|保存)$/
      const editor = page.getByRole('textbox', { name: /^(Markdown source|Markdown 源码)$/ })
      const save = page.getByRole('button', { name: saveName, exact: true })
      await expect(page.locator('.welcome')).toBeVisible()
      await application.evaluate(({ BrowserWindow }, state) => {
        const window = BrowserWindow.getAllWindows()[0]
        window?.setMinimumSize(0, 0)
        window?.webContents.setZoomFactor(state.zoom)
        window?.setContentSize(state.width, state.height)
      }, state)
      await expect.poll(() => page.evaluate(() => innerWidth)).toBe(state.width / state.zoom)

      async function begin(button: Locator, kind: 'open' | 'save'): Promise<void> {
        await holdDialog(application, kind)
        await button.focus()
        await page.keyboard.press('Enter')
        await expect
          .poll(() =>
            application.evaluate(
              () =>
                typeof (globalThis as typeof globalThis & { finishFileDialog?: unknown })
                  .finishFileDialog,
            ),
          )
          .toBe('function')
      }

      async function openControl(): Promise<{ button: Locator; returned: Locator }> {
        const sidebar = page.locator('.sidebar-actions').getByRole('button', { name: openName })
        if (await sidebar.isVisible()) return { button: sidebar, returned: sidebar }
        const disclosure = page.getByRole('button', { name: /^(Document actions|文档操作)$/ })
        await disclosure.focus()
        await page.keyboard.press('Enter')
        return {
          button: page
            .getByRole('group', { name: /^(Document actions|文档操作)$/ })
            .getByRole('button', { name: openName }),
          returned: disclosure,
        }
      }

      async function restored(button: Locator, name: string) {
        await expect(button).toBeEnabled()
        await expect(button).toBeFocused()
        await expect(button).toBeInViewport({ ratio: 1 })
        const visual = await button.evaluate((element) => {
          const background = (element: Element | null): string => {
            while (element && getComputedStyle(element).backgroundColor === 'rgba(0, 0, 0, 0)')
              element = element.parentElement
            return getComputedStyle(element || document.documentElement).backgroundColor
          }
          const style = getComputedStyle(element),
            rect = element.getBoundingClientRect()
          return {
            text: element.textContent,
            font: Number.parseFloat(style.fontSize),
            width: rect.width,
            height: rect.height,
            color: style.color,
            background: background(element),
            adjacent: background(element.parentElement),
            outline: style.outlineStyle,
            outlineWidth: Number.parseFloat(style.outlineWidth),
            outlineColor: style.outlineColor,
            overflow: document.documentElement.scrollWidth > innerWidth,
          }
        })
        expect(visual.height).toBeGreaterThanOrEqual(name.startsWith('welcome') ? 34 : 32)
        expect(visual.width).toBeGreaterThanOrEqual(24)
        expect(visual.font).toBeGreaterThanOrEqual(13)
        expect(visual.outline).toBe('solid')
        expect(visual.outlineWidth).toBeGreaterThanOrEqual(2)
        expect(contrast(visual.color, visual.background)).toBeGreaterThanOrEqual(4.5)
        expect(contrast(visual.outlineColor, visual.adjacent)).toBeGreaterThanOrEqual(3)
        expect(visual.overflow).toBe(false)
        return { name, visual }
      }

      const welcomeOpen = page.locator('.welcome').getByRole('button', { name: openName })
      await begin(welcomeOpen, 'open')
      await finishDialog(application, null)
      const observations = [await restored(welcomeOpen, 'welcome Open canceled')]
      await page.locator('.welcome').getByRole('button', { name: newName }).focus()
      await page.keyboard.press('Enter')
      await expect(editor).toBeFocused()
      await page.getByRole('button', { name: /^(Source|源码)$/, exact: true }).click()
      const source = 'Retained α中文 draft.\nSecond line.'
      const currentSource = async (): Promise<string> =>
        (await editor.locator('.cm-line').allTextContents()).join('\n')
      await editor.focus()
      await page.keyboard.insertText(source)
      await expect.poll(currentSource).toBe(source)

      await begin(save, 'save')
      await finishDialog(application, null)
      observations.push(await restored(save, 'draft Save canceled'))
      await expect.poll(currentSource).toBe(source)
      const canceledOpen = await openControl()
      await begin(canceledOpen.button, 'open')
      await finishDialog(application, null)
      observations.push(await restored(canceledOpen.returned, 'draft Open canceled'))
      await expect.poll(currentSource).toBe(source)
      await save.focus()
      const captured = await application.evaluate(async ({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows()[0]
        if (!window) throw new Error('Missing application window')
        const image = await window.webContents.capturePage()
        return {
          png: image.toPNG().toString('base64'),
          size: image.getSize(),
          zoom: window.webContents.getZoomFactor(),
        }
      })
      await writeFile(join(directory, 'save-focus-native.png'), Buffer.from(captured.png, 'base64'))

      // A real directory target fails in the file service; the bridge/controller stay intact.
      const blocked = join(directory, 'blocked.md')
      await mkdir(blocked)
      await begin(save, 'save')
      await finishDialog(application, blocked)
      observations.push(await restored(save, 'failed Save'))
      await expect(
        page.getByRole('alert').filter({
          hasText:
            /The file operation failed\. Retry or save a copy; your editor content is retained\.|文件操作失败。请重试或保存副本，编辑内容已保留。/,
        }),
      ).toBeVisible()
      await expect.poll(currentSource).toBe(source)

      // Model a pending choice and deliberately provide later input; completion must respect it.
      await begin(save, 'save')
      const preferences = page.getByRole('button', {
        name: /^(Preferences|偏好设置)$/,
        exact: true,
      })
      await preferences.focus()
      await page.keyboard.press('Enter')
      const appearance = page.getByLabel(/^(Appearance|外观)$/, { exact: true })
      await expect(appearance).toBeFocused()
      await finishDialog(application, null)
      await expect(save).toBeEnabled()
      await expect(appearance).toBeFocused()
      await page.keyboard.press('Escape')
      await expect(preferences).toBeFocused()

      await begin(save, 'save')
      await page.locator('.app-toolbar').click({ position: { x: 2, y: 2 } })
      await expect
        .poll(() => page.evaluate(() => document.activeElement === document.body))
        .toBe(true)
      await finishDialog(application, null)
      await expect(save).toBeEnabled()
      await expect
        .poll(() => page.evaluate(() => document.activeElement === document.body))
        .toBe(true)

      // Immediate chooser cancellation also restores focus without leaving a stale request.
      await application.evaluate(({ dialog }) => {
        dialog.showSaveDialog = async () => ({ canceled: true, filePath: '' })
      })
      await save.focus()
      await page.keyboard.press('Enter')
      observations.push(await restored(save, 'immediate Save canceled'))
      await editor.focus()
      await page.keyboard.press(`${modifier}+z`)
      await expect.poll(currentSource).toBe('')
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+y')
      await expect.poll(currentSource).toBe(source)
      const saved = join(directory, 'Saved α中文.md')
      await begin(save, 'save')
      await finishDialog(application, saved)
      observations.push(await restored(save, 'successful Save'))
      await expect.poll(async () => readFile(saved, 'utf8')).toBe(source)

      // A successful Open creates a new editor; its autofocus must take precedence.
      const opened = join(directory, 'Opened α中文.md')
      const original = '\ufeff# Opened α中文\r\n\r\nOriginal bytes.\r\n'
      await writeFile(opened, original)
      await begin((await openControl()).button, 'open')
      await finishDialog(application, opened)
      await expect(page.getByRole('tab', { name: 'Opened α中文.md', exact: true })).toBeVisible()
      await expect(editor).toBeFocused()
      await page.getByRole('button', { name: /^(Source|源码)$/, exact: true }).click()
      await expect
        .poll(currentSource)
        .toBe(original.replace(/^\ufeff/, '').replaceAll('\r\n', '\n'))
      expect(await readFile(opened, 'utf8')).toBe(original)
      expect(await readFile(saved, 'utf8')).toBe(source)
      expect(errors).toEqual([])
      await writeFile(
        join(directory, 'report.json'),
        `${JSON.stringify(
          {
            state,
            observations,
            capture: { size: captured.size, zoom: captured.zoom },
            sourceRetained: true,
            undoRedoRetained: true,
            realSaveFailure: true,
            laterKeyboardAndPointerRespected: true,
            openedEditorFocused: true,
            saved,
            opened,
            errors,
          },
          null,
          2,
        )}\n`,
      )
    } finally {
      await application
        .evaluate(({ BrowserWindow }) => {
          for (const window of BrowserWindow.getAllWindows()) window.destroy()
        })
        .catch(() => {})
      await application.close()
    }
  })
