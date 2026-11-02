import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type ElectronApplication, expect, test } from '@playwright/test'
import { contrast, launchDesktop } from './helpers'

const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'
async function cleanup(application: ElectronApplication, directory: string): Promise<void> {
  await application
    .evaluate(({ BrowserWindow }) => {
      for (const window of BrowserWindow.getAllWindows())
        if (!window.isDestroyed()) window.destroy()
    })
    .catch(() => {})
  await application.close()
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
test('Mermaid renders in an isolated sandbox and preserves source, theme and undo', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'manuslip-diagrams-'))
  const application = await launchDesktop(join(directory, 'profile'))
  try {
    const page = await application.firstWindow()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.getByRole('button', { name: 'New document', exact: true }).first().click()
    await page.getByRole('button', { name: 'Source', exact: true }).click()
    const editor = page.getByRole('textbox', { name: 'Markdown source' })
    const source =
      '# Diagrams\n\n```mermaid\nflowchart LR\n A[Write] --> B[Read]\n B --> C{Share?}\n C -->|Yes| D[Translate]\n```\n\nEnd'
    await editor.fill(source)
    await editor.press(`${modifier}+Home`)
    await page.getByRole('button', { name: 'Live Preview', exact: true }).click()
    const svg = page.locator('.cm-live-diagram svg')
    await expect(svg).toBeVisible()
    await expect(svg).toContainText('Write')
    await expect(svg).toContainText('Translate')
    expect(await svg.locator('path[d]').count()).toBeGreaterThan(0)
    expect(await svg.locator('g[transform]').count()).toBeGreaterThan(0)
    const labels = await svg
      .locator('text')
      .evaluateAll((nodes) =>
        nodes
          .filter((node) => ['Write', 'Read', 'Translate'].includes(node.textContent || ''))
          .map((node) => node.getBoundingClientRect().x),
      )
    expect(new Set(labels).size).toBe(3)
    await expect(
      svg.locator('style, script, foreignObject, a, image, [onclick], [onload]'),
    ).toHaveCount(0)
    const isolation = await application.evaluate(({ BrowserWindow }) => {
      const editor = BrowserWindow.getAllWindows().find(
        (window) => !window.webContents.getURL().includes('manuslip-diagram:'),
      )
      const host = BrowserWindow.getAllWindows().find((window) =>
        window.webContents.getURL().includes('manuslip-diagram:'),
      )
      if (!editor || !host) throw new Error('Missing diagram process')
      const preferences = (
        host.webContents as typeof host.webContents & {
          getLastWebPreferences(): Electron.WebPreferences
        }
      ).getLastWebPreferences()
      return {
        differentProcess: editor.webContents.getOSProcessId() !== host.webContents.getOSProcessId(),
        differentSession: editor.webContents.session !== host.webContents.session,
        sandbox: preferences.sandbox,
        isolation: preferences.contextIsolation,
        node: preferences.nodeIntegration,
        visible: host.isVisible(),
      }
    })
    expect(isolation).toEqual({
      differentProcess: true,
      differentSession: true,
      sandbox: true,
      isolation: true,
      node: false,
      visible: false,
    })
    const host = application.windows().find((window) => window.url().includes('manuslip-diagram:'))
    if (!host) throw new Error('Missing isolated page')
    const denied = await host.evaluate(async () => ({
      editorBridge: typeof (window as unknown as { manuslip?: unknown }).manuslip,
      node: typeof (window as unknown as { require?: unknown }).require,
      popup: window.open('https://example.com') === null,
      resources: await Promise.all(
        [
          'https://example.com/private',
          'file:///etc/passwd',
          'manuslip-diagram://render/index.html',
        ].map(async (url) => {
          try {
            await fetch(url)
            return false
          } catch {
            return true
          }
        }),
      ),
    }))
    expect(denied).toEqual({
      editorBridge: 'undefined',
      node: 'undefined',
      popup: true,
      resources: [true, true, true],
    })
    await page.screenshot({ path: test.info().outputPath('diagram-light.png') })
    await page.getByRole('button', { name: 'Preferences', exact: true }).click()
    await page.getByLabel('Appearance', { exact: true }).selectOption('dark')
    await page.getByRole('button', { name: 'Close preferences' }).click()
    await expect(svg).toBeVisible()
    await expect(page.getByText('Rendering diagram…', { exact: true })).toHaveCount(0)
    await page.screenshot({ path: test.info().outputPath('diagram-dark.png') })
    await page.getByRole('button', { name: 'Source', exact: true }).click()
    await expect
      .poll(async () => (await editor.locator('.cm-line').allTextContents()).join('\n'))
      .toBe(source)
    await editor.press(`${modifier}+End`)
    await editor.press('!')
    await editor.press(`${modifier}+z`)
    await expect
      .poll(async () => (await editor.locator('.cm-line').allTextContents()).join('\n'))
      .toBe(source)
    expect(errors).toEqual([])
  } finally {
    await cleanup(application, directory)
  }
})

