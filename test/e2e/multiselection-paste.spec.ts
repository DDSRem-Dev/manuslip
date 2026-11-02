import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { expect, test } from '@playwright/test'
import { launchDesktop } from './helpers'

for (const mode of ['Source', 'Live Preview'])
  test(`${mode} distributes large plain-text clipboard lines over multiple selections with isolated undo`, async () => {
    const directory = await mkdtemp(resolve('test/artifacts/logs/multiselection-paste-'))
    if (!directory.startsWith(`${resolve('test/artifacts/logs')}${sep}`))
      throw new Error('Invalid test directory')
    const path = join(directory, 'source.md')
    const original = 'token keep token\n'
    await writeFile(path, original)
    const application = await launchDesktop(join(directory, 'profile'), [path])
    const errors: string[] = []
    const digest = (text: string) => createHash('sha256').update(text).digest('hex')
    try {
      const page = await application.firstWindow()
      page.on('pageerror', (error) => errors.push(error.message))
      await expect(page.getByRole('tab', { name: 'source.md', exact: true })).toBeVisible()
      await page.getByRole('button', { name: mode, exact: true }).click()
      const editor = page.getByRole('textbox', { name: 'Markdown source' })
      const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'
      let saves = 0
      const save = async (text: string) => {
        await editor.press(`${modifier}+s`)
        try {
          await expect.poll(async () => digest(await readFile(path, 'utf8'))).toBe(digest(text))
        } finally {
          const actual = await readFile(path, 'utf8')
          await test.info().attach(`saved-${++saves}`, {
            body: JSON.stringify({
              expected: { length: text.length, sha256: digest(text) },
              actual: {
                length: actual.length,
                sha256: digest(actual),
                prefix: actual.slice(0, 60),
                suffix: actual.slice(-60),
              },
            }),
            contentType: 'application/json',
          })
        }
      }
      const undo = async () => {
        await editor.press(`${modifier}+z`)
      }
      const redo = async () => {
        await editor.press(process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+y')
      }
      for (const size of [30, 150000]) {
        const first = `first 中文😀${'a'.repeat(size)}`
        const second = `second 日本語${'b'.repeat(size + 3)}`
        await editor.focus()
        await editor.press(`${modifier}+Home`)
        await editor.press(`${modifier}+d`)
        await editor.press(`${modifier}+d`)
        const event = await editor.evaluate((content, text) => {
          const data = new DataTransfer()
          data.setData('text/plain', text)
          const event = new ClipboardEvent('paste', {
            clipboardData: data,
            bubbles: true,
            cancelable: true,
          })
          content.dispatchEvent(event)
          return { prevented: event.defaultPrevented, trusted: event.isTrusted }
        }, `${first}\r\n${second}`)
        await test.info().attach(`clipboard-${size}`, {
          body: JSON.stringify(event),
          contentType: 'application/json',
        })
        expect(event).toEqual({ prevented: true, trusted: false })
        await expect(page.getByRole('button', { name: 'Cancel paste', exact: true })).toHaveCount(0)
        await save(`${first} keep ${second}\n`)
        if (size === 30) {
          // The native small-paste path may group subsequent typing in its history.
          await undo()
          await save(original)
          await redo()
          await save(`${first} keep ${second}\n`)
          await undo()
          await save(original)
          continue
        }
        // Subsequent native typing proves both selection cursors survived the paste.
        await editor.press('!')
        await save(`${first}! keep ${second}!\n`)
        await undo()
        await save(`${first} keep ${second}\n`)
        await undo()
        await save(original)
        await redo()
        await save(`${first} keep ${second}\n`)
        await redo()
        await save(`${first}! keep ${second}!\n`)
        await undo()
        await undo()
        await save(original)
      }
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
