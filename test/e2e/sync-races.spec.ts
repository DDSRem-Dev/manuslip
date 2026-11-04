import { once } from 'node:events'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { join, resolve, sep } from 'node:path'
import { expect, test } from '@playwright/test'
import { launchDesktop } from './helpers'

for (const composing of [false, true]) {
  test(`a late sync download preserves ${composing ? 'active composition' : 'a newer dirty draft'} through the file conflict flow`, async () => {
    test.setTimeout(60_000)
    const directory = await mkdtemp(resolve('test/e2e/result/sync-race-native-'))
    if (!directory.startsWith(resolve('test/e2e/result') + sep)) throw new Error('Unsafe fixture')
    const path = join(directory, 'source.md'),
      profile = join(directory, 'profile'),
      original = '# Original\n\nKeep this writing. '
    await writeFile(path, original)
    let release: () => void = () => {},
      entered: () => void = () => {},
      hold = false
    const waiting = new Promise<void>((resolve) => {
      entered = resolve
    })
    const server = createServer(async (request, response) => {
      if (request.method !== 'GET') {
        response.writeHead(405).end()
        return
      }
      if (hold) {
        hold = false
        entered()
        await new Promise<void>((resolve) => {
          release = resolve
        })
      }
      response.writeHead(200, { ETag: '"remote"' }).end('# Remote version\n')
    }).listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing test server')
    const application = await launchDesktop(profile, [path])
    try {
      const page = await application.firstWindow()
      await page.getByRole('button', { name: 'Source', exact: true }).click()
      const editor = page.getByRole('textbox', { name: 'Markdown source', exact: true })
      await expect(editor).toContainText('Keep this writing.')
      await application.evaluate(({ dialog }, path) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
      }, path)
      const review = await page.evaluate(async (url) => {
        const opened = await window.manuslip.openDocument()
        if (!opened.ok || !opened.value) throw new Error('Missing saved file')
        const id = opened.value.info.id,
          connected = await window.manuslip.connectSync({ documentId: id, kind: 'webdav', url })
        if (!connected.ok) throw new Error(connected.code)
        const reviewed = await window.manuslip.reviewSync(id)
        if (!reviewed.ok || !reviewed.value.review) throw new Error('Missing review')
        return { id, token: reviewed.value.review.id }
      }, `http://127.0.0.1:${address.port}/source.md`)
      hold = true
      await page.evaluate(({ token }) => {
        void window.manuslip
          .resolveSync(token, 'download')
          .then((value) => Reflect.set(window, '__syncRaceResult', value))
      }, review)
      await waiting
      await editor.fill('# My later draft\n\nKeep this writing. ')
      if (composing) {
        await editor.press(process.platform === 'darwin' ? 'Meta+End' : 'Control+End')
        await application.evaluate(async ({ BrowserWindow }) => {
          const debug = BrowserWindow.getAllWindows()[0]?.webContents.debugger
          if (!debug) throw new Error('Missing debugger')
          if (!debug.isAttached()) debug.attach('1.3')
          await debug.sendCommand('Input.imeSetComposition', {
            text: 'shi',
            selectionStart: 3,
            selectionEnd: 3,
          })
        })
        await expect(editor).toContainText('shi')
      }
      release()
      await expect
        .poll(() => page.evaluate(() => Reflect.get(window, '__syncRaceResult')?.ok))
        .toBe(true)
      await expect(
        page.getByText('This file changed outside Manuslip.', { exact: false }),
      ).toBeVisible()
      expect(await readFile(path, 'utf8')).toBe('# Remote version\n')
      await expect(editor).toContainText('My later draft')
      if (composing) {
        await application.evaluate(async ({ BrowserWindow }) => {
          const debug = BrowserWindow.getAllWindows()[0]?.webContents.debugger
          await debug?.sendCommand('Input.imeSetComposition', {
            text: '世界',
            selectionStart: 2,
            selectionEnd: 2,
          })
          await debug?.sendCommand('Input.insertText', { text: '世界' })
        })
        await expect(editor).toContainText('世界')
      }
      await application.evaluate(({ dialog }) => {
        dialog.showSaveDialog = async () => ({ canceled: true, filePath: '' })
        dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false })
      })
      const copies = await page.evaluate(async (id) => {
        const state = await window.manuslip.syncState(id)
        if (!state.ok) throw new Error(state.code)
        return state.value.copies
      }, review.id)
      expect(copies).toHaveLength(1)
      await test.info().attach('sync-dirty-conflict', {
        body: await page.locator('body').ariaSnapshot(),
        contentType: 'text/plain',
      })
    } finally {
      release()
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
      await application
        .evaluate(({ BrowserWindow }) => {
          for (const window of BrowserWindow.getAllWindows()) window.destroy()
        })
        .catch(() => {})
      await application.close()
      await rm(directory, { recursive: true, force: true, maxRetries: 3 })
    }
  })
}
