import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { expect, test } from '@playwright/test'
import { launchDesktop } from '../e2e/helpers'
import {
  expectCharacterCount,
  fixture,
  MiB,
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

test('continuous dense typing and rapid tabs keep one semantic request in flight', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'manuslip-backpressure-'))
  const application = await launchDesktop(join(directory, 'profile'))
  try {
    const page = await application.firstWindow()
    await waitForStartup(page)
    await instrumentInput(page)
    await page.evaluate(() => {
      const outstanding = new Set<number>()
      const stats = {
        posts: 0,
        responses: 0,
        maxInFlight: 0,
        lastTabAt: 0,
        requests: [] as { sequence: number; revision: number; documentId: string }[],
      }
      const OriginalWorker = Worker
      class ObservedWorker extends OriginalWorker {
        private readonly semantic: boolean
        constructor(url: string | URL, options?: WorkerOptions) {
          super(url, options)
          this.semantic = String(url).includes('semantic.worker')
          if (this.semantic)
            this.addEventListener('message', (event) => {
              if (event.data && typeof event.data.sequence === 'number') {
                outstanding.delete(event.data.sequence)
                stats.responses++
              }
            })
        }
        override postMessage(message: unknown, transfer: Transferable[]): void
        override postMessage(message: unknown, options?: StructuredSerializeOptions): void
        override postMessage(
          message: unknown,
          options?: StructuredSerializeOptions | Transferable[],
        ): void {
          if (this.semantic && typeof message === 'object' && message !== null) {
            const input = message as {
              kind?: unknown
              sequence?: number
              revision?: number
              documentId?: string
            }
            if (
              input.kind === 'parse' &&
              typeof input.sequence === 'number' &&
              typeof input.revision === 'number' &&
              typeof input.documentId === 'string'
            ) {
              outstanding.add(input.sequence)
              stats.posts++
              stats.maxInFlight = Math.max(stats.maxInFlight, outstanding.size)
              stats.requests.push({
                sequence: input.sequence,
                revision: input.revision,
                documentId: input.documentId,
              })
            }
          }
          if (Array.isArray(options)) super.postMessage(message, options)
          else super.postMessage(message, options)
        }
      }
      window.Worker = ObservedWorker
      document.addEventListener(
        'click',
        (event) => {
          if (event.target instanceof Element && event.target.closest('[role="tab"]'))
            stats.lastTabAt = performance.now()
        },
        true,
      )
      Reflect.set(window, '__semanticTraffic', stats)
    })
    const chunk = 'A small paragraph. One more short sentence for the next block.\n\n'
    const body = chunk.repeat(Math.ceil(MiB / Buffer.byteLength(chunk)))
    const source = `# First document\n\n${body}`
    const first = await fixture(directory, 'first', source)
    const second = await fixture(directory, 'second', `# Second document\n\n${body}`)
    await openFile(application, page, first)
    expect(await settled(page)).toBe('ready')
    const editor = page.getByRole('textbox', { name: 'Markdown source' })
    await editor.focus()
    await page.keyboard.press(`${modifier}+End`)
    await page.evaluate(() => performance.clearMeasures())
    const appended = 'abcdefghijklmnopqrstuvwxyzabcdefghijklmn'
    // Keep edits arriving faster than the idle debounce, long enough to publish at maxDelay.
    await page.keyboard.type(appended, { delay: 40 })
    expect(await settled(page)).toBe('ready')
    await expectCharacterCount(page, source.length + appended.length)
    const typed = await measures(page)
    const inputPaint = summary(
      typed
        .filter((entry) => entry.name === 'manuslip:benchmark-input-paint')
        .map((entry) => entry.duration),
    )
    const typingFreshness = Number(
      typed.filter((entry) => entry.name === 'manuslip:semantic-apply').at(-1)?.detail?.freshnessMs,
    )
    const typingPosts = await page.evaluate(() => {
      const stats = Reflect.get(window, '__semanticTraffic') as { requests: { revision: number }[] }
      return stats.requests.filter((request) => request.revision > 0).length
    })
    await page.keyboard.press(`${modifier}+s`)
    await expect(page.getByText('All changes saved', { exact: true })).toBeVisible()
    expect((await readFile(first, 'utf8')) === `${source}${appended}`).toBe(true)
    const previous =
      typed.filter((entry) => entry.name === 'manuslip:semantic-apply').at(-1)?.startTime ?? 0
    await application.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
    }, second)
    await page.getByRole('button', { name: 'Open file…', exact: true }).first().click()
    await expect(page.getByRole('tab', { name: basename(second), exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(await settled(page, previous)).toBe('ready')
    for (let index = 0; index < 6; index++) {
      await page
        .getByRole('tab', { name: basename(index % 2 ? second : first), exact: true })
        .click()
      // Real interactions with a deliberate 180 ms dwell publish requests while earlier parses run.
      await page.waitForTimeout(180)
    }
    const beforeFinal =
      (await measures(page)).filter((entry) => entry.name === 'manuslip:semantic-apply').at(-1)
        ?.startTime ?? 0
    await page.getByRole('tab', { name: basename(first), exact: true }).click()
    expect(await settled(page, beforeFinal)).toBe('ready')
    await expectCharacterCount(page, source.length + appended.length)
    const result = await page.evaluate(() => {
      const stats = Reflect.get(window, '__semanticTraffic') as {
        posts: number
        responses: number
        maxInFlight: number
        lastTabAt: number
        requests: { sequence: number; revision: number; documentId: string }[]
      }
      const latest = performance.getEntriesByName('manuslip:semantic-apply').at(-1)
      return {
        ...stats,
        settleAfterFinalTabMs: latest
          ? latest.startTime + latest.duration - stats.lastTabAt
          : Infinity,
      }
    })
    await page.keyboard.press(`${modifier}+s`)
    await expect(page.getByText('All changes saved', { exact: true })).toBeVisible()
    expect((await readFile(first, 'utf8')) === `${source}${appended}`).toBe(true)
    await report(test.info(), 'backpressure', {
      machine: await machine(application),
      method:
        'Two generated 1 MiB dense files; forty edits at 40 ms intervals followed by six alternating tab clicks with 180 ms dwell and a final return. Test-only Worker interception records request identity/counts, not source. Actual in-flight messages are bounded; internal pending queue/watchdog limits are covered separately by deterministic service tests. Frame estimates use two animation frames.',
      inputPaint,
      typingFreshness,
      typingPosts,
      traffic: result,
    })
    expect(result.maxInFlight).toBe(1)
    expect(
      typingPosts,
      'Maximum-delay publication occurs during continuous typing',
    ).toBeGreaterThanOrEqual(2)
    expect(typingPosts, 'Edits are coalesced rather than posted individually').toBeLessThan(
      appended.length,
    )
    expect(inputPaint.n).toBe(appended.length)
    expect(inputPaint.p95 ?? Infinity).toBeLessThan(50)
    expect(typingFreshness).toBeLessThan(1500)
    expect(result.settleAfterFinalTabMs).toBeLessThan(1500)
  } finally {
    await stop(application)
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
})
