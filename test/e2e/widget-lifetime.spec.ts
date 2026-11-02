import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  type ElectronApplication,
  _electron as electron,
  expect,
  type Route,
  test,
} from '@playwright/test'
import { build, type InlineConfig, type PreviewServer, preview } from 'vite'
import type {} from './fixtures/preview-lifetime/fixture'

async function setup() {
  await mkdir('test/artifacts/logs', { recursive: true })
  const profile = await mkdtemp(resolve('test/artifacts/logs/widget-lifetime-'))
  let application: ElectronApplication | undefined
  let server: PreviewServer | undefined
  const cleanup = async () => {
    try {
      await application?.close()
    } finally {
      try {
        await server?.close()
      } finally {
        await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
      }
    }
  }
  const config: InlineConfig = {
    configFile: false,
    root: resolve('test/e2e/fixtures/preview-lifetime'),
    clearScreen: false,
    logLevel: 'silent',
    base: './',
    build: {
      outDir: resolve('test/artifacts/logs/widget-lifetime-build'),
      emptyOutDir: false,
      manifest: true,
    },
    worker: { format: 'es' },
    resolve: { conditions: ['worker', 'module', 'browser', 'development|production'] },
  }
  try {
    await build(config)
    const manifest = JSON.parse(
      await readFile('test/artifacts/logs/widget-lifetime-build/.vite/manifest.json', 'utf8'),
    ) as Record<string, { file: string }>
    const pythonGrammar = Object.entries(manifest).find(([key]) =>
      key.endsWith('@codemirror/lang-python/dist/index.js'),
    )?.[1].file
    if (!pythonGrammar) throw new Error('Missing Python grammar fixture asset')
    server = await preview({ ...config, preview: { host: '127.0.0.1', port: 0 } })
    const address = server.httpServer?.address()
    if (!address || typeof address === 'string') throw new Error('Missing fixture server')
    application = await electron.launch({
      args: [resolve('test/e2e/fixtures/preview-lifetime/main.cjs')],
      env: {
        ...process.env,
        MANUSLIP_WIDGET_TEST_PROFILE: profile,
        MANUSLIP_WIDGET_TEST_URL: `http://127.0.0.1:${address.port}/index.html`,
      },
    })
    const page = await application.firstWindow()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.waitForFunction(() => Boolean(window.previewLifetime), undefined, { timeout: 10000 })
    return {
      page,
      application,
      pythonGrammar,
      errors,
      async close() {
        try {
          await page.evaluate(() => window.previewLifetime.dispose())
        } finally {
          await cleanup()
        }
      },
    }
  } catch (error) {
    await cleanup()
    throw error
  }
}

test('equivalent widget DOM reuse retains one renderer lifetime and final removal aborts it', async () => {
  const fixture = await setup()
  try {
    const { page } = fixture
    const text = '# Heading\n\n~~~js\nconst x = 1\n~~~\n\n~~~js\nconst x = 1\n~~~\n'
    await page.evaluate((text) => window.previewLifetime.setSource(text), text)
    const first = text.indexOf('~~~js'),
      second = text.lastIndexOf('~~~js')
    const block = {
      id: 'stable',
      from: first,
      to: second - 2,
      kind: 'code',
      html: '<pre><code>const x = 1</code></pre><a href="https://example.invalid/">Open</a>',
      value: 'const x = 1',
      lines: 3,
    }
    await page.evaluate((block) => window.previewLifetime.native([block]), block)
    const widget = page.locator('.cm-live-code')
    await expect(widget).toHaveCount(1)
    const element = await widget.elementHandle()
    await page.evaluate(
      ({ block, second, end }) =>
        window.previewLifetime.native([{ ...block, from: second, to: end }]),
      { block, second, end: text.length - 1 },
    )
    await expect(widget).toHaveCount(1)
    expect(await widget.evaluate((node, previous) => node === previous, element)).toBe(true)
    expect(await page.evaluate(() => window.previewLifetime.counts())).toMatchObject({
      mounts: 1,
      aborted: 0,
    })
    await widget.locator('a').click({ modifiers: ['ControlOrMeta'] })
    expect(await page.evaluate(() => window.previewLifetime.counts())).toMatchObject({
      links: ['https://example.invalid/'],
    })
    await page.evaluate(() => window.previewLifetime.clear())
    await expect(widget).toHaveCount(0)
    expect(await page.evaluate(() => window.previewLifetime.counts())).toMatchObject({
      mounts: 1,
      aborted: 1,
    })
    // Detached DOM retained by a browser/tool must no longer dispatch editor actions.
    await element?.evaluate((node) => {
      node.querySelector<HTMLButtonElement>('button')?.click()
      node
        .querySelector('a')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true }))
    })
    expect(await page.evaluate(() => window.previewLifetime.counts())).toMatchObject({
      links: ['https://example.invalid/'],
      aborted: 1,
    })
    await element?.dispose()
    expect(fixture.errors).toEqual([])
  } finally {
    await fixture.close()
  }
})