test('diagram errors retain editable source and retry works across diagram families', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'manuslip-diagram-types-'))
  const application = await launchDesktop(join(directory, 'profile'))
  try {
    const page = await application.firstWindow()
    await page.getByRole('button', { name: 'New document', exact: true }).first().click()
    const editor = page.getByRole('textbox', { name: 'Markdown source' })
    for (const [source, label] of [
      [
        'sequenceDiagram\nparticipant Writer\nparticipant Reader\nWriter->>Reader: Hello 世界',
        'Hello 世界',
      ],
      ['classDiagram\nclass Document {\n+save()\n}\nDocument --> Translation', 'Document'],
      ['stateDiagram-v2\n[*] --> Draft\nDraft --> Published\nPublished --> [*]', 'Published'],
      ['erDiagram\nDOCUMENT ||--o{ PARAGRAPH : contains', 'PARAGRAPH'],
      ['pie title Languages\n"English" : 40\n"中文" : 60', '中文'],
      [
        'gantt\ntitle Writing\ndateFormat YYYY-MM-DD\nsection Work\nDraft :a, 2026-01-01, 2d',
        'Draft',
      ],
    ]) {
      await page.getByRole('button', { name: 'Source', exact: true }).click()
      await editor.fill(`# Types\n\n\`\`\`mermaid\n${source}\n\`\`\`\n\nEnd`)
      await editor.press(`${modifier}+Home`)
      await page.getByRole('button', { name: 'Live Preview', exact: true }).click()
      const svg = page.locator('.cm-live-diagram svg')
      await expect(svg, source).toBeVisible()
      await expect(svg).toContainText(label || '')
      expect(await svg.locator('[x], [d], [transform]').count()).toBeGreaterThan(0)
    }
    for (const [source, message] of [
      ['not a diagram', 'This diagram could not be rendered. Check its source or retry.'],
      [
        '%%{init: {securityLevel: "loose"}}%%\nflowchart LR\nA-->B',
        'Diagram configuration is controlled by Manuslip. Remove configuration directives or frontmatter to render it.',
      ],
      [
        `flowchart LR\n${Array.from({ length: 2001 }, (_, i) => `N${i}[Node]`).join('\n')}`,
        'This diagram exceeds the rendering limit. Reduce its size or complexity.',
      ],
    ]) {
      await page.getByRole('button', { name: 'Source', exact: true }).click()
      const markdown = `# Errors\n\n\`\`\`mermaid\n${source}\n\`\`\`\n\nEnd`
      if (source?.includes('N2000[Node]')) {
        const path = join(directory, 'node-limit.md')
        await writeFile(path, markdown)
        await application.evaluate(({ dialog }, path) => {
          dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
        }, path)
        await page.getByRole('button', { name: 'Open file…', exact: true }).first().click()
        await expect(page.getByRole('tab', { name: 'node-limit.md', exact: true })).toBeVisible()
      } else await editor.fill(markdown)
      await editor.press(`${modifier}+Home`)
      await page.getByRole('button', { name: 'Live Preview', exact: true }).click()
      const widget = page.locator('.cm-live-diagram')
      await expect(widget.getByText(message || '', { exact: true })).toBeVisible()
      await expect(widget.locator('pre')).toHaveText(source || '')
      const retry = widget.getByRole('button', { name: 'Retry diagram', exact: true })
      await retry.focus()
      await expect(retry).toBeFocused()
      await retry.press('Enter')
      await expect(widget.getByText(message || '', { exact: true })).toBeVisible()
      await expect(retry).toBeFocused()
    }
    await page.screenshot({ path: test.info().outputPath('diagram-error.png') })
    await page.getByRole('button', { name: 'Source', exact: true }).click()
    await editor.fill('# Fixed\n\n```mermaid\nflowchart LR\nDraft-->Ready\n```\n\nEnd')
    await editor.press(`${modifier}+Home`)
    await page.getByRole('button', { name: 'Live Preview', exact: true }).click()
    await expect(page.locator('.cm-live-diagram svg')).toContainText('Ready')
  } finally {
    await cleanup(application, directory)
  }
})

