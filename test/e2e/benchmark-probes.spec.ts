import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import {
  expectCharacterCount,
  measures,
  modifier,
  openFile,
  stop,
  waitForStartup,
} from '../benchmark/helpers'
import { instrumentInput } from '../benchmark/input'
import { launchDesktop } from './helpers'

test('benchmark open timing and document counts follow successive files', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'manuslip-benchmark-open-'))
  const first = join(directory, 'first.md')
  const second = join(directory, 'second.md')
  await writeFile(first, '# First\n\nFirst document.')
  await writeFile(second, '# Second\n\nSecond document.')
  const application = await launchDesktop(join(directory, 'profile'))
  try {
    const page = await application.firstWindow()
    await waitForStartup(page)
    for (const path of [first, second]) {
      const source = await readFile(path, 'utf8')
      const elapsed = await openFile(application, page, path)
      expect(Number.isFinite(elapsed)).toBe(true)
      expect(elapsed).toBeGreaterThan(0)
      await expect(
        page.getByRole('textbox', { name: 'Markdown source' }).locator('.cm-line'),
      ).toHaveText(source.split('\n'))
      await expectCharacterCount(page, source.length)
    }
  } finally {
    await stop(application)
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

test('benchmark mode and input probes record each real keyboard interaction once', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'manuslip-benchmark-input-'))
  const application = await launchDesktop(join(directory, 'profile'))
  try {
    const page = await application.firstWindow()
    await waitForStartup(page)
    await page.getByRole('button', { name: 'New document', exact: true }).first().click()
    const editor = page.getByRole('textbox', { name: 'Markdown source' })
    await editor.fill('# Probe\n\nText.')
    await instrumentInput(page)
    await editor.focus()
    for (const [index, key] of ['1', '2'].entries()) {
      await page.keyboard.press(`${modifier}+${key}`)
      await expect(
        page.getByRole('button', { name: key === '1' ? 'Source' : 'Live Preview', exact: true }),
      ).toHaveAttribute('aria-pressed', 'true')
      await expect
        .poll(() =>
          page.evaluate(() => performance.getEntriesByName('manuslip:benchmark-mode-paint').length),
        )
        .toBe(index + 1)
    }
    await page.keyboard.type('x')
    await expect
      .poll(() =>
        page.evaluate(() => performance.getEntriesByName('manuslip:benchmark-input-paint').length),
      )
      .toBe(1)
    const timings = (await measures(page)).filter((entry) =>
      entry.name.startsWith('manuslip:benchmark-'),
    )
    expect(timings).toHaveLength(3)
    expect(timings.every((entry) => Number.isFinite(entry.duration) && entry.duration > 0)).toBe(
      true,
    )
  } finally {
    await stop(application)
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})