test('React status keeps old packed outlines charged until delayed commits or unmount acknowledge them', async () => {
  const fixture = await setup()
  try {
    const { page } = fixture
    const client = await page.context().newCDPSession(page)
    await page.evaluate(async () => {
      const api = window.previewLifetime
      api.setSource('# First outline\n\nSome prose.')
      await api.owned()
      api.reactStatus.mount()
      api.reactStatus.publish()
    })
    const primary = page.locator('[data-status-reader="primary"]'),
      secondary = page.locator('[data-status-reader="secondary"]')
    await expect(primary).toHaveText('First outline')
    await expect(secondary).toHaveText('First outline')
    await page.evaluate(() => {
      window.previewLifetime.observeCurrent()
      window.previewLifetime.reactStatus.abandon()
      window.previewLifetime.reactStatus.pause()
    })
    expect(await page.evaluate(() => window.previewLifetime.reactStatus.counts())).toMatchObject({
      consumers: 2,
      publications: 1,
      pending: false,
    })
    await page.evaluate(async () => {
      const api = window.previewLifetime
      api.setSource('# Second outline\n\nChanged prose.')
      await api.owned()
      api.reactStatus.publish()
    })
    await expect(primary).toHaveText('Second outline')
    await expect(secondary).toHaveText('First outline')
    await client.send('HeapProfiler.collectGarbage')
    const held = await page.evaluate(() => window.previewLifetime.collected())
    expect(held).toMatchObject({ observed: 5, alive: 5 })
    expect(await page.evaluate(() => window.previewLifetime.reactStatus.counts())).toMatchObject({
      publications: 2,
      consumers: 2,
    })
    await page.evaluate(() => window.previewLifetime.reactStatus.resume())
    await expect(secondary).toHaveText('Second outline')
    await expect
      .poll(async () => {
        await client.send('HeapProfiler.collectGarbage')
        return page.evaluate(() => window.previewLifetime.collected().alive)
      })
      .toBe(0)
    const afterCommit = await page.evaluate(() => window.previewLifetime.collected())
    await page.evaluate(() => {
      window.previewLifetime.reactStatus.pause()
      window.previewLifetime.reactStatus.close()
    })
    await expect(primary).toHaveText('Empty')
    await expect(secondary).toHaveText('Second outline')
    expect(await page.evaluate(() => window.previewLifetime.reactStatus.counts())).toMatchObject({
      publications: 1,
      closed: true,
    })
    await page.evaluate(() => {
      window.previewLifetime.reactStatus.unmountSecondary()
      window.previewLifetime.clear()
    })
    expect(await page.evaluate(() => window.previewLifetime.reactStatus.counts())).toMatchObject({
      publications: 0,
      consumers: 1,
    })
    expect(await page.evaluate(() => window.previewLifetime.counts())).toMatchObject({
      holds: 0,
      readers: 0,
      bytes: 256,
    })
    console.log(
      'React status lifetime probe:',
      JSON.stringify({
        observed: held.observed,
        aliveWhileDelayed: held.alive,
        aliveAfterCommit: afterCommit.alive,
        afterClose: await page.evaluate(() => window.previewLifetime.reactStatus.counts()),
        owner: await page.evaluate(() => window.previewLifetime.counts()),
      }),
    )
    expect(fixture.errors).toEqual([])
  } finally {
    await fixture.close()
  }
})