test('a hung diagram process is terminated while typing, saving and another window remain responsive', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'manuslip-diagram-hang-'))
  const application = await launchDesktop(join(directory, 'profile'))
  const target = join(directory, 'still-editable.md')
  try {
    const page = await application.firstWindow()
    await page.getByRole('button', { name: 'New document', exact: true }).first().click()
    await page.getByRole('button', { name: 'Source', exact: true }).click()
    const editor = page.getByRole('textbox', { name: 'Markdown source' })
    const initial = '# Original\n\n```mermaid\nflowchart LR\nA-->B\n```\n\nEnd'
    await editor.fill(initial)
    await editor.press(`${modifier}+Home`)
    await page.getByRole('button', { name: 'Live Preview', exact: true }).click()
    await expect(page.locator('.cm-live-diagram svg')).toBeVisible()
    const oldProcess = await application.evaluate(({ BrowserWindow, dialog }, target) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: target })
      const host = BrowserWindow.getAllWindows().find((window) =>
        window.webContents.getURL().includes('manuslip-diagram:'),
      )
      if (!host) throw new Error('Missing host')
      const pid = host.webContents.getOSProcessId()
      // Intentionally block only the isolated renderer's event loop.
      void host.webContents.executeJavaScript('for (;;) {}').catch(() => {})
      return pid
    }, target)
    const otherPromise = application.waitForEvent('window')
    await application.evaluate(async ({ BrowserWindow }) => {
      const other = new BrowserWindow({
        show: false,
        webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
      })
      await other.loadURL(
        'data:text/html,<title>Independent window</title><input aria-label="Other input">',
      )
    })
    const other = await otherPromise
    await other
      .getByRole('textbox', { name: 'Other input' })
      .fill('Still responsive', { timeout: 1500 })
    await page.getByRole('button', { name: 'Source', exact: true }).click({ timeout: 1500 })
    const changed = initial.replace('A-->B', 'Typed-->Saved')
    await editor.fill(changed, { timeout: 1500 })
    await page.getByRole('button', { name: 'Save', exact: true }).click({ timeout: 1500 })
    await expect.poll(() => readFile(target, 'utf8').catch(() => '')).toBe(changed)
    await editor.press(`${modifier}+Home`)
    await page.getByRole('button', { name: 'Live Preview', exact: true }).click()
    const widget = page.locator('.cm-live-diagram')
    await expect(
      widget.getByText('This diagram took too long. Edit its source or retry.', { exact: true }),
    ).toBeVisible({ timeout: 7000 })
    await expect(widget.locator('pre')).toContainText('Typed-->Saved')
    await expect
      .poll(() =>
        application.evaluate(
          ({ BrowserWindow }, old) =>
            BrowserWindow.getAllWindows().every(
              (window) => window.webContents.getOSProcessId() !== old,
            ),
          oldProcess,
        ),
      )
      .toBe(true)
    await widget.getByRole('button', { name: 'Retry diagram' }).click()
    await expect(widget.locator('svg')).toContainText('Saved')
    await expect(other.getByRole('textbox')).toHaveValue('Still responsive')
    expect(await readFile(target, 'utf8')).toBe(changed)
  } finally {
    await cleanup(application, directory)
  }
})

