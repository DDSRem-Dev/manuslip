import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { contrast, launchDesktop } from './helpers'
import { audit, capture, draft, stop } from './recovery-helpers'

test('recovery names, confirmation and focus remain usable across themes, Chinese, RTL and native zoom', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'manuslip-recovery-ui-')),
    profile = join(directory, 'profile')
  const name = `${'世界 — Notes and references — خطط الكتابة — '.repeat(3)}.md`
  await draft(profile, name, 'Retained writing')
  const application = await launchDesktop(profile)
  try {
    const page = await application.firstWindow(),
      panel = page.locator('.recovery-panel')
    await expect(panel.locator('li')).toHaveCount(1)
    const states = [
      { theme: 'light', locale: 'en', width: 1160, zoom: 1, rtl: false },
      { theme: 'dark', locale: 'en', width: 320, zoom: 1, rtl: false },
      { theme: 'light', locale: 'zh-CN', width: 320, zoom: 1, rtl: false },
      { theme: 'dark', locale: 'zh-CN', width: 1160, zoom: 1, rtl: true },
      { theme: 'light', locale: 'en', width: 1160, zoom: 2, rtl: false },
      { theme: 'dark', locale: 'zh-CN', width: 1160, zoom: 2, rtl: false },
    ]
    const measurements = []
    for (const [index, state] of states.entries()) {
      const settings = await page.evaluate(async (state) => {
        const bootstrap = await window.manuslip.bootstrap()
        if (!bootstrap.ok) throw new Error('Missing settings')
        return window.manuslip.updateSettings({
          ...bootstrap.value.settings,
          theme: state.theme as 'light' | 'dark',
          locale: state.locale as 'en' | 'zh-CN',
        })
      }, state)
      expect(settings.ok).toBe(true)
      await page.reload()
      await expect(page.locator('html')).toHaveAttribute('lang', state.locale)
      if (state.zoom === 1) await page.setViewportSize({ width: state.width, height: 900 })
      else {
        const session = await page.context().newCDPSession(page)
        await session.send('Emulation.clearDeviceMetricsOverride')
        await session.detach()
      }
      await application.evaluate(({ BrowserWindow }, zoom) => {
        const window = BrowserWindow.getAllWindows()[0]
        if (!window) throw new Error('Missing application window')
        window.webContents.setZoomFactor(zoom)
      }, state.zoom)
      await page.evaluate((rtl) => {
        document.documentElement.dir = rtl ? 'rtl' : 'ltr'
      }, state.rtl)
      await expect(panel.locator('li')).toHaveCount(1)
      const discard = panel.locator('[data-recovery-action="discard"]')
      await discard.focus()
      await page.keyboard.press('Enter')
      const cancel = panel.locator('[data-recovery-action="cancel"]')
      await expect(cancel).toBeFocused()
      const metrics = await panel.evaluate((element) => {
        const button = element.querySelector<HTMLButtonElement>('[data-recovery-action="cancel"]')
        if (!button) throw new Error('Missing confirmation button')
        const style = getComputedStyle(button),
          background = getComputedStyle(element).backgroundColor,
          bounds = button.getBoundingClientRect(),
          panel = element.getBoundingClientRect()
        return {
          innerWidth,
          innerHeight,
          rootWidth: document.documentElement.scrollWidth,
          panelWidth: element.clientWidth,
          panelScrollWidth: element.scrollWidth,
          text: style.color,
          buttonBackground: style.backgroundColor,
          outline: style.outlineColor,
          outlineWidth: style.outlineWidth,
          background,
          buttonHeight: button.getBoundingClientRect().height,
          buttonTop: bounds.top,
          buttonBottom: bounds.bottom,
          panelTop: panel.top,
          panelBottom: panel.bottom,
        }
      })
      expect(metrics.rootWidth).toBeLessThanOrEqual(metrics.innerWidth)
      expect(metrics.panelScrollWidth).toBeLessThanOrEqual(metrics.panelWidth + 1)
      expect(metrics.buttonHeight).toBeGreaterThanOrEqual(40)
      expect(contrast(metrics.text, metrics.buttonBackground)).toBeGreaterThanOrEqual(4.5)
      expect(contrast(metrics.outline, metrics.background)).toBeGreaterThanOrEqual(3)
      expect(metrics.outlineWidth).toBe('2px')
      expect(metrics.buttonTop).toBeGreaterThanOrEqual(Math.max(0, metrics.panelTop))
      expect(metrics.buttonBottom).toBeLessThanOrEqual(
        Math.min(metrics.innerHeight, metrics.panelBottom),
      )
      measurements.push({ state, metrics })
      await capture(application, `recovery-ui-${index}`)
      await audit(page, `recovery-ui-${index}`)
      await page.keyboard.press('Escape')
      await expect(discard).toBeFocused()
    }
    await writeFile(
      test.info().outputPath('measurements.json'),
      JSON.stringify(measurements, null, 2),
    )
  } finally {
    await stop(application)
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
})
