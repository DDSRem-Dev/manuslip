import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { launchDesktop } from './helpers'

function contrast(foreground: string, background: string): number {
  function luminance(color: string): number {
    const channels = (color.match(/[\d.]+/g) || []).slice(0, 3).map((value) => {
      const normalized = Number(value) / 255
      return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
    })
    return (channels[0] || 0) * 0.2126 + (channels[1] || 0) * 0.7152 + (channels[2] || 0) * 0.0722
  }
  const values = [luminance(foreground), luminance(background)].sort((a, b) => a - b)
  return ((values[1] || 0) + 0.05) / ((values[0] || 0) + 0.05)
}

test('secure shell launches, stays offline, and restores preferences', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'manuslip-e2e-'))
  const launch = () => launchDesktop(profile)
  let application = await launch()
  try {
    let page = await application.firstWindow()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await expect(page.getByRole('heading', { name: 'Start writing' })).toBeVisible()
    const security = await application.evaluate(({ app }) => ({
      renderers: app.getAppMetrics().filter((metric) => metric.type === 'Tab'),
      versions: process.versions,
    }))
    if (process.platform !== 'linux') {
      expect(security.renderers.length).toBeGreaterThan(0)
      expect(security.renderers.every((renderer) => renderer.sandboxed)).toBe(true)
    }
    console.log('Verified Electron runtime:', JSON.stringify(security.versions))
    expect(
      await page.evaluate(() => ({
        node: typeof Reflect.get(window, 'require'),
        bridge: Object.keys(window.manuslip).sort(),
      })),
    ).toEqual({
      node: 'undefined',
      bridge: [
        'bootstrap',
        'edit',
        'startSearch',
        'pollSearch',
        'cancelSearch',
        'openSearchResult',
        'incomingFiles',
        'openIncomingFile',
        'dismissIncomingFile',
        'onIncomingFiles',
        'workspace',
        'chooseWorkspace',
        'closeWorkspace',
        'onWorkspaceChanged',
        'recentWorkspace',
        'refreshWorkspace',
        'listWorkspace',
        'openWorkspaceFile',
        'restoreSessionFile',
        'forgetSessionFile',
        'rememberDocuments',
        'updateSettings',
        'newDocument',
        'openDocument',
        'saveDocument',
        'reloadDocument',
        'closeDocument',
        'confirmDocumentClose',
        'closeWindow',
        'onFileChanged',
        'onCommand',
        'checkpoint',
        'clearRecovery',
        'listRecoveries',
        'restoreRecovery',
        'discardRecovery',
        'openLink',
        'remoteImages',
        'loadRemoteImage',
        'loadLocalImage',
        'captureClipboardImage',
        'importClipboardImage',
        'discardClipboardImage',
        'convertClipboardHtml',
        'renderDiagram',
        'cancelDiagram',
        'onDiagramCapacity',
        'exportDocument',
        'cancelExport',
        'pandocTool',
        'plugins',
        'syncState',
        'connectSync',
        'setSyncCredential',
        'reviewSync',
        'resolveSync',
        'cancelSync',
        'disconnectSync',
        'exportSyncRecovery',
        'removeSyncRecovery',
        'choosePlugin',
        'installPlugin',
        'enablePlugin',
        'grantPlugin',
        'removePlugin',
        'runPlugin',
        'cancelPlugin',
        'selectPandocTool',
        'forgetPandocTool',
        'retryPandocTool',
        'writingStyle',
        'setWritingTypography',
        'importWritingStylesheet',
        'resetWritingStyle',
        'translationState',
        'loadTranslationLanguages',
        'configureTranslation',
        'setTranslationCredential',
        'translateUnit',
        'cancelTranslation',
        'clearTranslationCache',
        'onTranslationChanged',
      ].sort(),
    })
    await expect(
      page.evaluate(async () => {
        try {
          await fetch('https://example.com')
          return false
        } catch {
          return true
        }
      }),
    ).resolves.toBe(true)
    await page.evaluate(() => window.open('https://example.com'))
    expect(application.windows()).toHaveLength(1)

    const unauthorized = await application.evaluate(async ({ BrowserWindow, app }) => {
      const primary = BrowserWindow.getAllWindows()[0]
      if (!primary) throw new Error('No primary window')
      const other = new BrowserWindow({
        show: false,
        webPreferences: {
          preload: `${app.getAppPath()}/out/preload/index.cjs`,
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
        },
      })
      try {
        await other.loadURL(primary.webContents.getURL())
        return await other.webContents.executeJavaScript('window.manuslip.bootstrap()')
      } finally {
        other.destroy()
      }
    })
    expect(unauthorized).toMatchObject({ ok: false })

    const probePreload = join(profile, 'ipc-probe.cjs')
    await writeFile(
      probePreload,
      "const { contextBridge, ipcRenderer } = require('electron'); contextBridge.exposeInMainWorld('probeUnknownChannel', () => ipcRenderer.invoke('manuslip:unknown', null));",
    )
    await expect(
      application.evaluate(async ({ BrowserWindow }, preload) => {
        const probe = new BrowserWindow({
          show: false,
          webPreferences: {
            preload,
            sandbox: true,
            contextIsolation: true,
            nodeIntegration: false,
          },
        })
        try {
          await probe.loadURL('about:blank')
          return await probe.webContents.executeJavaScript('window.probeUnknownChannel()')
        } finally {
          probe.destroy()
        }
      }, probePreload),
    ).rejects.toThrow('No handler registered')

    const isolated = await application.evaluate(async ({ BrowserWindow }) => {
      const contents = BrowserWindow.getAllWindows()[0]?.webContents
      if (!contents) throw new Error('No primary window')
      await contents.executeJavaScriptInIsolatedWorld(999, [
        { code: 'globalThis.isolationProbe = true' },
      ])
      return await contents.executeJavaScript('typeof globalThis.isolationProbe')
    })
    expect(isolated).toBe('undefined')
    await page.evaluate(() => {
      const script = document.createElement('script')
      script.textContent = 'globalThis.injectionProbe = true'
      document.head.append(script)
    })
    expect(await page.evaluate(() => Reflect.get(window, 'injectionProbe'))).toBeUndefined()

    await page.getByRole('button', { name: 'Preferences', exact: true }).click()
    await page.getByLabel('Appearance', { exact: true }).selectOption('dark')
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    for (const selector of [
      '.welcome .muted',
      '.preferences-trigger',
      '.app-toolbar',
      'footer',
      'select',
    ]) {
      const pair = await page
        .locator(selector)
        .first()
        .evaluate((element) => {
          let background: Element | null = element
          while (
            background &&
            getComputedStyle(background).backgroundColor === 'rgba(0, 0, 0, 0)'
          ) {
            background = background.parentElement
          }
          return {
            foreground: getComputedStyle(element).color,
            background: getComputedStyle(background || document.documentElement).backgroundColor,
          }
        })
      expect(contrast(pair.foreground, pair.background), `dark ${selector}`).toBeGreaterThanOrEqual(
        4.5,
      )
    }
    await page.screenshot({ path: test.info().outputPath('shell-dark.png') })
    await page.getByLabel('Interface language').selectOption('zh-CN')
    await expect(page.getByRole('heading', { name: '偏好设置' })).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN')
    await application.close()
    application = await launch()
    page = await application.firstWindow()
    await page.getByRole('button', { name: '偏好设置', exact: true }).click()
    await expect(page.getByRole('heading', { name: '偏好设置' })).toBeVisible()
    await expect(page.getByLabel('外观', { exact: true })).toHaveValue('dark')
    await page.getByLabel('界面语言').selectOption('en')
    await expect(page.getByRole('heading', { name: 'Preferences' })).toBeVisible()
    await page.getByLabel('Appearance', { exact: true }).selectOption('light')
    await expect(page.getByLabel('Appearance', { exact: true })).toBeEnabled()
    await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]?.webContents.setZoomFactor(2),
    )
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true)
    await expect(page.getByLabel('Appearance', { exact: true })).toBeVisible()
    await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]?.webContents.setZoomFactor(1),
    )
    for (const selector of [
      '.welcome .muted',
      '.preferences-trigger',
      '.app-toolbar',
      'footer',
      'select',
    ]) {
      const pair = await page
        .locator(selector)
        .first()
        .evaluate((element) => {
          let background: Element | null = element
          while (
            background &&
            getComputedStyle(background).backgroundColor === 'rgba(0, 0, 0, 0)'
          ) {
            background = background.parentElement
          }
          return {
            foreground: getComputedStyle(element).color,
            background: getComputedStyle(background || document.documentElement).backgroundColor,
          }
        })
      expect(
        contrast(pair.foreground, pair.background),
        `light ${selector}`,
      ).toBeGreaterThanOrEqual(4.5)
    }

    await page.setViewportSize({ width: 320, height: 700 })
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true)
    await page.getByRole('button', { name: 'Close preferences', exact: true }).click()
    await page.getByRole('link', { name: 'Skip to content' }).focus()
    const focus = await page.evaluate(() => {
      const element = document.activeElement
      return element
        ? { outline: getComputedStyle(element).outlineStyle, name: element.tagName }
        : null
    })
    expect(focus?.outline).not.toBe('none')
    await page.keyboard.press('Enter')
    await expect(page.locator('#content')).toBeFocused()
    await page.setViewportSize({ width: 1160, height: 780 })
    await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]?.setContentSize(1160, 780),
    )
    await page.getByRole('button', { name: 'Preferences', exact: true }).click()
    await page.getByLabel('Appearance', { exact: true }).focus()
    await page.getByLabel('Appearance', { exact: true }).evaluate((element) => element.blur())
    await page.evaluate(
      () =>
        new Promise<void>((done) =>
          requestAnimationFrame(() => requestAnimationFrame(() => done())),
        ),
    )
    await page.screenshot({ path: test.info().outputPath('shell-light.png') })
    expect(errors).toEqual([])

    // Run last: Electron cancels the navigation, while CDP's pending-navigation signal
    // can otherwise make Playwright wait for a document that will never be loaded.
    const blockedNavigation = await application.evaluate(async ({ BrowserWindow }) => {
      const contents = BrowserWindow.getAllWindows()[0]?.webContents
      if (!contents) throw new Error('No primary window')
      const blocked = new Promise<boolean>((done) =>
        contents.once('will-navigate', (event) => done(event.defaultPrevented)),
      )
      await contents.executeJavaScript('location.href = "https://example.com"')
      return await blocked
    })
    expect(blockedNavigation).toBe(true)
  } finally {
    await application.close()
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
})
