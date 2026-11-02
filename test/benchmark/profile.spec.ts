import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { launchDesktop } from '../e2e/helpers'
import { fixture, MiB, machine, modifier, openFile, report, settled, stop } from './helpers'

test('long paragraph profile (diagnostic, no latency gate)', async () => {
  test.skip(process.env.MANUSLIP_BENCH_PROFILE !== '1', 'Use test:performance -- --profile')
  const directory = await mkdtemp(join(tmpdir(), 'manuslip-profile-'))
  const application = await launchDesktop(join(directory, 'profile'))
  try {
    const page = await application.firstWindow()
    await expect(
      page.getByRole('button', { name: 'Open file…', exact: true }).first(),
    ).toBeVisible()
    const chunk =
      'A long paragraph still needs responsive editing, accurate counts and current semantics. '
    const source = `# Profile\n\n${chunk.repeat(Math.ceil(MiB / chunk.length))}`
    await openFile(application, page, await fixture(directory, 'long-paragraph', source))
    expect(await settled(page)).toBe('ready')
    await page.getByRole('textbox', { name: 'Markdown source' }).focus()
    await page.keyboard.press(`${modifier}+End`)
    const cdp = await page.context().newCDPSession(page)
    const events: { name: string; [field: string]: unknown }[] = []
    cdp.on('Tracing.dataCollected', ({ value }) => {
      for (const event of value)
        if (typeof event.name === 'string') events.push({ ...event, name: event.name })
    })
    await cdp.send('Profiler.enable')
    await cdp.send('Profiler.start')
    await cdp.send('Tracing.start', {
      categories: 'devtools.timeline,v8',
      transferMode: 'ReportEvents',
    })
    for (let index = 0; index < 20; index++) {
      await page.keyboard.type(String.fromCharCode(97 + index))
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      )
    }
    const { profile } = await cdp.send('Profiler.stop')
    const complete = new Promise<void>((resolve) =>
      cdp.once('Tracing.tracingComplete', () => resolve()),
    )
    await cdp.send('Tracing.end')
    await complete
    const path = test.info().outputPath('renderer.cpuprofile')
    await writeFile(path, JSON.stringify(profile))
    await test.info().attach('CPU profile', { path, contentType: 'application/json' })
    const trace = test.info().outputPath('timeline.json')
    await writeFile(trace, JSON.stringify({ traceEvents: events }))
    await test.info().attach('Timeline', { path: trace, contentType: 'application/json' })
    const samples = new Map<number, number>()
    for (const [index, id] of (profile.samples ?? []).entries()) {
      samples.set(id, (samples.get(id) ?? 0) + (profile.timeDeltas?.[index] ?? 0))
    }
    const functions = profile.nodes
      .map(
        (node: {
          id: number
          callFrame: { functionName: string; url: string; lineNumber: number; columnNumber: number }
        }) => ({
          ...node.callFrame,
          selfMs: (samples.get(node.id) ?? 0) / 1000,
        }),
      )
      .sort((a: { selfMs: number }, b: { selfMs: number }) => b.selfMs - a.selfMs)
      .slice(0, 40)
    const timeline = new Map<string, { count: number; totalMs: number; maxMs: number }>()
    for (const event of events) {
      if (typeof event.dur !== 'number') continue
      const value = timeline.get(event.name) ?? { count: 0, totalMs: 0, maxMs: 0 }
      value.count++
      value.totalMs += event.dur / 1000
      value.maxMs = Math.max(value.maxMs, event.dur / 1000)
      timeline.set(event.name, value)
    }
    await report(test.info(), 'profile', {
      machine: await machine(application),
      method:
        'Diagnostic 20-edit burst at the end of a 1 MiB paragraph with renderer CPU sampling and timeline instrumentation. These timings are not latency-gate samples.',
      functions,
      timeline: Object.fromEntries(timeline),
    })
    const screenshot = test.info().outputPath('long-paragraph.png')
    await page.screenshot({ path: screenshot })
    await test.info().attach('Long paragraph', { path: screenshot, contentType: 'image/png' })
    await cdp.detach()
  } finally {
    await stop(application)
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
})