test('changing a widget kind replaces its DOM and closes each renderer once', async () => {
  const fixture = await setup()
  try {
    const { page } = fixture
    const text = '# Heading\n\n~~~js\nconst x = 1\n~~~\n'
    await page.evaluate((text) => window.previewLifetime.setSource(text), text)
    const block = {
      id: 'stable',
      from: text.indexOf('~~~js'),
      to: text.length - 1,
      kind: 'code',
      html: '<pre><code>const x = 1</code></pre>',
      value: 'const x = 1',
      lines: 3,
    }
    await page.evaluate((block) => window.previewLifetime.native([block]), block)
    await expect(page.locator('.cm-live-code')).toHaveCount(1)
    await page.evaluate(
      (block) => window.previewLifetime.native([{ ...block, kind: 'html' }]),
      block,
    )
    await expect(page.locator('.cm-live-code')).toHaveCount(0)
    await expect(page.locator('.cm-live-html')).toHaveCount(1)
    expect(await page.evaluate(() => window.previewLifetime.counts())).toMatchObject({
      mounts: 2,
      aborted: 1,
    })
    await page.evaluate(() => window.previewLifetime.clear())
    await page.evaluate(() => window.previewLifetime.clear())
    expect(await page.evaluate(() => window.previewLifetime.counts())).toMatchObject({
      mounts: 2,
      aborted: 2,
    })
    expect(fixture.errors).toEqual([])
  } finally {
    await fixture.close()
  }
})

test('owned packed models render sanitized widgets and release native model data after actual DOM teardown', async () => {
  const fixture = await setup()
  try {
    const { page } = fixture
    const text =
      '# Heading 世界\n\n~~~js\nconst x = 1\n~~~\n\n<div><strong>Safe text</strong><script>window.compromised=true</script><img src="https://example.invalid/private.png" onerror="window.compromised=true"></div>\n\nEnd'
    await page.evaluate((text) => window.previewLifetime.setSource(text), text)
    await page.evaluate(() => window.previewLifetime.owned())
    await expect(page.locator('.cm-live-code')).toContainText('const x = 1')
    await expect(page.locator('.cm-live-html strong')).toHaveText('Safe text')
    await expect(
      page.locator(
        '.cm-live-rendered script, .cm-live-rendered [onerror], .cm-live-rendered img[src]',
      ),
    ).toHaveCount(0)
    await expect(page.locator('#status')).toContainText(
      `${[...text].length} characters; Heading 世界`,
    )
    const observed = await page.evaluate(() => window.previewLifetime.observeCurrent())
    expect(observed).toBe(7)
    const client = await fixture.application.context().newCDPSession(page)
    const before = await page.evaluate(() => window.previewLifetime.snapshot())
    await page.evaluate(() => window.previewLifetime.sourceMode())
    await expect(page.locator('.cm-live-block')).toHaveCount(0)
    await expect
      .poll(async () => (await page.evaluate(() => window.previewLifetime.counts())).holds)
      .toBe(2)
    const counts = await page.evaluate(() => window.previewLifetime.counts())
    expect(counts.aborted).toBe(counts.mounts)
    expect(counts.holds).toBe(2)
    // Replace only after all old DOM consumers have ended. This fixture's status is
    // plain text; React status consumers need their own acknowledged lifetime.
    await page.evaluate(() => window.previewLifetime.owned())
    await expect
      .poll(async () => {
        await client.send('HeapProfiler.collectGarbage')
        return page.evaluate(() => window.previewLifetime.collected())
      })
      .toMatchObject({ observed, alive: 0 })
    const replacementObserved = await page.evaluate(() => window.previewLifetime.observeCurrent())
    expect(replacementObserved).toBe(14)
    expect(await page.evaluate(() => window.previewLifetime.counts())).toMatchObject({ holds: 2 })
    await page.evaluate(() => window.previewLifetime.liveMode())
    await expect(page.locator('.cm-live-code')).toContainText('const x = 1')
    expect(await page.evaluate(() => window.previewLifetime.snapshot())).toEqual(before)
    expect(await page.evaluate(() => window.previewLifetime.collected())).toMatchObject({
      observed: replacementObserved,
      alive: 7,
    })
    await page.evaluate(() => window.previewLifetime.clear())
    await expect(page.locator('.cm-live-block')).toHaveCount(0)
    await expect
      .poll(async () => (await page.evaluate(() => window.previewLifetime.counts())).holds)
      .toBe(0)
    const cleared = await page.evaluate(() => window.previewLifetime.counts())
    expect(cleared).toMatchObject({
      holds: 0,
      readers: 0,
      bytes: 256,
      connected: 0,
    })
    expect(cleared.aborted).toBe(cleared.mounts)
    try {
      await expect
        .poll(async () => {
          await client.send('HeapProfiler.collectGarbage')
          return page.evaluate(() => window.previewLifetime.collected())
        })
        .toMatchObject({ observed: replacementObserved, alive: 0 })
    } catch (error) {
      console.log(
        'Retained fixture values:',
        await page.evaluate(() => window.previewLifetime.collected()),
      )
      const chunks: string[] = []
      client.on('HeapProfiler.addHeapSnapshotChunk', ({ chunk }) => chunks.push(chunk))
      await client.send('HeapProfiler.takeHeapSnapshot')
      await writeFile('test/artifacts/logs/widget-lifetime.heapsnapshot', chunks.join(''))
      throw error
    }
    expect(await page.evaluate(() => 'compromised' in window)).toBe(false)
    expect(fixture.errors).toEqual([])
  } finally {
    await fixture.close()
  }
})

