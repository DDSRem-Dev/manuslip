import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { cpus, freemem, platform, release, totalmem } from 'node:os'
import { basename, join } from 'node:path'
import type { ElectronApplication, Page, TestInfo } from '@playwright/test'
import { expect } from '@playwright/test'
import type { Debugger } from 'electron'

export const MiB = 1024 * 1024
export const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'
export function percentile(values: readonly number[], fraction = 0.95): number | null {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted.length ? (sorted[Math.ceil(sorted.length * fraction) - 1] ?? null) : null
}
export const summary = (values: readonly number[]) => ({
  n: values.length,
  p50: percentile(values, 0.5),
  p95: percentile(values),
  max: values.length ? Math.max(...values) : null,
})
export async function report(test: TestInfo, name: string, result: unknown): Promise<void> {
  const text = JSON.stringify(result, null, 2)
  const path = test.outputPath(`${name}.json`)
  await writeFile(path, text)
  await test.attach(name, { path, contentType: 'application/json' })
  console.log(`${name} report: ${path}`)
}
export async function machine(application: ElectronApplication) {
  const executable = process.env.MANUSLIP_PACKAGED_EXECUTABLE
  if (!executable) throw new Error('Performance gates require the packaged executable')
  const bundle = await application.evaluate(({ app }) => app.getAppPath())
  if (!bundle.endsWith('.asar')) throw new Error('Expected an ASAR-packaged application')
  return {
    date: new Date().toISOString(),
    platform: platform(),
    release: release(),
    arch: process.arch,
    cpu: cpus()[0]?.model,
    logicalCpus: cpus().length,
    totalMemory: totalmem(),
    freeMemory: freemem(),
    executable: basename(executable),
    sha256: createHash('sha256')
      .update(await readFile(executable))
      .digest('hex'),
    bundleSha256: createHash('sha256')
      .update(await readFile(bundle))
      .digest('hex'),
    runtime: await application.evaluate(() => process.versions),
  }
}
export async function stop(application: ElectronApplication): Promise<void> {
  await application
    .evaluate(({ BrowserWindow }) => {
      for (const window of BrowserWindow.getAllWindows())
        if (!window.isDestroyed()) window.destroy()
    })
    .catch(() => {})
  await application.close()
}
export async function openFile(
  application: ElectronApplication,
  page: Page,
  path: string,
): Promise<number> {
  await application.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
  }, path)
  await page.evaluate(() => {
    performance.clearMeasures()
    Reflect.set(window, '__benchmarkOpen', null)
    const button = [...document.querySelectorAll('button')].find(
      (button) => button.textContent === 'Open file…',
    )
    if (!button) throw new Error('Missing Open command')
    button.addEventListener(
      'click',
      () => {
        const start = performance.now()
        const observer = new MutationObserver(() => {
          if (!document.querySelector('.cm-content[contenteditable="true"]')) return
          observer.disconnect()
          requestAnimationFrame(() =>
            Reflect.set(window, '__benchmarkOpen', performance.now() - start),
          )
        })
        observer.observe(document.body, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ['contenteditable'],
        })
      },
      { once: true, capture: true },
    )
  })
  await page.getByRole('button', { name: 'Open file…', exact: true }).first().click()
  await expect
    .poll(() => page.evaluate(() => Reflect.get(window, '__benchmarkOpen')))
    .not.toBeNull()
  await expect(page.getByRole('tab', { name: basename(path), exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  return page.evaluate(() => Number(Reflect.get(window, '__benchmarkOpen')))
}
export async function closeFile(page: Page, path: string): Promise<void> {
  await page.getByRole('button', { name: `Close ${basename(path)}`, exact: true }).click()
  await expect(page.getByRole('tab', { name: basename(path), exact: true })).toHaveCount(0)
}
export async function settled(page: Page, after = 0): Promise<'ready' | 'fallback'> {
  await expect
    .poll(
      async () => {
        if (
          (await page
            .getByRole('button', { name: 'Source', exact: true })
            .getAttribute('aria-pressed')) === 'true'
        )
          return 'fallback'
        const applied = await page.evaluate(
          (after) =>
            (performance.getEntriesByName('manuslip:semantic-apply').at(-1)?.startTime ?? 0) >
            after,
          after,
        )
        return !applied || (await page.getByText('Updating preview…', { exact: true }).count())
          ? 'pending'
          : 'ready'
      },
      { timeout: 15000, intervals: [25, 50, 100] },
    )
    .not.toBe('pending')
  return (await page
    .getByRole('button', { name: 'Live Preview', exact: true })
    .getAttribute('aria-pressed')) === 'true'
    ? 'ready'
    : 'fallback'
}
export interface Measure {
  name: string
  startTime: number
  duration: number
  detail: Record<string, number | boolean> | null
}
export async function measures(page: Page): Promise<Measure[]> {
  return page.evaluate(() =>
    performance
      .getEntriesByType('measure')
      .filter((entry) => entry.name.startsWith('manuslip:'))
      .map((entry) => ({
        name: entry.name,
        startTime: entry.startTime,
        duration: entry.duration,
        detail: (entry as PerformanceMeasure).detail,
      })),
  )
}
export async function clearMeasures(page: Page): Promise<void> {
  await page.evaluate(() => performance.clearMeasures())
}

interface Target {
  type: string
  url: string
}
interface DebugState {
  debug: Debugger
  sessions: Map<string, Target>
  handler: (event: unknown, method: string, params: unknown) => void
}
/** Test-only DevTools attachment; production exposes no diagnostic IPC or editor object. */
export async function attachHeapProbe(application: ElectronApplication): Promise<void> {
  await application.evaluate(async ({ app, BrowserWindow }) => {
    const contents = BrowserWindow.getAllWindows()[0]?.webContents
    if (!contents) throw new Error('No editor window')
    const debug = contents.debugger
    debug.attach('1.3')
    const sessions = new Map<string, { type: string; url: string }>()
    const handler = (_event: unknown, method: string, input: unknown): void => {
      const params = input as { sessionId: string; targetInfo?: { type: string; url: string } }
      if (method === 'Target.attachedToTarget' && params.targetInfo)
        sessions.set(params.sessionId, params.targetInfo)
      if (method === 'Target.detachedFromTarget') sessions.delete(params.sessionId)
    }
    debug.on('message', handler)
    Reflect.set(app, '__benchmarkDebug', { debug, sessions, handler })
    await debug.sendCommand('Target.setAutoAttach', {
      autoAttach: true,
      waitForDebuggerOnStart: false,
      flatten: true,
    })
  })
}
export async function detachHeapProbe(application: ElectronApplication): Promise<void> {
  await application
    .evaluate(({ app }) => {
      const state = Reflect.get(app, '__benchmarkDebug') as DebugState | undefined
      if (state) {
        state.debug.removeListener('message', state.handler)
        state.debug.detach()
        Reflect.deleteProperty(app, '__benchmarkDebug')
      }
    })
    .catch(() => {})
}
export async function resources(application: ElectronApplication) {
  return application.evaluate(async ({ app, ipcMain, BrowserWindow }) => {
    const state = Reflect.get(app, '__benchmarkDebug') as DebugState | undefined
    if (!state) throw new Error('Heap probe not attached')
    const inspector = process.getBuiltinModule('node:inspector')
    const session = new inspector.Session()
    session.connect()
    try {
      await new Promise<void>((resolve, reject) =>
        session.post('HeapProfiler.collectGarbage', (error) => (error ? reject(error) : resolve())),
      )
    } finally {
      session.disconnect()
    }
    const memory = process.memoryUsage()
    const targets: {
      type: string
      url: string
      isolate: string
      usedSize: number
      totalSize: number
      embedderHeapUsedSize: number
      backingStorageSize: number
    }[] = []
    const isolates = new Set<string>()
    for (const [sessionId, target] of [
      [undefined, { type: 'page', url: 'editor' }] as const,
      ...state.sessions,
    ]) {
      if (!['page', 'worker', 'iframe'].includes(target.type)) continue
      await state.debug.sendCommand('HeapProfiler.collectGarbage', {}, sessionId)
      const isolate = (await state.debug.sendCommand('Runtime.getIsolateId', {}, sessionId))
        .id as string
      if (isolates.has(isolate)) continue
      isolates.add(isolate)
      const usage = (await state.debug.sendCommand('Runtime.getHeapUsage', {}, sessionId)) as {
        usedSize: number
        totalSize: number
        embedderHeapUsedSize?: number
        backingStorageSize?: number
      }
      targets.push({
        type: target.type,
        url: target.type === 'worker' ? (target.url.split('/').at(-1) ?? 'worker') : 'editor',
        isolate,
        ...usage,
        embedderHeapUsedSize: usage.embedderHeapUsedSize ?? 0,
        backingStorageSize: usage.backingStorageSize ?? 0,
      })
    }
    const events = (emitter: typeof ipcMain) =>
      Object.fromEntries(
        emitter.eventNames().map((name) => [String(name), emitter.listenerCount(name)]),
      )
    return {
      memory,
      targets,
      retained:
        memory.heapUsed +
        memory.external +
        targets.reduce(
          (sum, target) =>
            sum + target.usedSize + target.embedderHeapUsedSize + target.backingStorageSize,
          0,
        ),
      resources: process.getActiveResourcesInfo().reduce<Record<string, number>>((counts, name) => {
        counts[name] = (counts[name] ?? 0) + 1
        return counts
      }, {}),
      ipcListeners: events(ipcMain),
      contentsListeners: BrowserWindow.getAllWindows().map((window) =>
        Object.fromEntries(
          window.webContents
            .eventNames()
            .map((name) => [String(name), window.webContents.listenerCount(name)]),
        ),
      ),
      processes: app
        .getAppMetrics()
        .map((metric) => ({ pid: metric.pid, type: metric.type, memory: metric.memory })),
    }
  })
}
export async function fixture(directory: string, name: string, source: string): Promise<string> {
  const path = join(directory, `${name}.md`)
  await writeFile(path, source)
  return path
}
