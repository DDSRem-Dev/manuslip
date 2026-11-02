import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { launchDesktop } from '../e2e/helpers'

test('records 1 MiB Live Preview typing and semantic phase measurements', async () => {
  test.setTimeout(60000)
  const directory = await mkdtemp(join(tmpdir(), 'manuslip-performance-'))
  const path = join(directory, 'reference.md')
  const paragraph =
    'Writing leaves room for another idea. A short sentence makes the next edit easy. '.repeat(8)
  let source = '# Reference corpus\n\n'
  while (source.length < 1024 * 1024) source += `${paragraph}\n\n`
  await writeFile(path, source)
  const application = await launchDesktop(join(directory, 'profile'))
  try {
    const page = await application.firstWindow()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await application.evaluate(({ dialog }, selected) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] })
    }, path)
    await page.getByRole('button', { name: 'Open file…', exact: true }).first().click()
    const editor = page.getByRole('textbox', { name: 'Markdown source' })
    await expect(editor).toBeEditable()
    await page.getByRole('button', { name: 'Live Preview', exact: true }).click()
    await expect
      .poll(
        () => page.evaluate(() => performance.getEntriesByName('manuslip:semantic-apply').length),
        { timeout: 15000 },
      )
      .toBeGreaterThan(0)
    await editor.focus()
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Home' : 'Control+Home')
    await page.evaluate(() => {
      document.querySelector('.cm-content')?.addEventListener('keydown', () => {
        const start = performance.now()
        requestAnimationFrame(() =>
          performance.measure('manuslip:input-frame', { start, end: performance.now() }),
        )
      })
    })
    await page.keyboard.type('A series of edits while semantic parsing is enabled.', { delay: 25 })
    await expect(page.getByText('Updating preview…', { exact: true })).toHaveCount(0, {
      timeout: 15000,
    })
    const metrics = await page.evaluate(() =>
      performance
        .getEntriesByType('measure')
        .filter((entry) => entry.name.startsWith('manuslip:'))
        .map((entry) => ({
          name: entry.name,
          duration: entry.duration,
          detail: (entry as PerformanceMeasure).detail,
        })),
    )
    await test.info().attach('semantic-performance.json', {
      body: JSON.stringify({ corpusBytes: source.length, metrics }, null, 2),
      contentType: 'application/json',
    })
    const p95 = (values: number[]): number =>
      values.sort((a, b) => a - b)[Math.floor(values.length * 0.95)] || 0
    console.log(
      '1 MiB local measurements:',
      JSON.stringify({
        inputFrameP95: p95(
          metrics
            .filter((entry) => entry.name === 'manuslip:input-frame')
            .map((entry) => entry.duration),
        ),
        requestP95: p95(
          metrics
            .filter((entry) => entry.name === 'manuslip:semantic-request')
            .map((entry) => entry.duration),
        ),
        applyP95: p95(
          metrics
            .filter((entry) => entry.name === 'manuslip:semantic-apply')
            .map((entry) => entry.duration),
        ),
        latest: metrics.filter((entry) => entry.name === 'manuslip:semantic-apply').at(-1)?.detail,
      }),
    )
    expect(errors).toEqual([])
    await expect(page.getByRole('button', { name: 'Live Preview', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
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
