import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { launchDesktop } from '../e2e/helpers'
import {
  fixture,
  machine,
  measures,
  modifier,
  openFile,
  report,
  settled,
  stop,
  summary,
  waitForStartup,
} from './helpers'
import { instrumentInput } from './input'

test('cold math and diagram rendering permits concurrent source typing', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'manuslip-cold-widgets-'))
  const application = await launchDesktop(join(directory, 'profile'))
  try {
    const page = await application.firstWindow()
    await waitForStartup(page)
    await instrumentInput(page)
    // A compact document keeps both heavy widgets mounted while its heading is edited.
    const source =
      '# Cold widgets\n\n$\\ce{H2O}$\n\n```mermaid\nflowchart LR\n A[Write] --> B[Read]\n```\n\nEnd'
    const path = await fixture(directory, 'cold-widgets', source)
    const openMs = await openFile(application, page, path)
    const widgetReadiness = page.evaluate(() => {
      const start = performance.now()
      return new Promise<{
        startedAt: number
        mathMs: number
        diagramMs: number
        finishedAt: number
      }>((resolve, reject) => {
        let mathMs: number | null = null
        let diagramMs: number | null = null
        const observer = new MutationObserver(check)
        const timeout = setTimeout(() => {
          observer.disconnect()
          reject(new Error('Cold widgets did not finish'))
        }, 15000)
        function check(): void {
          if (mathMs === null && document.querySelector('[role="math"] svg path'))
            mathMs = performance.now() - start
          if (diagramMs === null && document.querySelector('.cm-live-diagram svg path'))
            diagramMs = performance.now() - start
          if (mathMs === null || diagramMs === null) return
          clearTimeout(timeout)
          observer.disconnect()
          resolve({ startedAt: start, mathMs, diagramMs, finishedAt: performance.now() })
        }
        observer.observe(document.body, { childList: true, subtree: true })
        check()
      })
    })
    // Keep the original promise rejecting at await, without an early unhandled rejection.
    void widgetReadiness.catch(() => {})
    expect(await settled(page)).toBe('ready')
    await page.getByRole('textbox', { name: 'Markdown source' }).focus()
    await page.keyboard.press(`${modifier}+Home`)
    await page.keyboard.press('End')
    const typingStartedAt = await page.evaluate(() => performance.now())
    await page.keyboard.type('abcdefghijklmnopqrst', { delay: 25 })
    const readiness = await widgetReadiness
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    )
    const entries = await measures(page)
    const inputs = entries.filter((entry) => entry.name === 'manuslip:benchmark-input-paint')
    const overlap = inputs.filter((entry) => entry.startTime < readiness.finishedAt).length
    const mathOverlap = inputs.filter(
      (entry) => entry.startTime < readiness.startedAt + readiness.mathMs,
    ).length
    const diagramOverlap = inputs.filter(
      (entry) => entry.startTime < readiness.startedAt + readiness.diagramMs,
    ).length
    const inputPaint = summary(inputs.map((entry) => entry.duration))
    await page.keyboard.press(`${modifier}+s`)
    await expect(page.getByText('All changes saved', { exact: true })).toBeVisible()
    expect(await readFile(path, 'utf8')).toBe(
      source.replace('Cold widgets', 'Cold widgetsabcdefghijklmnopqrst'),
    )
    await report(test.info(), 'cold-widgets', {
      machine: await machine(application),
      method:
        'Fresh process/profile with no earlier math/diagram use; compact document keeps both widgets mounted. Twenty heading edits at 25 ms intervals. Widget readiness starts immediately after editable-open, not from process launch. Overlap counts keydowns before the last widget finishes. Two animation frames estimate paint; these are not 1 MiB corpus measurements.',
      openMs,
      readiness,
      typingStartedAt,
      overlap,
      mathOverlap,
      diagramOverlap,
      inputPaint,
    })
    expect(overlap, 'Typing overlaps cold widget rendering').toBeGreaterThan(0)
    expect(inputPaint.n).toBe(20)
    expect(inputPaint.p95 ?? Infinity).toBeLessThan(50)
  } finally {
    await stop(application)
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
})