test('reused DOM keeps the released predecessor charged until its renderer is destroyed', async () => {
  const fixture = await setup()
  try {
    const { page } = fixture
    const text =
      '# Heading\n\n~~~js\nconst x = 1\n~~~\n\n<div><strong>Safe text</strong></div>\n\nEnd'
    await page.evaluate((text) => window.previewLifetime.setSource(text), text)
    await page.evaluate(() => window.previewLifetime.owned())
    await expect(page.locator('.cm-live-code .tok-keyword')).toHaveText('const')
    await expect
      .poll(async () => (await page.evaluate(() => window.previewLifetime.counts())).holds)
      .toBe(6)
    expect(await page.evaluate(() => window.previewLifetime.observeCurrent())).toBe(7)
    const before = await page.evaluate(() => window.previewLifetime.snapshot())
    const element = await page.locator('.cm-live-code').elementHandle()
    const initial = await page.evaluate(() => window.previewLifetime.counts())
    await page.evaluate(() => window.previewLifetime.owned())
    expect(
      await page.locator('.cm-live-code').evaluate((node, previous) => node === previous, element),
    ).toBe(true)
    await element?.dispose()
    expect(await page.evaluate(() => window.previewLifetime.snapshot())).toEqual(before)
    expect(await page.evaluate(() => window.previewLifetime.counts())).toMatchObject({
      mounts: initial.mounts,
      aborted: 0,
      holds: 6,
    })
    expect(await page.evaluate(() => window.previewLifetime.observeCurrent())).toBe(14)
    const client = await fixture.application.context().newCDPSession(page)
    await client.send('HeapProfiler.collectGarbage')
    expect(await page.evaluate(() => window.previewLifetime.collected())).toMatchObject({
      observed: 14,
      alive: 14,
    })
    await page.evaluate(() => window.previewLifetime.sourceMode())
    await expect
      .poll(async () => {
        await client.send('HeapProfiler.collectGarbage')
        return page.evaluate(() =>
          window.previewLifetime.collected().retained.map(({ index }) => index),
        )
      })
      .toEqual([7, 8, 9, 10, 11, 12, 13])
    expect(await page.evaluate(() => window.previewLifetime.counts())).toMatchObject({ holds: 2 })
    await page.evaluate(() => window.previewLifetime.liveMode())
    await expect(page.locator('.cm-live-code .tok-keyword')).toHaveText('const')
    expect(await page.evaluate(() => window.previewLifetime.snapshot())).toEqual(before)
    await page.evaluate(() => window.previewLifetime.clear())
    await expect
      .poll(async () => {
        await client.send('HeapProfiler.collectGarbage')
        return page.evaluate(() => window.previewLifetime.collected().alive)
      })
      .toBe(0)
    expect(await page.evaluate(() => window.previewLifetime.counts())).toMatchObject({
      holds: 0,
      bytes: 256,
    })
    expect(fixture.errors).toEqual([])
  } finally {
    await fixture.close()
  }
})