test('diagram failure controls wrap, retain focus and remain readable in Chinese at narrow width and zoom', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'manuslip-diagram-interface-'))
  const application = await launchDesktop(join(directory, 'profile'))
  try {
    const page = await application.firstWindow()
    await page.getByRole('button', { name: 'New document', exact: true }).first().click()
    await page.getByRole('button', { name: 'Source', exact: true }).click()
    const editor = page.getByRole('textbox', { name: 'Markdown source' })
    await editor.fill('# Retry\n\n```mermaid\ninvalid diagram\n```\n\nEnd')
    await editor.press(`${modifier}+Home`)
    await page.getByRole('button', { name: 'Live Preview', exact: true }).click()
    const retry = page.getByRole('button', { name: 'Retry diagram', exact: true })
    await expect(retry).toBeVisible()
    const ratios: number[] = []
    for (const theme of ['light', 'dark']) {
      await page.getByRole('button', { name: 'Preferences', exact: true }).click()
      await page.getByLabel('Appearance', { exact: true }).selectOption(theme)
      await page.getByRole('button', { name: 'Close preferences' }).click()
      await expect(retry).toBeVisible()
      const colors = await retry.evaluate((element) => ({
        color: getComputedStyle(element).color,
        background: getComputedStyle(element).backgroundColor,
      }))
      ratios.push(contrast(colors.color, colors.background))
      await retry.focus()
      await expect(retry).toBeFocused()
      await page.screenshot({ path: test.info().outputPath(`diagram-error-${theme}.png`) })
    }
    expect(Math.min(...ratios)).toBeGreaterThanOrEqual(4.5)
    await page.getByRole('button', { name: 'Preferences', exact: true }).click()
    await page.getByLabel('Interface language').selectOption('zh-CN')
    await page.getByRole('button', { name: '关闭偏好设置' }).click()
    // Recreate the widget so its localized source and status use the chosen locale.
    await page.getByRole('button', { name: '源码', exact: true }).click()
    await page.getByRole('textbox', { name: 'Markdown 源码' }).press(`${modifier}+Home`)
    await page.getByRole('button', { name: '实时预览', exact: true }).click()
    await page.setViewportSize({ width: 320, height: 1000 })
    const chineseRetry = page.getByRole('button', { name: '重试图表', exact: true })
    await expect(chineseRetry).toBeVisible()
    await chineseRetry.focus()
    await expect(chineseRetry).toBeFocused()
    await chineseRetry.press('Enter')
    await expect(chineseRetry).toBeFocused()
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
    expect(overflow).toBe(false)
    await page.screenshot({ path: test.info().outputPath('diagram-narrow-chinese.png') })
    await page.setViewportSize({ width: 1160, height: 900 })
    await application.evaluate(({ BrowserWindow }) => {
      const editor = BrowserWindow.getAllWindows().find(
        (window) => !window.webContents.getURL().includes('manuslip-diagram:'),
      )
      editor?.webContents.setZoomFactor(2)
    })
    await expect(chineseRetry).toBeVisible()
    // Zoom can replace the CodeMirror widget during measurement. Reacquire its control
    // across that transition; all focus and viewport requirements still have to hold.
    await expect(async () => {
      await chineseRetry.scrollIntoViewIfNeeded()
      await chineseRetry.focus()
      await expect(chineseRetry).toBeFocused()
      await expect(chineseRetry).toBeInViewport()
    }).toPass({ timeout: 5000 })
    await page.screenshot({ path: test.info().outputPath('diagram-zoom-chinese.png') })
    console.log(`Diagram retry contrast: ${ratios.map((value) => value.toFixed(2)).join(', ')}`)
  } finally {
    await cleanup(application, directory)
  }
})
