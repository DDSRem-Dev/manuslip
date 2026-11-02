import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { type ElectronApplication, expect, type Page, test } from '@playwright/test'
import { launchDesktop } from './helpers'

type ThreeDocuments = [string, string, string]
async function fixture(
  mode: string,
  run: (
    application: ElectronApplication,
    page: Page,
    paths: ThreeDocuments,
    originals: ThreeDocuments,
  ) => Promise<void>,
) {
  const directory = await mkdtemp(resolve('test/artifacts/logs/document-cycling-'))
  if (!directory.startsWith(`${resolve('test/artifacts/logs')}${sep}`))
    throw new Error('Invalid test directory')
  const paths: ThreeDocuments = [
    join(directory, '1.md'),
    join(directory, '2.md'),
    join(directory, '3.md'),
  ]
  const originals: ThreeDocuments = ['First document.\n', 'Second document.\n', 'Third document.\n']
  for (const [index, path] of paths.entries()) {
    const text = originals[index]
    if (text === undefined) throw new Error('Missing source fixture')
    await writeFile(path, text)
  }
  const application = await launchDesktop(join(directory, 'profile'), paths)
  const errors: string[] = []
  try {
    const page = await application.firstWindow()
    page.on('pageerror', (error) => errors.push(error.message))
    await expect(page.getByRole('tab')).toHaveCount(3)
    await page.getByRole('tab', { name: '1.md', exact: true }).click()
    await page.getByRole('button', { name: mode, exact: true }).click()
    await run(application, page, paths, originals)
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
}
const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'
const editor = (page: Page) =>
  page.getByRole('textbox', { name: /^(Markdown source|Markdown 源码)$/ })
const selected = (page: Page, index: number) =>
  expect(page.getByRole('tab').nth(index - 1)).toHaveAttribute('aria-selected', 'true')
async function cycle(application: ElectronApplication, reverse = false) {
  await application.evaluate(({ BrowserWindow }, reverse) => {
    const window = BrowserWindow.getAllWindows()[0]
    if (!window) throw new Error('Missing application window')
    window.focus()
    const modifiers: ('control' | 'shift')[] = reverse ? ['control', 'shift'] : ['control']
    // CDP keyboard events bypass Electron menu accelerators; enter its native input path.
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Tab', modifiers })
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Tab', modifiers })
  }, reverse)
}
async function saved(page: Page, path: string, text: string) {
  await editor(page).press(`${modifier}+s`)
  const sha = (value: string) => createHash('sha256').update(value).digest('hex')
  await expect.poll(async () => sha(await readFile(path, 'utf8'))).toBe(sha(text))
  await test.info().attach('saved-snapshot', {
    body: JSON.stringify({ path, bytes: Buffer.byteLength(text), sha256: sha(text) }),
    contentType: 'application/json',
  })
}
async function frames(page: Page) {
  await page.evaluate(async () => {
    for (let i = 0; i < 5; i++) await new Promise((resolve) => requestAnimationFrame(resolve))
  })
}
for (const mode of ['Source', 'Live Preview']) {
  test(`${mode} cycles documents with native shortcuts, preserves history and keeps Preferences in control`, async () => {
    await fixture(mode, async (application, page, paths, originals) => {
      await editor(page).focus()
      await editor(page).press(`${modifier}+End`)
      await page.keyboard.type('Added 世界')
      await saved(page, paths[0], `${originals[0]}Added 世界`)
      await cycle(application)
      await selected(page, 2)
      await expect(editor(page)).toBeFocused()
      await cycle(application)
      await selected(page, 3)
      await cycle(application)
      await selected(page, 1)
      await expect(page.getByText('Ln 2, Col 9', { exact: true })).toBeVisible()
      for (const index of [3, 2, 1]) {
        await cycle(application, true)
        await selected(page, index)
      }
      await editor(page).press(`${modifier}+z`)
      await saved(page, paths[0], originals[0])
      await editor(page).press(process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+y')
      await saved(page, paths[0], `${originals[0]}Added 世界`)
      await page.getByRole('tab', { name: '1.md', exact: true }).focus()
      await cycle(application)
      await selected(page, 2)
      await expect(page.getByRole('tab', { name: '2.md', exact: true })).toBeFocused()
      await page.getByRole('button', { name: 'Preferences', exact: true }).click()
      await page.getByLabel('Interface language', { exact: true }).selectOption('zh-CN')
      await expect
        .poll(() =>
          application.evaluate(({ Menu }) =>
            Menu.getApplicationMenu()
              ?.items.flatMap((item) => item.submenu?.items ?? [])
              .filter((item) => ['Ctrl+Tab', 'Ctrl+Shift+Tab'].includes(item.accelerator ?? ''))
              .map((item) => item.label),
          ),
        )
        .toEqual(['下一文档', '上一文档'])
      await cycle(application)
      await frames(page)
      await selected(page, 2)
      await expect(page.getByRole('dialog')).toBeVisible()
      await page.getByRole('button', { name: '关闭偏好设置', exact: true }).click()
      await editor(page).focus()
      await cycle(application, true)
      await selected(page, 1)
      expect(await readFile(paths[1], 'utf8')).toBe(originals[1])
      expect(await readFile(paths[2], 'utf8')).toBe(originals[2])
    })
  })
  test(`${mode} accumulates native tab requests while composition keeps input in the original document`, async () => {
    await fixture(mode, async (application, page, paths, originals) => {
      const ime = (method: string, params: Record<string, unknown>) =>
        application.evaluate(
          async ({ BrowserWindow }, { method, params }) => {
            const window = BrowserWindow.getAllWindows()[0]
            if (!window) throw new Error('Missing source window')
            const debug = window.webContents.debugger
            if (!debug.isAttached()) debug.attach('1.3')
            await debug.sendCommand(method, params)
          },
          { method, params },
        )
      await editor(page).focus()
      await editor(page).press(`${modifier}+End`)
      await ime('Input.imeSetComposition', { text: 'shi', selectionStart: 3, selectionEnd: 3 })
      await cycle(application)
      await cycle(application)
      await frames(page)
      await selected(page, 1)
      await ime('Input.imeSetComposition', { text: '世界', selectionStart: 2, selectionEnd: 2 })
      await ime('Input.insertText', { text: '世界' })
      await selected(page, 3)
      for (const index of [2, 1]) {
        await cycle(application, true)
        await selected(page, index)
      }
      await saved(page, paths[0], `${originals[0]}世界`)
      await editor(page).press(`${modifier}+z`)
      await saved(page, paths[0], originals[0])
      await editor(page).press(process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+y')
      await saved(page, paths[0], `${originals[0]}世界`)
      expect(await readFile(paths[1], 'utf8')).toBe(originals[1])
      expect(await readFile(paths[2], 'utf8')).toBe(originals[2])
    })
  })
}