for (const outcome of ['resolve', 'reject'] as const) {
  test(`a cancelled image remains charged until its pending loader ${outcome}s`, async () => {
    const fixture = await setup()
    try {
      const { page } = fixture
      const text =
        '# Heading\n\nBefore ![Picture](https://example.invalid/private.png) after.\n\nEnd'
      await page.evaluate((text) => window.previewLifetime.setSource(text), text)
      await page.evaluate(() => window.previewLifetime.deferImages())
      await page.evaluate(() => window.previewLifetime.owned())
      await expect(page.locator('.cm-live-inline-widget img')).toHaveCount(1)
      expect(await page.evaluate(() => window.previewLifetime.observeCurrent())).toBe(6)
      expect(await page.evaluate(() => window.previewLifetime.counts())).toMatchObject({
        images: 1,
        holds: 6,
      })
      await page.evaluate(() => window.previewLifetime.clear())
      await expect(page.locator('.cm-live-inline-widget')).toHaveCount(0)
      const waiting = await page.evaluate(() => window.previewLifetime.counts())
      expect(waiting).toMatchObject({ holds: 2, connected: 0, images: 1 })
      expect(waiting.bytes).toBeGreaterThan(256)
      const client = await fixture.application.context().newCDPSession(page)
      await client.send('HeapProfiler.collectGarbage')
      expect(await page.evaluate(() => window.previewLifetime.collected())).toMatchObject({
        observed: 6,
        alive: 6,
      })
      await page.evaluate(
        (outcome) =>
          window.previewLifetime.settleImages(
            outcome === 'resolve'
              ? { ok: true, value: 'data:image/png;base64,AA==' }
              : { ok: false, error: 'Unavailable', code: 'image-load' },
            outcome === 'reject',
          ),
        outcome,
      )
      await expect
        .poll(async () => {
          await client.send('HeapProfiler.collectGarbage')
          return page.evaluate(() => window.previewLifetime.collected())
        })
        .toMatchObject({ observed: 6, alive: 0 })
      expect(await page.evaluate(() => window.previewLifetime.counts())).toMatchObject({
        holds: 0,
        bytes: 256,
        images: 0,
      })
      expect(fixture.errors).toEqual([])
    } finally {
      await fixture.close()
    }
  })
}

for (const first of ['render', 'cancellation'] as const) {
  test(`a cancelled diagram stays charged when ${first} IPC completes first`, async () => {
    const fixture = await setup()
    try {
      const { page } = fixture
      const text = '# Heading\n\n~~~mermaid\nflowchart LR\nA-->B\n~~~\n\nEnd'
      await page.evaluate((text) => window.previewLifetime.setSource(text), text)
      await page.evaluate(() => window.previewLifetime.deferDiagrams())
      await page.evaluate(() => window.previewLifetime.owned())
      await expect(page.locator('.cm-live-diagram [aria-busy="true"]')).toHaveCount(1)
      expect(await page.evaluate(() => window.previewLifetime.observeCurrent())).toBe(6)
      expect(await page.evaluate(() => window.previewLifetime.counts())).toMatchObject({
        diagrams: 1,
        holds: 8,
      })
      await page.evaluate(() => window.previewLifetime.clear())
      await expect(page.locator('.cm-live-diagram')).toHaveCount(0)
      await expect
        .poll(async () => (await page.evaluate(() => window.previewLifetime.counts())).holds)
        .toBe(2)
      expect(await page.evaluate(() => window.previewLifetime.counts())).toMatchObject({
        diagrams: 1,
        cancellations: 1,
        connected: 0,
      })
      const client = await fixture.application.context().newCDPSession(page)
      await client.send('HeapProfiler.collectGarbage')
      expect(await page.evaluate(() => window.previewLifetime.collected())).toMatchObject({
        observed: 6,
        alive: 6,
      })
      await page.evaluate((first) => {
        if (first === 'render')
          window.previewLifetime.settleDiagrams(
            { ok: false, error: 'Stopped', code: 'diagram-process' },
            true,
          )
        else window.previewLifetime.settleCancellations()
      }, first)
      await client.send('HeapProfiler.collectGarbage')
      expect(await page.evaluate(() => window.previewLifetime.counts())).toMatchObject({ holds: 2 })
      expect(await page.evaluate(() => window.previewLifetime.collected())).toMatchObject({
        alive: 6,
      })
      await page.evaluate((first) => {
        if (first === 'render') window.previewLifetime.settleCancellations()
        else
          window.previewLifetime.settleDiagrams({
            ok: true,
            value: '<svg><path d="M0 0L1 1"/></svg>',
          })
      }, first)
      await expect
        .poll(async () => {
          await client.send('HeapProfiler.collectGarbage')
          return page.evaluate(() => window.previewLifetime.collected().alive)
        })
        .toBe(0)
      expect(await page.evaluate(() => window.previewLifetime.counts())).toMatchObject({
        holds: 0,
        bytes: 256,
        diagrams: 0,
        cancellations: 0,
      })
      await expect(page.locator('.cm-live-diagram')).toHaveCount(0)
      expect(fixture.errors).toEqual([])
    } finally {
      await fixture.close()
    }
  })
}

