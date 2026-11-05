import { mkdtemp, open, readFile, rm, stat } from 'node:fs/promises'
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

const fill = (chunk: string) => chunk.repeat(Math.ceil((5 * MiB) / Buffer.byteLength(chunk)))

test('5 MiB source stress preserves edits, paste, replace-all and cap rejection', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'manuslip-stress-'))
  const application = await launchDesktop(join(directory, 'profile'))
  try {
    const page = await application.firstWindow()
    await waitForStartup(page)
    const results = []
    for (const entry of [
      { name: 'long-line', source: fill('A long line must remain editable. ') },
      { name: 'nested', source: fill('> > > > > > > > Nested **writing** with `code`.\n\n') },
    ]) {
      const path = await fixture(directory, entry.name, entry.source)
      const openMs = await openFile(application, page, path)
      await expect(page.getByRole('button', { name: 'Source', exact: true })).toHaveAttribute(
        'aria-pressed',
        'true',
      )
      await page.getByRole('button', { name: 'Live Preview', exact: true }).click()
      await expect(
        page.getByText('Preview exceeds its resource limit. Continue editing in Source mode.', {
          exact: true,
        }),
      ).toBeVisible()
      await page.getByRole('textbox', { name: 'Markdown source' }).focus()
      await page.keyboard.press(`${modifier}+End`)
      await page.keyboard.type(' edited')
      await page.keyboard.press(`${modifier}+s`)
      await expect(page.getByText('All changes saved', { exact: true })).toBeVisible()
      expect(await readFile(path, 'utf8')).toBe(`${entry.source} edited`)
      results.push({
        name: entry.name,
        bytes: Buffer.byteLength(entry.source),
        openMs,
        fallback: 'source-size-limit',
        exactSave: true,
      })
      await closeFile(page, path)
    }

    const path = await fixture(directory, 'bulk', '# Bulk\n\n')
    await openFile(application, page, path)
    const editor = page.getByRole('textbox', { name: 'Markdown source' })
    await editor.focus()
    await page.keyboard.press(`${modifier}+End`)
    const pasted = fill(`${'A passage of ordinary prose. '.repeat(512)}\n\nREPLACEME\n\n`)
    const pasteMs = await editor.evaluate(async (element, text) => {
      const clipboardData = new DataTransfer()
      clipboardData.setData('text/plain', text)
      const start = performance.now()
      element.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }),
      )
      // Large paste is staged; include preparation and wait for its atomic commit.
      await new Promise<void>((resolve, reject) => {
        const frame = () => {
          const committed = performance
            .getEntriesByName('manuslip:paste-commit')
            .some((entry) => entry.startTime >= start)
          if (committed) resolve()
          else if (performance.now() - start > 15000) reject(new Error('Paste did not commit'))
          else requestAnimationFrame(frame)
        }
        frame()
      })
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      )
      return performance.now() - start
    }, pasted)
    await expect(page.getByRole('button', { name: 'Source', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await editor.focus()
    await page.keyboard.press(`${modifier}+f`)
    await page.locator('.cm-search input[name=search]').fill('REPLACEME')
    await page.locator('.cm-search input[name=replace]').fill('REPLACED')
    // The native panel commits replacements on blur/keyup, as a real click does.
    await page.locator('.cm-search input[name=replace]').press('Tab')
    const replaceMs = await page
      .locator('.cm-search button[name=replaceAll]')
      .evaluate(async (element) => {
        const start = performance.now()
        if (!(element instanceof HTMLButtonElement)) throw new Error('Missing Replace all button')
        element.click()
        await new Promise<void>((resolve, reject) => {
          const frame = () => {
            if (
              performance
                .getEntriesByName('manuslip:replace-commit')
                .some((entry) => entry.startTime >= start)
            )
              resolve()
            else if (performance.now() - start > 15000)
              reject(new Error('Replacement did not commit'))
            else requestAnimationFrame(frame)
          }
          frame()
        })
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        )
        return performance.now() - start
      })
    await page.keyboard.press('Escape')
    await expect(page.locator('.cm-search')).toHaveCount(0)
    await editor.focus()
    await page.keyboard.press(`${modifier}+End`)
    await page.keyboard.type('after search')
    await page.keyboard.press(`${modifier}+s`)
    await expect(page.getByText('All changes saved', { exact: true })).toBeVisible()
    expect(
      (await readFile(path, 'utf8')) ===
        `# Bulk\n\n${pasted.replaceAll('REPLACEME', 'REPLACED')}after search`,
      'Bulk operations preserve exact saved content',
    ).toBe(true)
    await closeFile(page, path)
    results.push({
      name: 'paste-and-replace',
      bytes: Buffer.byteLength(pasted),
      pasteMs,
      replaceMs,
      exactSave: true,
    })

    const oversized = join(directory, 'over-cap.md')
    const handle = await open(oversized, 'w')
    try {
      await handle.truncate(50 * MiB + 1)
    } finally {
      await handle.close()
    }
    await application.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
    }, oversized)
    await page.getByRole('button', { name: 'Open file…', exact: true }).first().click()
    await expect(
      page.getByText('This document exceeds the 50 MiB editing limit. Open a smaller file.', {
        exact: true,
      }),
    ).toBeVisible()
    await expect(page.getByRole('tab')).toHaveCount(0)
    expect((await stat(oversized)).size).toBe(50 * MiB + 1)
    await report(test.info(), 'stress', {
      machine: await machine(application),
      method:
        'Generated UTF-8 files and synthetic DOM plain-text paste (OS clipboard unchanged). Paste and replace-all wait for their atomic commits including staged preparation; timings start in the renderer and end at the second animation frame, excluding test transport. Search Escape and subsequent editing/save are verified. Source fallback over 2 MiB is expected; no 5 MiB latency budget is asserted. An over-cap file created by truncation is rejected before decoding.',
      results,
      overCapRejected: true,
    })
  } finally {
    await stop(application)
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
})
