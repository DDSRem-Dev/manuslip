import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { launchDesktop } from '../e2e/helpers'
import {
  closeFile,
  fixture,
  MiB,
  machine,
  modifier,
  openFile,
  report,
  stop,
  waitForStartup,
} from './helpers'

const digest = (source: string | Buffer) => createHash('sha256').update(source).digest('hex')

test('exact 50 MiB UTF-8 boundary opens, rejects growth and preserves replacement undo and save', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'manuslip-boundary-'))
  const chunk = `${'Boundary writing includes 中文 and 😀. '.repeat(24)}\n`
  const cap = 50 * MiB
  const count = Math.floor(cap / Buffer.byteLength(chunk))
  const padding = cap - count * Buffer.byteLength(chunk)
  // Finish with ASCII so the replacement changes one byte without splitting UTF-8.
  const source = chunk.repeat(count) + 'x'.repeat(padding)
  expect(padding).toBeGreaterThan(0)
  expect(Buffer.byteLength(source)).toBe(cap)
  const originalHash = digest(source)
  const changedHash = digest(`${source.slice(0, -1)}Z`)
  const path = await fixture(directory, 'exact-boundary', source)
  const application = await launchDesktop(join(directory, 'profile'))
  try {
    const page = await application.firstWindow()
    await waitForStartup(page)
    const openMs = await openFile(application, page, path)
    await expect(page.getByRole('button', { name: 'Source', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    const editor = page.getByRole('textbox', { name: 'Markdown source' })
    await editor.focus()
    await page.keyboard.press(`${modifier}+End`)
    await page.keyboard.type('!')
    await expect(
      page.getByText('This document exceeds the 50 MiB editing limit. Open a smaller file.', {
        exact: true,
      }),
    ).toBeVisible()
    await page.keyboard.press(`${modifier}+s`)
    await expect(page.getByText('All changes saved', { exact: true })).toBeVisible()
    expect(digest(await readFile(path))).toBe(originalHash)

    await editor.focus()
    await page.keyboard.press(`${modifier}+End`)
    await page.keyboard.press('Shift+ArrowLeft')
    await editor.evaluate((element) => {
      const clipboardData = new DataTransfer()
      clipboardData.setData('text/plain', '界')
      element.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }),
      )
    })
    await page.keyboard.press(`${modifier}+s`)
    await expect(page.getByText('All changes saved', { exact: true })).toBeVisible()
    expect(digest(await readFile(path))).toBe(originalHash)

    await editor.focus()
    await page.keyboard.press(`${modifier}+End`)
    await page.keyboard.press('Shift+ArrowLeft')
    await page.keyboard.type('Z')
    await page.keyboard.press(`${modifier}+s`)
    await expect(page.getByText('All changes saved', { exact: true })).toBeVisible()
    expect((await stat(path)).size).toBe(cap)
    expect(digest(await readFile(path))).toBe(changedHash)

    await page.keyboard.press(`${modifier}+z`)
    await page.keyboard.press(`${modifier}+s`)
    await expect(page.getByText('All changes saved', { exact: true })).toBeVisible()
    expect(digest(await readFile(path))).toBe(originalHash)
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+y')
    await page.keyboard.press(`${modifier}+s`)
    await expect(page.getByText('All changes saved', { exact: true })).toBeVisible()
    expect(digest(await readFile(path))).toBe(changedHash)

    await closeFile(page, path)
    const reopenMs = await openFile(application, page, path)
    await editor.focus()
    await page.keyboard.press(`${modifier}+End`)
    await expect(page.locator('.cm-content .cm-line').last()).toHaveText(
      `${'x'.repeat(padding - 1)}Z`,
    )
    await closeFile(page, path)
    expect((await stat(path)).size).toBe(cap)
    expect(digest(await readFile(path))).toBe(changedHash)
    await report(test.info(), 'boundary', {
      machine: await machine(application),
      method:
        'A generated valid UTF-8 file exactly 50 MiB, with CJK and supplementary characters on wrapped lines. Actual keyboard growth and a synthetic DOM paste replacing one ASCII byte with three UTF-8 bytes are rejected (OS clipboard unchanged). A one-byte selection replacement, undo, redo, save and reopen preserve whole-file SHA-256; the reopened editor reveals the saved tail. Open timings exclude native dialog dwell. This is a boundary correctness check without a 50 MiB latency budget.',
      bytes: cap,
      originalHash,
      changedHash,
      openMs,
      reopenMs,
      rejectedGrowth: true,
      rejectedMultibytePaste: true,
      exactReplacementUndoRedo: true,
    })
  } finally {
    await stop(application)
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
})