test('cancellation releases queued code immediately and retains running grammar loads until they settle', async () => {
  const fixture = await setup()
  const held: Route[] = []
  try {
    const { page } = fixture
    await page.route(`**/${fixture.pythonGrammar}`, (route) => {
      held.push(route)
    })
    const text =
      '# Heading\n\n' +
      Array.from({ length: 4 }, (_, index) => `~~~python\nx = ${index}\n~~~\n\n`).join('')
    await page.evaluate((text) => window.previewLifetime.setSource(text), text)
    await page.evaluate(() => window.previewLifetime.owned())
    await expect(page.locator('.cm-live-code')).toHaveCount(4)
    await expect.poll(() => held.length).toBeGreaterThan(0)
    expect(await page.evaluate(() => window.previewLifetime.observeCurrent())).toBe(9)
    expect(await page.evaluate(() => window.previewLifetime.counts())).toMatchObject({
      mounts: 4,
      holds: 18,
    })
    await page.evaluate(() => window.previewLifetime.clear())
    expect(await page.evaluate(() => window.previewLifetime.counts())).toMatchObject({
      mounts: 4,
      aborted: 4,
      connected: 0,
      holds: 6,
    })
    const client = await fixture.application.context().newCDPSession(page)
    await client.send('HeapProfiler.collectGarbage')
    expect(await page.evaluate(() => window.previewLifetime.collected())).toMatchObject({
      observed: 9,
      alive: 9,
    })
    for (const route of held.splice(0)) await route.continue()
    await page.unroute(`**/${fixture.pythonGrammar}`)
    await expect
      .poll(async () => {
        await client.send('HeapProfiler.collectGarbage')
        return page.evaluate(() => window.previewLifetime.collected().alive)
      })
      .toBe(0)
    expect(await page.evaluate(() => window.previewLifetime.counts())).toMatchObject({
      holds: 0,
      bytes: 256,
    })
    expect(fixture.errors).toEqual([])
  } finally {
    for (const route of held.splice(0)) await route.continue().catch(() => {})
    await fixture.close()
  }
})

test('cancelled math remains charged until its worker and queued promises settle', async () => {
  const fixture = await setup()
  const held: Route[] = []
  const pattern = '**/assets/math.worker-*.js'
  try {
    const { page } = fixture
    // Freeze the existing watchdog while the test deliberately delays the real worker.
    // This is an ownership check, not a timing or watchdog acceptance measurement.
    await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') })
    await page.clock.pauseAt(new Date('2026-01-02T00:00:00Z'))
    await page.context().route(pattern, (route) => {
      held.push(route)
    })
    const text = '# Heading\n\n$$\nx^2\n$$\n\n$$\ny^2\n$$\n\nEnd'
    await page.evaluate((text) => window.previewLifetime.setSource(text), text)
    await page.evaluate(() => window.previewLifetime.owned())
    await expect(page.locator('.cm-live-math')).toHaveCount(2)
    await expect.poll(() => held.length).toBeGreaterThan(0)
    expect(await page.evaluate(() => window.previewLifetime.observeCurrent())).toBe(7)
    expect(await page.evaluate(() => window.previewLifetime.counts())).toMatchObject({ holds: 10 })
    await page.evaluate(() => window.previewLifetime.clear())
    expect(await page.evaluate(() => window.previewLifetime.counts())).toMatchObject({
      holds: 4,
      connected: 0,
    })
    const client = await fixture.application.context().newCDPSession(page)
    await client.send('HeapProfiler.collectGarbage')
    expect(await page.evaluate(() => window.previewLifetime.collected())).toMatchObject({
      observed: 7,
      alive: 7,
    })
    for (const route of held.splice(0)) await route.continue()
    await page.context().unroute(pattern)
    await page.clock.resume()
    await expect
      .poll(async () => {
        await client.send('HeapProfiler.collectGarbage')
        return page.evaluate(() => window.previewLifetime.collected().alive)
      })
      .toBe(0)
    expect(await page.evaluate(() => window.previewLifetime.counts())).toMatchObject({
      holds: 0,
      bytes: 256,
    })
    await expect(page.locator('.cm-live-math')).toHaveCount(0)
    expect(fixture.errors).toEqual([])
  } finally {
    for (const route of held.splice(0)) await route.continue().catch(() => {})
    await fixture.page.clock.resume().catch(() => {})
    await fixture.close()
  }
})
